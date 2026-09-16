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
  ata: 240,
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
};

export const transcreverVoz = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        audio: string;
        mime: string;
        nomes?: string[];
        contexto?: "ditado" | "reuniao";
        falaMs?: number;
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
        return { audio, mime, nomes, contexto: e?.contexto === "reuniao" ? "reuniao" : "ditado", falaMs };
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
  .inputValidator(
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

/* -------------------- Escrever a ata -------------------- */

type LinhaDeFala = { hora: string; quem: string; texto: string };

type EntradaAta = {
  titulo: string;
  data: string;
  participantes: string[];
  ata: AtaAoVivo;
  anteriores: LinhaDeFala[];
  novas: LinhaDeFala[];
  chat: LinhaDeFala[];
};

function linhasDaEntrada(v: unknown, maximo: number): LinhaDeFala[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-maximo).flatMap((l) => {
    const t = texto(l?.texto, 1500);
    if (!t) return [];
    return [{ hora: texto(l?.hora, 5), quem: texto(l?.quem, 120) || "Alguém", texto: t }];
  });
}

export const atualizarAtaDaReuniao = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        titulo: string;
        data: string;
        participantes?: string[];
        ata?: AtaAoVivo;
        anteriores?: LinhaDeFala[];
        novas?: LinhaDeFala[];
        chat?: LinhaDeFala[];
      }): EntradaAta => {
        const novas = linhasDaEntrada(e?.novas, 200);
        const chat = linhasDaEntrada(e?.chat, 100);
        if (!novas.length && !chat.length) throw new Error("Nada novo para a ata");
        return {
          titulo: texto(e?.titulo, 120) || "Reunião",
          data: texto(e?.data, 10),
          participantes: Array.isArray(e?.participantes)
            ? e.participantes
                .slice(0, 60)
                .map((p) => texto(p, 120))
                .filter(Boolean)
            : [],
          ata: ataDaEntrada(e?.ata),
          anteriores: linhasDaEntrada(e?.anteriores, 30),
          novas,
          chat,
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaAta): Promise<{ ata: AtaAoVivo }> => {
      conferirLimite("ata", eu);
      return comFrase("ata", eu, async () => {
        const { atualizarAta } = await import("@/lib/voz.server");
        const r = await atualizarAta({ apiKey: process.env.CLAUDE_API_KEY, ...d });
        console.info(
          `[voz] ata de ${eu}: ${r.tokens.entrada} in / ${r.tokens.saida} out, ${d.novas.length} fala(s)`,
        );
        return { ata: r.ata };
      });
    }),
  );
