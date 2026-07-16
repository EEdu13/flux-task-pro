import type { User } from "@/lib/fluxo-types";
import { sectors } from "@/lib/fluxo-types";

export interface ParsedPasteRow {
  title: string;
  dueDate?: string; // yyyy-mm-dd
  assigneeId?: string;
  sector?: string;
  estimateHM?: string;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function toISODate(y: number, m: number, d: number): string | undefined {
  if (!y || !m || !d) return undefined;
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function parseDateLoose(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  // yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toISODate(+m[1], +m[2], +m[3]);
  // dd/mm/yyyy or dd/mm/yy
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? +m[3] : new Date().getFullYear();
    return toISODate(y, +m[2], +m[1]);
  }
  // Excel serial (rough)
  if (/^\d{4,6}$/.test(s)) {
    const n = +s;
    if (n > 20000 && n < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    }
  }
  // fallback
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  return undefined;
}

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function matchAssignee(name: string, users: User[]): string | undefined {
  const q = normalize(name);
  if (!q) return undefined;
  // exact
  let hit = users.find((u) => normalize(u.name) === q);
  if (hit) return hit.id;
  // first-name / contains
  hit = users.find((u) => normalize(u.name).split(" ")[0] === q);
  if (hit) return hit.id;
  hit = users.find((u) => normalize(u.name).includes(q));
  return hit?.id;
}

export function matchSector(value: string): string | undefined {
  const q = normalize(value);
  if (!q) return undefined;
  const s = sectors.find(
    (x) => x.id === q || normalize(x.name) === q || normalize(x.name).startsWith(q),
  );
  return s?.id;
}

/**
 * Parse a clipboard string coming from Excel / Google Sheets / plain text.
 * Columns are TAB-separated (Excel default). Rows are line breaks.
 * Column order: title | dueDate | assignee name | sector | estimate (hh:mm)
 * All columns after title are optional. Empty lines are skipped.
 */
export function parseExcelPaste(text: string, users: User[]): ParsedPasteRow[] {
  if (!text) return [];
  const lines = text.replace(/\r/g, "").split("\n");
  const rows: ParsedPasteRow[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = raw.includes("\t") ? raw.split("\t").map((c) => c.trim()) : [line];
    const title = cells[0];
    if (!title) continue;
    rows.push({
      title,
      dueDate: cells[1] ? parseDateLoose(cells[1]) : undefined,
      assigneeId: cells[2] ? matchAssignee(cells[2], users) : undefined,
      sector: cells[3] ? matchSector(cells[3]) : undefined,
      estimateHM: cells[4] || undefined,
    });
  }
  return rows;
}