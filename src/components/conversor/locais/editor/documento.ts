import { PDFDocument, type PDFPage } from "pdf-lib";
import { ErroDeConversao } from "../../tipos";
import { bytesDe, pareceSerPdf } from "../arquivos";
import { abrirNoPdfjs } from "../pdfjs";
import type { CacheDeFontes } from "./fontes";
import {
  cortarPorEstilo,
  juntarPorEspacos,
  linhasDoTexto,
  type LinhaDeTexto,
  type TextoDoPdfjs,
} from "./linhas";
import { analisarPagina, fontesDaPagina, somarCodigosUsados, type CodigosUsados } from "./pagina";

/*
 * Um PDF aberto no Editor (05/11/2026): o pdf.js para desenhar e ler o texto, e o
 * pdf-lib para olhar as fontes e o conteúdo. Este pdf-lib nunca é alterado: cada
 * prévia copia a página para um documento à parte, e salvar carrega o arquivo de
 * novo. Assim desfazer é só esquecer uma edição, sem nada a reverter no arquivo.
 */

/** O quanto olhar do documento atrás das letras de cada fonte. Depois disso, fica com o que já achou. */
const PAGINAS_PARA_OLHAR = 400;
const TEMPO_PARA_OLHAR_MS = 1500;

type Pdfjs = Awaited<ReturnType<typeof abrirNoPdfjs>>;
export type PaginaPdfjs = Awaited<ReturnType<Pdfjs["getPage"]>>;

/**
 * A página em pontos do PDF. O pdf.js multiplica por `/UserUnit` (PDF de plotter), e as
 * coordenadas do conteúdo e do pdf-lib não: sem dividir, os objetos saíam fora do lugar.
 */
export function viewportEmPontos(p: PaginaPdfjs, escala = 1) {
  return p.getViewport({ scale: escala / (p.userUnit || 1) });
}

/** O tamanho da página na tela, em pontos, já com o giro que o próprio PDF traz. */
export type TamanhoDaPagina = { largura: number; altura: number };

export class DocumentoAberto {
  private lib: Promise<PDFDocument> | null = null;
  private readonly fontes: CacheDeFontes = new Map();
  private usados: Promise<CodigosUsados> | null = null;
  private readonly paginasSomadas = new Set<number>();
  private readonly linhasPorPagina = new Map<number, Promise<LinhaDeTexto[]>>();
  private fechado = false;

  private constructor(
    readonly nome: string,
    readonly bytes: Uint8Array,
    readonly pdf: Pdfjs,
    /** Os tamanhos de todas as páginas, em ordem. */
    readonly tamanhos: readonly TamanhoDaPagina[],
  ) {}

  static async abrir(arquivo: File): Promise<DocumentoAberto> {
    const bytes = await bytesDe(arquivo);
    if (!pareceSerPdf(bytes)) {
      throw new ErroDeConversao(`“${arquivo.name}” não é um PDF.`, "NAO_E_PDF");
    }
    const pdf = await abrirNoPdfjs(bytes, arquivo.name);
    try {
      const tamanhos: TamanhoDaPagina[] = [];
      // Em sequência: o pdf.js guarda as páginas já lidas, e assim a ordem é a do arquivo.
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const v = viewportEmPontos(p);
        tamanhos.push({ largura: v.width, altura: v.height });
      }
      return new DocumentoAberto(arquivo.name, bytes, pdf, tamanhos);
    } catch (e) {
      void pdf.loadingTask.destroy();
      throw e;
    }
  }

  get paginas(): number {
    return this.tamanhos.length;
  }

  /**
   * A página no pdf.js. `async` de propósito: com o documento fechado o pdf.js LANÇA na
   * hora, em vez de rejeitar, e dentro de um efeito do React isso derruba a tela inteira.
   */
  async pagina(indice: number): Promise<PaginaPdfjs> {
    if (this.fechado) throw new ErroDeConversao("O PDF já foi fechado.", "FECHADO");
    return this.pdf.getPage(indice + 1);
  }

  /** O documento no pdf-lib, só para leitura. Recusa com frase o que o pdf-lib não abre. */
  pdfLib(): Promise<PDFDocument> {
    this.lib ??= carregarNoPdfLib(this.bytes, this.nome);
    return this.lib;
  }

  private async paginaLib(indice: number): Promise<PDFPage> {
    return (await this.pdfLib()).getPage(indice);
  }

  /**
   * Quais letras de cada fonte o documento inteiro usa: uma fonte cortada só garante
   * essas. Olhar o documento todo, e não só a página, aumenta muito a chance de achar
   * a letra nova na própria fonte do PDF.
   */
  private codigosUsados(): Promise<CodigosUsados> {
    this.usados ??= (async () => {
      const doc = await this.pdfLib();
      const usados: CodigosUsados = new Map();
      const inicio = Date.now();
      const total = Math.min(doc.getPageCount(), PAGINAS_PARA_OLHAR);
      for (let i = 0; i < total; i++) {
        somarCodigosUsados(doc.getPage(i), this.fontes, usados);
        this.paginasSomadas.add(i);
        if (Date.now() - inicio > TEMPO_PARA_OLHAR_MS) break;
      }
      return usados;
    })();
    return this.usados;
  }

  /** As letras usadas no documento, pelo nome da fonte nos recursos da página `indice`. */
  async usadosDaPagina(
    indice: number,
  ): Promise<(nomeDoRecurso: string) => ReadonlySet<number> | undefined> {
    const [pagina, usados] = await Promise.all([this.paginaLib(indice), this.codigosUsados()]);
    // Passado o tempo de olhar o documento, a própria página ainda pode não ter entrado na soma.
    if (!this.paginasSomadas.has(indice)) {
      somarCodigosUsados(pagina, this.fontes, usados);
      this.paginasSomadas.add(indice);
    }
    const fonteDe = fontesDaPagina(pagina, this.fontes);
    return (nomeDoRecurso) => {
      const f = fonteDe(nomeDoRecurso);
      return f ? usados.get(f.chave) : undefined;
    };
  }

  /** As linhas editáveis da página, sempre as mesmas para a mesma página. */
  linhas(indice: number): Promise<LinhaDeTexto[]> {
    let lista = this.linhasPorPagina.get(indice);
    if (!lista) {
      lista = this.lerLinhas(indice);
      this.linhasPorPagina.set(indice, lista);
    }
    return lista;
  }

  private async lerLinhas(indice: number): Promise<LinhaDeTexto[]> {
    const pagina = await this.pagina(indice);
    const texto = (await pagina.getTextContent()) as unknown as TextoDoPdfjs;
    const cruas = linhasDoTexto(texto);
    let lida: ReturnType<typeof analisarPagina> = null;
    let fonteDe: ReturnType<typeof fontesDaPagina> | null = null;
    try {
      const pl = await this.paginaLib(indice);
      lida = analisarPagina(pl, this.fontes);
      fonteDe = fontesDaPagina(pl, this.fontes);
    } catch {
      // O pdf-lib não abriu: as linhas ficam como o pdf.js leu, e salvar dirá o motivo.
    }
    const linhas: LinhaDeTexto[] = [];
    const juntas = lida && fonteDe ? juntarPorEspacos(cruas, lida.analise, fonteDe) : cruas;
    for (const crua of juntas) {
      const partes =
        lida && fonteDe
          ? cortarPorEstilo(crua, lida.analise, fonteDe)
          : [{ ...crua, negrito: false, italico: false }];
      for (const p of partes) linhas.push({ ...p, id: `l${linhas.length}` });
    }
    return linhas;
  }

  fechar(): void {
    if (this.fechado) return;
    this.fechado = true;
    // No pdf.js 6 quem solta o documento e o worker é a tarefa que o carregou.
    void this.pdf.loadingTask.destroy();
  }
}

/** `updateMetadata: false`: o autor e as datas do PDF continuam os dele. */
export async function carregarNoPdfLib(bytes: Uint8Array, nome: string): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (!doc.isEncrypted) doc.getPageCount();
  } catch {
    throw new ErroDeConversao(
      `Não consegui ler “${nome}”. O arquivo pode estar corrompido.`,
      "PDF_INVALIDO",
    );
  }
  if (doc.isEncrypted) {
    throw new ErroDeConversao(
      `“${nome}” está protegido (senha ou bloqueio de cópia). Tire a proteção e tente de novo.`,
      "PDF_PROTEGIDO",
    );
  }
  return doc;
}
