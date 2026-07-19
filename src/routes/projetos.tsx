import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FolderKanban, Plus, Trash2, Users, CheckCircle2, Circle, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";

import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import type { ProjectStatus } from "@/lib/fluxo-types";
import { sectors } from "@/lib/fluxo-types";

export const Route = createFileRoute("/projetos")({
  head: () => ({
    meta: [
      { title: "Projetos — Fluxo" },
      {
        name: "description",
        content:
          "Crie projetos longos e quebre em subtarefas — cada subtarefa aparece no dia-a-dia da pessoa responsável.",
      },
    ],
  }),
  component: ProjetosPage,
});

const statusStyles: Record<ProjectStatus, { label: string; className: string }> = {
  ativo: { label: "Ativo", className: "bg-emerald-500/15 text-emerald-500" },
  pausado: { label: "Pausado", className: "bg-amber-500/15 text-amber-500" },
  concluido: { label: "Concluído", className: "bg-primary/15 text-primary" },
};

function ProjetosPage() {
  const {
    visibleProjects,
    projectTasks,
    createProject,
    updateProject,
    deleteProject,
    createTask,
    updateTask,
    users,
    currentUser,
    visibleUsersForAssign,
  } = useFluxo();

  const assignees = visibleUsersForAssign();
  const projects = visibleProjects();
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    sector: currentUser.sector,
    dueDate: "",
    memberIds: [] as string[],
  });

  const [subtaskDraft, setSubtaskDraft] = useState({
    title: "",
    description: "",
    assigneeId: currentUser.id,
    dueDate: "",
  });

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const subtasks = useMemo(() => (selected ? projectTasks(selected.id) : []), [selected, projectTasks]);
  const doneCount = subtasks.filter((t) => t.status === "concluida").length;
  const progress = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  const handleCreateProject = () => {
    if (!newProject.name.trim()) {
      toast.error("Dê um nome ao projeto");
      return;
    }
    const id = createProject({
      name: newProject.name.trim(),
      description: newProject.description.trim() || undefined,
      status: "ativo",
      ownerId: currentUser.id,
      memberIds: newProject.memberIds,
      sector: newProject.sector,
      dueDate: newProject.dueDate ? new Date(newProject.dueDate).toISOString() : undefined,
    });
    setNewProject({
      name: "",
      description: "",
      sector: currentUser.sector,
      dueDate: "",
      memberIds: [],
    });
    setCreating(false);
    setSelectedId(id);
    toast.success("Projeto criado");
  };

  const handleAddSubtask = () => {
    if (!selected) return;
    if (!subtaskDraft.title.trim()) {
      toast.error("Escreva o título da subtarefa");
      return;
    }
    const assignee = users.find((u) => u.id === subtaskDraft.assigneeId) ?? currentUser;
    const due = subtaskDraft.dueDate
      ? new Date(subtaskDraft.dueDate)
      : new Date(Date.now() + 3 * 24 * 3600e3);
    due.setHours(23, 59, 0, 0);
    createTask({
      title: subtaskDraft.title.trim(),
      description: subtaskDraft.description.trim() || undefined,
      sector: assignee.sector,
      createdBy: currentUser.id,
      assigneeId: assignee.id,
      mentions: assignee.id !== currentUser.id ? [assignee.id] : [],
      frequency: "diaria",
      status: "pendente",
      score: 15,
      dueDate: due.toISOString(),
      recurring: false,
      priority: "media",
      tags: ["projeto", selected.name],
      projectId: selected.id,
    });
    setSubtaskDraft({ title: "", description: "", assigneeId: currentUser.id, dueDate: "" });
    toast.success(`Subtarefa criada para ${assignee.name.split(" ")[0]}`);
  };

  return (
    <FluxoLayout title="Projetos" breadcrumb="Execução">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <FolderKanban className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">Projetos</h1>
              <p className="text-xs text-muted-foreground">
                Trabalhos longos com subtarefas que viram o dia-a-dia da equipe.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo projeto
          </button>
        </header>

        {creating && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Criar projeto</h2>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                autoFocus
                value={newProject.name}
                onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nome do projeto (ex: Implantação ERP)"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                type="date"
                value={newProject.dueDate}
                onChange={(e) => setNewProject((p) => ({ ...p, dueDate: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                title="Prazo previsto"
              />
              <textarea
                value={newProject.description}
                onChange={(e) => setNewProject((p) => ({ ...p, description: e.target.value }))}
                placeholder="Objetivo, escopo, contexto…"
                rows={2}
                className="col-span-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <select
                value={newProject.sector}
                onChange={(e) => setNewProject((p) => ({ ...p, sector: e.target.value }))}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="rounded-md border border-dashed border-border bg-background p-2">
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
                  Participantes ({newProject.memberIds.length})
                </div>
                <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {assignees
                    .filter((u) => u.id !== currentUser.id)
                    .map((u) => {
                      const on = newProject.memberIds.includes(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() =>
                            setNewProject((p) => ({
                              ...p,
                              memberIds: on
                                ? p.memberIds.filter((id) => id !== u.id)
                                : [...p.memberIds, u.id],
                            }))
                          }
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                            on
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {u.name}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleCreateProject}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Criar projeto
              </button>
            </div>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <aside className="flex flex-col gap-2">
            {projects.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Nenhum projeto ainda. Crie o primeiro para começar.
              </div>
            )}
            {projects.map((p) => {
              const tasks = projectTasks(p.id);
              const done = tasks.filter((t) => t.status === "concluida").length;
              const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {tasks.length} {tasks.length === 1 ? "subtarefa" : "subtarefas"} · {done} feita{done === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusStyles[p.status].className}`}
                    >
                      {statusStyles[p.status].label}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="min-w-0 rounded-xl border border-border bg-card p-4">
            {!selected ? (
              <div className="grid h-72 place-items-center text-xs text-muted-foreground">
                Selecione um projeto ou crie um novo.
              </div>
            ) : (
              <>
                <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-base font-semibold">{selected.name}</h2>
                      <select
                        value={selected.status}
                        onChange={(e) =>
                          updateProject(selected.id, { status: e.target.value as ProjectStatus })
                        }
                        className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] outline-none focus:border-primary"
                      >
                        <option value="ativo">Ativo</option>
                        <option value="pausado">Pausado</option>
                        <option value="concluido">Concluído</option>
                      </select>
                    </div>
                    {selected.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {selected.memberIds.length + 1}
                      </span>
                      {selected.dueDate && (
                        <span>Prazo: {new Date(selected.dueDate).toLocaleDateString("pt-BR")}</span>
                      )}
                      <span>Progresso: {progress}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  {selected.ownerId === currentUser.id && (
                    <button
                      onClick={() => {
                        if (confirm(`Excluir "${selected.name}"? As subtarefas viram tarefas normais.`)) {
                          deleteProject(selected.id);
                          setSelectedId(null);
                          toast.success("Projeto excluído");
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Excluir
                    </button>
                  )}
                </header>

                <div className="mb-4 rounded-lg border border-dashed border-border bg-background p-3">
                  <div className="mb-2 text-xs font-semibold">Adicionar subtarefa</div>
                  <div className="grid gap-2 md:grid-cols-[1fr_1fr_180px_130px_auto]">
                    <input
                      value={subtaskDraft.title}
                      onChange={(e) => setSubtaskDraft((s) => ({ ...s, title: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddSubtask();
                      }}
                      placeholder="Título da subtarefa"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <input
                      value={subtaskDraft.description}
                      onChange={(e) =>
                        setSubtaskDraft((s) => ({ ...s, description: e.target.value }))
                      }
                      placeholder="Descrição (opcional)"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <select
                      value={subtaskDraft.assigneeId}
                      onChange={(e) =>
                        setSubtaskDraft((s) => ({ ...s, assigneeId: e.target.value }))
                      }
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                    >
                      {assignees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={subtaskDraft.dueDate}
                      onChange={(e) => setSubtaskDraft((s) => ({ ...s, dueDate: e.target.value }))}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleAddSubtask}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    A subtarefa aparece automaticamente em <b>Minhas tarefas</b> da pessoa responsável.
                  </p>
                </div>

                <ul className="space-y-1">
                  {subtasks.length === 0 && (
                    <li className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Sem subtarefas ainda.
                    </li>
                  )}
                  {subtasks.map((t) => {
                    const assignee = users.find((u) => u.id === t.assigneeId);
                    const done = t.status === "concluida";
                    return (
                      <li
                        key={t.id}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                          done
                            ? "border-emerald-500/40 bg-emerald-500/10 text-muted-foreground"
                            : "border-border hover:bg-secondary"
                        }`}
                      >
                        <button
                          onClick={() =>
                            updateTask(t.id, {
                              status: done ? "pendente" : "concluida",
                            })
                          }
                          className="text-muted-foreground hover:text-primary"
                          title={done ? "Reabrir" : "Concluir"}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate font-medium ${done ? "line-through" : ""}`}>
                            {t.title}
                          </div>
                          {t.description && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {t.description}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {assignee && (
                            <span className="inline-flex items-center gap-1">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                                {assignee.avatar || assignee.name.slice(0, 1)}
                              </span>
                              {assignee.name.split(" ")[0]}
                            </span>
                          )}
                          <span>{new Date(t.dueDate).toLocaleDateString("pt-BR")}</span>
                          <ArrowRight className="h-3 w-3 opacity-50" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </FluxoLayout>
  );
}