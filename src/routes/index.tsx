import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bell,
  CheckSquare,
  ChevronDown,
  Filter,
  Flame,
  Home,
  Inbox,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  Target,
  TrendingUp,
  Users,
  Calendar,
  BarChart3,
  Building2,
  ArrowUpDown,
  Trophy,
  Repeat,
  Clock,
} from "lucide-react";

import { TaskRow } from "@/components/task-card";
import {
  collaborators,
  notifications,
  sectors,
  tasks,
  type Frequency,
  type Role,
} from "@/components/dashboard-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluxo · Gestor de tarefas de alto desempenho" },
      { name: "description", content: "Plataforma futurista para gestão de tarefas, metas e desempenho de equipes por setor." },
      { property: "og:title", content: "Fluxo · Gestor de tarefas" },
      { property: "og:description", content: "Metas diárias, semanais e mensais com score dinâmico para toda a equipe." },
    ],
  }),
  component: Dashboard,
});

const roleLabels: Record<Role, string> = {
  colaborador: "Colaborador",
  gestor_setor: "Gestor de Setor",
  gestor_geral: "Gestor Geral",
};

const freqLabels: Record<Frequency, string> = {
  diaria: "Hoje",
  semanal: "Esta semana",
  mensal: "Este mês",
};

const navItems = [
  { id: "inicio", label: "Início", icon: Home },
  { id: "tarefas", label: "Minhas tarefas", icon: CheckSquare, active: true },
  { id: "inbox", label: "Caixa de entrada", icon: Inbox, badge: 4 },
  { id: "equipe", label: "Equipe", icon: Users },
  { id: "metas", label: "Metas & Score", icon: Target },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "calendario", label: "Calendário", icon: Calendar },
];

function Dashboard() {
  const [role, setRole] = useState<Role>("gestor_geral");
  const [sector, setSector] = useState("todos");
  const [freq, setFreq] = useState<Frequency>("diaria");
  const [view, setView] = useState<"lista" | "quadro">("lista");

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.frequency !== freq) return false;
      if (sector === "todos") return true;
      const map: Record<string, string> = {
        comercial: "Comercial",
        operacoes: "Operações",
        marketing: "Marketing",
        financeiro: "Financeiro",
        rh: "RH",
      };
      return t.sector === map[sector];
    });
  }, [freq, sector]);

  const totalScore = collaborators.reduce((a, b) => a + b.score, 0);
  const goal = 15000;
  const completed = tasks.filter((t) => t.status === "concluida").length;
  const pending = tasks.filter((t) => t.status !== "concluida").length;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
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

        <button className="mx-3 mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground shadow-sm transition hover:brightness-110">
          <Plus className="h-4 w-4" /> Criar tarefa
        </button>

        <nav className="mt-4 flex flex-col gap-0.5 px-2">
          {navItems.map((it) => (
            <button
              key={it.id}
              className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
                it.active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`}
            >
              <it.icon className="h-4 w-4" />
              <span className="flex-1 text-left">{it.label}</span>
              {it.badge && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {it.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-6 px-4 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Setores
        </div>
        <nav className="mt-1 flex flex-col gap-0.5 px-2 pb-4">
          {sectors.map((s) => (
            <button
              key={s.id}
              onClick={() => setSector(s.id)}
              className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
                sector === s.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color ?? "oklch(0.7 0.05 260)" }}
              />
              <span className="flex-1 text-left">{s.name}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md p-2 hover:bg-sidebar-accent/60">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              AR
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-medium">Ana Ribeiro</div>
              <div className="truncate text-[10px] text-sidebar-foreground/60">{roleLabels[role]}</div>
            </div>
            <Settings className="h-4 w-4 opacity-60" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>Acme</span>
            <span>/</span>
            <span className="font-medium text-foreground">Minhas tarefas</span>
          </div>
          <div className="ml-6 flex flex-1 items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Buscar tarefa, colaborador, projeto…"
              className="flex-1 bg-transparent placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {Object.entries(roleLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            AR
          </div>
        </header>

        {/* Content */}
        <main className="min-w-0 flex-1 p-6">
          {/* KPI cards */}
          <div className="grid gap-4 md:grid-cols-4">
            {[
              {
                label: "Score do time",
                value: totalScore.toLocaleString("pt-BR"),
                sub: `Meta ${goal.toLocaleString("pt-BR")} pts`,
                pct: Math.round((totalScore / goal) * 100),
                icon: Trophy,
                color: "oklch(0.52 0.22 275)",
              },
              {
                label: "Tarefas concluídas",
                value: `${completed}`,
                sub: `${pending} pendentes`,
                pct: Math.round((completed / (completed + pending)) * 100),
                icon: CheckSquare,
                color: "oklch(0.62 0.16 155)",
              },
              {
                label: "Recorrentes ativas",
                value: `${tasks.filter((t) => t.recurring).length}`,
                sub: "Rodando esta semana",
                pct: 100,
                icon: Repeat,
                color: "oklch(0.62 0.16 230)",
              },
              {
                label: "Prazo em risco",
                value: "3",
                sub: "Vencem em 24h",
                pct: 30,
                icon: Clock,
                color: "oklch(0.58 0.22 25)",
              },
            ].map((k, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{k.label}</span>
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-md"
                    style={{ background: `${k.color}`, opacity: 0.12 }}
                  />
                  <k.icon className="-ml-6 h-4 w-4" style={{ color: k.color }} />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-2xl font-semibold tracking-tight">{k.value}</div>
                  <div
                    className="inline-flex items-center gap-1 text-xs font-medium"
                    style={{ color: k.color }}
                  >
                    <TrendingUp className="h-3 w-3" /> {k.pct}%
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{k.sub}</div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${k.pct}%`, background: k.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
            {/* Tasks card */}
            <section className="rounded-lg border border-border bg-card shadow-sm">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex items-center gap-4">
                  <h2 className="text-base font-semibold">Tarefas</h2>
                  <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
                    {(Object.keys(freqLabels) as Frequency[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFreq(f)}
                        className={`rounded px-3 py-1 text-xs font-medium transition ${
                          freq === f
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {freqLabels[f]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-border p-0.5">
                    <button
                      onClick={() => setView("lista")}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${view === "lista" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                    >
                      <List className="h-3 w-3" /> Lista
                    </button>
                    <button
                      onClick={() => setView("quadro")}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${view === "quadro" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                    >
                      <LayoutGrid className="h-3 w-3" /> Quadro
                    </button>
                  </div>
                  <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary">
                    <Filter className="h-3 w-3" /> Filtros
                  </button>
                  <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary">
                    <ArrowUpDown className="h-3 w-3" /> Ordenar
                  </button>
                  <button className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm hover:brightness-110">
                    <Plus className="h-3 w-3" /> Nova
                  </button>
                </div>
              </div>

              {view === "lista" ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pl-4 pr-2 w-8"></th>
                        <th className="py-2 pr-4">Tarefa</th>
                        <th className="py-2 pr-4">Responsável</th>
                        <th className="py-2 pr-4">Prazo</th>
                        <th className="py-2 pr-4">Prioridade</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Setor</th>
                        <th className="py-2 pr-4 text-right">Pontos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                      {filteredTasks.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                            Nenhuma tarefa neste período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <KanbanBoard tasks={filteredTasks} />
              )}
            </section>

            {/* Right column */}
            <aside className="space-y-6">
              {/* Ranking */}
              <section className="rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Ranking do time</h3>
                  </div>
                  <button className="text-xs text-muted-foreground hover:text-foreground">
                    Mês <ChevronDown className="inline h-3 w-3" />
                  </button>
                </div>
                <ul className="divide-y divide-border">
                  {collaborators.slice(0, 5).map((c, i) => {
                    const max = collaborators[0].score;
                    const pct = (c.score / max) * 100;
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                          style={
                            i === 0
                              ? { background: "oklch(0.78 0.15 75)", color: "oklch(0.25 0.05 60)" }
                              : i === 1
                                ? { background: "oklch(0.85 0.02 260)", color: "oklch(0.3 0.02 260)" }
                                : i === 2
                                  ? { background: "oklch(0.72 0.13 55)", color: "oklch(0.98 0 0)" }
                                  : { background: "oklch(0.95 0.005 260)", color: "oklch(0.5 0.02 260)" }
                          }
                        >
                          {i + 1}
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                          {c.avatar}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{c.score.toLocaleString("pt-BR")}</div>
                          <div
                            className="inline-flex items-center gap-0.5 text-[10px] font-medium"
                            style={{ color: "oklch(0.7 0.15 60)" }}
                          >
                            <Flame className="h-2.5 w-2.5" /> {c.streak}d
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Notifications */}
              <section className="rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Avisos</h3>
                  </div>
                  <button className="text-xs text-muted-foreground hover:text-foreground">Ver tudo</button>
                </div>
                <ul className="divide-y divide-border">
                  {notifications.map((n) => (
                    <li key={n.id} className="flex gap-3 px-4 py-3">
                      <div
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            n.type === "alerta"
                              ? "oklch(0.58 0.22 25)"
                              : n.type === "meta"
                                ? "oklch(0.62 0.16 155)"
                                : n.type === "conquista"
                                  ? "oklch(0.78 0.15 75)"
                                  : "oklch(0.52 0.22 275)",
                        }}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-xs text-muted-foreground">{n.desc}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground/70">{n.time}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function KanbanBoard({ tasks: ts }: { tasks: typeof tasks }) {
  const cols = [
    { id: "pendente", title: "A fazer", color: "oklch(0.55 0.02 260)" },
    { id: "andamento", title: "Em andamento", color: "oklch(0.52 0.22 275)" },
    { id: "concluida", title: "Concluída", color: "oklch(0.62 0.16 155)" },
  ] as const;
  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
      {cols.map((col) => {
        const items = ts.filter((t) => t.status === col.id);
        return (
          <div key={col.id} className="rounded-md bg-secondary/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                {col.title}
                <span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <button className="text-muted-foreground hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {items.map((t) => (
                <div key={t.id} className="rounded-md border border-border bg-card p-3 shadow-sm transition hover:shadow-md">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5">{t.sector}</span>
                    {t.recurring && <Repeat className="h-2.5 w-2.5" />}
                  </div>
                  <div className="mt-1.5 text-sm font-medium leading-snug">{t.title}</div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> {t.dueLabel}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-primary">+{t.score}</span>
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {t.assignee.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  Vazio
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
