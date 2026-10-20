import { toast } from "sonner";
import { lerMicrofonePreferido } from "@/lib/microfone-preferido";
import { POSICAO_PADRAO } from "@/lib/bolha-da-camera";
import {
  formatoSuportado,
  motivoDaRecusa,
  nomeComDataHora,
  relogioDeFundo,
  semCodecs,
  type GravacaoPronta,
} from "@/lib/gravacao-de-midia";

/**
 * Gravar a tela, estilo Loom (19/10/2026).
 *
 * A pessoa escolhe a tela, a janela ou a aba (`getDisplayMedia`), e pode pôr a
 * voz (microfone) e o rosto (câmera, numa bolinha no canto). O vídeo é pequeno
 * de propósito: 720p, 15 quadros, ~700 kbps — tela parada com cursor andando
 * comprime muito bem, e 2 minutos saem em torno de 10 MB, dentro do teto de
 * 25 MB do envio em pedaços.
 *
 * Com a câmera, o vídeo é composto num `<canvas>` (tela inteira + bolinha),
 * pela mesma receita das gravações de reunião (`composicao-gravacao.ts`):
 * desenhar a cada quadro e gravar o canvas, porque o `MediaRecorder` aceita uma
 * faixa de vídeo só. Sem câmera não há o que compor, e a faixa da tela vai
 * direto para o gravador — menos trabalho para o computador.
 */

export const LIMITE_TELA_S = 120;

const LARGURA = 1280;
const ALTURA = 720;
const QUADROS = 15;
/** Diâmetro da bolinha da câmera, em fração da largura — o mesmo das reuniões. */
const DIAMETRO_DA_BOLHA = 0.14;

const FORMATOS = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export type OpcoesDaGravacaoDeTela = { microfone: boolean; camera: boolean };

export type GravacaoDeTelaEmCurso = {
  inicio: number;
  /** Para e entrega o vídeo em `aoTerminar`. */
  parar: () => void;
  /** Para e joga fora. */
  descartar: () => void;
};

/** Desenha o vídeo inteiro dentro da área, com barras (`object-fit: contain`). */
function desenharInteiro(ctx: CanvasRenderingContext2D, el: HTMLVideoElement) {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  if (!vw || !vh) return;
  const escala = Math.min(LARGURA / vw, ALTURA / vh);
  const dw = vw * escala;
  const dh = vh * escala;
  ctx.drawImage(el, (LARGURA - dw) / 2, (ALTURA - dh) / 2, dw, dh);
}

/** A bolinha da câmera: recorte em círculo, imagem cobrindo, anel por fora. */
function desenharBolha(ctx: CanvasRenderingContext2D, el: HTMLVideoElement) {
  const vw = el.videoWidth;
  const vh = el.videoHeight;
  if (!vw || !vh) return;
  const d = Math.round(LARGURA * DIAMETRO_DA_BOLHA);
  const r = d / 2;
  const cx = POSICAO_PADRAO.x * LARGURA;
  const cy = POSICAO_PADRAO.y * ALTURA;
  const escala = Math.max(d / vw, d / vh);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  // Espelhada, como a pessoa se vê no espelho — senão o gesto sai invertido.
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(el, -(vw * escala) / 2, -(vh * escala) / 2, vw * escala, vh * escala);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function videoTocando(fluxo: MediaStream): HTMLVideoElement {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.srcObject = fluxo;
  void el.play().catch(() => {});
  return el;
}

/**
 * Começa a gravar. Devolve `null` se não deu (a pessoa cancelou a escolha da
 * tela, o navegador não grava) — o aviso já foi mostrado.
 *
 * Microfone ou câmera recusados NÃO impedem a gravação: ela segue sem eles, com
 * um aviso. Quem quer mostrar a tela não deveria perder a gravação porque a
 * câmera estava ocupada pelo Teams.
 */
export async function iniciarGravacaoDeTela(
  opcoes: OpcoesDaGravacaoDeTela,
  aoTerminar: (g: GravacaoPronta | null) => void,
): Promise<GravacaoDeTelaEmCurso | null> {
  const formato = formatoSuportado(FORMATOS);
  if (!formato || !navigator.mediaDevices?.getDisplayMedia) {
    toast.error("Este navegador não grava a tela", {
      description: "Use o Chrome ou o Edge no computador.",
    });
    return null;
  }

  let tela: MediaStream;
  try {
    tela = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: LARGURA, max: LARGURA },
        height: { ideal: ALTURA, max: ALTURA },
        frameRate: { ideal: QUADROS, max: QUADROS },
      },
      // Som da aba/sistema, se a pessoa marcar "compartilhar áudio" na escolha.
      audio: true,
    });
  } catch (e) {
    const m = motivoDaRecusa(e, "tela");
    toast.error(m.titulo, { description: m.descricao, duration: 9000 });
    return null;
  }

  const soltaveis: MediaStream[] = [tela];

  let microfone: MediaStream | null = null;
  if (opcoes.microfone) {
    try {
      const preferido = lerMicrofonePreferido();
      microfone = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(preferido ? { deviceId: { ideal: preferido } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      soltaveis.push(microfone);
    } catch (e) {
      const m = motivoDaRecusa(e, "microfone");
      toast.warning(`${m.titulo} — gravando sem a sua voz`, {
        description: m.descricao,
        duration: 9000,
      });
    }
  }

  let camera: MediaStream | null = null;
  if (opcoes.camera) {
    try {
      camera = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" },
      });
      soltaveis.push(camera);
    } catch (e) {
      const m = motivoDaRecusa(e, "câmera");
      toast.warning(`${m.titulo} — gravando sem a bolinha`, {
        description: m.descricao,
        duration: 9000,
      });
    }
  }

  /* ---- vídeo: a tela pura, ou a tela + a bolinha num canvas ---- */
  let faixaDeVideo: MediaStreamTrack = tela.getVideoTracks()[0]!;
  let pararDesenho: (() => void) | null = null;
  if (camera) {
    const canvas = document.createElement("canvas");
    canvas.width = LARGURA;
    canvas.height = ALTURA;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx) {
      const elTela = videoTocando(tela);
      const elCamera = videoTocando(camera);
      const desenhar = () => {
        ctx.fillStyle = "#0b0b0f";
        ctx.fillRect(0, 0, LARGURA, ALTURA);
        desenharInteiro(ctx, elTela);
        desenharBolha(ctx, elCamera);
      };
      desenhar();
      const pararRelogio = relogioDeFundo(1000 / QUADROS, desenhar);
      const composta = canvas.captureStream(QUADROS).getVideoTracks()[0];
      if (composta) {
        faixaDeVideo = composta;
        pararDesenho = () => {
          pararRelogio();
          composta.stop();
          elTela.srcObject = null;
          elCamera.srcObject = null;
        };
      } else {
        pararRelogio();
      }
    }
  }

  /* ---- áudio: microfone e/ou som da aba, misturados numa faixa só ---- */
  const audiosDaTela = tela.getAudioTracks();
  const audiosDoMic = microfone?.getAudioTracks() ?? [];
  let faixaDeAudio: MediaStreamTrack | null = null;
  let contexto: AudioContext | null = null;
  if (audiosDaTela.length && audiosDoMic.length) {
    try {
      contexto = new AudioContext();
      const destino = contexto.createMediaStreamDestination();
      contexto.createMediaStreamSource(new MediaStream(audiosDaTela)).connect(destino);
      contexto.createMediaStreamSource(new MediaStream(audiosDoMic)).connect(destino);
      faixaDeAudio = destino.stream.getAudioTracks()[0] ?? null;
    } catch {
      faixaDeAudio = audiosDoMic[0] ?? null;
    }
  } else {
    faixaDeAudio = audiosDoMic[0] ?? audiosDaTela[0] ?? null;
  }

  const fluxo = new MediaStream(faixaDeAudio ? [faixaDeVideo, faixaDeAudio] : [faixaDeVideo]);
  let gravador: MediaRecorder;
  try {
    gravador = new MediaRecorder(fluxo, {
      mimeType: formato,
      videoBitsPerSecond: 700_000,
      audioBitsPerSecond: 32_000,
    });
  } catch (e) {
    pararDesenho?.();
    soltaveis.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void contexto?.close().catch(() => {});
    toast.error("Não foi possível começar a gravar", {
      description: e instanceof Error ? e.message : undefined,
    });
    return null;
  }

  const pedacos: Blob[] = [];
  let descartar = false;
  const inicio = Date.now();
  let limite = 0;

  gravador.ondataavailable = (ev) => {
    if (ev.data.size) pedacos.push(ev.data);
  };
  gravador.onstop = () => {
    window.clearTimeout(limite);
    pararDesenho?.();
    // Soltar TUDO: é o que tira o aviso "compartilhando a tela" e apaga a câmera.
    soltaveis.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void contexto?.close().catch(() => {});
    if (descartar || !pedacos.length) {
      aoTerminar(null);
      return;
    }
    const tipoMime = semCodecs(gravador.mimeType || formato);
    aoTerminar({
      arquivo: new Blob(pedacos, { type: tipoMime }),
      tipoMime,
      nome: nomeComDataHora("gravacao-de-tela", tipoMime),
      segundos: (Date.now() - inicio) / 1000,
    });
  };

  const parar = () => {
    if (gravador.state !== "inactive") gravador.stop();
  };

  // "Parar de compartilhar" na barra do próprio navegador também encerra.
  tela.getVideoTracks()[0]?.addEventListener("ended", parar);
  limite = window.setTimeout(() => {
    toast.info("A gravação chegou a 2 minutos e parou sozinha.");
    parar();
  }, LIMITE_TELA_S * 1000);

  gravador.start(1000);

  return {
    inicio,
    parar,
    descartar: () => {
      descartar = true;
      parar();
    },
  };
}
