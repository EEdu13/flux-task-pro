// Per-user persistent time log for the task timer / pomodoro.
// Sessions are stored across days so relatorios can aggregate them.

export interface TimerSession {
  id: string;
  taskId: string;
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  seconds: number;
}

export interface Persisted {
  sessions: TimerSession[];
  totals: Record<string, number>; // taskId -> total seconds all-time
}

const KEY = (userId: string) => `fluxo.timelog.v1:${userId}`;

function safeParse(raw: string | null): Persisted {
  if (!raw) return { sessions: [], totals: {} };
  try {
    const p = JSON.parse(raw) as Partial<Persisted>;
    return { sessions: p.sessions ?? [], totals: p.totals ?? {} };
  } catch {
    return { sessions: [], totals: {} };
  }
}

export function loadTimeLog(userId: string): Persisted {
  if (typeof window === "undefined") return { sessions: [], totals: {} };
  return safeParse(localStorage.getItem(KEY(userId)));
}

export function saveTimeLog(userId: string, data: Persisted) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY(userId), JSON.stringify(data));
  window.dispatchEvent(new CustomEvent("fluxo:timer-updated"));
}

export function appendSession(userId: string, session: TimerSession) {
  const data = loadTimeLog(userId);
  data.sessions.push(session);
  data.totals[session.taskId] = (data.totals[session.taskId] ?? 0) + session.seconds;
  saveTimeLog(userId, data);
}

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatHM(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function parseHM(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  // formats: "hh:mm", "h:mm", "90m", "1.5h", "45"
  const colon = t.match(/^(\d{1,3}):(\d{1,2})$/);
  if (colon) {
    const h = parseInt(colon[1]!, 10);
    const m = parseInt(colon[2]!, 10);
    if (m >= 60) return null;
    return h * 60 + m;
  }
  const hOnly = t.match(/^(\d+(?:[.,]\d+)?)\s*h$/i);
  if (hOnly) return Math.round(parseFloat(hOnly[1]!.replace(",", ".")) * 60);
  const mOnly = t.match(/^(\d+)\s*m$/i);
  if (mOnly) return parseInt(mOnly[1]!, 10);
  const num = t.match(/^(\d+)$/);
  if (num) return parseInt(num[1]!, 10);
  return null;
}

// ---------------- Cross-user helpers ----------------

/**
 * O tempo de todo mundo que esta pessoa pode ver, vindo do banco.
 *
 * Substitui a `loadAllTimeLogs` que existia aqui, e que varria o
 * `localStorage` da máquina atrás de chaves de OUTRAS pessoas. Ela vinha
 * documentada como "para gerentes que precisam inspecionar o tempo de
 * subordinados quando compartilham o mesmo navegador (cenário demo/on-prem)" —
 * ou seja, funcionava exatamente na situação que a Larsil não tem. Na prática
 * um gerente abria Relatórios e via só o próprio tempo, sem nada indicando que
 * o resto simplesmente não estava ali.
 *
 * Quem decide o que cada pessoa enxerga é o servidor, com a mesma regra de
 * papel e setor das tarefas e das conclusões.
 */
export async function carregarTempoDoServidor(): Promise<Record<string, Persisted>> {
  const { listarSessoesDeTempo } = await import("./tempo.functions");
  const { sessoes } = await listarSessoesDeTempo();

  const porPessoa: Record<string, Persisted> = {};
  for (const s of sessoes) {
    const dela = (porPessoa[s.pessoaId] ??= { sessions: [], totals: {} });
    dela.sessions.push({
      id: s.id,
      taskId: s.taskId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      seconds: s.seconds,
    });
    dela.totals[s.taskId] = (dela.totals[s.taskId] ?? 0) + s.seconds;
  }
  return porPessoa;
}

export function sessionsInRange(
  sessions: TimerSession[],
  fromMs: number,
  toMs: number,
): TimerSession[] {
  return sessions.filter((s) => s.endedAt >= fromMs && s.endedAt < toMs);
}

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface CsvSessionRow {
  userName: string;
  userSector?: string;
  taskId: string;
  taskTitle: string;
  status?: string;
  priority?: string;
  estimatedMinutes?: number;
  startedAt: number;
  endedAt: number;
  seconds: number;
}

export function buildSessionsCsv(rows: CsvSessionRow[]): string {
  const header = [
    "Colaborador",
    "Setor",
    "Tarefa",
    "Status",
    "Prioridade",
    "Início",
    "Fim",
    "Início (ISO)",
    "Fim (ISO)",
    "Duração (min)",
    "Duração (hh:mm:ss)",
    "Estimado (min)",
  ].join(";");
  const body = rows.map((r) =>
    [
      csvEscape(r.userName),
      csvEscape(r.userSector ?? ""),
      csvEscape(r.taskTitle),
      csvEscape(r.status ?? ""),
      csvEscape(r.priority ?? ""),
      csvEscape(fmtDateTime(r.startedAt)),
      csvEscape(fmtDateTime(r.endedAt)),
      csvEscape(fmtIso(r.startedAt)),
      csvEscape(fmtIso(r.endedAt)),
      csvEscape((r.seconds / 60).toFixed(2).replace(".", ",")),
      csvEscape(formatHMS(r.seconds)),
      csvEscape(r.estimatedMinutes ?? ""),
    ].join(";"),
  );
  return "\uFEFF" + [header, ...body].join("\n");
}

export interface CsvSummaryRow {
  userName: string;
  userSector?: string;
  taskTitle: string;
  status?: string;
  priority?: string;
  estimatedMinutes?: number;
  totalSeconds: number;
  sessions: number;
  firstAt?: number;
  lastAt?: number;
}

export function buildSummaryCsv(rows: CsvSummaryRow[]): string {
  const header = [
    "Colaborador",
    "Setor",
    "Tarefa",
    "Status",
    "Prioridade",
    "Estimado (min)",
    "Trabalhado (min)",
    "Trabalhado (hh:mm)",
    "Sessões",
    "Primeiro início",
    "Último término",
    "Desvio (min)",
  ].join(";");
  const body = rows.map((r) => {
    const mins = r.totalSeconds / 60;
    const desvio = r.estimatedMinutes != null ? mins - r.estimatedMinutes : "";
    return [
      csvEscape(r.userName),
      csvEscape(r.userSector ?? ""),
      csvEscape(r.taskTitle),
      csvEscape(r.status ?? ""),
      csvEscape(r.priority ?? ""),
      csvEscape(r.estimatedMinutes ?? ""),
      csvEscape(mins.toFixed(2).replace(".", ",")),
      csvEscape(formatHM(r.totalSeconds)),
      csvEscape(r.sessions),
      csvEscape(r.firstAt ? fmtDateTime(r.firstAt) : ""),
      csvEscape(r.lastAt ? fmtDateTime(r.lastAt) : ""),
      csvEscape(typeof desvio === "number" ? desvio.toFixed(1).replace(".", ",") : ""),
    ].join(";");
  });
  return "\uFEFF" + [header, ...body].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}