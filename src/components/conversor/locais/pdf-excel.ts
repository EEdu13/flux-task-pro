import { gerarXlsx, TIPO_XLSX } from "@/lib/planilha-xlsx";
import { ErroDeConversao, type AoExecutar, type OpcoesDoBloco, type Resultado } from "../tipos";
import { blobDe, bytesDe, nomeBase, pararSeCancelado, pareceSerPdf, respirar } from "./arquivos";
import { abrirNoPdfjs, carregarPdfjs } from "./pdfjs";
import {
  montarAbas,
  montarPagina,
  tracosDoDesenho,
  trechosDaPagina,
  type PaginaDoPdfjs,
  type PaginaMontada,
  type Tracos,
} from "./tabelas";

/*
 * PDF → Excel (11/11/2026), no navegador e no app, sem o arquivo sair do computador: o pdf.js lê o
 * texto de cada página com a posição, `tabelas.ts` monta as linhas e colunas, e o `gerarXlsx`
 * escreve a planilha. É uma conversão aproximada: tabela simples e formulário saem bem.
 *
 * Desde 12/11/2026 o pdf.js também entrega o DESENHO de cada página com texto: quando a tabela
 * tem as bordas desenhadas, elas decidem as células (e as mescladas saem mescladas). E a etapa
 * "abas" deixa escolher entre uma aba por página e tudo numa aba.
 */

/** Acima disto, a planilha fica grande demais para o navegador montar de uma vez. */
export const MAXIMO_DE_PAGINAS_NO_EXCEL = 300;

const SEM_TRACOS: Tracos = { horizontais: [], verticais: [] };

export async function pdfParaExcel(
  arquivos: File[],
  opcoes: OpcoesDoBloco,
  ao: AoExecutar,
): Promise<Resultado> {
  const arquivo = arquivos[0]!;
  const bytes = await bytesDe(arquivo);
  if (!pareceSerPdf(bytes)) {
    throw new ErroDeConversao(`“${arquivo.name}” não é um PDF.`, "NAO_E_PDF");
  }
  pararSeCancelado(ao.sinal);
  const { OPS } = await carregarPdfjs();
  const documento = await abrirNoPdfjs(bytes, arquivo.name);
  try {
    if (documento.numPages > MAXIMO_DE_PAGINAS_NO_EXCEL) {
      throw new ErroDeConversao(
        `“${arquivo.name}” tem ${documento.numPages} páginas. O PDF → Excel aceita até ${MAXIMO_DE_PAGINAS_NO_EXCEL}.`,
        "MUITAS_PAGINAS",
      );
    }
    const paginas: PaginaMontada[] = [];
    let paginasComTexto = 0;
    for (let n = 1; n <= documento.numPages; n++) {
      pararSeCancelado(ao.sinal);
      const pagina = (await documento.getPage(n)) as unknown as PaginaDoPdfjs;
      const vista = pagina.getViewport({ scale: 1 });
      const trechos = await trechosDaPagina(pagina);
      // O desenho só da página com texto: a escaneada não tem o que ler, e o desenho dela é a imagem.
      const tracos =
        trechos.length > 0
          ? tracosDoDesenho(await pagina.getOperatorList(), OPS, vista.transform)
          : SEM_TRACOS;
      pagina.cleanup();
      if (trechos.length > 0) paginasComTexto++;
      paginas.push(montarPagina(trechos, tracos, vista.height));
      ao.progresso((0.95 * n) / documento.numPages);
      await respirar();
    }
    if (paginasComTexto === 0) {
      throw new ErroDeConversao(
        `“${arquivo.name}” é um PDF escaneado (só imagem, sem texto). Passe pelo OCR antes.`,
        "ESCANEADO",
      );
    }
    const abas = montarAbas(paginas, opcoes.abasDoExcel ?? "por-pagina");
    const planilha = gerarXlsx(abas.map((a) => ({ ...a, cabecalho: false })));
    ao.progresso(1);
    return {
      arquivos: [{ nome: `${nomeBase(arquivo.name)}.xlsx`, blob: blobDe(planilha, TIPO_XLSX) }],
    };
  } finally {
    void documento.loadingTask.destroy();
  }
}
