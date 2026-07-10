import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Lock, LockOpen, WifiOff, X, KeyRound } from "lucide-react";
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
  | { kind: "pin-required" }
  | { kind: "knocking"; knockId: string }
  | { kind: "denied" };

function RoomPage() {
  const { roomName } = Route.useParams();
  const { currentUser } = useFluxo();
  const { startCall, endCall, active, error } = useActiveCall();
  const navigate = useNavigate();
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [isPrivate, setIsPrivate] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [showPreCall, setShowPreCall] = useState(true);
  const [pinShown, setPinShown] = useState<string | null>(null);
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
    // If we already have an active call for this room (e.g. returning from
    // minimized mode), skip the pre-call screen.
    setShowPreCall(!(active && active.roomName === roomName));
    setPinInput("");
    setPinError(null);
    setPinAttempts(0);
  }, [roomName, active]);

  // Check access + auto-knock if needed. If any request errors, keep
  // "checking" and retry — never silently fall back to "open".
  useEffect(() => {
    let cancelled = false;
    let retry: number | undefined;
    const run = async () => {
      try {
        const res = await getRoomAccess({ data: { roomName, userId: currentUser.id } });
        if (cancelled) return;
        setIsPrivate(res.isPrivate);
        setHasPin(!!res.hasPin);
        setPinShown(res.pin ?? null);
        if (!res.isPrivate) {
          setAccess({ kind: "open" });
        } else if (res.isMember) {
          setAccess({ kind: "member", isPrivate: true });
        } else if (res.hasPin) {
          setAccess({ kind: "pin-required" });
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
    const id = window.setInterval(tick, 2000);
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
    startCall({ roomName, roomLabel, identity, name: currentUser.name, userId: currentUser.id });
  }, [access, showPreCall, active, roomName, roomLabel, identity, currentUser.id, currentUser.name, startCall]);

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

  const tryPin = useCallback(async () => {
    setPinError(null);
    const pin = pinInput.replace(/\D/g, "");
    if (pin.length < 4) {
      setPinError("Digite o PIN completo");
      return;
    }
    try {
      // Use knockRoom-like fast path via getRoomAccess -> we do a token pre-check
      // by calling the same access endpoint after inserting membership. Easier:
      // just try to start the call passing the pin; server validates.
      const { getLiveKitToken } = await import("@/lib/livekit-token.functions");
      await getLiveKitToken({
        data: {
          roomName,
          identity: `${currentUser.id}-${currentUser.name.replace(/\s+/g, "_")}`,
          name: currentUser.name,
          userId: currentUser.id,
          pin,
        } as {
          roomName: string;
          identity: string;
          name: string;
          userId?: string;
          pin?: string;
        },
      });
      // Success — server added us as member.
      setAccess({ kind: "member", isPrivate: true });
    } catch {
      const next = pinAttempts + 1;
      setPinAttempts(next);
      setPinError("PIN incorreto");
      if (next >= 3) {
        // Fall back to knock flow
        try {
          const k = await knockRoom({
            data: { roomName, userId: currentUser.id, userName: currentUser.name },
          });
          if (k.status === "approved") setAccess({ kind: "member", isPrivate: true });
          else setAccess({ kind: "knocking", knockId: k.knockId ?? "" });
        } catch {
          setAccess({ kind: "denied" });
        }
      }
    }
  }, [pinInput, pinAttempts, roomName, currentUser.id, currentUser.name]);

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
        {access.kind === "pin-required" ? (
          <PinScreen
            roomLabel={roomLabel}
            value={pinInput}
            onChange={setPinInput}
            error={pinError}
            attempts={pinAttempts}
            onSubmit={tryPin}
            onCancel={() => navigate({ to: "/salas" })}
          />
        ) : access.kind === "knocking" ? (
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
            onEnter={() => setShowPreCall(false)}
            onCancel={() => navigate({ to: "/salas" })}
          />
        ) : (
          <div
            id={ACTIVE_CALL_MOUNT_ID}
            className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card"
          >
            {pinShown && (
              <div className="absolute right-3 top-3 z-30 rounded-md border border-amber-500/50 bg-black/70 px-2 py-1 text-[10px] font-mono text-amber-300">
                PIN: <span className="font-bold tracking-widest">{pinShown}</span>
              </div>
            )}
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

function PinScreen({
  roomLabel,
  value,
  onChange,
  onSubmit,
  onCancel,
  error,
  attempts,
}: {
  roomLabel: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  error: string | null;
  attempts: number;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
      <KeyRound className="h-10 w-10 text-amber-500" />
      <div>
        <div className="text-sm font-semibold">Sala trancada</div>
        <div className="mt-1 text-xs text-muted-foreground">
          A sala <span className="font-medium text-foreground">{roomLabel}</span> exige PIN. Digite
          o código que você recebeu — ou peça pra bater na porta.
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex w-full max-w-xs flex-col items-center gap-2"
      >
        <input
          autoFocus
          inputMode="numeric"
          maxLength={8}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-primary"
        />
        {error && (
          <div className="text-[11px] text-destructive">
            {error} {attempts > 0 && `(tentativa ${attempts}/3)`}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/70"
          >
            Voltar
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            Entrar
          </button>
        </div>
      </form>
    </div>
  );
}
