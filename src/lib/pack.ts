// Pack (daily commitment) helpers — permanent per-user commitments whose
// completion resets every day via localStorage keyed per user+date.
export function packTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function packStorageKey(userId: string) {
  return `fluxo.pack.done.v1:${userId}:${packTodayKey()}`;
}
export function loadPackDone(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(packStorageKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
export function savePackDone(userId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(packStorageKey(userId), JSON.stringify(Array.from(ids)));
}