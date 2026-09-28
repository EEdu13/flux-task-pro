import type { CompletionEntry, Task } from "./fluxo-types";

export function scoreTaskPoints(task: Task, completionAt: string | null): number {
  if (task.status !== "concluida") return 0;
  // Sem prazo não há atraso: concluída vale inteira.
  if (!task.dueDate) return 1;
  const due = new Date(task.dueDate).getTime();
  const done = completionAt ? new Date(completionAt).getTime() : Date.now();
  return done <= due ? 1 : 0.5;
}

export function monthRange(ref = new Date()): { start: number; end: number } {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime();
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).getTime();
  return { start, end };
}

/** A janela do placar. A semana é de segunda a domingo, como no resto do app. */
export type PeriodoDoPlacar = "dia" | "semana" | "mes";

export function janelaDoPlacar(
  periodo: PeriodoDoPlacar,
  ref = new Date(),
): { start: number; end: number } {
  if (periodo === "mes") return monthRange(ref);
  const inicio = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (periodo === "semana") inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + (periodo === "semana" ? 7 : 1));
  return { start: inicio.getTime(), end: fim.getTime() };
}

/**
 * O placar de uma pessoa num período. Muda só a janela; a conta é a mesma em
 * qualquer um: conta a tarefa cujo prazo cai no período, e cada uma vale 1 se
 * concluída no prazo, ½ se atrasada e 0 se ainda aberta.
 */
export function userScorePct(
  userId: string,
  tasks: Task[],
  completions: CompletionEntry[],
  ref = new Date(),
  periodo: PeriodoDoPlacar = "mes",
): { pct: number; points: number; assigned: number; done: number } {
  const { start, end } = janelaDoPlacar(periodo, ref);
  const assigned = tasks.filter((t) => {
    // O período é o do prazo; tarefa sem prazo não pertence a período nenhum.
    if (t.assigneeId !== userId || !t.dueDate) return false;
    const d = new Date(t.dueDate).getTime();
    return d >= start && d < end;
  });
  const points = assigned.reduce((s, t) => {
    const c = completions.find((x) => x.taskId === t.id);
    return s + scoreTaskPoints(t, c?.at ?? null);
  }, 0);
  const done = assigned.filter((t) => t.status === "concluida").length;
  const pct = assigned.length ? (points / assigned.length) * 100 : 0;
  return { pct, points, assigned: assigned.length, done };
}

/**
 * Score coloring rule: 100% -> green, any other value with assigned tasks -> red,
 * no assigned tasks -> muted.
 */
export function scoreTone(pct: number, assigned: number): "perfect" | "bad" | "none" {
  if (assigned === 0) return "none";
  return pct >= 100 ? "perfect" : "bad";
}

export function scoreTextClass(pct: number, assigned: number): string {
  const t = scoreTone(pct, assigned);
  if (t === "perfect") return "text-success";
  if (t === "bad") return "text-destructive";
  return "text-muted-foreground";
}

export function scoreBgClass(pct: number, assigned: number): string {
  const t = scoreTone(pct, assigned);
  if (t === "perfect") return "bg-success/15 text-success";
  if (t === "bad") return "bg-destructive/15 text-destructive";
  return "bg-secondary text-muted-foreground";
}

export function scoreBarColor(pct: number, assigned: number): string {
  const t = scoreTone(pct, assigned);
  if (t === "perfect") return "var(--color-success)";
  if (t === "bad") return "var(--color-destructive)";
  return "var(--color-muted-foreground)";
}