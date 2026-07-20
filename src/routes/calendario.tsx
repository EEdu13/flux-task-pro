import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Zap, Eye } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, statusColor, statusLabels } from "@/lib/fluxo-types";
import { openTaskContext } from "@/components/task-context-menu";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · Fluxo" },
      { name: "description", content: "Visão mensal, semanal, diária e lista de todas as tarefas por prazo." },
    ],
  }),
  component: CalendarioPage,
});

type ViewMode = "mes" | "semana" | "dia" | "lista";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

function CalendarioPage() {
  const { tasks, currentUser, users, openTask, openNewTask, openQuickCreate, reorderTasks } = useFluxo();
  const [view, setView] = useState<ViewMode>("mes");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState<"eu" | "todos">("eu");
  const [dayCtx, setDayCtx] = useState<{ x: number; y: number; date: string; count: number } | null>(null);

  useEffect(() => {
    if (!dayCtx) return;
    const close = () => setDayCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [dayCtx]);

  const filtered = useMemo(
    () => (scope === "eu" ? tasks.filter((t) => t.assigneeId === currentUser.id) : tasks),
    [tasks, scope, currentUser.id],
  );

  const goPrev = () => {
    const d = new Date(cursor);
    if (view === "mes") d.setMonth(d.getMonth() - 1);
    else if (view === "semana") d.setDate(d.getDate() - 7);
    else if (view === "dia") d.setDate(d.getDate() - 1);
    else d.setDate(d.getDate() - 14);
    setCursor(d);
  };
  const goNext = () => {
    const d = new Date(cursor);
    if (view === "mes") d.setMonth(d.getMonth() + 1);
    else if (view === "semana") d.setDate(d.getDate() + 7);
    else if (view === "dia") d.setDate(d.getDate() + 1);
    else d.setDate(d.getDate() + 14);
    setCursor(d);
  };
  const goToday = () => setCursor(startOfDay(new Date()));

  const headerLabel = useMemo(() => {
    if (view === "mes") {
      const d = new Date(cursor);
      d.setDate(1);
      return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    }
    if (view === "semana") {
      const s = startOfWeek(cursor);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return `${s.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    if (view === "dia") {
      return cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    }
    return "Próximas tarefas";
  }, [view, cursor]);

  return (
    <FluxoLayout title="Calendário">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold capitalize tracking-tight">{headerLabel}</h1>
            <p className="text-sm text-muted-foreground">Visualize prazos e distribua carga.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(["mes", "semana", "dia", "lista"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded px-2.5 py-1 capitalize ${view === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {v === "mes" ? "Mês" : v === "semana" ? "Semana" : v === "dia" ? "Dia" : "Lista"}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <button
                onClick={() => setScope("eu")}
                className={`rounded px-2 py-1 ${scope === "eu" ? "bg-secondary" : "text-muted-foreground"}`}
              >
                Só minhas
              </button>
              <button
                onClick={() => setScope("todos")}
                className={`rounded px-2 py-1 ${scope === "todos" ? "bg-secondary" : "text-muted-foreground"}`}
              >
                Todos
              </button>
            </div>
            <button onClick={goPrev} className="rounded-md border border-border p-1.5 hover:bg-secondary">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={goToday} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">
              Hoje
            </button>
            <button onClick={goNext} className="rounded-md border border-border p-1.5 hover:bg-secondary">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {view === "mes" && (
          <MonthGrid
            cursor={cursor}
            filtered={filtered}
            users={users}
            onDayClick={(iso) => openNewTask({ dueDate: iso })}
            onDayContext={(x, y, iso, count) => setDayCtx({ x, y, date: iso, count })}
            onTaskClick={openTask}
            onSwitchDay={(iso) => {
              setCursor(new Date(iso + "T00:00:00"));
              setView("dia");
            }}
          />
        )}
        {view === "semana" && (
          <WeekGrid
            cursor={cursor}
            filtered={filtered}
            users={users}
            onDayClick={(iso) => openNewTask({ dueDate: iso })}
            onDayContext={(x, y, iso, count) => setDayCtx({ x, y, date: iso, count })}
            onTaskClick={openTask}
            onSwitchDay={(iso) => {
              setCursor(new Date(iso + "T00:00:00"));
              setView("dia");
            }}
          />
        )}
        {view === "dia" && (
          <DayView
            cursor={cursor}
            filtered={filtered}
            users={users}
            onTaskClick={openTask}
            onNew={() => openNewTask({ dueDate: cursor.toISOString().slice(0, 10) })}
            onReorder={reorderTasks}
          />
        )}
        {view === "lista" && (
          <ListView
            cursor={cursor}
            filtered={filtered}
            users={users}
            onTaskClick={openTask}
              onReorder={reorderTasks}
          />
        )}
      </div>
      {dayCtx && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: Math.min(dayCtx.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
            top: Math.min(dayCtx.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 200),
            width: 220,
          }}
          className="fixed z-[300] animate-in fade-in-0 zoom-in-95 rounded-lg border border-border bg-card p-1 shadow-2xl"
        >
          <div className="border-b border-border px-2 py-1.5">
            <div className="text-[11px] font-semibold">
              {new Date(dayCtx.date + "T00:00:00").toLocaleDateString("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {dayCtx.count} {dayCtx.count === 1 ? "tarefa" : "tarefas"}
            </div>
          </div>
          <div className="mt-1 flex flex-col">
            <button
              onClick={() => {
                openQuickCreate({ dueDate: dayCtx.date });
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Criar rápido</span>
            </button>
            <button
              onClick={() => {
                openNewTask({ dueDate: dayCtx.date });
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nova tarefa detalhada</span>
            </button>
            <button
              onClick={() => {
                setScope("todos");
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Ver de todos</span>
            </button>
          </div>
        </div>
      )}
    </FluxoLayout>
  );
}

type DayCell = { date: Date; inMonth: boolean; tasks: any[] };

function TaskPill({
  t,
  users,
  onClick,
  onContext,
}: {
  t: any;
  users: any[];
  onClick: () => void;
  onContext: (x: number, y: number) => void;
}) {
  const sec = sectors.find((s) => s.id === t.sector);
  const u = users.find((x) => x.id === t.assigneeId);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e.clientX, e.clientY);
      }}
      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] transition hover:bg-secondary"
      style={{ background: `color-mix(in oklab, ${statusColor[t.status as keyof typeof statusColor]} 12%, transparent)` }}
      title={`${t.title} · ${u?.name}`}
    >
      
      <span className="truncate">{t.title}</span>
      <span className="ml-auto shrink-0" style={{ color: sec?.color }}>•</span>
    </button>
  );
}

function MonthGrid({
  cursor,
  filtered,
  users,
  onDayClick,
  onDayContext,
  onTaskClick,
  onSwitchDay,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number) => void;
  onTaskClick: (id: string) => void;
  onSwitchDay: (iso: string) => void;
}) {
  const cells = useMemo<DayCell[]>(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dayEnd = new Date(d);
      dayEnd.setDate(d.getDate() + 1);
      const dayTasks = filtered.filter((t) => {
        const dt = new Date(t.dueDate).getTime();
        return dt >= d.getTime() && dt < dayEnd.getTime();
      });
      out.push({ date: d, inMonth: d.getMonth() === cursor.getMonth(), tasks: dayTasks });
    }
    return out;
  }, [cursor, filtered]);

  return (
    <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
        <div key={d} className="bg-secondary/60 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {d}
        </div>
      ))}
      {cells.map((cell, i) => {
        const today = cell.date.toDateString() === new Date().toDateString();
        const iso = cell.date.toISOString().slice(0, 10);
        return (
          <button
            type="button"
            key={i}
            onClick={() => onDayClick(iso)}
            onDoubleClick={() => onSwitchDay(iso)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDayContext(e.clientX, e.clientY, iso, cell.tasks.length);
            }}
            className={`min-h-[7rem] bg-card p-1.5 text-left transition hover:bg-secondary/40 ${cell.inMonth ? "" : "opacity-40"}`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`text-[11px] font-semibold ${
                  today ? "rounded-full bg-primary px-1.5 text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {cell.date.getDate()}
              </span>
              {cell.tasks.length > 0 && <span className="text-[10px] text-muted-foreground">{cell.tasks.length}</span>}
            </div>
            <div className="mt-1 space-y-0.5">
              {cell.tasks.slice(0, 3).map((t: any) => (
                <TaskPill
                  key={t.id}
                  t={t}
                  users={users}
                  onClick={() => onTaskClick(t.id)}
                  onContext={(x, y) => openTaskContext(t.id, x, y)}
                />
              ))}
              {cell.tasks.length > 3 && (
                <div className="text-[10px] text-muted-foreground">+{cell.tasks.length - 3} mais</div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function WeekGrid({
  cursor,
  filtered,
  users,
  onDayClick,
  onDayContext,
  onTaskClick,
  onSwitchDay,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number) => void;
  onTaskClick: (id: string) => void;
  onSwitchDay: (iso: string) => void;
}) {
  const days = useMemo(() => {
    const s = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      const e = new Date(d);
      e.setDate(d.getDate() + 1);
      const dayTasks = filtered
        .filter((t) => {
          const dt = new Date(t.dueDate).getTime();
          return dt >= d.getTime() && dt < e.getTime();
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      return { date: d, tasks: dayTasks };
    });
  }, [cursor, filtered]);

  return (
    <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {days.map((day, i) => {
        const today = day.date.toDateString() === new Date().toDateString();
        const iso = day.date.toISOString().slice(0, 10);
        return (
          <div key={i} className="flex min-h-[26rem] flex-col bg-card">
            <button
              onClick={() => onSwitchDay(iso)}
              className="border-b border-border bg-secondary/60 px-2 py-1.5 text-left transition hover:bg-secondary"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {day.date.toLocaleDateString("pt-BR", { weekday: "short" })}
              </div>
              <div className={`text-lg font-semibold ${today ? "text-primary" : ""}`}>{day.date.getDate()}</div>
            </button>
            <button
              onClick={() => onDayClick(iso)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDayContext(e.clientX, e.clientY, iso, day.tasks.length);
              }}
              className="flex-1 space-y-1 p-1.5 text-left hover:bg-secondary/30"
            >
              {day.tasks.length === 0 && <div className="text-[10px] text-muted-foreground/60">—</div>}
              {day.tasks.map((t: any) => (
                <TaskPill
                  key={t.id}
                  t={t}
                  users={users}
                  onClick={() => onTaskClick(t.id)}
                  onContext={(x, y) => openTaskContext(t.id, x, y)}
                />
              ))}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  cursor,
  filtered,
  users,
  onTaskClick,
  onNew,
  onReorder,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  onTaskClick: (id: string) => void;
  onNew: () => void;
  onReorder: (ids: string[]) => void;
}) {
  const dayTasks = useMemo(() => {
    const s = startOfDay(cursor).getTime();
    const e = s + 24 * 60 * 60 * 1000;
    return filtered
      .filter((t) => {
        const dt = new Date(t.dueDate).getTime();
        return dt >= s && dt < e;
      })
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.dueDate.localeCompare(b.dueDate),
      );
  }, [cursor, filtered]);

  const byStatus = useMemo(() => {
    const g: Record<string, any[]> = { pendente: [], andamento: [], concluida: [] };
    dayTasks.forEach((t) => g[t.status as string]?.push(t));
    return g;
  }, [dayTasks]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ st: string; index: number } | null>(null);

  const handleDrop = (st: string, insertIdx: number) => {
    if (!dragId) return;
    const list = (byStatus[st] || []).filter((t) => t.id !== dragId);
    const idx = Math.min(insertIdx, list.length);
    const ids = [
      ...list.slice(0, idx).map((t) => t.id),
      dragId,
      ...list.slice(idx).map((t) => t.id),
    ];
    onReorder(ids);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="mt-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="text-sm text-muted-foreground">
          {dayTasks.length} {dayTasks.length === 1 ? "tarefa" : "tarefas"} nesse dia
        </div>
        <button onClick={onNew} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      </div>
      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-4">
        {(["pendente", "andamento", "concluida"] as const).map((st) => (
          <div
            key={st}
            className="flex flex-col bg-card p-3"
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId && !dropTarget) setDropTarget({ st, index: (byStatus[st] || []).length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(st, dropTarget?.st === st ? dropTarget.index : (byStatus[st] || []).length);
            }}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: statusColor[st] }} />
              {statusLabels[st]}
              <span className="ml-auto">{byStatus[st].length}</span>
            </div>
            <div className="space-y-1.5">
              {byStatus[st].map((t, index) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                const showBefore =
                  dropTarget?.st === st && dropTarget.index === index && dragId && dragId !== t.id;
                return (
                  <div key={t.id}>
                    {showBefore && <div className="mb-1 h-0.5 rounded-full bg-primary" />}
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const before = e.clientY < rect.top + rect.height / 2;
                        setDropTarget({ st, index: before ? index : index + 1 });
                      }}
                      onClick={() => onTaskClick(t.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openTaskContext(t.id, e.clientX, e.clientY);
                      }}
                      className="w-full cursor-grab rounded-md border border-border bg-background p-2 text-left transition hover:bg-secondary/60 active:cursor-grabbing"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">{t.title}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span style={{ color: sec?.color }}>{sec?.name}</span>
                            <span>·</span>
                            <span className="truncate">{u?.name}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
              {byStatus[st].length === 0 && <div className="text-[11px] text-muted-foreground/60">Vazio</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({
  cursor,
  filtered,
  users,
  onTaskClick,
  onReorder,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  onTaskClick: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const groups = useMemo(() => {
    const start = startOfDay(cursor).getTime();
    const end = start + 60 * 24 * 60 * 60 * 1000; // 60 days window
    const list = filtered
      .filter((t) => {
        const dt = new Date(t.dueDate).getTime();
        return dt >= start && dt < end;
      })
      .sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) || (a.order ?? 0) - (b.order ?? 0),
      );
    const map = new Map<string, any[]>();
    list.forEach((t) => {
      const key = new Date(t.dueDate).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    // Sort each day by order
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.dueDate.localeCompare(b.dueDate));
    }
    return Array.from(map.entries());
  }, [cursor, filtered]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ iso: string; index: number } | null>(null);

  const handleDrop = (iso: string, items: any[], insertIdx: number) => {
    if (!dragId) return;
    const list = items.filter((t) => t.id !== dragId);
    const idx = Math.min(insertIdx, list.length);
    const ids = [
      ...list.slice(0, idx).map((t) => t.id),
      dragId,
      ...list.slice(idx).map((t) => t.id),
    ];
    onReorder(ids);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="mt-4 space-y-3">
      {groups.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhuma tarefa nos próximos 60 dias.
        </div>
      )}
      {groups.map(([iso, items]) => {
        const d = new Date(iso + "T00:00:00");
        const today = d.toDateString() === new Date().toDateString();
        return (
          <div key={iso} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-2">
              <div className={`text-xs font-semibold uppercase tracking-wider ${today ? "text-primary" : "text-muted-foreground"}`}>
                {d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                {today && <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">Hoje</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">{items.length}</div>
            </div>
            <div className="divide-y divide-border">
              {items.map((t: any, index: number) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                const showBefore =
                  dropTarget?.iso === iso && dropTarget.index === index && dragId && dragId !== t.id;
                return (
                  <button
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(t.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setDropTarget({ iso, index: before ? index : index + 1 });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(iso, items, dropTarget?.index ?? index);
                    }}
                    onClick={() => onTaskClick(t.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openTaskContext(t.id, e.clientX, e.clientY);
                    }}
                    className={`flex w-full cursor-grab items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40 active:cursor-grabbing ${
                      showBefore ? "border-t-2 border-t-primary" : ""
                    }`}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span style={{ color: sec?.color }}>{sec?.name}</span>
                        <span>·</span>
                        <span className="truncate">{u?.name}</span>
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `color-mix(in oklab, ${statusColor[t.status as keyof typeof statusColor]} 15%, transparent)`,
                        color: statusColor[t.status as keyof typeof statusColor],
                      }}
                    >
                      {statusLabels[t.status as keyof typeof statusLabels]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}