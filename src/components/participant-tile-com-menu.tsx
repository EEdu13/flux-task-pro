import { forwardRef } from "react";
import { ParticipantTile, useTrackRefContext, type ParticipantTileProps } from "@livekit/components-react";
import type { Participant } from "livekit-client";

/**
 * Chamado com quem foi clicada e onde, para quem está por fora decidir se (e
 * onde) abre o menu de volume.
 */
export type AbrirMenuDeVolume = (participant: Participant, x: number, y: number) => void;

/**
 * O `<ParticipantTile />` de sempre, com um clique direito a mais.
 *
 * Existe porque `<GridLayout>` e `<CarouselLayout>` (a fita do modo
 * apresentador) clonam o filho único que recebem — sempre `<ParticipantTile />`
 * — uma vez por participante, envolvido no `TrackRefContext` daquela pessoa.
 * Substituir o filho por este componente é o único jeito de saber, dentro do
 * clique, QUEM foi clicado: `useTrackRefContext()` só existe porque quem está
 * chamando já colocou este componente dentro daquele contexto.
 *
 * Fica num arquivo à parte porque as duas telas de chamada usam — a grade
 * comum, em `active-call-widget.tsx`, e a fita ao lado da apresentação, em
 * `apresentacao-com-bolha.tsx` — e as duas importam de `active-call-widget`,
 * então um componente vivendo lá dentro criaria um import circular.
 */
export const ParticipantTileComMenu = forwardRef<
  HTMLDivElement,
  /* Opcional: quem não passa (a sala de convidado, por exemplo) mantém o
     clique direito comum do navegador — ninguém perde nada por não ligar o
     menu de volume. */
  ParticipantTileProps & { aoAbrirMenu?: AbrirMenuDeVolume }
>(function ParticipantTileComMenu({ aoAbrirMenu, ...props }, ref) {
  const trackRef = useTrackRefContext();
  return (
    <ParticipantTile
      ref={ref}
      {...props}
      onContextMenu={
        aoAbrirMenu &&
        ((e) => {
          // Ninguém ajusta o próprio volume para si mesmo — o LiveKit nem
          // manda de volta o que você publica, não haveria o que regular.
          if (trackRef.participant.isLocal) return;
          e.preventDefault();
          aoAbrirMenu(trackRef.participant, e.clientX, e.clientY);
        })
      }
    />
  );
});
