import type { Worker } from "tesseract.js";
import { ErroDeConversao } from "../tipos";
import { ateCancelar } from "./arquivos";

/*
 * O leitor do Tesseract (`tesseract.js`, Apache-2.0), aberto do mesmo jeito pelo OCR (`ocr.ts`) e pela
 * tabela em imagem do PDF → Excel (`tabela-em-imagem.ts`) — separado do `ocr.ts` em 23/11/2026.
 *
 * O Tesseract é servido pelo nosso domínio, de `public/tesseract/` (copiado por
 * `scripts/copiar-tesseract.mjs`): nada de CDN. O padrão dele seria baixar o motor e o idioma de um
 * CDN; por isso os três caminhos vão explícitos. O idioma fica guardado no navegador depois da
 * primeira vez.
 */

/**
 * Prazo para um leitor abrir (motor e idioma baixados na primeira vez, numa rede lenta). Passou
 * disto, não vai abrir: com o arquivo do idioma faltando, o tesseract.js fica parado em vez de
 * falhar (visto em 12/11/2026), e a pessoa esperaria para sempre.
 */
export const PRAZO_PARA_ABRIR_MS = 120_000;

/** A promessa, ou o erro de `erro()` se ela passar de `ms`. */
export function comPrazo<T>(promessa: Promise<T>, ms: number, erro: () => Error): Promise<T> {
  return new Promise((ok, falha) => {
    const relogio = setTimeout(() => falha(erro()), ms);
    promessa.then(
      (v) => {
        clearTimeout(relogio);
        ok(v);
      },
      (e: unknown) => {
        clearTimeout(relogio);
        falha(e);
      },
    );
  });
}

/** Quantos leitores em paralelo: metade dos núcleos, até 4, menos se a memória for pouca. */
export function quantosLeitores(tarefas: number): number {
  const nucleos = navigator.hardwareConcurrency || 2;
  // `deviceMemory` (GB) só existe no Chromium, que é o Chrome, o Edge e o app de mesa.
  const memoria = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const pelaMemoria = memoria <= 4 ? 2 : 4;
  return Math.max(1, Math.min(4, Math.floor(nucleos / 2), pelaMemoria, tarefas));
}

export type MensagemDoLeitor = { status: string; progress: number; userJobId?: string };

/**
 * Abre um leitor (o motor LSTM) no idioma pedido. Cancelado (ou passado do prazo) enquanto o
 * Tesseract carregava, ele termina de abrir sozinho e é encerrado ali.
 */
export async function abrirLeitor(
  idiomas: string | string[],
  sinal?: AbortSignal,
  aoAndar?: (m: MensagemDoLeitor) => void,
): Promise<Worker> {
  const { createWorker, OEM } = await import("tesseract.js");
  let desistiu = false;
  const criando = createWorker(idiomas, OEM.LSTM_ONLY, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    workerBlobURL: false,
    ...(aoAndar ? { logger: aoAndar } : {}),
  });
  criando.then(
    (w) => {
      if (sinal?.aborted || desistiu) void w.terminate();
    },
    () => {},
  );
  const noPrazo = comPrazo(criando, PRAZO_PARA_ABRIR_MS, () => {
    desistiu = true;
    return new ErroDeConversao(
      "O leitor de OCR não abriu. Recarregue a página e tente de novo.",
      "OCR_NAO_ABRIU",
    );
  });
  return ateCancelar(noPrazo, sinal);
}
