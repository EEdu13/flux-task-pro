import {
  ErroDeConversao,
  type AoExecutar,
  type FormatoDeImagem,
  type OpcoesDoBloco,
  type Resultado,
} from "../tipos";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "../falha-de-carregamento";
import { canvasParaBlob, extensaoDoNome, liberarCanvas, nomeBase } from "./arquivos";

/*
 * Conversões de imagem no navegador (04/11/2026): converter entre HEIC, PNG,
 * JPG e WebP, e reduzir. É o canvas do próprio navegador que reamostra e
 * codifica; o HEIC (a foto do iPhone) o navegador não abre, e quem decodifica
 * é o heic2any, carregado só quando aparece um.
 */

const MIME: Record<FormatoDeImagem, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Reduzir: o lado maior vai a 1600 px. Foto de celular cai de ~4 MB para algumas centenas de KB e segue boa na tela e no e-mail. */
const LADO_REDUZIDO = 1600;

export function ehHeic(arquivo: File): boolean {
  const ext = extensaoDoNome(arquivo.name);
  return ext === "heic" || ext === "heif" || /^image\/hei[cf]/i.test(arquivo.type);
}

/**
 * A imagem pronta para desenhar, já de pé: `imageOrientation: "from-image"`
 * aplica a rotação EXIF da foto do celular (sem isso ela sai deitada).
 */
export async function decodificarImagem(arquivo: File): Promise<ImageBitmap> {
  if (ehHeic(arquivo)) {
    let heic2any: (typeof import("heic2any"))["default"];
    try {
      ({ default: heic2any } = await import("heic2any"));
    } catch (e) {
      // Deploy no meio: o arquivo do heic2any mudou de nome. Não é problema da foto.
      if (ehFalhaDeCarregamento(e)) {
        throw new ErroDeConversao(MENSAGEM_DE_ATUALIZACAO, "ATUALIZADO");
      }
      throw e;
    }
    try {
      const r = await heic2any({ blob: arquivo, toType: "image/jpeg", quality: 0.95 });
      return await createImageBitmap(Array.isArray(r) ? r[0]! : r);
    } catch {
      /* Há ".heic" que por dentro é JPEG ou PNG (a foto passou por outro app
         e só o nome ficou): o heic2any recusa — "já é legível pelo navegador" —
         e o navegador abre. Cai no caminho comum abaixo. */
    }
  }
  try {
    return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new ErroDeConversao(
      `Não consegui abrir “${arquivo.name}” como imagem.`,
      "IMAGEM_INVALIDA",
    );
  }
}

/**
 * Desenha a imagem num canvas, encolhendo até `ladoMaximo` (nunca aumenta).
 * `fundoBranco`: JPG não tem transparência, e sem fundo o transparente vira preto.
 */
export function desenharImagem(
  bitmap: ImageBitmap,
  ladoMaximo: number,
  fundoBranco: boolean,
): HTMLCanvasElement {
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ErroDeConversao("O navegador não conseguiu desenhar a imagem.", "CANVAS");
  if (fundoBranco) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Algum pixel não é opaco? (Para PNG/WebP com transparência continuarem PNG ao reduzir.) */
function temTransparencia(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

export async function converterImagem(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const formato = opcoes.formato ?? "jpg";
  const bitmap = await decodificarImagem(arquivo);
  ao.progresso(0.5);
  try {
    const canvas = desenharImagem(bitmap, Number.POSITIVE_INFINITY, formato === "jpg");
    const blob = await canvasParaBlob(canvas, MIME[formato], formato === "png" ? undefined : 0.92);
    liberarCanvas(canvas);
    ao.progresso(1);
    /* Mesmo formato de entrada e de saída (JPG → JPG): o nome ganha um sufixo
       para não brigar com o original na pasta de Downloads. */
    const extOriginal = extensaoDoNome(arquivo.name).replace("jpeg", "jpg");
    const sufixo = extOriginal === formato ? "-convertida" : "";
    return { arquivos: [{ nome: `${nomeBase(arquivo.name)}${sufixo}.${formato}`, blob }] };
  } finally {
    bitmap.close();
  }
}

export async function reduzirImagem(arquivos: File[], ao: AoExecutar): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const bitmap = await decodificarImagem(arquivo);
  ao.progresso(0.4);
  try {
    /* PNG e WebP podem ter transparência: se tiverem, ela é mantida — o PNG
       continua PNG, o WebP continua WebP (que guarda a transparência com
       perda e encolhe de verdade, ao contrário de refazer em PNG). O resto —
       foto, HEIC, JPG — vira JPG, que é o que mais encolhe. */
    const ext = extensaoDoNome(arquivo.name);
    let canvas = desenharImagem(bitmap, LADO_REDUZIDO, false);
    const transparente = (ext === "png" || ext === "webp") && temTransparencia(canvas);
    if (!transparente) {
      liberarCanvas(canvas);
      canvas = desenharImagem(bitmap, LADO_REDUZIDO, true);
    }
    const formato: FormatoDeImagem = transparente ? (ext === "webp" ? "webp" : "png") : "jpg";
    const blob = await canvasParaBlob(canvas, MIME[formato], formato === "png" ? undefined : 0.82);
    liberarCanvas(canvas);
    ao.progresso(1);
    if (blob.size >= arquivo.size) {
      throw new ErroDeConversao(
        "Esta imagem já está leve: reduzir não diminuiu o arquivo.",
        "JA_LEVE",
      );
    }
    return { arquivos: [{ nome: `${nomeBase(arquivo.name)}-reduzida.${formato}`, blob }] };
  } finally {
    bitmap.close();
  }
}
