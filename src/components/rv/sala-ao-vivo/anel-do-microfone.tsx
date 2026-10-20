/*
 * anel-do-microfone.tsx — o anel verde em volta do botão do microfone que cresce com a voz.
 *
 * Por que: "estou sendo ouvido?" é a dúvida nº 1 numa chamada. O nível vem de um AnalyserNode
 * sobre a MESMA trilha que o LiveKit publica — nada de getUserMedia novo (seria outro aparelho,
 * outra permissão, e o mudo do LiveKit não valeria para ele). O estilo é escrito direto no
 * elemento a cada quadro, sem setState: 60 renders por segundo derrubariam a sala 3D.
 */
import { useEffect, useRef } from "react";
import { Track, type Room } from "livekit-client";

export function AnelDoMicrofone({
  room,
  contexto,
  ligado,
  versao,
}: {
  room: Room | null;
  contexto: AudioContext | null;
  ligado: boolean;
  /** Muda quando as trilhas mudam (trilha trocada = refazer a fonte). */
  versao: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const trilha = ligado
    ? room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack
    : undefined;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.boxShadow = "none";
    if (!trilha || !contexto || trilha.readyState !== "live") return;
    let fonte: MediaStreamAudioSourceNode;
    const analisador = contexto.createAnalyser();
    analisador.fftSize = 256;
    try {
      fonte = contexto.createMediaStreamSource(new MediaStream([trilha]));
      fonte.connect(analisador);
    } catch (e) {
      console.warn("[rv] anel do microfone sem fonte:", e);
      return;
    }
    const dados = new Uint8Array(analisador.fftSize);
    let suave = 0;
    let quadro = 0;
    const passo = () => {
      quadro = requestAnimationFrame(passo);
      analisador.getByteTimeDomainData(dados);
      let soma = 0;
      for (let i = 0; i < dados.length; i++) {
        const v = (dados[i]! - 128) / 128;
        soma += v * v;
      }
      const rms = Math.sqrt(soma / dados.length);
      // Sobe rápido e desce devagar: o anel acompanha a fala sem piscar.
      const alvo = Math.min(1, rms * 6);
      suave = alvo > suave ? alvo : suave * 0.9;
      el.style.boxShadow =
        suave < 0.03
          ? "none"
          : `0 0 0 ${(2 + suave * 6).toFixed(1)}px rgba(34,197,94,${(0.35 + suave * 0.5).toFixed(2)})`;
    };
    passo();
    return () => {
      cancelAnimationFrame(quadro);
      fonte.disconnect();
      el.style.boxShadow = "none";
    };
  }, [trilha, contexto, versao]);

  return (
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-xl transition-[box-shadow] duration-75"
    />
  );
}
