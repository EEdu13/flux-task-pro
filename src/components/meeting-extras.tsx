import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoomContext, useLocalParticipant, useParticipants } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import type { RemoteAudioTrack, LocalAudioTrack } from "livekit-client";
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
import { updateActiveSpeakers } from "@/lib/livekit-token.functions";
import { summarizeMeeting } from "@/lib/meeting-summary.functions";
import { useFluxo } from "@/lib/fluxo-store";
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

/** MediaRecorder-based client-side recording. Mixes local + all remote audio + screen if any. */
function useMeetingRecorder(roomName: string) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    if (recording) return;
    if (!room) return;
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();

    const connectTrack = (mediaStreamTrack: MediaStreamTrack) => {
      const src = audioCtx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
      src.connect(dest);
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

    // Optional: local screen share video
    const screenPub = localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const videoTracks: MediaStreamTrack[] = [];
    if (screenPub?.track?.mediaStreamTrack) videoTracks.push(screenPub.track.mediaStreamTrack);

    const stream = new MediaStream([...dest.stream.getAudioTracks(), ...videoTracks]);
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
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${roomName}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtx.close().catch(() => {});
      setRecording(false);
      setStartedAt(null);
    };
    recorderRef.current = rec;
    rec.start(1000);
    setRecording(true);
    setStartedAt(Date.now());
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

/** Live transcription of the LOCAL user via Web Speech API. */
function useTranscription(pushLine: (l: Line) => void, participantName: string) {
  const [enabled, setEnabled] = useState(false);
  const [supported] = useState(() => {
    if (typeof window === "undefined") return false;
    return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  });
  const recRef = useRef<unknown>(null);

  useEffect(() => {
    if (!enabled || !supported) return;
    const w = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: (e: {
        resultIndex: number;
        results: {
          length: number;
          [i: number]: { 0: { transcript: string }; isFinal: boolean };
        };
      }) => void;
      onerror: (e: unknown) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    r.continuous = true;
    r.interimResults = false;
    r.lang = "pt-BR";
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const text = res[0].transcript.trim();
          if (text) pushLine({ at: Date.now(), from: participantName, text });
        }
      }
    };
    r.onerror = () => {
      /* ignore */
    };
    r.onend = () => {
      // auto-restart if still enabled
      if (recRef.current === r) {
        try {
          r.start();
        } catch {
          /* ignore */
        }
      }
    };
    try {
      r.start();
      recRef.current = r;
    } catch {
      /* ignore */
    }
    return () => {
      recRef.current = null;
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    };
  }, [enabled, supported, pushLine, participantName]);

  return { enabled, setEnabled, supported };
}

export interface MeetingExtrasHandle {
  transcript: Line[];
  addChatLine: (l: Line) => void;
  triggerSummary: () => void;
}

export function MeetingExtras({
  roomName,
  roomLabel,
  chatLines,
}: {
  roomName: string;
  roomLabel: string;
  chatLines: Line[];
}) {
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

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [summaryState, setSummaryState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "done"; md: string } | { kind: "error"; msg: string }
  >({ kind: "idle" });

  const generate = useCallback(async () => {
    setSummaryState({ kind: "loading" });
    try {
      const participantNames = participants.map((p) => p.name || p.identity);
      const res = await summarizeMeeting({
        data: {
          roomLabel,
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
        roomLabel,
        participantIds,
        participantNames,
        markdown: res.markdown,
        topics,
      });
    } catch (e) {
      setSummaryState({
        kind: "error",
        msg: e instanceof Error ? e.message : "Falha ao gerar ata",
      });
    }
  }, [roomLabel, roomName, participants, transcript, chatLines, users, saveMinute]);

  const recDuration = useMemo(() => {
    if (!rec.recording || !rec.startedAt) return "";
    const s = Math.floor((Date.now() - rec.startedAt) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, [rec.recording, rec.startedAt]);

  return (
    <>
      <button
        type="button"
        onClick={() => (rec.recording ? rec.stop() : rec.start())}
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
      </button>

      {transcriptOpen && (
        <div className="absolute bottom-16 right-2 z-40 flex h-[70vh] w-[380px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-white/10 bg-neutral-950/95 text-xs text-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <FileText className="h-4 w-4" /> Ata da reunião
            </span>
            <button onClick={() => setTranscriptOpen(false)} className="rounded p-1 hover:bg-white/10">
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
    </>
  );
}