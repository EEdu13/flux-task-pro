import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import type { CompletionEntry, Project, Task } from "./fluxo-types";

export type Granularity = "dia" | "semana" | "mes";

export type RiskLevel =
  | "concluido"
  | "no_prazo"
  | "atencao"
  | "atrasado"
  | "parado"
  | "sem_prazo";

export const riskLabels: Record<RiskLevel, string> = {
  concluido: "Concluído",
  no_prazo: "No prazo",
  atencao: "Atenção",
  atrasado: "Vai atrasar",
  parado: "Parado",
  sem_prazo: "Sem prazo",
};

/** Explica o porquê do risco em uma frase — o número sozinho não decide nada. */
export function riskExplanation(f: ProjectForecast): string {
  switch (f.risk) {
    case "concluido":
      return "Todas as subtarefas foram concluídas.";
    case "sem_prazo":
      return "Defina um prazo no projeto para acompanhar o risco de entrega.";
    case "parado":
      return f.total === 0
        ? "Nenhuma subtarefa cadastrada ainda."
        : "Nenhuma conclusão nas últimas semanas — sem ritmo não dá para projetar o término.";
    case "atrasado":
      return `No ritmo atual termina ${Math.abs(f.slackDays ?? 0)} dia(s) depois do prazo.`;
    case "atencao":
      return f.overdue > 0
        ? `${f.overdue} subtarefa(s) já venceram — a folga de ${f.slackDays} dia(s) é apertada.`
        : `Chega no prazo, mas com apenas ${f.slackDays} dia(s) de folga.`;
    case "no_prazo":
      return `No ritmo atual sobra ${f.slackDays} dia(s) de folga.`;
  }
}

export interface ProjectForecast {
  total: number;
  done: number;
  remaining: number;
  progressPct: number;
  /** Subtarefas vencidas e ainda não concluídas. */
  overdue: number;
  /** Ritmo real: subtarefas concluídas por dia na janela recente. */
  velocityPerDay: number;
  /** Ritmo necessário para bater o prazo. null quando não há prazo. */
  requiredPerDay: number | null;
  projectedEnd: Date | null;
  dueDate: Date | null;
  /** Dias de folga entre a previsão e o prazo. Negativo = estouro. */
  slackDays: number | null;
  risk: RiskLevel;
}

/** Janela usada para medir ritmo. Curta demais oscila, longa demais mascara. */
const VELOCITY_WINDOW_DAYS = 21;

function completionDates(tasks: Task[], completions: CompletionEntry[]): Date[] {
  const ids = new Set(tasks.map((t) => t.id));
  const fromLog = completions
    .filter((c) => ids.has(c.taskId))
    .map((c) => new Date(c.at));
  if (fromLog.length > 0) return fromLog.sort((a, b) => a.getTime() - b.getTime());

  // Sem registro no log (ex.: tarefas vindas de seed), cai para a atividade da tarefa.
  return tasks
    .filter((t) => t.status === "concluida")
    .map((t) => {
      const entry = [...t.activity].reverse().find((a) => a.kind === "concluida");
      return new Date(entry?.at ?? t.dueDate);
    })
    .sort((a, b) => a.getTime() - b.getTime());
}

export function forecastProject(
  project: Project,
  tasks: Task[],
  completions: CompletionEntry[],
  now = new Date(),
): ProjectForecast {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "concluida").length;
  const remaining = total - done;
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const overdue = tasks.filter(
    (t) => t.status !== "concluida" && new Date(t.dueDate).getTime() < now.getTime(),
  ).length;

  const dueDate = project.dueDate ? new Date(project.dueDate) : null;

  // Ritmo: conclusões dentro da janela, divididas pelos dias efetivamente decorridos.
  const dates = completionDates(tasks, completions);
  const windowStart = addDays(startOfDay(now), -VELOCITY_WINDOW_DAYS);
  const inWindow = dates.filter((d) => d.getTime() >= windowStart.getTime());
  const projectStart = startOfDay(new Date(project.createdAt));
  const elapsed = Math.max(
    1,
    Math.min(VELOCITY_WINDOW_DAYS, differenceInCalendarDays(now, projectStart) + 1),
  );
  const velocityPerDay = inWindow.length / elapsed;

  const daysUntilDue = dueDate ? differenceInCalendarDays(dueDate, startOfDay(now)) : null;
  const requiredPerDay =
    remaining > 0 && daysUntilDue !== null && daysUntilDue > 0
      ? remaining / daysUntilDue
      : remaining > 0 && daysUntilDue !== null
        ? Infinity // prazo já chegou/passou com trabalho pendente
        : null;

  let projectedEnd: Date | null = null;
  if (remaining === 0) {
    projectedEnd = dates.length > 0 ? dates[dates.length - 1]! : startOfDay(now);
  } else if (velocityPerDay > 0) {
    projectedEnd = addDays(startOfDay(now), Math.ceil(remaining / velocityPerDay));
  }

  const slackDays =
    dueDate && projectedEnd ? differenceInCalendarDays(dueDate, projectedEnd) : null;

  let risk: RiskLevel;
  if (total === 0) {
    risk = "parado";
  } else if (remaining === 0) {
    risk = "concluido";
  } else if (!dueDate) {
    risk = "sem_prazo";
  } else if (velocityPerDay <= 0) {
    risk = "parado";
  } else if (slackDays === null) {
    risk = "sem_prazo";
  } else if (slackDays < 0) {
    risk = "atrasado";
  } else if (slackDays <= 3 || overdue > 0) {
    risk = "atencao";
  } else {
    risk = "no_prazo";
  }

  return {
    total,
    done,
    remaining,
    progressPct,
    overdue,
    velocityPerDay,
    requiredPerDay,
    projectedEnd,
    dueDate,
    slackDays,
    risk,
  };
}

/* -------------------- Série temporal (dia / semana / mês) -------------------- */

function bucketStart(d: Date, g: Granularity): Date {
  if (g === "dia") return startOfDay(d);
  if (g === "semana") return startOfWeek(d, { weekStartsOn: 1 });
  return startOfMonth(d);
}

function bucketNext(d: Date, g: Granularity): Date {
  if (g === "dia") return addDays(d, 1);
  if (g === "semana") return addWeeks(d, 1);
  return addMonths(d, 1);
}

function bucketLabel(d: Date, g: Granularity): string {
  if (g === "dia") return format(d, "dd/MM", { locale: ptBR });
  if (g === "semana") return format(d, "'sem' dd/MM", { locale: ptBR });
  return format(d, "MMM/yy", { locale: ptBR });
}

export interface BurnupPoint {
  label: string;
  /** ms — usado para ordenar e localizar o prazo no eixo. */
  t: number;
  /** Concluídas acumuladas (real). Só até hoje. */
  concluidas: number | null;
  /** Ritmo ideal linear entre o início e o prazo. */
  ideal: number | null;
  /** Projeção a partir de hoje, no ritmo atual. */
  projecao: number | null;
  isPrazo: boolean;
}

/**
 * Monta a curva de avanço: o que já foi entregue, o que era esperado
 * e até onde o ritmo atual leva o projeto.
 */
export function buildBurnup(
  project: Project,
  tasks: Task[],
  completions: CompletionEntry[],
  granularity: Granularity,
  now = new Date(),
): BurnupPoint[] {
  const total = tasks.length;
  if (total === 0) return [];

  const dates = completionDates(tasks, completions);
  const forecast = forecastProject(project, tasks, completions, now);

  const start = bucketStart(new Date(project.createdAt), granularity);
  const horizonCandidates = [now, forecast.dueDate, forecast.projectedEnd].filter(
    (d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()),
  );
  const horizon = bucketStart(
    new Date(Math.max(...horizonCandidates.map((d) => d.getTime()))),
    granularity,
  );

  const dueBucket = forecast.dueDate ? bucketStart(forecast.dueDate, granularity).getTime() : null;
  const nowBucket = bucketStart(now, granularity).getTime();

  // Ideal: distribui o total linearmente entre o início e o prazo.
  const idealSpan =
    forecast.dueDate != null
      ? Math.max(1, differenceInCalendarDays(forecast.dueDate, new Date(project.createdAt)))
      : null;

  const points: BurnupPoint[] = [];
  let cursor = start;
  let guard = 0;

  while (cursor.getTime() <= horizon.getTime() && guard < 400) {
    guard += 1;
    const next = bucketNext(cursor, granularity);
    const t = cursor.getTime();

    const concluidasAte = dates.filter((d) => d.getTime() < next.getTime()).length;
    const isFuture = t > nowBucket;

    let ideal: number | null = null;
    if (idealSpan != null) {
      const elapsedDays = differenceInCalendarDays(cursor, new Date(project.createdAt));
      ideal = Math.min(total, Math.max(0, (elapsedDays / idealSpan) * total));
      ideal = Math.round(ideal * 10) / 10;
    }

    let projecao: number | null = null;
    if (!isFuture && t === nowBucket) {
      // Ancora a projeção no ponto de hoje para as duas linhas se encontrarem.
      projecao = concluidasAte;
    } else if (isFuture && forecast.velocityPerDay > 0) {
      const daysAhead = differenceInCalendarDays(cursor, startOfDay(now));
      projecao = Math.min(total, forecast.done + forecast.velocityPerDay * daysAhead);
      projecao = Math.round(projecao * 10) / 10;
    }

    points.push({
      label: bucketLabel(cursor, granularity),
      t,
      concluidas: isFuture ? null : concluidasAte,
      ideal,
      projecao,
      isPrazo: dueBucket != null && t === dueBucket,
    });

    cursor = next;
  }

  return points;
}
