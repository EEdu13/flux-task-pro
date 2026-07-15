// Focus/Pomodoro daily log — stored per user in localStorage
export interface FocusEntry {
  taskId: string;
  minutes: number;
  endedAt: number; // epoch ms
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function key(userId: string) {
  return `fluxo.focus.v1:${userId}:${todayKey()}`;
}

export function loadFocusToday(userId: string): FocusEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as FocusEntry[]) : [];
  } catch {
    return [];
  }
}

export function addFocusEntry(userId: string, entry: FocusEntry) {
  if (typeof window === "undefined") return;
  const list = loadFocusToday(userId);
  list.push(entry);
  localStorage.setItem(key(userId), JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("fluxo:focus-updated"));
}

export function focusSummaryToday(userId: string): { pomos: number; minutes: number } {
  const list = loadFocusToday(userId);
  const minutes = list.reduce((s, e) => s + e.minutes, 0);
  return { pomos: list.length, minutes };
}