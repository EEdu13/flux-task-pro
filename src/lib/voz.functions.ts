import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import type { PessoaDoTime, Prioridade, TarefaDitada, TarefaInterpretada } from "@/lib/voz.server";
import { ataDaEntrada, type AtaAoVivo } from "@/lib/ata-ao-vivo";

export type { PessoaDoTime, Prioridade, TarefaDitada, TarefaInterpretada };

/* A porta da Tarefa por voz. O trabalho mora em `voz.server.ts`; aqui ficam as
   três coisas que não podem faltar numa função que gasta dinheiro por chamada:
   sessão (ninguém de fora queima crédito), entrada com teto, e um limite por
   pessoa. As chaves são lidas só aqui dentro e nunca chegam ao navegador. */

/** Trecho de fala em base64. ~2,5 MB cobrem com folga os 25 s que a tela deixa passar. */
const MAX_BASE64 = 2_500_000;

/**
 * Limite por pessoa, por hora, na memória do processo.
 *
 * Um ditado normal usa uma chamada de cada por frase — umas 20 num ditado
 * longo. Na reunião, quem abre a ata transcreve TODOS os participantes, então
 * a transcrição de reunião tem teto próprio e bem maior. O teto só existe para
 * um laço com defeito (ou alguém insistindo) não virar conta: some a cada
 * reinício do servidor, e tudo bem, porque não é cota de uso, é freio de
 * emergência.
 */
const LIMITE_POR_HORA = {
  transcricao: 300,
  interpretacao: 300,
  "transcricao-reuniao": 2000,
  "ata-final": 30,
  /** Blocos de ~40 s com o áudio guardado: uma reunião cheia gera ~1 por minuto por pessoa. */
  "bloco-reuniao": 400,
} as const;
const usos = new Map<string, number[]>();

function conferirLimite(tipo: keyof typeof LIMITE_POR_HORA, eu: number) {
  const chave = `${tipo}:${eu}`;
  const agora = Date.now();
  const recentes = (usos.get(chave) ?? []).filter((t) => agora - t < 3_600_000);
  if (recentes.length >= LIMITE_POR_HORA[tipo]) {
    throw new Error("Limite de uso da voz atingido nesta hora. Tente mais tarde.");
  }
  recentes.push(agora);
  usos.set(chave, recentes);
}

/** Troca o erro técnico pela frase da tela, deixando o técnico no log. */
async function comFrase<T>(onde: string, eu: number, fazer: () => Promise<T>): Promise<T> {
  const { ErroDaIa } = await import("@/lib/ia.server");
  try {
    return await fazer();
  } catch (e) {
    if (e instanceof ErroDaIa) {
      console.error(`[voz] ${onde} falhou para ${eu}: ${e.message}`);
      throw new Error(e.paraTela);
    }
    throw e;
  }
}

const texto = (v: unknown, teto: number) => (typeof v === "string" ? v.trim().slice(0, teto) : "");

function pessoasDaEntrada(v: unknown): PessoaDoTime[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 400).flatMap((p) => {
    const id = texto(p?.id, 40);
    const nome = texto(p?.nome, 120);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !nome) return [];
    return [{ id, nome, setor: texto(p?.setor, 60), cargo: texto(p?.cargo, 80) }];
  });
}

/* -------------------- Ouvir -------------------- */

type EntradaTranscricao = {
  audio: string;
  mime: string;
  nomes: string[];
  contexto: "ditado" | "reuniao";
  falaMs: number | undefined;
  anterior: string;
};

export const transcreverVoz = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        audio: string;
        mime: string;
        nomes?: string[];
        contexto?: "ditado" | "reuniao";
        falaMs?: number;
        anterior?: string;
      }): EntradaTranscricao => {
        const audio = typeof e?.audio === "string" ? e.audio.replace(/^data:[^,]*,/, "") : "";
        if (!audio) throw new Error("Trecho de áudio vazio");
        if (audio.length > MAX_BASE64) throw new Error("Trecho de áudio longo demais");
        if (!/^[A-Za-z0-9+/=]+$/.test(audio)) throw new Error("Áudio em formato inválido");
        const mime = texto(e?.mime, 60) || "audio/webm";
        if (!mime.startsWith("audio/")) throw new Error("Áudio em formato inválido");
        const nomes = Array.isArray(e?.nomes)
          ? e.nomes
              .slice(0, 80)
              .map((n) => texto(n, 60))
              .filter(Boolean)
          : [];
        const falaMs =
          typeof e?.falaMs === "number" && Number.isFinite(e.falaMs) && e.falaMs >= 0
            ? Math.min(e.falaMs, 600_000)
            : undefined;
        return {
          audio,
          mime,
          nomes,
          contexto: e?.contexto === "reuniao" ? "reuniao" : "ditado",
          falaMs,
          anterior: typeof e?.anterior === "string" ? e.anterior.trim().slice(-400) : "",
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaTranscricao) => {
      conferirLimite(d.contexto === "reuniao" ? "transcricao-reuniao" : "transcricao", eu);
      return comFrase("transcrição", eu, async () => {
        const { transcreverTrecho } = await import("@/lib/voz.server");
        const textoOuvido = await transcreverTrecho({
          apiKey: process.env.OPENAI_API_KEY,
          audio: Buffer.from(d.audio, "base64"),
          mime: d.mime,
          nomes: d.nomes,
          contexto: d.contexto,
          falaMs: d.falaMs,
          anterior: d.anterior,
        });
        return { texto: textoOuvido };
      });
    }),
  );

/* -------------------- Entender -------------------- */

type EntradaInterpretacao = {
  trechoNovo: string;
  falaAnterior: string;
  tarefas: TarefaDitada[];
  pessoas: PessoaDoTime[];
  quemDita: string;
  hoje: string;
};

const PRIORIDADES: Prioridade[] = ["alta", "media", "baixa"];

export const interpretarVoz = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        trechoNovo: string;
        falaAnterior?: string;
        tarefas?: TarefaDitada[];
        pessoas?: PessoaDoTime[];
        quemDita: string;
        hoje: string;
      }): EntradaInterpretacao => {
        const trechoNovo = texto(e?.trechoNovo, 4000);
        if (!trechoNovo) throw new Error("Trecho vazio");
        const hoje = texto(e?.hoje, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("Data de hoje inválida");

        const tarefas: TarefaDitada[] = Array.isArray(e?.tarefas)
          ? e.tarefas.slice(0, 40).flatMap((t) => {
              const ref = texto(t?.ref, 20);
              const titulo = texto(t?.titulo, 200);
              if (!ref || !titulo) return [];
              return [
                {
                  ref,
                  titulo,
                  descricao: texto(t?.descricao, 1000),
                  responsavelId: texto(t?.responsavelId, 40) || null,
                  prazo: texto(t?.prazo, 10) || null,
                  hora: texto(t?.hora, 5) || null,
                  prioridade: PRIORIDADES.includes(t?.prioridade) ? t.prioridade : "media",
                },
              ];
            })
          : [];

        return {
          trechoNovo,
          // O fim da fala anterior: é onde moram as referências ("essa", "a última").
          falaAnterior:
            typeof e?.falaAnterior === "string" ? e.falaAnterior.trim().slice(-3000) : "",
          tarefas,
          pessoas: pessoasDaEntrada(e?.pessoas),
          quemDita: texto(e?.quemDita, 40),
          hoje,
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaInterpretacao): Promise<{ tarefas: TarefaInterpretada[] }> => {
      conferirLimite("interpretacao", eu);
      return comFrase("interpretação", eu, async () => {
        const { interpretarDitado } = await import("@/lib/voz.server");
        const r = await interpretarDitado({ apiKey: process.env.CLAUDE_API_KEY, ...d });
        // Tokens no log para acompanhar o custo real; o conteúdo da fala não.
        console.info(
          `[voz] interpretação de ${eu}: ${r.tokens.entrada} in / ${r.tokens.saida} out, ${r.tarefas.length} tarefa(s)`,
        );
        return { tarefas: r.tarefas };
      });
    }),
  );

/* -------------------- Linhas de fala -------------------- */

type LinhaDeFala = { hora: string; quem: string; texto: string };

function linhasDaEntrada(v: unknown, maximo: number): LinhaDeFala[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-maximo).flatMap((l) => {
    const t = texto(l?.texto, 1500);
    if (!t) return [];
    return [{ hora: texto(l?.hora, 5), quem: texto(l?.quem, 120) || "Alguém", texto: t }];
  });
}

/* -------------------- A ata final -------------------- */

type EntradaAtaFinal = {
  titulo: string;
  data: string;
  participantes: string[];
  rascunho: AtaAoVivo;
  falas: LinhaDeFala[];
  chat: LinhaDeFala[];
};

/** Uns 150 mil tokens de transcrição: mais de três horas de conversa. */
const MAX_CARACTERES_DA_TRANSCRICAO = 600_000;

export const redigirAtaFinalDaReuniao = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        titulo: string;
        data: string;
        participantes?: string[];
        rascunho?: AtaAoVivo;
        falas?: LinhaDeFala[];
        chat?: LinhaDeFala[];
      }): EntradaAtaFinal => {
        let falas = linhasDaEntrada(e?.falas, 6000);
        const chat = linhasDaEntrada(e?.chat, 300);
        if (!falas.length && !chat.length) throw new Error("Nada para a ata");
        // Reunião enorme: fica o fim (o rascunho ao vivo já cobre o começo).
        let total = falas.reduce((s, f) => s + f.texto.length + 30, 0);
        while (total > MAX_CARACTERES_DA_TRANSCRICAO && falas.length > 1) {
          total -= falas[0]!.texto.length + 30;
          falas = falas.slice(1);
        }
        return {
          titulo: texto(e?.titulo, 120) || "Reunião",
          data: texto(e?.data, 10),
          participantes: Array.isArray(e?.participantes)
            ? e.participantes
                .slice(0, 80)
                .map((p) => texto(p, 120))
                .filter(Boolean)
            : [],
          rascunho: ataDaEntrada(e?.rascunho),
          falas,
          chat,
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaAtaFinal): Promise<{ ata: AtaAoVivo }> => {
      conferirLimite("ata-final", eu);
      return comFrase("ata final", eu, async () => {
        const { redigirAtaFinal, redigirAtaFinalComGpt } = await import("@/lib/voz.server");
        /* Claude primeiro; se ele falhar (fora do ar, sem crédito), o GPT
           escreve a mesma ata. Reunião não fica sem ata por um provedor só. */
        let r;
        let quem = "claude";
        try {
          r = await redigirAtaFinal({ apiKey: process.env.CLAUDE_API_KEY, ...d });
        } catch (e) {
          console.warn(
            `[voz] ata final pelo Claude falhou para ${eu}, indo para o GPT:`,
            (e as Error)?.message,
          );
          quem = "gpt";
          conferirLimite("ata-final", eu);
          r = await redigirAtaFinalComGpt({ apiKey: process.env.OPENAI_API_KEY, ...d });
        }
        console.info(
          `[voz] ata final (${quem}) de ${eu}: ${r.tokens.entrada} in / ${r.tokens.saida} out, ${d.falas.length} fala(s)`,
        );
        return { ata: r.ata };
      });
    }),
  );

/* -------------------- Bloco de fala da reunião -------------------- */

/** ~55 s de fala em WAV 16 kHz (32 KB/s), já em base64. */
const MAX_BASE64_BLOCO = 2_500_000;

type EntradaBloco = {
  ataId: string;
  blocoId: string;
  audio: string;
  nomes: string[];
  falaMs: number | undefined;
  anterior: string;
};

const ehGuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/**
 * Guarda no Blob o bloco de fala de uma pessoa (a reunião fica gravada, para
 * ouvir o trecho depois) e devolve a transcrição dele. O áudio vai para
 * `atas/<ata>/<bloco>.wav`; o banco não recebe nada além do texto da ata.
 */
export const transcreverBlocoDaReuniao = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        ataId: string;
        blocoId: string;
        audio: string;
        nomes?: string[];
        falaMs?: number;
        anterior?: string;
      }): EntradaBloco => {
        if (!ehGuid(e?.ataId) || !ehGuid(e?.blocoId)) throw new Error("Bloco inválido");
        const audio = typeof e?.audio === "string" ? e.audio : "";
        if (!audio || audio.length > MAX_BASE64_BLOCO) throw new Error("Bloco de áudio inválido");
        if (!/^[A-Za-z0-9+/=]+$/.test(audio)) throw new Error("Áudio em formato inválido");
        // "UklGR" é "RIFF" em base64: só WAV entra aqui.
        if (!audio.startsWith("UklGR")) throw new Error("Áudio em formato inválido");
        return {
          ataId: e.ataId.toLowerCase(),
          blocoId: e.blocoId.toLowerCase(),
          audio,
          nomes: Array.isArray(e?.nomes)
            ? e.nomes
                .slice(0, 80)
                .map((n) => texto(n, 60))
                .filter(Boolean)
            : [],
          falaMs:
            typeof e?.falaMs === "number" && Number.isFinite(e.falaMs) && e.falaMs >= 0
              ? Math.min(e.falaMs, 600_000)
              : undefined,
          anterior: typeof e?.anterior === "string" ? e.anterior.trim().slice(-400) : "",
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaBloco): Promise<{ texto: string; guardado: boolean }> => {
      conferirLimite("bloco-reuniao", eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const pode = await pool
        .request()
        .input("ata", sql.UniqueIdentifier, d.ataId)
        .input("eu", sql.Int, eu)
        .query(
          `SELECT CASE
                    WHEN NOT EXISTS (SELECT 1 FROM gestor.atas WHERE id = @ata) THEN 1
                    WHEN EXISTS (SELECT 1 FROM gestor.atas a
                                  WHERE a.id = @ata AND (a.criada_por = @eu
                                    OR EXISTS (SELECT 1 FROM gestor.ata_participantes p
                                                WHERE p.ata_id = a.id AND p.pessoa_id = @eu)))
                      THEN 1 ELSE 0 END AS pode`,
        );
      if (!(pode.recordset[0] as { pode: number }).pode) throw new Error("Sem acesso a esta ata.");
      const bytes = Buffer.from(d.audio, "base64");
      // Guardar não pode impedir a ata: se o Blob falhar, a transcrição segue.
      let guardado = false;
      try {
        const { enviarParaOBlob } = await import("@/integrations/blob.server");
        const copia = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        // Só cria: um bloco já gravado nunca é trocado (o registro da reunião não se adultera).
        await enviarParaOBlob(
          `atas/${d.ataId}/${d.blocoId}.wav`,
          copia as ArrayBuffer,
          "audio/wav",
          {
            naoSobrescrever: true,
          },
        );
        guardado = true;
      } catch (e) {
        console.warn(`[voz] bloco da ata não foi guardado para ${eu}:`, (e as Error)?.message);
      }
      return comFrase("transcrição do bloco", eu, async () => {
        const { transcreverTrecho } = await import("@/lib/voz.server");
        const textoOuvido = await transcreverTrecho({
          apiKey: process.env.OPENAI_API_KEY,
          audio: new Uint8Array(bytes),
          mime: "audio/wav",
          nomes: d.nomes,
          contexto: "reuniao",
          falaMs: d.falaMs,
          anterior: d.anterior,
        });
        return { texto: textoOuvido, guardado };
      });
    }),
  );
