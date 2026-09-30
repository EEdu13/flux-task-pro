import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Check,
  CheckCircle2,
  CheckSquare,
  Flame,
  Clock,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Repeat,
  Star,
  Sparkles,
  Play,
  Timer,
  Wand2,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  ArrowRight,
  Undo2,
  GripVertical,
  CalendarCheck,
  X,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  acessibilidadeDoArraste,
  idDaColuna,
  Levantado,
  LinhaArrastavel,
  LinhaNaMao,
  NoTopo,
  POUSO,
  RemedirAoMudar,
  useAcoesEstaveis,
  useArrasteDeLinhas,
  useArrasteEntreColunas,
  type Arranjo,
} from "@/components/arraste";
import { EtiquetasDaTarefa, PilulasDeEtiqueta } from "@/components/etiquetas-da-tarefa";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";

import { MyView } from "@/components/my-view";
import { formatDueBucket } from "@/lib/use-theme";
import { concluidaHoje, noPackDeHoje } from "@/lib/pack";
import { focusSummaryToday } from "@/lib/focus-log";
import { startFocus } from "@/components/focus-overlay";
import { TaskTimerControls } from "@/components/task-timer-controls";
import { UserAvatar } from "@/components/user-avatar";
import { CampoData } from "@/components/campo-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { FiltroPessoa } from "@/components/filtro-pessoa";
import { toast } from "sonner";
import {
  freqLabels,
  sectors,
  statusColor,
  statusLabels,
  type Frequency,
  type Priority,
  type Status,
  type Task,
} from "@/lib/fluxo-types";
import { SeloDoProjeto } from "@/components/selo-do-projeto";
import { comCerquilha } from "@/lib/etiquetas-do-projeto";
import {
  estiloDoCartaoDoProjeto,
  useEtiquetasDoCartao,
  useProjetoDaTarefa,
} from "@/lib/projeto-da-tarefa";
import { semAcento } from "@/lib/texto-busca";
import { SEM_PRAZO, porPrazo, prazoMs, prazoVencido, rotuloDoPrazo } from "@/lib/prazo";

export const Route = createFileRoute("/minhas-tarefas")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? (search.q as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Minhas tarefas · SGL - CONECTA" },
      { name: "description", content: "Kanban e lista de tarefas com filtros por responsável, prioridade e prazo." },
    ],
  }),
  component: MinhasTarefas,
});

type Scope = "todas" | "atribuidas" | "criadas" | "mencionadas" | "pack";
type ViewMode = "quadro" | "lista" | "minha-visao";
type DatePreset =
  | "todas"
  | "ontem"
  | "hoje"
  | "amanha"
  | "esta-semana"
  | "prox-semana"
  | "este-mes"
  | "entre";

const datePresetLabels: Record<DatePreset, string> = {
  todas: "Qualquer data",
  ontem: "Ontem",
  hoje: "Hoje",
  amanha: "Amanhã",
  "esta-semana": "Esta semana",
  "prox-semana": "Semana que vem",
  "este-mes": "Este mês",
  entre: "Entre datas…",
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=dom
  const diff = (day + 6) % 7; // segunda=0
  x.setDate(x.getDate() - diff);
  return x;
}
function dateRangeFor(preset: DatePreset, from?: string, to?: string): [number, number] | null {
  const now = new Date();
  if (preset === "todas") return null;
  if (preset === "hoje") return [startOfDay(now).getTime(), endOfDay(now).getTime()];
  if (preset === "ontem") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "amanha") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "esta-semana") {
    const s = startOfWeek(now);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return [s.getTime(), endOfDay(e).getTime()];
  }
  if (preset === "prox-semana") {
    const s = startOfWeek(now);
    s.setDate(s.getDate() + 7);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return [s.getTime(), endOfDay(e).getTime()];
  }
  if (preset === "este-mes") {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return [startOfDay(s).getTime(), endOfDay(e).getTime()];
  }
  if (preset === "entre") {
    if (!from && !to) return null;
    const s = from ? startOfDay(new Date(from)).getTime() : -Infinity;
    const e = to ? endOfDay(new Date(to)).getTime() : Infinity;
    return [s, e];
  }
  return null;
}

const scopeLabels: Record<Scope, string> = {
  pack: "Meu pack",
  atribuidas: "Atribuídas a mim",
  criadas: "Criadas por mim",
  mencionadas: "Mencionaram-me",
  todas: "Todas visíveis",
};

function MinhasTarefas() {
  const { tasks, users, currentUser, updateTask, moveTask, openNewTask, openTask } = useFluxo();
  const { q: initialQ } = Route.useSearch();
  const [scope, setScope] = useState<Scope>("pack");
  const [view, setView] = useState<ViewMode>("quadro");
  const [sector, setSector] = useState<string>("todos");
  const [freq, setFreq] = useState<Frequency | "todas">("todas");
  const [priority, setPriority] = useState<Priority | "todas">("todas");
  const [assignee, setAssignee] = useState<string>("todos");
  const [tag, setTag] = useState<string>("todas");
  const [datePreset, setDatePreset] = useState<DatePreset>("todas");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState(initialQ ?? "");
  /* Chegou por link, favorito ou botão de voltar: o `q` da URL manda.
     `?? ""` porque sair do `q` também é um comando — antes, apagar a busca lá
     em cima tirava o termo do endereço e deixava o filtro ligado na tela, com
     a URL dizendo uma coisa e o quadro mostrando outra. */
  useEffect(() => {
    const daUrl = initialQ ?? "";
    if (daUrl !== search) {
      setSearch(daUrl);
      if (daUrl) setScope("todas");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  /* Alguém deu Enter na busca da topbar. Precisa de aviso próprio porque
     buscar DE NOVO o mesmo termo não muda a URL, e sem mudança de URL o efeito
     acima não roda — quem tivesse mexido no campo de busca desta página ficava
     com a barra de cima sem efeito nenhum. */
  useEffect(() => {
    const aoBuscar = (e: Event) => {
      const q = (e as CustomEvent<{ q: string }>).detail?.q ?? "";
      setSearch(q);
      if (q) setScope("todas");
    };
    window.addEventListener("fluxo:busca-global", aoBuscar);
    return () => window.removeEventListener("fluxo:busca-global", aoBuscar);
  }, []);

  const visible = useMemo(() => {
    const range = dateRangeFor(datePreset, dateFrom, dateTo);
    /* O termo entra sem acento e em minúsculas uma vez só, e o nome do
       responsável vira mapa antes do laço — buscar dentro do filtro faria uma
       varredura da lista de pessoas por tarefa.

       Cada palavra é procurada por conta própria: "frete sistema" acha
       "Sistema de Frete". Inteira, a frase só achava o texto escrito
       exatamente naquela ordem. */
    const termos = semAcento(search).split(/\s+/).filter(Boolean);
    const nomePorId = new Map(users.map((u) => [u.id, u.name]));
    /* Busca e pessoa só filtram onde aparecem. No Meu pack a barra fica
       escondida, e o que tivesse sido digitado ou escolhido em outra aba
       continuava valendo lá: o pack aparecia pela metade, ou vazio, sem nada
       na tela que explicasse por quê. */
    const comBarra = scope !== "pack";
    return tasks.filter((t) => {
      if (currentUser.role === "adm") {
        const involved =
          t.assigneeId === currentUser.id ||
          t.createdBy === currentUser.id ||
          t.mentions.includes(currentUser.id);
        if (!involved) return false;
      } else if (currentUser.role === "supervisor") {
        const team = users.filter((u) => u.supervisorId === currentUser.id).map((u) => u.id);
        team.push(currentUser.id);
        const involved =
          team.includes(t.assigneeId) ||
          team.includes(t.createdBy) ||
          t.mentions.includes(currentUser.id);
        if (!involved) return false;
      }
      if (scope === "atribuidas" && t.assigneeId !== currentUser.id) return false;
      if (scope === "criadas" && t.createdBy !== currentUser.id) return false;
      if (scope === "mencionadas" && !t.mentions.includes(currentUser.id)) return false;
      if (scope === "pack") {
        // O que falta e o que foi concluído hoje — ver `noPackDeHoje`.
        if (!noPackDeHoje(t, currentUser.id)) return false;
      }
      if (sector !== "todos" && t.sector !== sector) return false;
      if (freq !== "todas" && t.frequency !== freq) return false;
      if (priority !== "todas" && t.priority !== priority) return false;
      if (comBarra && assignee !== "todos" && t.assigneeId !== assignee) return false;
      if (tag !== "todas" && !t.tags.includes(tag)) return false;
      if (range && scope !== "pack") {
        // Filtro de período é sobre o prazo; sem prazo, fora do período.
        if (!t.dueDate) return false;
        const due = new Date(t.dueDate).getTime();
        if (due < range[0] || due > range[1]) return false;
      }
      /* O responsável entra na busca: o campo lá em cima sempre prometeu
         "tarefa, pessoa, tag" e só cumpria dois terços — procurar pelo nome de
         alguém não trazia as tarefas dessa pessoa, a menos que o nome estivesse
         escrito no título.
         A etiqueta entra com o "#" na frente, que é como o campo pede para
         procurar. Gravada ela vem sem, e "#frete" não achava nada; "frete"
         continua achando, porque está dentro de "#frete". */
      if (comBarra && termos.length > 0) {
        const alvo = semAcento(
          `${t.title} ${t.description ?? ""} ${t.tags.map(comCerquilha).join(" ")} ${nomePorId.get(t.assigneeId) ?? ""}`,
        );
        if (!termos.every((p) => alvo.includes(p))) return false;
      }
      return true;
    });
  }, [tasks, users, currentUser, scope, sector, freq, priority, assignee, tag, search, datePreset, dateFrom, dateTo]);

  const scopeCounts = useMemo(() => {
    const inRole = (t: Task) => {
      if (currentUser.role === "adm") {
        return (
          t.assigneeId === currentUser.id ||
          t.createdBy === currentUser.id ||
          t.mentions.includes(currentUser.id)
        );
      }
      if (currentUser.role === "supervisor") {
        const team = users.filter((u) => u.supervisorId === currentUser.id).map((u) => u.id);
        team.push(currentUser.id);
        return (
          team.includes(t.assigneeId) ||
          team.includes(t.createdBy) ||
          t.mentions.includes(currentUser.id)
        );
      }
      return true;
    };
    const active = tasks.filter((t) => inRole(t) && t.status !== "concluida");
    return {
      todas: active.length,
      atribuidas: active.filter((t) => t.assigneeId === currentUser.id).length,
      criadas: active.filter((t) => t.createdBy === currentUser.id).length,
      mencionadas: active.filter((t) => t.mentions.includes(currentUser.id)).length,
      pack: active.filter((t) => t.assigneeId === currentUser.id && t.inPack).length,
    } as Record<Scope, number>;
  }, [tasks, users, currentUser]);
  // O número da aba do pack é o que ainda falta hoje.
  const packRemainingToday = useMemo(
    () => tasks.filter((t) => noPackDeHoje(t, currentUser.id) && !concluidaHoje(t)).length,
    [tasks, currentUser.id],
  );
  scopeCounts.pack = packRemainingToday;

  const allTags = useMemo(() => Array.from(new Set(tasks.flatMap((t) => t.tags))), [tasks]);

  /* Quem pode aparecer no filtro de pessoa.
     Sai das tarefas que passam pelo RECORTE DE PAPEL, e só por ele. Não pode
     sair de `visible`, que é o resultado já filtrado: escolher alguém deixaria
     `visible` com as tarefas dessa pessoa, a lista encolheria para um nome e
     não haveria como trocar de pessoa sem antes limpar o filtro.

     Também não sai de `users`: oferecer gente para quem não existe nenhuma
     tarefa visível daria um filtro que só sabe devolver vazio, e o menu viraria
     um caminho para descobrir quem a tela não mostraria de outro jeito. */
  const pessoasFiltraveis = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (currentUser.role === "adm") {
        const meu =
          t.assigneeId === currentUser.id ||
          t.createdBy === currentUser.id ||
          t.mentions.includes(currentUser.id);
        if (!meu) continue;
      } else if (currentUser.role === "supervisor") {
        const time = users.filter((u) => u.supervisorId === currentUser.id).map((u) => u.id);
        time.push(currentUser.id);
        const doTime =
          time.includes(t.assigneeId) ||
          time.includes(t.createdBy) ||
          t.mentions.includes(currentUser.id);
        if (!doTime) continue;
      }
      ids.add(t.assigneeId);
    }
    return users.filter((u) => ids.has(u.id));
  }, [tasks, users, currentUser]);

  return (
    <FluxoLayout title="Minhas tarefas">
      {/* Sem teto de 1280px: numa tela de 1920 sobravam ~300px vazios de cada
          lado, justamente na página em que o título da tarefa e as colunas do
          quadro mais precisam de largura. A área já é o que sobra ao lado da
          barra lateral, então abrir ou recolher a barra redistribui sozinho. O
          teto alto só segura monitor ultrawide, onde uma linha de tabela de
          ponta a ponta fica difícil de seguir com o olho. */}
      <div className="mx-auto w-full max-w-[2200px]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
          <div className="flex flex-wrap">
            {(Object.keys(scopeLabels) as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`relative px-4 py-2 text-sm font-medium transition ${
                  scope === s
                    ? s === "pack"
                      ? "text-amber-500"
                      : "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {s === "pack" && <Flame className="h-3.5 w-3.5" />}
                  {scopeLabels[s]}
                </span>
                {scopeCounts[s] > 0 && (
                  <span
                    className={`ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      s === "pack"
                        ? "bg-amber-500 text-white"
                        : s === "mencionadas"
                        ? "bg-primary text-primary-foreground"
                        : scope === s
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {scopeCounts[s]}
                  </span>
                )}
                {scope === s && (
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-full ${
                      s === "pack" ? "bg-amber-500" : "bg-primary"
                    }`}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-2">
            <div className="inline-flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setView("quadro")}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  view === "quadro" ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                <LayoutGrid className="h-3 w-3" /> Quadro
              </button>
              <button
                onClick={() => setView("lista")}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  view === "lista" ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
              >
                <List className="h-3 w-3" /> Lista
              </button>
              <button
                onClick={() => setView("minha-visao")}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
                  view === "minha-visao" ? "bg-secondary text-foreground" : "text-muted-foreground"
                }`}
                title="Colunas, cores e notas pessoais — só você vê"
              >
                <Wand2 className="h-3 w-3" /> Minha visão
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar (hidden on Meu pack — pack é sempre hoje) */}
        {scope !== "pack" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-secondary/40 p-0.5">
            {(Object.keys(datePresetLabels) as DatePreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDatePreset(p)}
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  datePreset === p
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {datePresetLabels[p]}
              </button>
            ))}
          </div>
          <input
            placeholder="Buscar por título, descrição, pessoa ou #tag…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input min-w-[16rem] flex-1 py-1.5"
          />
          {datePreset === "entre" && (
            <div className="inline-flex items-center gap-1">
              <CampoData
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="Início"
                title="Data inicial"
                className="bg-secondary py-1 text-xs"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <CampoData
                value={dateTo}
                onChange={setDateTo}
                placeholder="Fim"
                title="Data final"
                className="bg-secondary py-1 text-xs"
              />
            </div>
          )}
          <span className="text-xs text-muted-foreground">{visible.length} tarefas</span>
        </div>
        )}

        {/* Filtro por pessoa, em faixa própria.
            O estado `assignee` já existia e já era aplicado no recorte — o que
            faltava era o controle, então `setAssignee` nunca era chamado.

            Fora da barra de cima porque agora ele tem duas linhas (setores e
            rostos) e espremê-lo entre os atalhos de data e a busca quebraria as
            duas coisas.

            Só para quem enxerga mais de uma pessoa: para um colaborador, a
            lista teria um nome só, o dele, e o filtro não filtraria nada. */}
        {scope !== "pack" && pessoasFiltraveis.length > 1 && (
          <div className="mt-2">
            <FiltroPessoa
              pessoas={pessoasFiltraveis}
              valor={assignee}
              aoEscolher={setAssignee}
            />
          </div>
        )}

        <div className="mt-4">
          {scope === "pack" ? (
            <PackView
              tasks={visible}
              externalTasks={tasks.filter((t) => {
                if (t.assigneeId !== currentUser.id && !t.mentions.includes(currentUser.id))
                  return false;
                if (t.inPack && t.assigneeId === currentUser.id) return false; // já está no pack
                if (t.status === "concluida") return false;
                if (!t.dueDate) return false; // sem prazo não é "de hoje" nem atrasada
                const due = new Date(t.dueDate);
                const now = new Date();
                return (
                  due.getFullYear() === now.getFullYear() &&
                  due.getMonth() === now.getMonth() &&
                  due.getDate() === now.getDate()
                ) || due.getTime() < now.setHours(0, 0, 0, 0); // hoje ou atrasadas
              })}
              onEdit={openTask}
              onTogglePack={(id, v) => updateTask(id, { inPack: v })}
              onCompleteExternal={(id) => updateTask(id, { status: "concluida" })}
              currentUserId={currentUser.id}
              onMove={(id, status) => moveTask(id, status)}
            />
          ) : view === "quadro" ? (
            <KanbanBoard tasks={visible} onEdit={openTask} onCreate={(status) => openNewTask({ status })} onMove={moveTask} onQuickComplete={(id) => updateTask(id, { status: "concluida" })} onTogglePack={(id, v) => updateTask(id, { inPack: v })} />
          ) : view === "minha-visao" ? (
            <MyView tasks={visible} onEdit={openTask} />
          ) : (
            <TaskList
              tasks={visible}
              onEdit={openTask}
              onComplete={(id) => updateTask(id, { status: "concluida" })}
              onTogglePack={(id, v) => updateTask(id, { inPack: v })}
            />
          )}
          {visible.length === 0 && scope !== "pack" && (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-card py-16 text-center">
              <Filter className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nenhuma tarefa neste recorte</p>
              <p className="text-xs text-muted-foreground">Ajuste os filtros ou crie uma nova (atalho N).</p>
              <button
                onClick={() => openNewTask()}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Plus className="h-3 w-3" /> Nova tarefa
              </button>
            </div>
          )}
        </div>
      </div>
    </FluxoLayout>
  );
}

function MiniSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-secondary px-2 py-1 text-xs"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function TaskList({
  tasks,
  onEdit,
  onComplete,
  onTogglePack,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
  onComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const { users, reorderTasks } = useFluxo();
  const groups: { key: string; label: string; items: Task[] }[] = [
    { key: "atrasada", label: "Atrasadas", items: [] },
    { key: "hoje", label: "Hoje", items: [] },
    { key: "semana", label: "Esta semana", items: [] },
    { key: "depois", label: "Depois", items: [] },
    { key: "sem_prazo", label: "Sem prazo", items: [] },
    { key: "concluida", label: "Concluídas", items: [] },
  ];
  /* Concluída sai da régua do prazo antes de tudo.
     Os grupos de cima respondem "o que falta fazer, e para quando" — e uma
     tarefa entregue não falta. Pelo prazo, a concluída de ontem caía em
     Atrasadas: vermelho, no topo da lista, para algo que já estava resolvido. */
  for (const t of tasks) {
    const b = t.status === "concluida" ? "concluida" : formatDueBucket(t.dueDate);
    groups.find((g) => g.key === b)!.items.push(t);
  }
  groups.forEach((g) =>
    g.key === "concluida"
      ? // A ordem do arraste é prioridade de trabalho, que não existe mais
        // aqui. Prazo mais recente primeiro: o que acabou de sair é o que se
        // procura.
        // (sem prazo por último também aqui)
        g.items.sort((a, b) => Number(!a.dueDate) - Number(!b.dueDate) || porPrazo(b, a))
      : g.items.sort((a, b) => a.order - b.order || porPrazo(a, b)),
  );

  /* Um contexto de arraste para a lista toda, e cada grupo é uma fila à parte:
     soltar noutro grupo não vale, porque o grupo sai do prazo e a tarefa
     voltaria para o dela. Nem entre as concluídas, que reordenaria uma fila
     que não existe mais — lá as linhas nem se pegam. */
  const contexto = useArrasteDeLinhas((id, sobre) => {
    const g = groups.find((x) => x.key !== "concluida" && x.items.some((t) => t.id === id));
    if (!g || !g.items.some((t) => t.id === sobre)) return;
    const ids = g.items.map((t) => t.id);
    reorderTasks(arrayMove(ids, ids.indexOf(id), ids.indexOf(sobre)));
  });
  const nomeDe = (id: UniqueIdentifier) =>
    `"${tasks.find((t) => t.id === String(id))?.title ?? "a tarefa"}"`;

  return (
    <DndContext {...contexto} accessibility={acessibilidadeDoArraste(nomeDe)}>
      <div className="space-y-6">
        {groups.map((g) => {
          if (g.items.length === 0) return null;
          const priorizavel = g.key !== "concluida";
          return (
            <div key={g.key}>
              <div className="mb-1 flex items-center gap-2">
                <h3
                  className={`text-xs font-semibold uppercase tracking-wider ${g.key === "atrasada" ? "text-destructive" : g.key === "hoje" ? "text-warning" : g.key === "concluida" ? "text-success" : "text-muted-foreground"}`}
                >
                  {g.label}
                </h3>
                <span className="text-[10px] text-muted-foreground">({g.items.length})</span>
                {priorizavel && (
                  <span className="text-[10px] text-muted-foreground/70">
                    · arraste ⋮⋮ para priorizar
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                {/* Larguras fixas, as mesmas em todos os grupos. Cada grupo é
                    uma tabela à parte, e com a largura automática cada uma
                    media as colunas pelo próprio conteúdo: "Responsável"
                    começava num ponto em Hoje e noutro em Atrasadas, e a
                    lista inteira parecia torta. A Tarefa fica com o resto. */}
                <table className="w-full min-w-240 table-fixed text-left">
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-9" />
                    <col />
                    <col className="w-52" />
                    <col className="w-32" />
                    <col className="w-30" />
                    <col className="w-34" />
                    <col className="w-34" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pl-4 pr-2"></th>
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-4">Tarefa</th>
                      <th className="py-2 pr-4">Responsável</th>
                      <th className="py-2 pr-4">Prazo</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Setor</th>
                      <th className="py-2 pr-4"></th>
                    </tr>
                  </thead>
                  <SortableContext
                    items={g.items.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <tbody>
                      {g.items.map((t, index) => {
                        const assignee = users.find((u) => u.id === t.assigneeId);
                        const sec = sectors.find((s) => s.id === t.sector);
                        return (
                          <LinhaArrastavel
                            key={t.id}
                            id={t.id}
                            desligada={!priorizavel}
                            aoAbrir={() => onEdit(t.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              window.dispatchEvent(
                                new CustomEvent("fluxo:task-context", {
                                  detail: { id: t.id, x: e.clientX, y: e.clientY },
                                }),
                              );
                            }}
                            className="group border-b border-border last:border-0 hover:bg-secondary/40"
                          >
                            <td className="py-2.5 pl-4 pr-2">
                              {t.status !== "concluida" && (
                                <button
                                  onClick={() => onComplete(t.id)}
                                  className="flex h-4 w-4 items-center justify-center rounded border border-border hover:border-primary hover:bg-primary/10"
                                  title="Marcar concluída"
                                />
                              )}
                            </td>
                            <td className="py-2.5 pr-2">
                              {/* O número é a posição na fila de trabalho — numa
                                  tarefa entregue ele afirmaria uma prioridade que
                                  não existe mais. */}
                              {priorizavel && (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                  {index + 1}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 pr-4">
                              <button
                                onClick={() => onEdit(t.id)}
                                className="flex items-start gap-2 text-left"
                              >
                                <CheckSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                  <div className="text-sm font-medium">
                                    <SeloDoProjeto projectId={t.projectId} />
                                    {t.title}
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <EtiquetasDaTarefa task={t} />
                                    {t.recurring && (
                                      <span className="inline-flex items-center gap-1">
                                        <Repeat className="h-2.5 w-2.5" /> Recorrente
                                      </span>
                                    )}
                                    {t.checklist.length > 0 && (
                                      <span>
                                        ✓ {t.checklist.filter((c) => c.done).length}/
                                        {t.checklist.length}
                                      </span>
                                    )}
                                    {t.mentions.length > 0 && (
                                      <span className="inline-flex items-center gap-0.5">
                                        <AtSign className="h-2.5 w-2.5" /> {t.mentions.length}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            </td>
                            <td className="py-2.5 pr-4">
                              <div className="flex min-w-0 items-center gap-2">
                                <UserAvatar
                                  nome={assignee?.name ?? ""}
                                  iniciais={assignee?.avatar ?? ""}
                                  className="h-6 w-6 shrink-0 text-[10px]"
                                />
                                {/* Nome inteiro no passar do mouse: com a coluna
                                    de largura fixa, os nomes compridos cortam. */}
                                <span className="truncate text-xs" title={assignee?.name}>
                                  {assignee?.name}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                              {rotuloDoPrazo(t, { day: "2-digit", month: "short" })}
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge label={statusLabels[t.status]} color={statusColor[t.status]} />
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge
                                label={sec?.name ?? "—"}
                                color={sec?.color ?? "oklch(0.55 0.02 260)"}
                                dot
                              />
                            </td>
                            <td className="py-2.5 pr-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <TaskTimerControls
                                  taskId={t.id}
                                  estimatedMinutes={t.estimatedMinutes}
                                />
                                <button
                                  onClick={() => onTogglePack(t.id, !t.inPack)}
                                  title={t.inPack ? "Remover do Meu pack" : "Adicionar ao Meu pack"}
                                  className={`rounded p-1 transition ${
                                    t.inPack
                                      ? "text-amber-500 hover:bg-amber-500/10"
                                      : "text-muted-foreground hover:bg-secondary hover:text-amber-500"
                                  }`}
                                >
                                  <Star
                                    className={`h-3.5 w-3.5 ${t.inPack ? "fill-amber-500" : ""}`}
                                  />
                                </button>
                                <button
                                  onClick={() => onEdit(t.id)}
                                  className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </LinhaArrastavel>
                        );
                      })}
                    </tbody>
                  </SortableContext>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <LinhaNaMao
        linha={(id) => {
          const t = tasks.find((x) => x.id === id);
          return (
            t && {
              titulo: t.title,
              detalhe: (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {rotuloDoPrazo(t, { day: "2-digit", month: "short" })}
                </span>
              ),
            }
          );
        }}
      />
    </DndContext>
  );
}

/**
 * Como uma coluna do quadro é ordenada. `manual` = a ordem do arraste;
 * `asc`/`desc` = pelo prazo; `entrega-*` = pelo dia da entrega, só na
 * coluna Concluída (ver `FiltroDaEntrega`).
 */
type OrdemColuna = "manual" | "asc" | "desc" | "entrega-recente" | "entrega-antiga";

/**
 * Ordenação de UMA coluna do quadro, por prazo.
 *
 * Três botões e não um que alterna: alternar obriga a passar pelas opções do
 * meio para chegar na terceira, e num cabeçalho de coluna isso é clique demais
 * para uma escolha que se troca o tempo todo.
 *
 * Escolher prazo desliga a ordem do arraste naquela coluna — os dois não podem
 * valer ao mesmo tempo —, e é por isso que a opção de voltar é um ícone de
 * arrastar: ela diz o que se recupera, não o que se desliga.
 *
 * O destaque da opção escolhida desliza de uma para a outra (`layoutId` por
 * coluna, senão as três colunas disputariam o mesmo destaque).
 */
function OrdemDaColuna({
  coluna,
  valor,
  aoEscolher,
}: {
  coluna: Status;
  valor: OrdemColuna;
  aoEscolher: (v: OrdemColuna) => void;
}) {
  const opcoes: { v: OrdemColuna; icone: typeof GripVertical; titulo: string }[] = [
    { v: "manual", icone: GripVertical, titulo: "Ordem que você arrastou" },
    { v: "asc", icone: ArrowUpNarrowWide, titulo: "Vence primeiro" },
    { v: "desc", icone: ArrowDownNarrowWide, titulo: "Vence por último" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Ordem da coluna"
      className="inline-flex items-center rounded-lg bg-background/60 p-0.5 ring-1 ring-border"
    >
      {opcoes.map(({ v, icone: Icone, titulo }) => {
        const ativo = valor === v;
        return (
          <Dica key={v} texto={titulo}>
            <button
              type="button"
              role="radio"
              aria-checked={ativo}
              aria-label={titulo}
              onClick={() => aoEscolher(v)}
              className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                ativo
                  ? "text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {ativo && (
                <motion.span
                  layoutId={`ordem-da-coluna-${coluna}`}
                  layoutDependency={valor}
                  className="absolute inset-0 rounded-md bg-primary shadow-sm"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <Icone className="relative h-3.5 w-3.5" />
            </button>
          </Dica>
        );
      })}
    </div>
  );
}

/** O nome da ação ao parar o mouse — o ícone sozinho não diz. Pede `TooltipProvider` acima. */
function Dica({ texto, children }: { texto: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="px-2 py-1 text-[11px] normal-case tracking-normal">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

/** O estilo dos botões quadrados do cabeçalho da coluna (entregas, nova tarefa). */
const BOTAO_DO_CABECALHO =
  "flex h-7 w-7 items-center justify-center rounded-lg ring-1 transition-colors";

/** Recorte da coluna Concluída pelo dia da entrega, com as duas pontas. */
type FiltroDeEntrega = { frase: string; de: string; ate: string } | null;

/** Se a tarefa cai no recorte. Sem recorte, todas caem. */
function naEntrega(t: Task, filtro: FiltroDeEntrega): boolean {
  if (!filtro) return true;
  const dia = diaDaEntrega(t);
  return !!dia && dia >= filtro.de && dia <= filtro.ate;
}

/** Os atalhos de dia, calculados na hora — "hoje" muda à meia-noite. */
function atalhosDeEntrega(): { rotulo: string; filtro: NonNullable<FiltroDeEntrega> }[] {
  const hoje = new Date();
  const dia = (delta: number) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + delta);
    return dataParaIso(d);
  };
  const seg = (hoje.getDay() + 6) % 7; // dias desde a segunda
  return [
    { rotulo: "Hoje", filtro: { frase: "hoje", de: dia(0), ate: dia(0) } },
    { rotulo: "Ontem", filtro: { frase: "ontem", de: dia(-1), ate: dia(-1) } },
    { rotulo: "Esta semana", filtro: { frase: "nesta semana", de: dia(-seg), ate: dia(6 - seg) } },
    {
      rotulo: "Semana passada",
      filtro: { frase: "na semana passada", de: dia(-seg - 7), ate: dia(-seg - 1) },
    },
  ];
}

/**
 * O filtro da coluna Concluída: a ordem da entrega (mais recentes ou mais
 * antigas primeiro) e o recorte por dia — um atalho ou um dia qualquer no
 * calendário. Fica aceso quando algum dos dois está valendo.
 *
 * Ordenar por entrega é mais uma ordenação da coluna, como a do prazo: escolher
 * um dos três botões ao lado a desfaz.
 */
function FiltroDaEntrega({
  ordem,
  aoOrdenar,
  filtro,
  aoFiltrar,
}: {
  ordem: OrdemColuna;
  aoOrdenar: (v: OrdemColuna) => void;
  filtro: FiltroDeEntrega;
  aoFiltrar: (f: FiltroDeEntrega) => void;
}) {
  const atalhos = atalhosDeEntrega();
  const porEntrega = ordem === "entrega-recente" || ordem === "entrega-antiga";
  const ativo = porEntrega || !!filtro;
  const atalhoEscolhido = atalhos.find(
    (a) => filtro && a.filtro.de === filtro.de && a.filtro.ate === filtro.ate,
  );
  const diaEscolhido = filtro && !atalhoEscolhido && filtro.de === filtro.ate ? filtro.de : "";
  const opcao = (escolhida: boolean) =>
    `rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
      escolhida
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
    }`;
  return (
    <Popover>
      <Dica texto={ativo ? "Entregas: filtro ativo" : "Entregas: ordem e dia"}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Entregas: ordem e dia"
            className={`${BOTAO_DO_CABECALHO} ${
              ativo
                ? "bg-primary text-primary-foreground ring-primary"
                : "bg-background/60 text-muted-foreground ring-border hover:bg-secondary hover:text-foreground"
            }`}
          >
            <CalendarCheck className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
      </Dica>
      <PopoverContent align="end" className="w-64 p-2 normal-case tracking-normal">
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ordem da entrega
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              ["entrega-recente", "Mais recentes"],
              ["entrega-antiga", "Mais antigas"],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              aria-pressed={ordem === v}
              onClick={() => aoOrdenar(ordem === v ? "manual" : v)}
              className={opcao(ordem === v)}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="mt-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Entregues em
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => aoFiltrar(null)} className={opcao(!filtro)}>
            Qualquer dia
          </button>
          {atalhos.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => aoFiltrar(a.filtro)}
              className={opcao(atalhoEscolhido === a)}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="text-[11px] text-muted-foreground">Dia</span>
          <CampoData
            value={diaEscolhido}
            onChange={(iso) =>
              aoFiltrar(
                iso
                  ? {
                      frase: `em ${isoParaData(iso)?.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
                      de: iso,
                      ate: iso,
                    }
                  : null,
              )
            }
            placeholder="Escolher dia"
            title="Entregues neste dia"
            className="flex-1 py-1 text-xs"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

const COLUNAS_DO_QUADRO = [
  "pendente",
  "andamento",
  "concluida",
] as const satisfies readonly Status[];

/**
 * Uma assinatura da ordem de cada coluna na tela: muda quando algum cartão
 * daquela coluna entra, sai ou troca de lugar. É o `layoutDependency` dos
 * cartões — ver `CartaoDoQuadro`.
 */
function disposicaoPorColuna(exibido: Arranjo<Status>): Record<Status, string> {
  return {
    pendente: exibido.pendente.join(),
    andamento: exibido.andamento.join(),
    concluida: exibido.concluida.join(),
  };
}

/**
 * Marca invisível da coluna no framer. Quando a coluna muda, ela avisa o grupo
 * da coluna para medir os cartões — inclusive o que está saindo, que já não se
 * redesenha. Sem ela, o último cartão de uma coluna ia para a outra sem
 * atravessar a tela: não sobrava ninguém na coluna para disparar a medida.
 */
function MarcaDaColuna({ disposicao }: { disposicao: string }) {
  return <motion.div layout layoutDependency={disposicao} aria-hidden className="hidden" />;
}

/**
 * O dia em que a tarefa foi entregue ("yyyy-MM-dd"): o que a pessoa informou
 * como dia real da conclusão ou, sem isso, o dia do clique que a concluiu. É
 * o mesmo dia que a Timeline mostra.
 */
function diaDaEntrega(t: Task): string | null {
  if (t.status !== "concluida") return null;
  if (t.actualCompletionDate) return t.actualCompletionDate;
  return t.completedAt ? dataParaIso(new Date(t.completedAt)) : null;
}

/** Uma coluna na ordem escolhida no cabeçalho dela. */
function ordenarColuna(itens: Task[], ordem: OrdemColuna): Task[] {
  return [...itens].sort((a, b) => {
    // Sem ordenação escolhida, vale a ordem do arraste.
    if (ordem === "manual") return a.order - b.order;
    if (ordem === "entrega-recente" || ordem === "entrega-antiga") {
      // Sem data de entrega vai para o fim nos dois sentidos.
      const da = diaDaEntrega(a);
      const db = diaDaEntrega(b);
      if (!da !== !db) return da ? -1 : 1;
      // O dia primeiro (o informado vale mais que o clique), o clique desempata.
      const ka = `${da ?? ""}|${a.completedAt ?? ""}`;
      const kb = `${db ?? ""}|${b.completedAt ?? ""}`;
      if (ka !== kb) return (ka < kb ? -1 : 1) * (ordem === "entrega-antiga" ? 1 : -1);
      return a.order - b.order;
    }
    // Sem prazo fica por último nos dois sentidos: não vence nem cedo nem tarde.
    if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
    const da = prazoMs(a.dueDate);
    const db = prazoMs(b.dueDate);
    if (da !== db) return ordem === "asc" ? da - db : db - da;
    // Empate de prazo cai na prioridade, para a lista não embaralhar
    // sozinha a cada render.
    return a.order - b.order;
  });
}

/**
 * Onde a tarefa entra na coluna INTEIRA, que é o que `moveTask` numera.
 *
 * O quadro mostra o recorte dos filtros, e a coluna inteira tem também as
 * tarefas escondidas por eles. A posição da tela passada direto errava sempre
 * que havia escondidas no meio: soltar a primeira tarefa depois da segunda a
 * deixava em primeiro, porque a "posição 2" da coluna inteira ainda caía antes
 * das duas. A âncora é o vizinho de baixo na tela (ou o de cima, soltando no
 * fim), que existe nas duas contagens.
 */
function posicaoNaColunaInteira(
  todas: Task[],
  id: string,
  coluna: Status,
  naTela: string[],
): number | undefined {
  const inteira = todas
    .filter((t) => t.status === coluna && t.id !== id)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
  const i = naTela.indexOf(id);
  const abaixo = naTela[i + 1];
  if (abaixo && inteira.includes(abaixo)) return inteira.indexOf(abaixo);
  const acima = naTela[i - 1];
  if (acima && inteira.includes(acima)) return inteira.indexOf(acima) + 1;
  return undefined; // sozinha na tela: vai para o fim
}

function KanbanBoard({
  tasks,
  onEdit,
  onCreate,
  onMove,
  onQuickComplete,
  onTogglePack,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
  onCreate: (initial?: Status) => void;
  onMove: (id: string, status: Status, targetIndex?: number) => void;
  onQuickComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const { tasks: todas } = useFluxo();
  /* Ordenação por coluna, e não uma para o quadro inteiro: o que se quer ver
     primeiro muda com a coluna. Em "A fazer" interessa o que vence antes; em
     "Concluída", quase sempre o contrário — o que foi entregue por último. */
  const [ordemPorColuna, setOrdemPorColuna] = useState<Record<Status, OrdemColuna>>({
    pendente: "manual",
    andamento: "manual",
    concluida: "manual",
  });
  const [filtroEntrega, setFiltroEntrega] = useState<FiltroDeEntrega>(null);

  const cols: { id: Status; title: string; color: string }[] = [
    { id: "pendente", title: statusLabels.pendente, color: statusColor.pendente },
    { id: "andamento", title: statusLabels.andamento, color: statusColor.andamento },
    { id: "concluida", title: statusLabels.concluida, color: statusColor.concluida },
  ];

  const porId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const atual = useMemo(
    () =>
      Object.fromEntries(
        COLUNAS_DO_QUADRO.map((c) => [
          c,
          ordenarColuna(
            tasks.filter(
              (t) => t.status === c && naEntrega(t, c === "concluida" ? filtroEntrega : null),
            ),
            ordemPorColuna[c],
          ).map((t) => t.id),
        ]),
      ) as Arranjo<Status>,
    [tasks, ordemPorColuna, filtroEntrega],
  );

  /* A PRIORIDADE de cada tarefa, que é a ordem do arraste.
     Precisa ser calculada à parte porque o número no cartão diz
     "Prioridade N", e ordenando por prazo a posição na tela deixa de ser
     a prioridade. Sem este mapa, a tarefa prioridade 1 apareceria como
     "3" só porque vence depois — e o número viraria mentira. */
  const prioridades = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of COLUNAS_DO_QUADRO)
      ordenarColuna(
        tasks.filter((t) => t.status === c),
        "manual",
      ).forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }, [tasks]);

  const { ativo, exibido, contexto } = useArrasteEntreColunas<Status>({
    colunas: COLUNAS_DO_QUADRO,
    atual,
    reordenavel: (c) => ordemPorColuna[c] === "manual",
    encaixar: (c, ids) =>
      ordenarColuna(
        ids.flatMap((id) => porId.get(id) ?? []),
        ordemPorColuna[c],
      ).map((t) => t.id),
    aoSoltar: ({ id, de, para, ids, sobreOutro }) => {
      /* Arrastar define PRIORIDADE: `moveTask` regrava o campo `order`
         da coluna inteira, e é ele que o número no cartão mostra.

         Por isso, com a coluna ordenada por prazo, a posição dentro dela não
         vale: ali a posição significa data, e gravá-la como prioridade
         reescreveria a fila inteira a partir de um critério que não é o da
         pessoa. O cartão nem sai do lugar enquanto se arrasta; trocar de
         coluna continua funcionando — ali o que muda é a situação. */
      if (ordemPorColuna[para] !== "manual") {
        if (de !== para) onMove(id, para);
        else if (sobreOutro)
          toast.info(
            `Ordenado por ${ordemPorColuna[para].startsWith("entrega") ? "entrega" : "prazo"} — a prioridade não mudou.`,
            {
              description: "Volte para a ordem de arraste para reposicionar.",
            },
          );
        return;
      }
      if (de === para && ids.join() === atual[para].join()) return;
      onMove(id, para, posicaoNaColunaInteira(todas, id, para, ids));
    },
  });
  const tarefaAtiva = ativo ? porId.get(ativo) : undefined;

  /* Cartão e miolo são `memo`. No arraste o quadro se redesenha a cada troca
     de lugar, e redesenhar o miolo de todos os cartões a cada vez (prazo
     formatado, fotos, cronômetro) era o que fazia o arraste engasgar com o
     quadro cheio. Para o `memo` valer, as ações têm de ser as mesmas funções de
     um desenho para o outro — e as que chegam da página não são. */
  const acoes = useAcoesEstaveis({ onEdit, onMove, onQuickComplete, onTogglePack });
  // Muda quando algum cartão da coluna muda de lugar — ver `CartaoDoQuadro`.
  const disposicao = useMemo(() => disposicaoPorColuna(exibido), [exibido]);

  const nomeDe = (id: UniqueIdentifier) => {
    const t = porId.get(String(id));
    if (t) return `"${t.title}"`;
    const col = cols.find((c) => idDaColuna(c.id) === String(id));
    return col ? `a coluna ${col.title}` : "a tarefa";
  };

  return (
    <TooltipProvider delayDuration={300}>
      <DndContext {...contexto} accessibility={acessibilidadeDoArraste(nomeDe)}>
        <RemedirAoMudar chave={exibido} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {cols.map((col) => {
            const ordem = ordemPorColuna[col.id];
            const items = exibido[col.id].flatMap((id) => porId.get(id) ?? []);
            /* Acende a coluna que vai receber o cartão. A de origem não: ali
               ele só troca de lugar, e o lugar aberto já mostra isso. */
            const recebendo =
              !!tarefaAtiva &&
              tarefaAtiva.status !== col.id &&
              exibido[col.id].includes(tarefaAtiva.id);
            return (
              <ColunaDoQuadro
                key={col.id}
                status={col.id}
                className={`rounded-md border p-3 transition-colors ${
                  recebendo ? "border-primary bg-primary/5" : "border-transparent bg-secondary/40"
                }`}
              >
                {/* O que se lê à esquerda (coluna e quantas), o que se opera à
                  direita, junto. Antes os controles vinham colados ao título e
                  o "+" isolado na ponta, com um vão no meio. */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                    <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                    {col.title}
                    <span className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground/70 ring-1 ring-border">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <OrdemDaColuna
                      coluna={col.id}
                      valor={ordem}
                      aoEscolher={(v) => setOrdemPorColuna((o) => ({ ...o, [col.id]: v }))}
                    />
                    {col.id === "concluida" && (
                      <FiltroDaEntrega
                        ordem={ordem}
                        aoOrdenar={(v) => setOrdemPorColuna((o) => ({ ...o, concluida: v }))}
                        filtro={filtroEntrega}
                        aoFiltrar={setFiltroEntrega}
                      />
                    )}
                    <Dica texto={`Nova tarefa em ${col.title}`}>
                      <button
                        type="button"
                        onClick={() => onCreate(col.id)}
                        aria-label={`Nova tarefa em ${col.title}`}
                        className={`${BOTAO_DO_CABECALHO} bg-background/60 text-muted-foreground ring-border hover:bg-primary hover:text-primary-foreground hover:ring-primary`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </Dica>
                  </div>
                </div>
                {/* O recorte ativo fica à vista, com quanto ele esconde: sem isso
                  a coluna com 3 cartões parecia ter só 3 entregas. */}
                <AnimatePresence initial={false}>
                  {col.id === "concluida" && filtroEntrega && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mb-2 flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary">
                        <CalendarCheck className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          Entregues {filtroEntrega.frase} · {items.length} de{" "}
                          {tasks.filter((t) => t.status === "concluida").length}
                        </span>
                        <button
                          type="button"
                          onClick={() => setFiltroEntrega(null)}
                          className="rounded p-0.5 hover:bg-primary/15"
                          title="Mostrar todas as entregas"
                          aria-label="Mostrar todas as entregas"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {/* Um `LayoutGroup` por coluna. Ele é o que faz o cartão
                    ATRAVESSAR a tela ao trocar de coluna: o cartão sai de uma
                    lista e entra na outra, e o framer liga as duas posições
                    pelo `layoutId` (que vale para a tela toda) em vez de o
                    cartão sumir aqui e piscar ali. No arraste é ele também que
                    desliza os cartões que abrem espaço. Um só para o quadro
                    inteiro fazia qualquer troca medir as três colunas; assim
                    só mede a coluna que mudou. */}
                <LayoutGroup>
                  <MarcaDaColuna disposicao={disposicao[col.id]} />
                  <div className="space-y-2">
                    {items.map((t, index) => (
                      <CartaoDoQuadro
                        key={t.id}
                        task={t}
                        coluna={col.id}
                        prioridade={prioridades.get(t.id) ?? index + 1}
                        acoes={acoes}
                        disposicao={disposicao[col.id]}
                      />
                    ))}
                    {items.length === 0 && (
                      <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                        Arraste tarefas aqui
                      </div>
                    )}
                  </div>
                </LayoutGroup>
              </ColunaDoQuadro>
            );
          })}
        </div>
        <NoTopo>
          <DragOverlay dropAnimation={POUSO}>
            {tarefaAtiva ? (
              <Levantado className="rounded-md">
                <CartaoNaCorDoProjeto
                  projectId={tarefaAtiva.projectId}
                  className="rounded-md border border-border bg-card p-3"
                >
                  <ConteudoDoCartao
                    task={tarefaAtiva}
                    coluna={tarefaAtiva.status}
                    prioridade={prioridades.get(tarefaAtiva.id) ?? 1}
                    acoes={acoes}
                  />
                </CartaoNaCorDoProjeto>
              </Levantado>
            ) : null}
          </DragOverlay>
        </NoTopo>
      </DndContext>
    </TooltipProvider>
  );
}

/** Uma coluna do quadro ou do pack, que também é área de soltar (para quando está vazia). */
function ColunaDoQuadro({
  status,
  className,
  children,
}: {
  status: Status;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: idDaColuna(status) });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
}

/**
 * Um cartão do quadro.
 *
 * O `motion.div` de fora é o que se mede: é arrastável e área de soltar ao
 * mesmo tempo, e o framer anima a posição dele. O cartão de dentro é o que se
 * pega — recebe o foco, o clique e o teclado. Enquanto está na mão, o cartão
 * vira só o lugar onde ele vai cair: tracejado e vazio, do mesmo tamanho.
 *
 * `disposicao` é o `layoutDependency` do framer: ele só mede e anima quando
 * algum cartão da coluna mudou de lugar. Sem isso ele media o quadro inteiro a
 * cada desenho de qualquer cartão — e no arraste o @dnd-kit redesenha todos os
 * cartões cada vez que o mouse passa de um para outro.
 */
const CartaoDoQuadro = memo(function CartaoDoQuadro({
  task: t,
  coluna,
  prioridade,
  acoes,
  disposicao,
}: {
  task: Task;
  coluna: Status;
  prioridade: number;
  acoes: AcoesDoCartao;
  disposicao: string;
}) {
  const {
    setNodeRef: arrastavel,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: t.id, attributes: { roleDescription: "tarefa" } });
  const { setNodeRef: area } = useDroppable({ id: t.id });
  const medido = useCallback(
    (n: HTMLDivElement | null) => {
      arrastavel(n);
      area(n);
    },
    [arrastavel, area],
  );
  return (
    <CorpoDoCartao
      task={t}
      coluna={coluna}
      prioridade={prioridade}
      acoes={acoes}
      disposicao={disposicao}
      medido={medido}
      pegador={setActivatorNodeRef}
      attributes={attributes}
      listeners={listeners}
      isDragging={isDragging}
    />
  );
});

/**
 * O corpo do cartão, separado dos ganchos do @dnd-kit em `CartaoDoQuadro`.
 *
 * O @dnd-kit redesenha todo cartão que usa `useDraggable` quando alguém pega
 * ou solta um cartão e quando o alvo sob o mouse muda — com o quadro cheio,
 * dezenas de `motion.div` de uma vez, e era isso que engasgava o gesto ao
 * pegar e ao soltar. Os ganchos ficam na casca fina; o corpo é `memo` e só se
 * redesenha quando algo dele mudou: a tarefa, o lugar, ou estar na mão.
 */
const CorpoDoCartao = memo(function CorpoDoCartao({
  task: t,
  coluna,
  prioridade,
  acoes,
  disposicao,
  medido,
  pegador,
  attributes,
  listeners,
  isDragging,
}: {
  task: Task;
  coluna: Status;
  prioridade: number;
  acoes: AcoesDoCartao;
  disposicao: string;
  medido: (n: HTMLDivElement | null) => void;
  pegador: (n: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}) {
  return (
    <motion.div
      ref={medido}
      /* `layoutId` e não só `layout`: o cartão não se move dentro
         da mesma lista quando troca de coluna — ele desmonta de
         uma e monta na outra. O id compartilhado é o que liga as
         duas posições e faz o cartão viajar até lá. */
      layout
      layoutId={`cartao-${t.id}`}
      layoutDependency={disposicao}
      transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.8 }}
    >
      <CartaoNaCorDoProjeto
        ref={pegador}
        projectId={t.projectId}
        vazio={isDragging}
        data-arrastavel=""
        {...attributes}
        {...listeners}
        onKeyDown={(e) => {
          listeners?.onKeyDown?.(e);
          // Espaço pega o cartão; Enter abre, como o clique.
          if (e.key === "Enter" && e.target === e.currentTarget && !isDragging) acoes.onEdit(t.id);
        }}
        onClick={() => acoes.onEdit(t.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("fluxo:task-context", {
              detail: { id: t.id, x: e.clientX, y: e.clientY },
            }),
          );
        }}
        /* `transition-[box-shadow,border-color]` e não o utilitário
           `transition` inteiro: o cartão vive dentro de um
           `motion.div` com `layout`, e o cheio poria transição CSS
           em transform — que é justamente o que a animação de
           troca de coluna escreve a cada quadro. */
        className={`rounded-md border p-3 transition-[box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
          isDragging
            ? "border-dashed border-primary/50 bg-primary/5 shadow-none *:invisible"
            : "border-border bg-card shadow-sm hover:shadow-md"
        }`}
      >
        <ConteudoDoCartao task={t} coluna={coluna} prioridade={prioridade} acoes={acoes} />
      </CartaoNaCorDoProjeto>
    </motion.div>
  );
});

/** O que um cartão do quadro pode fazer. Ver `useAcoesEstaveis`. */
type AcoesDoCartao = {
  onEdit: (id: string) => void;
  onMove: (id: string, status: Status) => void;
  onQuickComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
};

/** O miolo do cartão: no quadro e no cartão levantado pelo arraste. */
const ConteudoDoCartao = memo(function ConteudoDoCartao({
  task: t,
  coluna,
  prioridade,
  acoes: { onMove, onQuickComplete, onTogglePack },
}: {
  task: Task;
  coluna: Status;
  prioridade: number;
  acoes: AcoesDoCartao;
}) {
  const { users } = useFluxo();
  const assignee = users.find((u) => u.id === t.assigneeId);
  const sec = sectors.find((s) => s.id === t.sector);
  const etiquetas = useEtiquetasDoCartao(t);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {/* A prioridade real, não a posição na tela. Ordenando
            por prazo as duas deixam de coincidir. */}
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary"
          title={`Prioridade ${prioridade}`}
        >
          {prioridade}
        </span>
        <span
          className="rounded px-1.5 py-0.5"
          style={{
            background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
            color: sec?.color,
          }}
        >
          {sec?.name}
        </span>
        {/* Ao lado do setor, e não na frente do título: é
            informação de contexto como o setor, e o título fica
            inteiro para ler. */}
        <SeloDoProjeto projectId={t.projectId} className="min-w-0" />
        {t.recurring && <Repeat className="h-2.5 w-2.5 shrink-0" />}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePack(t.id, !t.inPack);
          }}
          title={t.inPack ? "Remover do Meu pack" : "Adicionar ao Meu pack"}
          className={`ml-auto rounded p-0.5 transition ${
            t.inPack ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${t.inPack ? "fill-amber-500" : ""}`} />
        </button>
      </div>
      {/* Título ladeado pelos dois atalhos: concluir à esquerda
          (o mesmo círculo do Meu pack) e a seta que empurra para
          a próxima coluna à direita. */}
      <div className="mt-1.5 flex items-start gap-2">
        <CirculoDeConcluir
          concluida={coluna === "concluida"}
          onClick={(e) => {
            e.stopPropagation();
            if (coluna === "concluida") onMove(t.id, "andamento");
            else onQuickComplete(t.id);
          }}
        />
        <div className="min-w-0 flex-1 text-sm font-medium leading-snug">{t.title}</div>
        <SetaDeColuna
          destino={PROXIMA_COLUNA[coluna]}
          voltando={coluna === "concluida"}
          onClick={(e) => {
            e.stopPropagation();
            onMove(t.id, PROXIMA_COLUNA[coluna]);
          }}
        />
      </div>
      {coluna === "concluida" && <LinhaDaEntrega task={t} />}
      {(etiquetas.length > 0 || t.mentions.length > 0 || t.checklist.length > 0) && (
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
          <PilulasDeEtiqueta etiquetas={etiquetas} />
          {t.checklist.length > 0 && (
            <span>
              ✓ {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
            </span>
          )}
          {t.mentions.length > 0 && (
            <div className="flex items-center gap-1">
              <AtSign className="h-2.5 w-2.5" />
              <div className="flex -space-x-1">
                {t.mentions.slice(0, 4).map((mid) => {
                  const u = users.find((x) => x.id === mid);
                  if (!u) return null;
                  return (
                    <UserAvatar
                      key={mid}
                      nome={u.name}
                      iniciais={u.avatar}
                      title={u.name}
                      className="h-4 w-4 border border-card text-[8px]"
                    />
                  );
                })}
              </div>
              {t.mentions.length > 4 && <span>+{t.mentions.length - 4}</span>}
            </div>
          )}
        </div>
      )}
      {/* Rodapé numa linha só: o que se lê à esquerda (prazo), o
          que se opera à direita (temporizador e responsável).
          Concluir saiu daqui e virou o círculo na frente do
          título — ver `CirculoDeConcluir`. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Clock className="h-3 w-3" />
            {rotuloDoPrazo(t, { day: "2-digit", month: "short" })}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TaskTimerControls taskId={t.id} estimatedMinutes={t.estimatedMinutes} />
          {/* Foto, com as iniciais por trás como reserva. O
              cartão desenhava só as iniciais, então o quadro era
              uma parede de siglas — e reconhecer alguém por "LP"
              exige decorar, enquanto o rosto se reconhece sozinho. */}
          <UserAvatar
            nome={assignee?.name ?? ""}
            iniciais={assignee?.avatar ?? ""}
            title={assignee?.name}
            className="h-6 w-6 text-[10px]"
          />
        </div>
      </div>
    </>
  );
});

/**
 * "Entregue 28 de set., 10:24" no cartão concluído: verde no prazo, âmbar
 * depois dele. Com o dia real informado na tarefa, vale ele (sem hora, porque
 * a hora que existe é a do clique) — o mesmo dia da Timeline.
 */
function LinhaDaEntrega({ task: t }: { task: Task }) {
  const dia = diaDaEntrega(t);
  const quando = isoParaData(dia);
  if (!dia || !quando) return null;
  const clique = t.completedAt ? new Date(t.completedAt) : null;
  const doClique = !!clique && dataParaIso(clique) === dia;
  const texto = doClique
    ? clique.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const atrasada =
    !!t.dueDate &&
    (doClique
      ? clique.getTime() > new Date(t.dueDate).getTime()
      : dia > dataParaIso(new Date(t.dueDate)));
  const dica = [
    atrasada ? "Entregue depois do prazo" : "Entregue no prazo",
    clique && !doClique ? `marcada como concluída em ${clique.toLocaleString("pt-BR")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      title={dica}
      className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
        atrasada ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
      }`}
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      Entregue {texto}
      {atrasada && <span className="font-normal opacity-80">· após o prazo</span>}
    </div>
  );
}

/**
 * Para onde a seta do cartão joga a tarefa.
 *
 * "A fazer" e "Em andamento" andam para a direita, na ordem do quadro.
 * "Concluída" volta para "Em andamento" — é o desfazer de quem concluiu sem
 * querer, e por isso a seta ali é de retorno, não de avanço.
 */
const PROXIMA_COLUNA: Record<Status, Status> = {
  pendente: "andamento",
  andamento: "concluida",
  concluida: "andamento",
};

/**
 * O círculo de concluir, o mesmo gesto do Meu pack: um alvo redondo à esquerda
 * do título, que conclui num clique só.
 *
 * Substituiu o "Marcar concluída" escrito no rodapé. O texto disputava a linha
 * com o temporizador e a foto — em coluna estreita ele quebrava para baixo e
 * esticava o cartão — e ainda assim era menos visível do que um alvo redondo
 * na frente do título, que é onde o olho já está.
 *
 * `transition-[...]` em vez do utilitário `transition` inteiro: o cheio poria
 * transição CSS em `transform`/`scale`, que é o que o `whileTap` daqui anima —
 * o navegador passaria a perseguir o framer com 150ms de atraso.
 */
function CirculoDeConcluir({
  concluida,
  onClick,
}: {
  concluida: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const titulo = concluida ? "Reabrir em Em andamento" : "Marcar concluída";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.85 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
      title={titulo}
      aria-label={titulo}
      aria-pressed={concluida}
      className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,color] ${
        concluida
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-muted-foreground/40 hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
      }`}
    >
      <Check className={`h-3 w-3 ${concluida ? "" : "opacity-0 transition-opacity hover:opacity-60"}`} />
    </motion.button>
  );
}

/**
 * A seta que empurra o cartão para a próxima coluna sem arrastar.
 *
 * Arrastar continua valendo, mas exige mira e mão firme; a seta resolve o caso
 * comum — "comecei isto", "terminei isto" — num clique. Ela se pinta com a cor
 * da coluna de DESTINO, então dá para ver para onde a tarefa vai antes de
 * clicar.
 */
function SetaDeColuna({
  destino,
  voltando,
  onClick,
}: {
  destino: Status;
  voltando: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const cor = statusColor[destino];
  const titulo = voltando
    ? `Voltar para ${statusLabels[destino]}`
    : `Mover para ${statusLabels[destino]}`;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.14, x: voltando ? -2 : 2 }}
      whileTap={{ scale: 0.86 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
      title={titulo}
      aria-label={titulo}
      style={{
        color: cor,
        borderColor: `color-mix(in oklab, ${cor} 45%, transparent)`,
        background: `color-mix(in oklab, ${cor} 12%, transparent)`,
      }}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
    >
      {voltando ? <Undo2 className="h-3 w-3" /> : <ArrowRight className="h-3.5 w-3.5" />}
    </motion.button>
  );
}

/**
 * O `div` do cartão, pintado na cor do projeto quando a tarefa tem um.
 *
 * Existe como componente só porque a cor vem de um hook (`useProjetoDaTarefa`),
 * e hook não pode ser chamado dentro do `map` do quadro. O resto passa direto.
 * `vazio` é o lugar do cartão que está na mão do arraste: sem a cor do projeto,
 * que esconderia o tracejado de onde a tarefa vai cair.
 */
function CartaoNaCorDoProjeto({
  projectId,
  vazio,
  style,
  ...props
}: React.ComponentProps<"div"> & { projectId?: string; vazio?: boolean }) {
  const projeto = useProjetoDaTarefa(projectId);
  const cor = vazio ? undefined : estiloDoCartaoDoProjeto(projeto);
  return <div {...props} style={{ ...style, ...cor }} />;
}

function Badge({ label, color, dot }: { label: string; color: string; dot?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
}

function PackView({
  tasks,
  externalTasks,
  onEdit,
  onTogglePack,
  onCompleteExternal,
  currentUserId,
  onMove,
}: {
  tasks: Task[];
  externalTasks: Task[];
  onEdit: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
  onCompleteExternal: (id: string) => void;
  currentUserId: string;
  onMove: (id: string, status: Status) => void;
}) {
  const [focus, setFocus] = useState(() => focusSummaryToday(currentUserId));
  useEffect(() => {
    setFocus(focusSummaryToday(currentUserId));

    /* O local responde na hora; o banco é quem sabe o total de verdade se a
       pessoa fez um pomodoro noutro computador mais cedo hoje. A busca roda
       de novo a cada "fluxo:focus-updated" — o mesmo evento que atualiza o
       local — para o número não ficar defasado depois do primeiro pomodoro
       do dia. */
    void (async () => {
      try {
        const { focoDeHoje } = await import("@/lib/foco.functions");
        const r = await focoDeHoje();
        setFocus(r);
      } catch (e) {
        console.warn("[fluxo] foco de hoje não carregou:", (e as Error)?.message);
      }
    })();

    const on = () => {
      setFocus(focusSummaryToday(currentUserId));
      void import("@/lib/foco.functions")
        .then((api) => api.focoDeHoje())
        .then(setFocus)
        .catch(() => {});
    };
    window.addEventListener("fluxo:focus-updated", on);
    return () => window.removeEventListener("fluxo:focus-updated", on);
  }, [currentUserId]);
  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.status === "concluida").length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
  return (
    <div className="space-y-4">
      {/* Faixa compacta do pack — só o essencial */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-500" />
          <span className="font-semibold">Pack de hoje</span>
          <span className="text-muted-foreground">· {today}</span>
        </div>
        <div className="flex-1 min-w-[140px]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-500/15">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          {doneCount}/{total} · {pct}%
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">
          <Timer className="h-3 w-3" />
          {focus.pomos}p · {Math.floor(focus.minutes / 60)}h{focus.minutes % 60}m
        </span>
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-500/40 bg-card p-10 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-amber-500" />
          <p className="mt-2 text-sm font-semibold">Seu pack ainda está vazio</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Em qualquer tarefa atribuída a você, clique na estrela{" "}
            <Star className="inline h-3 w-3 -translate-y-0.5 text-amber-500" /> para marcá-la como
            obrigação diária.
          </p>
        </div>
      ) : (
        <PackEmColunas tasks={tasks} onEdit={onEdit} onMove={onMove} onTogglePack={onTogglePack} />
      )}

      {/* --- Tarefas externas do dia ------------------------------------ */}
      <div className="pt-6">
        <div className="mb-2 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Chegaram pra hoje</h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {externalTasks.length}
          </span>
          <span className="text-[11px] text-muted-foreground">
            · fora do pack — atribuídas, menções ou criadas com prazo até hoje
          </span>
        </div>
        {externalTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            Nada de fora do pack pra hoje. Foque no essencial.
          </div>
        ) : (
          <div className="space-y-2">
            {externalTasks.map((t) => (
              <ExternalRow
                key={t.id}
                task={t}
                currentUserId={currentUserId}
                onEdit={onEdit}
                onComplete={onCompleteExternal}
                onTogglePack={onTogglePack}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExternalRow({
  task,
  currentUserId,
  onEdit,
  onComplete,
  onTogglePack,
}: {
  task: Task;
  currentUserId: string;
  onEdit: (id: string) => void;
  onComplete: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const sec = sectors.find((s) => s.id === task.sector);
  const isMention =
    task.mentions.includes(currentUserId) && task.assigneeId !== currentUserId;
  const isMine = task.assigneeId === currentUserId;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isLate = prazoVencido(task.dueDate, startOfToday.getTime());
  const origin = isMention ? "Mencionaram você" : isMine ? "Atribuída a você" : "Criada por você";
  const projeto = useProjetoDaTarefa(task.projectId);
  return (
    <div
      style={estiloDoCartaoDoProjeto(projeto)}
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("fluxo:task-context", {
            detail: { id: task.id, x: e.clientX, y: e.clientY },
          }),
        );
      }}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition hover:shadow-md"
    >
      <button
        onClick={() => onComplete(task.id)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border transition hover:border-emerald-500 hover:bg-emerald-500/10"
        title="Marcar concluída"
      />
      <button onClick={() => onEdit(task.id)} className="flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            <SeloDoProjeto projectId={task.projectId} />
            {task.title}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
              isMention
                ? "bg-primary/15 text-primary"
                : isLate
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary text-muted-foreground"
            }`}
          >
            {isLate ? "Atrasada" : origin}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {task.dueDate
              ? `Prazo ${rotuloDoPrazo(task, { day: "2-digit", month: "short" })}`
              : SEM_PRAZO}
          </span>
          {task.recurring && (
            <span className="inline-flex items-center gap-0.5">
              <Repeat className="h-2.5 w-2.5" /> Recorrente
            </span>
          )}
          <EtiquetasDaTarefa task={task} />
        </div>
      </button>
      <Badge label={sec?.name ?? "—"} color={sec?.color ?? "oklch(0.55 0.02 260)"} dot />
      {isMine && (
        <button
          onClick={() => onTogglePack(task.id, true)}
          title="Adicionar ao Meu pack"
          className="rounded p-1.5 text-muted-foreground opacity-70 transition hover:bg-amber-500/10 hover:text-amber-500 hover:opacity-100"
        >
          <Star className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function PackRow({
  task,
  isDone,
  onEdit,
  onToggleDone,
  onTogglePack,
}: {
  task: Task;
  isDone: boolean;
  onEdit: (id: string) => void;
  onToggleDone: (id: string) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const sec = sectors.find((s) => s.id === task.sector);
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("fluxo:task-context", {
            detail: { id: task.id, x: e.clientX, y: e.clientY },
          }),
        );
      }}
      className={`group flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:shadow-md ${
        isDone ? "border-border/60 opacity-60" : "border-amber-500/30"
      }`}
    >
      <button
        onClick={() => onToggleDone(task.id)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          isDone
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-amber-500/60 hover:bg-amber-500/10"
        }`}
        title={isDone ? "Desmarcar" : "Concluir hoje"}
      >
        {isDone && <CheckCircle2 className="h-4 w-4" />}
      </button>
      <button
        onClick={() => onEdit(task.id)}
        className="flex-1 text-left"
      >
        <div className={`text-sm font-medium ${isDone ? "line-through" : ""}`}>
          <SeloDoProjeto projectId={task.projectId} />
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {task.dueDate
              ? `Prazo ${rotuloDoPrazo(task, { day: "2-digit", month: "short" })}`
              : SEM_PRAZO}
          </span>
          {task.recurring && (
            <span className="inline-flex items-center gap-0.5">
              <Repeat className="h-2.5 w-2.5" /> Recorrente
            </span>
          )}
          <EtiquetasDaTarefa task={task} />
        </div>
      </button>
      <Badge label={sec?.name ?? "—"} color={sec?.color ?? "oklch(0.55 0.02 260)"} dot />
      <TaskTimerControls taskId={task.id} estimatedMinutes={task.estimatedMinutes} />
      {!isDone && (
        <button
          onClick={() => startFocus(task.id)}
          title="Iniciar modo foco (25min)"
          className="rounded p-1.5 text-primary opacity-70 transition hover:bg-primary/10 hover:opacity-100"
        >
          <Play className="h-4 w-4 fill-primary" />
        </button>
      )}
      <button
        onClick={() => onTogglePack(task.id, false)}
        title="Remover do Meu pack"
        className="rounded p-1.5 text-amber-500 opacity-70 transition hover:bg-amber-500/10 hover:opacity-100"
      >
        <Star className="h-4 w-4 fill-amber-500" />
      </button>
    </div>
  );
}

const PackKanbanCard = memo(function PackKanbanCard({
  task,
  acoes,
  disposicao,
}: {
  task: Task;
  acoes: AcoesDoPack;
  disposicao: string;
}) {
  const {
    setNodeRef: arrastavel,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: task.id, attributes: { roleDescription: "tarefa do pack" } });
  const { setNodeRef: area } = useDroppable({ id: task.id });
  const medido = useCallback(
    (n: HTMLDivElement | null) => {
      arrastavel(n);
      area(n);
    },
    [arrastavel, area],
  );
  const done = task.status === "concluida";
  // Mesmo arranjo do cartão do quadro — ver `CartaoDoQuadro`.
  return (
    <motion.div
      ref={medido}
      layout
      layoutDependency={disposicao}
      transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.8 }}
    >
      <div
        ref={setActivatorNodeRef}
        data-arrastavel=""
        {...attributes}
        {...listeners}
        onKeyDown={(e) => {
          listeners?.onKeyDown?.(e);
          if (e.key === "Enter" && e.target === e.currentTarget && !isDragging)
            acoes.onEdit(task.id);
        }}
        onClick={() => acoes.onEdit(task.id)}
        className={`group rounded-md border p-2 transition-[box-shadow,border-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
          isDragging
            ? "border-dashed border-primary/50 bg-primary/5 shadow-none *:invisible"
            : `bg-card shadow-sm hover:shadow-md ${
                done ? "border-emerald-500/30 opacity-70" : "border-amber-500/30"
              }`
        }`}
      >
        <MioloDoCartaoDoPack task={task} acoes={acoes} />
      </div>
    </motion.div>
  );
});

/** O que um cartão do pack pode fazer. Ver `useAcoesEstaveis`. */
type AcoesDoPack = {
  onEdit: (id: string) => void;
  onMove: (id: string, status: Status) => void;
  onTogglePack: (id: string, v: boolean) => void;
};

/** O miolo do cartão do pack: na coluna e no cartão levantado pelo arraste. */
const MioloDoCartaoDoPack = memo(function MioloDoCartaoDoPack({
  task,
  acoes: { onMove, onTogglePack },
}: {
  task: Task;
  acoes: AcoesDoPack;
}) {
  const done = task.status === "concluida";
  /* A caixinha e a coluna diziam coisas diferentes: a coluna seguia a
     situação da tarefa, a caixinha uma marca guardada no navegador. Tarefa na
     coluna Concluída aparecia com a caixinha vazia. Agora as duas leem o
     banco — ver `concluidaHoje`. */
  const doneToday = concluidaHoje(task);
  return (
    <>
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!doneToday) onMove(task.id, "concluida");
          }}
          disabled={doneToday}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border disabled:cursor-default ${
            doneToday
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-border bg-background"
          }`}
          title={doneToday ? "Concluída hoje" : "Marcar concluída hoje"}
        >
          {doneToday && <CheckCircle2 className="h-3 w-3" />}
        </button>
        <div className={`flex-1 text-sm font-medium leading-snug ${done ? "line-through" : ""}`}>
          <SeloDoProjeto projectId={task.projectId} />
          {task.title}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePack(task.id, false);
          }}
          title="Remover do pack"
          className="rounded p-0.5 text-amber-500 opacity-70 transition hover:opacity-100"
        >
          <Star className="h-3.5 w-3.5 fill-amber-500" />
        </button>
      </div>
      <EtiquetasDaTarefa task={task} className="mt-1.5 pl-6" />
      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="flex gap-0.5">
          {task.status !== "pendente" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(task.id, "pendente");
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground hover:bg-secondary"
              title="Voltar para A fazer"
            >
              ← A fazer
            </button>
          )}
          {task.status !== "andamento" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(task.id, "andamento");
              }}
              className="rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground hover:bg-secondary"
              title="Em andamento"
            >
              ▶ Andamento
            </button>
          )}
          {task.status !== "concluida" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMove(task.id, "concluida");
              }}
              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
              title="Concluir"
            >
              ✓ Concluir
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <TaskTimerControls taskId={task.id} estimatedMinutes={task.estimatedMinutes} />
          {!done && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                startFocus(task.id);
              }}
              title="Iniciar foco (25min)"
              className="rounded p-0.5 text-primary opacity-70 hover:opacity-100"
            >
              <Play className="h-3 w-3 fill-primary" />
            </button>
          )}
        </div>
      </div>
    </>
  );
});

/**
 * As três colunas do pack de hoje. Aqui o arraste só troca a situação: a ordem
 * dentro da coluna não é prioridade, então o cartão entra sempre no fim.
 */
function PackEmColunas({
  tasks,
  onEdit,
  onMove,
  onTogglePack,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
  onMove: (id: string, status: Status) => void;
  onTogglePack: (id: string, v: boolean) => void;
}) {
  const porId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const atual = useMemo(
    () =>
      Object.fromEntries(
        COLUNAS_DO_QUADRO.map((c) => [c, tasks.filter((t) => t.status === c).map((t) => t.id)]),
      ) as Arranjo<Status>,
    [tasks],
  );
  const { ativo, exibido, contexto } = useArrasteEntreColunas<Status>({
    colunas: COLUNAS_DO_QUADRO,
    atual,
    reordenavel: () => false,
    encaixar: (_coluna, ids) => ids,
    aoSoltar: ({ id, de, para }) => {
      if (de !== para) onMove(id, para);
    },
  });
  const tarefaAtiva = ativo ? porId.get(ativo) : undefined;
  // Mesma razão do quadro — ver `KanbanBoard` e `CartaoDoQuadro`.
  const acoes = useAcoesEstaveis({ onEdit, onMove, onTogglePack });
  const disposicao = useMemo(() => disposicaoPorColuna(exibido), [exibido]);
  const nomeDe = (id: UniqueIdentifier) => {
    const t = porId.get(String(id));
    if (t) return `"${t.title}"`;
    const c = COLUNAS_DO_QUADRO.find((x) => idDaColuna(x) === String(id));
    return c ? `a coluna ${statusLabels[c]}` : "a tarefa";
  };

  return (
    <DndContext {...contexto} accessibility={acessibilidadeDoArraste(nomeDe)}>
      <RemedirAoMudar chave={exibido} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {COLUNAS_DO_QUADRO.map((c) => {
          const items = exibido[c].flatMap((id) => porId.get(id) ?? []);
          const recebendo =
            !!tarefaAtiva && tarefaAtiva.status !== c && exibido[c].includes(tarefaAtiva.id);
          return (
            <ColunaDoQuadro
              key={c}
              status={c}
              className={`rounded-lg border p-2 transition-colors ${
                recebendo ? "border-primary bg-primary/5" : "border-border bg-secondary/30"
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
                  <span className="h-2 w-2 rounded-full" style={{ background: statusColor[c] }} />
                  {statusLabels[c]}
                </div>
                <span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((t) => (
                  <PackKanbanCard key={t.id} task={t} acoes={acoes} disposicao={disposicao[c]} />
                ))}
                {items.length === 0 && (
                  <div className="rounded-md border border-dashed border-border/70 py-4 text-center text-[10px] text-muted-foreground">
                    Arraste aqui
                  </div>
                )}
              </div>
            </ColunaDoQuadro>
          );
        })}
      </div>
      <NoTopo>
        <DragOverlay dropAnimation={POUSO}>
          {tarefaAtiva ? (
            <Levantado className="rounded-md">
              <div
                className={`rounded-md border bg-card p-2 ${
                  tarefaAtiva.status === "concluida"
                    ? "border-emerald-500/30"
                    : "border-amber-500/30"
                }`}
              >
                <MioloDoCartaoDoPack task={tarefaAtiva} acoes={acoes} />
              </div>
            </Levantado>
          ) : null}
        </DragOverlay>
      </NoTopo>
    </DndContext>
  );
}