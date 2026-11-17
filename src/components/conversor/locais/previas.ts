import { liberarCanvas } from "./arquivos";
import { decodificarImagem } from "./imagem";
import { abrirPdf, type CaixaDePrevia, type PdfAberto, type PreviaPronta } from "./miniaturas";

/*
 * As prévias grandes das LINHAS (05/11/2026): Juntar PDFs e Imagens → PDF listam
 * os arquivos pelo nome, e o Formato mostra um arquivo só. Passar o mouse num
 * deles abre ao lado do painel a primeira página do PDF, ou a imagem inteira,
 * em tamanho grande (as páginas das telas Separar e Girar têm o desenho delas
 * em `miniaturas.ts`).
 *
 * Os PDFs abertos para isso ficam numa lista curta, os três últimos: abrir é ler
 * o arquivo inteiro para a memória, e quem passa o mouse de uma linha a outra
 * volta a elas. Tudo é solto quando a tela fecha (`fechar`).
 */

const PDFS_ABERTOS = 3;
const IMAGENS_GUARDADAS = 4;
/** Foto pequena não vira um borrão do tamanho da tela: amplia no máximo 3x. */
const AMPLIACAO_MAXIMA = 3;
const PIXELS_MAXIMOS = 4_000_000;

export function criarLeitorDePrevias() {
  const pdfs = new Map<File, Promise<PdfAberto>>();
  const imagens = new Map<string, PreviaPronta>();
  const ids = new WeakMap<File, number>();
  let proximoId = 0;
  let fechado = false;

  const idDe = (arquivo: File): number => {
    let id = ids.get(arquivo);
    if (id === undefined) {
      id = ++proximoId;
      ids.set(arquivo, id);
    }
    return id;
  };

  const abrir = (arquivo: File): Promise<PdfAberto> => {
    const jaAberto = pdfs.get(arquivo);
    if (jaAberto) {
      // Passa para o fim da lista: o que fica há mais tempo sem uso é o primeiro a ser fechado.
      pdfs.delete(arquivo);
      pdfs.set(arquivo, jaAberto);
      return jaAberto;
    }
    const aberto = abrirPdf(arquivo);
    pdfs.set(arquivo, aberto);
    // Falhou (protegido, corrompido): não fica na lista, e a próxima passada tenta de novo.
    aberto.catch(() => {
      if (pdfs.get(arquivo) === aberto) pdfs.delete(arquivo);
    });
    while (pdfs.size > PDFS_ABERTOS) {
      const maisAntigo = pdfs.keys().next().value;
      if (maisAntigo === undefined) break;
      const velho = pdfs.get(maisAntigo);
      pdfs.delete(maisAntigo);
      velho?.then(
        (p) => p.fechar(),
        () => {},
      );
    }
    return aberto;
  };

  return {
    /** A primeira página do PDF, grande. */
    async primeiraPagina(
      arquivo: File,
      caixa: CaixaDePrevia,
      sinal: AbortSignal,
    ): Promise<PreviaPronta> {
      const pdf = await abrir(arquivo);
      sinal.throwIfAborted();
      const pronta = await pdf.desenharGrande(0, caixa, 0, sinal);
      return { ...pronta, detalhe: `Página 1 de ${pdf.paginas}` };
    },

    /** A imagem inteira, de pé (a rotação EXIF da foto do celular já aplicada) e sobre fundo branco. */
    async imagem(arquivo: File, caixa: CaixaDePrevia, sinal: AbortSignal): Promise<PreviaPronta> {
      const densidade = Math.min(window.devicePixelRatio || 1, 2);
      const chave = `${idDe(arquivo)}|${Math.round(caixa.largura)}x${Math.round(caixa.altura)}|${densidade}`;
      const guardada = imagens.get(chave);
      if (guardada) {
        imagens.delete(chave);
        imagens.set(chave, guardada);
        return guardada;
      }
      if (fechado) throw new Error("O leitor de prévias já foi fechado.");
      const bitmap = await decodificarImagem(arquivo);
      try {
        sinal.throwIfAborted();
        const escalaCss = Math.min(
          caixa.largura / bitmap.width,
          caixa.altura / bitmap.height,
          AMPLIACAO_MAXIMA,
        );
        const larguraCss = Math.max(1, Math.round(bitmap.width * escalaCss));
        const alturaCss = Math.max(1, Math.round(bitmap.height * escalaCss));
        // Pixels de tela, mas nunca mais do que a imagem tem: o navegador amplia o resto.
        let escalaPx = Math.min(densidade * escalaCss, 1);
        const pixels = bitmap.width * escalaPx * (bitmap.height * escalaPx);
        if (pixels > PIXELS_MAXIMOS) escalaPx *= Math.sqrt(PIXELS_MAXIMOS / pixels);
        const fonte = document.createElement("canvas");
        fonte.width = Math.max(1, Math.round(bitmap.width * escalaPx));
        fonte.height = Math.max(1, Math.round(bitmap.height * escalaPx));
        const ctx = fonte.getContext("2d");
        if (!ctx) throw new Error("O navegador não conseguiu desenhar a prévia.");
        // PNG e WebP podem ser transparentes, e o preto atrás deles esconde o desenho.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, fonte.width, fonte.height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, fonte.width, fonte.height);
        const pronta: PreviaPronta = {
          fonte,
          larguraCss,
          alturaCss,
          detalhe: `${bitmap.width} × ${bitmap.height} px`,
        };
        imagens.set(chave, pronta);
        while (imagens.size > IMAGENS_GUARDADAS) {
          const maisAntiga = imagens.keys().next().value;
          if (maisAntiga === undefined) break;
          imagens.delete(maisAntiga);
        }
        return pronta;
      } finally {
        bitmap.close();
      }
    },

    fechar() {
      fechado = true;
      for (const aberto of pdfs.values()) {
        aberto.then(
          (p) => p.fechar(),
          () => {},
        );
      }
      pdfs.clear();
      for (const { fonte } of imagens.values()) liberarCanvas(fonte);
      imagens.clear();
    },
  };
}

export type LeitorDePrevias = ReturnType<typeof criarLeitorDePrevias>;
