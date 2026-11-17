import jbig2 from "pdfjs-dist/wasm/jbig2.wasm?url";
import openjpeg from "pdfjs-dist/wasm/openjpeg.wasm?url";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "../falha-de-carregamento";
import { ErroDeConversao } from "../tipos";

/*
 * O pdf.js, carregado uma vez só e só quando alguém precisa (04/11/2026): ele
 * passa de 1 MB, mais o worker. É ele quem DESENHA as páginas — as miniaturas
 * de Separar/Girar e o "PDF → imagens". Juntar, separar e girar de verdade
 * são com o pdf-lib, que mexe no arquivo sem desenhar nada.
 *
 * O worker é um arquivo do próprio build (`?url`), servido pelo nosso domínio:
 * nada vem de CDN, e funciona igual no navegador e no app de mesa.
 *
 * Sem `standardFontDataUrl`: PDF que usa as fontes padrão sem embuti-las é
 * desenhado com a fonte do sistema no lugar. Para miniatura e imagem de
 * página isso não atrapalha a leitura.
 */

type Pdfjs = typeof import("pdfjs-dist");
type DocumentoPdfjs = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

/**
 * Os decodificadores em WebAssembly que o pdf.js 6 pede (05/11/2026): o JBIG2,
 * dos PDFs de multifuncional em preto e branco, e o JPEG 2000. Sem eles a
 * imagem da página não é desenhada — o PDF escaneado saía em BRANCO, sem erro
 * nenhum, nas miniaturas e no "PDF → imagens".
 *
 * Vão empacotados pelo Vite (`?url`, com hash no nome e servidos pelo nosso
 * domínio), em vez de uma pasta copiada à mão: a versão deles é sempre a do
 * pdf.js instalado. O pdf.js pede por nome de arquivo.
 */
const WASM_DO_PDFJS: Record<string, string> = {
  "jbig2.wasm": jbig2,
  "openjpeg.wasm": openjpeg,
};

/**
 * A "fábrica de dados binários" que o pdf.js aceita no lugar da dele, que só
 * sabe buscar numa pasta de URL (`wasmUrl`). Ele a constrói com as URLs que
 * recebeu (nenhuma, aqui) e só chama `fetch({ kind, filename })`. Os outros
 * tipos que ele pode pedir — mapas de caracteres e fontes — nunca foram
 * fornecidos; seguem sem fornecer, e ele cai no plano B de sempre.
 */
export class DadosBinariosDoPdfjs {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === "wasmUrl" ? WASM_DO_PDFJS[filename] : undefined;
    if (!url) throw new Error(`O pdf.js pediu ${kind}/${filename}, que não está empacotado.`);
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error(`Não consegui baixar ${filename} (${resposta.status}).`);
    return new Uint8Array(await resposta.arrayBuffer());
  }
}

let carregando: Promise<Pdfjs> | null = null;

export function carregarPdfjs(): Promise<Pdfjs> {
  carregando ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })
    .catch((e: unknown) => {
      // Falhou (rede caiu, deploy novo trocou o arquivo): a próxima tentativa busca de novo.
      carregando = null;
      throw e;
    });
  return carregando;
}

/**
 * Abre os bytes no pdf.js. O pdf.js TRANSFERE o buffer para o worker — quem
 * chama perde os bytes —, então vai uma cópia.
 */
export async function abrirNoPdfjs(bytes: Uint8Array, nome: string): Promise<DocumentoPdfjs> {
  let pdfjs: Pdfjs;
  try {
    pdfjs = await carregarPdfjs();
  } catch (e) {
    if (ehFalhaDeCarregamento(e)) throw new ErroDeConversao(MENSAGEM_DE_ATUALIZACAO, "ATUALIZADO");
    throw e;
  }
  const tarefa = pdfjs.getDocument({
    data: bytes.slice(),
    // `useWorkerFetch: false`: é a página, e não o worker, quem busca os dados — pela fábrica acima.
    BinaryDataFactory: DadosBinariosDoPdfjs,
    useWorkerFetch: false,
  });
  try {
    return await tarefa.promise;
  } catch (e) {
    void tarefa.destroy();
    if ((e as { name?: string } | null)?.name === "PasswordException") {
      throw new ErroDeConversao(`“${nome}” está protegido por senha.`, "PDF_PROTEGIDO");
    }
    // O worker com nome antigo (deploy no meio) não é arquivo corrompido.
    if (ehFalhaDeCarregamento(e)) throw new ErroDeConversao(MENSAGEM_DE_ATUALIZACAO, "ATUALIZADO");
    throw new ErroDeConversao(
      `Não consegui ler “${nome}”. O arquivo pode estar corrompido.`,
      "PDF_INVALIDO",
    );
  }
}
