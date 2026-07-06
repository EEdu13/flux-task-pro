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
  Trophy,
  Repeat,
  Clock,
  AtSign,
  User as UserIcon,
  Pencil,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";

import { FluxoProvider, useFluxo } from "@/lib/fluxo-store";
import {
  sectors,
  roleLabels,
  freqLabels,
  statusLabels,
  type Frequency,
  type Status,
  type Task,
} from "@/lib/fluxo-types";
import { TaskDialog } from "@/components/task-dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluxo · Gestor de tarefas de alto desempenho" },
      { name: "description", content: "Plataforma profissional para gestão de tarefas, metas e desempenho de equipes por setor." },
      { property: "og:title", content: "Fluxo · Gestor de tarefas" },
      { property: "og:description", content: "Metas diárias, semanais e mensais com score dinâmico para toda a equipe." },
    ],
  }),
  component: () => (
    <FluxoProvider>
      <Dashboard />
    </FluxoProvider>
  ),
});

type Scope = "todas" | "atribuidas" | "criadas" | "mencionadas";
type ViewMode = "lista" | "quadro";

const scopeLabels: Record<Scope, string> = {
  todas: "Todas visíveis",
  atribuidas: "Atribuídas a mim",
  criadas: "Criadas por mim",
  mencionadas: "Mencionaram-me",
};

function Dashboard() {
  const {
    users,
    tasks,
    notifications,
    currentUser,
    setCurrentUserId,
    updateTask,
  } = useFluxo();

  const [sector, setSector] = useState<string>("todos");
  const [freq, setFreq] = useState<Frequency | "todas">("todas");
  const [scope, setScope] = useState<Scope>("todas");
  const [view, setView] = useState<ViewMode>("quadro");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [search, setSearch] = useState("");

  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => {
      // permission-based visibility
      if (currentUser.role === "adm") {
        const involved =
          t.assigneeId === currentUser.id ||
          t.createdBy === currentUser.id ||
          t.mentions.includes(currentUser.id);
        if (!involved) return false;
      } else if (currentUser.role === "supervisor") {
        const team = users.filter((u) => u.supervisorId === currentUser.id).map((u) => u.id);
        team.push(currentUser.id);
        const involved =
          team.includes(t.assigneeId) ||
          team.includes(t.createdBy) ||
          t.mentions.includes(currentUser.id);
        if (!involved) return false;
      }
      // gerente sees all
      if (scope === "atribuidas" && t.assigneeId !== currentUser.id) return false;
      if (scope === "criadas" && t.createdBy !== currentUser.id) return false;
      if (scope === "mencionadas" && !t.mentions.includes(currentUser.id)) return false;
      if (sector !== "todos" && t.sector !== sector) return false;
      if (freq !== "todas" && t.frequency !== freq) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tasks, users, currentUser, scope, sector, freq, search]);

  const myAssigned = tasks.filter((t) => t.assigneeId === currentUser.id).length;
  const myCreated = tasks.filter((t) => t.createdBy === currentUser.id).length;
  const myMentions = tasks.filter((t) => t.mentions.includes(currentUser.id)).length;
  const myDone = tasks.filter((t) => t.assigneeId === currentUser.id && t.status === "concluida").length;

  const myNotifs = notifications.filter((n) => n.userId === currentUser.id);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (t: Task) => {
    setEditing(t);
    setDialogOpen(true);
  };

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
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

        <button
          onClick={openNew}
          className="mx-3 mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-sidebar-primary px-3 py-2 text-sm font-medium text-sidebar-primary-foreground shadow-sm transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Criar tarefa
        </button>

        <nav className="mt-4 flex flex-col gap-0.5 px-2">
          <NavBtn icon={Home} label="Início" />
          <NavBtn icon={CheckSquare} label="Minhas tarefas" active count={myAssigned} />
          <NavBtn icon={Inbox} label="Caixa de entrada" count={myNotifs.filter((n) => !n.read).length} />
          <NavBtn icon={Users} label="Equipe" />
          <NavBtn icon={Target} label="Metas & Score" />
          <NavBtn icon={BarChart3} label="Relatórios" />
          <NavBtn icon={Calendar} label="Calendário" />
        </nav>

        <div className="mt-6 px-4 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Setores
        </div>
        <nav className="mt-1 flex flex-col gap-0.5 px-2 pb-4">
          <SectorBtn id="todos" name="Todos os setores" color="oklch(0.7 0.05 260)" active={sector === "todos"} onClick={() => setSector("todos")} />
          {sectors.map((s) => (
            <SectorBtn
              key={s.id}
              id={s.id}
              name={s.name}
              color={s.color}
              active={sector === s.id}
              onClick={() => setSector(s.id)}
            />
          ))}
        </nav>

        <div className="mt-auto border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2 rounded-md p-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {currentUser.avatar}
            </div>
            <div className="flex-1 min-w-0">
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

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tarefa…"
              className="flex-1 bg-transparent placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Nova
          </button>
          <button className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <Bell className="h-4 w-4" />
            {myNotifs.filter((n) => !n.read).length > 0 && (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </button>
        </header>

        <main className="min-w-0 flex-1 p-6">
          {/* KPI cards personalizados */}
          <div className="grid gap-4 md:grid-cols-4">
            <KpiCard label="Atribuídas a mim" value={myAssigned} sub={`${myDone} concluídas`} icon={CheckSquare} color="oklch(0.52 0.22 275)" />
            <KpiCard label="Criadas por mim" value={myCreated} sub="Todas as frequências" icon={Pencil} color="oklch(0.62 0.16 230)" />
            <KpiCard label="Menções recebidas" value={myMentions} sub="Tarefas que citam @você" icon={AtSign} color="oklch(0.6 0.2 330)" />
            <KpiCard label="Meu score" value={currentUser.score.toLocaleString("pt-BR")} sub={`${currentUser.streak} dias em sequência`} icon={Trophy} color="oklch(0.78 0.15 75)" />
          </div>

          {/* Scope tabs */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border">
            <div className="flex flex-wrap">
              {(Object.keys(scopeLabels) as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`relative px-4 py-2 text-sm font-medium transition ${
                    scope === s ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {scopeLabels[s]}
                  {scope === s && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pb-2">
              <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
                {(["todas", "diaria", "semanal", "mensal"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFreq(f)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      freq === f
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === "todas" ? "Todas" : freqLabels[f]}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-md border border-border p-0.5">
                <button
                  onClick={() => setView("quadro")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${view === "quadro" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                >
                  <LayoutGrid className="h-3 w-3" /> Quadro
                </button>
                <button
                  onClick={() => setView("lista")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${view === "lista" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                >
                  <List className="h-3 w-3" /> Lista
                </button>
              </div>
            </div>
          </div>

          {/* Tasks + right column */}
          <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_320px]">
            <section className="min-w-0">
              {view === "quadro" ? (
                <KanbanBoard tasks={visibleTasks} onEdit={openEdit} onCreate={openNew} />
              ) : (
                <TaskList tasks={visibleTasks} onEdit={openEdit} />
              )}
              {visibleTasks.length === 0 && (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-card py-16 text-center">
                  <Filter className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">Nenhuma tarefa neste recorte</p>
                  <p className="text-xs text-muted-foreground">Ajuste os filtros ou crie uma nova.</p>
                  <button onClick={openNew} className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                    <Plus className="h-3 w-3" /> Nova tarefa
                  </button>
                </div>
              )}
            </section>

            <aside className="space-y-6">
              <section className="rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Ranking do time</h3>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {[...users].sort((a, b) => b.score - a.score).slice(0, 6).map((c, i) => {
                    const max = Math.max(...users.map((u) => u.score));
                    const pct = (c.score / max) * 100;
                    return (
                      <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                          style={i === 0 ? { background: "oklch(0.78 0.15 75)", color: "oklch(0.25 0.05 60)" }
                            : i === 1 ? { background: "oklch(0.85 0.02 260)", color: "oklch(0.3 0.02 260)" }
                            : i === 2 ? { background: "oklch(0.72 0.13 55)", color: "oklch(0.98 0 0)" }
                            : { background: "oklch(0.95 0.005 260)", color: "oklch(0.5 0.02 260)" }}>
                          {i + 1}
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                          {c.avatar}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{c.score.toLocaleString("pt-BR")}</div>
                          <div className="inline-flex items-center gap-0.5 text-[10px] font-medium" style={{ color: "oklch(0.7 0.15 60)" }}>
                            <Flame className="h-2.5 w-2.5" /> {c.streak}d
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="rounded-lg border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Meus avisos</h3>
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {myNotifs.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      Sem avisos por enquanto.
                    </li>
                  )}
                  {myNotifs.slice(0, 8).map((n) => (
                    <li key={n.id} className="flex gap-3 px-4 py-3">
                      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            n.type === "prazo" ? "oklch(0.58 0.22 25)"
                            : n.type === "mencao" ? "oklch(0.6 0.2 330)"
                            : n.type === "concluida" ? "oklch(0.62 0.16 155)"
                            : "oklch(0.52 0.22 275)",
                        }} />
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

      <TaskDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editing={editing} />
    </div>
  );

  function KpiCard({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub: string; icon: typeof Trophy; color: string }) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full transition-all" style={{ width: `70%`, background: color }} />
        </div>
      </div>
    );
  }
}

function NavBtn({ icon: Icon, label, active, count }: { icon: typeof Home; label: string; active?: boolean; count?: number }) {
  return (
    <button
      className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-left">{label}</span>
      {count ? (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{count}</span>
      ) : null}
    </button>
  );
}

function SectorBtn({ id, name, color, active, onClick }: { id: string; name: string; color: string; active: boolean; onClick: () => void }) {
  void id;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
      }`}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="flex-1 text-left">{name}</span>
    </button>
  );
}

function TaskList({ tasks: ts, onEdit }: { tasks: Task[]; onEdit: (t: Task) => void }) {
  const { users } = useFluxo();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      <table className="w-full min-w-[860px] text-left">
        <thead>
          <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pl-4 pr-2">Tarefa</th>
            <th className="py-2 pr-4">Responsável</th>
            <th className="py-2 pr-4">Prazo</th>
            <th className="py-2 pr-4">Prioridade</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Setor</th>
            <th className="py-2 pr-4 text-right">Pontos</th>
            <th className="py-2 pr-4 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {ts.map((t) => {
            const assignee = users.find((u) => u.id === t.assigneeId);
            const sec = sectors.find((s) => s.id === t.sector);
            return (
              <tr key={t.id} className="group border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="py-2.5 pl-4 pr-2">
                  <button onClick={() => onEdit(t)} className="flex items-start gap-2 text-left">
                    <CheckSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{t.title}</div>
                      {t.recurring && (
                        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Repeat className="h-2.5 w-2.5" /> Recorrente
                        </div>
                      )}
                    </div>
                  </button>
                </td>
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {assignee?.avatar}
                    </span>
                    <span className="text-xs">{assignee?.name}</span>
                  </div>
                </td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                  {new Date(t.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </td>
                <td className="py-2.5 pr-4">
                  <PriorityBadge p={t.priority} />
                </td>
                <td className="py-2.5 pr-4">
                  <StatusBadge s={t.status} />
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]" style={{ background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`, color: sec?.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: sec?.color }} />
                    {sec?.name}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-right text-xs font-semibold">+{t.score}</td>
                <td className="py-2.5 pr-4 text-right">
                  <button onClick={() => onEdit(t)} className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KanbanBoard({ tasks: ts, onEdit, onCreate }: { tasks: Task[]; onEdit: (t: Task) => void; onCreate: () => void }) {
  const { moveTask, users, updateTask } = useFluxo();
  const [dragOverCol, setDragOverCol] = useState<Status | null>(null);

  const cols: { id: Status; title: string; color: string }[] = [
    { id: "pendente", title: statusLabels.pendente, color: "oklch(0.55 0.02 260)" },
    { id: "andamento", title: statusLabels.andamento, color: "oklch(0.52 0.22 275)" },
    { id: "revisao", title: statusLabels.revisao, color: "oklch(0.78 0.15 75)" },
    { id: "concluida", title: statusLabels.concluida, color: "oklch(0.62 0.16 155)" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cols.map((col) => {
        const items = ts
          .filter((t) => t.status === col.id)
          .sort((a, b) => a.order - b.order);
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) moveTask(id, col.id);
              setDragOverCol(null);
            }}
            className={`rounded-md border p-3 transition ${
              dragOverCol === col.id ? "border-primary bg-primary/5" : "border-transparent bg-secondary/40"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                {col.title}
                <span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <button onClick={onCreate} className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {items.map((t) => {
                const assignee = users.find((u) => u.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    onClick={() => onEdit(t)}
                    className="cursor-grab rounded-md border border-border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span className="rounded px-1.5 py-0.5" style={{ background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`, color: sec?.color }}>
                        {sec?.name}
                      </span>
                      {t.recurring && <Repeat className="h-2.5 w-2.5" />}
                      <PriorityDot p={t.priority} />
                    </div>
                    <div className="mt-1.5 text-sm font-medium leading-snug">{t.title}</div>
                    {t.mentions.length > 0 && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <AtSign className="h-2.5 w-2.5" /> {t.mentions.length} menções
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(t.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-primary">+{t.score}</span>
                        <div
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                          title={assignee?.name}
                        >
                          {assignee?.avatar}
                        </div>
                      </div>
                    </div>
                    {col.id !== "concluida" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateTask(t.id, { status: "concluida" });
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Marcar concluída
                      </button>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && (
                <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  Arraste tarefas aqui
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PriorityBadge({ p }: { p: Task["priority"] }) {
  const map: Record<Task["priority"], { label: string; color: string }> = {
    alta: { label: "Alta", color: "oklch(0.58 0.22 25)" },
    media: { label: "Média", color: "oklch(0.72 0.15 70)" },
    baixa: { label: "Baixa", color: "oklch(0.55 0.02 260)" },
  };
  const c = map[p];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `color-mix(in oklab, ${c.color} 15%, transparent)`, color: c.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} /> {c.label}
    </span>
  );
}

function PriorityDot({ p }: { p: Task["priority"] }) {
  const color = p === "alta" ? "oklch(0.58 0.22 25)" : p === "media" ? "oklch(0.72 0.15 70)" : "oklch(0.55 0.02 260)";
  return <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: color }} title={`Prioridade ${p}`} />;
}

function StatusBadge({ s }: { s: Status }) {
  const map: Record<Status, string> = {
    pendente: "oklch(0.55 0.02 260)",
    andamento: "oklch(0.52 0.22 275)",
    revisao: "oklch(0.78 0.15 75)",
    concluida: "oklch(0.62 0.16 155)",
  };
  const c = map[s];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `color-mix(in oklab, ${c} 18%, transparent)`, color: c }}>
      {statusLabels[s]}
    </span>
  );
}