import { useEffect, useMemo, useRef, useState } from "react";
import { X, AtSign, Trash2, MessageSquare, ListChecks, Activity, Plus, Check, Paperclip } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { formatRelative } from "@/lib/use-theme";
import { filesToAttachments } from "@/lib/attachments";
import type { Attachment } from "@/lib/fluxo-types";
import { AttachmentList, AttachmentBadge } from "@/components/attachment-list";
import {
  sectors,
  freqLabels,
  priorityLabels,
  statusLabels,
  type Frequency,
  type Priority,
  type Status,
} from "@/lib/fluxo-types";

type Tab = "detalhes" | "checklist" | "comentarios" | "timeline";

export function TaskDialog() {
  const {
    users,
    tasks,
    currentUser,
    visibleUsersForAssign,
    createTask,
    updateTask,
    deleteTask,
    addComment,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    addTaskAttachments,
    removeTaskAttachment,
    taskDialog,
    closeTaskDialog,
  } = useFluxo();

  const open = taskDialog.open;
  const editing = useMemo(
    () => (taskDialog.editingId ? tasks.find((t) => t.id === taskDialog.editingId) ?? null : null),
    [taskDialog.editingId, tasks],
  );

  const [tab, setTab] = useState<Tab>("detalhes");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sector, setSector] = useState(currentUser.sector);
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [frequency, setFrequency] = useState<Frequency>("diaria");
  const [status, setStatus] = useState<Status>("pendente");
  const [priority, setPriority] = useState<Priority>("media");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(false);
  const [recurringUntil, setRecurringUntil] = useState<string>("");
  const [tags, setTags] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [newChecklist, setNewChecklist] = useState("");
  const [pendingCommentAtts, setPendingCommentAtts] = useState<Attachment[]>([]);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const taskAttInputRef = useRef<HTMLInputElement>(null);
  const commentAttInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab("detalhes");
    setPendingCommentAtts([]);
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setSector(editing.sector);
      setAssigneeId(editing.assigneeId);
      setFrequency(editing.frequency);
      setStatus(editing.status);
      setPriority(editing.priority);
      setDueDate(editing.dueDate.slice(0, 10));
      setRecurring(editing.recurring);
      setRecurringUntil(editing.recurringUntil ? editing.recurringUntil.slice(0, 10) : "");
      setTags(editing.tags.join(", "));
      setMentions(editing.mentions);
    } else {
      setTitle("");
      setDescription("");
      setSector(currentUser.sector);
      setAssigneeId(currentUser.id);
      setFrequency("diaria");
      setStatus(taskDialog.initialStatus ?? "pendente");
      setPriority("media");
      setDueDate(taskDialog.initialDueDate ?? new Date().toISOString().slice(0, 10));
      setRecurring(false);
      setRecurringUntil("");
      setTags("");
      setMentions([]);
    }
  }, [open, editing, currentUser.id, currentUser.sector, taskDialog.initialStatus, taskDialog.initialDueDate]);

  if (!open) return null;

  const assignables = visibleUsersForAssign();

  const handleTaskFilePick = async (files: FileList | null) => {
    if (!files || !editing) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (ok.length) addTaskAttachments(editing.id, ok);
    if (rejected.length) alert(`Arquivos ignorados (muito grandes):\n${rejected.join("\n")}`);
  };

  const handleCommentFilePick = async (files: FileList | null) => {
    if (!files) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (ok.length) setPendingCommentAtts((prev) => [...prev, ...ok]);
    if (rejected.length) alert(`Arquivos ignorados (muito grandes):\n${rejected.join("\n")}`);
  };

  const submitComment = () => {
    if (!editing) return;
    if (!newComment.trim() && !pendingCommentAtts.length) return;
    addComment(editing.id, newComment, pendingCommentAtts);
    setNewComment("");
    setPendingCommentAtts([]);
  };

  const handleDescChange = (val: string) => {
    setDescription(val);
    const caret = descRef.current?.selectionStart ?? val.length;
    const upto = val.slice(0, caret);
    const m = upto.match(/@(\w*)$/);
    setMentionQuery(m ? m[1]!.toLowerCase() : null);
  };

  const insertMention = (u: { id: string; name: string }) => {
    if (!mentions.includes(u.id)) setMentions([...mentions, u.id]);
    const caret = descRef.current?.selectionStart ?? description.length;
    const before = description.slice(0, caret).replace(/@\w*$/, `@${u.name} `);
    const after = description.slice(caret);
    setDescription(before + after);
    setMentionQuery(null);
    setTimeout(() => descRef.current?.focus(), 0);
  };

  const removeMention = (id: string) => setMentions(mentions.filter((m) => m !== id));

  const filteredMentions = users
    .filter((u) => u.id !== currentUser.id)
    .filter((u) => (mentionQuery ? u.name.toLowerCase().includes(mentionQuery) : true))
    .slice(0, 6);

  const handleSubmit = () => {
    if (!title.trim()) return;
    const payload = {
      title: title.trim(),
      description: description.trim(),
      sector,
      createdBy: editing?.createdBy ?? currentUser.id,
      assigneeId,
      mentions,
      frequency,
      status,
      score: editing?.score ?? 20,
      dueDate: new Date(dueDate + "T17:00:00").toISOString(),
      recurring,
      recurringUntil: recurring && recurringUntil ? new Date(recurringUntil + "T23:59:59").toISOString() : null,
      priority,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (editing) updateTask(editing.id, payload);
    else createTask(payload);
    closeTaskDialog();
  };

  const handleDelete = () => {
    if (editing && confirm("Excluir esta tarefa?")) {
      deleteTask(editing.id);
      closeTaskDialog();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeTaskDialog}>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{editing ? "Editar tarefa" : "Nova tarefa"}</h2>
          <button onClick={closeTaskDialog} className="rounded-md p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {editing && (
          <div className="flex gap-1 border-b border-border px-5">
            {(
              [
                { id: "detalhes", label: "Detalhes", icon: null },
                { id: "checklist", label: `Checklist${editing.checklist.length ? ` (${editing.checklist.filter((c) => c.done).length}/${editing.checklist.length})` : ""}`, icon: ListChecks },
                { id: "comentarios", label: `Comentários${editing.comments.length ? ` (${editing.comments.length})` : ""}`, icon: MessageSquare },
                { id: "timeline", label: "Timeline", icon: Activity },
              ] as { id: Tab; label: string; icon: typeof Activity | null }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-sm ${
                  tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon && <t.icon className="h-3.5 w-3.5" />}
                {t.label}
                {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {tab === "detalhes" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Título</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="O que precisa ser feito?"
                  autoFocus
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Descrição <span className="text-muted-foreground/60">(use @ para mencionar)</span>
                </label>
                <textarea
                  ref={descRef}
                  value={description}
                  onChange={(e) => handleDescChange(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {mentionQuery !== null && filteredMentions.length > 0 && (
                  <div className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                    {filteredMentions.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => insertMention(u)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {u.avatar}
                        </span>
                        {u.name}
                        <span className="ml-auto text-[10px] text-muted-foreground">{u.jobTitle}</span>
                      </button>
                    ))}
                  </div>
                )}
                {mentions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {mentions.map((mid) => {
                      const u = users.find((x) => x.id === mid);
                      if (!u) return null;
                      return (
                        <span
                          key={mid}
                          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]"
                        >
                          <AtSign className="h-2.5 w-2.5" />
                          {u.name}
                          <button onClick={() => removeMention(mid)} className="ml-1 text-muted-foreground hover:text-foreground">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Responsável">
                  <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="input">
                    {assignables.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} {u.id === currentUser.id ? "(eu)" : ""}
                      </option>
                    ))}
                  </select>
                  {currentUser.role === "adm" && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Como ADM, você só cria tarefas para si mesmo. Use @ para mencionar colegas.
                    </p>
                  )}
                </Field>
                <Field label="Setor">
                  <select value={sector} onChange={(e) => setSector(e.target.value)} className="input">
                    {sectors.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Frequência">
                  <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className="input">
                    {Object.entries(freqLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Prioridade">
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="input">
                    {Object.entries(priorityLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="input">
                    {Object.entries(statusLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Prazo">
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
                </Field>
                <Field label="Tags (separadas por vírgula)">
                  <input value={tags} onChange={(e) => setTags(e.target.value)} className="input" />
                </Field>
              </div>

              <div className="rounded-md border border-border bg-secondary/40 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                  Tarefa recorrente (repete automaticamente ao concluir)
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Atalhos:</span>
                  {([
                    { label: "Diária", freq: "diaria" as Frequency, days: 30 },
                    { label: "Semanal", freq: "semanal" as Frequency, days: 90 },
                    { label: "Mensal", freq: "mensal" as Frequency, days: 365 },
                    { label: "Dias úteis", freq: "diaria" as Frequency, days: 30, weekdays: true },
                  ] as { label: string; freq: Frequency; days: number; weekdays?: boolean }[]).map((p) => {
                    const active = recurring && frequency === p.freq;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setRecurring(true);
                          setFrequency(p.freq);
                          const end = new Date();
                          end.setDate(end.getDate() + p.days);
                          setRecurringUntil(end.toISOString().slice(0, 10));
                          if (p.weekdays) {
                            const d = new Date(dueDate);
                            const dow = d.getDay();
                            if (dow === 0) d.setDate(d.getDate() + 1);
                            if (dow === 6) d.setDate(d.getDate() + 2);
                            setDueDate(d.toISOString().slice(0, 10));
                          }
                        }}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card hover:border-primary/50"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  {recurring && (
                    <button
                      type="button"
                      onClick={() => {
                        setRecurring(false);
                        setRecurringUntil("");
                      }}
                      className="ml-auto text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      remover recorrência
                    </button>
                  )}
                </div>
                {recurring && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Repetir até (opcional):</span>
                    <input
                      type="date"
                      value={recurringUntil}
                      onChange={(e) => setRecurringUntil(e.target.value)}
                      className="input max-w-[10rem] py-1"
                    />
                    {recurringUntil && (
                      <button
                        type="button"
                        onClick={() => setRecurringUntil("")}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        limpar
                      </button>
                    )}
                    <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                      {freqLabels[frequency]}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "checklist" && editing && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={newChecklist}
                  onChange={(e) => setNewChecklist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newChecklist.trim()) {
                      addChecklistItem(editing.id, newChecklist);
                      setNewChecklist("");
                    }
                  }}
                  placeholder="Adicionar item…"
                  className="input flex-1"
                />
                <button
                  onClick={() => {
                    if (newChecklist.trim()) {
                      addChecklistItem(editing.id, newChecklist);
                      setNewChecklist("");
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-sm text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
              </div>
              <ul className="space-y-1">
                {editing.checklist.length === 0 && (
                  <li className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                    Nenhum item ainda. Quebre a tarefa em passos objetivos.
                  </li>
                )}
                {editing.checklist.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50">
                    <button
                      onClick={() => toggleChecklistItem(editing.id, c.id)}
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        c.done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {c.done && <Check className="h-3 w-3" />}
                    </button>
                    <span className={`flex-1 text-sm ${c.done ? "text-muted-foreground line-through" : ""}`}>
                      {c.text}
                    </span>
                    <button
                      onClick={() => removeChecklistItem(editing.id, c.id)}
                      className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "comentarios" && editing && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Deixe um comentário… (Ctrl+Enter para enviar)"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && newComment.trim()) {
                      addComment(editing.id, newComment);
                      setNewComment("");
                    }
                  }}
                  className="input flex-1 resize-none"
                />
                <button
                  onClick={() => {
                    if (newComment.trim()) {
                      addComment(editing.id, newComment);
                      setNewComment("");
                    }
                  }}
                  className="self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                >
                  Comentar
                </button>
              </div>
              <ul className="space-y-3">
                {editing.comments.length === 0 && (
                  <li className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                    Sem comentários ainda.
                  </li>
                )}
                {[...editing.comments].reverse().map((c) => {
                  const u = users.find((x) => x.id === c.userId);
                  return (
                    <li key={c.id} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        {u?.avatar}
                      </div>
                      <div className="flex-1 rounded-md border border-border bg-background/60 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{u?.name}</span>
                          <span className="text-muted-foreground">{formatRelative(c.at)}</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm">{c.text}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {tab === "atividade" && editing && (
            <ul className="space-y-3">
              {[...editing.activity].reverse().map((a) => {
                const u = users.find((x) => x.id === a.userId);
                return (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
                      {u?.avatar ?? "?"}
                    </div>
                    <div className="flex-1">
                      <span className="font-medium">{u?.name ?? "—"}</span>{" "}
                      <span className="text-muted-foreground">{a.text}</span>
                      <div className="text-[10px] text-muted-foreground/70">{formatRelative(a.at)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <div>
            {editing && (
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" /> Excluir
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={closeTaskDialog}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:brightness-110"
            >
              {editing ? "Salvar" : "Criar tarefa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}