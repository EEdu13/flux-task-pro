/**
 * Corta um fluxo de áudio em frases e entrega cada frase como um arquivo.
 *
 * É a peça comum da Tarefa por voz (um microfone) e da Ata da reunião (um por
 * participante). O corte é na pausa: depois de fala suficiente, um silêncio
 * fecha o trecho. Só vai para a transcrição o que teve voz — silêncio entre
 * uma frase e outra não custa nada.
 *
 * O que conta como fala foi apertado depois de um teste com microfone de
 * notebook, que capta teclado, ventilador e gente falando longe:
 *   - só vale som alto por pelo menos 3 leituras seguidas (~180 ms). Clique de
 *     tecla e batida na mesa são picos de uma leitura e não somam mais nada;
 *   - o trecho só é enviado com meio segundo de fala assim contada. Trecho
 *     quase mudo é exatamente onde os modelos de transcrição "inventam" texto.
 *
 * Cada trecho é um MediaRecorder novo, e não pedaços de um só: os pedaços de
 * uma gravação contínua não se abrem sozinhos (só o primeiro tem o cabeçalho do
 * arquivo), e a transcrição recusaria do segundo em diante. No corte, o
 * gravador novo começa antes de o antigo parar — ver `cortar`.
 */

export interface TrechoDeFala {
  audio: Blob;
  /** Quanto do trecho foi voz, em ms. O servidor usa para desconfiar de texto demais. */
  falaMs: number;
  duracaoMs: number;
  /** `Date.now()` de quando o trecho começou — ordena as falas de várias pessoas. */
  inicio: number;
}

export interface OpcoesDoSegmentador {
  fluxo: MediaStream;
  /** Ligado à mesma fonte do fluxo; o segmentador só lê. */
  analisador: AnalyserNode;
  aoTrecho: (trecho: TrechoDeFala) => void;
  aoFalar?: (falando: boolean) => void;
  /** Silêncio que fecha a frase. */
  pausaQueCortaMs?: number;
  /** Trecho fecha aqui mesmo sem pausa, para o texto não demorar a aparecer. */
  trechoMaximoMs?: number;
}

const TICK_MS = 60;
const LEITURAS_SEGUIDAS = 3;
const FALA_MINIMA_MS = 500;

const FORMATOS = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export const gravacaoSuportada = () => typeof MediaRecorder !== "undefined";

export function criarSegmentador(o: OpcoesDoSegmentador): {
  /** Para de ouvir. `entregar` manda o trecho em andamento se ele teve fala. */
  parar: (entregar?: boolean, depois?: () => void) => void;
} {
  const pausaQueCorta = o.pausaQueCortaMs ?? 1000;
  const trechoMaximo = o.trechoMaximoMs ?? 25_000;
  const formato = FORMATOS.find((f) => MediaRecorder.isTypeSupported(f));
  const amostra = new Uint8Array(o.analisador.fftSize);

  type Medida = { falaMs: number; duracaoMs: number; inicio: number };

  let gravador: MediaRecorder | null = null;
  let pedacos: Blob[] = [];
  let inicio = 0;
  let inicioRelogio = 0;
  let falaMs = 0;
  let silencioMs = 0;
  let seguidas = 0;
  let ruido = 0.01;
  let falando = false;
  let parado = false;

  const medida = (): Medida => ({
    falaMs,
    duracaoMs: performance.now() - inicio,
    inicio: inicioRelogio,
  });

  const iniciar = () => {
    pedacos = [];
    inicio = performance.now();
    inicioRelogio = Date.now();
    falaMs = 0;
    silencioMs = 0;
    seguidas = 0;
    gravador = null;
    // Trilha encerrada (aparelho trocado, pessoa saiu): quem criou recria.
    if (o.fluxo.getAudioTracks().every((t) => t.readyState === "ended")) return;
    try {
      const g = new MediaRecorder(
        o.fluxo,
        /* 64 kbps e não 32: a transcrição erra mais com áudio muito comprimido,
           e na reunião o som já vem comprimido uma vez pela chamada. Um trecho
           de 20 s ainda dá ~160 KB. */
        formato ? { mimeType: formato, audioBitsPerSecond: 64_000 } : undefined,
      );
      const destes = pedacos;
      g.ondataavailable = (e) => {
        if (e.data.size > 0) destes.push(e.data);
      };
      g.start();
      gravador = g;
    } catch {
      gravador = null;
    }
  };

  /** Para o gravador e entrega o trecho dele, se valer a pena mandar. */
  const entregar = (
    g: MediaRecorder | null,
    destes: Blob[],
    m: Medida,
    enviar: boolean,
    depois?: () => void,
  ) => {
    if (!g) return depois?.();
    const aoParar = () => {
      if (enviar && destes.length) {
        const audio = new Blob(destes, { type: g.mimeType || formato || "audio/webm" });
        // Menos de ~1,5 KB não chega a meio segundo de áudio: é estalo, não fala.
        if (audio.size > 1500) o.aoTrecho({ audio, ...m });
      }
      depois?.();
    };
    if (g.state !== "inactive") {
      g.onstop = aoParar;
      try {
        g.stop();
      } catch {
        aoParar();
      }
    } else aoParar();
  };

  /**
   * Fecha a frase e já começa a próxima.
   *
   * O gravador novo começa ANTES de o antigo parar. Parar e começar em seguida
   * deixava um vão de alguns milissegundos sem ninguém gravando, e a primeira
   * sílaba dita logo depois da pausa caía nele — a palavra chegava cortada na
   * transcrição. O corte acontece no silêncio, então o pedaço em que os dois
   * gravam junto não tem fala e não duplica nada.
   */
  const cortar = (enviar: boolean) => {
    const velho = gravador;
    const destes = pedacos;
    const m = medida();
    iniciar();
    entregar(velho, destes, m, enviar);
  };

  const marcarFalando = (sim: boolean) => {
    if (sim === falando) return;
    falando = sim;
    o.aoFalar?.(sim);
  };

  iniciar();

  const relogio = window.setInterval(() => {
    o.analisador.getByteTimeDomainData(amostra);
    let soma = 0;
    for (let i = 0; i < amostra.length; i++) {
      const x = ((amostra[i] ?? 128) - 128) / 128;
      soma += x * x;
    }
    const rms = Math.sqrt(soma / amostra.length);

    /* O limiar acompanha o ruído da sala: ar-condicionado e teclado sobem o
       chão, e um limiar fixo ou cortaria no meio das frases ou nunca cortaria.
       O ruído só é medido nos momentos sem voz. */
    const limiar = Math.max(0.02, ruido * 2.8);
    if (rms > limiar) {
      seguidas++;
      if (seguidas >= LEITURAS_SEGUIDAS) {
        // A primeira vez que a sequência fecha conta as leituras que a abriram.
        falaMs += seguidas === LEITURAS_SEGUIDAS ? TICK_MS * LEITURAS_SEGUIDAS : TICK_MS;
        silencioMs = 0;
        marcarFalando(true);
      }
    } else {
      seguidas = 0;
      silencioMs += TICK_MS;
      ruido = ruido * 0.97 + rms * 0.03;
      if (silencioMs > 300) marcarFalando(false);
    }

    if (!gravador) {
      // Sem gravador (trilha acabou ou o navegador recusou): tenta de novo.
      if (!parado) iniciar();
      return;
    }
    const duracao = performance.now() - inicio;
    const teveFala = falaMs >= FALA_MINIMA_MS;
    if ((teveFala && silencioMs >= pausaQueCorta) || duracao >= trechoMaximo) {
      cortar(teveFala);
    }
  }, TICK_MS);

  return {
    parar: (enviar = true, depois) => {
      if (parado) return depois?.();
      parado = true;
      window.clearInterval(relogio);
      marcarFalando(false);
      const g = gravador;
      gravador = null;
      entregar(g, pedacos, medida(), enviar && falaMs >= FALA_MINIMA_MS, depois);
    },
  };
}
