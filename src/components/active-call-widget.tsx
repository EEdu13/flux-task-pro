import { useEffect, useState } from "react";
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
import { Maximize2, X } from "lucide-react";
import { useActiveCall } from "@/lib/active-call-context";

export const ACTIVE_CALL_MOUNT_ID = "active-call-mount";

function CallContents({
  mini,
  roomLabel,
  onMaximize,
  onEnd,
}: {
  mini: boolean;
  roomLabel: string;
  onMaximize: () => void;
  onEnd: () => void;
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
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/70 px-2 py-1">
        <span className="truncate text-xs font-medium">Sala · {roomLabel}</span>
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
      <ControlBar
        variation="minimal"
        controls={{
          microphone: true,
          camera: true,
          screenShare: !mini,
          chat: false,
          leave: false,
          settings: false,
        }}
      />
      <RoomAudioRenderer />
    </div>
  );
}

export function ActiveCallWidget() {
  const { active, minimized, setMinimized, endCall } = useActiveCall();
  const location = useLocation();
  const navigate = useNavigate();
  const [rect, setRect] = useState<DOMRect | null>(null);

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

  if (!active) return null;

  const style: React.CSSProperties = docked && rect
    ? {
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: 40,
      }
    : {
        position: "fixed",
        bottom: 16,
        right: 16,
        width: 384,
        height: 260,
        zIndex: 90,
      };

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
          onMaximize={() => {
            setMinimized(false);
            if (!onRoomRoute) {
              navigate({ to: "/salas/$roomName", params: { roomName: active.roomName } });
            }
          }}
          onEnd={() => {
            endCall();
          }}
        />
      </LiveKitRoom>
    </div>,
    document.body,
  );
}