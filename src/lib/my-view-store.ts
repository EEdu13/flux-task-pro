import { useEffect, useRef, useState } from "react";

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

/**
 * As colunas de largada — recriadas a cada chamada, com id novo em cada uma.
 *
 * Não é constante porque não pode ser: o id precisa ser um GUID de verdade
 * para a coluna sincronizar com o banco assim que a pessoa mexer nela, e um
 * GUID fixo, compartilhado por todo mundo que ainda não personalizou nada,
 * colidiria na primeira vez que DUAS pessoas o editassem — a segunda bateria
 * de frente com a chave primária que a primeira já usa.
 */
function colunasDeLargada(): MyViewColumn[] {
  return [
    { id: crypto.randomUUID(), name: "Anotação", type: "text" },
    {
      id: crypto.randomUUID(),
      name: "Etiqueta",
      type: "select",
      options: ["Urgente", "Rápida", "Foco", "Aguarda"],
    },
  ];
}

export const COLOR_PALETTE = [
  { id: "none", label: "Nenhuma", value: "" },
  { id: "red", label: "Vermelho", value: "oklch(0.58 0.22 25)" },
  { id: "amber", label: "Âmbar", value: "oklch(0.78 0.15 75)" },
  { id: "green", label: "Verde", value: "oklch(0.62 0.16 155)" },
  { id: "blue", label: "Azul", value: "oklch(0.62 0.16 230)" },
  { id: "purple", label: "Roxo", value: "oklch(0.52 0.22 275)" },
  { id: "pink", label: "Rosa", value: "oklch(0.6 0.2 330)" },
];

/** O id da pessoa é o número da IAM em texto — não o placeholder de ninguém logado. */
const sessaoReal = (userId: string) => userId !== "" && Number.isInteger(Number(userId));

export function useMyView(userId: string) {
  const [columns, setColumns] = useState<MyViewColumn[]>(() =>
    safeRead(KEYS.columns(userId), colunasDeLargada()),
  );
  const [cells, setCells] = useState<Record<string, Record<string, string>>>(() =>
    safeRead(KEYS.cells(userId), {}),
  );
  const [meta, setMeta] = useState<Record<string, MyViewMeta>>(() =>
    safeRead(KEYS.meta(userId), {}),
  );
  const [order, setOrder] = useState<string[]>(() => safeRead(KEYS.order(userId), []));

  useEffect(() => {
    setColumns(safeRead(KEYS.columns(userId), colunasDeLargada()));
    setCells(safeRead(KEYS.cells(userId), {}));
    setMeta(safeRead(KEYS.meta(userId), {}));
    setOrder(safeRead(KEYS.order(userId), []));
  }, [userId]);

  useEffect(() => safeWrite(KEYS.columns(userId), columns), [userId, columns]);
  useEffect(() => safeWrite(KEYS.cells(userId), cells), [userId, cells]);
  useEffect(() => safeWrite(KEYS.meta(userId), meta), [userId, meta]);
  useEffect(() => safeWrite(KEYS.order(userId), order), [userId, order]);

  /* === Sincronização com o banco ===
     `width` (arraste de coluna) e `options` (lista da coluna "Lista") ficam
     de fora de propósito — a tabela não tem essas colunas, e não precisa:
     são preferência de tela, não dado que a pessoa lamentaria perder ao trocar
     de computador. O que atravessa é o nome, o tipo e o valor de cada célula.

     O banco corrige o local ao entrar — igual a tarefas e conclusões — mas só
     quando há sessão de verdade, e só a primeira vez por pessoa: sem essa
     trava, toda alteração local reabriria a leitura do banco e uma edição
     rápida poderia perder para uma resposta atrasada da busca inicial. */
  const carregouDoServidorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessaoReal(userId) || carregouDoServidorRef.current === userId) return;
    carregouDoServidorRef.current = userId;
    void (async () => {
      try {
        const { minhaGrade } = await import("./grade-pessoal.functions");
        const { colunas, celulas } = await minhaGrade();
        if (colunas.length === 0 && celulas.length === 0) return; // nada no banco ainda; o local vale
        setColumns((cs) =>
          colunas
            .slice()
            .sort((a, b) => a.ordem - b.ordem)
            .map((c) => {
              // Largura e opções são só do navegador — preserva o que já
              // existir localmente para a mesma coluna.
              const local = cs.find((x) => x.id === c.id);
              return { id: c.id, name: c.nome, type: c.tipo, width: local?.width, options: local?.options };
            }),
        );
        setCells((cur) => {
          const copy: Record<string, Record<string, string>> = { ...cur };
          for (const c of celulas) {
            copy[c.tarefaId] = { ...(copy[c.tarefaId] ?? {}), [c.colunaId]: c.valor };
          }
          return copy;
        });
      } catch (e) {
        console.warn("[fluxo] grade pessoal não carregou do banco:", (e as Error)?.message);
      }
    })();
  }, [userId]);

  /* Um segundo de pausa antes de gravar — mesma regra do bloco de notas: o
     nome da coluna muda a cada tecla, e uma requisição por letra digitada
     seria absurdo. */
  useEffect(() => {
    if (!sessaoReal(userId)) return;
    const t = setTimeout(() => {
      void import("./grade-pessoal.functions")
        .then((api) =>
          api.salvarColunasDaGrade({
            data: {
              colunas: columns.map((c, i) => ({ id: c.id, nome: c.name, tipo: c.type, ordem: i })),
            },
          }),
        )
        .catch((e) => console.warn("[fluxo] colunas da grade não gravaram:", (e as Error)?.message));
    }, 1000);
    return () => clearTimeout(t);
  }, [userId, columns]);

  useEffect(() => {
    if (!sessaoReal(userId)) return;
    const t = setTimeout(() => {
      const celulas = Object.entries(cells).flatMap(([tarefaId, porColuna]) =>
        Object.entries(porColuna).map(([colunaId, valor]) => ({ tarefaId, colunaId, valor })),
      );
      if (celulas.length === 0) return;
      void import("./grade-pessoal.functions")
        .then((api) => api.salvarCelulasDaGrade({ data: { celulas } }))
        .catch((e) => console.warn("[fluxo] células da grade não gravaram:", (e as Error)?.message));
    }, 1000);
    return () => clearTimeout(t);
  }, [userId, cells]);

  const addColumn = (col: Omit<MyViewColumn, "id">) =>
    setColumns((cs) => [...cs, { ...col, id: crypto.randomUUID() }]);
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
    // Apaga de fato — não é o "regrava tudo" debounced acima, que só cria e
    // atualiza. As células saem por cascata, no mesmo comando.
    if (sessaoReal(userId)) {
      void import("./grade-pessoal.functions")
        .then((api) => api.apagarColunaDaGrade({ data: { id } }))
        .catch((e) => console.warn("[fluxo] coluna não apagou do banco:", (e as Error)?.message));
    }
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