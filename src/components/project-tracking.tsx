import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Flag,
  Gauge,
  TrendingUp,
} from "lucide-react";

import type { CompletionEntry, Project, Task, User } from "@/lib/fluxo-types";
import {
  buildBurnup,
  forecastProject,
  riskExplanation,
  riskLabels,
  type Granularity,
  type RiskLevel,
} from "@/lib/project-forecast";

const riskStyles: Record<RiskLevel, string> = {
  concluido: "bg-primary/15 text-primary border-primary/30",
  no_prazo: "bg-success/15 text-success border-success/30",
  atencao: "bg-warning/15 text-warning border-warning/30",
  atrasado: "bg-destructive/15 text-destructive border-destructive/30",
  parado: "bg-muted text-muted-foreground border-border",
  sem_prazo: "bg-muted text-muted-foreground border-border",
};

const granularities: { id: Granularity; label: string }[] = [
  { id: "dia", label: "Dia" },
  { id: "semana", label: "Semana" },
  { id: "mes", label: "Mês" },
];

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
}

function fmtPace(v: number) {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function ProjectTracking({
  project,
  tasks,
  completions,
  users,
}: {
  project: Project;
  tasks: Task[];
  completions: CompletionEntry[];
  users: User[];
}) {
  const [granularity, setGranularity] = useState<Granularity>("semana");

  const forecast = useMemo(
    () => forecastProject(project, tasks, completions),
    [project, tasks, completions],
  );
  const data = useMemo(
    () => buildBurnup(project, tasks, completions, granularity),
    [project, tasks, completions, granularity],
  );

  const prazoPoint = data.find((p) => p.isPrazo);

  // O que está puxando o projeto para trás, em ordem de atraso.
  const emRisco = useMemo(() => {
    const now = Date.now();
    return tasks
      .filter((t) => t.status !== "concluida")
      .map((t) => ({ t, atraso: Math.floor((now - new Date(t.dueDate).getTime()) / 86400000) }))
      .filter((x) => x.atraso >= -2)
      .sort((a, b) => b.atraso - a.atraso)
      .slice(0, 6);
  }, [tasks]);

  if (forecast.total === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <div className="max-w-sm space-y-2">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TrendingUp className="h-5 w-5" />
          </span>
          <h3 className="text-sm font-semibold">Sem dados para acompanhar</h3>
          <p className="text-xs text-muted-foreground">
            Adicione subtarefas ao projeto. O acompanhamento usa as conclusões para calcular
            ritmo, previsão de término e risco.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Leitura de risco — a resposta antes dos detalhes. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${riskStyles[forecast.risk]}`}
      >
        <div className="flex items-center gap-2.5">
          {forecast.risk === "concluido" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          )}
          <div>
            <div className="text-sm font-semibold">{riskLabels[forecast.risk]}</div>
            <div className="text-[11px] opacity-90">{riskExplanation(forecast)}</div>
          </div>
        </div>
        {forecast.projectedEnd && (
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
              Término previsto
            </div>
            <div className="text-sm font-semibold tabular">{fmtDate(forecast.projectedEnd)}</div>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Progresso"
          value={`${forecast.progressPct}%`}
          hint={`${forecast.done} de ${forecast.total} subtarefas`}
        />
        <Kpi
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Ritmo atual"
          value={`${fmtPace(forecast.velocityPerDay)}/dia`}
          hint={
            forecast.requiredPerDay == null
              ? "Sem prazo definido"
              : Number.isFinite(forecast.requiredPerDay)
                ? `Precisa de ${fmtPace(forecast.requiredPerDay)}/dia`
                : "Prazo esgotado"
          }
          tone={
            forecast.requiredPerDay != null &&
            Number.isFinite(forecast.requiredPerDay) &&
            forecast.velocityPerDay < forecast.requiredPerDay
              ? "bad"
              : "good"
          }
        />
        <Kpi
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Prazo do projeto"
          value={fmtDate(forecast.dueDate)}
          hint={
            forecast.slackDays == null
              ? "Defina um prazo"
              : forecast.slackDays >= 0
                ? `${forecast.slackDays} dia(s) de folga`
                : `${Math.abs(forecast.slackDays)} dia(s) de estouro`
          }
          tone={forecast.slackDays == null ? undefined : forecast.slackDays >= 0 ? "good" : "bad"}
        />
        <Kpi
          icon={<Flag className="h-3.5 w-3.5" />}
          label="Subtarefas vencidas"
          value={String(forecast.overdue)}
          hint={forecast.overdue === 0 ? "Nada vencido" : "Precisam de ação agora"}
          tone={forecast.overdue === 0 ? "good" : "bad"}
        />
      </div>

      {/* Curva de avanço */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Avanço ao longo do tempo</h3>
            <p className="text-[11px] text-muted-foreground">
              Entregue de verdade contra o esperado — e até onde o ritmo atual leva.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
            {granularities.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGranularity(g.id)}
                className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                  granularity === g.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
                minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--color-popover-foreground)",
                }}
                labelStyle={{ color: "var(--color-muted-foreground)", fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
              {prazoPoint && (
                <ReferenceLine
                  x={prazoPoint.label}
                  stroke="var(--color-destructive)"
                  strokeDasharray="4 4"
                  label={{
                    value: "prazo",
                    position: "top",
                    fill: "var(--color-destructive)",
                    fontSize: 10,
                  }}
                />
              )}
              <Line
                name="Esperado"
                type="monotone"
                dataKey="ideal"
                stroke="var(--color-muted-foreground)"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
              <Line
                name="Projeção"
                type="monotone"
                dataKey="projecao"
                stroke="var(--color-warning)"
                strokeDasharray="4 3"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                name="Concluído"
                type="monotone"
                dataKey="concluidas"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Onde está o risco */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">O que está segurando o projeto</h3>
          <p className="text-[11px] text-muted-foreground">
            Subtarefas vencidas ou vencendo, da mais atrasada para a menos.
          </p>
        </div>
        {emRisco.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            Nada vencido nem vencendo nos próximos dias.
          </div>
        ) : (
          emRisco.map(({ t, atraso }) => {
            const dono = users.find((u) => u.id === t.assigneeId);
            const vencida = atraso > 0;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${vencida ? "bg-destructive" : "bg-warning"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {dono?.name ?? "Sem responsável"} ·{" "}
                    {new Date(t.dueDate).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    vencida
                      ? "bg-destructive/15 text-destructive"
                      : "bg-warning/15 text-warning"
                  }`}
                >
                  {vencida ? `${atraso}d atrasada` : atraso === 0 ? "vence hoje" : "vence em breve"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
