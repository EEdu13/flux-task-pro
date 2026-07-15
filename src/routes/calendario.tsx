import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Zap, Eye } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { priorityColor, sectors, statusColor } from "@/lib/fluxo-types";
import { openTaskContext } from "@/components/task-context-menu";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · Fluxo" },
      { name: "description", content: "Visão mensal de todas as tarefas por prazo." },
    ],
  }),
  component: CalendarioPage,
});

function CalendarioPage() {
  const { tasks, currentUser, users, openTask, openNewTask, openQuickCreate } = useFluxo();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
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

  const cells = useMemo(() => {
    const first = new Date(cursor);
    const startDow = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    const cells: { date: Date; inMonth: boolean; tasks: typeof filtered }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const isSameMonth = d.getMonth() === cursor.getMonth();
      const dayStart = new Date(d);
      const dayEnd = new Date(d);
      dayEnd.setDate(d.getDate() + 1);
      const dayTasks = filtered.filter((t) => {
        const dt = new Date(t.dueDate).getTime();
        return dt >= dayStart.getTime() && dt < dayEnd.getTime();
      });
      cells.push({ date: d, inMonth: isSameMonth, tasks: dayTasks });
    }
    return cells;
  }, [cursor, filtered]);

  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <FluxoLayout title="Calendário">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold capitalize tracking-tight">{monthLabel}</h1>
            <p className="text-sm text-muted-foreground">Visualize prazos e distribua carga ao longo do mês.</p>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              onClick={() => {
                const d = new Date(cursor);
                d.setMonth(d.getMonth() - 1);
                setCursor(d);
              }}
              className="rounded-md border border-border p-1.5 hover:bg-secondary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(1);
                d.setHours(0, 0, 0, 0);
                setCursor(d);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
            >
              Hoje
            </button>
            <button
              onClick={() => {
                const d = new Date(cursor);
                d.setMonth(d.getMonth() + 1);
                setCursor(d);
              }}
              className="rounded-md border border-border p-1.5 hover:bg-secondary"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
            <div key={d} className="bg-secondary/60 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {d}
            </div>
          ))}
          {cells.map((cell, i) => {
            const today =
              cell.date.toDateString() === new Date().toDateString();
            return (
              <button
                type="button"
                key={i}
                onClick={() =>
                  openNewTask({ dueDate: cell.date.toISOString().slice(0, 10) })
                }
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
                  {cell.tasks.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">{cell.tasks.length}</span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {cell.tasks.slice(0, 3).map((t) => {
                    const sec = sectors.find((s) => s.id === t.sector);
                    const u = users.find((x) => x.id === t.assigneeId);
                    return (
                      <button
                        key={t.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openTask(t.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openTaskContext(t.id, e.clientX, e.clientY);
                        }}
                        className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] transition hover:bg-secondary"
                        style={{
                          background: `color-mix(in oklab, ${statusColor[t.status]} 12%, transparent)`,
                        }}
                        title={`${t.title} · ${u?.name}`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: priorityColor[t.priority] }} />
                        <span className="truncate">{t.title}</span>
                        <span className="ml-auto shrink-0" style={{ color: sec?.color }}>•</span>
                      </button>
                    );
                  })}
                  {cell.tasks.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{cell.tasks.length - 3} mais</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </FluxoLayout>
  );
}