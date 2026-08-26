import { useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Clock,
  FolderKanban,
  Paperclip,
  TrendingUp,
} from "lucide-react";

import type { CompletionEntry, Project, Task, User } from "@/lib/fluxo-types";
import {
  forecastProject,
  riskLabels,
  type Granularity,
  type ProjectForecast,
  type RiskLevel,
} from "@/lib/project-forecast";
import { ProjectFilesModal } from "@/components/project-files-modal";

/** Cor da barra/selo por risco — a mesma linguagem visual da aba do projeto. */
const riskColorVar: Record<RiskLevel, string> = {
  concluido: "var(--color-primary)",
  no_prazo: "var(--color-success)",
  atencao: "var(--color-warning)",
  atrasado: "var(--color-destructive)",
  parado: "var(--color-muted-foreground)",
  sem_prazo: "var(--color-muted-foreground)",
};

const riskBadge: Record<RiskLevel, string> = {
  concluido: "bg-primary/15 text-primary",
  no_prazo: "bg-success/15 text-success",
  atencao: "bg-warning/15 text-warning",
  atrasado: "bg-destructive/15 text-destructive",
  parado: "bg-muted text-muted-foreground",
  sem_prazo: "bg-muted text-muted-foreground",
};

const granularities: { id: Granularity; label: string; icon: typeof CalendarDays }[] = [
  { id: "dia", label: "Dia", icon: CalendarDays },
  { id: "semana", label: "Semana", icon: CalendarIcon },
  { id: "mes", label: "Mês", icon: CalendarRange },
];

interface Enriched {
  project: Project;
  tasks: Task[];
  forecast: ProjectForecast;
  start: Date;
  end: Date;
}

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";
}

function fmtPace(v: number) {
  return Number.isFinite(v)
    ? v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "—";
}

export function ProjectPortfolio({
  projects,
  getTasks,
  completions,
  users,
  onOpen,
}: {
  projects: Project[];
  getTasks: (projectId: string) => Task[];
  completions: CompletionEntry[];
  users: User[];
  onOpen: (projectId: string) => void;
}) {
  const [granularity, setGranularity] = useState<Granularity>("semana");
  const [filesId, setFilesId] = useState<string | null>(null);
  const now = new Date();

  const enriched = useMemo<Enriched[]>(() => {
    return projects
      .map((project) => {
        const tasks = getTasks(project.id);
        const forecast = forecastProject(project, tasks, completions, now);
        const start = startOfDay(new Date(project.createdAt));
        const end = startOfDay(
          forecast.dueDate ?? forecast.projectedEnd ?? new Date(project.createdAt),
        );
        return { project, tasks, forecast, start, end };
      })
      // Mais em risco primeiro: atrasado > atenção > parado > no prazo > concluído.
      .sort((a, b) => riskRank(a.forecast.risk) - riskRank(b.forecast.risk));
  }, [projects, getTasks, completions]);

  const stats = useMemo(() => {
    const acc = { total: enriched.length, no_prazo: 0, atencao: 0, atrasado: 0, concluido: 0 };
    for (const e of enriched) {
      if (e.forecast.risk === "atrasado") acc.atrasado += 1;
      else if (e.forecast.risk === "atencao" || e.forecast.risk === "parado") acc.atencao += 1;
      else if (e.forecast.risk === "no_prazo") acc.no_prazo += 1;
      else if (e.forecast.risk === "concluido") acc.concluido += 1;
    }
    return acc;
  }, [enriched]);

  const days = useMemo(() => {
    if (granularity === "dia") {
      return eachDayOfInterval({ start: startOfWeek(now, { weekStartsOn: 1 }), end: now });
    }
    if (granularity === "semana") {
      return eachDayOfInterval({
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
      });
    }
    return eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) });
  }, [granularity]);

  // Só projetos com barra visível na janela (em andamento ou atrasados que cruzam o período).
  const timelineRows = useMemo(
    () =>
      enriched.filter(
        (e) =>
          e.forecast.risk !== "concluido" &&
          e.end.getTime() >= days[0].getTime() &&
          e.start.getTime() <= days[days.length - 1].getTime(),
      ),
    [enriched, days],
  );

  if (projects.length === 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <div className="max-w-sm space-y-2">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FolderKanban className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold">Nenhum projeto para acompanhar</h3>
          <p className="text-xs text-muted-foreground">
            Crie um projeto para ver aqui a visão geral de portfólio: prazos, ritmo e risco de
            todos ao mesmo tempo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats do portfólio */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<FolderKanban className="h-4 w-4" />} label="Projetos" value={stats.total} tone="neutral" />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="No prazo" value={stats.no_prazo} tone="good" />
        <Stat icon={<Clock className="h-4 w-4" />} label="Atenção" value={stats.atencao} tone="warn" />
        <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Vão atrasar" value={stats.atrasado} tone="bad" />
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Concluídos" value={stats.concluido} tone="primary" />
      </div>

      {/* Timeline (Gantt) */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/30 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Linha do tempo dos projetos</h3>
            <p className="text-[11px] text-muted-foreground">
              {granularity === "dia" && format(now, "dd 'de' MMMM", { locale: ptBR })}
              {granularity === "semana" &&
                `Semana de ${format(days[0], "dd/MM", { locale: ptBR })} a ${format(days[days.length - 1], "dd/MM", { locale: ptBR })}`}
              {granularity === "mes" && format(now, "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
            {granularities.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setGranularity(id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                  granularity === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* Cabeçalho de dias */}
            <div className="flex border-b border-border bg-secondary/20">
              <div className="sticky left-0 z-20 w-56 shrink-0 border-r border-border bg-card p-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Projeto
              </div>
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`min-w-[64px] flex-1 border-r border-border/40 p-2 text-center last:border-r-0 ${
                    isSameDay(day, now) ? "bg-primary/10" : ""
                  }`}
                >
                  <div className="text-[9px] uppercase text-muted-foreground">
                    {format(day, "EEE", { locale: ptBR })}
                  </div>
                  <div
                    className={`text-xs font-bold tabular ${isSameDay(day, now) ? "text-primary" : "text-foreground"}`}
                  >
                    {format(day, "dd")}
                  </div>
                </div>
              ))}
            </div>

            {/* Linhas de projeto */}
            {timelineRows.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                Nenhum projeto ativo cruzando este período.
              </div>
            ) : (
              timelineRows.map(({ project, forecast, start, end }) => {
                const owner = users.find((u) => u.id === project.ownerId);
                return (
                  <button
                    key={project.id}
                    onClick={() => onOpen(project.id)}
                    className="group flex w-full border-b border-border/60 text-left transition last:border-b-0 hover:bg-secondary/30"
                  >
                    <div className="sticky left-0 z-10 w-56 shrink-0 border-r border-border bg-card p-2.5 transition group-hover:bg-secondary/60">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: project.color ?? riskColorVar[forecast.risk] }}
                        />
                        <span className="truncate text-[13px] font-medium">{project.name}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${forecast.progressPct}%`,
                              background: riskColorVar[forecast.risk],
                            }}
                          />
                        </div>
                        <span className="text-[9px] font-semibold tabular text-muted-foreground">
                          {forecast.progressPct}%
                        </span>
                      </div>
                      {owner && (
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {owner.name.split(" ")[0]}
                        </div>
                      )}
                    </div>

                    {days.map((day) => {
                      const active = isWithinInterval(day, { start, end });
                      const isStart = isSameDay(day, start);
                      const isEnd = isSameDay(day, end);
                      const isDue = forecast.dueDate && isSameDay(day, startOfDay(forecast.dueDate));
                      return (
                        <div
                          key={day.toISOString()}
                          className={`relative min-w-[64px] flex-1 border-r border-border/30 last:border-r-0 ${
                            isSameDay(day, now) ? "bg-primary/5" : ""
                          }`}
                          style={{ minHeight: 56 }}
                        >
                          {active && (
                            <div
                              className={`absolute top-1/2 h-5 -translate-y-1/2 ${isStart ? "left-1.5 rounded-l-full" : "left-0"} ${
                                isEnd ? "right-1.5 rounded-r-full" : "right-0"
                              }`}
                              style={{ background: riskColorVar[forecast.risk], opacity: 0.85 }}
                            />
                          )}
                          {isDue && (
                            <span
                              className="absolute inset-y-0 right-1.5 w-0.5"
                              style={{ background: "var(--color-destructive)" }}
                              title="Prazo"
                            />
                          )}
                        </div>
                      );
                    })}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Lista de todos os projetos */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-4 py-2.5">
          <h3 className="text-sm font-semibold">Todos os projetos</h3>
          <span className="text-[11px] text-muted-foreground">
            Clique para acompanhar e anexar fotos
          </span>
        </div>

        {/* Cabeçalho da lista (some no mobile) */}
        <div className="hidden grid-cols-[1fr_120px_120px_100px_90px_90px_64px] gap-3 border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <span>Projeto</span>
          <span>Risco</span>
          <span>Progresso</span>
          <span>Ritmo</span>
          <span>Prazo</span>
          <span>Previsão</span>
          <span className="text-center">Fotos</span>
        </div>

        {enriched.map(({ project, forecast }) => {
          const owner = users.find((u) => u.id === project.ownerId);
          const attCount = project.attachments?.length ?? 0;
          return (
            <button
              key={project.id}
              onClick={() => setFilesId(project.id)}
              className="grid w-full grid-cols-2 items-center gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 hover:bg-secondary/40 md:grid-cols-[1fr_120px_120px_100px_90px_90px_64px]"
            >
              {/* Projeto */}
              <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: project.color ?? riskColorVar[forecast.risk] }}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{project.name}</div>
                  {owner && (
                    <div className="truncate text-[11px] text-muted-foreground">{owner.name}</div>
                  )}
                </div>
              </div>

              {/* Risco */}
              <div>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskBadge[forecast.risk]}`}
                >
                  {riskLabels[forecast.risk]}
                </span>
              </div>

              {/* Progresso */}
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${forecast.progressPct}%`, background: riskColorVar[forecast.risk] }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular">
                  {forecast.progressPct}%
                </span>
              </div>

              {/* Ritmo */}
              <div className="text-xs tabular text-muted-foreground">
                {fmtPace(forecast.velocityPerDay)}/d
              </div>

              {/* Prazo */}
              <div className="text-xs tabular text-muted-foreground">{fmtDate(forecast.dueDate)}</div>

              {/* Previsão */}
              <div
                className={`text-xs tabular ${
                  forecast.risk === "atrasado" ? "font-semibold text-destructive" : "text-muted-foreground"
                }`}
              >
                {fmtDate(forecast.projectedEnd)}
              </div>

              {/* Fotos */}
              <div className="flex items-center justify-end gap-1 md:justify-center">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
                    attCount > 0 ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Paperclip className="h-3 w-3" />
                  {attCount}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>

      {filesId &&
        (() => {
          const item = enriched.find((e) => e.project.id === filesId);
          if (!item) return null;
          return (
            <ProjectFilesModal
              project={item.project}
              tasks={item.tasks}
              completions={completions}
              users={users}
              onClose={() => setFilesId(null)}
              onOpenFull={() => {
                setFilesId(null);
                onOpen(item.project.id);
              }}
            />
          );
        })()}
    </div>
  );
}

function riskRank(r: RiskLevel): number {
  const order: RiskLevel[] = ["atrasado", "atencao", "parado", "sem_prazo", "no_prazo", "concluido"];
  return order.indexOf(r);
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "neutral" | "good" | "warn" | "bad" | "primary";
}) {
  const toneClass = {
    neutral: "text-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
    primary: "text-primary",
  }[tone];
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}
