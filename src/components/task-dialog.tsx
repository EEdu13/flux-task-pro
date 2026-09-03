import { useEffect, useMemo, useRef, useState } from "react";
import { X, AtSign, Trash2, MessageSquare, ListChecks, Activity, Plus, Check, Paperclip } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { formatRelative } from "@/lib/use-theme";
import { filesToAttachments } from "@/lib/attachments";
import type { Attachment, ChecklistItem } from "@/lib/fluxo-types";
import { AttachmentList, AttachmentBadge } from "@/components/attachment-list";
import { formatHM, parseHM } from "@/lib/time-log";
import { TaskTimerControls } from "@/components/task-timer-controls";
import { confirmar } from "@/components/confirm-dialog";
import { CampoData } from "@/components/campo-data";
import { DIAS_SEMANA, ULTIMO_DIA_DO_MES, descreverRecorrencia } from "@/lib/recorrencia";
import { toast } from "sonner";
import {
  sectors,
  freqLabels,
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
  const [recurringWeekdays, setRecurringWeekdays] = useState<number[]>([]);
  const [recurringMonthDay, setRecurringMonthDay] = useState<number | null>(null);
  const [requireProof, setRequireProof] = useState(false);
  const [estimateHM, setEstimateHM] = useState("");
  const [tags, setTags] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [newChecklist, setNewChecklist] = useState("");
  /** Itens montados antes da tarefa existir. Só usado no modo criação. */
  const [rascunhoChecklist, setRascunhoChecklist] = useState<ChecklistItem[]>([]);
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
      setRecurringWeekdays(editing.recurringWeekdays ?? []);
      setRecurringMonthDay(editing.recurringMonthDay ?? null);
      setRequireProof(!!editing.requireProof);
      setEstimateHM(
        editing.estimatedMinutes
          ? `${Math.floor(editing.estimatedMinutes / 60)}:${String(editing.estimatedMinutes % 60).padStart(2, "0")}`
          : "",
      );
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
      setRecurringWeekdays([]);
      setRecurringMonthDay(null);
      setRequireProof(false);
      setEstimateHM("");
      setTags("");
      setMentions([]);
      setRascunhoChecklist([]);
    }
  }, [open, editing, currentUser.id, currentUser.sector, taskDialog.initialStatus, taskDialog.initialDueDate]);

  if (!open) return null;

  const assignables = visibleUsersForAssign();
  const canEditContent = !editing || editing.createdBy === currentUser.id;
  const canDelete = !!editing && (editing.createdBy === currentUser.id || currentUser.role === "gerente");

  /* Checklist nos dois modos: editando mexe direto na store, criando acumula no
     rascunho e vai junto no createTask. A tela é a mesma; só a origem muda. */
  const itensChecklist = editing ? editing.checklist : rascunhoChecklist;

  const adicionarItemChecklist = () => {
    const texto = newChecklist.trim();
    if (!texto) return;
    if (editing) addChecklistItem(editing.id, texto);
    else
      setRascunhoChecklist((itens) => [
        ...itens,
        { id: `rc-${Date.now().toString(36)}-${itens.length}`, text: texto, done: false },
      ]);
    setNewChecklist("");
  };

  const alternarItemChecklist = (itemId: string) => {
    if (editing) toggleChecklistItem(editing.id, itemId);
    else
      setRascunhoChecklist((itens) =>
        itens.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
      );
  };

  const removerItemChecklist = (itemId: string) => {
    if (editing) removeChecklistItem(editing.id, itemId);
    else setRascunhoChecklist((itens) => itens.filter((c) => c.id !== itemId));
  };

  const handleTaskFilePick = async (files: FileList | null) => {
    if (!files || !editing) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (ok.length) addTaskAttachments(editing.id, ok);
    if (rejected.length)
      toast.error(rejected.length === 1 ? "Arquivo muito grande" : "Arquivos muito grandes", {
        description: `Não anexado: ${rejected.join(", ")}`,
      });
  };

  const handleCommentFilePick = async (files: FileList | null) => {
    if (!files) return;
    const { ok, rejected } = await filesToAttachments(files, currentUser.id);
    if (ok.length) setPendingCommentAtts((prev) => [...prev, ...ok]);
    if (rejected.length)
      toast.error(rejected.length === 1 ? "Arquivo muito grande" : "Arquivos muito grandes", {
        description: `Não anexado: ${rejected.join(", ")}`,
      });
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
    const preserveTitle = editing && editing.createdBy !== currentUser.id;
    const isCreator = !editing || editing.createdBy === currentUser.id;
    const estMinutes = parseHM(estimateHM);
    const payload = {
      title: preserveTitle ? editing!.title : title.trim(),
      description: preserveTitle ? (editing!.description ?? "") : description.trim(),
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
      // Guardar só o que vale para a frequência escolhida: trocar de semanal
      // para mensal não pode deixar dias da semana órfãos decidindo a série.
      recurringWeekdays: recurring && frequency === "semanal" ? recurringWeekdays : null,
      recurringMonthDay: recurring && frequency === "mensal" ? recurringMonthDay : null,
      priority,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      requireProof: isCreator ? requireProof : !!editing?.requireProof,
      estimatedMinutes: estMinutes && estMinutes > 0 ? estMinutes : undefined,
    };
    if (editing) updateTask(editing.id, payload);
    else createTask({ ...payload, checklist: rascunhoChecklist });
    closeTaskDialog();
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = await confirmar({
      titulo: "Excluir esta tarefa?",
      descricao: `"${editing.title}" sai da lista de todo mundo, junto com comentários e anexos. Não dá para desfazer.`,
      confirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    deleteTask(editing.id);
    closeTaskDialog();
    toast.success("Tarefa excluída");
  };

  return (
    // z-420: este diálogo é aberto DE DENTRO de painéis que ficam bem mais
    // acima (delegar e paleta de comandos em 200, modais em 300, grade em
    // 400). Em z-50 ele abria atrás de quem o abriu — a tela só escurecia um
    // pouco e a tarefa ficava invisível. Tem que passar de todos os
    // lançadores, e ficar abaixo do confirm (500) e da barra de título (9999).
    <div className="fixed inset-0 z-420 flex items-center justify-center bg-black/50 p-4" onClick={closeTaskDialog}>
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

        {/* Ao criar, só Detalhes e Checklist. Comentários e Timeline dependem de
            uma tarefa que já existe; checklist não — montar os passos faz parte
            de pensar a tarefa, e obrigava a criar, salvar e reabrir. */}
        <div className="flex gap-1 border-b border-border px-5">
            {(
              [
                { id: "detalhes", label: "Detalhes", icon: null },
                {
                  id: "checklist",
                  label: `Checklist${
                    editing
                      ? editing.checklist.length
                        ? ` (${editing.checklist.filter((c) => c.done).length}/${editing.checklist.length})`
                        : ""
                      : rascunhoChecklist.length
                        ? ` (${rascunhoChecklist.length})`
                        : ""
                  }`,
                  icon: ListChecks,
                },
                ...(editing
                  ? [
                      { id: "comentarios" as Tab, label: `Comentários${editing.comments.length ? ` (${editing.comments.length})` : ""}`, icon: MessageSquare },
                      { id: "timeline" as Tab, label: "Timeline", icon: Activity },
                    ]
                  : []),
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

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {tab === "detalhes" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Título
                  {!canEditContent && (
                    <span className="ml-2 text-[10px] text-muted-foreground/70">(somente o criador pode editar)</span>
                  )}
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="O que precisa ser feito?"
                  autoFocus
                  readOnly={!canEditContent}
                  className={`w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${!canEditContent ? "cursor-not-allowed opacity-70" : ""}`}
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
                  readOnly={!canEditContent}
                  className={`w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring ${!canEditContent ? "cursor-not-allowed opacity-70" : ""}`}
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
                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className="input">
                    {Object.entries(statusLabels).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Prazo">
                  <CampoData
                    value={dueDate}
                    onChange={setDueDate}
                    formato="longo"
                    placeholder="Sem prazo"
                    className="w-full px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Tags (separadas por vírgula)">
                  <input value={tags} onChange={(e) => setTags(e.target.value)} className="input" />
                </Field>
                <Field label="Tempo estimado (hh:mm)">
                  <input
                    value={estimateHM}
                    onChange={(e) => setEstimateHM(e.target.value)}
                    placeholder="Ex.: 00:30, 1:15, 45m"
                    className="input font-mono"
                  />
                  {estimateHM && parseHM(estimateHM) !== null && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      = {formatHM((parseHM(estimateHM) ?? 0) * 60)}
                    </p>
                  )}
                </Field>
              </div>

              {editing && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Pomodoro / tempo trabalhado</span>
                    <br />
                    Use play / pause / stop para medir quanto tempo essa tarefa está consumindo.
                  </div>
                  <TaskTimerControls
                    taskId={editing.id}
                    estimatedMinutes={editing.estimatedMinutes}
                    size="md"
                  />
                </div>
              )}

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
                {/* Especificação fina, só do tipo escolhido. Antes "mensal" não
                    dizia qual dia e "semanal" não dizia quais dias — a série
                    caía sempre no mesmo dia do prazo original. */}
                {recurring && frequency === "semanal" && (
                  <div className="mt-3 border-t border-border/60 pt-2.5">
                    <span className="text-[11px] font-medium text-foreground">
                      Repete nestes dias:
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {DIAS_SEMANA.map((nome, dia) => {
                        const marcado = recurringWeekdays.includes(dia);
                        return (
                          <button
                            key={nome}
                            type="button"
                            onClick={() =>
                              setRecurringWeekdays((atual) =>
                                atual.includes(dia)
                                  ? atual.filter((d) => d !== dia)
                                  : [...atual, dia].sort((a, b) => a - b),
                              )
                            }
                            aria-pressed={marcado}
                            className={`h-7 w-9 rounded-md border text-[11px] font-semibold transition ${
                              marcado
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                            }`}
                          >
                            {nome}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setRecurringWeekdays([1, 2, 3, 4, 5])}
                        className="ml-1 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                      >
                        Dias úteis
                      </button>
                    </div>
                    {recurringWeekdays.length === 0 && (
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        Sem nenhum marcado, repete no mesmo dia da semana do prazo.
                      </p>
                    )}
                  </div>
                )}

                {recurring && frequency === "mensal" && (
                  <div className="mt-3 border-t border-border/60 pt-2.5">
                    <span className="text-[11px] font-medium text-foreground">Repete no dia:</span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <select
                        value={recurringMonthDay ?? ""}
                        onChange={(e) =>
                          setRecurringMonthDay(e.target.value === "" ? null : Number(e.target.value))
                        }
                        className="input max-w-[13rem] py-1 text-xs"
                      >
                        <option value="">Mesmo dia do prazo</option>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>
                            Dia {d}
                          </option>
                        ))}
                        <option value={ULTIMO_DIA_DO_MES}>Último dia do mês</option>
                      </select>
                      {recurringMonthDay !== null && recurringMonthDay > 28 && (
                        <span className="text-[10px] text-warning">
                          Meses mais curtos usam o último dia disponível.
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {recurring && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Repetir até (opcional):</span>
                    <CampoData
                      value={recurringUntil}
                      onChange={setRecurringUntil}
                      placeholder="Sem limite"
                      title="Repetir até"
                      className="max-w-40 py-1 text-xs"
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
                    {/* A regra por extenso vale mais que o rótulo da frequência:
                        "Mensal" não conta que cai no dia 15. */}
                    <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {descreverRecorrencia({
                        recurring,
                        frequency,
                        recurringWeekdays,
                        recurringMonthDay,
                      })}
                    </span>
                  </div>
                )}
              </div>

              {(!editing || editing.createdBy === currentUser.id) && (
              <div className="rounded-md border border-border bg-secondary/40 p-3">
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={requireProof}
                    onChange={(e) => setRequireProof(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Exigir comprovante para concluir</span>
                    <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      flag do gestor
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      Só permite marcar como concluída se tiver pelo menos 1 anexo (recibo, print, PDF). Ex: conciliação bancária, pagamento, envio de relatório.
                    </span>
                  </span>
                </label>
              </div>
              )}

              {editing && (
                <div className="rounded-md border border-border bg-secondary/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Paperclip className="h-3.5 w-3.5" />
                      Anexos
                      <span className="text-[11px] text-muted-foreground">
                        ({editing.attachments?.length ?? 0})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => taskAttInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-primary/50"
                    >
                      <Plus className="h-3 w-3" /> Adicionar arquivo
                    </button>
                    <input
                      ref={taskAttInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleTaskFilePick(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {editing.attachments && editing.attachments.length > 0 ? (
                    <AttachmentList
                      items={editing.attachments}
                      onRemove={(id) => removeTaskAttachment(editing.id, id)}
                    />
                  ) : (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Nenhum anexo. Envie imagens, PDFs, documentos (até 3 MB cada).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "checklist" && (
            <div className="space-y-3">
              {!editing && (
                <p className="text-xs text-muted-foreground">
                  Os itens são salvos junto com a tarefa.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  value={newChecklist}
                  onChange={(e) => setNewChecklist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      adicionarItemChecklist();
                    }
                  }}
                  placeholder="Adicionar item…"
                  className="input flex-1"
                />
                <button
                  type="button"
                  onClick={adicionarItemChecklist}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-sm text-primary-foreground transition hover:brightness-110"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
              </div>
              <ul className="space-y-1">
                {itensChecklist.length === 0 && (
                  <li className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                    Nenhum item ainda. Quebre a tarefa em passos objetivos.
                  </li>
                )}
                {itensChecklist.map((c) => (
                  <li key={c.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50">
                    <button
                      type="button"
                      onClick={() => alternarItemChecklist(c.id)}
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
                      type="button"
                      onClick={() => removerItemChecklist(c.id)}
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
              <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Deixe um comentário… (Ctrl+Enter para enviar)"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      submitComment();
                    }
                  }}
                  className="input w-full resize-none"
                />
                {pendingCommentAtts.length > 0 && (
                  <AttachmentList
                    items={pendingCommentAtts}
                    compact
                    onRemove={(id) =>
                      setPendingCommentAtts((p) => p.filter((a) => a.id !== id))
                    }
                  />
                )}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => commentAttInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Anexar
                  </button>
                  <input
                    ref={commentAttInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleCommentFilePick(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={submitComment}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:brightness-110"
                  >
                    Comentar
                  </button>
                </div>
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
                          {c.attachments && c.attachments.length > 0 && (
                            <AttachmentBadge count={c.attachments.length} />
                          )}
                        </div>
                        {c.text && <div className="mt-1 whitespace-pre-wrap text-sm">{c.text}</div>}
                        {c.attachments && c.attachments.length > 0 && (
                          <div className="mt-2">
                            <AttachmentList items={c.attachments} />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {tab === "timeline" && editing && (() => {
            type Item =
              | { kind: "activity"; id: string; at: string; userId: string; text: string }
              | {
                  kind: "comment";
                  id: string;
                  at: string;
                  userId: string;
                  text: string;
                  attachments?: Attachment[];
                };
            const items: Item[] = [
              ...editing.activity.map((a) => ({
                kind: "activity" as const,
                id: a.id,
                at: a.at,
                userId: a.userId,
                text: a.text,
              })),
              ...editing.comments.map((c) => ({
                kind: "comment" as const,
                id: c.id,
                at: c.at,
                userId: c.userId,
                text: c.text,
                attachments: c.attachments,
              })),
            ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
            return (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {items.map((it) => {
                  const u = users.find((x) => x.id === it.userId);
                  const isComment = it.kind === "comment";
                  return (
                    <li key={`${it.kind}-${it.id}`} className="relative">
                      <span
                        className={`absolute -left-[26px] flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card ${
                          isComment ? "bg-primary text-primary-foreground" : "bg-secondary"
                        }`}
                      >
                        {isComment ? (
                          <MessageSquare className="h-2.5 w-2.5" />
                        ) : (
                          <Activity className="h-2.5 w-2.5 text-muted-foreground" />
                        )}
                      </span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">{u?.name ?? "—"}</span>
                        {!isComment && (
                          <span className="text-muted-foreground">{it.text}</span>
                        )}
                        <span className="text-muted-foreground/70">
                          · {formatRelative(it.at)}
                        </span>
                      </div>
                      {isComment && (
                        <div className="mt-1 rounded-md border border-border bg-background/60 px-3 py-2 text-sm">
                          {it.text && <div className="whitespace-pre-wrap">{it.text}</div>}
                          {it.attachments && it.attachments.length > 0 && (
                            <div className="mt-2">
                              <AttachmentList items={it.attachments} />
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            );
          })()}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <div>
            {editing && (
              canDelete ? (
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" /> Excluir
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Apenas quem criou pode excluir. Conclua a tarefa para encerrá-la.
                </span>
              )
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