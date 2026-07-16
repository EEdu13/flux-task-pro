// Per-user persistent time log for the task timer / pomodoro.
// Sessions are stored across days so relatorios can aggregate them.

export interface TimerSession {
  id: string;
  taskId: string;
  startedAt: number; // epoch ms
  endedAt: number; // epoch ms
  seconds: number;
}

interface Persisted {
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