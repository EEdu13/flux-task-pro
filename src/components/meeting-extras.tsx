import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useRoomContext, useLocalParticipant } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import type { RemoteAudioTrack, LocalAudioTrack, RemoteTrack } from "livekit-client";
import { Circle, Square } from "lucide-react";
import { toast } from "sonner";
import { updateActiveSpeakers } from "@/lib/livekit-token.functions";
import { criarCompositor, type Compositor, type FonteDeVideo } from "@/lib/composicao-gravacao";
import { useAtaDaReuniao } from "@/lib/use-ata-da-reuniao";
import {
  AtaMinimizada,
  BotaoDaAta,
  PainelDaAta,
  type VistaDaAta,
} from "@/components/ata-da-reuniao";

type Line = { at: number; from: string; text: string };

/** Broadcast `activeSpeakers` (identity list) to the server for the room card outside. */
function useActiveSpeakerBroadcast(roomName: string) {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return;
    let lastKey = "";
    let lastSent = 0;
    const send = (ids: string[]) => {
      const key = ids.slice().sort().join(",");
      const now = Date.now();
      if (key === lastKey && now - lastSent < 3000) return;
      lastKey = key;
      lastSent = now;
      updateActiveSpeakers({ data: { roomName, speakers: ids } }).catch(() => {});
    };
    const onChange = () => {
      const ids = room.activeSpeakers.map((p) => p.identity);
      send(ids);
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onChange);
    // Push an initial empty state so stale server rows clear quickly.
    send([]);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onChange);
      send([]);
    };
  }, [room, roomName]);
}

/**
 * Entrega o arquivo gravado.
 *
 * É a parte que mais falha, e falhava sem deixar rastro: o clique programático
 * num `<a download>` funciona no navegador, mas no app desktop (Tauri/WebView2)
 * pode ser barrado em silêncio — a gravação termina, o blob existe na memória, e
 * nada aparece em lugar nenhum. Sem aviso, isso é indistinguível de "a gravação
 * não funciona".
 *
 * Por isso o aviso fica na tela com um botão: se o automático não pegou, o
 * clique da pessoa é um gesto de usuário de verdade, que é o que as políticas de
 * download costumam exigir. O `revoke` foi de 5s para 2min pelo mesmo motivo —
 * com 5 segundos o botão de repetir apontaria para um endereço já morto.
 */
function entregarGravacao(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const baixar = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  baixar();
  const mb = (blob.size / 1024 / 1024).toFixed(1);
  toast.success("Gravação encerrada.", {
    id: "gravacao-reuniao",
    duration: 30_000,
    description: `${nome} (${mb} MB). Se o download não começou sozinho, use o botão.`,
    action: { label: "Baixar", onClick: baixar },
  });
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** MediaRecorder-based client-side recording. Mixes local + all remote audio + screen if any. */
function useMeetingRecorder(roomName: string) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const compositorRef = useRef<Compositor | null>(null);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (recording) return;
    if (!room) return;

    /* Tudo daqui para baixo estava sem rede de proteção: o clique chamava esta
       função assíncrona sem `catch`, então qualquer recusa do navegador — mime
       não suportado, contexto de áudio bloqueado — sumia como promessa
       rejeitada e o botão simplesmente não acendia. */
    let audioCtx: AudioContext | null = null;
    try {
      audioCtx = new AudioContext();
      const ctx = audioCtx;
      const dest = ctx.createMediaStreamDestination();

      let fontesConectadas = 0;
      const connectTrack = (mediaStreamTrack: MediaStreamTrack) => {
        const src = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
        src.connect(dest);
        fontesConectadas++;
      };

      // Local mic
      const localMic = localParticipant.getTrackPublication(Track.Source.Microphone);
      const localMicTrack = localMic?.track as LocalAudioTrack | undefined;
      if (localMicTrack?.mediaStreamTrack) connectTrack(localMicTrack.mediaStreamTrack);

      // Remote audio tracks
      room.remoteParticipants.forEach((p) => {
        p.audioTrackPublications.forEach((pub) => {
          const t = pub.track as RemoteAudioTrack | undefined;
          if (t?.mediaStreamTrack) connectTrack(t.mediaStreamTrack);
        });
      });

      /* Vídeo: TODAS as câmeras, não só o compartilhamento de tela.
         Antes só entrava a tela compartilhada — sem apresentação, o arquivo
         saía sem imagem nenhuma apesar de todo mundo estar com a câmera
         aberta. `MediaRecorder` aceita uma faixa de vídeo só, então as
         câmeras são compostas num canvas. Ver `composicao-gravacao.ts`. */
      const montarFontes = (): FonteDeVideo[] => {
        const lista: FonteDeVideo[] = [];
        const juntar = (
          pub: { track?: { mediaStreamTrack?: MediaStreamTrack; attach?: () => HTMLMediaElement } },
          nome: string,
          tela: boolean,
        ) => {
          const t = pub?.track;
          if (!t?.mediaStreamTrack || !t.attach) return;
          const el = t.attach() as HTMLVideoElement;
          el.muted = true; // o som já vem pela mistura de áudio; aqui duplicaria
          void el.play?.().catch(() => {});
          lista.push({ el, nome, tela });
        };

        const meuNome = localParticipant.name || "Eu";
        juntar(localParticipant.getTrackPublication(Track.Source.ScreenShare) ?? {}, meuNome, true);
        juntar(localParticipant.getTrackPublication(Track.Source.Camera) ?? {}, meuNome, false);
        room.remoteParticipants.forEach((p) => {
          const nome = p.name || p.identity;
          juntar(p.getTrackPublication(Track.Source.ScreenShare) ?? {}, nome, true);
          juntar(p.getTrackPublication(Track.Source.Camera) ?? {}, nome, false);
        });
        return lista;
      };

      const fontesDeVideo = montarFontes();

      /* Sem nenhuma fonte, o destino ainda produz uma faixa — muda — e a
         gravação sairia com um arquivo de silêncio puro. Vale avisar em vez de
         entregar isso vinte minutos depois. */
      if (fontesConectadas === 0 && fontesDeVideo.length === 0) {
        await ctx.close().catch(() => {});
        toast.error("Não há o que gravar agora.", {
          description:
            "Nenhum microfone aberto e nenhuma câmera ou tela em transmissão. " +
            "Abra o microfone ou a câmera e grave de novo.",
        });
        return;
      }

      /* O compositor existe mesmo sem câmera nenhuma: ele desenha um quadro
         escuro dizendo "somente áudio", o que é melhor do que um .webm sem
         faixa de vídeo — este último alguns players recusam abrir. */
      const compositor = criarCompositor(fontesDeVideo);
      compositorRef.current = compositor;

      const stream = new MediaStream([...dest.stream.getAudioTracks(), compositor.faixa]);
      streamRef.current = stream;

      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      /* Quem entra DEPOIS do start também entra na mistura.
         A montagem acima é uma fotografia do instante do clique: sem isto, quem
         chegasse no meio da reunião ficava mudo no arquivo, e nada na tela
         indicava a falta — só se descobre ouvindo a gravação depois. */
      const aoAssinar = (t: RemoteTrack) => {
        try {
          if (t.kind === Track.Kind.Audio && t.mediaStreamTrack) {
            connectTrack(t.mediaStreamTrack);
            return;
          }
          // Câmera ou tela de quem chegou depois entra na composição sem
          // interromper a gravação — o compositor só troca a lista de fontes.
          if (t.kind === Track.Kind.Video) compositor.atualizar(montarFontes());
        } catch {
          /* uma faixa a menos na mistura não justifica derrubar a gravação */
        }
      };
      /* Sair da reunião ou fechar a câmera também muda a imagem. Sem
         `TrackUnsubscribed`, o compositor continuaria desenhando um elemento
         parado — a última imagem de quem saiu, congelada até o fim do arquivo. */
      const aoSair = (t: RemoteTrack) => {
        if (t.kind !== Track.Kind.Video) return;
        try {
          compositor.atualizar(montarFontes());
        } catch {
          /* ignore */
        }
      };
      room.on(RoomEvent.TrackSubscribed, aoAssinar);
      room.on(RoomEvent.TrackUnsubscribed, aoSair);

      const encerrar = () => {
        room.off(RoomEvent.TrackSubscribed, aoAssinar);
        room.off(RoomEvent.TrackUnsubscribed, aoSair);
        compositorRef.current?.parar();
        compositorRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        ctx.close().catch(() => {});
        setRecording(false);
        setStartedAt(null);
      };
      rec.onerror = () => {
        toast.error("A gravação parou por um erro do navegador.", {
          description:
            chunksRef.current.length > 0
              ? "O trecho gravado até aqui será entregue."
              : "Nada foi gravado.",
        });
        if (chunksRef.current.length > 0) {
          entregarGravacao(
            new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" }),
            `${roomName}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
          );
        }
        encerrar();
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
        if (blob.size > 0) {
          entregarGravacao(
            blob,
            `${roomName}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
          );
        } else {
          toast.error("A gravação saiu vazia.", {
            description: "Nenhum áudio foi capturado — o arquivo não foi gerado.",
          });
        }
        encerrar();
      };
      recorderRef.current = rec;
      rec.start(1000);
      setRecording(true);
      setStartedAt(Date.now());
    } catch (e) {
      await audioCtx?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setRecording(false);
      setStartedAt(null);
      toast.error("Não foi possível iniciar a gravação.", {
        description: e instanceof Error ? e.message : "O navegador recusou a captura de áudio.",
      });
    }
  }, [recording, room, localParticipant, roomName]);

  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    },
    [],
  );

  return { recording, start, stop, startedAt };
}

export interface MeetingExtrasHandle {
  hasContent: () => boolean;
  hasSavedMinute: () => boolean;
  generateAndSave: () => Promise<boolean>;
  openPanel: () => void;
}

/**
 * Gravar e Ata, na barra da reunião.
 *
 * Fica montado também no modo mini da chamada — só os botões e o painel somem.
 * Antes ele saía da árvore no mini, e a gravação e as falas transcritas iam
 * junto: minimizar a chamada no meio da reunião perdia a ata.
 */
export const MeetingExtras = forwardRef<
  MeetingExtrasHandle,
  {
    roomName: string;
    roomLabel: string;
    meetingTitle?: string;
    autoStartTranscription?: boolean;
    chatLines: Line[];
    mini?: boolean;
    /** A caixa da reunião: a ata minimizada se posiciona na sobra à direita dela. */
    containerRef: RefObject<HTMLElement | null>;
  }
>(function MeetingExtras(
  { roomName, roomLabel, meetingTitle, autoStartTranscription, chatLines, mini, containerRef },
  ref,
) {
  useActiveSpeakerBroadcast(roomName);

  const effectiveLabel = (meetingTitle && meetingTitle.trim()) || roomLabel;
  const [vista, setVista] = useState<VistaDaAta>("fechada");

  const ata = useAtaDaReuniao({
    roomName,
    titulo: effectiveLabel,
    chat: chatLines,
    autoIniciar: !!autoStartTranscription,
    aoComecar: (como, quem) => {
      if (como === "automatico") {
        // Ata automática começa discreta, já no canto.
        setVista((v) => (v === "fechada" ? "minimizada" : v));
      } else {
        toast.info(`${quem} começou a ata da reunião`, {
          id: "ata-por-outro",
          description: "As falas desta reunião estão sendo transcritas. Clique em Ata para acompanhar.",
        });
      }
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      hasContent: () => ata.temConteudoNaoSalvo(),
      hasSavedMinute: () => !!ata.estado?.salva,
      generateAndSave: () => ata.finalizarESalvar(),
      openPanel: () => setVista("aberta"),
    }),
    [ata],
  );

  const aoClicarNaAta = () => {
    const e = ata.estado;
    if (!e || (ata.donoSaiu && !ata.falas.length)) {
      ata.iniciar();
      setVista("aberta");
      return;
    }
    const ouvindo = e.fase === "ouvindo" && !ata.donoSaiu;
    setVista((v) => (v === "aberta" ? (ouvindo ? "minimizada" : "fechada") : "aberta"));
  };

  const rec = useMeetingRecorder(roomName);

  /* O relógio precisa de uma batida por segundo para andar.
     Antes isto era um `useMemo` com deps `[recording, startedAt]` — e nenhuma
     das duas muda ENQUANTO grava. Resultado: calculava uma vez, no instante do
     start, e mostrava "Gravando 0:00" até o fim, o que parecia gravação
     travada mesmo quando estava tudo certo. */
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!rec.recording) return;
    setAgora(Date.now());
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [rec.recording]);

  const recDuration = useMemo(() => {
    if (!rec.recording || !rec.startedAt) return "";
    const s = Math.max(0, Math.floor((agora - rec.startedAt) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, [rec.recording, rec.startedAt, agora]);

  if (mini) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (rec.recording ? rec.stop() : void rec.start())}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
          rec.recording
            ? "border-red-500/60 bg-red-500/20 text-red-200 animate-pulse"
            : "border-white/15 bg-white/5 text-white hover:bg-white/10"
        }`}
        title={rec.recording ? "Parar gravação e baixar .webm" : "Gravar reunião (baixa .webm no seu computador)"}
      >
        {rec.recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Circle className="h-3.5 w-3.5 fill-current" />}
        {rec.recording ? `Gravando ${recDuration}` : "Gravar"}
      </button>

      {ata.suportado && <BotaoDaAta ata={ata} vista={vista} onClick={aoClicarNaAta} />}

      {vista === "aberta" && (
        <PainelDaAta
          ata={ata}
          aoMinimizar={() => setVista("minimizada")}
          aoFechar={() => setVista("fechada")}
          nomeDoArquivo={`ata-${roomName}-${new Date().toISOString().slice(0, 10)}.md`}
        />
      )}
      {vista === "minimizada" && (
        <AtaMinimizada ata={ata} alvo={containerRef} aoExpandir={() => setVista("aberta")} />
      )}
    </>
  );
});
