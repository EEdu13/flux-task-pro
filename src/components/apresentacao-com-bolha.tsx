import { useRef, useState } from "react";
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  VideoTrack,
} from "@livekit/components-react";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-react";
import {
  guardarBolha,
  moverBolha,
  posicaoDaBolha,
  posicaoLimitada,
  type PosicaoDaBolha,
} from "@/lib/bolha-da-camera";
import {
  ParticipantTileComMenu,
  type AbrirMenuDeVolume,
} from "@/components/participant-tile-com-menu";

/**
 * Apresentação com o rosto de quem apresenta numa bolha por cima.
 *
 * Antes, quando alguém compartilhava a tela, TODAS as câmeras iam para a fita
 * lateral — inclusive a de quem estava apresentando, que é justamente o rosto
 * que a sala quer ver enquanto o slide passa. Agora esse rosto sobe para um
 * círculo sobre a transmissão e sai da fita: aparecer nos dois lugares seria a
 * mesma cara duas vezes na tela.
 *
 * A bolha se arrasta porque ela tapa alguma coisa por definição, e o que ela
 * tapa é sempre o canto de baixo — onde mora rodapé, total de tabela, número
 * de página. O compositor da gravação já tinha essa preocupação registrada
 * (desenha a tela INTEIRA, com barras, para não cortar canto de slide); poder
 * mover é o que devolve essa garantia para quem está apresentando.
 *
 * A mesma peça serve a sala do time e a sala de convidado, para as duas verem
 * a apresentação do mesmo jeito.
 */
export function ApresentacaoComBolha({
  tela,
  cameras,
  aoAbrirMenu,
}: {
  tela: TrackReferenceOrPlaceholder;
  cameras: TrackReferenceOrPlaceholder[];
  /** Clique direito em alguém: menu de volume, só para quem clicou. Sem isto
      (a sala de convidado, por exemplo), o clique direito fica no padrão do
      navegador. */
  aoAbrirMenu?: AbrirMenuDeVolume;
}) {
  const areaRef = useRef<HTMLDivElement | null>(null);

  /* Câmera ABERTA de quem está com a tela no palco.
     `withPlaceholder` faz o LiveKit devolver uma entrada para quem está de
     câmera fechada também — sem publicação, ou com publicação silenciada. Essa
     entrada não vira bolha: círculo preto com nada dentro é ruído, e o rosto
     simplesmente não existe naquele momento. */
  const doApresentador = cameras.find(
    (c): c is TrackReference =>
      c.participant.identity === tela.participant.identity &&
      !!c.publication &&
      !c.publication.isMuted,
  );
  const outras = cameras.filter((c) => c !== doApresentador);

  return (
    <div ref={areaRef} className="relative h-full w-full">
      {outras.length > 0 ? (
        <FocusLayoutContainer style={{ height: "100%" }}>
          <CarouselLayout tracks={outras}>
            <ParticipantTileComMenu aoAbrirMenu={aoAbrirMenu} />
          </CarouselLayout>
          <FocusLayout trackRef={tela} />
        </FocusLayoutContainer>
      ) : (
        /* Ninguém mais de câmera aberta: sem fita, e a tela fica com a altura
           toda em vez de reservar espaço para uma faixa vazia. */
        <FocusLayout trackRef={tela} style={{ height: "100%" }} />
      )}
      {doApresentador && (
        <Bolha trackRef={doApresentador} areaRef={areaRef} aoAbrirMenu={aoAbrirMenu} />
      )}
    </div>
  );
}

function Bolha({
  trackRef,
  areaRef,
  aoAbrirMenu,
}: {
  trackRef: TrackReference;
  areaRef: React.RefObject<HTMLDivElement | null>;
  aoAbrirMenu?: AbrirMenuDeVolume;
}) {
  const [pos, setPos] = useState<PosicaoDaBolha>(() => posicaoDaBolha());
  const bolhaRef = useRef<HTMLDivElement | null>(null);
  const arrastando = useRef(false);

  /** Centro em fração, já impedido de sair da área pelas próprias bordas. */
  const posicaoDoPonteiro = (clienteX: number, clienteY: number): PosicaoDaBolha | null => {
    const area = areaRef.current;
    const bolha = bolhaRef.current;
    if (!area || !bolha) return null;
    const r = area.getBoundingClientRect();
    return posicaoLimitada(
      { x: clienteX - r.left, y: clienteY - r.top },
      { largura: r.width, altura: r.height },
      { largura: bolha.offsetWidth, altura: bolha.offsetHeight },
    );
  };

  return (
    <div
      ref={bolhaRef}
      role="presentation"
      onPointerDown={(e) => {
        arrastando.current = true;
        /* A captura é o que mantém o arrasto vivo quando o ponteiro sai da
           bolha — sem ela, mover rápido "solta" a bolha no meio do caminho.
           Dentro de try porque ela recusa um pointerId que já não está ativo,
           e perder a captura é degradar o arrasto, não motivo para quebrar a
           chamada inteira. */
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* segue sem captura */
        }
      }}
      onPointerMove={(e) => {
        if (!arrastando.current) return;
        const p = posicaoDoPonteiro(e.clientX, e.clientY);
        if (!p) return;
        setPos(p);
        /* O módulo é avisado a cada movimento, e não só ao soltar: o
           compositor da gravação lê dele a cada quadro, então é isto que faz o
           arquivo acompanhar o arrasto em tempo real. */
        moverBolha(p);
      }}
      onPointerUp={(e) => {
        if (!arrastando.current) return;
        arrastando.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* idem */
        }
        guardarBolha();
      }}
      onContextMenu={
        aoAbrirMenu &&
        ((e) => {
          // A bolha pode ser a SUA própria câmera (você é quem apresenta) —
          // aí não há o que regular, ninguém ajusta o próprio volume para si.
          if (trackRef.participant.isLocal) return;
          e.preventDefault();
          aoAbrirMenu(trackRef.participant, e.clientX, e.clientY);
        })
      }
      style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
      title="Arraste para tirar do canto do slide"
      /* `touch-none`: sem isso, no touch o navegador interpreta o arrasto como
         rolagem e a bolha não sai do lugar.

         `z-10`, e não mais que isso: acima do vídeo, abaixo dos controles da
         chamada (que são z-20). Mais alto, a bolha arrastada para o canto
         superior esquerdo ficaria por cima do botão "Modo grade" e engoliria
         o clique dele — e sair do modo apresentador é justamente o que a
         pessoa tentaria fazer nessa hora. */
      className="absolute z-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none select-none overflow-hidden rounded-full border-2 border-white/80 bg-black shadow-2xl active:cursor-grabbing sm:h-36 sm:w-36"
    >
      <VideoTrack trackRef={trackRef} className="h-full w-full object-cover" />
    </div>
  );
}
