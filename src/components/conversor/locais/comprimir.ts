import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "pdf-lib";
import { formatBytes } from "@/lib/attachments";
import { ErroDeConversao, type AoExecutar, type OpcoesDoBloco, type Resultado } from "../tipos";
import {
  blobDe,
  bytesDe,
  canvasParaBlob,
  liberarCanvas,
  nomeBase,
  pararSeCancelado,
  respirar,
} from "./arquivos";
import { carregar } from "./pdf";
import { abrirNoPdfjs } from "./pdfjs";

/*
 * Comprimir PDF (11/11/2026), no computador da pessoa e sem biblioteca nova.
 *
 * - Leve: o texto continua texto. Só as imagens JPEG de dentro do PDF (foto, página
 *   digitalizada) são regravadas menores. As outras ficam como estão, e cada uma só
 *   é trocada se a nova sair menor.
 * - Forte: cada página é desenhada (pdf.js) e volta como uma imagem JPEG, no mesmo
 *   tamanho de página. Encolhe muito o PDF digitalizado, mas o texto deixa de ser
 *   selecionável, e links e campos se perdem.
 *
 * Nos dois, o resultado só sai se for menor que o original — senão a frase diz que o
 * PDF já está leve, como faz o "Reduzir imagem".
 */

const TIPO_PDF = "application/pdf";
const nome = (s: string) => PDFName.of(s);

/** Leve: lado maior de cada imagem. 1800 px numa página A4 inteira dá ~150 dpi, legível. */
const LADO_MAXIMO_LEVE = 1800;
const QUALIDADE_LEVE = 0.72;
/** Imagem menor que isto não compensa o trabalho. */
const BYTES_MINIMOS_PARA_MEXER = 40 * 1024;
/** Só troca a imagem se a nova ficar ao menos 10% menor. */
const GANHO_MINIMO = 0.9;

/** Forte: as páginas a ~110 dpi, com teto de pixels, em JPEG. */
const DPI_FORTE = 110;
const LADO_MAXIMO_FORTE = 2000;
const QUALIDADE_FORTE = 0.6;
/** Cada página vira um JPEG que fica na memória até salvar: acima disto, o nível Leve. */
export const MAXIMO_DE_PAGINAS_NO_FORTE = 300;

export async function comprimirPdf(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const nivel = opcoes.nivelDeCompressao ?? "leve";
  const blob =
    nivel === "forte" ? await comprimirForte(arquivo, ao) : await comprimirLeve(arquivo, ao);
  if (blob.size >= arquivo.size) {
    throw new ErroDeConversao(
      nivel === "leve"
        ? "Este PDF já está leve: o nível Leve não conseguiu diminuir. O Forte pode diminuir, mas o texto vira imagem."
        : "Este PDF já está leve: comprimir não diminuiu o arquivo.",
      "JA_LEVE",
    );
  }
  const menor = Math.round((1 - blob.size / arquivo.size) * 100);
  return {
    arquivos: [{ nome: `${nomeBase(arquivo.name)}-comprimido.pdf`, blob }],
    resumo: `De ${formatBytes(arquivo.size)} para ${formatBytes(blob.size)} (${menor}% menor)`,
  };
}

/* ---------------------------------- Leve ---------------------------------- */

/** O espaço de cor da imagem é RGB ou cinza (direto, ou por um perfil ICC de 3 ou 1 canal)? */
function corQueDaParaMexer(dict: PDFDict): boolean {
  const cor = dict.lookup(nome("ColorSpace"));
  if (cor === nome("DeviceRGB") || cor === nome("DeviceGray")) return true;
  if (cor instanceof PDFArray && cor.size() === 2 && cor.lookup(0) === nome("ICCBased")) {
    const perfil = cor.lookup(1);
    const canais = perfil instanceof PDFStream ? perfil.dict.lookup(nome("N")) : undefined;
    return canais instanceof PDFNumber && (canais.asNumber() === 3 || canais.asNumber() === 1);
  }
  return false;
}

/**
 * Uma imagem que dá para regravar sem risco: JPEG puro (só o filtro DCTDecode), 8 bits,
 * RGB ou cinza, sem /Decode (que inverteria as cores) e que não seja máscara de ninguém.
 * CMYK, JPEG 2000, preto e branco de multifuncional (JBIG2, CCITT) e imagem sem
 * compressão ficam como estão.
 */
function jpegQueDaParaMexer(dict: PDFDict): boolean {
  const filtro = dict.lookup(nome("Filter"));
  const soDct =
    filtro === nome("DCTDecode") ||
    (filtro instanceof PDFArray && filtro.size() === 1 && filtro.lookup(0) === nome("DCTDecode"));
  if (!soDct) return false;
  if (dict.has(nome("ImageMask")) || dict.has(nome("Decode"))) return false;
  const bits = dict.lookup(nome("BitsPerComponent"));
  if (bits instanceof PDFNumber && bits.asNumber() !== 8) return false;
  return corQueDaParaMexer(dict);
}

async function comprimirLeve(arquivo: File, ao: AoExecutar): Promise<Blob> {
  const doc = await carregar(arquivo);
  const ctx = doc.context;

  // As imagens do documento, e as que servem de máscara de outra (essas não mudam).
  const imagens: [PDFRef, PDFRawStream][] = [];
  const mascaras = new Set<string>();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.lookup(nome("Subtype")) !== nome("Image")) continue;
    imagens.push([ref, obj]);
    const mascara = obj.dict.get(nome("SMask"));
    if (mascara instanceof PDFRef) mascaras.add(mascara.toString());
  }

  for (const [i, [ref, stream]] of imagens.entries()) {
    pararSeCancelado(ao.sinal);
    if (!mascaras.has(ref.toString()) && jpegQueDaParaMexer(stream.dict)) {
      const novo = await regravarJpeg(stream.contents);
      if (novo) {
        const dict = stream.dict.clone(ctx);
        dict.set(nome("Width"), PDFNumber.of(novo.largura));
        dict.set(nome("Height"), PDFNumber.of(novo.altura));
        // O JPEG do navegador sai sempre em RGB, até o de uma imagem cinza.
        dict.set(nome("ColorSpace"), nome("DeviceRGB"));
        dict.set(nome("BitsPerComponent"), PDFNumber.of(8));
        dict.set(nome("Filter"), nome("DCTDecode"));
        dict.delete(nome("DecodeParms"));
        // O /Length é refeito pelo pdf-lib ao salvar, pelo tamanho do conteúdo novo.
        ctx.assign(ref, PDFRawStream.of(dict, novo.bytes));
      }
    }
    // O último pedaço da barra é o salvar.
    ao.progresso(((i + 1) / (imagens.length + 1)) * 0.9);
    await respirar();
  }

  pararSeCancelado(ao.sinal);
  const bytes = await doc.save({ useObjectStreams: true });
  ao.progresso(1);
  return blobDe(bytes, TIPO_PDF);
}

/** Regrava um JPEG menor (lado e qualidade). `null` = não compensa, fica o original. */
async function regravarJpeg(
  original: Uint8Array,
): Promise<{ bytes: Uint8Array; largura: number; altura: number } | null> {
  if (original.length < BYTES_MINIMOS_PARA_MEXER) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blobDe(original, "image/jpeg"));
  } catch {
    return null; // o navegador não abriu este JPEG: fica como está
  }
  const canvas = document.createElement("canvas");
  try {
    const escala = Math.min(1, LADO_MAXIMO_LEVE / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    canvas.width = largura;
    canvas.height = altura;
    const c = canvas.getContext("2d");
    if (!c) return null;
    c.imageSmoothingQuality = "high";
    c.drawImage(bitmap, 0, 0, largura, altura);
    const novo = await canvasParaBlob(canvas, "image/jpeg", QUALIDADE_LEVE);
    if (novo.size >= original.length * GANHO_MINIMO) return null;
    return { bytes: await bytesDe(novo), largura, altura };
  } finally {
    bitmap.close();
    liberarCanvas(canvas);
  }
}

/* ---------------------------------- Forte --------------------------------- */

async function comprimirForte(arquivo: File, ao: AoExecutar): Promise<Blob> {
  // O pdf-lib primeiro: as mesmas recusas dos outros blocos (não é PDF, protegido, vazio).
  const total = (await carregar(arquivo)).getPageCount();
  if (total > MAXIMO_DE_PAGINAS_NO_FORTE) {
    throw new ErroDeConversao(
      `Este PDF tem ${total} páginas; no nível Forte o limite é ${MAXIMO_DE_PAGINAS_NO_FORTE}. Use o Leve, ou separe as páginas antes.`,
      "PAGINAS_DEMAIS",
    );
  }
  const pdf = await abrirNoPdfjs(await bytesDe(arquivo), arquivo.name);
  try {
    const saida = await PDFDocument.create();
    for (let i = 0; i < total; i++) {
      pararSeCancelado(ao.sinal);
      const pagina = await pdf.getPage(i + 1);
      try {
        // Em pontos do PDF e já de pé (o pdf.js aplica o giro da página). O /UserUnit
        // (PDF de plotter) sai da conta, como em `editor/documento.ts`.
        const unidade = pagina.userUnit || 1;
        const emPontos = pagina.getViewport({ scale: 1 / unidade });
        const escala = Math.min(
          DPI_FORTE / 72,
          LADO_MAXIMO_FORTE / Math.max(emPontos.width, emPontos.height),
        );
        const viewport = pagina.getViewport({ scale: escala / unidade });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        // JPEG não tem transparência: o fundo vazio sairia preto.
        const c = canvas.getContext("2d");
        if (c) {
          c.fillStyle = "#ffffff";
          c.fillRect(0, 0, canvas.width, canvas.height);
        }
        await pagina.render({ canvas, viewport }).promise;
        const jpeg = await canvasParaBlob(canvas, "image/jpeg", QUALIDADE_FORTE);
        liberarCanvas(canvas);
        const imagem = await saida.embedJpg(await bytesDe(jpeg));
        const nova = saida.addPage([emPontos.width, emPontos.height]);
        nova.drawImage(imagem, { x: 0, y: 0, width: emPontos.width, height: emPontos.height });
      } finally {
        pagina.cleanup();
      }
      ao.progresso((i + 1) / (total + 1));
      await respirar();
    }
    pararSeCancelado(ao.sinal);
    const bytes = await saida.save({ useObjectStreams: true });
    ao.progresso(1);
    return blobDe(bytes, TIPO_PDF);
  } finally {
    // No pdf.js 6 quem solta o documento e o worker é a tarefa que o carregou.
    void pdf.loadingTask.destroy();
  }
}
