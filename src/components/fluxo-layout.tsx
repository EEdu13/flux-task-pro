import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  Home,
  Inbox,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Target,
  Users,
  CheckSquare,
  Trophy,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels } from "@/lib/fluxo-types";
import { formatRelative, useTheme } from "@/lib/use-theme";
import { TaskDialog } from "@/components/task-dialog";
import { userScorePct, scoreBgClass, scoreBarColor } from "@/lib/score";

const nav: { to: string; label: string; icon: typeof Home }[] = [
  { to: "/", label: "Início", icon: Home },
  { to: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare },
  { to: "/inbox", label: "Caixa de entrada", icon: Inbox },
  { to: "/equipe", label: "Equipe", icon: Users },
  { to: "/metas", label: "Metas & Score", icon: Target },
  { to: "/calendario", label: "Calendário", icon: Calendar },
  { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

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
  } = useFluxo();
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  const myNotifs = notifications.filter((n) => n.userId === currentUser.id);
  const unread = myNotifs.filter((n) => !n.read).length;
  const myScore = userScorePct(currentUser.id, tasks, completions);

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
        openNewTask();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewTask]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">
            F
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Fluxo</div>
            <div className="text-[10px] text-sidebar-foreground/60">Workspace Acme</div>
          </div>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </div>

        <button
          onClick={() => openNewTask()}
          className="mx-3 mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground shadow-sm transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Criar tarefa
          <span className="ml-1 rounded bg-black/20 px-1 text-[9px] font-mono">N</span>
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
                className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <n.icon className="h-4 w-4" />
                <span className="flex-1">{n.label}</span>
                {badge ? (
                  <span className="rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-bold text-sidebar-primary-foreground">
                    {badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-sidebar-border p-3">
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
            <Settings className="h-4 w-4 opacity-60" />
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
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>Acme</span>
            {breadcrumb && (
              <>
                <span>/</span>
                <span className="text-foreground/70">{breadcrumb}</span>
              </>
            )}
            <span>/</span>
            <span className="font-medium text-foreground">{title}</span>
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
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              onClick={() => openNewTask()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:brightness-110"
            >
              <Plus className="h-4 w-4" /> Nova
            </button>
            <button
              onClick={toggle}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
                  <div className="absolute right-0 top-11 z-40 w-96 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
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
              className="flex items-center gap-2 rounded-full border border-border bg-secondary/50 py-0.5 pl-0.5 pr-2 text-xs"
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
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      <TaskDialog />
    </div>
  );
}