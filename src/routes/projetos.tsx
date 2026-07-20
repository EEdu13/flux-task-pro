import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderKanban,
  Plus,
  Trash2,
  Users,
  CheckCircle2,
  Circle,
  X,
  LayoutGrid,
  List as ListIcon,
  Calendar,
  Search,
  Sparkles,
  ChevronRight,
  Target,
  Flag,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import type { ProjectStatus, Status } from "@/lib/fluxo-types";
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
  ativo: { label: "Em andamento", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  pausado: { label: "Pausado", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  concluido: { label: "Concluído", className: "bg-primary/15 text-primary border-primary/30" },
};

const projectColorPalette = [
  "oklch(0.62 0.16 155)",
  "oklch(0.62 0.16 230)",
  "oklch(0.6 0.2 330)",
  "oklch(0.78 0.15 75)",
  "oklch(0.52 0.22 275)",
  "oklch(0.58 0.22 25)",
  "oklch(0.7 0.15 190)",
  "oklch(0.65 0.2 45)",
];

const statusColumns: { id: Status; label: string; tone: string }[] = [
  { id: "pendente", label: "A fazer", tone: "border-t-muted-foreground/40" },
  { id: "andamento", label: "Em andamento", tone: "border-t-primary" },
  { id: "concluida", label: "Concluído", tone: "border-t-emerald-500" },
];

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
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "todos">("todos");
  const [view, setView] = useState<"lista" | "board">("lista");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickAssignee, setQuickAssignee] = useState(currentUser.id);
  const [quickDate, setQuickDate] = useState("");
  const quickInputRef = useRef<HTMLInputElement>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const subtasks = useMemo(() => (selected ? projectTasks(selected.id) : []), [selected, projectTasks]);
  const doneCount = subtasks.filter((t) => t.status === "concluida").length;
  const progress = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "todos" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, statusFilter, search]);

  const handleQuickAdd = () => {
    if (!selected) return;
    if (!quickTitle.trim()) {
      quickInputRef.current?.focus();
      return;
    }
    const assignee = users.find((u) => u.id === quickAssignee) ?? currentUser;
    const due = quickDate ? new Date(quickDate) : new Date(Date.now() + 3 * 24 * 3600e3);
    due.setHours(23, 59, 0, 0);
    createTask({
      title: quickTitle.trim(),
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
    setQuickTitle("");
    setQuickDate("");
    quickInputRef.current?.focus();
  };

  return (
    <FluxoLayout title="Projetos" breadcrumb="Execução">
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <FolderKanban className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Projetos</h1>
              <p className="text-xs text-muted-foreground">
                {projects.length} projeto{projects.length === 1 ? "" : "s"} · organize trabalhos longos e delegue subtarefas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar projeto…"
                className="w-56 rounded-md border border-border bg-card py-2 pl-8 pr-3 text-xs outline-none transition focus:border-primary"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | "todos")}
              className="rounded-md border border-border bg-card px-2 py-2 text-xs outline-none focus:border-primary"
            >
              <option value="todos">Todos os status</option>
              <option value="ativo">Em andamento</option>
              <option value="pausado">Pausados</option>
              <option value="concluido">Concluídos</option>
            </select>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo projeto
            </button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="flex flex-col gap-2">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Meus projetos
              </span>
              <span className="text-[11px] text-muted-foreground">{filteredProjects.length}</span>
            </div>
            {filteredProjects.length === 0 && (
              <button
                onClick={() => setCreateOpen(true)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/60 p-6 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition group-hover:scale-110">
                  <Sparkles className="h-4 w-4" />
                </span>
                Nenhum projeto ainda. Clique para criar o primeiro.
              </button>
            )}
            {filteredProjects.map((p) => {
              const tasks = projectTasks(p.id);
              const done = tasks.filter((t) => t.status === "concluida").length;
              const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;
              const active = p.id === selectedId;
              const owner = users.find((u) => u.id === p.ownerId);
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-card hover:border-primary/40 hover:bg-secondary/40"
                  }`}
                >
                  <span
                    className="absolute inset-y-0 left-0 w-1"
                    style={{ background: p.color ?? "var(--primary)" }}
                  />
                  <div className="flex items-start justify-between gap-2 pl-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      {p.description && (
                        <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <div className="mt-2 flex items-center gap-2 pl-2 text-[10px] text-muted-foreground">
                    <span
                      className={`rounded-full border px-1.5 py-[1px] font-semibold ${statusStyles[p.status].className}`}
                    >
                      {statusStyles[p.status].label}
                    </span>
                    <span>·</span>
                    <span>
                      {done}/{tasks.length} tarefas
                    </span>
                    {owner && (
                      <>
                        <span>·</span>
                        <span className="truncate">{owner.name.split(" ")[0]}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 pl-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: p.color ?? "var(--primary)" }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground">{pct}%</span>
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="min-w-0 rounded-2xl border border-border bg-card">
            {!selected ? (
              <div className="grid h-96 place-items-center px-6 text-center">
                <div className="max-w-sm space-y-3">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FolderKanban className="h-5 w-5" />
                  </span>
                  <h3 className="text-sm font-semibold">Selecione um projeto</h3>
                  <p className="text-xs text-muted-foreground">
                    Escolha um projeto na lista à esquerda ou crie um novo para começar a delegar subtarefas.
                  </p>
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="mx-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
                  >
                    <Plus className="h-3.5 w-3.5" /> Criar projeto
                  </button>
                </div>
              </div>
            ) : (
              <ProjectDetail
                key={selected.id}
                selected={selected}
                subtasks={subtasks}
                progress={progress}
                doneCount={doneCount}
                users={users}
                assignees={assignees}
                currentUserId={currentUser.id}
                view={view}
                setView={setView}
                updateProject={updateProject}
                updateTask={updateTask}
                deleteProject={(id) => {
                  deleteProject(id);
                  setSelectedId(null);
                }}
                quickTitle={quickTitle}
                setQuickTitle={setQuickTitle}
                quickAssignee={quickAssignee}
                setQuickAssignee={setQuickAssignee}
                quickDate={quickDate}
                setQuickDate={setQuickDate}
                onQuickAdd={handleQuickAdd}
                quickInputRef={quickInputRef}
              />
            )}
          </section>
        </div>
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          assignees={assignees}
          currentUserId={currentUser.id}
          defaultSector={currentUser.sector}
          onCreate={(payload) => {
            const id = createProject({
              ...payload,
              status: "ativo",
              ownerId: currentUser.id,
            });
            setSelectedId(id);
            setCreateOpen(false);
            toast.success("Projeto criado", { description: payload.name });
          }}
        />
      )}
    </FluxoLayout>
  );
}

/* -------------------- Project detail (list / board) -------------------- */

interface ProjectDetailProps {
  selected: ReturnType<ReturnType<typeof useFluxo>["visibleProjects"]>[number];
  subtasks: ReturnType<ReturnType<typeof useFluxo>["projectTasks"]>;
  progress: number;
  doneCount: number;
  users: ReturnType<typeof useFluxo>["users"];
  assignees: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  view: "lista" | "board";
  setView: (v: "lista" | "board") => void;
  updateProject: ReturnType<typeof useFluxo>["updateProject"];
  updateTask: ReturnType<typeof useFluxo>["updateTask"];
  deleteProject: (id: string) => void;
  quickTitle: string;
  setQuickTitle: (v: string) => void;
  quickAssignee: string;
  setQuickAssignee: (v: string) => void;
  quickDate: string;
  setQuickDate: (v: string) => void;
  onQuickAdd: () => void;
  quickInputRef: React.RefObject<HTMLInputElement | null>;
}

function ProjectDetail({
  selected,
  subtasks,
  progress,
  doneCount,
  users,
  assignees,
  currentUserId,
  view,
  setView,
  updateProject,
  updateTask,
  deleteProject,
  quickTitle,
  setQuickTitle,
  quickAssignee,
  setQuickAssignee,
  quickDate,
  setQuickDate,
  onQuickAdd,
  quickInputRef,
}: ProjectDetailProps) {
  const isOwner = selected.ownerId === currentUserId;
  const groupedByStatus = useMemo(() => {
    const g: Record<Status, typeof subtasks> = {
      pendente: [],
      andamento: [],
      concluida: [],
    };
    subtasks.forEach((t) => g[t.status].push(t));
    return g;
  }, [subtasks]);

  return (
    <>
      {/* Cover / header */}
      <div
        className="relative overflow-hidden rounded-t-2xl px-6 py-5"
        style={{
          background: `linear-gradient(120deg, ${selected.color ?? "var(--primary)"} 0%, transparent 70%)`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                style={{ background: selected.color ?? "var(--primary)" }}
              >
                <FolderKanban className="h-4 w-4" />
              </span>
              <input
                value={selected.name}
                onChange={(e) => updateProject(selected.id, { name: e.target.value })}
                disabled={!isOwner}
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none disabled:cursor-default"
              />
              <select
                value={selected.status}
                onChange={(e) =>
                  updateProject(selected.id, { status: e.target.value as ProjectStatus })
                }
                disabled={!isOwner}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold outline-none ${statusStyles[selected.status].className}`}
              >
                <option value="ativo">Em andamento</option>
                <option value="pausado">Pausado</option>
                <option value="concluido">Concluído</option>
              </select>
            </div>
            <textarea
              value={selected.description ?? ""}
              onChange={(e) => updateProject(selected.id, { description: e.target.value })}
              placeholder="Adicione uma descrição para o projeto…"
              disabled={!isOwner}
              rows={1}
              className="mt-2 w-full resize-none bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <Metric icon={<Target className="h-3 w-3" />} label={`${progress}% concluído`} />
              <Metric
                icon={<CheckCircle2 className="h-3 w-3" />}
                label={`${doneCount}/${subtasks.length} tarefas`}
              />
              <Metric
                icon={<Users className="h-3 w-3" />}
                label={`${selected.memberIds.length + 1} pessoa${selected.memberIds.length ? "s" : ""}`}
              />
              {selected.dueDate && (
                <Metric
                  icon={<Calendar className="h-3 w-3" />}
                  label={`Prazo ${new Date(selected.dueDate).toLocaleDateString("pt-BR")}`}
                />
              )}
            </div>
          </div>
          {isOwner && (
            <button
              onClick={() => {
                if (confirm(`Excluir "${selected.name}"? As subtarefas viram tarefas normais.`)) {
                  deleteProject(selected.id);
                  toast.success("Projeto excluído");
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur hover:border-destructive/50 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Excluir
            </button>
          )}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${progress}%`, background: selected.color ?? "var(--primary)" }}
          />
        </div>
      </div>

      {/* Tabs & quick add */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 pt-3">
        <div className="flex items-center gap-1">
          <TabBtn active={view === "lista"} onClick={() => setView("lista")} icon={<ListIcon className="h-3.5 w-3.5" />}>
            Lista
          </TabBtn>
          <TabBtn active={view === "board"} onClick={() => setView("board")} icon={<LayoutGrid className="h-3.5 w-3.5" />}>
            Quadro
          </TabBtn>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Cada subtarefa aparece em <b className="text-foreground">Minhas tarefas</b> da pessoa responsável.
        </span>
      </div>

      <div className="p-4">
        {/* Quick add row (Asana-style) */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-3 py-2 focus-within:border-primary focus-within:bg-secondary/70">
          <Plus className="h-4 w-4 text-primary" />
          <input
            ref={quickInputRef}
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onQuickAdd();
            }}
            placeholder="Adicionar subtarefa… (Enter para salvar)"
            className="min-w-[220px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <select
            value={quickAssignee}
            onChange={(e) => setQuickAssignee(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
            title="Responsável"
          >
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={quickDate}
            onChange={(e) => setQuickDate(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
            title="Prazo"
          />
          <button
            onClick={onQuickAdd}
            disabled={!quickTitle.trim()}
            className="rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40 hover:brightness-110"
          >
            Adicionar
          </button>
        </div>

        {view === "lista" ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[auto_1fr_140px_120px_36px] items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="w-4" />
              <span>Tarefa</span>
              <span>Responsável</span>
              <span>Prazo</span>
              <span />
            </div>
            {subtasks.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                Nenhuma subtarefa ainda. Use o campo acima para adicionar.
              </div>
            ) : (
              subtasks.map((t) => {
                const assignee = users.find((u) => u.id === t.assigneeId);
                const done = t.status === "concluida";
                const overdue = !done && new Date(t.dueDate).getTime() < Date.now();
                return (
                  <div
                    key={t.id}
                    className={`group grid grid-cols-[auto_1fr_140px_120px_36px] items-center gap-2 border-b border-border px-3 py-2 text-sm transition last:border-b-0 hover:bg-secondary/40 ${
                      done ? "bg-emerald-500/5" : ""
                    }`}
                  >
                    <button
                      onClick={() =>
                        updateTask(t.id, { status: done ? "pendente" : "concluida" })
                      }
                      className="text-muted-foreground transition hover:text-emerald-600"
                      title={done ? "Reabrir" : "Concluir"}
                    >
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Circle className="h-4 w-4" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className={`truncate font-medium ${done ? "text-muted-foreground line-through" : ""}`}>
                        {t.title}
                      </div>
                      {t.description && (
                        <div className="truncate text-[11px] text-muted-foreground">{t.description}</div>
                      )}
                    </div>
                    <select
                      value={t.assigneeId}
                      onChange={(e) => updateTask(t.id, { assigneeId: e.target.value })}
                      className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-primary"
                    >
                      {assignees.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name.split(" ")[0]}
                        </option>
                      ))}
                    </select>
                    <div className={`text-[11px] ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {new Date(t.dueDate).toLocaleDateString("pt-BR")}
                    </div>
                    <div className="text-muted-foreground">
                      {assignee && (
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                          title={assignee.name}
                        >
                          {assignee.avatar || assignee.name.slice(0, 1)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {statusColumns.map((col) => {
              const items = groupedByStatus[col.id];
              return (
                <div
                  key={col.id}
                  className={`flex flex-col rounded-xl border border-t-2 border-border bg-secondary/30 ${col.tone}`}
                >
                  <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>{col.label}</span>
                    <span className="rounded-full bg-background px-2 py-0.5 text-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 px-2 pb-3">
                    {items.length === 0 && (
                      <div className="rounded-md border border-dashed border-border px-2 py-4 text-center text-[11px] text-muted-foreground/70">
                        Vazio
                      </div>
                    )}
                    {items.map((t) => {
                      const assignee = users.find((u) => u.id === t.assigneeId);
                      const overdue =
                        t.status !== "concluida" && new Date(t.dueDate).getTime() < Date.now();
                      return (
                        <div
                          key={t.id}
                          className="group rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm transition hover:border-primary/50"
                        >
                          <div className="mb-1 flex items-start gap-2">
                            <button
                              onClick={() =>
                                updateTask(t.id, {
                                  status: t.status === "concluida" ? "pendente" : "concluida",
                                })
                              }
                              className="mt-0.5 text-muted-foreground hover:text-emerald-600"
                            >
                              {t.status === "concluida" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Circle className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <div
                              className={`flex-1 text-[13px] font-medium leading-snug ${
                                t.status === "concluida" ? "text-muted-foreground line-through" : ""
                              }`}
                            >
                              {t.title}
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className={overdue ? "font-semibold text-destructive" : ""}>
                              {new Date(t.dueDate).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                            {assignee && (
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
                                title={assignee.name}
                              >
                                {assignee.avatar || assignee.name.slice(0, 1)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Metric({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background/60 px-1.5 py-0.5 backdrop-blur">
      {icon}
      {label}
    </span>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* -------------------- Create project modal (guided) -------------------- */

interface CreateProjectPayload {
  name: string;
  description?: string;
  memberIds: string[];
  sector?: string;
  dueDate?: string;
  color?: string;
}

function CreateProjectModal({
  onClose,
  assignees,
  currentUserId,
  defaultSector,
  onCreate,
}: {
  onClose: () => void;
  assignees: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  defaultSector: string;
  onCreate: (payload: CreateProjectPayload) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sector, setSector] = useState(defaultSector);
  const [dueDate, setDueDate] = useState("");
  const [color, setColor] = useState(projectColorPalette[0]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canCreate = name.trim().length > 0;
  const filteredMembers = assignees
    .filter((u) => u.id !== currentUserId)
    .filter((u) =>
      memberQuery.trim()
        ? u.name.toLowerCase().includes(memberQuery.trim().toLowerCase())
        : true,
    );

  const submit = () => {
    if (!canCreate) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      memberIds,
      sector,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      color,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — color strip + solid card for legible inputs */}
        <div className="relative border-b border-border">
          <div className="h-2 w-full" style={{ background: color }} />
          <div className="flex items-start justify-between gap-3 px-6 py-5">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: color }}
                />
                Novo projeto
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Nome
                </label>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                  placeholder="Ex.: Reestruturação do fluxo comercial"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xl font-semibold tracking-tight text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Descrição
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva o objetivo, escopo ou contexto do projeto…"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="grid gap-5 px-6 py-5">
          {/* Color */}
          <Field label="Cor do projeto" hint="Ajuda a identificar rapidamente na lista.">
            <div className="flex flex-wrap gap-2">
              {projectColorPalette.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-card transition ${
                    color === c ? "ring-foreground" : "ring-transparent"
                  }`}
                  style={{ background: c }}
                  aria-label="Cor"
                />
              ))}
            </div>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Setor" icon={<Flag className="h-3 w-3" />}>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prazo previsto" icon={<Calendar className="h-3 w-3" />}>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </Field>
          </div>

          {/* Members */}
          <Field
            label={`Participantes${memberIds.length ? ` · ${memberIds.length} selecionado${memberIds.length === 1 ? "" : "s"}` : ""}`}
            icon={<Users className="h-3 w-3" />}
            hint="Você é adicionado automaticamente como responsável."
          >
            <div className="rounded-md border border-border bg-background">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Buscar pessoa…"
                    className="w-full rounded-md bg-secondary/40 py-1.5 pl-7 pr-2 text-xs outline-none focus:bg-secondary"
                  />
                </div>
                {memberIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {memberIds.map((id) => {
                      const u = assignees.find((x) => x.id === id);
                      if (!u) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/15 py-0.5 pl-1 pr-2 text-[11px] text-primary"
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                            {u.avatar || u.name.slice(0, 1)}
                          </span>
                          {u.name.split(" ")[0]}
                          <button
                            type="button"
                            onClick={() => setMemberIds((m) => m.filter((x) => x !== id))}
                            className="ml-0.5 opacity-60 hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto p-1">
                {filteredMembers.length === 0 && (
                  <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                    Nenhuma pessoa encontrada.
                  </div>
                )}
                {filteredMembers.map((u) => {
                  const on = memberIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() =>
                        setMemberIds((m) => (on ? m.filter((x) => x !== u.id) : [...m, u.id]))
                      }
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                        on ? "bg-primary/10 text-foreground" : "hover:bg-secondary"
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {u.avatar || u.name.slice(0, 1)}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-[10px] text-muted-foreground">{u.jobTitle}</div>
                      </div>
                      {on ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/40 px-6 py-3">
          <span className="text-[11px] text-muted-foreground">
            <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[10px]">⌘</kbd>{" "}
            <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[10px]">Enter</kbd>{" "}
            para criar
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!canCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Criar projeto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}