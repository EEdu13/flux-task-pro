import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { X, Lock, LockOpen } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { inviteToRoom, setRoomPrivacy } from "@/lib/livekit-token.functions";
import { TravaScroll } from "@/components/trava-scroll";

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
  // `currentUser` saiu: ele só existia para mandar o próprio id ao servidor,
  // que agora o descobre sozinho pela sessão.
  const { users, callUserToRoom } = useFluxo();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
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
          await setRoomPrivacy({
            data: { roomName, isPrivate: true },
          });
          await inviteToRoom({
            data: { roomName, targetUserId: userId },
          });
        } catch (e) {
          console.error(e);
        }
      } else {
        try {
          await setRoomPrivacy({ data: { roomName, isPrivate: false } });
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
      {pending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <TravaScroll />
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