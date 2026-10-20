import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";
import type { CardDaSala } from "@/components/rv/sala/tipos";

/* A porta dos cards da sala de Realidade Virtual. O trabalho mora em
   `voz.server.ts` (ouvir) e `rv-cards.server.ts` (entender); aqui ficam as
   três coisas que não podem faltar numa função que gasta dinheiro por
   chamada: sessão, entrada com teto e um freio por pessoa.

   Funções próprias, e não `transcreverVoz`: na sala CADA pessoa transcreve a
   própria fala o tempo todo enquanto os cards estão ligados, e o teto que
   importa é de MINUTOS de fala, não de chamadas. `voz.functions.ts` é de
   produção e não muda por causa de um protótipo. */

/**
 * Teto do trecho em base64. A sala corta a fala em no máximo 12 s gravados a 64 kbps (~96 KB,
 * ~128 KB em base64); 400 mil caracteres (~300 KB) deixam folga para o opus estourar a taxa sem
 * aceitar os minutos de áudio que os 2,5 MB de `transcreverVoz` aceitariam.
 */
const MAX_BASE64 = 400_000;
/**
 * Bytes de áudio por segundo de fala usados como PISO da duração (96 kbps — acima dos 64 kbps
 * do gravador, então o piso nunca passa da duração real). Sem isto o freio de minutos confiava
 * só no `falaMs` que o cliente diz: um trecho grande declarado com falaMs = 0 contava 1 s.
 */
const BYTES_POR_SEGUNDO_MAX = 96_000 / 8;

/** Duração mínima (ms) que um áudio com `base64` caracteres pode ter. */
const msMinimosDoAudio = (base64: number) => ((base64 * 3) / 4 / BYTES_POR_SEGUNDO_MAX) * 1000;

/**
 * Freios por pessoa e por hora, na memória do processo. Não é cota de uso: é
 * para um laço com defeito não virar conta. Some a cada reinício, e tudo bem.
 *   - transcrição: 1200 chamadas e 40 min de fala por hora (a fala conta com
 *     piso de 1 s por trecho, para muitos trechos curtos não passarem de graça);
 *   - card: 240 por hora e um de cada vez (o cliente já espera 8 s entre um e
 *     outro; dois em voo só acontecem com duas abas ou com defeito).
 */
const TETO = {
  transcricoesPorHora: 1200,
  falaMsPorHora: 40 * 60_000,
  cardsPorHora: 240,
} as const;
const HORA_MS = 3_600_000;

const usos = new Map<string, { t: number; peso: number }[]>();
const cardEmAndamento = new Set<number>();

/** Confere e registra o uso. `peso` é 1 por chamada ou os ms de fala. */
function conferirLimite(tipo: string, eu: number, peso: number, teto: number, frase: string) {
  const chave = `${tipo}:${eu}`;
  const agora = Date.now();
  const recentes = (usos.get(chave) ?? []).filter((u) => agora - u.t < HORA_MS);
  const usado = recentes.reduce((s, u) => s + u.peso, 0);
  if (usado + peso > teto) {
    usos.set(chave, recentes);
    throw new Error(frase);
  }
  recentes.push({ t: agora, peso });
  usos.set(chave, recentes);
}

/** Troca o erro técnico pela frase da tela, deixando o técnico no log (nunca o texto falado). */
async function comFrase<T>(onde: string, eu: number, fazer: () => Promise<T>): Promise<T> {
  const { ErroDaIa } = await import("@/lib/ia.server");
  try {
    return await fazer();
  } catch (e) {
    if (e instanceof ErroDaIa) {
      console.error(`[rv-cards] ${onde} falhou para ${eu}: ${e.message}`);
      throw new Error(e.paraTela);
    }
    throw e;
  }
}

const texto = (v: unknown, teto: number) => (typeof v === "string" ? v.trim().slice(0, teto) : "");

const nomesDaEntrada = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .slice(0, 30)
        .map((n) => texto(n, 60))
        .filter(Boolean)
    : [];

/* -------------------- Ouvir -------------------- */

type EntradaFala = { audio: string; mime: string; nomes: string[]; falaMs: number };

export const transcreverFalaDaSala = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: { audio: string; mime: string; nomes?: string[]; falaMs?: number }): EntradaFala => {
        // Mesmo formato de `transcreverVoz`: base64 puro ou data URL, mime de áudio.
        const audio = typeof e?.audio === "string" ? e.audio.replace(/^data:[^,]*,/, "") : "";
        if (!audio) throw new Error("Trecho de áudio vazio");
        if (audio.length > MAX_BASE64) throw new Error("Trecho de áudio longo demais");
        if (!/^[A-Za-z0-9+/=]+$/.test(audio)) throw new Error("Áudio em formato inválido");
        const mime = texto(e?.mime, 60) || "audio/webm";
        if (!mime.startsWith("audio/")) throw new Error("Áudio em formato inválido");
        const falaMs =
          typeof e?.falaMs === "number" && Number.isFinite(e.falaMs) && e.falaMs >= 0
            ? Math.min(e.falaMs, 60_000)
            : 0;
        return { audio, mime, nomes: nomesDaEntrada(e?.nomes), falaMs };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaFala): Promise<{ texto: string }> => {
      const t0 = Date.now();
      conferirLimite(
        "rv-fala-chamadas",
        eu,
        1,
        TETO.transcricoesPorHora,
        "Limite de transcrições da sala atingido nesta hora.",
      );
      conferirLimite(
        "rv-fala-ms",
        eu,
        // O maior entre o piso de 1 s, o que o cliente diz e o que o tamanho do áudio garante.
        Math.max(1000, d.falaMs, msMinimosDoAudio(d.audio.length)),
        TETO.falaMsPorHora,
        "Limite de 40 minutos de fala por hora atingido nos cards.",
      );
      return comFrase("transcrição", eu, async () => {
        const { ErroDaIa } = await import("@/lib/ia.server");
        const { SEM_CHAVE_DE_IA } = await import("@/lib/rv-cards.server");
        // Sem chave: frase própria, para a tela dizer "reinicie o servidor".
        if (!process.env.OPENAI_API_KEY) throw new ErroDaIa(SEM_CHAVE_DE_IA, "sem OPENAI_API_KEY");
        const { transcreverTrecho } = await import("@/lib/voz.server");
        const ouvido = await transcreverTrecho({
          apiKey: process.env.OPENAI_API_KEY,
          audio: Buffer.from(d.audio, "base64"),
          mime: d.mime,
          nomes: d.nomes,
          contexto: "reuniao",
          falaMs: d.falaMs,
        });
        console.info(`[rv-fala] ${eu}: ${Math.round(d.falaMs)} ms ${Date.now() - t0}`);
        return { texto: ouvido };
      });
    }),
  );

/* -------------------- Entender -------------------- */

type EntradaFrase = { frase: string; quem: string; participantes: string[]; anterior: string };

export const interpretarFraseDaSala = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        frase: string;
        quem: string;
        participantes?: string[];
        anterior?: string;
      }): EntradaFrase => {
        const frase = texto(e?.frase, 1500);
        if (!frase) throw new Error("Frase vazia");
        return {
          frase,
          quem: texto(e?.quem, 60) || "Alguém",
          participantes: nomesDaEntrada(e?.participantes),
          anterior: texto(e?.anterior, 600),
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaFrase): Promise<{ card: CardDaSala }> => {
      if (cardEmAndamento.has(eu)) throw new Error("Ainda estou preparando o card anterior.");
      conferirLimite(
        "rv-card",
        eu,
        1,
        TETO.cardsPorHora,
        "Limite de cards da sala atingido nesta hora.",
      );
      cardEmAndamento.add(eu);
      const t0 = Date.now();
      try {
        return await comFrase("card", eu, async () => {
          const { cardDaFrase } = await import("@/lib/rv-cards.server");
          const r = await cardDaFrase({
            apiKey: process.env.CLAUDE_API_KEY,
            quem: d.quem,
            frase: d.frase,
            participantes: d.participantes,
            anterior: d.anterior || undefined,
          });
          // Tokens e tempo para acompanhar o custo real; o conteúdo da fala, nunca.
          console.info(
            `[rv-card] ${eu}: ${r.tokens.entrada} in / ${r.tokens.saida} out ${Date.now() - t0}`,
          );
          return { card: r.card };
        });
      } finally {
        cardEmAndamento.delete(eu);
      }
    }),
  );
