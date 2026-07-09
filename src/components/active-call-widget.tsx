import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
  useDataChannel,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import type { LocalVideoTrack } from "livekit-client";
import { BackgroundBlur, VirtualBackground } from "@livekit/track-processors";
import "@livekit/components-styles";
import {
  Maximize2,
  X,
  GripHorizontal,
  MessageSquare,
  Hand,
  Paperclip,
  Send,
  Download,
  Sparkles,
  UserPlus,
  Lock,
  LockOpen,
  Search,
} from "lucide-react";
import { useActiveCall } from "@/lib/active-call-context";
import { useFluxo } from "@/lib/fluxo-store";
import { useCallInviter } from "@/lib/call-inviter-context";
import { getRoomAccess, setRoomPrivacy } from "@/lib/livekit-token.functions";
import {
  filesToAttachments,
  formatBytes,
  isImage,
  openAttachment,
  downloadAttachment,
} from "@/lib/attachments";
import type { Attachment } from "@/lib/fluxo-types";
import videoBgOffice from "@/assets/video-bg-office.jpg";

export const ACTIVE_CALL_MOUNT_ID = "active-call-mount";

type ChatMessage = {
  id: string;
  from: string;
  fromName: string;
  text?: string;
  attachment?: { name: string; size: number; type: string; dataUrl: string };
  at: number;
};

type RaiseToast = { id: string; name: string };

type VideoEffect = "none" | "blur" | "office";
const EFFECT_STORAGE_KEY = "fluxo:video-effect";

function useVideoEffect(cameraTrack: LocalVideoTrack | undefined) {
  const [effect, setEffectState] = useState<VideoEffect>(() => {
    if (typeof window === "undefined") return "none";
    const v = window.localStorage.getItem(EFFECT_STORAGE_KEY);
    return v === "blur" || v === "office" ? v : "none";
  });

  useEffect(() => {
    if (!cameraTrack) return;
    let cancelled = false;
    (async () => {
      try {
        if (effect === "blur") {
          await cameraTrack.setProcessor(BackgroundBlur(12));
        } else if (effect === "office") {
          await cameraTrack.setProcessor(VirtualBackground(videoBgOffice));
        } else {
          await cameraTrack.stopProcessor();
        }
      } catch (e) {
        if (!cancelled) console.warn("Falha ao aplicar efeito de vídeo", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cameraTrack, effect]);

  const setEffect = (v: VideoEffect) => {
    setEffectState(v);
    try {
      window.localStorage.setItem(EFFECT_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  return [effect, setEffect] as const;
}

function CallContents({
  mini,
  roomLabel,
  roomName,
  onMaximize,
  onEnd,
  onMinimize,
  onDragStart,
}: {
  mini: boolean;
  roomLabel: string;
  roomName: string;
  onMaximize: () => void;
  onEnd: () => void;
  onMinimize?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const { localParticipant } = useLocalParticipant();
  const cameraTrack = localParticipant.getTrackPublication(Track.Source.Camera)
    ?.videoTrack as LocalVideoTrack | undefined;
  const [effect, setEffect] = useVideoEffect(cameraTrack);
  const [effectMenu, setEffectMenu] = useState(false);
  const { users, currentUser } = useFluxo();
  const { ask: askInvite } = useCallInviter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [privBusy, setPrivBusy] = useState(false);

  // Poll privacy state so the lock button reflects reality.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await getRoomAccess({ data: { roomName, userId: currentUser.id } });
        if (!cancelled) setIsPrivate(res.isPrivate);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [roomName, currentUser.id]);

  async function togglePrivacy() {
    if (privBusy) return;
    const next = !isPrivate;
    setIsPrivate(next);
    setPrivBusy(true);
    try {
      await setRoomPrivacy({ data: { roomName, isPrivate: next, userId: currentUser.id } });
    } catch {
      setIsPrivate(!next);
    } finally {
      setPrivBusy(false);
    }
  }

  const inviteMatches = inviteQuery.trim()
    ? users
        .filter(
          (u) =>
            u.id !== currentUser.id &&
            u.name.toLowerCase().includes(inviteQuery.trim().toLowerCase()),
        )
        .slice(0, 6)
    : users.filter((u) => u.id !== currentUser.id).slice(0, 6);

  const [chatOpen, setChatOpen] = useState(false);
  const chatStorageKey = `fluxo:chat:${roomName}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(chatStorageKey);
      return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      // cap to last 200 to keep storage bounded
      const trimmed = messages.slice(-200);
      window.localStorage.setItem(chatStorageKey, JSON.stringify(trimmed));
    } catch {
      /* ignore quota errors */
    }
  }, [messages, chatStorageKey]);
  const [raises, setRaises] = useState<RaiseToast[]>([]);
  const [unread, setUnread] = useState(0);
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  const pushRaise = (name: string) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setRaises((r) => [...r, { id, name }]);
    setTimeout(() => setRaises((r) => r.filter((x) => x.id !== id)), 4500);
  };

  const { send } = useDataChannel("fluxo-room", (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | { kind: "chat"; msg: ChatMessage }
        | { kind: "raise"; name: string };
      if (data.kind === "chat") {
        setMessages((m) => [...m, data.msg]);
        if (!chatOpenRef.current) setUnread((n) => n + 1);
      } else if (data.kind === "raise") {
        pushRaise(data.name);
      }
    } catch {
      /* ignore */
    }
  });

  const broadcast = (payload: object) => {
    if (!send) return;
    try {
      send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true });
    } catch {
      /* ignore */
    }
  };

  const sendMessage = (text: string, attachment?: ChatMessage["attachment"]) => {
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;
    const msg: ChatMessage = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      from: localParticipant.identity,
      fromName: localParticipant.name || localParticipant.identity || "Eu",
      text: trimmed || undefined,
      attachment,
      at: Date.now(),
    };
    setMessages((m) => [...m, msg]);
    broadcast({ kind: "chat", msg });
  };

  const raiseHand = () => {
    const name = localParticipant.name || localParticipant.identity || "Alguém";
    pushRaise(name);
    broadcast({ kind: "raise", name });
  };

  const showChat = chatOpen && !mini;

  return (
    <div className="flex h-full w-full flex-col bg-black text-white" data-lk-theme="default">
      <div
        className={`flex items-center justify-between gap-2 border-b border-white/10 bg-black/70 px-2 py-1 ${mini ? "cursor-move select-none" : ""}`}
        onPointerDown={mini ? onDragStart : undefined}
      >
        <span className="flex items-center gap-1 truncate text-xs font-medium">
          {mini && <GripHorizontal className="h-3.5 w-3.5 opacity-60" />}
          Sala · {roomLabel}
        </span>
        <div className="flex items-center gap-1">
          {mini && (
            <button
              type="button"
              onClick={onMaximize}
              className="rounded p-1 hover:bg-white/10"
              title="Voltar à sala"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onEnd}
            className="rounded p-1 text-red-300 hover:bg-red-500/20"
            title="Encerrar chamada"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          <GridLayout tracks={tracks} style={{ height: "100%" }}>
            <ParticipantTile />
          </GridLayout>
          {raises.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex flex-col items-center gap-1.5">
              {raises.map((r) => (
                <div
                  key={r.id}
                  className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-400/95 px-3 py-1.5 text-xs font-semibold text-black shadow-lg"
                >
                  <Hand className="h-3.5 w-3.5" />
                  {r.name} levantou a mão
                </div>
              ))}
            </div>
          )}
        </div>
        {showChat && (
          <ChatPanel
            messages={messages}
            selfId={localParticipant.identity}
            onSend={sendMessage}
            onClose={() => setChatOpen(false)}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/70 px-2 py-1">
        <ControlBar
          variation="minimal"
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            chat: false,
            leave: false,
            settings: false,
          }}
          style={{ border: "none", padding: 0, background: "transparent" }}
        />
        <div className="flex items-center gap-1.5">
          {!mini && (
            <button
              type="button"
              onClick={togglePrivacy}
              disabled={privBusy}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                isPrivate
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
                  : "border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
              } disabled:opacity-60`}
              title={
                isPrivate
                  ? "Sala privada — clique para abrir"
                  : "Sala aberta — clique para privar (só quem for aceito entra)"
              }
            >
              {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              {isPrivate ? "Privada" : "Aberta"}
            </button>
          )}
          {!mini && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setInviteOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                  inviteOpen
                    ? "border-primary/60 bg-primary/20 text-white"
                    : "border-white/15 bg-white/5 text-white hover:bg-white/10"
                }`}
                title="Chamar alguém para esta sala"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Convidar
              </button>
              {inviteOpen && (
                <div className="absolute bottom-full right-0 z-30 mb-1 w-64 overflow-hidden rounded-md border border-white/10 bg-neutral-900 text-xs shadow-xl">
                  <div className="relative border-b border-white/10 p-2">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                    <input
                      autoFocus
                      value={inviteQuery}
                      onChange={(e) => setInviteQuery(e.target.value)}
                      placeholder="Buscar colaborador…"
                      className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-7 pr-2 text-xs text-white outline-none placeholder:text-white/40 focus:border-primary/60"
                    />
                  </div>
                  <ul className="max-h-56 overflow-auto py-1">
                    {inviteMatches.length === 0 ? (
                      <li className="px-3 py-3 text-center text-[11px] text-white/50">
                        Ninguém encontrado.
                      </li>
                    ) : (
                      inviteMatches.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            onClick={() => {
                              askInvite(u.id, roomName, roomLabel);
                              setInviteOpen(false);
                              setInviteQuery("");
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10"
                          >
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">
                              {u.avatar || u.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{u.name}</span>
                            <UserPlus className="h-3 w-3 text-primary" />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
          {!mini && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setEffectMenu((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                  effect !== "none"
                    ? "border-primary/60 bg-primary/20 text-white"
                    : "border-white/15 bg-white/5 text-white hover:bg-white/10"
                }`}
                title="Fundo de vídeo"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Fundo
              </button>
              {effectMenu && (
                <div className="absolute bottom-full right-0 z-30 mb-1 w-48 overflow-hidden rounded-md border border-white/10 bg-neutral-900 text-xs shadow-xl">
                  {([
                    { id: "none", label: "Sem efeito" },
                    { id: "blur", label: "Fundo desfocado" },
                    { id: "office", label: "Escritório" },
                  ] as { id: VideoEffect; label: string }[]).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setEffect(o.id);
                        setEffectMenu(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/10 ${
                        effect === o.id ? "bg-white/5 text-primary" : "text-white"
                      }`}
                    >
                      <span>{o.label}</span>
                      {effect === o.id && <span className="text-[10px]">●</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!mini && (
            <button
              type="button"
              onClick={raiseHand}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-400/20"
              title="Levantar a mão — avisa todo mundo na sala"
            >
              <Hand className="h-3.5 w-3.5" />
              Mão
            </button>
          )}
          {!mini && (
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className={`relative inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                chatOpen
                  ? "border-primary/60 bg-primary/20 text-white"
                  : "border-white/15 bg-white/5 text-white hover:bg-white/10"
              }`}
              title="Chat da sala"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
              {!chatOpen && unread > 0 && (
                <span className="ml-0.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {unread}
                </span>
              )}
            </button>
          )}
          {!mini && onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-white/10"
              title="Minimiza a chamada para o cantinho e mantém você conectado"
            >
              <Maximize2 className="h-3.5 w-3.5 rotate-180" />
              Modo mini
            </button>
          )}
          <button
            type="button"
            onClick={onEnd}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            title="Encerrar chamada"
          >
            <X className="h-3.5 w-3.5" />
            Sair
          </button>
        </div>
      </div>
      <RoomAudioRenderer />
    </div>
  );
}

function ChatPanel({
  messages,
  selfId,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string, attachment?: ChatMessage["attachment"]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const { ok, rejected } = await filesToAttachments([files[0]], selfId);
    if (rejected.length) setError(`Arquivo muito grande: ${rejected.join(", ")}`);
    if (ok[0]) setPending(ok[0]);
  }

  function submit() {
    if (!text.trim() && !pending) return;
    onSend(
      text,
      pending
        ? { name: pending.name, size: pending.size, type: pending.type, dataUrl: pending.dataUrl }
        : undefined,
    );
    setText("");
    setPending(null);
    setError(null);
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-neutral-950/95 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs font-semibold">
        <span className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Chat da sala
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-white/10"
          title="Fechar chat"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-xs">
        {messages.length === 0 ? (
          <div className="mt-6 text-center text-[11px] text-white/50">
            Nenhuma mensagem ainda. Diga oi 👋
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.from === selfId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <div className="mb-0.5 flex items-center gap-1 text-[10px] text-white/50">
                  <span className="font-medium text-white/70">{mine ? "Você" : m.fromName}</span>
                  <span>·</span>
                  <span>
                    {new Date(m.at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div
                  className={`max-w-[90%] rounded-lg px-2 py-1.5 leading-snug ${
                    mine ? "bg-primary text-primary-foreground" : "bg-white/10 text-white"
                  }`}
                >
                  {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
                  {m.attachment && (
                    <div className={`${m.text ? "mt-1.5" : ""}`}>
                      {isImage(m.attachment.type) ? (
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() => openAttachment(m.attachment!)}
                            className="block overflow-hidden rounded-md"
                            title="Abrir imagem"
                          >
                            <img
                              src={m.attachment.dataUrl}
                              alt={m.attachment.name}
                              className="max-h-40 w-auto rounded-md"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadAttachment(m.attachment!)}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                              mine ? "bg-black/20" : "bg-black/40"
                            } hover:opacity-90`}
                          >
                            <Download className="h-3 w-3" />
                            Baixar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadAttachment(m.attachment!)}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                            mine ? "bg-black/20" : "bg-black/40"
                          } hover:opacity-90`}
                        >
                          <Download className="h-3 w-3" />
                          <span className="max-w-[140px] truncate">{m.attachment.name}</span>
                          <span className="opacity-70">({formatBytes(m.attachment.size)})</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      {pending && (
        <div className="flex items-center gap-2 border-t border-white/10 bg-white/5 px-3 py-1.5 text-[11px]">
          <Paperclip className="h-3 w-3" />
          <span className="min-w-0 flex-1 truncate">{pending.name}</span>
          <span className="text-white/50">{formatBytes(pending.size)}</span>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="rounded p-0.5 hover:bg-white/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {error && (
        <div className="border-t border-white/10 bg-red-500/20 px-3 py-1 text-[10px] text-red-200">
          {error}
        </div>
      )}
      <div className="flex items-end gap-1 border-t border-white/10 bg-black/50 px-2 py-1.5">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded p-1.5 hover:bg-white/10"
          title="Anexar arquivo (máx. 3 MB)"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Escrever mensagem…"
          className="min-h-[28px] flex-1 resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none placeholder:text-white/40 focus:border-primary/60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() && !pending}
          className="rounded-md bg-primary p-1.5 text-primary-foreground disabled:opacity-40"
          title="Enviar (Enter)"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}

const MINI_STORAGE_KEY = "fluxo:mini-call-box";
const DEFAULT_MINI = { x: -1, y: -1, w: 384, h: 260 };
const MIN_W = 260;
const MIN_H = 180;

export function ActiveCallWidget() {
  const { active, minimized, setMinimized, endCall } = useActiveCall();
  const location = useLocation();
  const navigate = useNavigate();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [box, setBox] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_MINI;
    try {
      const raw = window.localStorage.getItem(MINI_STORAGE_KEY);
      if (raw) return { ...DEFAULT_MINI, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_MINI;
  });
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; box: typeof DEFAULT_MINI } | null>(null);

  const roomPath = active ? `/salas/${active.roomName}` : null;
  const onRoomRoute = !!roomPath && location.pathname === roomPath;
  const docked = !!active && onRoomRoute && !minimized;

  // Track the mount container's position when docked so we can render as fixed
  // (portaled to body) without unmounting LiveKitRoom on route change.
  useEffect(() => {
    if (!docked) {
      setRect(null);
      return;
    }
    let raf = 0;
    let stopped = false;
    let observed: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;

    const update = () => {
      const el = document.getElementById(ACTIVE_CALL_MOUNT_ID);
      if (!el) {
        setRect(null);
        return;
      }
      if (el !== observed) {
        observed = el;
        ro?.disconnect();
        ro = new ResizeObserver(() => setRect(el.getBoundingClientRect()));
        ro.observe(el);
      }
      setRect(el.getBoundingClientRect());
    };

    const loop = () => {
      if (stopped) return;
      update();
      raf = window.requestAnimationFrame(() => {
        window.setTimeout(loop, 250);
      });
    };
    loop();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [docked, location.pathname]);

  // Persist mini box
  useEffect(() => {
    try {
      window.localStorage.setItem(MINI_STORAGE_KEY, JSON.stringify(box));
    } catch {}
  }, [box]);

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (d.mode === "move") {
      const w = d.box.w;
      const h = d.box.h;
      const x = Math.min(Math.max(0, d.box.x + dx), vw - w);
      const y = Math.min(Math.max(0, d.box.y + dy), vh - h);
      setBox({ ...d.box, x, y });
    } else {
      const w = Math.min(Math.max(MIN_W, d.box.w + dx), vw - d.box.x);
      const h = Math.min(Math.max(MIN_H, d.box.h + dy), vh - d.box.y);
      setBox({ ...d.box, w, h });
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };
  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    // Resolve current effective box (in case x/y are -1 defaults)
    const cur = { ...box };
    if (cur.x < 0 || cur.y < 0) {
      cur.x = window.innerWidth - cur.w - 16;
      cur.y = window.innerHeight - cur.h - 16;
    }
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, box: cur };
    setBox(cur);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  if (!active) return null;

  const miniStyle: React.CSSProperties = box.x < 0 || box.y < 0
    ? { position: "fixed", bottom: 16, right: 16, width: box.w, height: box.h, zIndex: 90 }
    : { position: "fixed", top: box.y, left: box.x, width: box.w, height: box.h, zIndex: 90 };
  const style: React.CSSProperties = docked && rect
    ? {
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 40,
      }
    : miniStyle;

  const containerClass = docked
    ? "overflow-hidden rounded-xl border border-border bg-black shadow-lg"
    : "overflow-hidden rounded-xl border border-border bg-black shadow-2xl";

  return createPortal(
    <div style={style} className={containerClass}>
      <LiveKitRoom
        key={active.roomName + "|" + active.identity}
        token={active.token}
        serverUrl={active.serverUrl}
        connect
        audio
        video
        style={{ height: "100%", width: "100%" }}
        onDisconnected={() => endCall()}
      >
        <CallContents
          mini={!docked}
          roomLabel={active.roomLabel}
          roomName={active.roomName}
          onDragStart={!docked ? startDrag("move") : undefined}
          onMinimize={docked ? () => {
            setMinimized(true);
            navigate({ to: "/salas" });
          } : undefined}
          onMaximize={() => {
            setMinimized(false);
            if (!onRoomRoute) {
              navigate({ to: "/salas/$roomName", params: { roomName: active.roomName } });
            }
          }}
          onEnd={() => {
            endCall();
            if (onRoomRoute) {
              navigate({ to: "/salas" });
            }
          }}
        />
        {!docked && (
          <div
            onPointerDown={startDrag("resize")}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 0 50%, rgba(255,255,255,0.5) 50% 60%, transparent 60% 70%, rgba(255,255,255,0.5) 70% 80%, transparent 80% 100%)",
            }}
            title="Redimensionar"
          />
        )}
      </LiveKitRoom>
    </div>,
    document.body,
  );
}