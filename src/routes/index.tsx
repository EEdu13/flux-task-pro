import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import {
  Bell,
  ChevronDown,
  Command,
  Flame,
  LayoutGrid,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trophy,
  TrendingUp,
  Calendar,
  Target,
} from "lucide-react";

import { HeroOrb } from "@/components/hero-orb";
import { TaskCard } from "@/components/task-card";
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

function Dashboard() {
  const [role, setRole] = useState<Role>("gestor_geral");
  const [sector, setSector] = useState("todos");
  const [freq, setFreq] = useState<Frequency>("diaria");

  const filteredTasks = useMemo(() => {
    return tasks.filter(
      (t) =>
        t.frequency === freq &&
        (sector === "todos" || t.sector.toLowerCase().startsWith(sector.slice(0, 4))),
    );
  }, [freq, sector]);

  const totalScore = collaborators.reduce((a, b) => a + b.score, 0);
  const goal = 15000;

  return (
    <div className="flex min-h-screen text-foreground">
      {/* Sidebar */}
      <aside className="glass-panel sticky top-0 hidden h-screen w-64 flex-col gap-6 rounded-none border-y-0 border-l-0 p-6 lg:flex">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: "var(--gradient-iris)",
              boxShadow: "0 0 24px oklch(0.78 0.17 210 / 0.5)",
            }}
          >
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Fluxo</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Task OS
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Setores
          </div>
          <nav className="flex flex-col gap-1">
            {sectors.map((s) => (
              <button
                key={s.id}
                onClick={() => setSector(s.id)}
                className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-all ${
                  sector === s.id
                    ? "bg-white/10 text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.1)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-base">{s.icon}</span>
                  {s.name}
                </span>
                {sector === s.id && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_oklch(0.78_0.17_210)]" />
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto">
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <Command className="h-3 w-3" /> Papel atual
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full appearance-none rounded-lg bg-white/5 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Object.entries(roleLabels).map(([k, v]) => (
                <option key={k} value={k} className="bg-card">
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-white/5 bg-background/60 px-6 py-4 backdrop-blur-xl lg:px-10">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">
                Bom dia, <span className="text-foreground">Ana</span> ·{" "}
                <span className="text-primary">{roleLabels[role]}</span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-gradient">
                Central de desempenho
              </h1>
            </div>
            <div className="hidden items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm text-muted-foreground md:flex">
              <Search className="h-4 w-4" />
              <input
                placeholder="Buscar tarefa, colaborador…"
                className="w-56 bg-transparent placeholder:text-muted-foreground focus:outline-none"
              />
              <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </div>
            <button className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/5 transition hover:bg-white/10">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_oklch(0.7_0.2_330)]" />
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
              style={{
                background: "linear-gradient(120deg, oklch(0.78 0.17 210), oklch(0.7 0.2 330))",
                boxShadow: "0 8px 30px -8px oklch(0.78 0.17 210 / 0.6)",
              }}
            >
              <Plus className="h-4 w-4" />
              Nova tarefa
            </button>
          </div>
        </header>

        <div className="px-6 pb-24 pt-8 lg:px-10">
          {/* Hero row */}
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            {/* Orb + score */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="glass-panel relative overflow-hidden rounded-3xl p-8"
            >
              <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-30 blur-3xl"
                style={{ background: "var(--gradient-iris)" }}
              />
              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
                <HeroOrb score={12480} goal={goal} />
                <div className="flex-1 space-y-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                      Score coletivo · Julho
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <div className="text-5xl font-semibold tracking-tight text-gradient">
                        {totalScore.toLocaleString("pt-BR")}
                      </div>
                      <div className="text-sm text-muted-foreground">/ {goal.toLocaleString("pt-BR")} pts</div>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium"
                      style={{ color: "oklch(0.78 0.18 155)" }}
                    >
                      <TrendingUp className="h-3 w-3" />
                      +12,4% vs. mês anterior
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { icon: Target, label: "Metas ativas", value: "38", color: "oklch(0.78 0.17 210)" },
                      { icon: Flame, label: "Streak equipe", value: "12d", color: "oklch(0.7 0.2 25)" },
                      { icon: Trophy, label: "Conquistas", value: "146", color: "oklch(0.82 0.17 85)" },
                    ].map((s, i) => (
                      <div key={i} className="glass-panel rounded-xl p-3">
                        <s.icon className="h-4 w-4" style={{ color: s.color }} />
                        <div className="mt-2 text-lg font-semibold">{s.value}</div>
                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {s.label}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.section>

            {/* Leaderboard */}
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="glass-panel rounded-3xl p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    Ranking
                  </div>
                  <h3 className="text-lg font-semibold">Top colaboradores</h3>
                </div>
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  Mês <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              <ul className="space-y-2">
                {collaborators.slice(0, 5).map((c, i) => {
                  const pct = (c.score / collaborators[0].score) * 100;
                  return (
                    <li key={c.id} className="group relative overflow-hidden rounded-2xl bg-white/5 p-3 transition hover:bg-white/10">
                      <div
                        className="absolute inset-y-0 left-0 -z-0 opacity-20"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg, oklch(0.78 0.17 210), oklch(0.7 0.2 330))",
                        }}
                      />
                      <div className="relative flex items-center gap-3">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                          i === 0 ? "bg-warning text-background" : "bg-white/10 text-muted-foreground"
                        }`}
                          style={i === 0 ? { background: "oklch(0.82 0.17 85)", color: "oklch(0.14 0.03 265)" } : {}}
                        >
                          {i + 1}
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-primary-foreground"
                          style={{ background: "linear-gradient(135deg, oklch(0.78 0.17 210), oklch(0.7 0.2 330))" }}
                        >
                          {c.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {c.role} · {c.sector}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-foreground">
                            {c.score.toLocaleString("pt-BR")}
                          </div>
                          <div className="inline-flex items-center gap-1 text-[10px] text-warning" style={{ color: "oklch(0.82 0.17 85)" }}>
                            <Flame className="h-2.5 w-2.5" /> {c.streak}d
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </motion.section>
          </div>

          {/* Tasks + notifications */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
            {/* Tasks */}
            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-lg font-semibold">Tarefas</h2>
                </div>
                <div className="glass-panel inline-flex rounded-full p-1">
                  {(Object.keys(freqLabels) as Frequency[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFreq(f)}
                      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${
                        freq === f
                          ? "text-primary-foreground shadow-[0_4px_20px_-4px_oklch(0.78_0.17_210/0.6)]"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      style={
                        freq === f
                          ? { background: "linear-gradient(120deg, oklch(0.78 0.17 210), oklch(0.7 0.2 330))" }
                          : {}
                      }
                    >
                      {freqLabels[f]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {filteredTasks.map((t, i) => (
                  <TaskCard key={t.id} task={t} index={i} />
                ))}
                {filteredTasks.length === 0 && (
                  <div className="glass-panel col-span-full rounded-2xl p-8 text-center text-sm text-muted-foreground">
                    Nenhuma tarefa neste período.
                  </div>
                )}
              </div>
            </section>

            {/* Notifications */}
            <aside className="space-y-6">
              <section className="glass-panel rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Avisos</h3>
                  </div>
                  <button className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
                    Ver tudo
                  </button>
                </div>
                <ul className="space-y-3">
                  {notifications.map((n) => (
                    <li key={n.id} className="flex gap-3">
                      <div
                        className="mt-1 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            n.type === "alerta"
                              ? "oklch(0.7 0.2 25)"
                              : n.type === "meta"
                                ? "oklch(0.78 0.18 155)"
                                : n.type === "conquista"
                                  ? "oklch(0.82 0.17 85)"
                                  : "oklch(0.78 0.17 210)",
                          boxShadow: "0 0 8px currentColor",
                        }}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">{n.title}</div>
                        <div className="text-xs text-muted-foreground">{n.desc}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                          {n.time}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="glass-panel rounded-2xl p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold">Agenda inteligente</h3>
                </div>
                <div className="space-y-2 text-xs">
                  {["09:00 · Daily do setor", "11:30 · Revisão de metas", "14:00 · Alinhamento cliente", "16:30 · 1:1 com liderança"].map(
                    (item, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                        <span className="text-foreground">{item}</span>
                        <Settings2 className="h-3 w-3 text-muted-foreground" />
                      </div>
                    ),
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
