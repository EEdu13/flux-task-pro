import { useEffect, useRef, useState, type RefObject } from "react";
import type { LeituraDoMicrofone } from "@/lib/use-microfone";

/**
 * Corta a fala em frases e entrega cada frase como um arquivo de áudio.
 *
 * O corte é na pausa: depois de pelo menos 350 ms de fala, 850 ms de silêncio
 * fecham o trecho. É o que deixa a transcrição barata — só vai para a OpenAI o
 * que teve voz, e silêncio entre um pedido e outro não custa nada.
 *
 * Um trecho também fecha aos 25 s, mesmo sem pausa, para a pessoa que fala sem
 * respirar não esperar muito para ver o texto aparecer. E trecho de 25 s sem
 * fala nenhuma é jogado fora sem enviar.
 *
 * Cada trecho é um MediaRecorder novo, e não pedaços de um só: os pedaços de
 * uma gravação contínua não se abrem sozinhos (só o primeiro tem o cabeçalho do
 * arquivo), e a transcrição recusaria do segundo em diante.
 */

const TICK_MS = 60;
const FALA_MINIMA_MS = 350;
const PAUSA_QUE_CORTA_MS = 850;
const TRECHO_MAXIMO_MS = 25_000;

const FORMATOS = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function useDitado(opcoes: {
  /** Microfone pronto e escuta não pausada. */
  ativo: boolean;
  leituraRef: RefObject<LeituraDoMicrofone>;
  aoTrecho: (audio: Blob) => void;
}) {
  const [falandoAgora, setFalandoAgora] = useState(false);
  const [semSuporte, setSemSuporte] = useState(false);

  // Por ref: trocar a função a cada render reiniciaria a gravação no meio da frase.
  const aoTrechoRef = useRef(opcoes.aoTrecho);
  useEffect(() => {
    aoTrechoRef.current = opcoes.aoTrecho;
  }, [opcoes.aoTrecho]);

  const { ativo, leituraRef } = opcoes;

  useEffect(() => {
    if (!ativo) return;
    const leitura = leituraRef.current;
    const original = leitura?.fluxo;
    const analisador = leitura?.analisador;
    if (!original || !analisador) return;
    if (typeof MediaRecorder === "undefined") {
      setSemSuporte(true);
      return;
    }
    const formato = FORMATOS.find((f) => MediaRecorder.isTypeSupported(f));

    /* Grava de uma CÓPIA do fluxo. Quando a escuta pausa, o microfone é solto
       pelo outro hook — e a limpeza dele roda antes desta. Gravando do fluxo
       original, a última frase dita antes da pausa se perderia com as trilhas
       já paradas; a cópia só para depois que o trecho final foi entregue. */
    const fluxo = original.clone();
    const amostra = new Uint8Array(analisador.fftSize);

    let gravador: MediaRecorder | null = null;
    let pedacos: Blob[] = [];
    let inicio = 0;
    let falaMs = 0;
    let silencioMs = 0;
    let ruido = 0.01;
    let falando = false;

    const iniciar = () => {
      pedacos = [];
      inicio = performance.now();
      falaMs = 0;
      silencioMs = 0;
      const g = new MediaRecorder(
        fluxo,
        formato ? { mimeType: formato, audioBitsPerSecond: 32_000 } : undefined,
      );
      const destes = pedacos;
      g.ondataavailable = (e) => {
        if (e.data.size > 0) destes.push(e.data);
      };
      g.start();
      gravador = g;
    };

    /** Fecha o trecho atual; `enviar` decide se ele vai para a transcrição. */
    const fechar = (enviar: boolean, depois?: () => void) => {
      const g = gravador;
      const destes = pedacos;
      gravador = null;
      if (!g) return depois?.();
      const aoParar = () => {
        if (enviar && destes.length) {
          const audio = new Blob(destes, { type: g.mimeType || formato || "audio/webm" });
          // Menos de ~1,5 KB não chega a meio segundo de áudio: é estalo, não fala.
          if (audio.size > 1500) aoTrechoRef.current(audio);
        }
        depois?.();
      };
      if (g.state !== "inactive") {
        g.onstop = aoParar;
        g.stop();
      } else aoParar();
    };

    const marcarFalando = (sim: boolean) => {
      if (sim === falando) return;
      falando = sim;
      setFalandoAgora(sim);
    };

    iniciar();

    const relogio = window.setInterval(() => {
      analisador.getByteTimeDomainData(amostra);
      let soma = 0;
      for (let i = 0; i < amostra.length; i++) {
        const x = ((amostra[i] ?? 128) - 128) / 128;
        soma += x * x;
      }
      const rms = Math.sqrt(soma / amostra.length);

      /* O limiar acompanha o ruído da sala: ar-condicionado e teclado sobem o
         chão, e um limiar fixo ou cortaria no meio das frases ou nunca
         cortaria. O ruído só é medido nos momentos sem voz. */
      const limiar = Math.max(0.02, ruido * 2.8);
      if (rms > limiar) {
        falaMs += TICK_MS;
        silencioMs = 0;
        marcarFalando(true);
      } else {
        silencioMs += TICK_MS;
        ruido = ruido * 0.97 + rms * 0.03;
        if (silencioMs > 300) marcarFalando(false);
      }

      const duracao = performance.now() - inicio;
      const teveFala = falaMs >= FALA_MINIMA_MS;
      if ((teveFala && silencioMs >= PAUSA_QUE_CORTA_MS) || duracao >= TRECHO_MAXIMO_MS) {
        fechar(teveFala);
        iniciar();
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(relogio);
      marcarFalando(false);
      // Pausar entrega o que já foi dito; as trilhas da cópia param depois.
      fechar(falaMs >= FALA_MINIMA_MS, () => fluxo.getTracks().forEach((t) => t.stop()));
    };
  }, [ativo, leituraRef]);

  return { falandoAgora, semSuporte };
}
