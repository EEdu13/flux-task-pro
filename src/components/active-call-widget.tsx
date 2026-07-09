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
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Maximize2, X, GripHorizontal } from "lucide-react";
import { useActiveCall } from "@/lib/active-call-context";

export const ACTIVE_CALL_MOUNT_ID = "active-call-mount";

function CallContents({
  mini,
  roomLabel,
  onMaximize,
  onEnd,
  onMinimize,
  onDragStart,
}: {
  mini: boolean;
  roomLabel: string;
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
      <div className="min-h-0 flex-1 overflow-hidden">
        <GridLayout tracks={tracks} style={{ height: "100%" }}>
          <ParticipantTile />
        </GridLayout>
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