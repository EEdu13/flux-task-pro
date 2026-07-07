import type { CompletionEntry, Task } from "./fluxo-types";

export function scoreTaskPoints(task: Task, completionAt: string | null): number {
  const due = new Date(task.dueDate).getTime();
  const now = Date.now();
  if (task.status === "concluida") {
    const done = completionAt ? new Date(completionAt).getTime() : now;
    return done <= due ? 1 : 0.5;
  }
  return 0;
}

export function monthRange(ref = new Date()): { start: number; end: number } {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1).getTime();
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1).getTime();
  return { start, end };
}

export function userScorePct(
  userId: string,
  tasks: Task[],
  completions: CompletionEntry[],
  ref = new Date(),
): { pct: number; points: number; assigned: number; done: number } {
  const { start, end } = monthRange(ref);
  const assigned = tasks.filter((t) => {
    if (t.assigneeId !== userId) return false;
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