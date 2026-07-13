import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { loadPackDone, savePackDone } from "@/lib/pack";

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

  // ---- Meu pack (today) ------------------------------------------------
  const packTasks = useMemo(
    () => tasks.filter((t) => t.assigneeId === currentUser.id && t.inPack),
    [tasks, currentUser.id],
  );
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
  const packTotal = packTasks.length;
  const packDoneCount = packTasks.filter((t) => packDone.has(t.id)).length;
  const packPct = packTotal === 0 ? 0 : Math.round((packDoneCount / packTotal) * 100);
  // Team-wide pack overview (how everyone's pack looks in size)
  const teamPack = useMemo(() => {
    return users
      .map((u) => {
        const items = tasks.filter((t) => t.assigneeId === u.id && t.inPack);
        return { user: u, total: items.length };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [users, tasks]);

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

  const last7 = useMemo(() => {
    const days: { label: string; done: number }[] = [];
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
      });
    }
    return days;
  }, [completions]);

  const maxDone = Math.max(1, ...last7.map((d) => d.done));

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
  const ranking = useMemo(
    () =>
      [...users].sort((a, b) => {
        const sa = userPct.get(a.id) ?? { pct: 0, assigned: 0 };
        const sb = userPct.get(b.id) ?? { pct: 0, assigned: 0 };
        if (sa.assigned === 0 && sb.assigned === 0) return 0;
        if (sa.assigned === 0) return 1;
        if (sb.assigned === 0) return -1;
        return sb.pct - sa.pct;
      }).slice(0, 5),
    [users, userPct],
  );

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
              <span className="font-medium text-foreground">{doneToday.length}</span> hoje.
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
          <Kpi icon={CheckCircle2} label="Concluídas hoje" value={doneToday.length} sub={`${doneToday.length === 1 ? "tarefa concluída" : "tarefas concluídas"}`} color="oklch(0.62 0.16 155)" />
          <Kpi icon={Target} label="Em aberto" value={openTasks.length} sub={`${todayFocus.length} em foco agora`} color="oklch(0.52 0.22 275)" />
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
              {myScore.done} de {myScore.assigned} {myScore.assigned === 1 ? "tarefa" : "tarefas"} do mês
            </div>
          </div>
          <Kpi icon={Flame} label="Sequência" value={`${currentUser.streak} d`} sub="dias em ritmo" color="oklch(0.6 0.2 330)" />
        </div>

        {/* Meu pack — foco especial */}
        <section className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card p-5 shadow-sm">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
                    <Flame className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">Meu pack de hoje</h2>
                    <p className="text-[11px] text-muted-foreground">
                      Seus compromissos diários inegociáveis.
                    </p>
                  </div>
                </div>
                <Link
                  to="/minhas-tarefas"
                  search={{ q: undefined }}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20"
                >
                  Abrir pack <ChevronRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="mt-4 flex items-end gap-4">
                <div className="text-4xl font-semibold tabular-nums tracking-tight text-amber-600">
                  {packDoneCount}
                  <span className="text-lg text-muted-foreground">/{packTotal}</span>
                </div>
                <div className="flex-1 pb-1.5">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Progresso do dia</span>
                    <span className="font-semibold text-amber-600">{packPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${packPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5">
                {packTasks.length === 0 && (
                  <li className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-4 text-center text-xs text-muted-foreground">
                    Você ainda não montou seu pack. Vá em <Link to="/minhas-tarefas" className="font-semibold text-amber-600 hover:underline">Minhas tarefas</Link> e marque a ⭐ nas obrigações do seu dia.
                  </li>
                )}
                {packTasks.slice(0, 5).map((t) => {
                  const done = packDone.has(t.id);
                  const sec = sectors.find((s) => s.id === t.sector);
                  return (
                    <li key={t.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-amber-500/5">
                      <button
                        onClick={() => togglePackDone(t.id)}
                        aria-label={done ? "Desmarcar" : "Concluir hoje"}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                          done
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-amber-500/50 bg-transparent hover:border-amber-500"
                        }`}
                      >
                        {done && <CheckCircle2 className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => openTask(t.id)}
                        className={`flex-1 truncate text-left text-sm ${done ? "text-muted-foreground line-through" : "font-medium"}`}
                      >
                        {t.title}
                      </button>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                        style={{
                          background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                          color: sec?.color,
                        }}
                      >
                        {sec?.name}
                      </span>
                    </li>
                  );
                })}
                {packTasks.length > 5 && (
                  <li className="pl-7 pt-1 text-[11px] text-muted-foreground">
                    +{packTasks.length - 5} no pack completo
                  </li>
                )}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card/70 p-4 backdrop-blur">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Packs do time</h3>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Quem já definiu seus compromissos diários.
              </p>
              <ul className="mt-3 space-y-2">
                {teamPack.length === 0 && (
                  <li className="py-4 text-center text-xs text-muted-foreground">
                    Ninguém montou o pack ainda.
                  </li>
                )}
                {teamPack.map(({ user, total }) => (
                  <li key={user.id} className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {user.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{user.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {total} {total === 1 ? "item" : "itens"} no pack
                      </div>
                    </div>
                    <Flame className="h-3.5 w-3.5 text-amber-500" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

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
                      style={{ height: `${Math.max(6, (d.done / maxDone) * 100)}%` }}
                      title={`${d.done} ${d.done === 1 ? "tarefa" : "tarefas"}`}
                    />
                  </div>
                  <div className="mt-1 text-center text-[10px] text-muted-foreground">{d.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              {last7.reduce((s, d) => s + d.done, 0)} tarefas concluídas
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