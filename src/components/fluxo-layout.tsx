import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Zap,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels } from "@/lib/fluxo-types";
import { formatRelative, useTheme } from "@/lib/use-theme";
import { TaskDialog } from "@/components/task-dialog";
import { QuickTaskModal } from "@/components/quick-task-modal";
import { OnboardingModal } from "@/components/onboarding-modal";
import { InlineTaskCreator } from "@/components/inline-task-creator";
import { AttentionOverlay } from "@/components/attention-overlay";
import { TaskContextMenu } from "@/components/task-context-menu";
import { CommandPalette } from "@/components/command-palette";
import { TeamDelegatePanel } from "@/components/team-delegate-panel";
import { FocusOverlay } from "@/components/focus-overlay";
import { UndoProvider } from "@/lib/undo-stack";
import { X } from "lucide-react";
import { userScorePct, scoreBgClass, scoreBarColor } from "@/lib/score";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listRoomsPresence } from "@/lib/livekit-token.functions";
import { IncomingCall } from "@/components/incoming-call";
import { OutgoingCallWatcher } from "@/components/outgoing-call-watcher";
import { toast } from "sonner";
import { useCallInviter } from "@/lib/call-inviter-context";

const nav: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare },
  { to: "/inbox", label: "Caixa de entrada", icon: Inbox },
  { to: "/equipe", label: "Equipe", icon: Users },
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
    setCurrentUserId,
    notifications,
    markNotifRead,
    markAllNotifsRead,
    openNewTask,
    openTask,
    tasks,
    completions,
    isAuthenticated,
    logout,
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
      if (target && !target.closest("[data-rooms-quick-panel]")) {
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

  if (!isAuthenticated) return null;
  const needsOnboarding = !currentUser.contactCompleted || !currentUser.email || !currentUser.phone;

  return (
  <UndoProvider>
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 lg:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "lg:w-16" : "lg:w-60"}`}
      >
        <div className={`flex h-14 items-center gap-2 border-b border-sidebar-border ${collapsed ? "justify-center px-2" : "px-4"}`}>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">
            F
          </div>
          {(!collapsed || mobileOpen) && (
            <>
              <div className="flex-1">
                <div className="text-sm font-semibold">Fluxo</div>
                <div className="text-[10px] text-sidebar-foreground/60">Workspace Acme</div>
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
                className={`flex items-center gap-2.5 rounded-md text-sm transition ${
                  collapsed ? "justify-center px-2 py-2" : "px-3 py-1.5"
                } ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
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
                    <span className="flex-1">{n.label}</span>
                    {badge ? (
                      <span className="rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-bold text-sidebar-primary-foreground">
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
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={`mb-3 flex items-center gap-2 rounded-md text-xs text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              collapsed ? "mx-auto h-8 w-8 justify-center" : "w-full px-2 py-1.5"
            }`}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && <span>Recolher menu</span>}
          </button>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                title={currentUser.name}
              >
                {currentUser.avatar}
              </div>
              <button
                onClick={() => {
                  logout();
                  navigate({ to: "/login" });
                }}
                title="Sair"
                className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
          <div className="mb-2 flex items-center gap-2 rounded-md p-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {currentUser.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{currentUser.name}</div>
              <div className="truncate text-[10px] text-sidebar-foreground/60">
                {roleLabels[currentUser.role]}
              </div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate({ to: "/login" });
              }}
              title="Sair"
              className="rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Simular usuário
          </label>
          <select
            value={currentUser.id}
            onChange={(e) => setCurrentUserId(e.target.value)}
            className="w-full rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-xs text-sidebar-foreground"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {roleLabels[u.role]}
              </option>
            ))}
          </select>
            </>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:gap-3 sm:px-6">
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
            <span className="hidden sm:inline">Acme</span>
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
                                {n.title}
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
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {currentUser.avatar}
              </div>
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
        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-4 md:p-6 lg:pb-4">{children}</main>
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
                onClick={() => setRoomsQuickOpen((v) => !v)}
                aria-label="Salas online"
                className={`${tabBase} relative ${idleCls}`}
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
              return (
                <li key={r.name}>
                  <button
                    onClick={() => {
                      setRoomsQuickOpen(false);
                      navigate({ to: "/salas/$roomName", params: { roomName: r.name } });
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        isFree ? "bg-emerald-400" : "bg-amber-400"
                      }`}
                    />
                    <span className="flex-1 font-medium">{r.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {parts.length === 0 ? "Livre" : `${parts.length} online`}
                    </span>
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
      <TaskContextMenu />
      <CommandPalette />
      <TeamDelegatePanel />
      <FocusOverlay />
      {gridOpen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-2 pt-4 backdrop-blur-sm sm:p-4 sm:pt-10">
          <div className="w-full max-w-6xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-3 py-2 sm:px-4 sm:py-2.5">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                <div className="text-sm font-semibold">Criar tarefas em grade</div>
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  Digite, Tab para próxima linha, Enter para criar todas
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
            <div className="p-3 sm:p-4">
              <InlineTaskCreator />
            </div>
          </div>
        </div>
      )}
    </div>
  </UndoProvider>
  );
}