import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, statusLabels } from "@/lib/fluxo-types";
import { loadTimeLog, formatHM } from "@/lib/time-log";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios · Fluxo" },
      { name: "description", content: "Desempenho por pessoa, setor e evolução ao longo do tempo." },
    ],
  }),
  component: Relatorios,
});

function Relatorios() {
  const { tasks, users, completions, currentUser } = useFluxo();
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const on = () => setTimeTick((v) => v + 1);
    window.addEventListener("fluxo:timer-updated", on);
    return () => window.removeEventListener("fluxo:timer-updated", on);
  }, []);

  const timeLog = useMemo(() => loadTimeLog(currentUser.id), [currentUser.id, timeTick]);

  // Aggregate seconds worked per day (last 30 days)
  const timeByDay = useMemo(() => {
    const buckets: { label: string; key: string; seconds: number }[] = [];
    const map = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, 0);
      buckets.push({
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        key,
        seconds: 0,
      });
    }
    for (const s of timeLog.sessions) {
      const key = new Date(s.endedAt).toISOString().slice(0, 10);
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + s.seconds);
    }
    return buckets.map((b) => ({ ...b, seconds: map.get(b.key) ?? 0, minutes: Math.round((map.get(b.key) ?? 0) / 60) }));
  }, [timeLog]);

  const totalSecondsAll = useMemo(
    () => timeLog.sessions.reduce((s, x) => s + x.seconds, 0),
    [timeLog],
  );
  const totalSecondsLast7 = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 3600e3;
    return timeLog.sessions.filter((s) => s.endedAt >= cutoff).reduce((sum, x) => sum + x.seconds, 0);
  }, [timeLog]);

  const topTasks = useMemo(() => {
    const entries = Object.entries(timeLog.totals)
      .map(([taskId, secs]) => {
        const t = tasks.find((x) => x.id === taskId);
        return { taskId, title: t?.title ?? "(tarefa removida)", seconds: secs, estimated: t?.estimatedMinutes };
      })
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 8);
    return entries;
  }, [timeLog, tasks]);

  const estimateAccuracy = useMemo(() => {
    const rows = tasks
      .filter((t) => t.estimatedMinutes && (timeLog.totals[t.id] ?? 0) > 60)
      .map((t) => {
        const actualMin = Math.round((timeLog.totals[t.id] ?? 0) / 60);
        const est = t.estimatedMinutes!;
        return {
          taskId: t.id,
          title: t.title,
          est,
          actual: actualMin,
          diff: actualMin - est,
          pct: Math.round((actualMin / est) * 100),
        };
      })
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 8);
    return rows;
  }, [tasks, timeLog]);

  const last30 = useMemo(() => {
    const days: { label: string; concluidas: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const end = new Date(d);
      end.setDate(d.getDate() + 1);
      const items = completions.filter((c) => {
        const t = new Date(c.at).getTime();
        return t >= d.getTime() && t < end.getTime();
      });
      days.push({
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        concluidas: items.length,
      });
    }
    return days;
  }, [completions]);

  const byUser = useMemo(() => {
    return users
      .map((u) => ({
        name: u.name.split(" ")[0]!,
        concluidas: completions.filter((c) => c.userId === u.id).length,
      }))
      .sort((a, b) => b.concluidas - a.concluidas)
      .slice(0, 8);
  }, [users, completions]);

  const bySector = useMemo(() => {
    return sectors.map((s) => {
      const uids = users.filter((u) => u.sector === s.id).map((u) => u.id);
      const total = completions.filter((c) => uids.includes(c.userId)).length;
      return { name: s.name, value: total, color: s.color };
    });
  }, [users, completions]);

  const statusDist = useMemo(() => {
    return (Object.keys(statusLabels) as (keyof typeof statusLabels)[]).map((k) => ({
      name: statusLabels[k],
      value: tasks.filter((t) => t.status === k).length,
    }));
  }, [tasks]);

  return (
    <FluxoLayout title="Relatórios">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Desempenho dos últimos 30 dias, por pessoa, setor e status.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Kpi label="Tarefas concluídas (30d)" value={completions.length} />
          <Kpi label="No prazo (30d)" value={completions.filter((c) => c.onTime).length} />
          <Kpi label="No prazo" value={`${Math.round((completions.filter((c) => c.onTime).length / Math.max(1, completions.length)) * 100)}%`} />
          <Kpi label="Tarefas abertas" value={tasks.filter((t) => t.status !== "concluida").length} />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Kpi label="Tempo total registrado" value={formatHM(totalSecondsAll)} />
          <Kpi label="Tempo — últimos 7 dias" value={formatHM(totalSecondsLast7)} />
          <Kpi label="Tarefas com tempo" value={Object.keys(timeLog.totals).length} />
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Tempo trabalhado — últimos 30 dias (minutos)</h2>
          <p className="text-[11px] text-muted-foreground">
            Baseado nos pomodoros e no play/pause/stop das tarefas do usuário atual.
          </p>
          <div className="mt-3 h-64">
            <ResponsiveContainer>
              <BarChart data={timeByDay} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }}
                  formatter={(v: number) => [`${v} min`, "Trabalhado"]}
                />
                <Bar dataKey="minutes" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Tarefas que mais consumiram tempo</h2>
            {topTasks.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Ainda nenhuma tarefa cronometrada. Use ▶ em qualquer tarefa para começar.
              </div>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {topTasks.map((t) => {
                  const est = t.estimated ? t.estimated * 60 : 0;
                  const over = est > 0 && t.seconds > est;
                  const pct = est > 0 ? Math.min(200, Math.round((t.seconds / est) * 100)) : null;
                  return (
                    <li key={t.taskId} className="rounded-md border border-border bg-background p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">
                          {formatHM(t.seconds)}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className={`h-full ${over ? "bg-destructive" : "bg-primary"}`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className={over ? "text-destructive" : ""}>
                            {pct}% de {formatHM(est)}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Estimado × real</h2>
            <p className="text-[11px] text-muted-foreground">
              Onde a estimativa está longe da realidade (bom para calibrar próximos prazos).
            </p>
            {estimateAccuracy.length === 0 ? (
              <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nenhuma tarefa com estimativa + tempo cronometrado ainda.
              </div>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {estimateAccuracy.map((r) => (
                  <li key={r.taskId} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatHM(r.actual * 60)} / {formatHM(r.est * 60)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        r.diff > 0
                          ? "bg-destructive/15 text-destructive"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {r.diff > 0 ? "+" : ""}
                      {r.diff}min
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Evolução — últimos 30 dias</h2>
          <div className="mt-3 h-72">
            <ResponsiveContainer>
              <LineChart data={last30} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="concluidas" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Concluídas" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Top pessoas (tarefas concluídas)</h2>
            <div className="mt-3 h-72">
              <ResponsiveContainer>
                <BarChart data={byUser} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                  <Bar dataKey="concluidas" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Tarefas por setor</h2>
            <div className="mt-3 h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bySector} dataKey="value" nameKey="name" outerRadius={90} label={{ fontSize: 10 }}>
                    {bySector.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Distribuição por status</h2>
          <div className="mt-3 h-56">
            <ResponsiveContainer>
              <BarChart data={statusDist} layout="vertical" margin={{ left: 40, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="value" fill="var(--color-chart-3)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </FluxoLayout>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}