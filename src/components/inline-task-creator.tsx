import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Paperclip, X, FileText, Image as ImageIcon, UploadCloud, ShieldCheck, Timer, ClipboardPaste } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { type Status } from "@/lib/fluxo-types";
import type { Attachment } from "@/lib/fluxo-types";
import { filesToAttachments, formatBytes, isImage } from "@/lib/attachments";
import { parseHM } from "@/lib/time-log";
import { parseExcelPaste, type ParsedPasteRow } from "@/lib/excel-paste";
import { toast } from "sonner";

interface DraftRow {
  id: string;
  title: string;
  description: string;
  dueDate: string; // yyyy-mm-dd
  assigneeId: string;
  sector: string;
  attachments: Attachment[];
  mentions: string[];
  requireProof: boolean;
  /** Estimated time as user-typed hh:mm string (empty = none) */
  estimateHM: string;
}

const rid = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function inDaysStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function makeDraft(defaults: Partial<DraftRow>): DraftRow {
  return {
    id: rid(),
    title: "",
    description: "",
    dueDate: defaults.dueDate ?? todayStr(),
    assigneeId: defaults.assigneeId ?? "",
    sector: defaults.sector ?? "",
    attachments: [],
    mentions: [],
    requireProof: false,
    estimateHM: "",
  };
}

export function InlineTaskCreator({
  defaultStatus = "pendente",
  compact = false,
  defaultDueDate,
  defaultAssigneeId,
}: {
  defaultStatus?: Status;
  compact?: boolean;
  defaultDueDate?: string;
  defaultAssigneeId?: string;
}) {
  const { currentUser, visibleUsersForAssign, createTask, quickCreate, closeQuickCreate } = useFluxo();
  const assignees = visibleUsersForAssign();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<DraftRow[]>(() => [
    makeDraft({
      assigneeId: defaultAssigneeId ?? currentUser.id,
      sector: currentUser.sector,
      dueDate: defaultDueDate,
    }),
  ]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const descRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
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
    rect: { top: number; left: number; width: number };
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
    const est = parseHM(row.estimateHM);
    createTask({
      title: row.title.trim(),
      description: row.description.trim() || undefined,
      sector: row.sector || currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: row.assigneeId || currentUser.id,
      mentions: row.mentions,
      frequency: "diaria",
      status: defaultStatus,
      score: 10,
      dueDate: due.toISOString(),
      recurring: false,
      priority: "media",
      tags: [],
      attachments: row.attachments.length ? row.attachments : undefined,
      requireProof: row.requireProof || undefined,
      estimatedMinutes: est && est > 0 ? est : undefined,
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

  const handleEscape = () => {
    if (!quickCreate.open) return;
    if (confirmOpen || pasteOpen || discardOpen) return;
    if (mention) {
      setMention(null);
      return;
    }
    const hasContent = rows.some((r) => r.title.trim() || r.description.trim() || r.attachments.length > 0);
    if (hasContent) {
      setDiscardOpen(true);
    } else {
      closeQuickCreate();
    }
  };

  useEffect(() => {
    if (!quickCreate.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      handleEscape();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const saveAndClose = () => {
    const valid = rows.filter((r) => r.title.trim());
    if (valid.length === 0) {
      setDiscardOpen(false);
      closeQuickCreate();
      return;
    }
    valid.forEach(commitRow);
    toast.success(
      `${valid.length} tarefa${valid.length > 1 ? "s" : ""} criada${valid.length > 1 ? "s" : ""}`,
    );
    setDiscardOpen(false);
    closeQuickCreate();
  };

  const discardAndClose = () => {
    setDiscardOpen(false);
    closeQuickCreate();
  };

  const update = (id: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const applyParsedRows = (parsed: ParsedPasteRow[], anchorRowId?: string) => {
    if (parsed.length === 0) {
      toast.error("Nada para importar — cole ao menos uma linha com título");
      return 0;
    }
    setRows((rs) => {
      const idx = anchorRowId ? rs.findIndex((r) => r.id === anchorRowId) : -1;
      const drafts: DraftRow[] = parsed.map((p) =>
        makeDraft({
          assigneeId: p.assigneeId ?? defaultAssigneeId ?? currentUser.id,
          sector: p.sector ?? currentUser.sector,
          dueDate: p.dueDate ?? defaultDueDate ?? todayStr(),
        }),
      );
      // fill titles / estimates
      parsed.forEach((p, i) => {
        drafts[i].title = p.title;
        if (p.estimateHM) drafts[i].estimateHM = p.estimateHM;
      });
      // Replace anchor row if it's still empty, otherwise insert after it
      if (idx >= 0) {
        const anchor = rs[idx];
        const copy = [...rs];
        if (!anchor.title.trim() && drafts.length > 0) {
          copy.splice(idx, 1, ...drafts);
        } else {
          copy.splice(idx + 1, 0, ...drafts);
        }
        return copy;
      }
      // no anchor: replace trailing empty row if exists
      const last = rs[rs.length - 1];
      if (last && !last.title.trim()) {
        return [...rs.slice(0, -1), ...drafts, makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector })];
      }
      return [...rs, ...drafts];
    });
    return parsed.length;
  };

  const handleTitlePaste = (rowId: string, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (!text.includes("\n") && !text.includes("\t")) return; // normal paste
    e.preventDefault();
    const parsed = parseExcelPaste(text, assignees);
    const n = applyParsedRows(parsed, rowId);
    if (n > 0) toast.success(`${n} linha${n > 1 ? "s" : ""} importada${n > 1 ? "s" : ""} da planilha`);
  };

  const submitPasteModal = () => {
    const parsed = parseExcelPaste(pasteText, assignees);
    const n = applyParsedRows(parsed);
    if (n > 0) {
      toast.success(`${n} linha${n > 1 ? "s" : ""} importada${n > 1 ? "s" : ""}`);
      setPasteText("");
      setPasteOpen(false);
    }
  };

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
      className={`relative rounded-lg border-2 bg-card text-foreground shadow-md transition ${
        cardDrag ? "border-primary ring-2 ring-primary/30" : "border-foreground/70"
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
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-b-2 border-foreground/70 bg-secondary/50 px-4 py-3 text-left hover:bg-secondary"
        title={open ? "Clique para recolher" : "Clique para expandir"}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-foreground/40 bg-background text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-base font-bold text-foreground">Planilha de tarefas</span>
          <span className="ml-1 hidden text-[11px] font-medium text-foreground/60 sm:inline">
            (clique para {open ? "recolher" : "expandir"})
          </span>
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
            <UploadCloud className="h-3 w-3" /> arraste arquivos aqui
          </span>
        </div>
        {open && rows.some((r) => r.title.trim()) && (
          <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
            {rows.filter((r) => r.title.trim()).length} pronta{rows.filter((r) => r.title.trim()).length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && (
        <div>
          <div className="flex flex-col gap-1.5 p-2 sm:p-3">
            {rows.map((row, idx) => (
              <div
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
                className={`relative rounded-md border border-foreground/40 bg-background px-2 py-1.5 shadow-sm transition ${
                  dragRowId === row.id ? "border-primary bg-primary/5" : "hover:border-foreground/60"
                }`}
              >
                <div className="flex items-stretch gap-2">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {idx + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="relative min-w-0 flex-[1_1_38%]">
                  <input
                        ref={(el) => {
                          inputRefs.current[row.id] = el;
                        }}
                        value={row.title}
                        onChange={(e) => {
                          update(row.id, { title: e.target.value });
                          const cursor = e.currentTarget.selectionStart ?? e.target.value.length;
                          const m = parseMention(e.target.value, cursor);
                          if (m) {
        const r = e.currentTarget.getBoundingClientRect();
                            setMention({
                              rowId: row.id,
                              query: m.query,
                              startIndex: m.startIndex,
                              selectedIndex: 0,
                              rect: { top: r.bottom, left: r.left, width: Math.max(r.width, 224) },
                            });
                          } else {
                            setMention((cur) => (cur?.rowId === row.id ? null : cur));
                          }
                        }}
                        onKeyDown={(e) => {
                          const mentionOpen = mention?.rowId === row.id;
                          const matches = mentionOpen
                            ? assignees.filter((u) =>
                                u.name.toLowerCase().includes(mention!.query.toLowerCase()),
                              )
                            : [];

                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (mentionOpen && matches.length > 0) {
                              const u = matches[mention!.selectedIndex] ?? matches[0];
                              applyMention(row.id, u.id, u.name);
                            } else {
                              jumpNext(row.id);
                            }
                          } else if (e.key === "Tab" && !e.shiftKey) {
                            if (mentionOpen && matches.length > 0) {
                              e.preventDefault();
                              const u = matches[mention!.selectedIndex] ?? matches[0];
                              applyMention(row.id, u.id, u.name);
                            } else {
                              const el = descRefs.current[row.id];
                              if (el) {
                                e.preventDefault();
                                el.focus();
                              }
                            }
                          } else if (e.key === "Backspace" && row.title === "" && rows.length > 1) {
                            e.preventDefault();
                            remove(row.id);
                            const prev = rows[idx - 1];
                            if (prev) focusRow(prev.id);
                          } else if (e.key === "ArrowDown") {
                            if (mentionOpen && matches.length > 0) {
                              e.preventDefault();
                              setMention((m) =>
                                m ? { ...m, selectedIndex: Math.min(m.selectedIndex + 1, matches.length - 1) } : m,
                              );
                            } else {
                              const nxt = rows[idx + 1];
                              if (nxt) {
                                e.preventDefault();
                                focusRow(nxt.id);
                              }
                            }
                          } else if (e.key === "ArrowUp") {
                            if (mentionOpen && matches.length > 0) {
                              e.preventDefault();
                              setMention((m) =>
                                m ? { ...m, selectedIndex: Math.max(m.selectedIndex - 1, 0) } : m,
                              );
                            } else {
                              const prv = rows[idx - 1];
                              if (prv) {
                                e.preventDefault();
                                focusRow(prv.id);
                              }
                            }
                          } else if (e.key === "Escape") {
                            if (mentionOpen) {
                              e.preventDefault();
                              setMention(null);
                            }
                          }
                        }}
                        placeholder="Ex: Fazer conciliação bancária de julho"
                        className="w-full rounded-md border border-foreground/30 bg-background px-2.5 py-1.5 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/40 focus:border-primary focus:ring-1 focus:ring-primary/20"
                        onPaste={(e) => handleTitlePaste(row.id, e)}
                      />
                      {mention?.rowId === row.id && typeof document !== "undefined" &&
                        createPortal(
                          <div
                            className="fixed z-[200] overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
                            style={{ top: mention.rect.top + 4, left: mention.rect.left, width: mention.rect.width }}
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            {(() => {
                              const matches = assignees.filter((u) =>
                                u.name.toLowerCase().includes(mention.query.toLowerCase()),
                              );
                              if (matches.length === 0) {
                                return (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    Nenhum usuário encontrado
                                  </div>
                                );
                              }
                              return matches.slice(0, 8).map((u, i) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => applyMention(row.id, u.id, u.name)}
                                  onMouseEnter={() =>
                                    setMention((m) => (m ? { ...m, selectedIndex: i } : m))
                                  }
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary ${
                                    i === mention.selectedIndex ? "bg-secondary" : ""
                                  }`}
                                >
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                                    {u.avatar || u.name.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span className="flex-1 truncate">{u.name}</span>
                                </button>
                              ));
                            })()}
                          </div>,
                          document.body,
                        )}
                </div>
                <div className="min-w-0 flex-[1_1_62%]">
                  <input
                        ref={(el) => {
                          descRefs.current[row.id] = el;
                        }}
                        value={row.description}
                        onChange={(e) => update(row.id, { description: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            jumpNext(row.id);
                          } else if (e.key === "Tab" && e.shiftKey) {
                            const el = inputRefs.current[row.id];
                            if (el) {
                              e.preventDefault();
                              el.focus();
                            }
                          }
                        }}
                        placeholder="Descrição (opcional) — detalhes, contexto…"
                        className="w-full rounded-md border border-foreground/30 bg-background px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground/40 focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                </div>
                  </div>
                </div>
                {row.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
                    {row.attachments.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 text-[11px]"
                        title={`${a.name} · ${formatBytes(a.size)}`}
                      >
                        {isImage(a.type) ? (
                          <ImageIcon className="h-3 w-3 text-primary" />
                        ) : (
                          <FileText className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="max-w-[160px] truncate">{a.name}</span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(row.id, a.id)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
                  <div className="inline-flex items-center gap-0.5 rounded-md border border-foreground/30 bg-background p-0.5 text-[11px]">
                          {[
                            { label: "Hoje", get: todayStr },
                            { label: "Amanhã", get: tomorrowStr },
                            { label: "+7d", get: () => inDaysStr(7) },
                          ].map((opt) => {
                            const iso = opt.get();
                            const active = row.dueDate === iso;
                            return (
                              <button
                                type="button"
                                key={opt.label}
                                onClick={() => update(row.id, { dueDate: iso })}
                                className={`rounded px-1.5 py-0.5 font-semibold transition ${
                                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                  </div>
                  <input
                          type="date"
                          value={row.dueDate}
                          onChange={(e) => update(row.id, { dueDate: e.target.value })}
                          className="w-32 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground outline-none focus:border-primary"
                        />
                  {!compact && (
                    <select
                          value={row.assigneeId}
                          onChange={(e) => update(row.id, { assigneeId: e.target.value })}
                          className="rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground outline-none focus:border-primary"
                          title="Responsável"
                        >
                          {assignees.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                    </select>
                  )}
                  <div className="flex items-center gap-1 rounded-md border border-foreground/30 bg-background px-1.5 py-0.5 text-[11px] focus-within:border-primary">
                        <Timer className="h-3 w-3 text-foreground/70" />
                        <input
                          value={row.estimateHM}
                          onChange={(e) => update(row.id, { estimateHM: e.target.value })}
                          placeholder="00:30"
                          inputMode="numeric"
                          className="w-12 bg-transparent font-mono text-foreground outline-none placeholder:text-foreground/40"
                          title="Tempo estimado — ex.: 00:30, 1:15, 45m, 1.5h"
                        />
                  </div>
                  <div className="ml-auto inline-flex items-center gap-0.5">
                    <button
                          type="button"
                          onClick={() => update(row.id, { requireProof: !row.requireProof })}
                          className={`group inline-flex h-6 items-center gap-1 overflow-hidden rounded-md border px-1 transition-all ${
                            row.requireProof
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "border-foreground/30 text-foreground/70 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600"
                          }`}
                          title="Exigir comprovante para concluir"
                          aria-label="Exigir comprovante"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          <span className="max-w-0 whitespace-nowrap text-[10px] font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[140px] group-hover:pl-0.5 group-hover:opacity-100">
                            Exigir comprovante
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openFilePicker(row.id)}
                          className="group inline-flex h-6 items-center gap-1 overflow-hidden rounded-md border border-foreground/30 px-1 text-foreground/70 transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                          title="Anexar arquivo"
                          aria-label="Anexar arquivo"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="max-w-0 whitespace-nowrap text-[10px] font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[120px] group-hover:pl-0.5 group-hover:opacity-100">
                            Anexar arquivo
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row.id)}
                          className="group inline-flex h-6 items-center gap-1 overflow-hidden rounded-md border border-foreground/30 px-1 text-foreground/70 transition-all hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          title="Remover esta linha"
                          aria-label="Remover esta linha"
                        >
                          <Trash2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="max-w-0 whitespace-nowrap text-[10px] font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[100px] group-hover:pl-0.5 group-hover:opacity-100">
                            Remover
                          </span>
                        </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cardDrag && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
              <div className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow">
                Solte para anexar {dragRowId ? "nesta linha" : "à última tarefa"}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-foreground/70 bg-secondary/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addRow()}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-foreground/50 bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" /> Adicionar linha
              </button>
              <button
                type="button"
                onClick={() => setPasteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
                title="Cole aqui um bloco copiado do Excel / Google Sheets"
              >
                <ClipboardPaste className="h-4 w-4" /> Colar do Excel
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-foreground/80">
              <span className="hidden md:inline">
                <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono text-foreground">Enter</kbd> próxima ·{" "}
                <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono text-foreground">Tab</kbd> descrição ·{" "}
                <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono text-foreground">@</kbd> menciona ·{" "}
                <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono text-foreground">↑↓</kbd> navega
              </span>
              <button
                type="button"
                onClick={requestSubmitAll}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
              >
                <Sparkles className="h-4 w-4" />
                Criar {validRows.length > 0 ? `${validRows.length} tarefa${validRows.length > 1 ? "s" : ""}` : "tarefas"}
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
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.dueDate + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                  </span>
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

      {discardOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Sair sem criar?</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Você tem <strong>{validRows.length}</strong> tarefa{validRows.length > 1 ? "s" : ""} preenchida{validRows.length > 1 ? "s" : ""}. O que deseja fazer?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDiscardOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Continuar editando
              </button>
              <button
                onClick={discardAndClose}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
              >
                Descartar
              </button>
              <button
                onClick={saveAndClose}
                disabled={validRows.length === 0}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                Salvar {validRows.length > 0 ? validRows.length : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {pasteOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPasteOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardPaste className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">Colar planilha de tarefas</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cole abaixo (Ctrl+V) linhas copiadas do Excel, Google Sheets ou qualquer texto.
                  Uma linha = uma tarefa. Colunas separadas por tabulação:
                </p>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-medium">
                  {["Título*", "Prazo (dd/mm/aaaa)", "Responsável (nome)", "Setor", "Tempo (hh:mm)"].map((c, i) => (
                    <span
                      key={c}
                      className={`rounded border px-1.5 py-0.5 ${
                        i === 0
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setPasteOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`Fazer conciliação bancária\t25/07/2026\tElisa\tFinanceiro\t00:45\nEnviar relatório mensal\t28/07/2026\tRicardo\tOperações\t01:30`}
              className="mt-3 h-52 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs outline-none focus:border-primary"
            />
            {pasteText.trim() && (
              <div className="mt-2 rounded-md border border-border bg-secondary/40 p-2 text-[11px] text-muted-foreground">
                Prévia: <strong>{parseExcelPaste(pasteText, assignees).length}</strong> linha(s) reconhecida(s).
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPasteOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={submitPasteModal}
                disabled={!pasteText.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                Importar linhas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}