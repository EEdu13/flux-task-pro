import type { Celula } from "@/lib/planilha-xlsx";
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

/* As planilhas do tempo (Relatórios → Resumo e Sessões). Saem em .xlsx
   (pedido do usuário, 13/10/2026: "CSV ninguém usa mais") — ver
   `planilha-xlsx.ts`. Minutos vão como número, para somar no Excel; início e
   fim como data e hora de verdade. */

export interface SessionRow {
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

const minutos = (seg: number) => Math.round((seg / 60) * 100) / 100;

export function linhasDeSessoes(rows: SessionRow[]): Celula[][] {
  return [
    [
      "Colaborador",
      "Setor",
      "Tarefa",
      "Status",
      "Prioridade",
      "Início",
      "Fim",
      "Duração (min)",
      "Duração (hh:mm:ss)",
      "Estimado (min)",
    ],
    ...rows.map((r) => [
      r.userName,
      r.userSector ?? "",
      r.taskTitle,
      r.status ?? "",
      r.priority ?? "",
      new Date(r.startedAt),
      new Date(r.endedAt),
      minutos(r.seconds),
      formatHMS(r.seconds),
      r.estimatedMinutes ?? null,
    ]),
  ];
}

export interface SummaryRow {
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

export function linhasDeResumo(rows: SummaryRow[]): Celula[][] {
  return [
    [
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
    ],
    ...rows.map((r) => [
      r.userName,
      r.userSector ?? "",
      r.taskTitle,
      r.status ?? "",
      r.priority ?? "",
      r.estimatedMinutes ?? null,
      minutos(r.totalSeconds),
      formatHM(r.totalSeconds),
      r.sessions,
      r.firstAt ? new Date(r.firstAt) : null,
      r.lastAt ? new Date(r.lastAt) : null,
      r.estimatedMinutes != null
        ? Math.round((r.totalSeconds / 60 - r.estimatedMinutes) * 10) / 10
        : null,
    ]),
  ];
}
