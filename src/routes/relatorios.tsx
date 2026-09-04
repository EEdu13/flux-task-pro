import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
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
import { sectors, statusLabels, priorityLabels } from "@/lib/fluxo-types";
import {
  carregarTempoDoServidor,
  formatHM,
  formatHMS,
  buildSessionsCsv,
  buildSummaryCsv,
  downloadCsv,
  type CsvSessionRow,
  type CsvSummaryRow,
  type Persisted,
} from "@/lib/time-log";
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

  // Manager scope: gestor sees all, supervisor sees self + subordinates,
  // adm only sees self.
  const visibleUsers = useMemo(() => {
    if (currentUser.role === "gerente") return users;
    if (currentUser.role === "supervisor")
      return users.filter((u) => u.id === currentUser.id || u.supervisorId === currentUser.id);
    return users.filter((u) => u.id === currentUser.id);
  }, [users, currentUser]);

  // "all" aggregates every log stored locally; otherwise per-user log.
  const [scope, setScope] = useState<string>(currentUser.id);
  useEffect(() => {
    setScope(currentUser.id);
  }, [currentUser.id]);

  /* O tempo vem do banco, não do `localStorage` desta máquina.
     `timeTick` dispara na primeira carga e a cada sessão encerrada — o
     cronômetro emite o evento de novo depois que a gravação no servidor
     responde, então a busca abaixo já encontra a sessão nova. */
  const [allLogs, setAllLogs] = useState<Record<string, Persisted>>({});
  const [carregandoTempo, setCarregandoTempo] = useState(true);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const dados = await carregarTempoDoServidor();
        if (vivo) setAllLogs(dados);
      } catch (e) {
        console.warn("[fluxo] tempo não carregou:", (e as Error)?.message);
      } finally {
        if (vivo) setCarregandoTempo(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [timeTick]);

  // Merge sessions + totals across the chosen scope.
  const timeLog = useMemo(() => {
    if (scope === "all") {
      const sessions = visibleUsers.flatMap((u) => allLogs[u.id]?.sessions ?? []);
      const totals: Record<string, number> = {};
      for (const u of visibleUsers) {
        const t = allLogs[u.id]?.totals ?? {};
        for (const [k, v] of Object.entries(t)) totals[k] = (totals[k] ?? 0) + v;
      }
      return { sessions, totals };
    }
    return allLogs[scope] ?? { sessions: [], totals: {} };
  }, [scope, visibleUsers, allLogs]);

  const scopeLabel =
    scope === "all"
      ? "todos os colaboradores"
      : (users.find((u) => u.id === scope)?.name ?? "colaborador");

  const sessionToUserId = useMemo(() => {
    // For "all" mode we need to know which user each session belongs to.
    const map = new Map<string, string>();
    if (scope !== "all") {
      for (const s of allLogs[scope]?.sessions ?? []) map.set(s.id, scope);
      return map;
    }
    for (const u of visibleUsers) {
      for (const s of allLogs[u.id]?.sessions ?? []) map.set(s.id, u.id);
    }
    return map;
  }, [scope, visibleUsers, allLogs]);

  const userById = useMemo(() => {
    const m = new Map<string, (typeof users)[number]>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

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

  // Recent sessions table
  const recentSessions = useMemo(() => {
    return [...timeLog.sessions]
      .sort((a, b) => b.endedAt - a.endedAt)
      .slice(0, 30)
      .map((s) => {
        const t = tasks.find((x) => x.id === s.taskId);
        const uid = sessionToUserId.get(s.id);
        const u = uid ? userById.get(uid) : undefined;
        return {
          ...s,
          taskTitle: t?.title ?? "(tarefa removida)",
          taskStatus: t ? statusLabels[t.status] : "",
          userName: u?.name ?? (uid === currentUser.id ? currentUser.name : "—"),
        };
      });
  }, [timeLog, tasks, sessionToUserId, userById, currentUser]);

  // Time per user (only meaningful with data stored locally)
  const timeByUser = useMemo(() => {
    return visibleUsers
      .map((u) => {
        const secs = (allLogs[u.id]?.sessions ?? []).reduce((s, x) => s + x.seconds, 0);
        return { id: u.id, name: u.name.split(" ")[0]!, seconds: secs, minutes: Math.round(secs / 60) };
      })
      .filter((r) => r.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 10);
  }, [visibleUsers, allLogs]);

  // ---------------- Exports ----------------

  const exportSessions = () => {
    const rows: CsvSessionRow[] = [...timeLog.sessions]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s) => {
        const t = tasks.find((x) => x.id === s.taskId);
        const uid = sessionToUserId.get(s.id) ?? scope;
        const u = userById.get(uid);
        return {
          userName: u?.name ?? "—",
          userSector: u?.sector,
          taskId: s.taskId,
          taskTitle: t?.title ?? "(tarefa removida)",
          status: t ? statusLabels[t.status] : "",
          priority: t ? priorityLabels[t.priority] : "",
          estimatedMinutes: t?.estimatedMinutes,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          seconds: s.seconds,
        };
      });
    downloadCsv(`fluxo-sessoes-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, buildSessionsCsv(rows));
  };

  const exportSummary = () => {
    // Aggregate per user + task
    const agg = new Map<
      string,
      { userId: string; taskId: string; seconds: number; sessions: number; firstAt: number; lastAt: number }
    >();
    for (const s of timeLog.sessions) {
      const uid = sessionToUserId.get(s.id) ?? scope;
      const k = `${uid}|${s.taskId}`;
      const cur = agg.get(k);
      if (!cur) {
        agg.set(k, {
          userId: uid,
          taskId: s.taskId,
          seconds: s.seconds,
          sessions: 1,
          firstAt: s.startedAt,
          lastAt: s.endedAt,
        });
      } else {
        cur.seconds += s.seconds;
        cur.sessions += 1;
        cur.firstAt = Math.min(cur.firstAt, s.startedAt);
        cur.lastAt = Math.max(cur.lastAt, s.endedAt);
      }
    }
    const rows: CsvSummaryRow[] = [...agg.values()]
      .sort((a, b) => b.seconds - a.seconds)
      .map((r) => {
        const t = tasks.find((x) => x.id === r.taskId);
        const u = userById.get(r.userId);
        return {
          userName: u?.name ?? "—",
          userSector: u?.sector,
          taskTitle: t?.title ?? "(tarefa removida)",
          status: t ? statusLabels[t.status] : "",
          priority: t ? priorityLabels[t.priority] : "",
          estimatedMinutes: t?.estimatedMinutes,
          totalSeconds: r.seconds,
          sessions: r.sessions,
          firstAt: r.firstAt,
          lastAt: r.lastAt,
        };
      });
    downloadCsv(`fluxo-tempo-por-tarefa-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, buildSummaryCsv(rows));
  };

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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
            <p className="text-sm text-muted-foreground">
              Desempenho, tempo trabalhado e evolução — atualmente exibindo <b>{scopeLabel}</b>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-medium text-muted-foreground">Visão de tempo:</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {visibleUsers.length > 1 && <option value="all">Todos ({visibleUsers.length})</option>}
              {visibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.id === currentUser.id ? " (você)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportSummary}
              disabled={timeLog.sessions.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
              title="CSV consolidado por tarefa"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Resumo
            </button>
            <button
              type="button"
              onClick={exportSessions}
              disabled={timeLog.sessions.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              title="CSV detalhado com início, fim e duração"
            >
              <Download className="h-3.5 w-3.5" /> Sessões
            </button>
          </div>
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
            {carregandoTempo ? (
              "Buscando as sessões no servidor…"
            ) : (
              <>
                Baseado no play/pause/stop das tarefas de <b>{scopeLabel}</b>.
              </>
            )}
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

        {timeByUser.length > 0 && (
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Tempo por colaborador</h2>
            <p className="text-[11px] text-muted-foreground">
              Soma das sessões cronometradas nos últimos 90 dias, de qualquer computador — útil
              para o gestor comparar cargas.
            </p>
            <div className="mt-3 h-64">
              <ResponsiveContainer>
                <BarChart data={timeByUser} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }}
                    formatter={(v: number) => [`${v} min`, "Trabalhado"]}
                  />
                  <Bar dataKey="minutes" fill="var(--color-chart-4)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

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
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Sessões recentes</h2>
              <p className="text-[11px] text-muted-foreground">
                Últimas 30 sessões cronometradas — use "Exportar sessões" para baixar tudo em CSV.
              </p>
            </div>
          </div>
          {recentSessions.length === 0 ? (
            <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhuma sessão registrada. Use ▶ em qualquer tarefa para começar.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Tarefa</th>
                    {scope === "all" && <th className="pb-2 pr-3 font-medium">Colaborador</th>}
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Início</th>
                    <th className="pb-2 pr-3 font-medium">Fim</th>
                    <th className="pb-2 pr-3 text-right font-medium">Duração</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.map((s) => (
                    <tr key={s.id} className="border-t border-border/60">
                      <td className="max-w-[240px] truncate py-2 pr-3">{s.taskTitle}</td>
                      {scope === "all" && <td className="py-2 pr-3 text-muted-foreground">{s.userName}</td>}
                      <td className="py-2 pr-3 text-muted-foreground">{s.taskStatus}</td>
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                        {new Date(s.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                        {new Date(s.endedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatHMS(s.seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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