import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Lock, LockOpen, WifiOff, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { useActiveCall } from "@/lib/active-call-context";
import { ACTIVE_CALL_MOUNT_ID } from "@/components/active-call-widget";
import { PreCall } from "@/components/pre-call";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import {
  getKnockStatus,
  getRoomAccess,
  knockRoom,
  listRoomKnocks,
  resolveKnock,
  setRoomPrivacy,
} from "@/lib/livekit-token.functions";

export const Route = createFileRoute("/salas/$roomName")({
  component: RoomPage,
  head: ({ params }) => ({
    meta: [
      { title: `Sala ${params.roomName} · Fluxo` },
      { name: "description", content: "Sala de voz e vídeo do Fluxo." },
    ],
  }),
});

type AccessState =
  | { kind: "checking" }
  | { kind: "open" }
  | { kind: "member"; isPrivate: boolean }
  | { kind: "knocking"; knockId: string }
  | { kind: "denied" };

function RoomPage() {
  const { roomName } = Route.useParams();
  const { currentUser } = useFluxo();
  const { startCall, endCall, active, error } = useActiveCall();
  const navigate = useNavigate();
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [isPrivate, setIsPrivate] = useState(false);
  const [showPreCall, setShowPreCall] = useState(true);
  const [pendingPreCall, setPendingPreCall] = useState<{
    title: string;
    autoMinute: boolean;
    makePrivate: boolean;
  } | null>(null);
  const [knocks, setKnocks] = useState<
    { id: string; requester_user_id: string; requester_name: string }[]
  >([]);
  const startedRef = useRef(false);

  const identity = useMemo(
    () => `${currentUser.id}-${currentUser.name.replace(/\s+/g, "_")}`,
    [currentUser],
  );
  const roomLabel = useMemo(() => {
    const sector = roomName.split("-")[0];
    const base = DEPARTMENT_ROOMS.find((r) => r.name === sector)?.label ?? sector;
    const parts = roomName.split("-");
    if (parts.length === 1) return `${base} · Sala 1`;
    return `${base} · Sala ${parts[1]}`;
  }, [roomName]);
  const isDiretoria = useMemo(() => roomName.split("-")[0] === "diretoria", [roomName]);

  // Reset when navigating between rooms
  useEffect(() => {
    startedRef.current = false;
    setAccess({ kind: "checking" });
    // If we already have an active call for this room (e.g. returning from
    // minimized mode), skip the pre-call screen.
    setShowPreCall(!(active && active.roomName === roomName));
  }, [roomName, active]);

  // Check access + auto-knock if needed. If any request errors, keep
  // "checking" and retry — never silently fall back to "open".
  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;
    const run = async () => {
      try {
        const res = await getRoomAccess({ data: { roomName } });
        if (cancelled) return;
        setIsPrivate(res.isPrivate);
        if (!res.isPrivate) {
          setAccess({ kind: "open" });
        } else if (res.isMember) {
          setAccess({ kind: "member", isPrivate: true });
        } else {
          const k = await knockRoom({
            data: { roomName, userName: currentUser.name },
          });
          if (cancelled) return;
          if (k.status === "approved") {
            setAccess({ kind: "member", isPrivate: true });
          } else {
            setAccess({ kind: "knocking", knockId: k.knockId ?? "" });
          }
        }
      } catch {
        if (cancelled) return;
        retry = window.setTimeout(run, 1500);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (retry) window.clearTimeout(retry);
    };
  }, [roomName, currentUser.id, currentUser.name]);

  // Poll knock status while waiting
  useEffect(() => {
    if (access.kind !== "knocking" || !access.knockId) return;
    let cancelled = false;
    const knockId = access.knockId;
    const tick = async () => {
      try {
        const res = await getKnockStatus({ data: { knockId } });
        if (cancelled) return;
        if (res.status === "approved") setAccess({ kind: "member", isPrivate: true });
        else if (res.status === "denied") setAccess({ kind: "denied" });
      } catch {
        /* ignore */
      }
    };
    tick();
    // Havia aqui uma assinatura de realtime do Supabase em `public.room_knocks`.
    // Os pedidos migraram para o Azure SQL (`dbo.room_knocks`), então ela
    // escutava uma tabela que ninguém mais escreve: nunca disparava e ainda
    // mantinha um WebSocket aberto à toa. Quem faz o trabalho é a sondagem.
    const id = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [access]);

  // Start the call once we have access AND user finished pre-call
  useEffect(() => {
    if (startedRef.current) return;
    // Already connected to this room — no need to (re)start.
    if (active && active.roomName === roomName) {
      startedRef.current = true;
      return;
    }
    if (access.kind !== "open" && access.kind !== "member") return;
    if (showPreCall) return;
    startedRef.current = true;
    startCall({
      roomName,
      roomLabel,
      identity,
      name: currentUser.name,
      meetingTitle: pendingPreCall?.title,
      autoMinute: pendingPreCall?.autoMinute ?? true,
    });
  }, [access, showPreCall, active, roomName, roomLabel, identity, currentUser.id, currentUser.name, startCall, pendingPreCall]);

  // Poll pending knocks + privacy state as soon as we have access (member/open),
  // even while the LiveKit connection is still establishing, so incoming
  // requests appear immediately for whoever is already in the room.
  const insideRoom = active?.roomName === roomName;
  const canSeeKnocks = access.kind === "member" || access.kind === "open";
  const prevKnockIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!canSeeKnocks) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [ks, st] = await Promise.all([
          listRoomKnocks({ data: { roomName } }),
          getRoomAccess({ data: { roomName } }),
        ]);
        if (cancelled) return;
        // Play a soft chime when a NEW pending knock appears.
        const prev = prevKnockIdsRef.current;
        const nextIds = new Set(ks.knocks.map((k) => k.id));
        const hasNew = ks.knocks.some((k) => !prev.has(k.id));
        prevKnockIdsRef.current = nextIds;
        if (hasNew && prev.size >= 0) {
          try {
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
            setTimeout(() => ctx.close().catch(() => {}), 700);
          } catch {
            /* audio blocked, fine */
          }
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              const first = ks.knocks.find((k) => !prev.has(k.id));
              if (first) new Notification("Pedido para entrar", { body: `${first.requester_name} quer entrar em ${roomLabel}` });
            } catch {
              /* ignore */
            }
          }
        }
        setKnocks(ks.knocks);
        setIsPrivate(st.isPrivate);
      } catch {
        /* ignore */
      }
    };
    tick();
    // Aqui também havia realtime do Supabase prometendo aviso instantâneo do
    // pedido de entrada. Apontava para `public.room_knocks`, abandonada na
    // migração para o Azure SQL — nunca chegou a disparar. A sondagem abaixo é
    // que sustenta o recurso.
    const id = window.setInterval(tick, 2500);
    // Request browser notification permission once, silently.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try { Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
    }
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canSeeKnocks, roomName, currentUser.id, roomLabel]);

  const togglePrivacy = useCallback(async () => {
    const next = !isPrivate;
    setIsPrivate(next);
    try {
      await setRoomPrivacy({ data: { roomName, isPrivate: next } });
    } catch {
      setIsPrivate(!next);
    }
  }, [isPrivate, roomName, currentUser.id]);

  const answerKnock = useCallback(
    async (knockId: string, approve: boolean) => {
      setKnocks((k) => k.filter((x) => x.id !== knockId));
      try {
        await resolveKnock({ data: { knockId, approve } });
      } catch {
        /* ignore */
      }
    },
    [currentUser.id],
  );

  const connecting = access.kind === "checking" || !active || active.roomName !== roomName;

  const layoutActions = insideRoom && !isDiretoria ? (
    <button
      onClick={togglePrivacy}
      title={isPrivate ? "Sala privada — clique para abrir" : "Sala aberta — clique para privar"}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
        isPrivate
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
      }`}
    >
      {isPrivate ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
      {isPrivate ? "Privada" : "Aberta"}
    </button>
  ) : null;

  return (
    <FluxoLayout title={`Sala: ${roomLabel}`} breadcrumb="Salas Online" actions={layoutActions}>
      <div className="mx-auto h-[calc(100vh-8rem)] max-w-7xl">
        {access.kind === "knocking" ? (
          <WaitingScreen roomLabel={roomLabel} onCancel={() => navigate({ to: "/salas" })} />
        ) : access.kind === "denied" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center">
            <Lock className="h-10 w-10 text-destructive" />
            <div className="text-sm font-medium">Pedido recusado</div>
            <div className="max-w-md text-xs text-muted-foreground">
              Alguém que está na sala recusou seu pedido de entrada.
            </div>
            <button
              onClick={() => navigate({ to: "/salas" })}
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Voltar
            </button>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center">
            <WifiOff className="h-10 w-10 text-destructive" />
            <div className="text-sm font-medium text-destructive">
              Não foi possível entrar na sala
            </div>
            <div className="max-w-md text-xs text-muted-foreground">{error}</div>
            <button
              onClick={() => {
                endCall();
                navigate({ to: "/salas" });
              }}
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Voltar
            </button>
          </div>
        ) : showPreCall && (access.kind === "open" || access.kind === "member") ? (
          <PreCall
            roomLabel={roomLabel}
            alreadyPrivate={isPrivate}
            forcePrivate={isDiretoria}
            onEnter={(r) => {
              setPendingPreCall({ title: r.title, autoMinute: r.autoMinute, makePrivate: r.makePrivate });
              setShowPreCall(false);
              if ((isDiretoria || r.makePrivate) && !isPrivate) {
                setRoomPrivacy({
                  data: { roomName, isPrivate: true },
                }).catch(() => {});
              }
            }}
            onCancel={() => navigate({ to: "/salas" })}
          />
        ) : (
          <div
            id={ACTIVE_CALL_MOUNT_ID}
            className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card"
          >
            {connecting && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Conectando à sala…
              </div>
            )}
          </div>
        )}
      </div>
      {canSeeKnocks && isPrivate && knocks.length > 0 && typeof document !== "undefined" &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 top-20 z-[120] flex justify-center px-4">
            <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border-2 border-primary bg-card/98 shadow-2xl backdrop-blur ring-4 ring-primary/30 animate-in fade-in slide-in-from-top-4">
              <div className="border-b border-border bg-primary/15 px-5 py-3 text-sm font-bold uppercase tracking-wide text-primary">
                🔔 Pedidos para entrar ({knocks.length})
              </div>
              <ul className="max-h-[60vh] divide-y divide-border overflow-auto">
                {knocks.map((k) => (
                  <li key={k.id} className="flex items-center gap-3 px-5 py-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/20 text-base font-bold text-primary">
                      {k.requester_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-base font-medium">{k.requester_name}</span>
                    <button
                      onClick={() => answerKnock(k.id, true)}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-600"
                    >
                      <Check className="h-4 w-4" /> Aceitar
                    </button>
                    <button
                      onClick={() => answerKnock(k.id, false)}
                      className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </FluxoLayout>
  );
}

function WaitingScreen({ roomLabel, onCancel }: { roomLabel: string; onCancel: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center">
      <div className="relative">
        <Lock className="h-10 w-10 text-primary" />
        <span className="absolute -bottom-1 -right-1 flex h-3 w-3 animate-ping rounded-full bg-primary/60" />
      </div>
      <div className="text-sm font-medium">Aguardando aprovação…</div>
      <div className="max-w-md text-xs text-muted-foreground">
        A sala <span className="font-medium text-foreground">{roomLabel}</span> é privada. Enviamos
        um pedido para quem já está dentro. Assim que alguém aceitar, você entra automaticamente.
      </div>
      <button
        onClick={onCancel}
        className="mt-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/70"
      >
        Cancelar
      </button>
    </div>
  );
}

