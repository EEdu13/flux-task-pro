import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  CheckCircle2,
  CheckSquare,
  Flame,
  Clock,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Repeat,
  Star,
  Sparkles,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { InlineTaskCreator } from "@/components/inline-task-creator";
import { formatDueBucket } from "@/lib/use-theme";
import { loadPackDone, savePackDone } from "@/lib/pack";
import {
  freqLabels,
  priorityLabels,
  priorityColor,
  sectors,
  statusColor,
  statusLabels,
  type Frequency,
  type Priority,
  type Status,
  type Task,
} from "@/lib/fluxo-types";

export const Route = createFileRoute("/minhas-tarefas")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? (search.q as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Minhas tarefas · Fluxo" },
      { name: "description", content: "Kanban e lista de tarefas com filtros por responsável, prioridade e prazo." },
    ],
  }),
  component: MinhasTarefas,
});

type Scope = "todas" | "atribuidas" | "criadas" | "mencionadas" | "pack";
type ViewMode = "quadro" | "lista";
type DatePreset =
  | "todas"
  | "ontem"
  | "hoje"
  | "amanha"
  | "esta-semana"
  | "prox-semana"
  | "este-mes"
  | "entre";

const datePresetLabels: Record<DatePreset, string> = {
  todas: "Qualquer data",
  ontem: "Ontem",
  hoje: "Hoje",
  amanha: "Amanhã",
  "esta-semana": "Esta semana",
  "prox-semana": "Semana que vem",
  "este-mes": "Este mês",
  entre: "Entre datas…",
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=dom
  const diff = (day + 6) % 7; // segunda=0
  x.setDate(x.getDate() - diff);
  return x;
}
function dateRangeFor(preset: DatePreset, from?: string, to?: string): [number, number] | null {
  const now = new Date();
  if (preset === "todas") return null;
  if (preset === "hoje") return [startOfDay(now).getTime(), endOfDay(now).getTime()];
  if (preset === "ontem") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "amanha") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "esta-semana") {
    const s = startOfWeek(now);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return [s.getTime(), endOfDay(e).getTime()];
  }
  if (preset === "prox-semana") {
    const s = startOfWeek(now);
    s.setDate(s.getDate() + 7);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return [s.getTime(), endOfDay(e).getTime()];
  }
  if (preset === "este-mes") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return [startOfDay(s).getTime(), endOfDay(e).getTime()];
  }
  if (preset === "entre") {
    if (!from && !to) return null;
    const s = from ? startOfDay(new Date(from)).getTime() : -Infinity;
    const e = to ? endOfDay(new Date(to)).getTime() : Infinity;
    return [s, e];
  }
  return null;
}

const scopeLabels: Record<Scope, string> = {
  pack: "Meu pack",
  atribuidas: "Atribuídas a mim",
  criadas: "Criadas por mim",
  mencionadas: "Mencionaram-me",
  todas: "Todas visíveis",
};

function MinhasTarefas() {
  const { tasks, users, currentUser, updateTask, moveTask, openNewTask, openTask } = useFluxo();
  const { q: initialQ } = Route.useSearch();
  const [scope, setScope] = useState<Scope>("pack");
  const [view, setView] = useState<ViewMode>("quadro");
  const [sector, setSector] = useState<string>("todos");
  const [freq, setFreq] = useState<Frequency | "todas">("todas");
  const [priority, setPriority] = useState<Priority | "todas">("todas");
  const [assignee, setAssignee] = useState<string>("todos");
  const [tag, setTag] = useState<string>("todas");
  const [datePreset, setDatePreset] = useState<DatePreset>("todas");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState(initialQ ?? "");
  // Per-day pack completion (kept in localStorage, resets daily).
  const [packDone, setPackDone] = useState<Set<string>>(() => loadPackDone(currentUser.id));
  useEffect(() => {
    setPackDone(loadPackDone(currentUser.id));
  }, [currentUser.id]);
  const togglePackDone = (id: string) => {
    setPackDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePackDone(currentUser.id, next);
      return next;
    });
  };
  useEffect(() => {
    if (initialQ !== undefined && initialQ !== search) {
      setSearch(initialQ);
      setScope("todas");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const visible = useMemo(() => {
    const range = dateRangeFor(datePreset, dateFrom, dateTo);
    return tasks.filter((t) => {
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
      if (scope === "atribuidas" && t.assigneeId !== currentUser.id) return false;
      if (scope === "criadas" && t.createdBy !== currentUser.id) return false;
      if (scope === "mencionadas" && !t.mentions.includes(currentUser.id)) return false;
      if (scope === "pack") {
        // Pack items are permanent daily commitments — show regardless of task status.
        if (!(t.assigneeId === currentUser.id && t.inPack)) return false;
      }
      if (sector !== "todos" && t.sector !== sector) return false;
      if (freq !== "todas" && t.frequency !== freq) return false;
      if (priority !== "todas" && t.priority !== priority) return false;
      if (assignee !== "todos" && t.assigneeId !== assignee) return false;
      if (tag !== "todas" && !t.tags.includes(tag)) return false;
      if (range) {
        const due = new Date(t.dueDate).getTime();
        if (due < range[0] || due > range[1]) return false;
      }
      if (search && !`${t.title} ${t.description ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [tasks, users, currentUser, scope, sector, freq, priority, assignee, tag, search, datePreset, dateFrom, dateTo]);

  const scopeCounts = useMemo(() => {
    const inRole = (t: Task) => {
      if (currentUser.role === "adm") {
        return (
          t.assigneeId === currentUser.id ||
          t.createdBy === currentUser.id ||
          t.mentions.includes(currentUser.id)
        );
      }
      if (currentUser.role === "supervisor") {
        const team = users.filter((u) => u.supervisorId === currentUser.id).map((u) => u.id);
        team.push(currentUser.id);
        return (
          team.includes(t.assigneeId) ||
          team.includes(t.createdBy) ||
          t.mentions.includes(currentUser.id)
        );
      }
      return true;
    };
    const active = tasks.filter((t) => inRole(t) && t.status !== "concluida");
    return {
      todas: active.length,
      atribuidas: active.filter((t) => t.assigneeId === currentUser.id).length,
      criadas: active.filter((t) => t.createdBy === currentUser.id).length,
      mencionadas: active.filter((t) => t.mentions.includes(currentUser.id)).length,
      pack: active.filter((t) => t.assigneeId === currentUser.id && t.inPack).length,
    } as Record<Scope, number>;
  }, [tasks, users, currentUser]);
  // Override pack count with today's remaining (not yet checked today).
  const packRemainingToday = useMemo(
    () =>
      tasks.filter(
        (t) => t.assigneeId === currentUser.id && t.inPack && !packDone.has(t.id),
      ).length,
    [tasks, currentUser.id, packDone],
  );
  scopeCounts.pack = packRemainingToday;

  const allTags = useMemo(() => Array.from(new Set(tasks.flatMap((t) => t.tags))), [tasks]);

  return (
    <FluxoLayout title="Minhas tarefas">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
          <div className="flex flex-wrap">
            {(Object.keys(scopeLabels) as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`relative px-4 py-2 text-sm font-medium transition ${
                  scope === s
                    ? s === "pack"
                      ? "text-amber-500"
                      : "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {s === "pack" && <Flame className="h-3.5 w-3.5" />}
                  {scopeLabels[s]}
                </span>
                {scopeCounts[s] > 0 && (
                  <span
                    className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      s === "pack"
                        ? "bg-amber-500 text-white"
                        : s === "mencionadas"
                        ? "bg-primary text-primary-foreground"
                        : scope === s
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {scopeCounts[s]}
                  </span>
                )}
                {scope === s && (
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${
                      s === "pack" ? "bg-amber-500" : "bg-primary"
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2">
            <div className="inline-flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setView("quadro")}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  view === "quadro" ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                <LayoutGrid className="h-3 w-3" /> Quadro
              </button>
              <button
                onClick={() => setView("lista")}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  view === "lista" ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                <List className="h-3 w-3" /> Lista
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
            {(Object.keys(datePresetLabels) as DatePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDatePreset(p)}
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  datePreset === p
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {datePresetLabels[p]}
              </button>
            ))}
          </div>
          <input
            placeholder="Buscar por título, descrição ou #tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input min-w-[16rem] flex-1 py-1.5"
          />
          {datePreset === "entre" && (
            <div className="inline-flex items-center gap-1">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border border-border bg-secondary px-2 py-1 text-xs"
              />
            </div>
          )}
          <span className="text-xs text-muted-foreground">{visible.length} tarefas</span>
        </div>

        <div className="mt-4">
          {scope !== "pack" && (
            <div className="mb-3">
              <InlineTaskCreator />
            </div>
          )}
          {scope === "pack" ? (
            <PackView
              tasks={visible}
              externalTasks={tasks.filter((t) => {
                if (t.assigneeId !== currentUser.id && !t.mentions.includes(currentUser.id))
                  return false;
                if (t.inPack && t.assigneeId === currentUser.id) return false; // já está no pack
                if (t.status === "concluida") return false;
                const due = new Date(t.dueDate);
                const now = new Date();
                return (
                  due.getFullYear() === now.getFullYear() &&
                  due.getMonth() === now.getMonth() &&
                  due.getDate() === now.getDate()
                ) || due.getTime() < now.setHours(0, 0, 0, 0); // hoje ou atrasadas
              })}
              onEdit={openTask}
              packDone={packDone}
              onToggleDone={togglePackDone}
              onTogglePack={(id, v) => updateTask(id, { inPack: v })}
              onCompleteExternal={(id) => updateTask(id, { status: "concluida" })}
              currentUserId={currentUser.id}
            />
          ) : view === "quadro" ? (
            <KanbanBoard tasks={visible} onEdit={openTask} onCreate={(status) => openNewTask({ status })} onMove={moveTask} onQuickComplete={(id) => updateTask(id, { status: "concluida" })} onTogglePack={(id, v) => updateTask(id, { inPack: v })} />
          ) : (
            <TaskList
              tasks={visible}
              onEdit={openTask}
              onComplete={(id) => updateTask(id, { status: "concluida" })}
              onTogglePack={(id, v) => updateTask(id, { inPack: v })}
            />
          )}
          {visible.length === 0 && scope !== "pack" && (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-card py-16 text-center">
              <Filter className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nenhuma tarefa neste recorte</p>
              <p className="text-xs text-muted-foreground">Ajuste os filtros ou crie uma nova (atalho N).</p>
              <button
                onClick={() => openNewTask()}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Plus className="h-3 w-3" /> Nova tarefa
              </button>
            </div>
          )}
        </div>
      </div>
    </FluxoLayout>
  );
}

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-secondary px-2 py-1 text-xs"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function TaskList({
  tasks,
  onEdit,
  onComplete,
  onTogglePack,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
  onComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const { users } = useFluxo();
  const groups: { key: string; label: string; items: Task[] }[] = [
    { key: "atrasada", label: "Atrasadas", items: [] },
    { key: "hoje", label: "Hoje", items: [] },
    { key: "semana", label: "Esta semana", items: [] },
    { key: "depois", label: "Depois", items: [] },
  ];
  for (const t of tasks) {
    const b = formatDueBucket(t.dueDate);
    groups.find((g) => g.key === b)!.items.push(t);
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.key}>
          <div className="mb-1 flex items-center gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${g.key === "atrasada" ? "text-destructive" : g.key === "hoje" ? "text-warning" : "text-muted-foreground"}`}>
              {g.label}
            </h3>
            <span className="text-[10px] text-muted-foreground">({g.items.length})</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pl-4 pr-2 w-8"></th>
                  <th className="py-2 pr-4">Tarefa</th>
                  <th className="py-2 pr-4">Responsável</th>
                  <th className="py-2 pr-4">Prazo</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Setor</th>
                  <th className="py-2 pr-4 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((t) => {
                  const assignee = users.find((u) => u.id === t.assigneeId);
                  const sec = sectors.find((s) => s.id === t.sector);
                  return (
                    <tr
                      key={t.id}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        window.dispatchEvent(
                          new CustomEvent("fluxo:task-context", {
                            detail: { id: t.id, x: e.clientX, y: e.clientY },
                          }),
                        );
                      }}
                      className="group border-b border-border last:border-0 hover:bg-secondary/40"
                    >
                      <td className="py-2.5 pl-4 pr-2">
                        {t.status !== "concluida" && (
                          <button
                            onClick={() => onComplete(t.id)}
                            className="flex h-4 w-4 items-center justify-center rounded border border-border hover:border-primary hover:bg-primary/10"
                            title="Marcar concluída"
                          />
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <button onClick={() => onEdit(t.id)} className="flex items-start gap-2 text-left">
                          <CheckSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-sm font-medium">{t.title}</div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              {t.recurring && (
                                <span className="inline-flex items-center gap-1">
                                  <Repeat className="h-2.5 w-2.5" /> Recorrente
                                </span>
                              )}
                              {t.checklist.length > 0 && (
                                <span>
                                  ✓ {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
                                </span>
                              )}
                              {t.mentions.length > 0 && (
                                <span className="inline-flex items-center gap-0.5">
                                  <AtSign className="h-2.5 w-2.5" /> {t.mentions.length}
                                </span>
                              )}
                            </div>
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
                        <Badge label={statusLabels[t.status]} color={statusColor[t.status]} />
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge label={sec?.name ?? "—"} color={sec?.color ?? "oklch(0.55 0.02 260)"} dot />
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onTogglePack(t.id, !t.inPack)}
                            title={t.inPack ? "Remover do Meu pack" : "Adicionar ao Meu pack"}
                            className={`rounded p-1 transition ${
                              t.inPack
                                ? "text-amber-500 hover:bg-amber-500/10"
                                : "text-muted-foreground hover:bg-secondary hover:text-amber-500"
                            }`}
                          >
                            <Star className={`h-3.5 w-3.5 ${t.inPack ? "fill-amber-500" : ""}`} />
                          </button>
                          <button
                            onClick={() => onEdit(t.id)}
                            className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function KanbanBoard({
  tasks,
  onEdit,
  onCreate,
  onMove,
  onQuickComplete,
  onTogglePack,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
  onCreate: (initial?: Status) => void;
  onMove: (id: string, status: Status, targetIndex?: number) => void;
  onQuickComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const { users } = useFluxo();
  const [dragOver, setDragOver] = useState<{ col: Status; index: number } | null>(null);

  const cols: { id: Status; title: string; color: string }[] = [
    { id: "pendente", title: statusLabels.pendente, color: statusColor.pendente },
    { id: "andamento", title: statusLabels.andamento, color: statusColor.andamento },
    { id: "revisao", title: statusLabels.revisao, color: statusColor.revisao },
    { id: "concluida", title: statusLabels.concluida, color: statusColor.concluida },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cols.map((col) => {
        const items = tasks.filter((t) => t.status === col.id).sort((a, b) => a.order - b.order);
        const isOver = dragOver?.col === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isOver) setDragOver({ col: col.id, index: items.length });
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) onMove(id, col.id, dragOver?.index);
              setDragOver(null);
            }}
            className={`rounded-md border p-3 transition ${
              isOver ? "border-primary bg-primary/5" : "border-transparent bg-secondary/40"
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
              <button
                onClick={() => onCreate(col.id)}
                className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {items.map((t, index) => {
                const assignee = users.find((u) => u.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(
                        new CustomEvent("fluxo:task-context", {
                          detail: { id: t.id, x: e.clientX, y: e.clientY },
                        }),
                      );
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setDragOver({ col: col.id, index: before ? index : index + 1 });
                    }}
                    onClick={() => onEdit(t.id)}
                    className={`cursor-grab rounded-md border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing ${
                      dragOver?.col === col.id && dragOver.index === index ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span
                        className="rounded px-1.5 py-0.5"
                        style={{
                          background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                          color: sec?.color,
                        }}
                      >
                        {sec?.name}
                      </span>
                      {t.recurring && <Repeat className="h-2.5 w-2.5" />}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePack(t.id, !t.inPack);
                        }}
                        title={t.inPack ? "Remover do Meu pack" : "Adicionar ao Meu pack"}
                        className={`ml-auto rounded p-0.5 transition ${
                          t.inPack
                            ? "text-amber-500"
                            : "text-muted-foreground hover:text-amber-500"
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${t.inPack ? "fill-amber-500" : ""}`} />
                      </button>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: priorityColor[t.priority] }} />
                    </div>
                    <div className="mt-1.5 text-sm font-medium leading-snug">{t.title}</div>
                    {(t.mentions.length > 0 || t.checklist.length > 0) && (
                      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                        {t.checklist.length > 0 && (
                          <span>
                            ✓ {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
                          </span>
                        )}
                        {t.mentions.length > 0 && (
                          <div className="flex items-center gap-1">
                            <AtSign className="h-2.5 w-2.5" />
                            <div className="flex -space-x-1">
                              {t.mentions.slice(0, 4).map((mid) => {
                                const u = users.find((x) => x.id === mid);
                                if (!u) return null;
                                return (
                                  <span
                                    key={mid}
                                    title={u.name}
                                    className="flex h-4 w-4 items-center justify-center rounded-full border border-card bg-accent text-[8px] font-bold text-accent-foreground"
                                  >
                                    {u.avatar}
                                  </span>
                                );
                              })}
                            </div>
                            {t.mentions.length > 4 && <span>+{t.mentions.length - 4}</span>}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(t.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      </div>
                      <div className="flex items-center gap-1.5">
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
                          onQuickComplete(t.id);
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

function Badge({ label, color, dot }: { label: string; color: string; dot?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
}

function PackView({
  tasks,
  externalTasks,
  onEdit,
  packDone,
  onToggleDone,
  onTogglePack,
  onCompleteExternal,
  currentUserId,
}: {
  tasks: Task[];
  externalTasks: Task[];
  onEdit: (id: string) => void;
  packDone: Set<string>;
  onToggleDone: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
  onCompleteExternal: (id: string) => void;
  currentUserId: string;
}) {
  const done = tasks.filter((t) => packDone.has(t.id));
  const pending = tasks.filter((t) => !packDone.has(t.id));
  const total = tasks.length;
  const pct = total === 0 ? 0 : Math.round((done.length / total) * 100);
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-transparent p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
            <Flame className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Meu pack diário</h2>
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Inegociável
              </span>
            </div>
            <p className="text-xs text-muted-foreground first-letter:uppercase">{today}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Suas obrigações do dia. Bater 100% antes de tudo mantém o combo aceso.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums text-amber-500">{pct}%</div>
            <div className="text-[11px] text-muted-foreground">
              {done.length}/{total} concluídas
            </div>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-amber-500/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-500/40 bg-card p-10 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-amber-500" />
          <p className="mt-2 text-sm font-semibold">Seu pack ainda está vazio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Em qualquer tarefa atribuída a você, clique na estrela{" "}
            <Star className="inline h-3 w-3 -translate-y-0.5 text-amber-500" /> para marcá-la como
            obrigação diária.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((t) => (
            <PackRow
              key={t.id}
              task={t}
              isDone={false}
              onEdit={onEdit}
              onToggleDone={onToggleDone}
              onTogglePack={onTogglePack}
            />
          ))}
          {done.length > 0 && (
            <>
              <div className="pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Concluídas hoje ({done.length})
              </div>
              {done.map((t) => (
                <PackRow
                  key={t.id}
                  task={t}
                  isDone
                  onEdit={onEdit}
                  onToggleDone={onToggleDone}
                  onTogglePack={onTogglePack}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* --- Tarefas externas do dia ------------------------------------ */}
      <div className="pt-6">
        <div className="mb-2 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Chegaram pra hoje</h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {externalTasks.length}
          </span>
          <span className="text-[11px] text-muted-foreground">
            · fora do pack — atribuídas, menções ou criadas com prazo até hoje
          </span>
        </div>
        {externalTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            Nada de fora do pack pra hoje. Foque no essencial.
          </div>
        ) : (
          <div className="space-y-2">
            {externalTasks.map((t) => (
              <ExternalRow
                key={t.id}
                task={t}
                currentUserId={currentUserId}
                onEdit={onEdit}
                onComplete={onCompleteExternal}
                onTogglePack={onTogglePack}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExternalRow({
  task,
  currentUserId,
  onEdit,
  onComplete,
  onTogglePack,
}: {
  task: Task;
  currentUserId: string;
  onEdit: (id: string) => void;
  onComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const sec = sectors.find((s) => s.id === task.sector);
  const isMention =
    task.mentions.includes(currentUserId) && task.assigneeId !== currentUserId;
  const isMine = task.assigneeId === currentUserId;
  const dueMs = new Date(task.dueDate).getTime();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isLate = dueMs < startOfToday.getTime();
  const origin = isMention ? "Mencionaram você" : isMine ? "Atribuída a você" : "Criada por você";
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("fluxo:task-context", {
            detail: { id: task.id, x: e.clientX, y: e.clientY },
          }),
        );
      }}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition hover:shadow-md"
    >
      <button
        onClick={() => onComplete(task.id)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border transition hover:border-emerald-500 hover:bg-emerald-500/10"
        title="Marcar concluída"
      />
      <button onClick={() => onEdit(task.id)} className="flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{task.title}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
              isMention
                ? "bg-primary/15 text-primary"
                : isLate
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {isLate ? "Atrasada" : origin}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Prazo{" "}
            {new Date(task.dueDate).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
            })}
          </span>
          {task.recurring && (
            <span className="inline-flex items-center gap-0.5">
              <Repeat className="h-2.5 w-2.5" /> Recorrente
            </span>
          )}
          <Badge label={priorityLabels[task.priority]} color={priorityColor[task.priority]} />
        </div>
      </button>
      <Badge label={sec?.name ?? "—"} color={sec?.color ?? "oklch(0.55 0.02 260)"} dot />
      {isMine && (
        <button
          onClick={() => onTogglePack(task.id, true)}
          title="Adicionar ao Meu pack"
          className="rounded p-1.5 text-muted-foreground opacity-70 transition hover:bg-amber-500/10 hover:text-amber-500 hover:opacity-100"
        >
          <Star className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PackRow({
  task,
  isDone,
  onEdit,
  onToggleDone,
  onTogglePack,
}: {
  task: Task;
  isDone: boolean;
  onEdit: (id: string) => void;
  onToggleDone: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const sec = sectors.find((s) => s.id === task.sector);
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("fluxo:task-context", {
            detail: { id: task.id, x: e.clientX, y: e.clientY },
          }),
        );
      }}
      className={`group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md ${
        isDone ? "border-border/60 opacity-60" : "border-amber-500/30"
      }`}
    >
      <button
        onClick={() => onToggleDone(task.id)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          isDone
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-amber-500/60 hover:bg-amber-500/10"
        }`}
        title={isDone ? "Desmarcar" : "Concluir hoje"}
      >
        {isDone && <CheckCircle2 className="h-4 w-4" />}
      </button>
      <button
        onClick={() => onEdit(task.id)}
        className="flex-1 text-left"
      >
        <div className={`text-sm font-medium ${isDone ? "line-through" : ""}`}>{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            Prazo{" "}
            {new Date(task.dueDate).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
            })}
          </span>
          {task.recurring && (
            <span className="inline-flex items-center gap-0.5">
              <Repeat className="h-2.5 w-2.5" /> Recorrente
            </span>
          )}
          <Badge
            label={priorityLabels[task.priority]}
            color={priorityColor[task.priority]}
          />
        </div>
      </button>
      <Badge label={sec?.name ?? "—"} color={sec?.color ?? "oklch(0.55 0.02 260)"} dot />
      <button
        onClick={() => onTogglePack(task.id, false)}
        title="Remover do Meu pack"
        className="rounded p-1.5 text-amber-500 opacity-70 transition hover:bg-amber-500/10 hover:opacity-100"
      >
        <Star className="h-4 w-4 fill-amber-500" />
      </button>
    </div>
  );
}