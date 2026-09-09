import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRoomContext, useLocalParticipant, useParticipants } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import type { RemoteAudioTrack, LocalAudioTrack, RemoteTrack } from "livekit-client";
import {
  Circle,
  Square,
  Captions,
  CaptionsOff,
  FileText,
  Loader2,
  Copy,
  Download,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { updateActiveSpeakers } from "@/lib/livekit-token.functions";
import { summarizeMeeting } from "@/lib/meeting-summary.functions";
import { transcribeSegment } from "@/lib/transcription.functions";
import { useFluxo } from "@/lib/fluxo-store";
import { criarCompositor, type Compositor, type FonteDeVideo } from "@/lib/composicao-gravacao";
import type { MinuteTopic } from "@/lib/fluxo-types";

/** Parse the AI markdown to extract actionable topics (decisions, next steps, attention). */
function parseTopics(md: string): Omit<MinuteTopic, "id">[] {
  const topics: Omit<MinuteTopic, "id">[] = [];
  const sections: Array<{ re: RegExp; kind: MinuteTopic["kind"] }> = [
    { re: /###\s*Decis[õo]es tomadas([\s\S]*?)(?=\n###|$)/i, kind: "decisao" },
    { re: /###\s*Pr[óo]ximos passos[^\n]*([\s\S]*?)(?=\n###|$)/i, kind: "proximo" },
    { re: /###\s*Pontos de aten[cç][ãa]o([\s\S]*?)(?=\n###|$)/i, kind: "atencao" },
  ];
  for (const { re, kind } of sections) {
    const m = md.match(re);
    if (!m) continue;
    const body = m[1];
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
      const bullet = line.match(/^\s*-\s*(?:\[[ x]\]\s*)?(.+?)\s*$/);
      if (!bullet) continue;
      const text = bullet[1].trim();
      if (!text) continue;
      if (/^nenhum[ao]/i.test(text)) continue;
      topics.push({ text, kind });
    }
  }
  return topics;
}

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

/**
 * Live transcription of the LOCAL user via Lovable AI STT.
 * Uses a fresh MediaRecorder per 6-second segment (start/stop each time) so
 * every uploaded blob is a self-contained webm file — the pattern documented
 * for chunked transcription. Result appears in ~1-2s vs. 15+s with the old
 * webkitSpeechRecognition path.
 */
const SEGMENT_MS = 6000;

function useTranscription(pushLine: (l: Line) => void, participantName: string) {
  const [enabled, setEnabled] = useState(false);
  const [supported] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
    );
  });
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!enabled || !supported) return;
    stoppedRef.current = false;
    let cancelled = false;
    let currentRec: MediaRecorder | null = null;

    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    const mime =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ||
      "audio/webm";

    async function loop() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Setup VAD analyser
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Uint8Array(analyser.frequencyBinCount);

        const measureLoud = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          return Math.sqrt(sum / buf.length);
        };

        while (!cancelled && !stoppedRef.current) {
          await new Promise<void>((resolve) => {
            const rec = new MediaRecorder(stream, { mimeType: mime });
            currentRec = rec;
            const chunks: Blob[] = [];
            let sawSound = false;
            const soundCheck = window.setInterval(() => {
              if (measureLoud() > 0.02) sawSound = true;
            }, 200);

            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };
            rec.onstop = async () => {
              window.clearInterval(soundCheck);
              const blob = new Blob(chunks, { type: mime });
              if (sawSound && blob.size > 1500) {
                try {
                  const buffer = await blob.arrayBuffer();
                  const bytes = new Uint8Array(buffer);
                  let bin = "";
                  const chunk = 0x8000;
                  for (let i = 0; i < bytes.length; i += chunk) {
                    bin += String.fromCharCode.apply(
                      null,
                      Array.from(bytes.subarray(i, i + chunk)),
                    );
                  }
                  const b64 = btoa(bin);
                  const res = await transcribeSegment({
                    data: { audioBase64: b64, mime, language: "pt" },
                  });
                  if (res.text) {
                    pushLine({
                      at: Date.now(),
                      from: participantName,
                      text: res.text,
                    });
                  }
                } catch (err) {
                  console.warn("[transcribe]", err);
                }
              }
              resolve();
            };
            try {
              rec.start();
            } catch {
              resolve();
              return;
            }
            window.setTimeout(() => {
              if (rec.state === "recording") {
                try {
                  rec.stop();
                } catch {
                  /* ignore */
                }
              }
            }, SEGMENT_MS);
          });
        }
      } catch (err) {
        console.warn("[transcribe] mic error", err);
      }
    }

    loop();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      if (currentRec && currentRec.state === "recording") {
        try {
          currentRec.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [enabled, supported, pushLine, participantName]);

  return { enabled, setEnabled, supported };
}

export interface MeetingExtrasHandle {
  hasContent: () => boolean;
  hasSavedMinute: () => boolean;
  generateAndSave: () => Promise<boolean>;
  openPanel: () => void;
}

export const MeetingExtras = forwardRef<
  MeetingExtrasHandle,
  {
    roomName: string;
    roomLabel: string;
    meetingTitle?: string;
    autoStartTranscription?: boolean;
    chatLines: Line[];
  }
>(function MeetingExtras(
  { roomName, roomLabel, meetingTitle, autoStartTranscription, chatLines },
  ref,
) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const participants = useParticipants();
  const { users, saveMinute } = useFluxo();
  useActiveSpeakerBroadcast(roomName);

  const [transcript, setTranscript] = useState<Line[]>([]);
  const pushLine = useCallback((l: Line) => {
    setTranscript((t) => [...t.slice(-500), l]);
    // Broadcast to peers so they see remote lines too
    try {
      room?.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ kind: "transcript", line: l })),
        { reliable: true, topic: "fluxo-transcript" },
      );
    } catch {
      /* ignore */
    }
  }, [room]);

  // Receive transcript from peers
  useEffect(() => {
    if (!room) return;
    const handler = (payload: Uint8Array) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; line?: Line };
        if (msg.kind === "transcript" && msg.line) {
          setTranscript((t) => [...t.slice(-500), msg.line as Line]);
        }
      } catch {
        /* ignore */
      }
    };
    const wrapped = (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
      if (topic === "fluxo-transcript") handler(payload);
    };
    room.on(RoomEvent.DataReceived, wrapped);
    return () => {
      room.off(RoomEvent.DataReceived, wrapped);
    };
  }, [room]);

  const rec = useMeetingRecorder(roomName);
  const meName = localParticipant.name || localParticipant.identity || "Eu";
  const tr = useTranscription(pushLine, meName);

  // Auto-start transcription if requested (once).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!autoStartTranscription) return;
    if (!tr.supported) return;
    autoStartedRef.current = true;
    tr.setEnabled(true);
  }, [autoStartTranscription, tr]);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [summaryState, setSummaryState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "done"; md: string } | { kind: "error"; msg: string }
  >({ kind: "idle" });
  const savedRef = useRef(false);

  const effectiveLabel = (meetingTitle && meetingTitle.trim()) || roomLabel;

  const generate = useCallback(async () => {
    setSummaryState({ kind: "loading" });
    try {
      const participantNames = participants.map((p) => p.name || p.identity);
      const res = await summarizeMeeting({
        data: {
          roomLabel: effectiveLabel,
          participants: participantNames,
          transcript,
          chat: chatLines,
        },
      });
      setSummaryState({ kind: "done", md: res.markdown });
      // Persist minute in the store, visible only to participants.
      const participantIds = Array.from(
        new Set(
          participants
            .map((p) => (p.identity || "").split("-")[0])
            .filter((id) => users.some((u) => u.id === id)),
        ),
      );
      const topics = parseTopics(res.markdown).map((t) => ({
        ...t,
        id: `top-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      }));
      saveMinute({
        roomName,
        roomLabel: effectiveLabel,
        participantIds,
        participantNames,
        markdown: res.markdown,
        topics,
      });
      savedRef.current = true;
      return true;
    } catch (e) {
      setSummaryState({
        kind: "error",
        msg: e instanceof Error ? e.message : "Falha ao gerar ata",
      });
      return false;
    }
  }, [effectiveLabel, roomName, participants, transcript, chatLines, users, saveMinute]);

  const hasContent = useCallback(
    () => transcript.length > 0 || chatLines.length > 0,
    [transcript.length, chatLines.length],
  );

  useImperativeHandle(
    ref,
    () => ({
      hasContent,
      hasSavedMinute: () => savedRef.current,
      generateAndSave: async () => {
        if (savedRef.current) return true;
        if (!hasContent()) return true;
        return await generate();
      },
      openPanel: () => setTranscriptOpen(true),
    }),
    [hasContent, generate],
  );

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

      {tr.supported && (
        <button
          type="button"
          onClick={() => tr.setEnabled((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
            tr.enabled
              ? "border-primary/60 bg-primary/20 text-white"
              : "border-white/15 bg-white/5 text-white hover:bg-white/10"
          }`}
          title={tr.enabled ? "Parar transcrição do seu áudio" : "Transcrever seu áudio ao vivo (pt-BR)"}
        >
          {tr.enabled ? <Captions className="h-3.5 w-3.5" /> : <CaptionsOff className="h-3.5 w-3.5" />}
          {tr.enabled ? "Transcrevendo" : "Legenda"}
        </button>
      )}

      <button
        type="button"
        onClick={() => setTranscriptOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
          transcriptOpen
            ? "border-primary/60 bg-primary/20 text-white"
            : "border-white/15 bg-white/5 text-white hover:bg-white/10"
        }`}
        title="Transcrição e ata da reunião"
      >
        <FileText className="h-3.5 w-3.5" />
        Ata
        {transcript.length > 0 && (
          <span className="ml-0.5 rounded-full bg-primary/60 px-1.5 py-0.5 text-[10px] font-bold leading-none">
            {transcript.length}
          </span>
        )}
        {hasContent() && !savedRef.current && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" title="Ata não salva" />
        )}
      </button>

      {/* Ancorado ACIMA da barra, não dentro dela.
          Este painel é irmão do botão, e o botão mora na barra de controles —
          que tem `relative`. Ou seja, o `100%` do `h-[calc(100%-5rem)]` que
          estava aqui era a altura da BARRA (~60px), não a da reunião: 60 menos
          80 dá negativo, o CSS trava em zero, e o painel abria como um risco
          fino de 380px de largura. O `top-12` ainda o empurrava para baixo.
          `bottom-full` + altura própria é o padrão que o painel de convidado
          já usa nesta mesma barra, alguns elementos acima. */}
      {transcriptOpen && (
        <div className="absolute bottom-full right-2 z-40 mb-2 flex h-[min(70vh,32rem)] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-white/10 bg-neutral-950/95 text-xs text-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <FileText className="h-4 w-4" /> Ata da reunião
              {hasContent() && !savedRef.current && (
                <span className="rounded-full border border-amber-400/50 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                  Não salva
                </span>
              )}
            </span>
            <button
              onClick={() => {
                if (hasContent() && !savedRef.current) {
                  setCloseConfirmOpen(true);
                } else {
                  setTranscriptOpen(false);
                }
              }}
              className="rounded p-1 hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {summaryState.kind === "done" ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-white/90">
                {summaryState.md}
              </pre>
            ) : summaryState.kind === "loading" ? (
              <div className="mt-4 flex items-center justify-center gap-2 text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Gerando ata com IA…
              </div>
            ) : summaryState.kind === "error" ? (
              <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-red-200">
                {summaryState.msg}
              </div>
            ) : transcript.length === 0 ? (
              <div className="mt-8 text-center text-white/50">
                Nenhuma fala transcrita ainda. Ative a "Legenda" pra começar.
              </div>
            ) : (
              <div className="space-y-1.5">
                {transcript.map((l, i) => (
                  <div key={i}>
                    <span className="text-white/40">
                      {new Date(l.at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>{" "}
                    <span className="font-semibold text-white/80">{l.from}:</span>{" "}
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/50 px-3 py-2">
            <button
              type="button"
              onClick={generate}
              disabled={summaryState.kind === "loading" || (transcript.length === 0 && chatLines.length === 0)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              <FileText className="h-3 w-3" />
              Gerar ata com IA
            </button>
            {summaryState.kind === "done" && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(summaryState.md).catch(() => {})}
                  className="rounded p-1.5 hover:bg-white/10"
                  title="Copiar"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([summaryState.md], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `ata-${roomName}-${new Date().toISOString().slice(0, 10)}.md`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  }}
                  className="rounded p-1.5 hover:bg-white/10"
                  title="Baixar .md"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {closeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-4 text-white shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-amber-300" />
              Salvar ata antes de fechar?
            </div>
            <p className="mt-2 text-xs text-white/70">
              Você tem falas transcritas ou mensagens de chat que ainda não viraram ata. Se fechar
              sem salvar, esse conteúdo será perdido quando a reunião terminar.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseConfirmOpen(false)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                Continuar aberto
              </button>
              <button
                type="button"
                onClick={() => {
                  setCloseConfirmOpen(false);
                  setTranscriptOpen(false);
                }}
                className="rounded-md border border-red-400/40 bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30"
              >
                Fechar sem salvar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setCloseConfirmOpen(false);
                  await generate();
                }}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95"
              >
                Salvar ata agora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});