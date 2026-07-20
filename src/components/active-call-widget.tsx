import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  FocusLayout,
  FocusLayoutContainer,
  CarouselLayout,
  ParticipantTile,
  useTracks,
  useDataChannel,
  useLocalParticipant,
  useRoomContext,
  useTrackToggle,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
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
  LayoutGrid,
  Presentation,
  Copy,
  Keyboard,
  Pencil,
  Check,
  FileText,
  Link2,
  Share2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorOff,
  PhoneOff,
  MoreHorizontal,
} from "lucide-react";
import { useActiveCall } from "@/lib/active-call-context";
import { useFluxo } from "@/lib/fluxo-store";
import { useCallInviter } from "@/lib/call-inviter-context";
import {
  createGuestInvite,
  getRoomAccess,
  setRoomPrivacy,
} from "@/lib/livekit-token.functions";
import { useCallShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { MeetingExtras, type MeetingExtrasHandle } from "@/components/meeting-extras";
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

/* Teams-style circular toolbar button */
function ToolBtn({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
  muted,
  disabled,
  badge,
  wide,
}: {
  icon: typeof X;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  muted?: boolean;
  disabled?: boolean;
  badge?: number;
  wide?: boolean;
}) {
  const base =
    "relative inline-flex items-center justify-center transition disabled:opacity-40";
  const size = danger
    ? wide
      ? "h-11 rounded-full px-6"
      : "h-11 w-14 rounded-full"
    : "h-11 w-11 rounded-full";
  const style = danger
    ? "bg-red-600 text-white hover:bg-red-500 shadow-md"
    : muted
      ? "bg-red-500/90 text-white hover:bg-red-500"
      : active
        ? "bg-white/25 text-white"
        : "bg-white/10 text-white/90 hover:bg-white/20"
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${size} ${style}`}
    >
      <Icon className="h-[20px] w-[20px]" />
      {wide && danger && <span className="ml-2 text-sm font-medium">Sair</span>}
      {badge && badge > 0 ? (
        <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function MediaToggle({
  source,
  IconOn,
  IconOff,
  labelOn,
  labelOff,
}: {
  source: Track.Source.Microphone | Track.Source.Camera | Track.Source.ScreenShare;
  IconOn: typeof X;
  IconOff: typeof X;
  labelOn: string;
  labelOff: string;
}) {
  const { enabled, pending, toggle } = useTrackToggle({ source });
  return (
    <ToolBtn
      icon={enabled ? IconOn : IconOff}
      label={enabled ? labelOn : labelOff}
      onClick={() => toggle()}
      disabled={pending}
      muted={!enabled && source !== Track.Source.ScreenShare}
      active={enabled && source === Track.Source.ScreenShare}
    />
  );
}

function Divider() {
  return <span className="mx-0.5 h-6 w-px bg-white/10" />;
}

/* Meet-style live clock */
function MeetClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="tabular-nums">
      {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

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
  const room = useRoomContext();
  const cameraTrack = localParticipant.getTrackPublication(Track.Source.Camera)
    ?.videoTrack as LocalVideoTrack | undefined;
  const [effect, setEffect] = useVideoEffect(cameraTrack);
  const [effectMenu, setEffectMenu] = useState(false);
  const { users, currentUser } = useFluxo();
  const { active: activeCall, setMeetingTitle } = useActiveCall();
  const meetingTitle = activeCall?.meetingTitle || roomLabel;
  const autoMinute = activeCall?.autoMinute ?? true;
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(meetingTitle);
  useEffect(() => {
    if (!titleEditing) setTitleDraft(meetingTitle);
  }, [meetingTitle, titleEditing]);
  const meetingRef = useRef<MeetingExtrasHandle | null>(null);
  const [endConfirm, setEndConfirm] = useState<null | "prompt" | "saving">(null);
  const [endError, setEndError] = useState<string | null>(null);

  const doEnd = useCallback(() => {
    // Explicitly disconnect LiveKit so audio/video tracks stop immediately —
    // otherwise, in rare cases (fast route changes, minimized-then-close), the
    // Room can stay alive and keep consuming mic/camera/bandwidth.
    try {
      room?.disconnect(true);
    } catch {
      /* ignore */
    }
    onEnd();
  }, [room, onEnd]);

  const requestEnd = useCallback(() => {
    // In mini mode we don't have room to show the "save minute" prompt, and
    // clicking X on the mini widget should just end the call. Otherwise the
    // user gets stuck: nothing happens, and the call keeps running.
    if (mini) {
      doEnd();
      return;
    }
    const h = meetingRef.current;
    if (h && h.hasContent() && !h.hasSavedMinute()) {
      setEndError(null);
      setEndConfirm("prompt");
      return;
    }
    doEnd();
  }, [doEnd, mini]);

  const saveThenEnd = useCallback(async () => {
    const h = meetingRef.current;
    if (!h) {
      doEnd();
      return;
    }
    setEndError(null);
    setEndConfirm("saving");
    const ok = await h.generateAndSave();
    if (!ok) {
      setEndError("Não foi possível gerar a ata. Tente novamente ou saia sem salvar.");
      setEndConfirm("prompt");
      return;
    }
    setEndConfirm(null);
    doEnd();
  }, [doEnd]);

  const { ask: askInvite } = useCallInviter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [privBusy, setPrivBusy] = useState(false);
  const [presenterMode, setPresenterMode] = useState<"auto" | "grid" | "focus">("auto");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestErr, setGuestErr] = useState<string | null>(null);
  const [guestCopied, setGuestCopied] = useState(false);

  async function generateGuestLink() {
    setGuestBusy(true);
    setGuestErr(null);
    setGuestCopied(false);
    try {
      const res = await createGuestInvite({
        data: { roomName, inviterUserId: currentUser.id, hours: 24 },
      });
      const url = `${window.location.origin}/convidado/${roomName}?t=${encodeURIComponent(res.token)}`;
      setGuestUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setGuestCopied(true);
      } catch {
        /* clipboard may be blocked; user can copy manually */
      }
    } catch (e) {
      setGuestErr(e instanceof Error ? e.message : "Não foi possível gerar o link");
    } finally {
      setGuestBusy(false);
    }
  }

  function openGuestPanel() {
    setGuestOpen(true);
    if (!guestUrl) void generateGuestLink();
  }

  // Poll privacy state so the lock button reflects reality.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await getRoomAccess({ data: { roomName, userId: currentUser.id } });
        if (!cancelled) {
          setIsPrivate(res.isPrivate);
        }
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
      await setRoomPrivacy({
        data: { roomName, isPrivate: next, userId: currentUser.id },
      });
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

  // Screen-share tile drives presenter mode
  const screenTracks = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const cameraTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const hasScreen = screenTracks.length > 0;
  const useFocus =
    hasScreen && (presenterMode === "auto" || presenterMode === "focus") && !mini;

  // Keyboard shortcuts (ignored in mini mode to avoid trapping global keys)
  useCallShortcuts({
    enabled: !mini,
    onToggleMic: () => {
      localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled).catch(() => {});
    },
    onToggleCam: () => {
      localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled).catch(() => {});
    },
    onEnd: requestEnd,
    onToggleChat: () => setChatOpen((v) => !v),
    onRaiseHand: raiseHand,
    onTogglePresenter: () =>
      setPresenterMode((m) => (m === "grid" ? "focus" : m === "focus" ? "auto" : "grid")),
  });

  // Chat lines shape for MeetingExtras (for the AI summary)
  const chatLines = messages
    .filter((m) => m.text)
    .map((m) => ({ at: m.at, from: m.fromName, text: m.text! }));

  return (
    <div
      className={`fluxo-meet ${mini ? "fluxo-meet-mini" : ""} flex h-full w-full flex-col text-white`}
      data-lk-theme="default"
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${mini ? "cursor-move select-none border-b border-white/10 bg-black/70" : ""}`}
        onPointerDown={mini ? onDragStart : undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium text-white/80">
          {mini && <GripHorizontal className="h-3.5 w-3.5 opacity-60" />}
          {mini || !titleEditing ? (
            <>
              <span className="truncate">
                <span className="opacity-60">{roomLabel} · </span>
                <span className="font-semibold text-white">{meetingTitle}</span>
              </span>
              {!mini && (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(meetingTitle);
                    setTitleEditing(true);
                  }}
                  className="rounded p-0.5 text-white/60 hover:bg-white/10 hover:text-white"
                  title="Renomear reunião (aparece na ata)"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </>
          ) : (
            <form
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                setMeetingTitle(titleDraft);
                setTitleEditing(false);
              }}
            >
              <input
                autoFocus
                value={titleDraft}
                maxLength={120}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  setMeetingTitle(titleDraft);
                  setTitleEditing(false);
                }}
                className="min-w-0 flex-1 rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-xs text-white outline-none focus:border-primary"
                placeholder="Título da reunião"
              />
              <button
                type="submit"
                className="rounded p-0.5 text-emerald-300 hover:bg-white/10"
                title="Salvar título"
              >
                <Check className="h-3 w-3" />
              </button>
            </form>
          )}
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
          {mini && (
            <button
              type="button"
              onClick={requestEnd}
              className="rounded p-1 text-red-300 hover:bg-red-500/20"
              title="Encerrar chamada"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {useFocus ? (
            <FocusLayoutContainer style={{ height: "100%" }}>
              <CarouselLayout tracks={cameraTracks}>
                <ParticipantTile />
              </CarouselLayout>
              <FocusLayout trackRef={screenTracks[0]} />
            </FocusLayoutContainer>
          ) : (
            <GridLayout tracks={tracks} style={{ height: "100%" }}>
              <ParticipantTile />
            </GridLayout>
          )}
          {hasScreen && !mini && (
            <button
              type="button"
              onClick={() =>
                setPresenterMode((m) => (m === "grid" ? "focus" : m === "focus" ? "grid" : "grid"))
              }
              className="absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur hover:bg-black/80"
              title="Alternar entre foco no apresentador e grade"
            >
              {useFocus ? <LayoutGrid className="h-3 w-3" /> : <Presentation className="h-3 w-3" />}
              {useFocus ? "Modo grade" : "Modo apresentador"}
            </button>
          )}
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
      <div className="relative flex items-center justify-between gap-2 px-3 py-3 sm:px-6">
        {/* Left: meeting info (Meet-style time · code) */}
        <div className="order-1 hidden min-w-0 flex-1 items-center gap-2 text-[13px] text-white/70 sm:flex">
          {!mini && <MeetClock />}
          {!mini && <span className="hidden truncate md:inline">· {roomName}</span>}
        </div>

        {/* Center: circular control cluster */}
        <div className="order-2 flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
          <MediaToggle
            source={Track.Source.Microphone}
            IconOn={Mic}
            IconOff={MicOff}
            labelOn="Silenciar microfone"
            labelOff="Ativar microfone"
          />
          <MediaToggle
            source={Track.Source.Camera}
            IconOn={Video}
            IconOff={VideoOff}
            labelOn="Desligar câmera"
            labelOff="Ligar câmera"
          />
          <MediaToggle
            source={Track.Source.ScreenShare}
            IconOn={MonitorOff}
            IconOff={MonitorUp}
            labelOn="Parar de compartilhar"
            labelOff="Compartilhar tela"
          />
          {mini && onMaximize && (
            <ToolBtn
              icon={Maximize2}
              label="Voltar à sala"
              onClick={onMaximize}
            />
          )}
          {!mini && (
            <>
              <ToolBtn
                icon={Hand}
                label="Levantar a mão"
                onClick={raiseHand}
              />
              <div className="relative">
                <ToolBtn
                  icon={Sparkles}
                  label="Fundo de vídeo"
                  onClick={() => setEffectMenu((v) => !v)}
                  active={effect !== "none" || effectMenu}
                />
                {effectMenu && (
                  <div className="absolute bottom-full left-1/2 z-30 mb-2 w-48 -translate-x-1/2 overflow-hidden rounded-md border border-white/10 bg-neutral-900 text-xs shadow-xl">
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
              <div className="relative">
                <ToolBtn
                  icon={UserPlus}
                  label="Convidar colaborador"
                  onClick={() => setInviteOpen((v) => !v)}
                  active={inviteOpen}
                />
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

              <div className="relative">
                <ToolBtn
                  icon={Link2}
                  label="Convidado externo (link)"
                  onClick={openGuestPanel}
                  active={guestOpen}
                />
                {guestOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-1 w-80 overflow-hidden rounded-md border border-white/10 bg-neutral-900 text-xs text-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Share2 className="h-3.5 w-3.5 text-sky-300" />
                      Convidar alguém externo
                    </span>
                    <button
                      type="button"
                      onClick={() => setGuestOpen(false)}
                      className="rounded p-1 hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="space-y-2 px-3 py-3">
                    <p className="text-[11px] leading-snug text-white/70">
                      Copie o link abaixo e envie por WhatsApp, e-mail ou onde preferir. Quem
                      receber entra na sala <b>{roomLabel}</b> só com o nome — não precisa criar
                      conta. O link vale por 24 horas.
                    </p>
                    {guestErr ? (
                      <div className="rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
                        {guestErr}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 p-1.5">
                      <input
                        readOnly
                        value={guestBusy ? "Gerando link…" : (guestUrl ?? "")}
                        onFocus={(e) => e.currentTarget.select()}
                        className="min-w-0 flex-1 truncate bg-transparent px-1 py-0.5 text-[11px] text-white outline-none"
                      />
                      <button
                        type="button"
                        disabled={!guestUrl || guestBusy}
                        onClick={async () => {
                          if (!guestUrl) return;
                          try {
                            await navigator.clipboard.writeText(guestUrl);
                            setGuestCopied(true);
                            window.setTimeout(() => setGuestCopied(false), 1600);
                          } catch {
                            /* ignore */
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded bg-sky-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
                      >
                        {guestCopied ? (
                          <>
                            <Check className="h-3 w-3" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copiar
                          </>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void generateGuestLink()}
                      disabled={guestBusy}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-60"
                    >
                      Gerar um novo link
                    </button>
                  </div>
                </div>
                )}
              </div>

              {/* Meeting minute (ata) — component brings its own button styling */}
              <MeetingExtras
                ref={meetingRef}
                roomName={roomName}
                roomLabel={roomLabel}
                meetingTitle={meetingTitle}
                autoStartTranscription={autoMinute}
                chatLines={chatLines}
              />
              <ToolBtn
                icon={PhoneOff}
                label="Encerrar chamada"
                onClick={requestEnd}
                danger
                wide
              />
            </>
          )}
          {mini && (
            <ToolBtn
              icon={PhoneOff}
              label="Encerrar chamada"
              onClick={requestEnd}
              danger
            />
          )}
        </div>

        {/* Right: chat / more (Meet-style) */}
        {!mini && (
          <div className="order-3 hidden min-w-0 flex-1 items-center justify-end gap-1 sm:flex">
            <ToolBtn
              icon={MessageSquare}
              label="Chat da sala"
              onClick={() => setChatOpen((v) => !v)}
              active={chatOpen}
              badge={!chatOpen ? unread : 0}
            />
            <div className="relative">
              <ToolBtn
                icon={MoreHorizontal}
                label="Mais opções"
                onClick={() => setShortcutsOpen((v) => !v)}
                active={shortcutsOpen}
              />
              {shortcutsOpen && (
                <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-md border border-white/10 bg-neutral-900 p-2 text-xs text-white shadow-xl">
                  {onMinimize && (
                    <button
                      type="button"
                      onClick={() => {
                        setShortcutsOpen(false);
                        onMinimize();
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/10"
                    >
                      <Maximize2 className="h-3.5 w-3.5 rotate-180" /> Modo mini
                    </button>
                  )}
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                      <Keyboard className="h-3 w-3" /> Atalhos
                    </div>
                    <ul className="space-y-1 px-2">
                      {[
                        ["M", "Mutar / desmutar mic"],
                        ["V", "Ligar / desligar câmera"],
                        ["C", "Abrir / fechar chat"],
                        ["H", "Levantar a mão"],
                        ["P", "Alternar modo apresentador"],
                        ["E", "Encerrar chamada"],
                      ].map(([key, desc]) => (
                        <li key={key} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-white/70">{desc}</span>
                          <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                            {key}
                          </kbd>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <RoomAudioRenderer />
      {endConfirm && !mini && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-900 p-5 text-white shadow-2xl">
            <div className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-5 w-5 text-amber-300" />
              Salvar ata desta reunião?
            </div>
            <p className="mt-2 text-xs text-white/70">
              Há falas transcritas / mensagens de chat que ainda não viraram ata. Se você encerrar
              sem salvar, todo esse conteúdo será perdido — a ata e o plano de ação em{" "}
              <b>Atas &amp; Planos</b> só aparecem se você salvar agora.
            </p>
            {endError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
                {endError}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={endConfirm === "saving"}
                onClick={() => setEndConfirm(null)}
                className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50"
              >
                Continuar reunião
              </button>
              <button
                type="button"
                disabled={endConfirm === "saving"}
                onClick={() => {
                  setEndConfirm(null);
                  doEnd();
                }}
                className="rounded-md border border-red-400/40 bg-red-500/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/30 disabled:opacity-50"
              >
                Sair sem salvar
              </button>
              <button
                type="button"
                disabled={endConfirm === "saving"}
                onClick={saveThenEnd}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-95 disabled:opacity-70"
              >
                {endConfirm === "saving" ? "Salvando ata…" : "Salvar ata e sair"}
              </button>
            </div>
          </div>
        </div>
      )}
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
            Nenhuma mensagem ainda. Diga oi
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