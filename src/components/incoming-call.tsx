import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Phone, PhoneOff } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listIncomingRoomCalls, updateRoomCallStatus } from "@/lib/livekit-token.functions";
import {
  closeIncomingCallWindow,
  desktopBringToFront,
  desktopFlashTaskbar,
  onCallAction,
  showIncomingCallWindow,
} from "@/lib/desktop";

const RING_WINDOW_MS = 45_000;

interface IncomingRoomCall {
  id: string;
  caller_user_id: string;
  target_user_id: string;
  room_name: string;
  room_label: string;
  status: string;
  created_at: string;
}

export function IncomingCall() {
  const { notifications, users, currentUser, dismissRoomCall, addMissedCallNotification } = useFluxo();
  const navigate = useNavigate();
  const seenRef = useRef<Set<string>>(new Set());
  const trackedRef = useRef<Map<string, IncomingRoomCall>>(new Map());
  const [initialized, setInitialized] = useState(false);
  const [remoteCalls, setRemoteCalls] = useState<IncomingRoomCall[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<number | null>(null);
  const alertedRef = useRef<string | null>(null);

  // Mark pre-existing notifications as "seen" on mount so we don't ring for old ones
  useEffect(() => {
    for (const n of notifications) seenRef.current.add(n.id);
    setInitialized(true);
    return () => {
      if (ringIntervalRef.current) window.clearInterval(ringIntervalRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // Calls must work between different browsers/devices, so poll the backend instead of only local state.
  useEffect(() => {
    let cancelled = false;
    async function pollIncomingCalls() {
      try {
        const res = await listIncomingRoomCalls();
        if (cancelled) return;
        // detect missed: previously tracked & ringing, now gone from ringing list and not handled locally
        const currentIds = new Set(res.calls.map((c) => c.id));
        trackedRef.current.forEach((prev, id) => {
          if (!currentIds.has(id) && !seenRef.current.has(`handled:remote:${id}`)) {
            addMissedCallNotification(prev.caller_user_id, prev.room_name, prev.room_label);
            seenRef.current.add(`handled:remote:${id}`);
          }
        });
        trackedRef.current = new Map(res.calls.map((c) => [c.id, c]));
        setRemoteCalls(res.calls);
      } catch {
        if (!cancelled) setRemoteCalls([]);
      }
    }
    pollIncomingCalls();
    const id = window.setInterval(pollIncomingCalls, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentUser.id]);

  const active = useMemo(() => {
    if (!initialized) return null;
    const remote = remoteCalls.find((c) => !seenRef.current.has(`handled:remote:${c.id}`));
    if (remote) {
      return {
        id: remote.id,
        source: "remote" as const,
        fromUserId: remote.caller_user_id,
        roomName: remote.room_name,
        roomLabel: remote.room_label,
        at: remote.created_at,
      };
    }
    const now = Date.now();
    const local = notifications.find(
      (n) =>
        n.userId === currentUser.id &&
        n.roomName &&
        n.fromUserId &&
        !n.read &&
        now - new Date(n.at).getTime() < RING_WINDOW_MS &&
        !seenRef.current.has(`handled:local:${n.id}`),
    );
    if (!local) return null;
    return {
      id: local.id,
      source: "local" as const,
      fromUserId: local.fromUserId!,
      roomName: local.roomName!,
      roomLabel: local.roomName!,
      at: local.at,
    };
  }, [notifications, remoteCalls, currentUser.id, initialized]);

  // A cada NOVA chamada abre o card nativo no canto da tela (estilo Teams),
  // pisca a barra e notifica — funciona mesmo com a janela escondida na bandeja.
  useEffect(() => {
    if (!active) {
      void closeIncomingCallWindow();
      return;
    }
    if (alertedRef.current === active.id) return;
    alertedRef.current = active.id;
    const caller = users.find((u) => u.id === active.fromUserId);
    const room = DEPARTMENT_ROOMS.find((r) => r.name === active.roomName);
    const callerName = caller?.name ?? "Alguém";
    void showIncomingCallWindow({
      callId: active.id,
      caller: callerName,
      roomLabel: room?.label ?? active.roomLabel ?? active.roomName,
      userId: currentUser.id,
      remote: active.source === "remote",
    });
    void desktopFlashTaskbar();
  }, [active, users, currentUser.id]);

  // Play ringtone while active
  useEffect(() => {
    if (!active) {
      if (ringIntervalRef.current) {
        window.clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      return;
    }
    const play = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx =
            (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
              .AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        const t0 = ctx.currentTime;
        [0, 0.4].forEach((offset) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0, t0 + offset);
          gain.gain.linearRampToValueAtTime(0.15, t0 + offset + 0.02);
          gain.gain.linearRampToValueAtTime(0, t0 + offset + 0.28);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + 0.3);
        });
      } catch {
        /* ignore audio errors (autoplay policies etc.) */
      }
    };
    play();
    ringIntervalRef.current = window.setInterval(play, 1500);
    return () => {
      if (ringIntervalRef.current) window.clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    };
  }, [active]);

  // Resolve a chamada — usado tanto pelos botões do app quanto pelo card nativo.
  const resolveCall = useCallback(
    async (action: "accept" | "decline") => {
      if (!active) return;
      seenRef.current.add(`handled:${active.source}:${active.id}`);
      if (active.source === "remote") {
        setRemoteCalls((calls) => calls.filter((c) => c.id !== active.id));
        await updateRoomCallStatus({
          data: {
            callId: active.id,
            status: action === "accept" ? "accepted" : "declined",
          },
        }).catch(() => {});
      } else {
        dismissRoomCall(active.id);
      }
      void closeIncomingCallWindow();
      if (action === "accept") {
        void desktopBringToFront();
        if (active.roomName) {
          navigate({ to: "/salas/$roomName", params: { roomName: active.roomName } });
        }
      }
    },
    [active, currentUser.id, dismissRoomCall, navigate],
  );

  // Escuta o que o usuário escolheu no card nativo do canto da tela.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onCallAction(({ action }) => {
      void resolveCall(action);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [resolveCall]);

  if (!active) return null;

  const caller = users.find((u) => u.id === active.fromUserId);
  const room = DEPARTMENT_ROOMS.find((r) => r.name === active.roomName);

  const accept = () => resolveCall("accept");
  const decline = () => resolveCall("decline");

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-3">
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {caller?.avatar ?? "?"}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-card">
            <Phone className="h-2.5 w-2.5 text-white" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{caller?.name ?? "Alguém"} está chamando</div>
          <div className="truncate text-xs text-muted-foreground">
            Sala {room?.label ?? active.roomLabel ?? active.roomName}
          </div>
        </div>
        <span className="flex h-2 w-2 animate-ping rounded-full bg-emerald-500" />
      </div>
      <div className="flex gap-2 p-3">
        <button
          onClick={decline}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm font-medium hover:bg-secondary"
        >
          <PhoneOff className="h-4 w-4" /> Recusar
        </button>
        <button
          onClick={accept}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
        >
          <Phone className="h-4 w-4" /> Atender
        </button>
      </div>
    </div>
  );
}