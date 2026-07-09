import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { getLiveKitToken } from "@/lib/livekit-token.functions";

export interface ActiveCall {
  roomName: string;
  roomLabel: string;
  token: string;
  serverUrl: string;
  identity: string;
  name: string;
}

interface ActiveCallContextValue {
  active: ActiveCall | null;
  minimized: boolean;
  loading: boolean;
  error: string | null;
  startCall(args: {
    roomName: string;
    roomLabel?: string;
    identity: string;
    name: string;
    userId?: string;
  }): Promise<void>;
  endCall(): void;
  setMinimized(v: boolean): void;
}

const Ctx = createContext<ActiveCallContextValue | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCall = useCallback<ActiveCallContextValue["startCall"]>(
    async ({ roomName, roomLabel, identity, name, userId }) => {
      const prev = activeRef.current;
      if (prev && prev.roomName === roomName && prev.identity === identity) {
        setMinimized(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await getLiveKitToken({
          data: { roomName, identity, name, userId: userId ?? "" } as {
            roomName: string;
            identity: string;
            name: string;
            userId?: string;
          },
        });
        const next: ActiveCall = {
          roomName,
          roomLabel: roomLabel ?? roomName,
          token: res.token,
          serverUrl: res.url,
          identity,
          name,
        };
        activeRef.current = next;
        setActive(next);
        setMinimized(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao entrar na sala");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const endCall = useCallback(() => {
    activeRef.current = null;
    setActive(null);
    setMinimized(false);
    setError(null);
  }, []);

  return (
    <Ctx.Provider value={{ active, minimized, loading, error, startCall, endCall, setMinimized }}>
      {children}
    </Ctx.Provider>
  );
}

export function useActiveCall() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveCall must be used within ActiveCallProvider");
  return v;
}
