import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TravaScroll } from "@/components/trava-scroll";
import larsilSimbolo from "@/assets/bolabranca.png";
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Home,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Target,
  Users,
  CheckSquare,
  Trophy,
  Headphones,
  FileText,
  StickyNote,
  UserPlus,
  Flame,
  Contact,
  FolderKanban,
  MessageCircle,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels } from "@/lib/fluxo-types";
import { tituloDoAviso } from "@/lib/aviso";
import { formatRelative, useTheme } from "@/lib/use-theme";
import { TaskDialog } from "@/components/task-dialog";
import { QuickTaskModal } from "@/components/quick-task-modal";
import { OnboardingModal } from "@/components/onboarding-modal";
import { InlineTaskCreator } from "@/components/inline-task-creator";
import { ATALHOS_GRADE } from "@/lib/grade-atalhos";
import { AttentionOverlay } from "@/components/attention-overlay";
import { TaskContextMenu } from "@/components/task-context-menu";
import { CommandPalette } from "@/components/command-palette";
import { TeamDelegatePanel } from "@/components/team-delegate-panel";
import { FocusOverlay } from "@/components/focus-overlay";
import { UndoProvider } from "@/lib/undo-stack";
import { X, Lock } from "lucide-react";
import { userScorePct, scoreBgClass, scoreBarColor } from "@/lib/score";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listRoomsPresence } from "@/lib/livekit-token.functions";
import { IncomingCall } from "@/components/incoming-call";
import { OutgoingCallWatcher } from "@/components/outgoing-call-watcher";
import { TractorBanner } from "@/components/tractor-banner";
import { ChatDock } from "@/components/chat-dock";
import { UserAvatar } from "@/components/user-avatar";
import { transicionar } from "@/components/transition-veil";
import { toast } from "sonner";
import { useCallInviter } from "@/lib/call-inviter-context";

const nav: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare },
  { to: "/pack", label: "Pack diário", icon: Flame },
  { to: "/projetos", label: "Projetos", icon: FolderKanban },
  { to: "/inbox", label: "Caixa de entrada", icon: Inbox },
  { to: "/equipe", label: "Equipe", icon: Users },
  { to: "/contatos", label: "Contatos", icon: Contact },
  { to: "/atas", label: "Atas & Planos", icon: FileText },
  { to: "/metas", label: "Metas & Score", icon: Target },
  { to: "/calendario", label: "Calendário", icon: Calendar },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function openNotepad() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fluxo:notepad-open"));
  }
}

export function FluxoLayout({
  title,
  breadcrumb,
  children,
  actions,
}: {
  title: string;
  breadcrumb?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const {
    users,
    currentUser,
    notifications,
    markNotifRead,
    markAllNotifsRead,
    openNewTask,
    openTask,
    tasks,
    completions,
    isAuthenticated,
    logout,
    recarregarPessoas,
    topContactsForRoom,
  } = useFluxo();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { ask: askInvite } = useCallInviter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [gridOpen, setGridOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("fluxo:sidebar-collapsed") === "1";
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [roomsQuickOpen, setRoomsQuickOpen] = useState(false);

  // Close mobile drawer and rooms quick panel whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
    setRoomsQuickOpen(false);
  }, [pathname]);

  // Close rooms quick panel when clicking outside
  useEffect(() => {
    if (!roomsQuickOpen) return;
    if (typeof document === "undefined") return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        !target.closest("[data-rooms-quick-panel]") &&
        !target.closest("[data-rooms-quick-toggle]")
      ) {
        setRoomsQuickOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [roomsQuickOpen]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  const [roomsOpen, setRoomsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("fluxo:rooms-open") !== "0";
  });
  const [presence, setPresence] = useState<Record<string, { identity: string; name: string }[]>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("fluxo:rooms-open", roomsOpen ? "1" : "0");
  }, [roomsOpen]);

  useEffect(() => {
    let cancelled = false;
    const roomNames = DEPARTMENT_ROOMS.map((r) => r.name);
    async function poll() {
      try {
        const res = await listRoomsPresence({ data: { rooms: roomNames } });
        if (!cancelled) setPresence(res.presence);
      } catch {
        /* silent */
      }
    }
    poll();
    const id = window.setInterval(poll, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("fluxo:sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const myNotifs = notifications.filter((n) => n.userId === currentUser.id);
  const unread = myNotifs.filter((n) => !n.read).length;

  const myScore = userScorePct(currentUser.id, tasks, completions);
  const totalOnline = Object.values(presence).reduce((a, b) => a + b.length, 0);

  useEffect(() => {
    if (!isAuthenticated) navigate({ to: "/login" });
  }, [isAuthenticated, navigate]);

  /* Sessão morta derruba para o login, como no Agendador.
   *
   * Não restaurar o login do `localStorage` resolveu a abertura do app, mas não
   * o caso de ficar dentro: o token da IAM vale 12h, e uma janela deixada
   * aberta de um dia para o outro seguia mostrando tudo montado enquanto o
   * servidor já recusava cada chamada — os erros só no console, a tela vazia
   * sem explicar por quê.
   *
   * `iamMe()` é o que responde essa pergunta sem lançar erro: devolve
   * `autenticado: false` quando não há cookie ou quando a IAM recusa o token.
   * O `iamResolve` guarda 60s em memória, então esta conferência quase nunca
   * chega a sair da máquina.
   *
   * Quando conferir: ao voltar para a janela e a cada 5 minutos. A primeira é
   * a que importa de verdade — o caso real é a pessoa voltando de manhã para
   * uma janela aberta desde ontem, e ela merece ver o login, não uma tela
   * quebrada. A segunda é a rede de segurança para quem deixa o app em foco.
   *
   * Falha de rede NÃO desloga: `iamMe` só devolve `false` com resposta do
   * servidor, e qualquer erro daqui é engolido de propósito. Derrubar quem
   * está sem internet seria trocar um problema por outro pior.
   *
   * Premissa registrada: a IAM está sempre ligada. Se um dia `IAM_ENABLED`
   * voltar a 0, o app cai no modo de demonstração — onde a pessoa entra sem
   * sessão e `iamMe()` responde `false` para todo mundo, porque não há o que
   * resolver. Esta vigilância então precisaria olhar `iamStatus()` antes de
   * armar, ou derrubaria a pessoa num laço de logout. */
  const acoesRef = useRef({ logout, navigate, recarregarPessoas });
  acoesRef.current = { logout, navigate, recarregarPessoas };

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelado = false;

    async function conferirSessao() {
      if (cancelado || document.hidden) return;
      try {
        const { iamMe } = await import("@/integrations/iam/auth.functions");
        const r = await iamMe();
        if (cancelado) return;
        if (!r.autenticado) {
          toast.error("Sua sessão expirou. Entre novamente.");
          acoesRef.current.logout();
          acoesRef.current.navigate({ to: "/login" });
          return;
        }
        /* Sessão viva: aproveita a volta para reler o quadro de pessoas.
           Ele só era buscado no login, então quem entrasse na empresa depois
           ficava invisível até você sair e voltar — e a mensagem dessa pessoa
           chegava de um remetente que a tela não sabia nomear. */
        await acoesRef.current.recarregarPessoas();
      } catch {
        /* sem rede: mantém a pessoa dentro e tenta de novo depois */
      }
    }

    const aoVoltar = () => {
      if (!document.hidden) void conferirSessao();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    const id = window.setInterval(() => void conferirSessao(), 5 * 60_000);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
      window.clearInterval(id);
    };
    /* Só `isAuthenticated` nas dependências, e as ações por ref.
       O objeto do store é um literal recriado a cada render (não há useMemo
       nele), então `logout` e `recarregarPessoas` mudam de referência o tempo
       todo. Listá-las aqui remontava o efeito a cada render: o setInterval era
       limpo e recriado antes de chegar aos 5 minutos, e a conferência
       periódica simplesmente nunca acontecia — só a de foco, que reatacha o
       ouvinte e por isso funcionava. */
  }, [isAuthenticated]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (inField) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setGridOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewTask]);

  // Sair passa pelo mesmo véu da entrada — a troca acontece escondida, e a
  // pessoa vê a despedida em vez de um piscar de tela.
  const sair = () =>
    void transicionar(
      { tipo: "saida", nome: currentUser.name, iniciais: currentUser.avatar },
      () => {
        logout();
        navigate({ to: "/login" });
      },
    );

  if (!isAuthenticated) return null;
  const needsOnboarding = !currentUser.contactCompleted || !currentUser.email || !currentUser.phone;

  return (
  <UndoProvider>
    <div className="fluxo-app-root flex min-h-screen w-full bg-background text-foreground">
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fluxo-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 lg:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "lg:w-16" : "lg:w-60"}`}
      >
        <div className={`flex h-14 items-center gap-2 border-b border-sidebar-border ${collapsed ? "justify-center px-2" : "px-4"}`}>
          {/* A marca no lugar do "F".

              O quadrado colorido saiu junto, e isso não é liberdade: o
              `--sidebar-primary` que o pintava é CLARO em todas as paletas
              (L de 0.62 a 0.97 — no Noir ele é quase branco), e o
              `bolabranca.png` é branco. Logo branca dentro de quadrado claro
              simplesmente não aparece. Já a barra lateral é escura em todas
              elas (L de 0.09 a 0.22), então o branco puro cai em cima de ~15:1
              em qualquer tema, sem depender de paleta nenhuma.

              36px onde o quadrado tinha 32: o desenho tem vazados internos e
              pesa menos que um bloco maciço do mesmo tamanho. É o mesmo ajuste
              ótico do login. De quebra, 36px é a medida do botão "Criar
              tarefa" logo abaixo quando a barra está recolhida — os dois se
              alinham sozinhos na coluna estreita. */}
          {/* O glow herda a cor do quadrado que saiu: `--sidebar-primary` é o
              mesmo token que pintava o fundo do "F". Em vez de sumir, a cor da
              paleta virou a luz em volta da marca — e continua trocando junto
              com o tema. No Noir, que é monocromático, ela é quase branca, e o
              halo sai branco: certo por construção, não por acidente.

              Duas camadas em vez de uma: a de 7px desenha a borda acesa, a de
              16px espalha o brilho. Uma sombra só ou fica dura demais na borda
              ou vira uma mancha sem foco. Proporcional às medidas do login
              (10 e 26px), ajustada para os 36px daqui. */}
          <img
            src={larsilSimbolo}
            alt="Larsil"
            className="h-9 w-9 shrink-0 object-contain"
            style={{
              filter:
                "drop-shadow(0 0 7px color-mix(in oklab, var(--sidebar-primary) 50%, transparent)) drop-shadow(0 0 16px color-mix(in oklab, var(--sidebar-primary) 25%, transparent))",
            }}
          />
          {(!collapsed || mobileOpen) && (
            <>
              <div className="flex-1">
                <div className="text-sm font-semibold">CONECTA</div>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded p-1 text-sidebar-foreground/70 hover:bg-sidebar-accent lg:hidden"
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
              <ChevronDown className="hidden h-4 w-4 opacity-60 lg:block" />
            </>
          )}
        </div>

        <button
          onClick={() => setGridOpen(true)}
          title="Criar tarefa (N)"
          className={`mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground shadow-sm transition hover:brightness-110 ${
            collapsed ? "mx-2 h-9 w-9 self-center p-0" : "mx-3 px-3 py-2"
          }`}
        >
          <Plus className="h-4 w-4" />
          {!collapsed && (
            <>
              Criar tarefa
              <span className="ml-1 rounded bg-black/20 px-1 text-[9px] font-mono">N</span>
            </>
          )}
        </button>

        <nav className="mt-4 flex flex-col gap-0.5 px-2">
          {nav.map((n) => {
            const active = pathname === n.to;
            const badge =
              n.to === "/minhas-tarefas"
                ? tasks.filter((t) => t.assigneeId === currentUser.id && t.status !== "concluida").length
                : n.to === "/inbox"
                ? unread
                : undefined;
            return (
              <Link
                key={n.to}
                to={n.to}
                title={collapsed ? n.label : undefined}
                className={`relative flex items-center gap-2.5 rounded-md text-sm transition ${
                  collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5"
                } ${
                  active
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                {/* O fundo do item ativo é um único elemento compartilhado: o
                    `layoutId` faz o framer-motion deslizá-lo de um item para o
                    outro em vez de apagar aqui e acender ali. */}
                {active && (
                  <motion.span
                    layoutId="nav-ativo"
                    className="absolute inset-0 rounded-md bg-sidebar-accent"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <div className="relative">
                  <n.icon className="h-4 w-4" />
                  {collapsed && badge ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-sidebar-primary-foreground">
                      {badge}
                    </span>
                  ) : null}
                </div>
                {!collapsed && (
                  <>
                    <span className="relative flex-1">{n.label}</span>
                    {badge ? (
                      <span className="relative rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-bold text-sidebar-primary-foreground">
                        {badge}
                      </span>
                    ) : null}
                  </>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={openNotepad}
            title={collapsed ? "Bloco de notas" : undefined}
            className={`flex items-center gap-2.5 rounded-md text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground ${
              collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5"
            }`}
          >
            <StickyNote className="h-4 w-4 text-amber-400" />
            {!collapsed && <span className="flex-1 text-left">Bloco de notas</span>}
          </button>

          {/* Salas Online — with submenu */}
          {(() => {
            const salasActive = pathname === "/salas" || pathname.startsWith("/salas/");
            if (collapsed) {
              return (
                <Link
                  to="/salas"
                  title="Salas Online"
                  className={`flex items-center justify-center rounded-md px-2 py-2 text-sm transition ${
                    salasActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <div className="relative">
                    <Headphones className="h-4 w-4" />
                    {totalOnline > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
                        {totalOnline}
                      </span>
                    )}
                  </div>
                </Link>
              );
            }
            return (
              <div>
                <div
                  className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
                    salasActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <button
                    onClick={() => setRoomsOpen((v) => !v)}
                    className="flex h-4 w-4 items-center justify-center opacity-70 hover:opacity-100"
                    aria-label={roomsOpen ? "Recolher salas" : "Expandir salas"}
                  >
                    {roomsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                  <Headphones className="h-4 w-4" />
                  <Link to="/salas" className="flex-1 truncate">
                    Salas Online
                  </Link>
                  {totalOnline > 0 && (
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {totalOnline} online
                    </span>
                  )}
                </div>
                {roomsOpen && (
                  <ul className="mt-0.5 flex flex-col gap-0.5 pl-3">
                    {DEPARTMENT_ROOMS.map((r) => {
                      const parts = presence[r.name] ?? [];
                      const roomActive = pathname === `/salas/${r.name}`;
                      const onlineUserIds = new Set(
                        parts.map((p) => p.identity.split("-")[0]).filter(Boolean),
                      );
                      const top = topContactsForRoom(r.name, 5);
                      // Merge: top-called first, then any online people not yet listed
                      const shown = [...top];
                      for (const p of parts) {
                        const uid = p.identity.split("-")[0];
                        if (uid && uid !== currentUser.id && !shown.some((u) => u.id === uid)) {
                          const u = users.find((x) => x.id === uid);
                          if (u) shown.push(u);
                        }
                      }
                      const bubbles = shown.slice(0, 3);
                      return (
                        <li key={r.name}>
                          <div
                            className={`group flex items-center gap-2 rounded-md px-2 py-1 text-xs transition ${
                              roomActive
                                ? "bg-sidebar-accent/80 text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                parts.length > 0 ? "bg-emerald-400" : "bg-sidebar-foreground/25"
                              }`}
                            />
                            <Link
                              to="/salas/$roomName"
                              params={{ roomName: r.name }}
                              className="flex-1 truncate uppercase tracking-wide hover:text-sidebar-accent-foreground"
                              title={`Entrar na sala ${r.label}${parts.length ? ` (${parts.length} online)` : ""}`}
                            >
                              {r.label}
                            </Link>
                            {bubbles.length > 0 && (
                              <div className="flex -space-x-1.5">
                                {bubbles.map((u) => {
                                  const isOnline = onlineUserIds.has(u.id);
                                  return (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (isOnline) {
                                          navigate({
                                            to: "/salas/$roomName",
                                            params: { roomName: r.name },
                                          });
                                          return;
                                        }
                                        askInvite(u.id, r.name, r.label);
                                        toast.success(
                                          `Chamando ${u.name.split(" ")[0]} para ${r.label}…`,
                                        );
                                      }}
                                      title={
                                        isOnline
                                          ? `${u.name} está na sala — entrar`
                                          : `Chamar ${u.name} para a sala ${r.label}`
                                      }
                                      className="relative flex h-5 w-5 items-center justify-center rounded-full border border-sidebar bg-primary text-[9px] font-bold text-primary-foreground transition hover:scale-110 hover:z-10"
                                    >
                                      {u.avatar || u.name.slice(0, 1).toUpperCase()}
                                      {isOnline && (
                                        <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-sidebar" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })()}
        </nav>

        <div className="mt-auto border-t border-sidebar-border p-3">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <UserAvatar
                nome={currentUser.name}
                iniciais={currentUser.avatar}
                className="h-9 w-9 text-xs"
              />
              <button
                onClick={sair}
                title="Sair"
                aria-label="Sair"
                className="botao-sair rounded-md p-1.5"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
          <div className="mb-2 flex items-center gap-2 rounded-md p-2">
            <UserAvatar
              nome={currentUser.name}
              iniciais={currentUser.avatar}
              className="h-9 w-9 text-xs"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{currentUser.name}</div>
              <div className="truncate text-[10px] text-sidebar-foreground/60">
                {roleLabels[currentUser.role]}
              </div>
            </div>
            <button
              onClick={sair}
              title="Sair"
              aria-label="Sair"
              className="botao-sair shrink-0 rounded-md p-1.5"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {/* O seletor "Simular usuário" ficava aqui.

              Ele existia para trocar entre as nove pessoas do dado falso e
              testar cada perfil. Sem elas ele listaria uma única opção — quem
              está logado — e trocar para si mesmo não faz nada.

              Além de inútil, era arriscado: `setCurrentUserId` troca a
              identidade no cliente sem passar pela IAM, e o servidor confia no
              userId que o cliente manda. Numa tela de produção isso é um
              seletor de "seja outra pessoa". */}
            </>
          )}
        </div>
      </aside>

      {/* Alça de recolher o menu.

          Ela mora FORA da <aside> de propósito. A barra é um container de
          rolagem (`overflow-y-auto`), e um filho posicionado lá dentro rola
          junto com o menu — ou seja, o "meio" dele mudaria de lugar conforme
          a lista de salas abre e fecha. Presa na viewport, ela fica sempre no
          meio da altura da tela, que é o meio da barra.

          O `left` sai da largura da própria barra menos metade do botão: os
          28px do círculo ficam repartidos meio a meio sobre a borda, que é o
          que faz ela parecer uma aba puxada da lateral em vez de um botão
          solto por cima. E acompanha a mesma duração de 200ms da animação de
          largura da barra, senão ela chegaria antes ou depois da borda.

          Só no desktop: no celular a barra é uma gaveta, que abre pelo ☰ e
          fecha pelo X — recolher não significa nada ali. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        style={{ left: collapsed ? "calc(4rem - 14px)" : "calc(15rem - 14px)" }}
        className="fluxo-alca-menu fixed top-1/2 z-30 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/60 shadow-sm transition-[left,background-color,border-color,color,scale] duration-200 hover:scale-110 hover:border-primary/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="fluxo-topbar sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="hidden h-4 w-4 sm:block" />
            <span className="hidden sm:inline">Larsil</span>
            {breadcrumb && (
              <>
                <span className="hidden sm:inline">/</span>
                <span className="hidden text-foreground/70 sm:inline">{breadcrumb}</span>
              </>
            )}
            <span className="hidden sm:inline">/</span>
            <span className="truncate font-medium text-foreground">{title}</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = globalSearch.trim();
              navigate({ to: "/minhas-tarefas", search: q ? { q } : {} });
            }}
            className="ml-6 hidden flex-1 items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm md:flex"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Buscar tarefa, pessoa, tag… (Enter)"
              className="flex-1 bg-transparent placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Enter</kbd>
          </form>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {actions}
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent("fluxo:team-panel-open"))
              }
              title="Delegar rápido (Ctrl+E)"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1.5 text-sm font-medium text-foreground transition hover:bg-secondary sm:px-2.5"
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Delegar</span>
              <kbd className="ml-1 hidden rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground lg:inline">
                Ctrl+E
              </kbd>
            </button>
            <button
              onClick={() => setGridOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:brightness-110 sm:px-3"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nova</span>
            </button>
            <button
              onClick={toggle}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:flex"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                aria-label="Notificações"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                    {unread}
                  </span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
                  <div className="fixed right-2 top-14 z-40 w-[calc(100vw-1rem)] max-w-96 overflow-hidden rounded-lg border border-border bg-popover shadow-xl sm:absolute sm:right-0 sm:top-11 sm:w-96">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <div className="text-sm font-semibold">Notificações</div>
                      <div className="flex items-center gap-3 text-[11px]">
                        <button
                          onClick={() => markAllNotifsRead()}
                          className="font-medium text-primary hover:underline"
                        >
                          Marcar todas como lidas
                        </button>
                        <Link
                          to="/inbox"
                          onClick={() => setNotifOpen(false)}
                          className="text-muted-foreground hover:underline"
                        >
                          Ver tudo
                        </Link>
                      </div>
                    </div>
                    <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
                      {myNotifs.length === 0 && (
                        <li className="px-4 py-10 text-center text-xs text-muted-foreground">
                          Você está em dia. Sem novas notificações.
                        </li>
                      )}
                      {myNotifs.slice(0, 20).map((n) => (
                        <li key={n.id}>
                          <button
                            onClick={() => {
                              markNotifRead(n.id);
                              setNotifOpen(false);
                              if (n.taskId) openTask(n.taskId);
                              if (n.roomName)
                                navigate({ to: "/salas/$roomName", params: { roomName: n.roomName } });
                            }}
                            className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-secondary/60 ${
                              n.read ? "opacity-70" : ""
                            }`}
                          >
                            <div
                              className="mt-1 h-2 w-2 shrink-0 rounded-full"
                              style={{
                                background:
                                  n.type === "prazo"
                                    ? "oklch(0.58 0.22 25)"
                                    : n.type === "mencao"
                                    ? "oklch(0.6 0.2 330)"
                                    : n.type === "concluida"
                                    ? "oklch(0.62 0.16 155)"
                                    : "oklch(0.52 0.22 275)",
                              }}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {tituloDoAviso(n, users)}
                                {!n.read && (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                                    novo
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{n.desc}</div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                                {formatRelative(n.at)}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
            <div
              className="hidden items-center gap-2 rounded-full border border-border bg-secondary/50 py-0.5 pl-0.5 pr-2 text-xs sm:flex"
              title={`${myScore.done} de ${myScore.assigned} tarefas do mês`}
            >
              <UserAvatar
                nome={currentUser.name}
                iniciais={currentUser.avatar}
                className="h-6 w-6 text-[10px]"
              />
              <span className="hidden font-medium sm:block">{currentUser.name.split(" ")[0]}</span>
              <div className="hidden h-1 w-16 overflow-hidden rounded-full bg-secondary sm:block">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(myScore.assigned === 0 ? 0 : 6, myScore.pct))}%`,
                    background: scoreBarColor(myScore.pct, myScore.assigned),
                  }}
                />
              </div>
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${scoreBgClass(myScore.pct, myScore.assigned)}`}
              >
                <Trophy className="h-2.5 w-2.5" /> {myScore.assigned === 0 ? "—" : `${Math.round(myScore.pct)}%`}
              </span>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-4 md:p-6 lg:pb-4">
          {/* Entrada do conteúdo a cada troca de rota. Sem animação de saída de
              propósito: esperar a página velha sair antes de mostrar a nova
              soma latência a cada clique do menu, e navegação precisa parecer
              instantânea. A chave remonta e reexecuta o `initial`. */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-around border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_20px_-12px_rgba(0,0,0,0.35)] backdrop-blur lg:hidden"
        aria-label="Navegação inferior"
      >
        {(() => {
          const inboxActive = pathname === "/inbox";
          const myActive = pathname === "/minhas-tarefas";
          const homeActive = pathname === "/";
          const myCount = tasks.filter(
            (t) => t.assigneeId === currentUser.id && t.status !== "concluida",
          ).length;
          const tabBase =
            "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-[10px] font-medium transition";
          const activeCls = "text-primary";
          const idleCls = "text-muted-foreground hover:text-foreground";
          return (
            <>
              <Link to="/" className={`${tabBase} ${homeActive ? activeCls : idleCls}`}>
                <Home className="h-5 w-5" />
                <span>Início</span>
              </Link>
              <Link
                to="/minhas-tarefas"
                className={`${tabBase} relative ${myActive ? activeCls : idleCls}`}
              >
                <div className="relative">
                  <CheckSquare className="h-5 w-5" />
                  {myCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                      {myCount}
                    </span>
                  )}
                </div>
                <span>Tarefas</span>
              </Link>
              <button
                type="button"
                onClick={() => setGridOpen(true)}
                aria-label="Criar tarefa"
                className="-mt-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition hover:brightness-110 active:scale-95"
              >
                <Plus className="h-6 w-6" />
              </button>
              <Link
                to="/inbox"
                className={`${tabBase} relative ${inboxActive ? activeCls : idleCls}`}
              >
                <div className="relative">
                  <Inbox className="h-5 w-5" />
                  {unread > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                      {unread}
                    </span>
                  )}
                </div>
                <span>Inbox</span>
              </Link>
              <button
                type="button"
                data-rooms-quick-toggle
                onClick={() => setRoomsQuickOpen((v) => !v)}
                aria-label="Salas online"
                className={`${tabBase} relative ${roomsQuickOpen ? activeCls : idleCls}`}
              >
                <div className="relative">
                  <Headphones className="h-5 w-5" />
                  {totalOnline > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
                      {totalOnline}
                    </span>
                  )}
                </div>
                <span>Salas</span>
              </button>
            </>
          );
        })()}
      </nav>

      {/* Mobile rooms quick panel */}
      {roomsQuickOpen && (
        <div
          data-rooms-quick-panel
          className="fixed inset-x-2 bottom-24 z-50 mx-auto max-w-md rounded-xl border border-border bg-card p-3 shadow-2xl lg:hidden"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Headphones className="h-3.5 w-3.5 text-emerald-500" />
              Salas Online
              {totalOnline > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                  {totalOnline} online
                </span>
              )}
            </div>
            <button
              onClick={() => setRoomsQuickOpen(false)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label="Fechar salas"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {DEPARTMENT_ROOMS.map((r) => {
              const parts = presence[r.name] ?? [];
              const isFree = parts.length === 0;
              const isDiretoria = r.name === "diretoria";
              return (
                <li key={r.name}>
                  <button
                    onClick={() => {
                      setRoomsQuickOpen(false);
                      navigate({ to: "/salas/$roomName", params: { roomName: r.name } });
                    }}
                    className={`flex w-full flex-col gap-1 rounded-md border px-2 py-2 text-left text-xs transition ${
                      isDiretoria
                        ? "border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/15"
                        : "border-transparent hover:bg-secondary"
                    }`}
                  >
                    <div className="flex w-full items-center gap-2">
                      {isDiretoria ? (
                        <Lock className="h-3 w-3 shrink-0 text-amber-500" />
                      ) : (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isFree ? "bg-emerald-400" : "bg-amber-400"
                          }`}
                        />
                      )}
                      <span className="flex-1 truncate font-medium">
                        {r.label}
                        {isDiretoria && (
                          <span className="ml-1.5 rounded-full bg-amber-500/20 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            Restrita
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {parts.length === 0 ? "Livre" : `Ocupada · ${parts.length}`}
                      </span>
                    </div>
                    {parts.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-5">
                        {parts.slice(0, 6).map((p) => (
                          <span
                            key={p.identity}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {p.name || p.identity}
                          </span>
                        ))}
                        {parts.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{parts.length - 6}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <TaskDialog />
      <QuickTaskModal />
      {needsOnboarding && <OnboardingModal />}
      <IncomingCall />
      <AttentionOverlay />
      <OutgoingCallWatcher />
      <TractorBanner />
      <ChatDock />
      <TaskContextMenu />
      <CommandPalette />
      <TeamDelegatePanel />
      <FocusOverlay />
      {/* O respiro do topo sai da própria --titlebar-h: a barra de título é
          fixed com z-index acima deste modal, então sem isso o card desliza por
          baixo dela. E o card ganha teto de altura com rolagem interna, em vez
          de crescer até encostar na barra. */}
      {gridOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 px-2 pb-6 backdrop-blur-sm sm:px-4"
          style={{ paddingTop: "calc(var(--titlebar-h) + 1.5rem)" }}
        >
          <TravaScroll />
          <div
            className="flex w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            style={{ maxHeight: "calc(100vh - var(--titlebar-h) - 3.5rem)" }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-secondary/60 px-3 py-2 sm:px-4 sm:py-2.5">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                <div className="text-sm font-semibold">Criar tarefas em grade</div>
                {/* Lê de ATALHOS_GRADE: este texto dizia o oposto do que o
                    código faz e do que o rodapé do painel mostrava. */}
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                  {ATALHOS_GRADE.map((a) => (
                    <span key={a.tecla} className="inline-flex items-center gap-1">
                      <kbd className="rounded border border-border bg-background px-1 font-mono text-foreground">
                        {a.tecla}
                      </kbd>
                      {a.acao}
                    </span>
                  ))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGridOpen(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <InlineTaskCreator />
            </div>
          </div>
        </div>
      )}
    </div>
  </UndoProvider>
  );
}