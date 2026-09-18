/**
 * Monta UM vídeo com todas as câmeras da reunião.
 *
 * Existe porque a gravação era de áudio em quase todo caso. `MediaRecorder`
 * aceita uma única faixa de vídeo, e o que ia nela era só o compartilhamento de
 * tela — se ninguém apresentasse, o arquivo saía sem imagem nenhuma, apesar de
 * todo mundo estar com a câmera aberta.
 *
 * A saída para isso é compor: desenhar todas as câmeras num `<canvas>` a cada
 * quadro e gravar o canvas. É o mesmo caminho que qualquer gravador de reunião
 * feito no navegador percorre — não existe API que misture vídeos por conta
 * própria.
 *
 * O que fica de fora, dito para não virar surpresa: o navegador só desenha o
 * que ele está recebendo. Quem estiver com a câmera fechada aparece como um
 * retângulo com o nome, e participante que o LiveKit não assinou (por economia
 * de banda, quando há muita gente) não entra na imagem.
 */

import { posicaoDaBolha } from "@/lib/bolha-da-camera";

export type FonteDeVideo = {
  /** Elemento já tocando a faixa. Quem cria é quem chama, via `track.attach()`. */
  el: HTMLVideoElement;
  nome: string;
  /** Compartilhamento de tela ganha o palco; câmera vira miniatura. */
  tela?: boolean;
  /**
   * Identidade do participante no LiveKit. É por ela que se descobre qual
   * câmera é a de quem está apresentando — e não pelo `nome`, que dois
   * homônimos compartilhariam.
   */
  identity?: string;
};

export type Compositor = {
  /** A faixa de vídeo para entregar ao `MediaRecorder`. */
  faixa: MediaStreamTrack;
  /** Troca as fontes sem interromper a gravação (alguém entrou, abriu a câmera…). */
  atualizar: (fontes: FonteDeVideo[]) => void;
  parar: () => void;
};

const LARGURA = 1280;
const ALTURA = 720;
const QUADROS = 24;

/** Diâmetro da bolha do apresentador, em fração da largura do quadro. */
const DIAMETRO_DA_BOLHA = 0.14;

/** Cor de fundo dos espaços vazios — a mesma do app em modo escuro. */
const FUNDO = "#0b0b0f";

/**
 * Desenha um vídeo preenchendo a área, cortando o excedente (estilo
 * `object-fit: cover`). Sem isto, câmera 16:9 numa célula quadrada apareceria
 * achatada — e é o tipo de defeito que só se descobre assistindo depois.
 */
function desenharCobrindo(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  if (!vw || !vh) return false;
  const escala = Math.max(w / vw, h / vh);
  const dw = vw * escala;
  const dh = vh * escala;
  ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}

/** Desenha o vídeo INTEIRO dentro da área, com barras (estilo `object-fit: contain`). */
function desenharInteiro(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  if (!vw || !vh) return false;
  const escala = Math.min(w / vw, h / vh);
  const dw = vw * escala;
  const dh = vh * escala;
  ctx.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}

function desenharNome(
  ctx: CanvasRenderingContext2D,
  nome: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (!nome) return;
  const texto = nome.length > 28 ? `${nome.slice(0, 27)}…` : nome;
  ctx.font = "500 15px system-ui, sans-serif";
  const larguraTexto = ctx.measureText(texto).width;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x + 8, y + h - 30, larguraTexto + 16, 22);
  ctx.fillStyle = "#fff";
  ctx.fillText(texto, x + 16, y + h - 14);
}

/**
 * A bolha do apresentador, recortada em círculo.
 *
 * O `clip` de um arco é o que faz a imagem retangular da câmera virar círculo;
 * o anel depois é desenhado por fora do recorte, senão metade da espessura
 * dele ficaria cortada.
 */
function desenharBolha(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement,
  cx: number,
  cy: number,
  diametro: number,
) {
  if (!el.videoWidth || !el.videoHeight) return;
  const raio = diametro / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  desenharCobrindo(ctx, el, cx - raio, cy - raio, diametro, diametro);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, raio, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

/** Grade que tende ao quadrado: 1→1x1, 2→2x1, 3-4→2x2, 5-6→3x2, 7-9→3x3… */
function grade(n: number): { colunas: number; linhas: number } {
  const colunas = Math.ceil(Math.sqrt(n));
  const linhas = Math.ceil(n / colunas);
  return { colunas, linhas };
}

export function criarCompositor(fontesIniciais: FonteDeVideo[]): Compositor {
  const canvas = document.createElement("canvas");
  canvas.width = LARGURA;
  canvas.height = ALTURA;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas indisponível para compor a gravação");

  let fontes = fontesIniciais;
  let vivo = true;

  const desenhar = () => {
    if (!vivo) return;
    ctx.fillStyle = FUNDO;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    const tela = fontes.find((f) => f.tela);
    const cameras = fontes.filter((f) => !f.tela);

    if (tela) {
      /* Apresentação manda: a tela ocupa quase tudo e as câmeras viram uma
         fita de miniaturas embaixo. Cortar a tela para preencher esconderia
         justamente o canto do slide onde costuma estar o que importa, então
         ela é desenhada INTEIRA, com barras.

         A câmera de QUEM APRESENTA sai da fita e vira a bolha por cima, igual
         ao que a sala mostra ao vivo. Sem isso, quem assistisse à gravação
         veria um layout diferente do que estava na tela na hora — e o rosto do
         apresentador apareceria duas vezes. */
      const doApresentador = tela.identity
        ? cameras.find((c) => c.identity === tela.identity)
        : undefined;
      const naFita = cameras.filter((c) => c !== doApresentador);

      const alturaFita = naFita.length ? 150 : 0;
      desenharInteiro(ctx, tela.el, 0, 0, LARGURA, ALTURA - alturaFita);
      desenharNome(ctx, `${tela.nome} (tela)`, 0, 0, LARGURA, ALTURA - alturaFita);

      if (naFita.length) {
        const largura = Math.min(240, LARGURA / naFita.length);
        naFita.forEach((f, i) => {
          const x = i * largura;
          const y = ALTURA - alturaFita;
          ctx.fillStyle = "#16161d";
          ctx.fillRect(x, y, largura - 2, alturaFita);
          desenharCobrindo(ctx, f.el, x, y, largura - 2, alturaFita);
          desenharNome(ctx, f.nome, x, y, largura - 2, alturaFita);
        });
      }

      /* Por último, para ficar por cima de tudo — inclusive da fita, se quem
         gravou tiver arrastado a bolha para lá. A posição vem em fração da
         área da chamada, então ela cai no mesmo lugar relativo em que estava
         na tela de quem arrastou. */
      if (doApresentador) {
        const pos = posicaoDaBolha();
        desenharBolha(
          ctx,
          doApresentador.el,
          pos.x * LARGURA,
          pos.y * ALTURA,
          Math.round(LARGURA * DIAMETRO_DA_BOLHA),
        );
      }
    } else if (cameras.length) {
      const { colunas, linhas } = grade(cameras.length);
      const cw = LARGURA / colunas;
      const ch = ALTURA / linhas;
      cameras.forEach((f, i) => {
        const x = (i % colunas) * cw;
        const y = Math.floor(i / colunas) * ch;
        ctx.fillStyle = "#16161d";
        ctx.fillRect(x, y, cw - 2, ch - 2);
        desenharCobrindo(ctx, f.el, x, y, cw - 2, ch - 2);
        desenharNome(ctx, f.nome, x, y, cw - 2, ch - 2);
      });
    } else {
      // Todo mundo de câmera fechada: um quadro escuro com um aviso, para o
      // arquivo não parecer corrompido.
      ctx.fillStyle = "#6b7280";
      ctx.font = "500 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Somente áudio — nenhuma câmera aberta", LARGURA / 2, ALTURA / 2);
      ctx.textAlign = "left";
    }
  };

  /* `setInterval` e não `requestAnimationFrame`: rAF PARA quando a aba vai para
     segundo plano, e reunião em que alguém troca de aba é o caso normal, não o
     raro. Com rAF a gravação congelaria na última imagem sem nenhum aviso. */
  const relogio = window.setInterval(desenhar, Math.round(1000 / QUADROS));
  desenhar();

  const stream = canvas.captureStream(QUADROS);
  const faixa = stream.getVideoTracks()[0];
  if (!faixa) {
    window.clearInterval(relogio);
    throw new Error("Não foi possível capturar o vídeo composto");
  }

  return {
    faixa,
    atualizar: (novas) => {
      fontes = novas;
    },
    parar: () => {
      vivo = false;
      window.clearInterval(relogio);
      faixa.stop();
    },
  };
}
