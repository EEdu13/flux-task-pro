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
import { tocarMensagemNova } from "@/lib/sons";
import { desktopFlashTaskbar } from "@/lib/desktop";

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

  /* `null` = ainda não sabemos quantas eram; a primeira consulta semeia.
     Fica num ref, e não em estado, porque ninguém desenha este número — ele
     serve só para comparar com o próximo e decidir se toca o som. Em estado,
     causaria um render a cada 3 segundos sem nada mudar na tela. */
  const totalNaoLidasRef = useRef<number | null>(null);

  /* Quem está com a janela aberta e NÃO minimizada.
     Num ref e não em estado porque quem lê é o laço de sondagem, e mudar as
     dependências dele reiniciaria o intervalo de 3s a cada janela aberta. */
  const janelasAVistaRef = useRef<Set<string>>(new Set());

  // Heartbeat de presença
  useEffect(() => {
    if (!isAuthenticated || !meId) return;
    let cancelled = false;
    const beat = () => {
      void presenceHeartbeat().catch(() => {});
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

  useEffect(() => {
    const min = new Set(minimized);
    janelasAVistaRef.current = new Set(openWindows.filter((id) => !min.has(id)));
  }, [openWindows, minimized]);

  // Threads (lista de conversas + não lidas)
  useEffect(() => {
    if (!isAuthenticated || !meId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await chatThreads();
        if (cancelled) return;
        const lista = res.threads ?? [];
        setThreads(lista);

        /* Som só quando o total de não lidas SOBE.
           Comparar com o total anterior é o que separa "chegou mensagem" de
           "as mesmas mensagens continuam lá" — a cada 3 segundos esta consulta
           devolve o mesmo número, e tocar por número maior que zero faria um
           alarme a cada três segundos até a pessoa abrir a conversa.

           O primeiro resultado só semeia a base e não toca nada: senão entrar
           no app com mensagens antigas por ler dispararia o som no login, por
           algo que já estava lá ontem. */
        /* Conversa aberta E à vista não entra na conta.
           Sem isto, a mensagem que a pessoa está VENDO chegar — janela aberta
           na frente dela — tocava o som e piscava a barra, avisando de algo que
           já estava sendo lido. `document.hidden` é a metade que importa: se a
           aba está em segundo plano, a janela estar aberta não significa nada e
           o aviso volta a fazer sentido.

           A leitura vem de um ref, e não das dependências deste efeito: incluir
           `openWindows` aqui reiniciaria o intervalo a cada janela aberta ou
           fechada, e este relógio está calibrado. */
        const aVista =
          typeof document !== "undefined" && !document.hidden
            ? janelasAVistaRef.current
            : new Set<string>();
        const total = lista.reduce(
          (s, t) => s + (aVista.has(t.peer) ? 0 : t.unread || 0),
          0,
        );
        const anterior = totalNaoLidasRef.current;
        totalNaoLidasRef.current = total;
        if (anterior !== null && total > anterior) {
          tocarMensagemNova();
          // Só o botão da barra, não a janela: ver a nota em `desktopFlashTaskbar`.
          void desktopFlashTaskbar("informativo");
        }
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

      /* Duas idas, nesta ordem, e a ordem é obrigatória.
         O anexo aponta para a mensagem — `gestor.anexos.dono_id` — então a
         mensagem precisa existir antes. Por isso `chatSend` devolve o id: é
         ele que o envio do arquivo usa como dono. */
      const r = await chatSend({ data: { toUserId, body, comAnexo: !!att } });

      if (att) {
        const { enviarAnexo } = await import("@/lib/anexo.functions");
        await enviarAnexo({
          data: {
            donoTipo: "mensagem",
            donoId: r.message.id,
            nome: att.name,
            tipoMime: att.type,
            // O seletor de arquivo entrega data URL; o servidor tira o
            // cabeçalho e guarda os bytes no Blob.
            conteudo: att.dataUrl,
          },
        });
      }

      setPulse((p) => p + 1);
    },
    [meId],
  );

  const markRead = useCallback(
    (peerId: string) => {
      if (!meId) return;
      void chatMarkRead({ data: { peerId } })
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

/**
 * Hook de conversa: busca e sonda as mensagens com um contato.
 *
 * Devolve array por compatibilidade — dezenas de linhas fazem `messages.map` e
 * `messages.length` direto. O "está digitando" entra como propriedade do mesmo
 * array (`.peerDigitando`), que é o formato que não obriga a mexer em quem só
 * quer as mensagens.
 */
export type Conversa = MensagemDaConversa[] & { peerDigitando: boolean };

type MensagemDaConversa = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  body: string | null;
  att_name: string | null;
  att_type: string | null;
  att_data: string | null;
  created_at: string;
};

export function useConversation(peerId: string | null): Conversa {
  const { currentUser } = useFluxo();
  const { pulse } = useChat();
  const [digitando, setDigitando] = useState(false);
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
      setDigitando(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const { chatConversation } = await import("@/lib/chat.functions");
        const res = await chatConversation({ data: { peerId } });
        if (cancelled) return;
        setMessages(res.messages ?? []);
        setDigitando(res.peerDigitando === true);
      } catch {
        /* ignore */
      }
    };
    if (seenPeer.current !== peerId) {
      setMessages([]);
      setDigitando(false);
      seenPeer.current = peerId;
    }
    void load();
    const id = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [peerId, meId, pulse]);

  /* O array e a marca viajam juntos porque a tela precisa dos dois no mesmo
     instante: mostrar "digitando" embaixo de uma lista de mensagens de outra
     conversa seria pior que não mostrar nada. `useMemo` para a identidade do
     array não mudar a cada render — `MessageList` rola até o fim quando
     `messages.length` muda, e um array novo a cada render remontaria isso. */
  return useMemo(() => {
    const lista = messages.slice() as Conversa;
    lista.peerDigitando = digitando;
    return lista;
  }, [messages, digitando]);
}
