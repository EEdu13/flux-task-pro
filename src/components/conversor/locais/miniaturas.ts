import { ErroDeConversao } from "../tipos";
import { bytesDe, pareceSerPdf } from "./arquivos";
import { abrirNoPdfjs } from "./pdfjs";

/*
 * Miniaturas das páginas para escolher (Separar) e girar (Girar), 04/11/2026.
 *
 * Uma página de cada vez, numa fila: desenhar todas juntas travaria a tela num
 * PDF de 80 páginas. Quem pede é a miniatura que entrou na área visível — a
 * fila só anda para o que a pessoa está vendo.
 *
 * A prévia grande (05/11/2026), a que abre ao lado do painel quando o mouse
 * passa numa miniatura, NÃO entra nessa fila: é uma página só, a pessoa está
 * esperando por ela, e uma nova passada do mouse cancela a anterior.
 */

/** A caixa, em px de CSS, em que a prévia precisa caber. */
export type CaixaDePrevia = { largura: number; altura: number };

/** Uma página (ou imagem) já desenhada para a prévia grande. */
export type PreviaPronta = {
  /**
   * Canvas fora da tela, com os pixels prontos. É de quem o gerou e pode ser
   * reaproveitado numa próxima passada do mouse: quem recebe só COPIA
   * (`drawImage`), não guarda nem altera.
   */
  fonte: HTMLCanvasElement;
  /** O tamanho, em px de CSS, com que a prévia aparece. */
  larguraCss: number;
  alturaCss: number;
  /** Uma linha de apoio para a legenda ("Página 1 de 12", "4000 × 3000 px"). */
  detalhe?: string;
};

export type PdfAberto = {
  paginas: number;
  /**
   * Desenha a página `indice` (a partir de 0) no canvas, cabendo numa caixa de
   * `larguraCss` de largura por 1,4× isso de altura — o A4 em pé ocupa a caixa
   * toda, e a página comprida (cupom, planta) encolhe em vez de deformar.
   */
  desenhar: (indice: number, canvas: HTMLCanvasElement, larguraCss: number) => Promise<void>;
  /**
   * Desenha a página `indice` grande, cabendo em `caixa`, já com o `giro`
   * (0, 90, 180 ou 270) que a pessoa deu nela. Cancelável pelo `sinal`.
   */
  desenharGrande: (
    indice: number,
    caixa: CaixaDePrevia,
    giro: number,
    sinal: AbortSignal,
  ) => Promise<PreviaPronta>;
  fechar: () => void;
};

const PROPORCAO_DA_CAIXA = 1.4;

/** Teto de pixels de uma prévia: 4 milhões são ~16 MB de canvas. Mais que isso numa tela de alta densidade só pesa. */
const PIXELS_MAXIMOS_DA_PREVIA = 4_000_000;

/** Quantas prévias prontas ficam guardadas: voltar a uma página já vista abre na hora. */
const PREVIAS_GUARDADAS = 5;

export async function abrirPdf(arquivo: File): Promise<PdfAberto> {
  const bytes = await bytesDe(arquivo);
  if (!pareceSerPdf(bytes)) {
    throw new ErroDeConversao(`“${arquivo.name}” não é um PDF.`, "NAO_E_PDF");
  }
  const pdf = await abrirNoPdfjs(bytes, arquivo.name);
  let fila: Promise<unknown> = Promise.resolve();
  let fechado = false;
  const guardadas = new Map<string, PreviaPronta>();

  const desenharAgora = async (indice: number, canvas: HTMLCanvasElement, larguraCss: number) => {
    if (fechado || !canvas.isConnected) return;
    const pagina = await pdf.getPage(indice + 1);
    try {
      const natural = pagina.getViewport({ scale: 1 });
      const escalaCss = Math.min(
        larguraCss / natural.width,
        (larguraCss * PROPORCAO_DA_CAIXA) / natural.height,
      );
      // Nítida em tela de alta densidade, sem passar de 2x (miniatura não precisa de mais).
      const densidade = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pagina.getViewport({ scale: escalaCss * densidade });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.round(natural.width * escalaCss)}px`;
      canvas.style.height = `${Math.round(natural.height * escalaCss)}px`;
      await pagina.render({ canvas, viewport }).promise;
    } finally {
      pagina.cleanup();
    }
  };

  const desenharGrandeAgora = async (
    indice: number,
    caixa: CaixaDePrevia,
    giro: number,
    sinal: AbortSignal,
  ): Promise<PreviaPronta> => {
    const densidade = Math.min(window.devicePixelRatio || 1, 2);
    const chave = `${indice}|${giro}|${Math.round(caixa.largura)}x${Math.round(caixa.altura)}|${densidade}`;
    const pronta = guardadas.get(chave);
    if (pronta) {
      // Passa para o fim da lista: a que fica há mais tempo sem uso é a primeira a sair.
      guardadas.delete(chave);
      guardadas.set(chave, pronta);
      return pronta;
    }
    if (fechado) throw new ErroDeConversao("O PDF já foi fechado.", "FECHADO");
    sinal.throwIfAborted();
    const pagina = await pdf.getPage(indice + 1);
    try {
      sinal.throwIfAborted();
      // O `getViewport` já parte da rotação que o próprio PDF traz; o giro da pessoa soma a ela.
      const rotacao = (pagina.rotate + giro) % 360;
      const natural = pagina.getViewport({ scale: 1, rotation: rotacao });
      const escalaCss = Math.min(caixa.largura / natural.width, caixa.altura / natural.height);
      let escala = escalaCss * densidade;
      const pixels = natural.width * escala * (natural.height * escala);
      if (pixels > PIXELS_MAXIMOS_DA_PREVIA) escala *= Math.sqrt(PIXELS_MAXIMOS_DA_PREVIA / pixels);
      const viewport = pagina.getViewport({ scale: escala, rotation: rotacao });
      const fonte = document.createElement("canvas");
      fonte.width = Math.max(1, Math.ceil(viewport.width));
      fonte.height = Math.max(1, Math.ceil(viewport.height));
      const tarefa = pagina.render({ canvas: fonte, viewport });
      const cancelar = () => tarefa.cancel();
      sinal.addEventListener("abort", cancelar, { once: true });
      try {
        await tarefa.promise;
      } finally {
        sinal.removeEventListener("abort", cancelar);
      }
      const nova: PreviaPronta = {
        fonte,
        larguraCss: Math.round(natural.width * escalaCss),
        alturaCss: Math.round(natural.height * escalaCss),
      };
      guardadas.set(chave, nova);
      while (guardadas.size > PREVIAS_GUARDADAS) {
        const maisAntiga = guardadas.keys().next().value;
        if (maisAntiga === undefined) break;
        guardadas.delete(maisAntiga);
      }
      return nova;
    } finally {
      pagina.cleanup();
    }
  };

  return {
    paginas: pdf.numPages,
    desenhar: (indice, canvas, larguraCss) => {
      const vez = fila.then(() => desenharAgora(indice, canvas, larguraCss));
      fila = vez.catch(() => {});
      return vez;
    },
    desenharGrande: desenharGrandeAgora,
    fechar: () => {
      fechado = true;
      guardadas.clear();
      // No pdf.js 6 quem solta o documento e o worker é a tarefa que o carregou.
      void pdf.loadingTask.destroy();
    },
  };
}
