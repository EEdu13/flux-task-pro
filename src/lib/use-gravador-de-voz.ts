import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { lerMicrofonePreferido } from "@/lib/microfone-preferido";
import {
  formatoSuportado,
  motivoDaRecusa,
  nomeComDataHora,
  semCodecs,
  type GravacaoPronta,
} from "@/lib/gravacao-de-midia";

/**
 * O gravador do recado de voz (19/10/2026), estilo WhatsApp: aperta, fala,
 * para — e o recado sai.
 *
 * Opus a 32 kbps: voz fica clara e um minuto ocupa uns 240 KB, então o teto de
 * 3 minutos dá menos de 1 MB. O Safari não grava WebM; lá sai MP4/AAC, que ele
 * mesmo e os outros navegadores tocam.
 */

export const LIMITE_RECADO_S = 180;

const FORMATOS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** Quantas barrinhas a ondinha ao vivo mostra. */
const BARRAS = 24;
/** Recado mais curto que isto é clique sem querer, não recado. */
const MINIMO_S = 0.8;

export type EstadoDoGravador = "parado" | "pedindo" | "gravando";

export function useGravadorDeVoz(aoConcluir: (g: GravacaoPronta) => void) {
  const [estado, setEstado] = useState<EstadoDoGravador>("parado");
  const [segundos, setSegundos] = useState(0);
  const [niveis, setNiveis] = useState<number[]>(() => Array(BARRAS).fill(0));

  const aoConcluirRef = useRef(aoConcluir);
  aoConcluirRef.current = aoConcluir;

  /* Tudo o que precisa ser solto no fim mora num ref só — soltar o microfone
     de verdade é o que apaga o indicador vermelho da aba e do Windows. */
  const vivoRef = useRef<{
    fluxo: MediaStream;
    gravador: MediaRecorder;
    contexto: AudioContext | null;
    relogio: number;
    inicio: number;
    descartar: boolean;
  } | null>(null);

  const soltar = useCallback(() => {
    const v = vivoRef.current;
    if (!v) return;
    window.clearInterval(v.relogio);
    v.fluxo.getTracks().forEach((t) => t.stop());
    void v.contexto?.close().catch(() => {});
  }, []);

  const parar = useCallback(() => {
    const v = vivoRef.current;
    if (!v || v.gravador.state === "inactive") return;
    v.gravador.stop();
  }, []);

  const cancelar = useCallback(() => {
    const v = vivoRef.current;
    if (!v) return;
    v.descartar = true;
    if (v.gravador.state !== "inactive") v.gravador.stop();
  }, []);

  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const iniciar = useCallback(async () => {
    if (vivoRef.current) return;
    const formato = formatoSuportado(FORMATOS);
    if (!formato || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Este navegador não grava áudio", {
        description: "Use o Chrome ou o Edge atualizados, ou o app de mesa.",
      });
      return;
    }

    setEstado("pedindo");
    let fluxo: MediaStream;
    try {
      const preferido = lerMicrofonePreferido();
      fluxo = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(preferido ? { deviceId: { ideal: preferido } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      if (!montadoRef.current) return;
      setEstado("parado");
      const m = motivoDaRecusa(e, "microfone");
      toast.error(m.titulo, { description: m.descricao, duration: 9000 });
      return;
    }
    /* A pessoa fechou a tarefa/conversa enquanto o navegador pedia a
       permissão: o microfone NÃO pode ficar gravando sem ninguém ver. */
    if (!montadoRef.current) {
      fluxo.getTracks().forEach((t) => t.stop());
      return;
    }

    /* O nível ao vivo: um analisador que não vai para os alto-falantes (a
       pessoa não pode se ouvir de volta). Se o AudioContext falhar, a gravação
       segue sem a ondinha — ela é enfeite, o recado não. */
    let contexto: AudioContext | null = null;
    let analisador: AnalyserNode | null = null;
    try {
      contexto = new AudioContext();
      analisador = contexto.createAnalyser();
      analisador.fftSize = 512;
      contexto.createMediaStreamSource(fluxo).connect(analisador);
    } catch {
      contexto = null;
      analisador = null;
    }
    const amostra = new Uint8Array(analisador?.fftSize ?? 0);

    const pedacos: Blob[] = [];
    let gravador: MediaRecorder;
    try {
      gravador = new MediaRecorder(fluxo, { mimeType: formato, audioBitsPerSecond: 32_000 });
    } catch {
      fluxo.getTracks().forEach((t) => t.stop());
      void contexto?.close().catch(() => {});
      setEstado("parado");
      toast.error("Não consegui começar a gravação", {
        description: "Tente de novo ou use outro microfone.",
      });
      return;
    }
    gravador.ondataavailable = (ev) => {
      if (ev.data.size) pedacos.push(ev.data);
    };
    gravador.onstop = () => {
      const v = vivoRef.current;
      const duracao = v ? (Date.now() - v.inicio) / 1000 : 0;
      const descartar = v?.descartar ?? true;
      soltar();
      vivoRef.current = null;
      setEstado("parado");
      setSegundos(0);
      setNiveis(Array(BARRAS).fill(0));
      if (descartar) return;
      if (duracao < MINIMO_S) {
        toast.info("Recado muito curto", {
          description: "Segure a gravação e fale; aperte parar ao terminar.",
        });
        return;
      }
      const tipoMime = semCodecs(gravador.mimeType || formato);
      aoConcluirRef.current({
        arquivo: new Blob(pedacos, { type: tipoMime }),
        tipoMime,
        nome: nomeComDataHora("recado-de-voz", tipoMime),
        segundos: duracao,
      });
    };

    const inicio = Date.now();
    const relogio = window.setInterval(() => {
      const s = (Date.now() - inicio) / 1000;
      setSegundos(s);
      if (s >= LIMITE_RECADO_S) {
        // Passou de 3 minutos: para sozinho e manda o que gravou.
        window.clearInterval(relogio);
        toast.info("Recado de voz chegou a 3 minutos e foi enviado.");
        parar();
        return;
      }
      if (analisador) {
        analisador.getByteTimeDomainData(amostra);
        let soma = 0;
        for (let i = 0; i < amostra.length; i++) {
          const x = (amostra[i]! - 128) / 128;
          soma += x * x;
        }
        // Raiz da média, com ganho: voz normal fica entre 0,02 e 0,2.
        const nivel = Math.min(1, Math.sqrt(soma / amostra.length) * 4);
        setNiveis((n) => [...n.slice(1), nivel]);
      }
    }, 100);

    vivoRef.current = { fluxo, gravador, contexto, relogio, inicio, descartar: false };
    gravador.start(1000);
    setSegundos(0);
    setEstado("gravando");
  }, [parar, soltar]);

  // Saiu da tela no meio (fechou a tarefa, trocou de conversa): descarta.
  useEffect(
    () => () => {
      const v = vivoRef.current;
      if (!v) return;
      v.descartar = true;
      if (v.gravador.state !== "inactive") v.gravador.stop();
      soltar();
    },
    [soltar],
  );

  return { estado, segundos, niveis, iniciar, parar, cancelar };
}
