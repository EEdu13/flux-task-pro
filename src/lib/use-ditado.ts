import { useEffect, useRef, useState, type RefObject } from "react";
import type { LeituraDoMicrofone } from "@/lib/use-microfone";
import { criarSegmentador, gravacaoSuportada, type TrechoDeFala } from "@/lib/segmentador-de-fala";

export type { TrechoDeFala };

/**
 * A fala da Tarefa por voz cortada em frases, cada uma entregue como áudio.
 *
 * O corte e o filtro do que conta como fala moram em `segmentador-de-fala.ts`,
 * que a Ata da reunião também usa. Aqui: 850 ms de silêncio fecham a frase, e um
 * trecho fecha aos 25 s mesmo sem pausa, para a pessoa que fala sem respirar não
 * esperar muito para ver o texto aparecer.
 */
export function useDitado(opcoes: {
  /** Microfone pronto e escuta não pausada. */
  ativo: boolean;
  leituraRef: RefObject<LeituraDoMicrofone>;
  aoTrecho: (trecho: TrechoDeFala) => void;
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
    if (!gravacaoSuportada()) {
      setSemSuporte(true);
      return;
    }

    /* Grava de uma CÓPIA do fluxo. Quando a escuta pausa, o microfone é solto
       pelo outro hook — e a limpeza dele roda antes desta. Gravando do fluxo
       original, a última frase dita antes da pausa se perderia com as trilhas
       já paradas; a cópia só para depois que o trecho final foi entregue. */
    const fluxo = original.clone();
    const segmentador = criarSegmentador({
      fluxo,
      analisador,
      aoTrecho: (t) => aoTrechoRef.current(t),
      aoFalar: setFalandoAgora,
    });

    return () => {
      // Pausar entrega o que já foi dito; as trilhas da cópia param depois.
      segmentador.parar(true, () => fluxo.getTracks().forEach((t) => t.stop()));
    };
  }, [ativo, leituraRef]);

  return { falandoAgora, semSuporte };
}
