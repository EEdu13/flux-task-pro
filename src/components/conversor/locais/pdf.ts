import { degrees, PDFDocument } from "pdf-lib";
import {
  ErroDeConversao,
  type AoExecutar,
  type OpcoesDoBloco,
  type Resultado,
  type Saida,
} from "../tipos";
import {
  blobDe,
  bytesDe,
  canvasParaBlob,
  hojeAAAAMMDD,
  liberarCanvas,
  nomeBase,
  numeroDaPagina,
  pararSeCancelado,
  pareceSerPdf,
  respirar,
} from "./arquivos";
import { decodificarImagem, desenharImagem } from "./imagem";
import { abrirNoPdfjs } from "./pdfjs";

/*
 * As conversões de PDF que rodam no navegador (04/11/2026). O pdf-lib mexe no
 * arquivo (juntar, separar, girar, montar PDF de imagens) sem redesenhar nada:
 * o texto continua texto e a qualidade não muda. Só o "PDF → imagens" desenha
 * as páginas, com o pdf.js.
 */

const TIPO_PDF = "application/pdf";

/**
 * PDF → imagens: acima disto a memória do navegador sofre — cada página vira
 * um PNG de alguns MB, e todos ficam na memória até a entrega.
 */
export const MAXIMO_DE_PAGINAS_EM_IMAGEM = 100;

/** Imagens → PDF: A4 em pontos, margem de 1/3 de polegada. */
const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 24;
/** Lado maior da imagem dentro do PDF: legível impresso em A4 e sem inflar o arquivo. */
const LADO_NO_PDF = 2400;

/**
 * Abre o PDF no pdf-lib. Recusa com frase o que não é PDF e o PDF protegido —
 * o pdf-lib não decifra, e copiar páginas cifradas daria páginas em branco.
 * Exportado para o Comprimir (11/11/2026), que recusa os mesmos casos.
 */
export async function carregar(arquivo: File): Promise<PDFDocument> {
  const bytes = await bytesDe(arquivo);
  if (!pareceSerPdf(bytes)) {
    throw new ErroDeConversao(`“${arquivo.name}” não é um PDF.`, "NAO_E_PDF");
  }
  let doc: PDFDocument;
  let paginas: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    /* O pdf-lib aceita sem reclamar um arquivo que só COMEÇA como PDF; o
       defeito aparecia depois, ao copiar as páginas, como erro em inglês
       (teste de 05/11/2026). Contar as páginas aqui traz o erro para a hora
       certa, com a frase certa. */
    paginas = doc.isEncrypted ? 1 : doc.getPageCount();
  } catch {
    throw new ErroDeConversao(
      `Não consegui ler “${arquivo.name}”. O arquivo pode estar corrompido.`,
      "PDF_INVALIDO",
    );
  }
  if (doc.isEncrypted) {
    throw new ErroDeConversao(
      `“${arquivo.name}” está protegido (senha ou bloqueio de cópia). Tire a proteção e tente de novo.`,
      "PDF_PROTEGIDO",
    );
  }
  if (paginas === 0) {
    throw new ErroDeConversao(`“${arquivo.name}” não tem nenhuma página.`, "PDF_SEM_PAGINAS");
  }
  return doc;
}

async function salvar(doc: PDFDocument): Promise<Blob> {
  return blobDe(await doc.save(), TIPO_PDF);
}

export async function juntarPdfs(arquivos: File[], ao: AoExecutar): Promise<Resultado> {
  if (arquivos.length < 2) {
    throw new ErroDeConversao("Escolha pelo menos dois PDFs para juntar.", "POUCOS_ARQUIVOS");
  }
  const saida = await PDFDocument.create();
  for (const [i, arquivo] of arquivos.entries()) {
    pararSeCancelado(ao.sinal);
    const doc = await carregar(arquivo);
    const paginas = await saida.copyPages(doc, doc.getPageIndices());
    for (const p of paginas) saida.addPage(p);
    // O último pedaço da barra é o salvar, que também pesa.
    ao.progresso((i + 1) / (arquivos.length + 1));
    await respirar();
  }
  pararSeCancelado(ao.sinal);
  const blob = await salvar(saida);
  ao.progresso(1);
  return { arquivos: [{ nome: `juntado-${hojeAAAAMMDD()}.pdf`, blob }] };
}

export async function separarPaginas(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const doc = await carregar(arquivo);
  const total = doc.getPageCount();
  const escolhidas = (opcoes.paginas ?? []).filter((i) => i >= 0 && i < total);
  if (escolhidas.length === 0) {
    throw new ErroDeConversao("Escolha pelo menos uma página.", "SEM_PAGINAS");
  }
  const base = nomeBase(arquivo.name);

  if (opcoes.modoDeSeparar === "um-por-pagina") {
    const saidas: Saida[] = [];
    for (const [n, indice] of escolhidas.entries()) {
      pararSeCancelado(ao.sinal);
      const novo = await PDFDocument.create();
      const [pagina] = await novo.copyPages(doc, [indice]);
      novo.addPage(pagina!);
      saidas.push({
        nome: `${base}-p${numeroDaPagina(indice, total)}.pdf`,
        blob: await salvar(novo),
      });
      ao.progresso((n + 1) / escolhidas.length);
      await respirar();
    }
    return { arquivos: saidas, pacote: `${base}-paginas.zip` };
  }

  const novo = await PDFDocument.create();
  for (const p of await novo.copyPages(doc, escolhidas)) novo.addPage(p);
  ao.progresso(0.7);
  pararSeCancelado(ao.sinal);
  const blob = await salvar(novo);
  ao.progresso(1);
  return { arquivos: [{ nome: `${base}-paginas.pdf`, blob }] };
}

export async function girarPaginas(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const giros = Object.entries(opcoes.giros ?? {}).filter(([, g]) => g % 360 !== 0);
  if (giros.length === 0) {
    throw new ErroDeConversao("Nenhuma página foi girada.", "SEM_GIRO");
  }
  const doc = await carregar(arquivo);
  const paginas = doc.getPages();
  for (const [indice, giro] of giros) {
    const p = paginas[Number(indice)];
    if (!p) continue;
    // O giro soma ao que a página já tinha (há PDF com página guardada "de lado").
    p.setRotation(degrees((((p.getRotation().angle + giro) % 360) + 360) % 360));
  }
  ao.progresso(0.6);
  pararSeCancelado(ao.sinal);
  const blob = await salvar(doc);
  ao.progresso(1);
  return { arquivos: [{ nome: `${nomeBase(arquivo.name)}-girado.pdf`, blob }] };
}

export async function pdfParaImagens(arquivos: File[], ao: AoExecutar): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const bytes = await bytesDe(arquivo);
  if (!pareceSerPdf(bytes)) {
    throw new ErroDeConversao(`“${arquivo.name}” não é um PDF.`, "NAO_E_PDF");
  }
  const pdf = await abrirNoPdfjs(bytes, arquivo.name);
  try {
    const total = pdf.numPages;
    if (total > MAXIMO_DE_PAGINAS_EM_IMAGEM) {
      throw new ErroDeConversao(
        `Este PDF tem ${total} páginas; aqui o limite é ${MAXIMO_DE_PAGINAS_EM_IMAGEM}. Separe as páginas antes.`,
        "PAGINAS_DEMAIS",
      );
    }
    const base = nomeBase(arquivo.name);
    const saidas: Saida[] = [];
    for (let i = 0; i < total; i++) {
      pararSeCancelado(ao.sinal);
      const pagina = await pdf.getPage(i + 1);
      const natural = pagina.getViewport({ scale: 1 });
      /* Escala 2 (~144 dpi): legível, e um A4 sai com ~1190×1684 px. O teto de
         4000 px no lado maior segura as plantas e os PDFs em A0. */
      const escala = Math.min(2, 4000 / Math.max(natural.width, natural.height));
      const viewport = pagina.getViewport({ scale: escala });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await pagina.render({ canvas, viewport }).promise;
      const blob = await canvasParaBlob(canvas, "image/png");
      liberarCanvas(canvas);
      pagina.cleanup();
      saidas.push({
        nome: total === 1 ? `${base}.png` : `${base}-p${numeroDaPagina(i, total)}.png`,
        blob,
      });
      ao.progresso((i + 1) / total);
    }
    return { arquivos: saidas, pacote: `${base}-imagens.zip` };
  } finally {
    // No pdf.js 6 quem solta o documento e o worker é a tarefa que o carregou.
    void pdf.loadingTask.destroy();
  }
}

export async function imagensParaPdf(arquivos: File[], ao: AoExecutar): Promise<Resultado> {
  const doc = await PDFDocument.create();
  for (const [i, arquivo] of arquivos.entries()) {
    pararSeCancelado(ao.sinal);
    /* Passa pelo canvas em vez de embutir os bytes como vieram: é o que
       endireita a foto do celular (rotação EXIF) e encolhe a de 12 MP. PNG
       continua PNG, para não perder a transparência. */
    const bitmap = await decodificarImagem(arquivo);
    const png = arquivo.type === "image/png" || /\.png$/i.test(arquivo.name);
    try {
      const canvas = desenharImagem(bitmap, LADO_NO_PDF, !png);
      const blob = await canvasParaBlob(
        canvas,
        png ? "image/png" : "image/jpeg",
        png ? undefined : 0.9,
      );
      liberarCanvas(canvas);
      const bytes = await bytesDe(blob);
      const imagem = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      // Página A4 deitada para imagem deitada; a imagem ocupa o que der dentro da margem.
      const deitada = imagem.width > imagem.height;
      const largura = deitada ? A4.altura : A4.largura;
      const altura = deitada ? A4.largura : A4.altura;
      const escala = Math.min(
        (largura - 2 * MARGEM) / imagem.width,
        (altura - 2 * MARGEM) / imagem.height,
      );
      const w = imagem.width * escala;
      const h = imagem.height * escala;
      const pagina = doc.addPage([largura, altura]);
      pagina.drawImage(imagem, { x: (largura - w) / 2, y: (altura - h) / 2, width: w, height: h });
    } finally {
      bitmap.close();
    }
    ao.progresso((i + 1) / (arquivos.length + 1));
    await respirar();
  }
  pararSeCancelado(ao.sinal);
  const blob = await salvar(doc);
  ao.progresso(1);
  const nome =
    arquivos.length === 1 ? `${nomeBase(arquivos[0]!.name)}.pdf` : `imagens-${hojeAAAAMMDD()}.pdf`;
  return { arquivos: [{ nome, blob }] };
}
