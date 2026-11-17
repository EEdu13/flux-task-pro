import { ErroDeConversao } from "../tipos";

/*
 * Peças pequenas das conversões locais (04/11/2026). Tudo aqui roda no
 * navegador: nenhum byte vai ao servidor.
 */

/** "Foto.HEIC" → "heic"; sem ponto → "". (O mesmo de `extensaoDe` em `blocos.ts`, sem puxar o catálogo.) */
export function extensaoDoNome(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(i + 1).toLowerCase() : "";
}

/** "Contrato Final.pdf" → "Contrato Final". */
export function nomeBase(nome: string): string {
  const i = nome.lastIndexOf(".");
  const base = (i > 0 ? nome.slice(0, i) : nome).trim();
  return base || "arquivo";
}

/** AAAA-MM-DD no relógio de quem está usando — é o dia que a pessoa vê. */
export function hojeAAAAMMDD(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * "01", "02"… com os dígitos do total (no mínimo dois), para os arquivos
 * saírem em ordem na pasta: sem isso o Windows põe a página 10 antes da 2.
 */
export function numeroDaPagina(indice: number, total: number): string {
  return String(indice + 1).padStart(Math.max(2, String(total).length), "0");
}

export async function bytesDe(arquivo: Blob): Promise<Uint8Array> {
  return new Uint8Array(await arquivo.arrayBuffer());
}

/** O TypeScript 5.9 pede a conversão para aceitar `Uint8Array` no `Blob` (o mesmo de `planilha-xlsx.ts`). */
export function blobDe(bytes: Uint8Array, tipo: string): Blob {
  return new Blob([bytes as BlobPart], { type: tipo });
}

/**
 * É PDF pelos bytes, não pelo nome: a assinatura "%PDF-" vem no começo — a
 * norma tolera até 1024 bytes de lixo antes dela, e há gerador que põe.
 */
export function pareceSerPdf(bytes: Uint8Array): boolean {
  const ultimo = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= ultimo; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/** Para entre um passo e outro quando a pessoa cancelou. */
export function pararSeCancelado(sinal?: AbortSignal): void {
  if (sinal?.aborted) throw new ErroDeConversao("Conversão cancelada.", "CANCELADA");
}

/**
 * Espera a promessa, mas desiste na hora em que a pessoa cancela (11/11/2026). Para o trabalho que
 * corre fora da página e não sabe parar no meio — o Office no app, o Tesseract no worker: o
 * Tesseract encerrado no meio de uma leitura deixava a promessa dela pendurada para sempre.
 */
export function ateCancelar<T>(promessa: Promise<T>, sinal?: AbortSignal): Promise<T> {
  if (!sinal) return promessa;
  return new Promise<T>((resolve, reject) => {
    const cancelar = () => reject(new ErroDeConversao("Conversão cancelada.", "CANCELADA"));
    if (sinal.aborted) {
      cancelar();
      return;
    }
    sinal.addEventListener("abort", cancelar, { once: true });
    void promessa.then(resolve, reject).finally(() => sinal.removeEventListener("abort", cancelar));
  });
}

/** Devolve a vez ao navegador entre um passo pesado e outro: a barra de progresso anda e a tela não congela. */
export function respirar(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** `canvas.toBlob` como promessa; o `null` que ele devolve quando falha vira frase. */
export function canvasParaBlob(
  canvas: HTMLCanvasElement,
  tipo: string,
  qualidade?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new ErroDeConversao("O navegador não conseguiu gerar a imagem.", "CANVAS")),
      tipo,
      qualidade,
    ),
  );
}

/** Solta a memória de um canvas grande na hora, sem esperar o coletor de lixo. */
export function liberarCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
