import { gerarXlsx, TIPO_XLSX } from "@/lib/planilha-xlsx";
import { ErroDeConversao, type AoExecutar, type OpcoesDoBloco, type Resultado } from "../tipos";
import { blobDe, bytesDe, nomeBase, pararSeCancelado, pareceSerPdf, respirar } from "./arquivos";
import { abrirNoPdfjs, carregarPdfjs } from "./pdfjs";
import {
  abrirLeitores,
  lerRegioes,
  type Leitores,
  type PaginaParaDesenhar,
} from "./tabela-em-imagem";
import {
  imagensDoDesenho,
  montarAbas,
  montarPagina,
  regioesParaLer,
  tracosDoDesenho,
  trechosDaPagina,
  type PaginaDoPdfjs,
  type PaginaMontada,
  type RegiaoParaLer,
  type Secao,
  type Tracos,
  type Trecho,
} from "./tabelas";

/*
 * PDF → Excel (11/11/2026), no navegador e no app, sem o arquivo sair do computador: o pdf.js lê o
 * texto de cada página com a posição, `tabelas.ts` monta as linhas e colunas, e o `gerarXlsx`
 * escreve a planilha. É uma conversão aproximada: tabela simples e formulário saem bem.
 *
 * Desde 12/11/2026 o pdf.js também entrega o DESENHO de cada página com texto: quando a tabela
 * tem as bordas desenhadas, elas decidem as células (e as mescladas saem mescladas). E a etapa
 * "abas" deixa escolher entre uma aba por página e tudo numa aba.
 *
 * Desde 23/11/2026, a tabela que está em IMAGEM (o print do Excel colado no PDF, a página escaneada)
 * é lida pelo OCR, sozinha (`tabela-em-imagem.ts`): antes, a planilha saía só com o texto de verdade
 * da página — e sem aviso nenhum de que a tabela tinha ficado de fora. O resumo avisa que houve OCR.
 */

/** Acima disto, a planilha fica grande demais para o navegador montar de uma vez. */
export const MAXIMO_DE_PAGINAS_NO_EXCEL = 300;
/** Páginas com imagem para o OCR ler: cada uma leva de segundos a um minuto. */
export const MAXIMO_DE_PAGINAS_COM_OCR = 30;

const SEM_TRACOS: Tracos = { horizontais: [], verticais: [] };

function listaDePaginas(numeros: number[]): string {
  if (numeros.length === 1) return `na página ${numeros[0]}`;
  return `nas páginas ${numeros.slice(0, -1).join(", ")} e ${numeros[numeros.length - 1]}`;
}

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
  let leitores: Leitores | null = null;
  const encerrar = () => leitores?.encerrar();
  ao.sinal?.addEventListener("abort", encerrar, { once: true });
  try {
    const total = documento.numPages;
    if (total > MAXIMO_DE_PAGINAS_NO_EXCEL) {
      throw new ErroDeConversao(
        `“${arquivo.name}” tem ${total} páginas. O PDF → Excel aceita até ${MAXIMO_DE_PAGINAS_NO_EXCEL}.`,
        "MUITAS_PAGINAS",
      );
    }

    // 1ª passada: o texto, os traços e as imagens de cada página.
    type Lida = {
      trechos: Trecho[];
      tracos: Tracos;
      regioes: RegiaoParaLer[];
      altura: number;
      /** O que o OCR leu, cada região montada à parte (ver `LidoNasImagens`). */
      prontas: { y: number; secoes: Secao[] }[];
    };
    const lidas: Lida[] = [];
    for (let n = 1; n <= total; n++) {
      pararSeCancelado(ao.sinal);
      const pagina = (await documento.getPage(n)) as unknown as PaginaDoPdfjs;
      const vista = pagina.getViewport({ scale: 1 });
      const trechos = await trechosDaPagina(pagina);
      const lista = await pagina.getOperatorList();
      // O desenho só da página com texto: a escaneada não tem o que ler, e o desenho dela é a imagem.
      const tracos = trechos.length > 0 ? tracosDoDesenho(lista, OPS, vista.transform) : SEM_TRACOS;
      const imagens = imagensDoDesenho(lista, OPS, vista.transform);
      const regioes = regioesParaLer(imagens, trechos, vista.width, vista.height);
      pagina.cleanup();
      lidas.push({ trechos, tracos, regioes, altura: vista.height, prontas: [] });
      await respirar();
    }

    const comImagem = lidas.flatMap((l, i) => (l.regioes.length > 0 ? [i + 1] : []));
    if (comImagem.length > MAXIMO_DE_PAGINAS_COM_OCR) {
      throw new ErroDeConversao(
        `“${arquivo.name}” tem ${comImagem.length} páginas com tabela em imagem. O PDF → Excel lê até ${MAXIMO_DE_PAGINAS_COM_OCR}: separe as páginas antes.`,
        "MUITAS_PAGINAS",
      );
    }
    // Sem OCR, a primeira passada é quase tudo; com OCR, ela é uma fração pequena.
    const parteDaLeitura = comImagem.length > 0 ? 0.1 : 0.95;
    ao.progresso(parteDaLeitura);

    // 2ª passada: as imagens, pelo OCR.
    const lidasPorOcr: number[] = [];
    let incertas = 0;
    for (const [k, n] of comImagem.entries()) {
      pararSeCancelado(ao.sinal);
      leitores ??= await abrirLeitores(ao.sinal);
      const l = lidas[n - 1]!;
      const pagina = (await documento.getPage(n)) as unknown as PaginaParaDesenhar & {
        cleanup(): void;
      };
      try {
        const lido = await lerRegioes(pagina, l.regioes, leitores, {
          sinal: ao.sinal,
          progresso: (f) =>
            ao.progresso(parteDaLeitura + ((0.95 - parteDaLeitura) * (k + f)) / comImagem.length),
        });
        for (const r of lido.regioes) {
          l.prontas.push({ y: r.y, secoes: montarPagina(r.trechos, r.tracos, l.altura).secoes });
        }
        if (lido.regioes.length > 0) {
          lidasPorOcr.push(n);
          incertas += lido.incertas;
        }
      } finally {
        pagina.cleanup();
      }
    }

    if (lidas.every((l) => l.trechos.length === 0 && l.prontas.length === 0)) {
      throw new ErroDeConversao(
        comImagem.length > 0
          ? `Não consegui ler texto em “${arquivo.name}”, nem pelo OCR. A imagem pode estar sem nitidez.`
          : `“${arquivo.name}” não tem texto para pôr na planilha.`,
        "ESCANEADO",
      );
    }
    const paginas: PaginaMontada[] = lidas.map((l) =>
      montarPagina(l.trechos, l.tracos, l.altura, l.prontas),
    );
    const abas = montarAbas(paginas, opcoes.abasDoExcel ?? "por-pagina");
    const planilha = gerarXlsx(abas.map((a) => ({ ...a, cabecalho: false })));
    ao.progresso(1);

    let resumo: string | undefined;
    if (lidasPorOcr.length > 0) {
      const umaSo = lidasPorOcr.length === 1;
      resumo = `${umaSo ? "Tabela em imagem lida" : "Tabelas em imagem lidas"} pelo OCR ${listaDePaginas(lidasPorOcr)}: confira os números.`;
      if (incertas > 0) {
        resumo += ` ${incertas} ${incertas === 1 ? "célula ficou" : "células ficaram"} com “?”.`;
      }
    }
    return {
      arquivos: [{ nome: `${nomeBase(arquivo.name)}.xlsx`, blob: blobDe(planilha, TIPO_XLSX) }],
      resumo,
    };
  } finally {
    ao.sinal?.removeEventListener("abort", encerrar);
    leitores?.encerrar();
    void documento.loadingTask.destroy();
  }
}
