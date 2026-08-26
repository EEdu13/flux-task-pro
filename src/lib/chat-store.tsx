import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFluxo } from "@/lib/fluxo-store";
import {
  chatMarkRead,
  chatSend,
  chatThreads,
  presenceHeartbeat,
  presenceList,
} from "@/lib/chat.functions";

export interface ChatThread {
  peer: string;
  body: string | null;
  att_type: string | null;
  created_at: string;
  from_user_id: string;
  unread: number;
}

interface ChatCtx {
  presence: Record<string, number>; // userId -> last_seen ms
  isOnline: (userId: string) => boolean;
  threads: ChatThread[];
  totalUnread: number;
  openWindows: string[];
  minimized: string[];
  openChat: (userId: string) => void;
  closeChat: (userId: string) => void;
  minimizeChat: (userId: string) => void;
  sendMessage: (
    toUserId: string,
    body: string,
    att?: { name: string; type: string; dataUrl: string },
  ) => Promise<void>;
  markRead: (peerId: string) => void;
  /** Incrementa a cada mensagem enviada/recebida — usado para forçar refetch. */
  pulse: number;
}

const Ctx = createContext<ChatCtx | null>(null);
const ONLINE_WINDOW_MS = 45_000;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentUser, isAuthenticated } = useFluxo();
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [minimized, setMinimized] = useState<string[]>([]);
  const [pulse, setPulse] = useState(0);
  const meId = currentUser?.id;

  // Heartbeat de presença
  useEffect(() => {
    if (!isAuthenticated || !meId) return;
    let cancelled = false;
    const beat = () => {
      void presenceHeartbeat({ data: { userId: meId } }).catch(() => {});
    };
    beat();
    const id = window.setInterval(() => !cancelled && beat(), 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [meId, isAuthenticated]);

  // Lista de presença
  useEffect(() => {
    if (!isAuthenticated || !meId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await presenceList();
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const p of res.presence ?? []) {
          map[p.user_id] = new Date(p.last_seen).getTime();
        }
        setPresence(map);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [meId, isAuthenticated]);

  // Threads (lista de conversas + não lidas)
  useEffect(() => {
    if (!isAuthenticated || !meId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await chatThreads({ data: { userId: meId } });
        if (cancelled) return;
        setThreads(res.threads ?? []);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [meId, isAuthenticated, pulse]);

  const isOnline = useCallback(
    (userId: string) => Date.now() - (presence[userId] ?? 0) < ONLINE_WINDOW_MS,
    [presence],
  );

  const openChat = useCallback((userId: string) => {
    setMinimized((m) => m.filter((u) => u !== userId)); // restaura se estava minimizado
    setOpenWindows((w) => (w.includes(userId) ? w : [...w.slice(-2), userId]));
  }, []);
  const closeChat = useCallback((userId: string) => {
    setOpenWindows((w) => w.filter((u) => u !== userId));
    setMinimized((m) => m.filter((u) => u !== userId));
  }, []);
  const minimizeChat = useCallback((userId: string) => {
    setMinimized((m) => (m.includes(userId) ? m : [...m, userId]));
  }, []);

  const sendMessage = useCallback(
    async (
      toUserId: string,
      body: string,
      att?: { name: string; type: string; dataUrl: string },
    ) => {
      if (!meId) return;
      await chatSend({
        data: {
          fromUserId: meId,
          toUserId,
          body,
          attName: att?.name,
          attType: att?.type,
          attData: att?.dataUrl,
        },
      });
      setPulse((p) => p + 1);
    },
    [meId],
  );

  const markRead = useCallback(
    (peerId: string) => {
      if (!meId) return;
      void chatMarkRead({ data: { userId: meId, peerId } })
        .then(() => setPulse((p) => p + 1))
        .catch(() => {});
    },
    [meId],
  );

  const totalUnread = useMemo(
    () => threads.reduce((sum, t) => sum + (t.unread || 0), 0),
    [threads],
  );

  const value: ChatCtx = {
    presence,
    isOnline,
    threads,
    totalUnread,
    openWindows,
    minimized,
    openChat,
    closeChat,
    minimizeChat,
    sendMessage,
    markRead,
    pulse,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChat() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChat precisa do ChatProvider");
  return ctx;
}

/** Hook de conversa: busca e sonda as mensagens com um contato. */
export function useConversation(peerId: string | null) {
  const { currentUser } = useFluxo();
  const { pulse } = useChat();
  const [messages, setMessages] = useState<
    {
      id: string;
      from_user_id: string;
      to_user_id: string;
      body: string | null;
      att_name: string | null;
      att_type: string | null;
      att_data: string | null;
      created_at: string;
    }[]
  >([]);
  const meId = currentUser?.id;
  const seenPeer = useRef<string | null>(null);

  useEffect(() => {
    if (!peerId || !meId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { chatConversation } = await import("@/lib/chat.functions");
        const res = await chatConversation({ data: { userId: meId, peerId } });
        if (!cancelled) setMessages(res.messages ?? []);
      } catch {
        /* ignore */
      }
    };
    if (seenPeer.current !== peerId) {
      setMessages([]);
      seenPeer.current = peerId;
    }
    void load();
    const id = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [peerId, meId, pulse]);

  return messages;
}
