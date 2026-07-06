import { useEffect, useRef, useState } from "react";
import { X, AtSign, Trash2 } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import {
  sectors,
  freqLabels,
  priorityLabels,
  statusLabels,
  type Frequency,
  type Priority,
  type Status,
  type Task,
} from "@/lib/fluxo-types";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: Task | null;
}

export function TaskDialog({ open, onClose, editing }: Props) {
  const {
    users,
    currentUser,
    visibleUsersForAssign,
    createTask,
    updateTask,
    deleteTask,
  } = useFluxo();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sector, setSector] = useState(currentUser.sector);
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [frequency, setFrequency] = useState<Frequency>("diaria");
  const [status, setStatus] = useState<Status>("pendente");
  const [priority, setPriority] = useState<Priority>("media");
  const [score, setScore] = useState(20);
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [recurring, setRecurring] = useState(false);
  const [tags, setTags] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setSector(editing.sector);
      setAssigneeId(editing.assigneeId);
      setFrequency(editing.frequency);
      setStatus(editing.status);
      setPriority(editing.priority);
      setScore(editing.score);
      setDueDate(editing.dueDate.slice(0, 10));
      setRecurring(editing.recurring);
      setTags(editing.tags.join(", "));
      setMentions(editing.mentions);
    } else {
      setTitle("");
      setDescription("");
      setSector(currentUser.sector);
      setAssigneeId(currentUser.id);
      setFrequency("diaria");
      setStatus("pendente");
      setPriority("media");
      setScore(20);
      setDueDate(new Date().toISOString().slice(0, 10));
      setRecurring(false);
      setTags("");
      setMentions([]);
    }
  }, [open, editing, currentUser.id, currentUser.sector]);

  if (!open) return null;

  const assignables = visibleUsersForAssign();

  const handleDescChange = (val: string) => {
    setDescription(val);
    const caret = descRef.current?.selectionStart ?? val.length;
    const upto = val.slice(0, caret);
    const m = upto.match(/@(\w*)$/);
    setMentionQuery(m ? m[1].toLowerCase() : null);
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
      createdBy: currentUser.id,
      assigneeId,
      mentions,
      frequency,
      status,
      score,
      dueDate: new Date(dueDate + "T17:00:00").toISOString(),
      recurring,
      priority,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (editing) {
      updateTask(editing.id, payload);
    } else {
      createTask(payload);
    }
    onClose();
  };

  const handleDelete = () => {
    if (editing && confirm("Excluir esta tarefa?")) {
      deleteTask(editing.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {editing ? "Editar tarefa" : "Nova tarefa"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
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
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="input"
              >
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
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Frequência">
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className="input">
                {Object.entries(freqLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioridade">
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="input">
                {Object.entries(priorityLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="input">
                {Object.entries(statusLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prazo">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Pontos (score)">
              <input
                type="number"
                min={0}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Tags (separadas por vírgula)">
              <input value={tags} onChange={(e) => setTags(e.target.value)} className="input" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Tarefa recorrente (repete automaticamente)
          </label>
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
              onClick={onClose}
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