import { useEffect, useState } from "react";

export type ColumnType = "text" | "number" | "select" | "date" | "time" | "datetime";

export interface MyViewColumn {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[]; // for select
  width?: number;
}

export interface MyViewMeta {
  color?: string;
  note?: string;
}

const KEYS = {
  columns: (uid: string) => `fluxo.myview.columns.v1.${uid}`,
  cells: (uid: string) => `fluxo.myview.cells.v1.${uid}`,
  meta: (uid: string) => `fluxo.myview.meta.v1.${uid}`,
  order: (uid: string) => `fluxo.myview.order.v1.${uid}`,
};

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const DEFAULT_COLUMNS: MyViewColumn[] = [
  { id: "priv-note", name: "Anotação", type: "text" },
  { id: "priv-tag", name: "Etiqueta", type: "select", options: ["🔥 Urgente", "🚀 Rápida", "🧠 Foco", "⏳ Aguarda"] },
];

export const COLOR_PALETTE = [
  { id: "none", label: "Nenhuma", value: "" },
  { id: "red", label: "Vermelho", value: "oklch(0.58 0.22 25)" },
  { id: "amber", label: "Âmbar", value: "oklch(0.78 0.15 75)" },
  { id: "green", label: "Verde", value: "oklch(0.62 0.16 155)" },
  { id: "blue", label: "Azul", value: "oklch(0.62 0.16 230)" },
  { id: "purple", label: "Roxo", value: "oklch(0.52 0.22 275)" },
  { id: "pink", label: "Rosa", value: "oklch(0.6 0.2 330)" },
];

export function useMyView(userId: string) {
  const [columns, setColumns] = useState<MyViewColumn[]>(() =>
    safeRead(KEYS.columns(userId), DEFAULT_COLUMNS),
  );
  const [cells, setCells] = useState<Record<string, Record<string, string>>>(() =>
    safeRead(KEYS.cells(userId), {}),
  );
  const [meta, setMeta] = useState<Record<string, MyViewMeta>>(() =>
    safeRead(KEYS.meta(userId), {}),
  );
  const [order, setOrder] = useState<string[]>(() => safeRead(KEYS.order(userId), []));

  useEffect(() => {
    setColumns(safeRead(KEYS.columns(userId), DEFAULT_COLUMNS));
    setCells(safeRead(KEYS.cells(userId), {}));
    setMeta(safeRead(KEYS.meta(userId), {}));
    setOrder(safeRead(KEYS.order(userId), []));
  }, [userId]);

  useEffect(() => safeWrite(KEYS.columns(userId), columns), [userId, columns]);
  useEffect(() => safeWrite(KEYS.cells(userId), cells), [userId, cells]);
  useEffect(() => safeWrite(KEYS.meta(userId), meta), [userId, meta]);
  useEffect(() => safeWrite(KEYS.order(userId), order), [userId, order]);

  const addColumn = (col: Omit<MyViewColumn, "id">) =>
    setColumns((cs) => [
      ...cs,
      { ...col, id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}` },
    ]);
  const updateColumn = (id: string, patch: Partial<MyViewColumn>) =>
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeColumn = (id: string) => {
    setColumns((cs) => cs.filter((c) => c.id !== id));
    setCells((cur) => {
      const copy: Record<string, Record<string, string>> = {};
      for (const [tid, cols] of Object.entries(cur)) {
        const { [id]: _drop, ...rest } = cols;
        void _drop;
        copy[tid] = rest;
      }
      return copy;
    });
  };

  const setCell = (taskId: string, colId: string, value: string) =>
    setCells((cur) => ({ ...cur, [taskId]: { ...(cur[taskId] ?? {}), [colId]: value } }));

  const setMetaFor = (taskId: string, patch: Partial<MyViewMeta>) =>
    setMeta((cur) => ({ ...cur, [taskId]: { ...(cur[taskId] ?? {}), ...patch } }));

  /** Sort provided task ids by the user's saved order, appending unknown ids at the end. */
  const sortByOrder = <T extends { id: string }>(items: T[]): T[] => {
    const rank = new Map<string, number>();
    order.forEach((id, i) => rank.set(id, i));
    return [...items].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  };

  /** Move `draggedId` to the slot currently held by `targetId` (inserts before it). */
  const reorderRow = (visibleIds: string[], draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    // Compose a full order: current saved order + any missing visible ids in current visible order
    const base = [...order];
    for (const id of visibleIds) if (!base.includes(id)) base.push(id);
    const from = base.indexOf(draggedId);
    if (from === -1) return;
    base.splice(from, 1);
    const to = base.indexOf(targetId);
    if (to === -1) {
      base.push(draggedId);
    } else {
      base.splice(to, 0, draggedId);
    }
    setOrder(base);
  };

  return {
    columns,
    cells,
    meta,
    order,
    addColumn,
    updateColumn,
    removeColumn,
    setCell,
    setMetaFor,
    sortByOrder,
    reorderRow,
  };
}