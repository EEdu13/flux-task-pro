import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AtSign,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flame,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { formatDueBucket, formatRelative } from "@/lib/use-theme";
import { sectors, statusColor, statusLabels } from "@/lib/fluxo-types";
import { userScorePct, scoreTextClass } from "@/lib/score";
import { ScoreBar } from "@/components/score-bar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluxo · Painel de desempenho" },
      { name: "description", content: "Visão executiva com foco de hoje, ranking e metas do time." },
    ],
  }),
  component: Home,
});

function Home() {
  const { currentUser, tasks, users, notifications, completions, openTask } = useFluxo();

  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const openTasks = myTasks.filter((t) => t.status !== "concluida");
  const todayFocus = openTasks
    .filter((t) => formatDueBucket(t.dueDate) !== "depois")
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 6);

  const doneToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return completions.filter(
      (c) => c.userId === currentUser.id && new Date(c.at).getTime() >= today.getTime(),
    );
  }, [completions, currentUser.id]);

  const pointsToday = doneToday.reduce((s, c) => s + c.points, 0);

  const last7 = useMemo(() => {
    const days: { label: string; done: number; points: number }[] = [];
    for (let i = 6; i >= 0; i--) {
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
        label: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3),
        done: items.length,
        points: items.reduce((s, c) => s + c.points, 0),
      });
    }
    return days;
  }, [completions]);

  const maxPts = Math.max(1, ...last7.map((d) => d.points));

  const ranking = useMemo(() => [...users].sort((a, b) => b.score - a.score).slice(0, 5), [users]);
  const myScore = useMemo(
    () => userScorePct(currentUser.id, tasks, completions),
    [currentUser.id, tasks, completions],
  );
  const userPct = useMemo(() => {
    const m = new Map<string, { pct: number; assigned: number }>();
    for (const u of users) {
      const s = userScorePct(u.id, tasks, completions);
      m.set(u.id, { pct: s.pct, assigned: s.assigned });
    }
    return m;
  }, [users, tasks, completions]);

  const recentNotifs = notifications
    .filter((n) => n.userId === currentUser.id)
    .slice(0, 5);

  return (
    <FluxoLayout title="Início">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Olá, {currentUser.name.split(" ")[0]} 👋
            </h1>
            <p className="text-sm text-muted-foreground">
              Você tem <span className="font-medium text-foreground">{openTasks.length}</span> tarefas em aberto e concluiu{" "}
              <span className="font-medium text-foreground">{doneToday.length}</span> hoje (+{pointsToday} pts).
            </p>
          </div>
          <Link
            to="/minhas-tarefas"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Ir para minhas tarefas <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Kpi icon={CheckCircle2} label="Concluídas hoje" value={doneToday.length} sub={`+${pointsToday} pontos`} color="oklch(0.62 0.16 155)" />
          <Kpi icon={Target} label="Em aberto" value={openTasks.length} sub={`${todayFocus.length} vencem esta semana`} color="oklch(0.52 0.22 275)" />
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Meu score do mês</span>
              <Trophy
                className="h-4 w-4"
                style={{
                  color:
                    myScore.assigned === 0
                      ? "oklch(0.55 0.02 260)"
                      : myScore.pct >= 100
                        ? "oklch(0.62 0.16 155)"
                        : "oklch(0.58 0.22 25)",
                }}
              />
            </div>
            <div className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${scoreTextClass(myScore.pct, myScore.assigned)}`}>
              {myScore.assigned === 0 ? "—" : `${Math.round(myScore.pct)}%`}
            </div>
            <div className="mt-2">
              <ScoreBar pct={myScore.pct} assigned={myScore.assigned} showLabel={false} size="md" />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {myScore.points.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / {myScore.assigned} pts do mês
            </div>
          </div>
          <Kpi icon={Flame} label="Sequência" value={`${currentUser.streak} d`} sub="dias em ritmo" color="oklch(0.6 0.2 330)" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Foco de hoje</h2>
                <p className="text-xs text-muted-foreground">Tarefas vencendo em breve, priorizadas.</p>
              </div>
              <Link to="/minhas-tarefas" className="text-xs font-medium text-primary hover:underline">
                Ver todas
              </Link>
            </div>
            <ul className="mt-4 divide-y divide-border">
              {todayFocus.length === 0 && (
                <li className="py-10 text-center text-sm text-muted-foreground">
                  🎉 Nada urgente. Aproveite pra planejar a semana.
                </li>
              )}
              {todayFocus.map((t) => {
                const bucket = formatDueBucket(t.dueDate);
                const sec = sectors.find((s) => s.id === t.sector);
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => openTask(t.id)}
                      className="flex w-full items-center gap-3 py-3 text-left hover:bg-secondary/40"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                            style={{
                              background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                              color: sec?.color,
                            }}
                          >
                            {sec?.name}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                            style={{
                              background: `color-mix(in oklab, ${statusColor[t.status]} 18%, transparent)`,
                              color: statusColor[t.status],
                            }}
                          >
                            {statusLabels[t.status]}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 font-semibold ${
                              bucket === "atrasada"
                                ? "bg-destructive/15 text-destructive"
                                : bucket === "hoje"
                                ? "bg-warning/20 text-warning"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {bucket === "atrasada" ? "Atrasada" : bucket === "hoje" ? "Hoje" : "Esta semana"}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-primary">+{t.score}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Últimos 7 dias · time</h2>
            </div>
            <div className="mt-4 flex items-end gap-2">
              {last7.map((d) => (
                <div key={d.label} className="flex-1">
                  <div className="flex h-32 items-end">
                    <div
                      className="w-full rounded-t-md bg-primary/80 transition-all"
                      style={{ height: `${Math.max(6, (d.points / maxPts) * 100)}%` }}
                      title={`${d.done} tarefas · ${d.points} pts`}
                    />
                  </div>
                  <div className="mt-1 text-center text-[10px] text-muted-foreground">{d.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              {last7.reduce((s, d) => s + d.done, 0)} tarefas · {last7.reduce((s, d) => s + d.points, 0)} pontos
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Ranking do time</h2>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {ranking.map((u, i) => {
                const s = userPct.get(u.id) ?? { pct: 0, assigned: 0 };
                return (
                  <li key={u.id} className="flex items-center gap-3 py-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                      style={
                        i === 0
                          ? { background: "oklch(0.78 0.15 75)", color: "oklch(0.25 0.05 60)" }
                          : { background: "oklch(0.95 0.005 260)", color: "oklch(0.5 0.02 260)" }
                      }
                    >
                      {i + 1}
                    </span>
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      {u.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="mt-1">
                        <ScoreBar pct={s.pct} assigned={s.assigned} showLabel={false} size="sm" />
                      </div>
                    </div>
                    <div className={`text-right text-sm font-semibold tabular-nums ${scoreTextClass(s.pct, s.assigned)}`}>
                      {s.assigned === 0 ? "—" : `${Math.round(s.pct)}%`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Últimos avisos</h2>
              </div>
              <Link to="/inbox" className="text-xs font-medium text-primary hover:underline">
                Abrir inbox
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {recentNotifs.length === 0 && (
                <li className="py-8 text-center text-xs text-muted-foreground">Sem avisos.</li>
              )}
              {recentNotifs.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => n.taskId && openTask(n.taskId)}
                    className="flex w-full gap-3 py-3 text-left hover:bg-secondary/40"
                  >
                    <AtSign className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{n.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{n.desc}</div>
                      <div className="text-[10px] text-muted-foreground/70">{formatRelative(n.at)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </FluxoLayout>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Trophy;
  label: string;
  value: string | number;
  sub: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}