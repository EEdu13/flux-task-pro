import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
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
  startCall(args: { roomName: string; roomLabel?: string; identity: string; name: string }): Promise<void>;
  endCall(): void;
  setMinimized(v: boolean): void;
}

const Ctx = createContext<ActiveCallContextValue | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCall = useCallback<ActiveCallContextValue["startCall"]>(
    async ({ roomName, roomLabel, identity, name }) => {
      // Reuse existing call if same room + identity — avoids re-joining.
      setActive((prev) => {
        if (prev && prev.roomName === roomName && prev.identity === identity) {
          return prev;
        }
        return prev;
      });
      // Read latest active via functional check
      let already = false;
      setActive((prev) => {
        if (prev && prev.roomName === roomName && prev.identity === identity) {
          already = true;
        }
        return prev;
      });
      if (already) {
        setMinimized(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await getLiveKitToken({ data: { roomName, identity, name } });
        setActive({
          roomName,
          roomLabel: roomLabel ?? roomName,
          token: res.token,
          serverUrl: res.url,
          identity,
          name,
        });
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