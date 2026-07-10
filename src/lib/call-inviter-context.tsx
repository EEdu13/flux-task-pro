import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, Lock, LockOpen, Copy } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { inviteToRoom, setRoomPrivacy } from "@/lib/livekit-token.functions";

interface Pending {
  userId: string;
  roomName: string;
  roomLabel: string;
}

interface CallInviterContextValue {
  ask(userId: string, roomName: string, roomLabel: string): void;
}

const Ctx = createContext<CallInviterContextValue | null>(null);

export function CallInviterProvider({ children }: { children: ReactNode }) {
  const { users, currentUser, callUserToRoom } = useFluxo();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [flashPin, setFlashPin] = useState<{ pin: string; roomLabel: string } | null>(null);

  const ask = useCallback((userId: string, roomName: string, roomLabel: string) => {
    setPending({ userId, roomName, roomLabel });
  }, []);

  async function confirm(kind: "private" | "open") {
    if (!pending || busy) return;
    setBusy(true);
    const { userId, roomName, roomLabel } = pending;
    try {
      if (kind === "private") {
        try {
          const res = await setRoomPrivacy({
            data: { roomName, isPrivate: true, userId: currentUser.id },
          });
          await inviteToRoom({
            data: { roomName, targetUserId: userId, inviterUserId: currentUser.id },
          });
          if (res?.pin) setFlashPin({ pin: res.pin, roomLabel });
        } catch (e) {
          console.error(e);
        }
      } else {
        try {
          await setRoomPrivacy({ data: { roomName, isPrivate: false, userId: currentUser.id } });
        } catch {
          /* ignore */
        }
      }
      callUserToRoom(userId, roomName, roomLabel);
      setPending(null);
      navigate({ to: "/salas/$roomName", params: { roomName } });
    } finally {
      setBusy(false);
    }
  }

  const targetName = pending
    ? users.find((u) => u.id === pending.userId)?.name ?? "convidado"
    : "";

  return (
    <Ctx.Provider value={{ ask }}>
      {children}
      {flashPin && (
        <div className="fixed inset-x-0 top-4 z-[130] flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-md rounded-xl border-2 border-amber-500 bg-card p-4 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                Sala trancada com PIN
              </span>
              <button onClick={() => setFlashPin(null)} className="rounded p-1 hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              A sala <span className="font-medium text-foreground">{flashPin.roomLabel}</span> agora
              exige PIN. Convidados já entram direto — compartilhe o PIN abaixo se precisar deixar
              mais alguém entrar.
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="font-mono text-2xl font-bold tracking-widest">{flashPin.pin}</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(flashPin.pin).catch(() => {});
                }}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="text-sm font-semibold">Chamar {targetName}</div>
              <button
                onClick={() => setPending(null)}
                className="rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Como você quer entrar na sala{" "}
              <span className="font-medium text-foreground">{pending.roomLabel}</span>?
            </div>
            <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
              <button
                onClick={() => confirm("private")}
                disabled={busy}
                className="flex flex-col items-start gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left transition hover:border-amber-500 hover:bg-amber-500/10 disabled:opacity-60"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
                  <Lock className="h-4 w-4" /> Sala privada
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Só quem for convidado entra. Outros precisam bater na porta.
                </span>
              </button>
              <button
                onClick={() => confirm("open")}
                disabled={busy}
                className="flex flex-col items-start gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-left transition hover:border-emerald-500 hover:bg-emerald-500/10 disabled:opacity-60"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  <LockOpen className="h-4 w-4" /> Sala aberta
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Qualquer pessoa do time pode entrar direto.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useCallInviter() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCallInviter must be used within CallInviterProvider");
  return v;
}