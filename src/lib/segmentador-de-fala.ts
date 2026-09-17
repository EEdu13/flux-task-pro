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
 *     quase mudo é exatamente onde os modelos de transcrição "inventam" texto;
 *   - abrir a frase exige um som bem acima do ruído da sala; continuar uma
 *     frase já aberta aceita um som mais fraco. Sem essa diferença, uma
 *     sílaba mais fraca no fim de uma palavra (quem fala baixo ou está longe)
 *     cortava a frase no meio, e a palavra chegava truncada na transcrição;
 *   - o piso do ruído desce rápido quando a sala fica mais quieta, mas sobe
 *     devagar quando fica mais alta. Sem essa diferença, quem fala baixo
 *     ensinava o próprio piso a subir, até a voz virar "ruído normal" e parar
 *     de ser ouvida.
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

    /* Dois limiares, não um: abrir a frase exige bem mais que o ruído da sala
       (evita clique de tecla ou sopro de ventilador virando frase nova);
       continuar uma frase já aberta aceita bem menos (uma sílaba mais fraca
       no meio ou fim não deve fechar a frase nem parar de contar como fala —
       isso também mantinha o falaMs baixo demais e derrubava transcrições
       boas no filtro de tamanho do servidor). */
    const limiarEntrar = Math.max(0.02, ruido * 2.8);
    const limiarManter = Math.max(0.012, ruido * 1.5);

    if (falando) {
      if (rms > limiarManter) {
        falaMs += TICK_MS;
        silencioMs = 0;
      } else {
        silencioMs += TICK_MS;
        if (silencioMs > 300) marcarFalando(false);
      }
    } else {
      /* O piso só aprende fora da fala, e assimétrico: desce rápido (a sala
         ficou mais quieta) mas sobe devagar (ficou mais alta). Antes subia no
         mesmo ritmo dos dois lados — e quem fala baixo, ao nunca cruzar o
         limiar de abrir, ensinava o próprio piso a subir até a voz parar de
         se destacar do ruído. Agora um som mais alto só vira "ruído normal"
         depois de durar segundos, não uma ou duas leituras. */
      if (rms < ruido) ruido = ruido * 0.9 + rms * 0.1;
      else ruido = ruido * 0.995 + rms * 0.005;

      if (rms > limiarEntrar) {
        seguidas++;
        if (seguidas >= LEITURAS_SEGUIDAS) {
          falaMs += TICK_MS * LEITURAS_SEGUIDAS;
          silencioMs = 0;
          seguidas = 0;
          marcarFalando(true);
        }
      } else {
        seguidas = 0;
        silencioMs += TICK_MS;
      }
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
