import { memo, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Palette,
  StickyNote,
  Settings2,
  Save,
  X,
  Check,
  GripVertical,
  Pencil,
  CheckCircle2,
  RotateCcw,
  Copy,
  Star,
  Eraser,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { podeMexerNoConteudo } from "@/lib/permissoes";
import { statusColor, statusLabels, type Task } from "@/lib/fluxo-types";
import {
  COLOR_PALETTE,
  useMyView,
  type ColumnType,
  type MyViewColumn,
  type MyViewMeta,
} from "@/lib/my-view-store";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { SeloDoProjeto } from "@/components/selo-do-projeto";
import { rotuloDoPrazo } from "@/lib/prazo";
import { DndContext, type UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import {
  acessibilidadeDoArraste,
  LinhaArrastavel,
  LinhaNaMao,
  semDeslocar,
  useAcoesEstaveis,
  useArrasteDeLinhas,
} from "@/components/arraste";

function fmtDue(t: Pick<Task, "dueDate" | "dueTime">) {
  return rotuloDoPrazo(t, { day: "2-digit", month: "short" });
}

const COLUMN_TYPE_LABEL: Record<ColumnType, string> = {
  text: "Texto",
  number: "Número",
  select: "Lista",
  date: "Data",
  time: "Hora",
  datetime: "Data + hora",
};

const DEFAULT_COL_WIDTH = 160;

export function MyView({
  tasks,
  onEdit,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
}) {
  const { currentUser, users, updateTask, deleteTask, createTask } = useFluxo();
  const view = useMyView(currentUser.id);
  const [managing, setManaging] = useState(false);
  const [newCol, setNewCol] = useState<{ name: string; type: ColumnType; options: string }>({
    name: "",
    type: "text",
    options: "",
  });
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const ordered = useMemo(() => view.sortByOrder(tasks), [tasks, view]);
  const visibleIds = useMemo(() => ordered.map((t) => t.id), [ordered]);

  /* `reorderRow` põe a linha ANTES da outra. Descendo, a linha arrastada toma
     o lugar da de baixo e fica depois dela — então a âncora é quem vem logo
     depois na ordem nova ("" quando fica em último: vai para o fim). */
  const arraste = useArrasteDeLinhas((id, sobre) => {
    const nova = arrayMove(visibleIds, visibleIds.indexOf(id), visibleIds.indexOf(sobre));
    view.reorderRow(visibleIds, id, nova[nova.indexOf(id) + 1] ?? "");
  });
  const nomeDe = (id: UniqueIdentifier) =>
    `"${ordered.find((t) => t.id === String(id))?.title ?? "a tarefa"}"`;

  // Column resize (pointer drag on right edge of each th)
  const [resizing, setResizing] = useState<{ id: string; startX: number; startW: number } | null>(null);
  useEffect(() => {
    if (!resizing) return;
    const move = (e: PointerEvent) => {
      const delta = e.clientX - resizing.startX;
      const next = Math.max(80, Math.min(600, resizing.startW + delta));
      view.updateColumn(resizing.id, { width: next });
    };
    const up = () => setResizing(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [resizing, view]);

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRowMenu(null);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [rowMenu]);

  const submitNewCol = () => {
    const name = newCol.name.trim();
    if (!name) return;
    view.addColumn({
      name,
      type: newCol.type,
      options:
        newCol.type === "select"
          ? newCol.options
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    });
    setNewCol({ name: "", type: "text", options: "" });
  };

  const openRowMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ id, x: e.clientX, y: e.clientY });
  };

  // Funções que não mudam de um desenho para o outro — ver `LinhaDaVisao`.
  const acoesDaLinha = useAcoesEstaveis<AcoesDaLinha>({
    abrir: onEdit,
    menu: openRowMenu,
    alternarCor: (id) => setColorOpen((v) => (v === id ? null : id)),
    fecharCor: () => setColorOpen(null),
    alternarNota: (id) => setNoteOpen((v) => (v === id ? null : id)),
    fecharNota: () => setNoteOpen(null),
    setMeta: view.setMetaFor,
    setCelula: view.setCell,
  });

  const clearRow = (id: string) => {
    view.setMetaFor(id, { color: undefined, note: undefined });
    for (const c of view.columns) view.setCell(id, c.id, "");
    toast.success("Linha limpa");
  };

  const duplicateTask = (t: Task) => {
    createTask({
      title: `${t.title} (cópia)`,
      description: t.description,
      sector: t.sector,
      createdBy: currentUser.id,
      assigneeId: t.assigneeId,
      mentions: t.mentions,
      frequency: t.frequency,
      status: "pendente",
      score: t.score,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      recurring: t.recurring,
      priority: t.priority,
      tags: t.tags,
    });
    toast.success("Tarefa duplicada");
  };

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Minha visão</div>
          <div className="text-[11px] text-muted-foreground">
            Arraste as linhas pela alça <GripVertical className="inline h-3 w-3" /> · dê{" "}
            <strong>duplo clique</strong> em uma linha para ações rápidas · arraste a borda direita das colunas para redimensionar.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              // Persistência já é automática (useEffect no store); só confirma pro usuário.
              toast.success("Visão salva — colunas, cores e notas ficam entre sessões");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
          >
            <Save className="h-3.5 w-3.5" /> Salvar visão
          </button>
          <button
            type="button"
            onClick={() => setManaging((m) => !m)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-secondary"
          >
            <Settings2 className="h-3.5 w-3.5" /> {managing ? "Fechar colunas" : "Gerenciar colunas"}
          </button>
        </div>
      </div>

      {managing && (
        <div className="border-b border-border bg-background px-4 py-3">
          {/* Nova coluna — uma linha só: nome → tipo → (opções) → adicionar */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Nova coluna:</span>
            <input
              value={newCol.name}
              onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCol.name.trim()) submitNewCol();
              }}
              placeholder="Nome (ex.: Cliente)"
              className="w-40 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            />
            <select
              value={newCol.type}
              onChange={(e) => setNewCol((c) => ({ ...c, type: e.target.value as ColumnType }))}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              title="Tipo da coluna"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="select">Lista</option>
              <option value="date">Data</option>
              <option value="time">Hora</option>
              <option value="datetime">Data + hora</option>
            </select>
            {newCol.type === "select" && (
              <input
                value={newCol.options}
                onChange={(e) => setNewCol((c) => ({ ...c, options: e.target.value }))}
                placeholder="Opções separadas por vírgula"
                className="flex-1 min-w-[180px] rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              />
            )}
            <button
              onClick={submitNewCol}
              disabled={!newCol.name.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </button>
          </div>

          {view.columns.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Colunas existentes
              </div>
              <div className="flex flex-col gap-1">
                {view.columns.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1 text-xs"
                  >
                    <input
                      value={c.name}
                      onChange={(e) => view.updateColumn(c.id, { name: e.target.value })}
                      className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-border focus:bg-background"
                    />
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {COLUMN_TYPE_LABEL[c.type]}
                    </span>
                    {c.type === "select" && (
                      <input
                        value={(c.options ?? []).join(", ")}
                        onChange={(e) =>
                          view.updateColumn(c.id, {
                            options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        placeholder="Opções (vírgula)"
                        className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-border focus:bg-background"
                      />
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {c.width ?? DEFAULT_COL_WIDTH}px
                    </span>
                    <button
                      onClick={() => view.removeColumn(c.id)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      title="Remover coluna"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DndContext {...arraste} accessibility={acessibilidadeDoArraste(nomeDe)}>
        <LinhaNaMao
          linha={(id) => {
            const t = ordered.find((x) => x.id === id);
            return (
              t && {
                titulo: t.title,
                detalhe: (
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDue(t)}</span>
                ),
              }
            );
          }}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="w-10 py-2 pl-3"></th>
                <th className="w-6 py-2"></th>
                <th className="py-2 pr-3">Título</th>
                <th className="w-28 py-2 pr-3">Status</th>
                <th className="w-24 py-2 pr-3">Prazo</th>
                <th className="w-40 py-2 pr-3">Responsável</th>
                {view.columns.map((c) => (
                  <th
                    key={c.id}
                    style={{ width: c.width ?? DEFAULT_COL_WIDTH }}
                    className="relative py-2 pr-3 select-none"
                  >
                    {c.name}
                    <span
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setResizing({ id: c.id, startX: e.clientX, startW: c.width ?? DEFAULT_COL_WIDTH });
                      }}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                      title="Arraste para redimensionar"
                    />
                  </th>
                ))}
                <th className="w-24 py-2 pr-3 text-right">Nota</th>
              </tr>
            </thead>
            <SortableContext items={visibleIds} strategy={semDeslocar}>
              <tbody>
                {ordered.map((t) => (
                  <LinhaDaVisao
                    key={t.id}
                    task={t}
                    meta={view.meta[t.id]}
                    celulas={view.cells[t.id]}
                    colunas={view.columns}
                    responsavel={users.find((u) => u.id === t.assigneeId)?.name}
                    corAberta={colorOpen === t.id}
                    notaAberta={noteOpen === t.id}
                    acoes={acoesDaLinha}
                  />
                ))}
                {ordered.length === 0 && (
                  <tr>
                    <td colSpan={6 + view.columns.length + 1} className="py-8 text-center text-xs text-muted-foreground">
                      Nenhuma tarefa no filtro atual.
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </table>
        </div>
      </DndContext>

      {rowMenu && (() => {
        const t = ordered.find((x) => x.id === rowMenu.id);
        if (!t) return null;
        const isDone = t.status === "concluida";
        // Quem criou, o supervisor ou a gerência — ver `permissoes.ts`.
        const canDelete = podeMexerNoConteudo(t, currentUser, users);
        const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const width = 240;
        const height = 340;
        const left = Math.min(rowMenu.x, vw - width - 8);
        const top = Math.min(rowMenu.y, vh - height - 8);
        const itemBtn = (
          icon: React.ReactNode,
          label: string,
          onClick: () => void,
          danger?: boolean,
        ) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick();
              setRowMenu(null);
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
              danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-secondary"
            }`}
          >
            {icon}
            <span className="flex-1">{label}</span>
          </button>
        );
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            style={{ left, top, width }}
            className="fixed z-[300] animate-in fade-in-0 zoom-in-95 rounded-lg border border-border bg-card p-2 shadow-2xl"
          >
            <div className="border-b border-border px-1 pb-1.5">
              <div className="truncate text-[11px] font-semibold">{t.title}</div>
              <div className="text-[10px] text-muted-foreground">Ações rápidas da linha</div>
            </div>
            <div className="mt-1.5">
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-muted-foreground">Cor</div>
              <div className="flex flex-wrap gap-1 px-1 pb-1.5">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      view.setMetaFor(t.id, { color: c.value || undefined });
                    }}
                    title={c.label}
                    className="h-5 w-5 rounded-full border border-border"
                    style={{ background: c.value || "transparent" }}
                  >
                    {!c.value && <X className="h-3 w-3" />}
                  </button>
                ))}
              </div>
              <div className="my-1 h-px bg-border" />
              {itemBtn(<Pencil className="h-3.5 w-3.5" />, "Editar tarefa", () => onEdit(t.id))}
              {isDone
                ? itemBtn(<RotateCcw className="h-3.5 w-3.5" />, "Reabrir", () =>
                    updateTask(t.id, { status: "pendente" }),
                  )
                : itemBtn(<CheckCircle2 className="h-3.5 w-3.5" />, "Concluir", () =>
                    updateTask(t.id, { status: "concluida" }),
                  )}
              {itemBtn(
                <Star className="h-3.5 w-3.5" />,
                t.inPack ? "Remover do pack" : "Adicionar ao pack",
                () => updateTask(t.id, { inPack: !t.inPack }),
              )}
              {itemBtn(<StickyNote className="h-3.5 w-3.5" />, "Editar nota", () => setNoteOpen(t.id))}
              {itemBtn(<Copy className="h-3.5 w-3.5" />, "Duplicar tarefa", () => duplicateTask(t))}
              <div className="my-1 h-px bg-border" />
              {itemBtn(<Eraser className="h-3.5 w-3.5" />, "Limpar linha (cor, nota, colunas)", () => clearRow(t.id))}
              {canDelete &&
                itemBtn(
                  <Trash2 className="h-3.5 w-3.5" />,
                  "Excluir tarefa",
                  async () => {
                    const ok = await confirmar({
                      titulo: "Excluir esta tarefa?",
                      descricao: `"${t.title}" sai do quadro de todo mundo. Se mudar de ideia, use o Desfazer do aviso que aparece em seguida.`,
                      confirmar: "Excluir",
                      perigo: true,
                    });
                    if (!ok) return;
                    // O aviso "excluída", com Desfazer, sai de `deleteTask`.
                    deleteTask(t.id);
                  },
                  true,
                )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/** O que uma linha da Minha visão pode fazer. Ver `useAcoesEstaveis`. */
type AcoesDaLinha = {
  abrir: (id: string) => void;
  menu: (id: string, e: React.MouseEvent) => void;
  alternarCor: (id: string) => void;
  fecharCor: () => void;
  alternarNota: (id: string) => void;
  fecharNota: () => void;
  setMeta: (id: string, patch: Partial<MyViewMeta>) => void;
  setCelula: (id: string, colunaId: string, valor: string) => void;
};

/**
 * Uma linha da Minha visão, em `memo`.
 *
 * Escrita direto no `map` da tabela, a linha se redesenhava sempre que a
 * tabela se redesenhava — e trocar a ordem ao soltar um arraste redesenhava
 * todas, com todos os campos, o que engasgava o gesto com a lista cheia.
 * Assim, reordenar só muda a posição das linhas, e digitar numa célula
 * redesenha só a linha dela. O que chega por props é o que é da linha:
 * `meta` e `celulas` são o pedaço dela nas tabelas da visão.
 */
const LinhaDaVisao = memo(function LinhaDaVisao({
  task: t,
  meta,
  celulas,
  colunas,
  responsavel,
  corAberta,
  notaAberta,
  acoes,
}: {
  task: Task;
  meta: MyViewMeta | undefined;
  celulas: Record<string, string> | undefined;
  colunas: MyViewColumn[];
  responsavel: string | undefined;
  corAberta: boolean;
  notaAberta: boolean;
  acoes: AcoesDaLinha;
}) {
  const m = meta ?? {};
  const rowCells = celulas ?? {};
  const isDone = t.status === "concluida";
  return (
    <LinhaArrastavel
      id={t.id}
      marcarDestino
      aoAbrir={() => acoes.abrir(t.id)}
      onDoubleClick={(e) => acoes.menu(t.id, e)}
      className="group border-b border-border/60 align-top transition-colors last:border-0 hover:bg-primary/5"
      style={
        m.color
          ? {
              background: `color-mix(in oklab, ${m.color} 18%, transparent)`,
              boxShadow: `inset 4px 0 0 ${m.color}`,
            }
          : undefined
      }
    >
      <td className="py-2 pl-3 text-muted-foreground">
        <span
          className="inline-flex cursor-grab items-center rounded p-1 hover:bg-secondary active:cursor-grabbing"
          title="Arraste para reordenar"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </td>
      <td className="relative py-2 pl-3">
        <button
          onClick={() => acoes.alternarCor(t.id)}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
          title="Cor da linha"
        >
          <Palette className="h-3.5 w-3.5" style={m.color ? { color: m.color } : undefined} />
        </button>
        {corAberta && (
          <div
            className="absolute left-0 top-8 z-20 flex flex-wrap gap-1 rounded-md border border-border bg-popover p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {COLOR_PALETTE.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  acoes.setMeta(t.id, { color: c.value || undefined });
                  acoes.fecharCor();
                }}
                title={c.label}
                className="h-5 w-5 rounded-full border border-border"
                style={{ background: c.value || "transparent" }}
              >
                {!c.value && <X className="h-3 w-3" />}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="py-2 pr-3">
        <button
          onClick={() => acoes.abrir(t.id)}
          className={`text-left text-sm font-medium hover:text-primary ${
            isDone ? "text-muted-foreground line-through" : ""
          }`}
        >
          <SeloDoProjeto projectId={t.projectId} />
          {t.title}
        </button>
      </td>
      <td className="py-2 pr-3">
        <span
          className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
          style={{ background: statusColor[t.status] }}
        >
          {statusLabels[t.status]}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{fmtDue(t)}</td>
      <td className="py-2 pr-3 text-xs">{responsavel ?? "—"}</td>
      {colunas.map((c) => (
        <td key={c.id} className="py-1.5 pr-3">
          {c.type === "select" ? (
            <select
              value={rowCells[c.id] ?? ""}
              onChange={(e) => acoes.setCelula(t.id, c.id, e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            >
              <option value="">—</option>
              {(c.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : c.type === "date" || c.type === "time" || c.type === "datetime" ? (
            <input
              type={c.type === "datetime" ? "datetime-local" : c.type}
              value={rowCells[c.id] ?? ""}
              onChange={(e) => acoes.setCelula(t.id, c.id, e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            />
          ) : (
            <input
              value={rowCells[c.id] ?? ""}
              onChange={(e) => acoes.setCelula(t.id, c.id, e.target.value)}
              inputMode={c.type === "number" ? "numeric" : undefined}
              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xs outline-none hover:border-border focus:border-primary focus:bg-background"
              placeholder="—"
            />
          )}
        </td>
      ))}
      <td className="relative py-2 pr-3 text-right">
        <button
          onClick={() => acoes.alternarNota(t.id)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
            m.note
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40"
          }`}
        >
          <StickyNote className="h-3 w-3" />
          {m.note ? "Nota" : "Anotar"}
        </button>
        {notaAberta && (
          <div
            className="absolute right-3 top-9 z-20 w-72 rounded-md border border-border bg-popover p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              value={m.note ?? ""}
              onChange={(e) => acoes.setMeta(t.id, { note: e.target.value })}
              placeholder="Anotação pessoal…"
              className="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-primary"
            />
            <div className="mt-1 flex justify-end gap-1">
              <button
                onClick={() => {
                  acoes.setMeta(t.id, { note: undefined });
                  acoes.fecharNota();
                }}
                className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary"
              >
                Limpar
              </button>
              <button
                onClick={acoes.fecharNota}
                className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground hover:brightness-110"
              >
                <Check className="h-3 w-3" /> Ok
              </button>
            </div>
          </div>
        )}
      </td>
    </LinhaArrastavel>
  );
});
