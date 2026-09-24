import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
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
  CalendarClock,
  Camera,
  ImagePlus,
  Search,
  Sparkles,
  ChevronRight,
  Target,
  Share2,
  Copy,
  Check,
  AtSign,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";

import { FluxoLayout } from "@/components/fluxo-layout";
import { ProjectTracking } from "@/components/project-tracking";
import { ProjectPortfolio } from "@/components/project-portfolio";
import { CampoData } from "@/components/campo-data";
import { useFluxo } from "@/lib/fluxo-store";
import type { CompletionEntry, ProjectStatus, Status } from "@/lib/fluxo-types";
import {
  forecastProject,
  prazoDoProjeto,
  riskLabels,
  type RiskLevel,
} from "@/lib/project-forecast";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { etiquetasDoProjeto } from "@/lib/etiquetas-do-projeto";
import { reduzirFoto } from "@/lib/foto-reduzida";
import { SeletorDeCor } from "@/components/seletor-de-cor";

type ProjectView = "lista" | "board" | "acompanhamento";

/** Cor do selo de risco na lista lateral — leitura de relance. */
const riskBadge: Record<RiskLevel, string> = {
  concluido: "bg-primary/15 text-primary",
  no_prazo: "bg-success/15 text-success",
  atencao: "bg-warning/15 text-warning",
  atrasado: "bg-destructive/15 text-destructive",
  parado: "bg-muted text-muted-foreground",
  sem_prazo: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute("/projetos")({
  /* `?projeto=<id>`: o aviso "te adicionou a um projeto" abre direto nele. */
  validateSearch: (s: Record<string, unknown>): { projeto?: string } =>
    typeof s.projeto === "string" && /^[0-9a-f-]{36}$/i.test(s.projeto)
      ? { projeto: s.projeto }
      : {},
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

/* As oito primeiras são as originais, na mesma ordem — projetos já criados
   continuam com a cor deles e a primeira segue sendo a padrão. As novas
   preenchem os buracos do círculo (lima, céu, violeta, rosa) e somam tons
   fechados e neutros, para dois projetos do mesmo setor não precisarem
   dividir a cor. */
const projectColorPalette = [
  "oklch(0.62 0.16 155)",
  "oklch(0.62 0.16 230)",
  "oklch(0.6 0.2 330)",
  "oklch(0.78 0.15 75)",
  "oklch(0.52 0.22 275)",
  "oklch(0.58 0.22 25)",
  "oklch(0.7 0.15 190)",
  "oklch(0.65 0.2 45)",
  "oklch(0.74 0.19 130)",
  "oklch(0.7 0.13 245)",
  "oklch(0.6 0.2 300)",
  "oklch(0.68 0.2 0)",
  "oklch(0.84 0.16 95)",
  "oklch(0.5 0.13 160)",
  "oklch(0.45 0.13 260)",
  "oklch(0.55 0.1 55)",
  "oklch(0.5 0.17 10)",
  "oklch(0.6 0.03 260)",
];

/**
 * Quem participa do projeto: o dono e os membros, eu primeiro.
 *
 * É a lista de quem pode receber subtarefa. Antes o seletor mostrava a empresa
 * inteira, e dava para jogar tarefa do projeto em quem nem estava nele.
 */
function participantesDoProjeto(
  projeto: { ownerId: string; memberIds: string[] },
  users: ReturnType<typeof useFluxo>["users"],
  primeiroId?: string,
) {
  const ids = new Set([projeto.ownerId, ...projeto.memberIds]);
  const lista = users.filter((u) => ids.has(u.id));
  return primeiroId
    ? [...lista.filter((u) => u.id === primeiroId), ...lista.filter((u) => u.id !== primeiroId)]
    : lista;
}

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
    setProjectPhoto,
    deleteProject,
    createTask,
    updateTask,
    openTask,
    users,
    currentUser,
    completions,
  } = useFluxo();

  // Todos da empresa podem ser chamados / atribuídos — sem limite por setor.
  const assignees = useMemo(() => {
    const me = users.find((u) => u.id === currentUser.id);
    const others = users.filter((u) => u.id !== currentUser.id);
    return me ? [me, ...others] : others;
  }, [users, currentUser.id]);
  const projects = visibleProjects();
  const [selectedId, setSelectedId] = useState<string | null>(projects[0]?.id ?? null);
  const [topView, setTopView] = useState<"portfolio" | "detalhe">("portfolio");

  /* Veio de um aviso de projeto: abre ele. Pelo efeito, e não só no estado
     inicial, por dois motivos — clicar no aviso com a tela de Projetos já
     aberta não remonta a página, e o projeto pode chegar um instante depois,
     quando a releitura disparada pelo aviso responde. */
  const { projeto: projetoDaUrl } = Route.useSearch();
  const projetoPedido = projetoDaUrl
    ? projects.find((p) => p.id.toLowerCase() === projetoDaUrl.toLowerCase())?.id
    : undefined;
  useEffect(() => {
    if (!projetoPedido) return;
    setSelectedId(projetoPedido);
    setTopView("detalhe");
  }, [projetoPedido]);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "todos">("todos");
  const [view, setView] = useState<ProjectView>("lista");
  const [quickTitle, setQuickTitle] = useState("");
  /* A observação nasce junto com a subtarefa. Sem este campo ela só podia ser
     escrita depois, abrindo a tarefa em "Minhas tarefas" — a criação no projeto
     não tinha onde digitá-la. */
  const [quickDescription, setQuickDescription] = useState("");
  const [quickAssignee, setQuickAssignee] = useState(currentUser.id);
  const [quickDate, setQuickDate] = useState("");
  const [quickMentions, setQuickMentions] = useState<string[]>([]);
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
    // Só quem participa do projeto recebe subtarefa; um valor que ficou de outro
    // projeto (a lista muda ao trocar) cai no dono.
    const participante = participantesDoProjeto(selected, users).find((u) => u.id === quickAssignee);
    const assignee =
      participante ?? users.find((u) => u.id === selected.ownerId) ?? currentUser;
    // isoParaData e não new Date("yyyy-MM-dd"): esse é meia-noite UTC, que no
    // Brasil ainda é o dia anterior — e o setHours abaixo fixava o prazo nele.
    const due = isoParaData(quickDate) ?? new Date(Date.now() + 3 * 24 * 3600e3);
    due.setHours(23, 59, 0, 0);
    const mentionSet = new Set<string>(quickMentions);
    if (assignee.id !== currentUser.id) mentionSet.add(assignee.id);
    mentionSet.delete(currentUser.id);
    createTask({
      title: quickTitle.trim(),
      description: quickDescription.trim() || undefined,
      sector: assignee.sector,
      createdBy: currentUser.id,
      assigneeId: assignee.id,
      mentions: Array.from(mentionSet),
      frequency: "diaria",
      status: "pendente",
      score: 15,
      dueDate: due.toISOString(),
      recurring: false,
      priority: "media",
      // A mesma regra que o servidor aplica — ver `etiquetasDoProjeto`.
      tags: etiquetasDoProjeto(selected.name),
      projectId: selected.id,
    });
    setQuickTitle("");
    setQuickDescription("");
    setQuickDate("");
    setQuickMentions([]);
    quickInputRef.current?.focus();
  };

  return (
    <FluxoLayout title="Projetos" breadcrumb="Execução">
      <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-4 py-2">
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
            {/* Seletor de visão: portfólio (global) x detalhe (por projeto) */}
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
              <button
                onClick={() => setTopView("portfolio")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  topView === "portfolio"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                Portfólio
              </button>
              <button
                onClick={() => setTopView("detalhe")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  topView === "detalhe"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ListIcon className="h-3.5 w-3.5" />
                Projetos
              </button>
            </div>
            {topView === "detalhe" && (
              <>
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
              </>
            )}
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo projeto
            </button>
          </div>
        </header>

        {topView === "portfolio" ? (
          <ProjectPortfolio
            projects={projects}
            getTasks={projectTasks}
            completions={completions}
            users={users}
            onOpen={(id) => {
              setSelectedId(id);
              setTopView("detalhe");
            }}
          />
        ) : (
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
              const risk = forecastProject(p, tasks, completions).risk;
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
                    <span className={`rounded-full px-1.5 py-[1px] font-semibold ${riskBadge[risk]}`}>
                      {riskLabels[risk]}
                    </span>
                    <span>
                      {done}/{tasks.length}
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
                completions={completions}
                updateProject={updateProject}
                updateTask={updateTask}
                openTask={openTask}
                deleteProject={(id) => {
                  deleteProject(id);
                  setSelectedId(null);
                }}
                quickTitle={quickTitle}
                setQuickTitle={setQuickTitle}
                quickDescription={quickDescription}
                setQuickDescription={setQuickDescription}
                quickAssignee={quickAssignee}
                setQuickAssignee={setQuickAssignee}
                quickDate={quickDate}
                setQuickDate={setQuickDate}
                quickMentions={quickMentions}
                setQuickMentions={setQuickMentions}
                onQuickAdd={handleQuickAdd}
                quickInputRef={quickInputRef}
              />
            )}
          </section>
        </div>
        )}
      </div>

      {createOpen && (
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          assignees={assignees}
          currentUserId={currentUser.id}
          onCreate={({ photo, ...payload }) => {
            const id = createProject({
              ...payload,
              status: "ativo",
              ownerId: currentUser.id,
            });
            // Depois de criar: a foto é um anexo do projeto e precisa do id dele.
            if (photo) setProjectPhoto(id, photo);
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
  view: ProjectView;
  setView: (v: ProjectView) => void;
  completions: CompletionEntry[];
  updateProject: ReturnType<typeof useFluxo>["updateProject"];
  updateTask: ReturnType<typeof useFluxo>["updateTask"];
  openTask: ReturnType<typeof useFluxo>["openTask"];
  deleteProject: (id: string) => void;
  quickTitle: string;
  setQuickTitle: (v: string) => void;
  quickDescription: string;
  setQuickDescription: (v: string) => void;
  quickAssignee: string;
  setQuickAssignee: (v: string) => void;
  quickDate: string;
  setQuickDate: (v: string) => void;
  quickMentions: string[];
  setQuickMentions: (v: string[]) => void;
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
  completions,
  updateProject,
  updateTask,
  openTask,
  deleteProject,
  quickTitle,
  setQuickTitle,
  quickDescription,
  setQuickDescription,
  quickAssignee,
  setQuickAssignee,
  quickDate,
  setQuickDate,
  quickMentions,
  setQuickMentions,
  onQuickAdd,
  quickInputRef,
}: ProjectDetailProps) {
  const isOwner = selected.ownerId === currentUserId;
  const { setProjectPhoto } = useFluxo();
  const participantes = useMemo(
    () => participantesDoProjeto(selected, users, currentUserId),
    [selected, users, currentUserId],
  );
  /* O responsável escolhido precisa estar no projeto aberto. Ele é guardado
     fora deste componente e sobrevive à troca de projeto: sem isto, o select
     mostraria a primeira opção enquanto a subtarefa iria para outra pessoa. */
  useEffect(() => {
    if (participantes.length > 0 && !participantes.some((u) => u.id === quickAssignee)) {
      setQuickAssignee(participantes[0]!.id);
    }
  }, [participantes, quickAssignee, setQuickAssignee]);
  const [shareOpen, setShareOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<Status | null>(null);
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
        className="relative overflow-hidden rounded-t-2xl border-b border-border bg-card px-6 py-5"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5"
          style={{ background: selected.color ?? "var(--primary)" }}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <EscolherFoto
                url={selected.photoUrl}
                cor={selected.color}
                tamanho={44}
                podeEditar={isOwner}
                aoEscolher={(foto) => setProjectPhoto(selected.id, foto)}
                aoRemover={() => setProjectPhoto(selected.id, null)}
              />
              <input
                value={selected.name}
                onChange={(e) => updateProject(selected.id, { name: e.target.value })}
                disabled={!isOwner}
                className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default"
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
              className="mt-2 w-full resize-none bg-transparent text-sm text-foreground/80 outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <Metric icon={<Target className="h-3 w-3" />} label={`${progress}% concluído`} />
              <Metric
                icon={<CheckCircle2 className="h-3 w-3" />}
                label={`${doneCount}/${subtasks.length} tarefas`}
              />
              {/* Conta o conjunto dono + membros. Era `membros + 1`, e o banco
                  já devolve o dono entre os membros: recarregado, o projeto de
                  três pessoas dizia quatro. */}
              <Metric
                icon={<Users className="h-3 w-3" />}
                label={`${participantes.length} pessoa${participantes.length === 1 ? "" : "s"}`}
              />
              {prazoDoProjeto(selected.dueDate) && (
                <Metric
                  icon={<Calendar className="h-3 w-3" />}
                  label={`Prazo ${prazoDoProjeto(selected.dueDate)!.toLocaleDateString("pt-BR")}`}
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2.5 py-1.5 text-[11px] font-semibold text-foreground backdrop-blur hover:border-primary hover:text-primary"
              title="Compartilhar projeto com colaboradores"
            >
              <Share2 className="h-3.5 w-3.5" />
              Compartilhar
            </button>
            {isOwner && (
              <button
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: "Excluir este projeto?",
                    descricao: `"${selected.name}" some, mas as subtarefas não: elas viram tarefas normais e continuam com seus responsáveis.`,
                    confirmar: "Excluir projeto",
                    perigo: true,
                  });
                  if (!ok) return;
                  deleteProject(selected.id);
                  toast.success("Projeto excluído");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur hover:border-destructive/50 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
                Excluir
              </button>
            )}
          </div>
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
          <TabBtn
            active={view === "acompanhamento"}
            onClick={() => setView("acompanhamento")}
            icon={<TrendingUp className="h-3.5 w-3.5" />}
          >
            Acompanhamento
          </TabBtn>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Cada subtarefa aparece em <b className="text-foreground">Minhas tarefas</b> da pessoa responsável.
        </span>
      </div>

      <div className="p-4">
        {/* Quick add row (Asana-style) — fora do acompanhamento, que é só leitura. */}
        {view !== "acompanhamento" && (
        <div className="relative mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 px-3 py-2 focus-within:border-primary focus-within:bg-secondary/70">
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
          <div className="relative">
            <button
              type="button"
              onClick={() => setMentionOpen((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                quickMentions.length > 0
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/60 hover:text-foreground"
              }`}
              title="Mencionar pessoas nesta tarefa"
            >
              <AtSign className="h-3 w-3" />
              {quickMentions.length > 0 ? `${quickMentions.length} menção${quickMentions.length === 1 ? "" : "s"}` : "Mencionar"}
            </button>
            {mentionOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMentionOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                  <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Mencionar na tarefa
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {users
                      .filter((u) => u.id !== currentUserId)
                      .map((u) => {
                        const on = quickMentions.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() =>
                              setQuickMentions(
                                on
                                  ? quickMentions.filter((x) => x !== u.id)
                                  : [...quickMentions, u.id],
                              )
                            }
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                              on ? "bg-primary/10 text-foreground" : "hover:bg-secondary"
                            }`}
                          >
                            <UserAvatar nome={u.name} iniciais={u.avatar} className="h-6 w-6 shrink-0 text-[10px]" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{u.name}</div>
                              <div className="truncate text-[10px] text-muted-foreground">{u.jobTitle}</div>
                            </div>
                            {on && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                          </button>
                        );
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
          <select
            value={quickAssignee}
            onChange={(e) => setQuickAssignee(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
            title="Responsável (só quem participa do projeto)"
          >
            {participantes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <CampoData
            value={quickDate}
            onChange={setQuickDate}
            placeholder="Prazo"
            title="Prazo"
            className="py-1 text-[11px]"
          />
          <button
            onClick={onQuickAdd}
            disabled={!quickTitle.trim()}
            className="rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-40 hover:brightness-110"
          >
            Adicionar
          </button>
          {/* Linha própria (`basis-full`): a observação costuma ter mais de uma
              frase, e espremida ao lado do título não daria para ler. Enter
              aqui quebra a linha, como em qualquer texto longo; Ctrl+Enter
              adiciona, como o Enter do título. */}
          <textarea
            value={quickDescription}
            onChange={(e) => setQuickDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onQuickAdd();
              }
            }}
            placeholder="Observação (opcional) — Ctrl+Enter para salvar"
            rows={1}
            className="basis-full resize-y rounded-md border border-border bg-background px-2 py-1 text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
        )}

        {view === "acompanhamento" ? (
          <ProjectTracking
            project={selected}
            tasks={subtasks}
            completions={completions}
            users={users}
          />
        ) : view === "lista" ? (
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
                    {/* Abre o painel da tarefa aqui mesmo: editar a observação
                        (ou qualquer outro campo) de uma subtarefa exigia ir até
                        "Minhas tarefas" e procurá-la lá. */}
                    <button
                      type="button"
                      onClick={() => openTask(t.id)}
                      className="min-w-0 text-left"
                      title="Abrir a tarefa"
                    >
                      <div
                        className={`truncate font-medium hover:text-primary ${
                          done ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        {t.title}
                      </div>
                      {t.description && (
                        <div className="truncate text-[11px] text-muted-foreground">{t.description}</div>
                      )}
                    </button>
                    <select
                      value={t.assigneeId}
                      onChange={(e) => updateTask(t.id, { assigneeId: e.target.value })}
                      className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] outline-none hover:border-border focus:border-primary"
                    >
                      {/* Os participantes, mais o responsável atual se ele
                          tiver saído do projeto — senão o select mostraria
                          outra pessoa no lugar de quem de fato tem a tarefa. */}
                      {(participantes.some((u) => u.id === t.assigneeId) || !assignee
                        ? participantes
                        : [...participantes, assignee]
                      ).map((u) => (
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
                        <UserAvatar
                          nome={assignee.name}
                          iniciais={assignee.avatar}
                          title={assignee.name}
                          className="h-6 w-6 shrink-0 text-[10px]"
                        />
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
              const isHover = hoverCol === col.id;
              return (
                <div
                  key={col.id}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setHoverCol(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget === e.target) setHoverCol((h) => (h === col.id ? null : h));
                  }}
                  onDrop={() => {
                    if (dragId) {
                      updateTask(dragId, { status: col.id });
                    }
                    setDragId(null);
                    setHoverCol(null);
                  }}
                  className={`flex flex-col rounded-xl border border-t-2 bg-secondary/30 transition ${col.tone} ${
                    isHover ? "border-primary bg-primary/5 ring-2 ring-primary/40" : "border-border"
                  }`}
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
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", t.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(t.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setHoverCol(null);
                          }}
                          className={`group cursor-grab rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm transition hover:border-primary/50 active:cursor-grabbing ${
                            dragId === t.id ? "opacity-40" : ""
                          }`}
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
                            <button
                              type="button"
                              onClick={() => openTask(t.id)}
                              title="Abrir a tarefa"
                              className={`flex-1 text-left text-[13px] font-medium leading-snug hover:text-primary ${
                                t.status === "concluida" ? "text-muted-foreground line-through" : ""
                              }`}
                            >
                              {t.title}
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className={overdue ? "font-semibold text-destructive" : ""}>
                              {new Date(t.dueDate).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                              })}
                            </span>
                            {assignee && (
                              <UserAvatar
                                nome={assignee.name}
                                iniciais={assignee.avatar}
                                title={assignee.name}
                                className="h-5 w-5 shrink-0 text-[9px]"
                              />
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
      {shareOpen && (
        <ShareProjectModal
          project={selected}
          assignees={assignees}
          users={users}
          currentUserId={currentUserId}
          isOwner={isOwner}
          onClose={() => setShareOpen(false)}
          onChange={(memberIds) => updateProject(selected.id, { memberIds })}
        />
      )}
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
  photo?: { name: string; type: string; dataUrl: string };
}

function CreateProjectModal({
  onClose,
  assignees,
  currentUserId,
  onCreate,
}: {
  onClose: () => void;
  assignees: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  onCreate: (payload: CreateProjectPayload) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [color, setColor] = useState(projectColorPalette[0]!);
  const [photo, setPhoto] = useState<CreateProjectPayload["photo"]>();
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
      // Fim do dia LOCAL. `new Date("yyyy-MM-dd")` é meia-noite UTC — no Brasil,
      // o dia anterior — e o projeto aparecia com prazo um dia antes.
      dueDate: dueDate ? fimDoDia(dueDate)?.toISOString() : undefined,
      color,
      photo,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <TravaScroll />
      {/* Teto de altura com o miolo rolando: com o bloco de prazo maior, o modal
          passa da altura de uma tela de notebook, e o rodapé com "Criar projeto"
          ficaria fora de alcance. */}
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        style={{ maxHeight: "calc(100vh - var(--titlebar-h, 0px) - 2rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — color strip + solid card for legible inputs */}
        <div className="relative shrink-0 border-b border-border">
          <div className="h-2 w-full" style={{ background: color }} />
          <div className="flex items-start justify-between gap-4 px-6 py-5">
            {/* A "cara" do projeto, ao lado do nome — é o que identifica o
                projeto nos cartões das subtarefas. */}
            <div className="mt-6">
              <EscolherFoto
                url={photo?.dataUrl}
                cor={color}
                tamanho={96}
                podeEditar
                rotulo="Foto do projeto"
                aoEscolher={setPhoto}
                aoRemover={() => setPhoto(undefined)}
              />
            </div>
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
        <div className="grid min-h-0 gap-5 overflow-y-auto px-6 py-5">
          {/* Color */}
          <Field label="Cor do projeto" hint="Ajuda a identificar rapidamente na lista.">
            {/* Duas fileiras de nove: as 18 cores em flex-wrap deixavam uma
                sozinha na segunda linha. A personalizada fica à parte, depois
                de um divisor — é outro jeito de escolher, não mais uma cor. */}
            <div className="flex items-center gap-3">
            <div className="grid w-fit grid-cols-9 gap-2">
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
            <span className="h-14 w-px shrink-0 bg-border" aria-hidden />
            <div className="flex flex-col items-center gap-1">
              <SeletorDeCor
                valor={color}
                aoMudar={setColor}
                personalizada={!projectColorPalette.includes(color)}
              />
              <span className="text-[10px] text-muted-foreground">Personalizar</span>
            </div>
            </div>
          </Field>

          <PrazoPrevisto value={dueDate} onChange={setDueDate} color={color} />

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
                          <UserAvatar nome={u.name} iniciais={u.avatar} className="h-4 w-4 shrink-0 text-[9px]" />
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
                      <UserAvatar nome={u.name} iniciais={u.avatar} className="h-6 w-6 shrink-0 text-[10px]" />
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
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-secondary/40 px-6 py-3">
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

/**
 * A foto do projeto — a "cara" dele — com o botão de trocar.
 *
 * Sem foto, mostra o ícone de pasta na cor do projeto, como era; quem pode
 * editar vê a câmera ao passar o mouse. A imagem é reduzida antes de subir
 * (ver `reduzirFoto`): ela vira miniatura nos cartões de todo mundo.
 */
function EscolherFoto({
  url,
  cor,
  tamanho,
  podeEditar,
  aoEscolher,
  aoRemover,
  rotulo,
}: {
  url?: string;
  cor?: string;
  tamanho: number;
  podeEditar: boolean;
  aoEscolher: (foto: { name: string; type: string; dataUrl: string }) => void;
  aoRemover: () => void;
  /** Texto embaixo do ícone quando ainda não há foto (usado no modal). */
  rotulo?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const fundo = cor ?? "var(--primary)";

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setLendo(true);
    try {
      aoEscolher(await reduzirFoto(arquivo));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendo(false);
    }
  };

  return (
    <div className="group relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <button
        type="button"
        disabled={!podeEditar || lendo}
        onClick={() => inputRef.current?.click()}
        title={podeEditar ? (url ? "Trocar a foto do projeto" : "Adicionar uma foto ao projeto") : undefined}
        aria-label={url ? "Trocar a foto do projeto" : "Adicionar uma foto ao projeto"}
        className={`flex h-full w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-xl text-white transition disabled:cursor-default ${
          !url && rotulo ? "border-2 border-dashed" : ""
        }`}
        style={
          url
            ? undefined
            : rotulo
              ? {
                  borderColor: `color-mix(in oklab, ${fundo} 55%, transparent)`,
                  background: `color-mix(in oklab, ${fundo} 12%, transparent)`,
                  color: fundo,
                }
              : { background: fundo }
        }
      >
        {url ? (
          <img src={url} alt="Foto do projeto" className="h-full w-full object-cover" />
        ) : rotulo ? (
          <>
            <ImagePlus className="h-6 w-6" />
            <span className="px-1 text-center text-[10px] font-semibold leading-tight">{rotulo}</span>
          </>
        ) : (
          <FolderKanban className="h-5 w-5" />
        )}
        {podeEditar && (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 opacity-0 transition group-hover:opacity-100">
            <Camera className="h-5 w-5 text-white" />
          </span>
        )}
      </button>
      {podeEditar && url && (
        <button
          type="button"
          onClick={aoRemover}
          title="Tirar a foto"
          aria-label="Tirar a foto do projeto"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow transition hover:text-destructive group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void escolher(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** "yyyy-MM-dd" → fim desse dia no fuso local. */
function fimDoDia(iso: string): Date | undefined {
  const d = isoParaData(iso);
  d?.setHours(23, 59, 59, 0);
  return d;
}

/**
 * O prazo do projeto, em destaque.
 *
 * Era um campo de data do tamanho de um input comum, no meio do formulário, e
 * as pessoas criavam o projeto sem ver que ele existia — sem prazo, o
 * acompanhamento não tem com o que comparar o ritmo e o projeto nasce "Sem
 * prazo". Aqui ele vira um bloco com a data por extenso, quanto falta, e
 * atalhos para os prazos mais comuns. Sem prazo, o bloco fica tracejado e
 * pede a data com um aviso.
 */
function PrazoPrevisto({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (iso: string) => void;
  color: string;
}) {
  const data = isoParaData(value);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = data ? Math.round((data.getTime() - hoje.getTime()) / 86_400_000) : null;
  const falta =
    dias === null
      ? ""
      : dias < 0
        ? `Já passou há ${-dias} dia${dias === -1 ? "" : "s"}`
        : dias === 0
          ? "A entrega é hoje"
          : dias === 1
            ? "A entrega é amanhã"
            : `Faltam ${dias} dias para a entrega`;
  // Só a primeira letra: `capitalize` do CSS subiria todas ("15 De Outubro De").
  const porExtenso = data
    ? (() => {
        const s = data.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";

  const somar = (fn: (d: Date) => void) => {
    const d = new Date(hoje);
    fn(d);
    onChange(dataParaIso(d));
  };
  const atalhos: { rotulo: string; aplicar: () => void }[] = [
    { rotulo: "+1 semana", aplicar: () => somar((d) => d.setDate(d.getDate() + 7)) },
    { rotulo: "+15 dias", aplicar: () => somar((d) => d.setDate(d.getDate() + 15)) },
    { rotulo: "+1 mês", aplicar: () => somar((d) => d.setMonth(d.getMonth() + 1)) },
    { rotulo: "+3 meses", aplicar: () => somar((d) => d.setMonth(d.getMonth() + 3)) },
    { rotulo: "Fim do mês", aplicar: () => somar((d) => d.setMonth(d.getMonth() + 1, 0)) },
  ];

  return (
    <div
      className={`rounded-xl border-2 p-4 transition ${data ? "border-solid" : "border-dashed"}`}
      style={{
        borderColor: `color-mix(in oklab, ${color} ${data ? 55 : 40}%, transparent)`,
        background: `color-mix(in oklab, ${color} 7%, transparent)`,
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in oklab, ${color} 20%, transparent)`, color }}
        >
          <CalendarClock className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prazo previsto
          </div>
          {data ? (
            <>
              <div className="text-lg font-semibold leading-tight text-foreground">{porExtenso}</div>
              <div className={`text-xs ${dias !== null && dias < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {falta}
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold leading-tight text-foreground">
                Sem prazo definido
              </div>
              <div className="text-xs text-warning">
                Sem prazo, o acompanhamento não consegue dizer se o projeto vai atrasar.
              </div>
            </>
          )}
        </div>
        <CampoData
          value={value}
          onChange={onChange}
          formato="longo"
          placeholder="Escolher data"
          title="Escolher o prazo no calendário"
          className="h-10 shrink-0 rounded-lg px-3 text-sm font-semibold"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {atalhos.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={a.aplicar}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary"
          >
            {a.rotulo}
          </button>
        ))}
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

/* -------------------- Share project modal -------------------- */

function ShareProjectModal({
  project,
  assignees,
  users,
  currentUserId,
  isOwner,
  onClose,
  onChange,
}: {
  project: ReturnType<ReturnType<typeof useFluxo>["visibleProjects"]>[number];
  assignees: ReturnType<typeof useFluxo>["users"];
  users: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  isOwner: boolean;
  onClose: () => void;
  onChange: (memberIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const owner = users.find((u) => u.id === project.ownerId);
  const members = project.memberIds
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u));

  const candidates = assignees
    .filter((u) => u.id !== project.ownerId && !project.memberIds.includes(u.id))
    .filter((u) =>
      query.trim() ? u.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
    );

  const canEdit = isOwner || project.memberIds.includes(currentUserId);

  const add = (id: string) => onChange([...project.memberIds, id]);
  const remove = (id: string) => onChange(project.memberIds.filter((x) => x !== id));

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/projetos?p=${project.id}`
      : `/projetos?p=${project.id}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      toast.success("Link copiado", { description: "Envie para quem vai colaborar." });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <TravaScroll />
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Compartilhar projeto
            </div>
            <h3 className="truncate text-lg font-semibold text-foreground">{project.name}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Colaboradores têm acesso completo — subtarefas, quadro, comentários e edição.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* Share link */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Link do projeto
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareLink}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>

          {/* Members list */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Com acesso</span>
              <span>{members.length + 1} pessoa{members.length === 0 ? "" : "s"}</span>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {owner && (
                <MemberRow
                  name={owner.name}
                  job={owner.jobTitle}
                  avatar={owner.avatar || owner.name.slice(0, 1)}
                  role="Responsável"
                />
              )}
              {members.map((u) => (
                <MemberRow
                  key={u.id}
                  name={u.name}
                  job={u.jobTitle}
                  avatar={u.avatar || u.name.slice(0, 1)}
                  role="Colaborador"
                  onRemove={canEdit ? () => remove(u.id) : undefined}
                />
              ))}
            </div>
          </div>

          {/* Add people */}
          {canEdit && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Adicionar pessoas
              </div>
              <div className="rounded-md border border-border bg-background">
                <div className="border-b border-border p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar por nome…"
                      className="w-full rounded-md bg-secondary/40 py-1.5 pl-7 pr-2 text-xs text-foreground outline-none focus:bg-secondary"
                    />
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {candidates.length === 0 ? (
                    <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                      Todo mundo já tem acesso.
                    </div>
                  ) : (
                    candidates.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => add(u.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary"
                      >
                        <UserAvatar nome={u.name} iniciais={u.avatar} className="h-7 w-7 shrink-0 text-[10px]" />
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{u.name}</div>
                          <div className="text-[10px] text-muted-foreground">{u.jobTitle}</div>
                        </div>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border bg-secondary/40 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  name,
  job,
  avatar,
  role,
  onRemove,
}: {
  name: string;
  job: string;
  /** Só as iniciais. A foto o `UserAvatar` resolve pelo nome. */
  avatar: string;
  role: string;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-background px-3 py-2 text-xs">
      <UserAvatar nome={name} iniciais={avatar} className="h-8 w-8 shrink-0 text-[11px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{job}</div>
      </div>
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        {role}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Remover acesso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}