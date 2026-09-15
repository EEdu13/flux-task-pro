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
  definirEstado,
  presenceHeartbeat,
  presenceList,
} from "@/lib/chat.functions";
import { paraEstado, type EstadoDoChat, type SituacaoNoChat } from "@/lib/estado-do-chat";
import { tocarMensagemNova } from "@/lib/sons";
import { desktopFlashTaskbar, desktopTempoOcioso, isTauri } from "@/lib/desktop";

/** Parado por este tempo, quem está Disponível vira Ausente sozinho. */
const AUSENTE_APOS_S = 10 * 60;
/** Mexeu há menos que isto: a pessoa voltou. */
const VOLTOU_SE_ATIVO_HA_S = 60;
/** Marca de que o Ausente atual foi o automático — só esse volta sozinho. */
const CHAVE_AUSENTE_AUTOMATICO = "fluxo.chat.ausente-automatico";

export interface ChatThread {
  peer: string;
  body: string | null;
  att_type: string | null;
  created_at: string;
  from_user_id: string;
  unread: number;
}

/**
 * A pessoa está olhando para o app agora?
 *
 * É a pergunta por trás de três coisas: marcar mensagem como lida, calar o som
 * de mensagem nova e — por consequência — o "visualizado" que a outra pessoa
 * vê. As três precisam da mesma resposta, senão uma desmente a outra.
 *
 * `document.hidden` sozinho não basta. No teste de 11/09, com a conversa aberta
 * e o app de desktop minimizado, o som de mensagem nova não tocou — e a única
 * forma de o código chegar lá é o documento continuar se declarando visível
 * com a janela minimizada. Ou seja, o WebView não avisa o minimizar. Com o
 * visto, o mesmo buraco faria a outra pessoa ver ✓✓ numa mensagem que ninguém
 * leu.
 *
 * `hasFocus()` fecha isso: janela minimizada, ou outro programa na frente, não
 * tem o foco. O custo é que conversa aberta num segundo monitor, com o foco em
 * outro programa, também não conta como lida até a pessoa voltar ao app — que
 * é o lado certo de errar, porque um "visualizado" falso é uma mentira na tela
 * de outra pessoa e um atrasado não é.
 */
export function pessoaOlhando(): boolean {
  return typeof document !== "undefined" && !document.hidden && document.hasFocus();
}

interface ChatCtx {
  presence: Record<string, number>; // userId -> last_seen ms
  isOnline: (userId: string) => boolean;
  /** Offline, ou o status que a pessoa escolheu — é o que a bolinha mostra. */
  situacaoDe: (userId: string) => SituacaoNoChat;
  /** O meu status escolhido. */
  meuEstado: EstadoDoChat;
  mudarMeuEstado: (estado: EstadoDoChat) => void;
  threads: ChatThread[];
  /**
   * Não lidas fora das conversas que estão desenhadas na tela agora — o
   * número de TODO badge de chat. Substituiu o `totalUnread`, que contava
   * também a conversa aberta e fazia o badge piscar por ela.
   */
  naoLidasFora: number;
  /**
   * Anuncia que a conversa com `peerId` está desenhada na tela; devolve a
   * função que desfaz o anúncio. Quem chama é a lista de mensagens, ao montar.
   */
  registrarNaTela: (peerId: string) => () => void;
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
  /** Minhas mensagens a caminho do servidor, para aparecerem na conversa na hora. */
  enviando: EnvioPendente[];
  /** Tira da lista de pendentes as que a conversa já trouxe do servidor. */
  descartarEnvios: (idsNoServidor: ReadonlySet<string>) => void;
}

/**
 * Mensagem que eu mandei e o servidor ainda não devolveu na conversa.
 *
 * Existe porque a conversa só se atualiza depois da ida e volta ao servidor
 * (Railway nos EUA, banco no Azure): a mensagem sumia do campo e demorava a
 * aparecer na lista, e parecia que o Enter não tinha ido.
 */
export type EnvioPendente = {
  idLocal: string;
  /** O id que o servidor deu, quando já respondeu. */
  idNoServidor: string | null;
  /** Anexo já enviado (ou não havia). Antes disso a versão do servidor chega sem ele. */
  concluido: boolean;
  peer: string;
  mensagem: MensagemDaConversa;
};

const Ctx = createContext<ChatCtx | null>(null);
const ONLINE_WINDOW_MS = 45_000;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentUser, isAuthenticated } = useFluxo();
  const [presence, setPresence] = useState<Record<string, number>>({});
  const [estados, setEstados] = useState<Record<string, EstadoDoChat>>({});
  const [meuEstado, setMeuEstado] = useState<EstadoDoChat>("disponivel");
  /* O laço das mensagens lê o status por aqui para decidir o som, pelo mesmo
     motivo de `contagemNaTelaRef`: nas dependências, trocar de status
     reiniciaria o intervalo calibrado. */
  const meuEstadoRef = useRef<EstadoDoChat>("disponivel");
  /* Troca feita agora e ainda não confirmada pela lista de presença. Sem isto,
     uma sondagem que saiu antes da troca voltaria com o status antigo e o
     seletor pularia de volta por um instante. */
  const trocaPendenteRef = useRef<{ estado: EstadoDoChat; ate: number } | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [openWindows, setOpenWindows] = useState<string[]>([]);
  const [minimized, setMinimized] = useState<string[]>([]);
  const [pulse, setPulse] = useState(0);
  const [enviando, setEnviando] = useState<EnvioPendente[]>([]);
  const meId = currentUser?.id;

  /* `null` = ainda não sabemos quantas eram; a primeira consulta semeia.
     Fica num ref, e não em estado, porque ninguém desenha este número — ele
     serve só para comparar com o próximo e decidir se toca o som. Em estado,
     causaria um render a cada 3 segundos sem nada mudar na tela. */
  const totalNaoLidasRef = useRef<number | null>(null);

  /* Conversas desenhadas na tela agora, com contagem.
     Vale para as duas portas do chat — a janela do dock e a página /chat. Antes
     só as janelas do dock contavam (vinham de `openWindows`), então na página
     /chat a mensagem de quem você estava lendo tocava o som e acendia o número
     como se estivesse em outro lugar.

     Contagem e não conjunto porque a mesma conversa pode estar nas duas portas
     ao mesmo tempo; fechar uma não pode tirar a outra da tela.

     O mapa vive num ref porque quem o lê é o laço de sondagem, e ele não pode
     entrar nas dependências do laço: reiniciaria o intervalo de 3s a cada
     conversa aberta, e esse relógio está calibrado. O estado ao lado é só para
     o número do badge redesenhar. */
  const contagemNaTelaRef = useRef<Map<string, number>>(new Map());
  const [naTela, setNaTela] = useState<ReadonlySet<string>>(() => new Set());

  const registrarNaTela = useCallback((peerId: string) => {
    const m = contagemNaTelaRef.current;
    m.set(peerId, (m.get(peerId) ?? 0) + 1);
    setNaTela(new Set(m.keys()));
    return () => {
      const n = (m.get(peerId) ?? 1) - 1;
      if (n <= 0) m.delete(peerId);
      else m.set(peerId, n);
      setNaTela(new Set(m.keys()));
    };
  }, []);

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
        const est: Record<string, EstadoDoChat> = {};
        for (const p of res.presence ?? []) {
          map[p.user_id] = new Date(p.last_seen).getTime();
          est[p.user_id] = paraEstado(p.estado);
        }
        setPresence(map);
        // O meu vem do banco também: quem deixou "ocupado" ontem continua
        // ocupado ao abrir o app hoje, em qualquer computador.
        const pendente = trocaPendenteRef.current;
        if (pendente && Date.now() < pendente.ate) {
          est[meId] = pendente.estado;
        } else {
          trocaPendenteRef.current = null;
          if (est[meId]) {
            meuEstadoRef.current = est[meId];
            setMeuEstado(est[meId]);
          }
        }
        setEstados(est);
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
        /* Conversa na tela E pessoa olhando não entra na conta.
           Sem isto, a mensagem que a pessoa está VENDO chegar tocava o som e
           piscava a barra, avisando de algo que já estava sendo lido. A metade
           "pessoa olhando" é a que importa: app minimizado ou em segundo plano
           faz a conversa estar aberta não significar nada, e o aviso volta a
           fazer sentido. Ver `pessoaOlhando` — era aqui que o app minimizado
           ficava mudo.

           A leitura vem de um ref, e não das dependências deste efeito: ver a
           nota em `contagemNaTelaRef`. */
        const aVista = pessoaOlhando() ? contagemNaTelaRef.current : new Map<string, number>();
        const total = lista.reduce(
          (s, t) => s + (aVista.has(t.peer) ? 0 : t.unread || 0),
          0,
        );
        const anterior = totalNaoLidasRef.current;
        totalNaoLidasRef.current = total;
        if (anterior !== null && total > anterior) {
          // Ocupado cala só o som. O número e a barra piscando continuam: a
          // pessoa escolheu não ser interrompida, não deixar de saber.
          if (meuEstadoRef.current !== "ocupado") tocarMensagemNova();
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

  const situacaoDe = useCallback(
    (userId: string): SituacaoNoChat => {
      // O meu é o escolhido agora, sem esperar a próxima sondagem.
      if (userId === meId) return meuEstado;
      return isOnline(userId) ? (estados[userId] ?? "disponivel") : "offline";
    },
    [isOnline, estados, meId, meuEstado],
  );

  /* Quem pôs o Ausente: a pessoa ou o relógio. Guardado no localStorage porque
     o app pode ser fechado e reaberto no meio — o status vem do banco como
     "ausente", e sem a marca ninguém saberia que ele deve voltar sozinho. */
  const ausenteAutomaticoRef = useRef(false);
  useEffect(() => {
    try {
      ausenteAutomaticoRef.current = localStorage.getItem(CHAVE_AUSENTE_AUTOMATICO) === "1";
    } catch {
      /* sem localStorage, a marca vale só nesta sessão */
    }
  }, []);
  const marcarAutomatico = (v: boolean) => {
    ausenteAutomaticoRef.current = v;
    try {
      if (v) localStorage.setItem(CHAVE_AUSENTE_AUTOMATICO, "1");
      else localStorage.removeItem(CHAVE_AUSENTE_AUTOMATICO);
    } catch {
      /* idem */
    }
  };

  const gravarEstado = useCallback((estado: EstadoDoChat) => {
    meuEstadoRef.current = estado;
    setMeuEstado(estado);
    trocaPendenteRef.current = { estado, ate: Date.now() + 15_000 };
    void definirEstado({ data: { estado } }).catch(() => {
      trocaPendenteRef.current = null;
    });
  }, []);

  // Escolha da pessoa: vale mais que o automático, então apaga a marca.
  const mudarMeuEstado = useCallback(
    (estado: EstadoDoChat) => {
      marcarAutomatico(false);
      gravarEstado(estado);
    },
    [gravarEstado],
  );

  /* Ausente automático — só no app de desktop, que mede o computador inteiro.
     No navegador não liga: lá só daria para ver o mouse dentro da página, e
     quem trabalha em outro programa seria dado como ausente estando ali.

     Regras: só sai de Disponível (Ocupado e o Ausente escolhido à mão ficam
     como estão) e só volta sozinho o Ausente que ele mesmo pôs. Consulta a cada
     30s — a volta leva até isso para aparecer, o que basta para um status. */
  useEffect(() => {
    if (!isAuthenticated || !meId || !isTauri()) return;
    let cancelado = false;
    const conferir = async () => {
      const parado = await desktopTempoOcioso();
      if (cancelado || parado === null) return;
      const atual = meuEstadoRef.current;
      if (ausenteAutomaticoRef.current && atual !== "ausente") {
        // Trocado em outro computador: a marca não vale mais.
        marcarAutomatico(false);
      }
      if (atual === "disponivel" && parado >= AUSENTE_APOS_S) {
        marcarAutomatico(true);
        gravarEstado("ausente");
      } else if (
        atual === "ausente" &&
        ausenteAutomaticoRef.current &&
        parado < VOLTOU_SE_ATIVO_HA_S
      ) {
        marcarAutomatico(false);
        gravarEstado("disponivel");
      }
    };
    void conferir();
    const id = window.setInterval(conferir, 30_000);
    return () => {
      cancelado = true;
      window.clearInterval(id);
    };
  }, [meId, isAuthenticated, gravarEstado]);

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

      // Aparece na conversa já, antes de o servidor responder.
      const idLocal = `enviando-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      setEnviando((l) => [
        ...l,
        {
          idLocal,
          idNoServidor: null,
          concluido: false,
          peer: toUserId,
          mensagem: {
            id: idLocal,
            from_user_id: meId,
            to_user_id: toUserId,
            body: body || null,
            att_name: att?.name ?? null,
            att_type: att?.type ?? null,
            att_data: att?.dataUrl ?? null,
            created_at: new Date().toISOString(),
            read_at: null,
            enviando: true,
          },
        },
      ]);
      const marcar = (patch: Partial<EnvioPendente>) =>
        setEnviando((l) => l.map((e) => (e.idLocal === idLocal ? { ...e, ...patch } : e)));

      try {
        /* Duas idas, nesta ordem, e a ordem é obrigatória.
           O anexo aponta para a mensagem — `gestor.anexos.dono_id` — então a
           mensagem precisa existir antes. Por isso `chatSend` devolve o id: é
           ele que o envio do arquivo usa como dono. */
        const r = await chatSend({ data: { toUserId, body, comAnexo: !!att } });
        marcar({ idNoServidor: r.message.id });

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
        marcar({ concluido: true });
      } catch (e) {
        // Não foi: some da conversa, e quem chamou devolve o texto ao campo.
        setEnviando((l) => l.filter((x) => x.idLocal !== idLocal));
        throw e;
      }

      setPulse((p) => p + 1);
    },
    [meId],
  );

  const descartarEnvios = useCallback((idsNoServidor: ReadonlySet<string>) => {
    setEnviando((l) => {
      const resto = l.filter(
        (e) => !(e.concluido && e.idNoServidor && idsNoServidor.has(e.idNoServidor)),
      );
      return resto.length === l.length ? l : resto;
    });
  }, []);

  const markRead = useCallback(
    (peerId: string) => {
      if (!meId) return;
      void chatMarkRead({ data: { peerId } })
        .then(() => setPulse((p) => p + 1))
        .catch(() => {});
    },
    [meId],
  );

  /* O número que os badges mostram.
     Desconta a conversa que está na tela porque a marcação de lida vai ao
     servidor e só volta na próxima sondagem — sem descontar, o badge piscaria
     o número de uma mensagem que a pessoa acabou de ler na frente dela. */
  const naoLidasFora = useMemo(
    () => threads.reduce((sum, t) => sum + (naTela.has(t.peer) ? 0 : t.unread || 0), 0),
    [threads, naTela],
  );

  const value: ChatCtx = {
    presence,
    isOnline,
    situacaoDe,
    meuEstado,
    mudarMeuEstado,
    threads,
    naoLidasFora,
    registrarNaTela,
    openWindows,
    minimized,
    openChat,
    closeChat,
    minimizeChat,
    sendMessage,
    markRead,
    pulse,
    enviando,
    descartarEnvios,
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

export type MensagemDaConversa = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  body: string | null;
  att_name: string | null;
  att_type: string | null;
  att_data: string | null;
  created_at: string;
  /** Quando o destinatário leu. `null` = ainda não leu. É o que acende o ✓✓. */
  read_at: string | null;
  /** Só nas minhas que ainda não chegaram ao servidor — o balão mostra o relógio. */
  enviando?: boolean;
};

export function useConversation(peerId: string | null): Conversa {
  const { currentUser } = useFluxo();
  const { pulse, enviando, descartarEnvios } = useChat();
  const [digitando, setDigitando] = useState(false);
  const [messages, setMessages] = useState<MensagemDaConversa[]>([]);
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
  // A conversa já trouxe do servidor as que estavam pendentes: saem da fila.
  useEffect(() => {
    if (enviando.length === 0) return;
    descartarEnvios(new Set(messages.map((m) => m.id)));
  }, [messages, enviando.length, descartarEnvios]);

  return useMemo(() => {
    /* Servidor + pendentes desta conversa, sem repetir.
       Uma pendente com anexo ainda subindo esconde a versão do servidor da mesma
       mensagem: aquela chega sem o arquivo, e trocar uma pela outra faria a
       imagem sumir e voltar. As pendentes vão no fim — são as mais novas. */
    const minhas = enviando.filter((e) => e.peer === peerId);
    const escondidas = new Set(
      minhas.filter((e) => !e.concluido && e.idNoServidor).map((e) => e.idNoServidor!),
    );
    const noServidor = new Set(messages.map((m) => m.id));
    const lista = [
      ...messages.filter((m) => !escondidas.has(m.id)),
      ...minhas
        .filter((e) => !(e.concluido && e.idNoServidor && noServidor.has(e.idNoServidor)))
        .map((e) => e.mensagem),
    ] as Conversa;
    lista.peerDigitando = digitando;
    return lista;
  }, [messages, digitando, enviando, peerId]);
}
