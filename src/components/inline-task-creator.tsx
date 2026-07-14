import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import {
  priorityLabels,
  sectors,
  type Priority,
  type Status,
} from "@/lib/fluxo-types";
import type { Attachment } from "@/lib/fluxo-types";
import { filesToAttachments, formatBytes, isImage } from "@/lib/attachments";
import { toast } from "sonner";

interface DraftRow {
  id: string;
  title: string;
  dueDate: string; // yyyy-mm-dd
  assigneeId: string;
  priority: Priority;
  sector: string;
  attachments: Attachment[];
  mentions: string[];
}

const rid = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function makeDraft(defaults: Partial<DraftRow>): DraftRow {
  return {
    id: rid(),
    title: "",
    dueDate: todayStr(),
    assigneeId: defaults.assigneeId ?? "",
    priority: defaults.priority ?? "media",
    sector: defaults.sector ?? "",
    attachments: [],
    mentions: [],
  };
}

export function InlineTaskCreator({
  defaultStatus = "pendente",
  compact = false,
}: {
  defaultStatus?: Status;
  compact?: boolean;
}) {
  const { currentUser, visibleUsersForAssign, createTask } = useFluxo();
  const assignees = visibleUsersForAssign();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<DraftRow[]>(() => [
    makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector }),
  ]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [cardDrag, setCardDrag] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRowId = useRef<string | null>(null);
  const [mention, setMention] = useState<{
    rowId: string;
    query: string;
    startIndex: number;
    selectedIndex: number;
  } | null>(null);

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      inputRefs.current[id]?.focus();
    });
  };

  const parseMention = (title: string, cursor: number): { query: string; startIndex: number } | null => {
    const before = title.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at === -1) return null;
    if (before.slice(at + 1).includes(" ")) return null;
    if (at > 0 && /\w/.test(title[at - 1])) return null;
    return { query: title.slice(at + 1, cursor), startIndex: at };
  };

  const applyMention = (rowId: string, userId: string, userName: string) => {
    if (!mention) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== rowId) return r;
        const before = r.title.slice(0, mention.startIndex);
        const after = r.title.slice(mention.startIndex + mention.query.length + 1);
        const newTitle = `${before}@${userName} ${after}`;
        const mentions = r.mentions.includes(userId) ? r.mentions : [...r.mentions, userId];
        return { ...r, title: newTitle, mentions };
      }),
    );
    setMention(null);
    focusRow(rowId);
  };

  const addRow = (afterId?: string) => {
    const draft = makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector });
    setRows((rs) => {
      if (!afterId) return [...rs, draft];
      const idx = rs.findIndex((r) => r.id === afterId);
      const copy = [...rs];
      copy.splice(idx + 1, 0, draft);
      return copy;
    });
    focusRow(draft.id);
    return draft.id;
  };

  const commitRow = (row: DraftRow): boolean => {
    if (!row.title.trim()) return false;
    const due = new Date(row.dueDate || todayStr());
    due.setHours(23, 59, 0, 0);
    createTask({
      title: row.title.trim(),
      sector: row.sector || currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: row.assigneeId || currentUser.id,
      mentions: row.mentions,
      frequency: "diaria",
      status: defaultStatus,
      score: 10,
      dueDate: due.toISOString(),
      recurring: false,
      priority: row.priority,
      tags: [],
      attachments: row.attachments.length ? row.attachments : undefined,
    });
    return true;
  };

  const jumpNext = (rowId: string) => {
    const idx = rows.findIndex((r) => r.id === rowId);
    const current = rows[idx];
    if (!current || !current.title.trim()) {
      // não cria linha em branco; foca a próxima existente se houver
      const nxt = rows[idx + 1];
      if (nxt) focusRow(nxt.id);
      return;
    }
    const nxt = rows[idx + 1];
    if (nxt) {
      focusRow(nxt.id);
    } else {
      addRow(rowId);
    }
  };

  const validRows = rows.filter((r) => r.title.trim());

  const requestSubmitAll = () => {
    if (validRows.length === 0) {
      toast.error("Preencha ao menos um título");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSubmitAll = () => {
    const valid = rows.filter((r) => r.title.trim());
    valid.forEach(commitRow);
    toast.success(
      `${valid.length} tarefa${valid.length > 1 ? "s" : ""} criada${valid.length > 1 ? "s" : ""}`,
    );
    setRows([makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector })]);
    setConfirmOpen(false);
  };

  const remove = (id: string) => {
    setRows((rs) => (rs.length === 1 ? [makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector })] : rs.filter((r) => r.id !== id)));
  };

  const update = (id: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addFilesToRow = async (rowId: string, files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const { ok, rejected } = await filesToAttachments(list, currentUser.id);
    if (rejected.length) {
      toast.error(`Ignorado(s): ${rejected.join(", ")}`);
    }
    if (!ok.length) return;
    setRows((rs) =>
      rs.map((r) => (r.id === rowId ? { ...r, attachments: [...r.attachments, ...ok] } : r)),
    );
    toast.success(`${ok.length} anexo${ok.length > 1 ? "s" : ""} adicionado${ok.length > 1 ? "s" : ""}`);
  };

  const handleCardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setCardDrag(false);
    setDragRowId(null);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    // pick the last row with a title, otherwise the last row (or a new one)
    let target = [...rows].reverse().find((r) => r.title.trim());
    if (!target) target = rows[rows.length - 1];
    if (!target) {
      const draft = makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector });
      setRows((rs) => [...rs, draft]);
      target = draft;
    }
    await addFilesToRow(target.id, files);
  };

  const removeAttachment = (rowId: string, attId: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === rowId ? { ...r, attachments: r.attachments.filter((a) => a.id !== attId) } : r,
      ),
    );

  const openFilePicker = (rowId: string) => {
    pendingFileRowId.current = rowId;
    fileInputRef.current?.click();
  };

  return (
    <div
      className={`relative rounded-lg border bg-card shadow-sm transition ${
        cardDrag ? "border-primary ring-2 ring-primary/30" : "border-border"
      }`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setCardDrag(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setCardDrag(false);
          setDragRowId(null);
        }
      }}
      onDrop={handleCardDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const rowId = pendingFileRowId.current;
          pendingFileRowId.current = null;
          if (rowId && e.target.files) await addFilesToRow(rowId, e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-semibold">Criação rápida (estilo planilha)</span>
          <span className="text-[11px] text-muted-foreground">
            Digite o título, aperte <kbd className="rounded border border-border bg-muted px-1 font-mono">Tab</kbd> para próxima linha · arraste arquivos para anexar
          </span>
        </div>
        {open && rows.some((r) => r.title.trim()) && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {rows.filter((r) => r.title.trim()).length} pronta{rows.filter((r) => r.title.trim()).length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="w-6 py-1.5 pl-3"></th>
                  <th className="py-1.5 pr-3">Título da tarefa</th>
                  <th className="w-32 py-1.5 pr-3">Prazo</th>
                  {!compact && <th className="w-40 py-1.5 pr-3">Responsável</th>}
                  {!compact && <th className="w-32 py-1.5 pr-3">Prioridade</th>}
                  {!compact && <th className="w-36 py-1.5 pr-3">Setor</th>}
                  <th className="w-8 py-1.5 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={row.id}
                    onDragEnter={(e) => {
                      if (!e.dataTransfer.types.includes("Files")) return;
                      setDragRowId(row.id);
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("Files")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setDragRowId(row.id);
                    }}
                    onDrop={async (e) => {
                      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      dragDepth.current = 0;
                      setCardDrag(false);
                      setDragRowId(null);
                      await addFilesToRow(row.id, e.dataTransfer.files);
                    }}
                    className={`border-b border-border/60 last:border-0 hover:bg-secondary/30 ${
                      dragRowId === row.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="py-1 pl-3 text-[10px] text-muted-foreground">{idx + 1}</td>
                    <td className="py-1 pr-3">
                      <input
                        ref={(el) => {
                          inputRefs.current[row.id] = el;
                        }}
                        value={row.title}
                        onChange={(e) => update(row.id, { title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            requestSubmitAll();
                          } else if (e.key === "Tab" && !e.shiftKey) {
                            e.preventDefault();
                            jumpNext(row.id);
                          } else if (e.key === "Backspace" && row.title === "" && rows.length > 1) {
                            e.preventDefault();
                            remove(row.id);
                            const prev = rows[idx - 1];
                            if (prev) focusRow(prev.id);
                          } else if (e.key === "ArrowDown") {
                            const nxt = rows[idx + 1];
                            if (nxt) {
                              e.preventDefault();
                              focusRow(nxt.id);
                            }
                          } else if (e.key === "ArrowUp") {
                            const prv = rows[idx - 1];
                            if (prv) {
                              e.preventDefault();
                              focusRow(prv.id);
                            }
                          }
                        }}
                        placeholder="Nova tarefa…"
                        className="w-full bg-transparent px-1 py-1.5 outline-none placeholder:text-muted-foreground/60"
                      />
                      {row.attachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.attachments.map((a) => (
                            <span
                              key={a.id}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 text-[10px]"
                              title={`${a.name} · ${formatBytes(a.size)}`}
                            >
                              {isImage(a.type) ? (
                                <ImageIcon className="h-2.5 w-2.5 text-primary" />
                              ) : (
                                <FileText className="h-2.5 w-2.5 text-muted-foreground" />
                              )}
                              <span className="max-w-[120px] truncate">{a.name}</span>
                              <button
                                type="button"
                                onClick={() => removeAttachment(row.id, a.id)}
                                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-3">
                      <input
                        type="date"
                        value={row.dueDate}
                        onChange={(e) => update(row.id, { dueDate: e.target.value })}
                        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-border focus:bg-background"
                      />
                    </td>
                    {!compact && (
                      <td className="py-1 pr-3">
                        <select
                          value={row.assigneeId}
                          onChange={(e) => update(row.id, { assigneeId: e.target.value })}
                          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-border focus:bg-background"
                        >
                          {assignees.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {!compact && (
                      <td className="py-1 pr-3">
                        <select
                          value={row.priority}
                          onChange={(e) => update(row.id, { priority: e.target.value as Priority })}
                          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-border focus:bg-background"
                        >
                          {(Object.entries(priorityLabels) as [Priority, string][]).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    {!compact && (
                      <td className="py-1 pr-3">
                        <select
                          value={row.sector}
                          onChange={(e) => update(row.id, { sector: e.target.value })}
                          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-xs outline-none focus:border-border focus:bg-background"
                        >
                          <option value="">— setor —</option>
                          {sectors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td className="py-1 pr-2 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => openFilePicker(row.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          title="Anexar arquivo (ou arraste)"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </button>
                      <button
                        type="button"
                        onClick={() => remove(row.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Remover linha"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cardDrag && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
              <div className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow">
                Solte para anexar {dragRowId ? "nesta linha" : "à última tarefa"}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => addRow()}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Plus className="h-3 w-3" /> Nova linha
            </button>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                <kbd className="rounded border border-border bg-muted px-1 font-mono">Tab</kbd> próxima linha ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd> cria todas ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">↑↓</kbd> navega ·{" "}
                <kbd className="rounded border border-border bg-muted px-1 font-mono">⌫</kbd> remove linha vazia
              </span>
              <button
                type="button"
                onClick={requestSubmitAll}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Criar todas
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Criar todas as tarefas?</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Você vai criar <strong>{validRows.length}</strong> tarefa{validRows.length > 1 ? "s" : ""} de uma vez. Confira antes de confirmar:
            </p>
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border bg-secondary/40 p-2 text-xs">
              {validRows.map((r, i) => (
                <li key={r.id} className="flex items-center gap-2 border-b border-border/40 py-1 last:border-0">
                  <span className="text-[10px] text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate font-medium">{r.title}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{r.priority}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSubmitAll}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Criar {validRows.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}