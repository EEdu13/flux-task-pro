import { useEffect, useRef, useState } from "react";

/**
 * Microfone só para MEDIR a voz — volume e espectro, quadro a quadro.
 *
 * Nada aqui grava, guarda ou envia áudio. O sinal entra num `AnalyserNode` e
 * morre ali: o analisador não é ligado a lugar nenhum, nem aos alto-falantes
 * (o que também evita a microfonia de ouvir a própria voz de volta).
 *
 * Existe para o orbe da Tarefa por voz reagir à voz de verdade. Quando a IA
 * chegar, o mesmo fluxo de áudio é o que será transcrito — mas isso é outra
 * etapa, e vai precisar de um aviso explícito para a pessoa.
 */

export type EstadoMicrofone = "desligado" | "pedindo" | "ativo" | "negado" | "indisponivel";

export interface LeituraDoMicrofone {
  analisador: AnalyserNode | null;
  /** Energia por faixa de frequência, 0–255. Vazio sem microfone. */
  espectro: Uint8Array<ArrayBuffer>;
  /** A onda no tempo, 0–255 (128 é silêncio). Vazio sem microfone. */
  onda: Uint8Array<ArrayBuffer>;
}

const VAZIA = (): LeituraDoMicrofone => ({
  analisador: null,
  espectro: new Uint8Array(0),
  onda: new Uint8Array(0),
});

/**
 * Liga o microfone enquanto `ligado` for true, e o SOLTA ao desligar.
 *
 * Soltar de verdade (parar as trilhas, fechar o AudioContext) e não só silenciar
 * é o que apaga o indicador de microfone do Windows e da aba. Pausar a escuta
 * com o indicador aceso seria dizer "parei de ouvir" com o sistema dizendo o
 * contrário.
 *
 * A leitura vive num ref, e não em estado, porque quem a consome é um laço de
 * desenho a 60 quadros por segundo — em estado seriam 60 renders por segundo.
 */
export function useMicrofone(ligado: boolean) {
  const [estado, setEstado] = useState<EstadoMicrofone>("desligado");
  const leituraRef = useRef<LeituraDoMicrofone>(VAZIA());

  useEffect(() => {
    if (!ligado) {
      setEstado("desligado");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setEstado("indisponivel");
      return;
    }

    let cancelado = false;
    let fluxo: MediaStream | null = null;
    let contexto: AudioContext | null = null;
    setEstado("pedindo");

    navigator.mediaDevices
      .getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .then((s) => {
        // Fechou o modal enquanto o navegador ainda perguntava.
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        fluxo = s;
        contexto = new AudioContext();
        const analisador = contexto.createAnalyser();
        analisador.fftSize = 512;
        // Suaviza o espectro entre quadros: sem isto as barras tremem em vez
        // de respirar com a fala.
        analisador.smoothingTimeConstant = 0.78;
        contexto.createMediaStreamSource(s).connect(analisador);
        leituraRef.current = {
          analisador,
          espectro: new Uint8Array(analisador.frequencyBinCount),
          onda: new Uint8Array(analisador.fftSize),
        };
        setEstado("ativo");
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        const nome = e instanceof DOMException ? e.name : "";
        setEstado(
          nome === "NotAllowedError" || nome === "SecurityError" ? "negado" : "indisponivel",
        );
      });

    return () => {
      cancelado = true;
      fluxo?.getTracks().forEach((t) => t.stop());
      void contexto?.close().catch(() => {});
      leituraRef.current = VAZIA();
    };
  }, [ligado]);

  return { estado, leituraRef };
}
