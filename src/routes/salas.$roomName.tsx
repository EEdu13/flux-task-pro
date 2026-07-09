import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, LockOpen, WifiOff, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { useActiveCall } from "@/lib/active-call-context";
import { ACTIVE_CALL_MOUNT_ID } from "@/components/active-call-widget";
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

  // Reset when navigating between rooms
  useEffect(() => {
    startedRef.current = false;
    setAccess({ kind: "checking" });
  }, [roomName]);

  // Check access + auto-knock if needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getRoomAccess({ data: { roomName, userId: currentUser.id } });
        if (cancelled) return;
        setIsPrivate(res.isPrivate);
        if (!res.isPrivate) {
          setAccess({ kind: "open" });
        } else if (res.isMember) {
          setAccess({ kind: "member", isPrivate: true });
        } else {
          const k = await knockRoom({
            data: { roomName, userId: currentUser.id, userName: currentUser.name },
          });
          if (cancelled) return;
          if (k.status === "approved") {
            setAccess({ kind: "member", isPrivate: true });
          } else {
            setAccess({ kind: "knocking", knockId: k.knockId ?? "" });
          }
        }
      } catch {
        if (!cancelled) setAccess({ kind: "open" });
      }
    })();
    return () => {
      cancelled = true;
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
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [access]);

  // Start the call once we have access
  useEffect(() => {
    if (startedRef.current) return;
    if (access.kind !== "open" && access.kind !== "member") return;
    startedRef.current = true;
    startCall({ roomName, roomLabel, identity, name: currentUser.name, userId: currentUser.id });
  }, [access, roomName, roomLabel, identity, currentUser.id, currentUser.name, startCall]);

  // Poll pending knocks + privacy state as soon as we have access (member/open),
  // even while the LiveKit connection is still establishing, so incoming
  // requests appear immediately for whoever is already in the room.
  const insideRoom = active?.roomName === roomName;
  const canSeeKnocks = access.kind === "member" || access.kind === "open";
  useEffect(() => {
    if (!canSeeKnocks) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [ks, st] = await Promise.all([
          listRoomKnocks({ data: { roomName } }),
          getRoomAccess({ data: { roomName, userId: currentUser.id } }),
        ]);
        if (cancelled) return;
        setKnocks(ks.knocks);
        setIsPrivate(st.isPrivate);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canSeeKnocks, roomName, currentUser.id]);

  const togglePrivacy = useCallback(async () => {
    const next = !isPrivate;
    setIsPrivate(next);
    try {
      await setRoomPrivacy({ data: { roomName, isPrivate: next, userId: currentUser.id } });
    } catch {
      setIsPrivate(!next);
    }
  }, [isPrivate, roomName, currentUser.id]);

  const answerKnock = useCallback(
    async (knockId: string, approve: boolean) => {
      setKnocks((k) => k.filter((x) => x.id !== knockId));
      try {
        await resolveKnock({ data: { knockId, approve, resolverUserId: currentUser.id } });
      } catch {
        /* ignore */
      }
    },
    [currentUser.id],
  );

  const connecting = access.kind === "checking" || !active || active.roomName !== roomName;

  const layoutActions = insideRoom ? (
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
            {canSeeKnocks && isPrivate && knocks.length > 0 && (
              <div className="pointer-events-auto absolute left-4 top-4 z-30 w-72 overflow-hidden rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur">
                <div className="border-b border-border bg-primary/5 px-3 py-2 text-xs font-semibold">
                  Pedidos para entrar ({knocks.length})
                </div>
                <ul className="max-h-64 divide-y divide-border overflow-auto">
                  {knocks.map((k) => (
                    <li key={k.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-bold">
                        {k.requester_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{k.requester_name}</span>
                      <button
                        onClick={() => answerKnock(k.id, true)}
                        title="Aceitar"
                        className="rounded-md bg-emerald-500 p-1 text-white hover:bg-emerald-600"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => answerKnock(k.id, false)}
                        title="Recusar"
                        className="rounded-md bg-red-500 p-1 text-white hover:bg-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
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
