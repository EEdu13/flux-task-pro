import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ActivityEntry,
  ActivityKind,
  Attachment,
  ChecklistItem,
  CompletionEntry,
  MeetingMinute,
  Meta,
  Notification,
  PackTemplate,
  Project,
  Role,
  Status,
  Task,
  User,
} from "./fluxo-types";
import { priorityMultiplier } from "./fluxo-types";
import { createRoomCall } from "./livekit-token.functions";
import { iamLogout } from "@/integrations/iam/auth.functions";
// Só a regra de iniciais, que é string pura e roda no navegador. Reescrevê-la
// aqui para preservar a independência declarada acima faria o mesmo avatar sair
// com iniciais diferentes dependendo da tela.
import { iniciaisDoNome } from "@/integrations/iam/types";
import { toast } from "sonner";
import { empilharDesfazer } from "@/lib/undo-stack";
import { proximaOcorrencia } from "./recorrencia";

/**
 * O mínimo que o store precisa saber de alguém vindo da IAM. Declarado aqui de
 * propósito, para o store não depender da pasta de integração — se um dia a
 * identidade vier de outra fonte, só o adaptador muda.
 */
export interface IamUsuarioBasico {
  id: number | string;
  nome: string;
  role: Role;
  avatar: string;
  papeis: string[];
  email?: string | null;
  telefone?: string | null;
  /** Cargo real (FUNCAO na tabela de colaboradores). */
  funcao?: string | null;
  /** Id de setor já normalizado. */
  setorId?: string | null;
  /**
   * Nome do supervisor. Guardamos o NOME, não o id, porque essa pessoa pode
   * ainda não ter logado — o vínculo é resolvido quando ela aparecer.
   */
  supervisorNome?: string | null;
}

function taskHasProof(t: Task): boolean {
  if ((t.attachments?.length ?? 0) > 0) return true;
  return t.comments.some((c) => (c.attachments?.length ?? 0) > 0);
}

function blockIfMissingProof(t: Task, targetStatus: Status): boolean {
  if (targetStatus !== "concluida") return false;
  if (!t.requireProof) return false;
  if (taskHasProof(t)) return false;
  toast.error("Essa tarefa exige comprovante", {
    description: "Anexe um arquivo antes de concluir (ex: recibo, print, PDF).",
  });
  return true;
}

interface TaskDialogState {
  open: boolean;
  editingId?: string;
  initialStatus?: Status;
  initialDueDate?: string;
}

interface Store {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  metas: Meta[];
  completions: CompletionEntry[];
  projects: Project[];
  packTemplates: PackTemplate[];
  currentUserId: string;
  isAuthenticated: boolean;
  login: (userId: string) => void;
  /**
   * Entra com uma identidade vinda da IAM Larsil, criando ou atualizando a
   * pessoa na lista local. É assim que o sistema vai sendo populado: quem nunca
   * logou simplesmente ainda não existe aqui.
   */
  loginFromIam: (u: IamUsuarioBasico) => void;
  logout: () => void;
  setCurrentUserId: (id: string) => void;
  currentUser: User;
  // task crud
  /**
   * `checklist` é opcional na criação: dá para nascer com os passos já
   * montados. Antes era obrigatoriamente vazio, e a pessoa tinha que criar,
   * salvar, reabrir e só então adicionar os itens.
   */
  createTask: (
    t: Omit<Task, "id" | "createdAt" | "order" | "comments" | "checklist" | "activity"> & {
      checklist?: ChecklistItem[];
    },
  ) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, status: Status, targetIndex?: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  // task details
  addComment: (taskId: string, text: string, attachments?: Attachment[]) => void;
  addChecklistItem: (taskId: string, text: string) => void;
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  removeChecklistItem: (taskId: string, itemId: string) => void;
  addTaskAttachments: (taskId: string, atts: Attachment[]) => void;
  removeTaskAttachment: (taskId: string, attId: string) => void;
  // users crud
  createUser: (u: Omit<User, "id" | "score" | "streak">) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  deleteUser: (id: string) => void;
  updateCurrentUser: (patch: Partial<User>) => void;
  // metas
  upsertMeta: (m: Omit<Meta, "id">) => void;
  removeMeta: (id: string) => void;
  // notifications
  markNotifRead: (id: string) => void;
  markAllNotifsRead: () => void;
  // room calls
  callUserToRoom: (targetUserId: string, roomName: string, roomLabel: string) => void;
  callCounts: Record<string, Record<string, Record<string, number>>>;
  topContactsForRoom: (roomName: string, limit?: number) => User[];
  recentContactIds: string[];
  recentContactUsers: (limit?: number) => User[];
  dismissRoomCall: (notifId: string) => void;
  addMissedCallNotification: (fromUserId: string, roomName: string, roomLabel: string) => void;
  // meeting minutes
  minutes: MeetingMinute[];
  saveMinute: (m: Omit<MeetingMinute, "id" | "createdAt" | "createdBy">) => MeetingMinute;
  deleteMinute: (id: string) => void;
  minuteTopicToTask: (minuteId: string, topicId: string) => string | undefined;
  visibleMinutes: () => MeetingMinute[];
  // permissions
  canAssignTo: (targetUserId: string) => boolean;
  visibleUsersForAssign: () => User[];
  // projects
  createProject: (p: Omit<Project, "id" | "createdAt" | "createdBy">) => string;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addProjectAttachments: (projectId: string, atts: Attachment[]) => void;
  removeProjectAttachment: (projectId: string, attId: string) => void;
  visibleProjects: () => Project[];
  projectTasks: (projectId: string) => Task[];
  // pack templates
  createPackTemplate: (p: Omit<PackTemplate, "id" | "createdAt" | "createdBy">) => string;
  updatePackTemplate: (id: string, patch: Partial<PackTemplate>) => void;
  deletePackTemplate: (id: string) => void;
  applyPackTemplate: (templateId: string, targetUserId: string) => number;
  transferPack: (fromUserId: string, toUserId: string) => number;
  // global task dialog
  taskDialog: TaskDialogState;
  openNewTask: (opts?: { status?: Status; dueDate?: string }) => void;
  openTask: (id: string) => void;
  closeTaskDialog: () => void;
  // quick create modal (spreadsheet-style)
  quickCreate: { open: boolean; status?: Status; dueDate?: string; assigneeId?: string };
  openQuickCreate: (opts?: { status?: Status; dueDate?: string; assigneeId?: string }) => void;
  closeQuickCreate: () => void;
}

const StoreCtx = createContext<Store | null>(null);

/**
 * v3 porque o dado falso saiu.
 *
 * Apagar o seed do código não apaga o que já está no navegador de quem usou o
 * sistema: `fluxo.state.v2` guarda a Carla Mendes, o Bruno Tavares e as nove
 * tarefas inventadas, e o `load()` abaixo mescla o que está salvo por cima dos
 * padrões. Sem trocar a chave, o dado falso continuaria aparecendo em toda
 * máquina que já abriu o Fluxo alguma vez — e sumiria só na sua, que talvez
 * limpasse à mão. Com a chave nova, todo mundo começa vazio no mesmo dia.
 */
const LS_KEY = "fluxo.state.v3";

/** Ver o comentário em `currentUser`, mais abaixo. */
const USUARIO_AUSENTE: User = {
  id: "",
  name: "",
  role: "adm",
  jobTitle: "",
  sector: "sem-setor",
  avatar: "",
  score: 0,
  streak: 0,
};

interface Persisted {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  metas: Meta[];
  completions: CompletionEntry[];
  projects: Project[];
  packTemplates: PackTemplate[];
  currentUserId: string;
  isAuthenticated: boolean;
  callCounts: Record<string, Record<string, Record<string, number>>>;
  // shape: { [callerUserId]: { [roomName]: { [targetUserId]: count } } }
  recentContactsByUser?: Record<string, string[]>;
  minutes?: MeetingMinute[];
}

function load(): Persisted {
  /* Tudo vazio. As pessoas entram pelo `loginFromIam`, com o id numérico da
     IAM; tarefas, metas e conclusões nascem do uso. O que havia aqui antes eram
     nove pessoas que não existem na Larsil, nove tarefas inventadas e um mês de
     conclusões geradas por sorteio — era isso que enchia o ranking do time e o
     gráfico dos últimos 7 dias na tela inicial. */
  const defaults: Persisted = {
    users: [],
    tasks: [],
    notifications: [],
    metas: [],
    completions: [],
    projects: [],
    packTemplates: [],
    currentUserId: "",
    isAuthenticated: false,
    callCounts: {},
    recentContactsByUser: {},
    minutes: [],
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

const nowIso = () => new Date().toISOString();
const rid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Id do formato novo — o que o banco aceita.
 *
 * Enquanto a migração acontece por blocos, os dois formatos convivem: o que foi
 * criado antes tem `prj-mf3k2a-x9d1` e existe só no navegador; o que nasce
 * agora é UUID e vai para o banco. Toda gravação confere isto antes de chamar o
 * servidor — mandar o id antigo daria erro de formato, e o erro apareceria como
 * um aviso no console, longe de quem clicou.
 */
const ehGuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

/**
 * Manda a tarefa inteira para o banco.
 *
 * Só os campos de `gestor.tarefas` — checklist, comentários, histórico e
 * menções continuam no navegador até o bloco D. Mandar o objeto todo não daria
 * erro, mas os campos extras seriam descartados em silêncio pelo validador, e
 * seria fácil concluir que eles foram salvos.
 */
async function gravarTarefa(t: Task): Promise<void> {
  if (!ehGuid(t.id)) return; // tarefa do formato antigo fica local
  try {
    const api = await import("@/lib/tarefas.functions");
    await api.salvarTarefa({
      data: {
        id: t.id,
        title: t.title,
        description: t.description,
        sector: t.sector,
        assigneeId: t.assigneeId,
        projectId: t.projectId,
        frequency: t.frequency,
        status: t.status,
        priority: t.priority,
        score: t.score,
        dueDate: t.dueDate,
        recurring: t.recurring,
        recurringUntil: t.recurringUntil,
        recurringMonthDay: t.recurringMonthDay,
        estimatedMinutes: t.estimatedMinutes,
        requireProof: t.requireProof,
        inPack: t.inPack,
        order: t.order,
      },
    });
    /* Os satélites acompanham a tarefa, na mesma gravação.
       Checklist, menções, etiquetas e dias de recorrência são regravados em
       bloco — são listas curtas, e a tarefa inteira já sobe a cada mudança.
       Comentários e histórico ficam de fora: eles só crescem, e regravá-los
       apagaria o que outra pessoa escreveu enquanto esta tinha a tarefa
       aberta. */
    const sat = await import("@/lib/tarefa-satelites.functions");
    await sat.salvarSatelites({
      data: {
        tarefaId: t.id,
        checklist: t.checklist.map((c) => ({ text: c.text, done: c.done })),
        mentions: t.mentions,
        tags: t.tags,
        recurringWeekdays: t.recurringWeekdays ?? [],
      },
    });
  } catch (e) {
    console.warn("[fluxo] tarefa não gravou:", (e as Error)?.message);
  }
}

/** Manda o modelo inteiro para o banco. Usado ao criar e ao atualizar. */
async function gravarPack(p: PackTemplate): Promise<void> {
  try {
    const api = await import("@/lib/packs.functions");
    await api.salvarPack({
      data: {
        id: p.id,
        name: p.name,
        description: p.description,
        scope: p.scope,
        targetJobTitle: p.targetJobTitle,
        targetUserId: p.targetUserId,
        items: p.items.map((i) => ({ title: i.title, estimatedMinutes: i.estimatedMinutes })),
      },
    });
  } catch (e) {
    console.warn("[fluxo] modelo de pack não gravou:", (e as Error)?.message);
  }
}

function pushActivity(task: Task, entry: Omit<ActivityEntry, "id" | "at">, userId: string): Task {
  return {
    ...task,
    activity: [...task.activity, { ...entry, id: rid("a"), at: nowIso(), userId }],
  };
}

function computeScore(base: number, priority: Task["priority"], onTime: boolean): number {
  const mult = priorityMultiplier[priority];
  const modifier = onTime ? 1.1 : 0.8;
  return Math.round(base * mult * modifier);
}

export function FluxoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(() => load());
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>({ open: false });
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; status?: Status; dueDate?: string; assigneeId?: string }>({ open: false });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  }, [state]);

  /* === Ponte do WhatsApp ===
     O que havia aqui era um canal em tempo real do Supabase escutando a tabela
     onde o bot gravava. Cada linha nova era comparada com o usuário logado e,
     se fosse dele, virava uma tarefa LOCAL com id `wa-<algo>` — que não era uma
     tarefa de verdade: não entrava no quadro de mais ninguém, não pontuava e
     não podia ser delegada. O controle do que já tinha sido consumido morava
     numa chave do `localStorage`, então trocar de computador fazia tudo
     reaparecer, e quem nunca abrisse o Fluxo simplesmente não recebia.

     Agora o bot grava em `gestor.entrada_whatsapp` e a tarefa nasce no
     servidor, em `gestor.tarefas`, como qualquer outra. Sobrou esta consulta,
     que existe por um motivo só: a lista de tarefas é carregada no login, então
     sem ela uma mensagem mandada agora só apareceria no login seguinte. O id da
     tarefa é o próprio controle de duplicata — a lista de "já consumidos"
     deixou de existir.

     O minuto é proposital e não tem relação com os tempos das chamadas: lá o
     intervalo está calibrado para alguém atender um telefone tocando. Aqui a
     pessoa mandou uma mensagem e vai olhar o quadro; um minuto é imperceptível,
     e o custo é uma consulta que bate num índice filtrado. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!state.isAuthenticated || !state.currentUserId) return;

    let vivo = true;
    const buscar = async () => {
      try {
        const { tarefasDoWhatsapp } = await import("@/lib/whatsapp.functions");
        const { tarefas } = await tarefasDoWhatsapp();
        if (!vivo || tarefas.length === 0) return;
        setState((s) => {
          const conhecidas = new Set(s.tasks.map((t) => t.id));
          const novas = tarefas
            .filter((t) => !conhecidas.has(t.id))
            .map((t) => ({
              // Os satélites chegam quando a tarefa é aberta, como no login.
              ...t,
              mentions: [] as string[],
              tags: [] as string[],
              comments: [],
              checklist: [],
              activity: [],
            }));
          return novas.length ? { ...s, tasks: [...novas, ...s.tasks] } : s;
        });
      } catch (e) {
        console.warn("[fluxo] entrada do WhatsApp não carregou:", (e as Error)?.message);
      }
    };

    void buscar();
    const relogio = setInterval(buscar, 60_000);
    return () => {
      vivo = false;
      clearInterval(relogio);
    };
  }, [state.currentUserId, state.isAuthenticated]);


  /* Os avisos de prazo saíram daqui.
     Eram gerados na montagem, varrendo as tarefas VISÍVEIS e endereçando cada
     aviso ao responsável — então um supervisor produzia avisos para a equipe
     inteira, que ficavam no navegador dele. Agora cada pessoa gera os seus, no
     login, em `gerarAvisosDePrazo`. Ver `notificacoes.functions.ts`. */

  /**
   * Placeholder para quando ainda não há ninguém na lista.
   *
   * Antes esta linha terminava em `state.users[0]!`, e aquele `!` era uma
   * promessa que só o dado falso cumpria: o seed nascia com nove pessoas, então
   * a lista nunca estava vazia. Sem ele, `currentUser` viraria `undefined` e a
   * primeira leitura de `.role` logo abaixo derrubaria o app inteiro.
   *
   * Isto acontece de verdade entre o carregamento da página e o `loginFromIam`,
   * e em qualquer navegador que abra o app com o armazenamento limpo.
   *
   * O `id` vazio é proposital: nenhuma tarefa aponta para "", então este objeto
   * nunca casa com nada nem aparece em ranking, em atribuição ou em menção. Ele
   * só existe para o tipo continuar sendo `User` e não `User | undefined`.
   */
  const currentUser = useMemo(
    () =>
      state.users.find((u) => u.id === state.currentUserId) ??
      state.users[0] ??
      USUARIO_AUSENTE,
    [state.users, state.currentUserId],
  );

  const visibleUsersForAssign = (): User[] => {
    if (currentUser.role === "gerente") return state.users;
    if (currentUser.role === "supervisor") {
      return state.users.filter(
        (u) => u.id === currentUser.id || u.supervisorId === currentUser.id,
      );
    }
    return state.users.filter((u) => u.id === currentUser.id);
  };

  const canAssignTo = (targetUserId: string) =>
    visibleUsersForAssign().some((u) => u.id === targetUserId);

  /**
   * Aviso de conclusão, com desfazer.
   *
   * Mora aqui e não nas telas porque são oito lugares que concluem tarefa — do
   * kanban ao modo foco — e o nono nasceria mudo. Os dois caminhos que chegam
   * em "concluida" (updateTask e moveTask) chamam esta função.
   */
  const avisarConclusao = (anterior: Task) => {
    // Não anunciar o que vai ser barrado: sem comprovante a conclusão não passa.
    if (anterior.requireProof && !taskHasProof(anterior)) return;
    const voltarPara = anterior.status;
    empilharDesfazer({
      label: `Concluída: ${anterior.title}`,
      undo: () =>
        setState((s) => {
          // Desfazer honesto: concluir também creditou pontos e gravou uma
          // entrada em completions. Voltar só o status deixaria placar fantasma.
          const i = s.completions.map((c) => c.taskId).lastIndexOf(anterior.id);
          const entrada = i >= 0 ? s.completions[i] : null;

          /* E a volta precisa chegar no banco.
             Sem esta gravação o desfazer era só efeito de tela: no servidor a
             tarefa continuava concluída e a linha de `gestor.conclusoes` valendo,
             então o ponto voltava no login seguinte. Quem apaga a conclusão é o
             próprio servidor, ao ver `concluida_em` voltar a ser nula. */
          const atual = s.tasks.find((t) => t.id === anterior.id);
          if (atual) void gravarTarefa({ ...atual, status: voltarPara });

          return {
            ...s,
            tasks: s.tasks.map((t) =>
              t.id === anterior.id ? { ...t, status: voltarPara } : t,
            ),
            completions: entrada ? s.completions.filter((_, k) => k !== i) : s.completions,
            users: entrada
              ? s.users.map((u) =>
                  u.id === entrada.userId
                    ? { ...u, score: Math.max(0, u.score - entrada.points) }
                    : u,
                )
              : s.users,
          };
        }),
    });
  };

  const handleCompletionSideEffects = (s: Persisted, prev: Task, next: Task): Persisted => {
    // Comemoração visual (sorteia 1 de 5 animações). Fora do ciclo de render.
    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        void import("@/components/celebration").then((m) => m.celebrate());
      });
    }
    const onTime = new Date(next.dueDate).getTime() >= Date.now();
    const points = computeScore(next.score, next.priority, onTime);

    // users score + streak recompute (simple: latest completion day)
    const users = s.users.map((u) =>
      u.id === next.assigneeId ? { ...u, score: u.score + points } : u,
    );

    /* Esta entrada é otimista: existe para o número subir na hora, junto com a
       comemoração. A conclusão de verdade é gravada pelo servidor, dentro do
       mesmo comando que muda a situação da tarefa, e substitui esta lista
       inteira no próximo login.

       As duas contas são a mesma fórmula, então o número não pula. O único
       ponto em que podem discordar é uma tarefa concluída no segundo exato do
       prazo: aqui o relógio é o do computador, lá é o do banco. */
    const completions: CompletionEntry[] = [
      ...s.completions,
      {
        id: rid("cp"),
        taskId: next.id,
        userId: next.assigneeId,
        points,
        priority: next.priority,
        onTime,
        at: nowIso(),
      },
    ];

    /* O aviso "tarefa concluída" para quem pediu a tarefa saiu daqui: quem o
       escreve agora é o servidor, no mesmo comando que grava a conclusão. Antes
       ele era empilhado neste navegador, endereçado a outra pessoa — e como a
       sineta só mostra o que é do próprio dono, ninguém nunca o viu. */

    const tasks = s.tasks.map((t) =>
      t.id === next.id
        ? pushActivity(
            { ...next },
            {
              kind: "concluida",
              userId: currentUser.id,
              text: `concluiu (${onTime ? "no prazo" : "com atraso"})`,
            },
            currentUser.id,
          )
        : t,
    );

    // Próxima ocorrência da série. A caixa "repete automaticamente ao concluir"
    // prometia isso desde sempre, mas a geração tinha sido removida no commit
    // e708d06 — a tarefa sumia ao concluir e nada voltava.
    void prev;
    const proxima = proximaOcorrencia(next);
    /* O id nasce UUID, e a ocorrência é gravada.
       Ela nascia com `rid("t")` — formato antigo — e `gravarTarefa` recusa esse
       formato em silêncio. O resultado era uma tarefa recorrente que voltava só
       neste navegador: quem concluísse a de segunda no computador de casa não
       teria a de terça no do trabalho. */
    const seguinte: Task | null = proxima
      ? {
          ...next,
          id: crypto.randomUUID(),
          createdAt: nowIso(),
          dueDate: proxima.toISOString(),
          status: "pendente" as Status,
          // A nova ocorrência começa limpa: histórico, conversa e provas são
          // da vez que passou. O checklist volta desmarcado, que é o ponto de
          // ter checklist numa tarefa que se repete.
          comments: [],
          activity: [
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "criada" as ActivityKind,
              text: "criada automaticamente pela recorrência",
            },
          ],
          checklist: next.checklist.map((c) => ({ ...c, id: rid("c"), done: false })),
          attachments: undefined,
          inPack: false,
        }
      : null;
    if (seguinte) void gravarTarefa(seguinte);

    return {
      ...s,
      tasks: seguinte ? [...tasks, seguinte] : tasks,
      users,
      completions,
    };
  };

  const store: Store = {
    ...state,
    login: (id) =>
      setState((s) => ({
        ...s,
        isAuthenticated: true,
        currentUserId: s.users.some((u) => u.id === id) ? id : s.currentUserId,
      })),
    loginFromIam: (u) => {
      const id = String(u.id);
      setState((s) => {
        const existente = s.users.find((x) => x.id === id);
        // Identidade vem da IAM; cargo, setor e hierarquia das tabelas de
        // colaboradores. Só a pontuação é do Fluxo e sobrevive ao relogin.
        const base = {
          name: u.nome,
          role: u.role,
          avatar: u.avatar,
          jobTitle: u.funcao || u.papeis[0] || "",
          sector: u.setorId || "sem-setor",
          email: u.email ?? existente?.email,
          phone: u.telefone ?? existente?.phone,
        };
        // O supervisor só vira vínculo quando essa pessoa também já tiver entrado.
        // O `!== id` é rede de segurança: pai apontando para si trava o passeio
        // por ancestrais em Contatos. O servidor já evita isso, mas o custo de
        // um laço infinito na tela não justifica confiar em uma camada só.
        const achado = u.supervisorNome
          ? s.users.find(
              (x) => x.name.trim().toLowerCase() === u.supervisorNome!.trim().toLowerCase(),
            )?.id
          : undefined;
        const supervisorId = achado && achado !== id ? achado : undefined;

        const user: User = existente
          ? { ...existente, ...base, supervisorId: supervisorId ?? existente.supervisorId }
          : { id, ...base, score: 0, streak: 0, supervisorId };

        return {
          ...s,
          users: existente ? s.users.map((x) => (x.id === id ? user : x)) : [...s.users, user],
          currentUserId: id,
          isAuthenticated: true,
        };
      });

      /* O que é do Fluxo vem do banco, logo depois.

         Repare no `score: 0, streak: 0` acima: numa máquina onde a pessoa nunca
         entrou, ela nascia zerada. A pontuação vivia no `localStorage`, então
         trocar de computador apagava a sequência de quem estava há semanas sem
         falhar um dia.

         A busca é assíncrona e não segura o login — a tela entra na hora, com
         zero, e corrige quando a resposta chega. É a mesma escrita otimista de
         sempre, ao contrário: mostra primeiro, confere depois. */
      void (async () => {
        try {
          const { meuPerfil } = await import("@/lib/perfil.functions");
          const p = await meuPerfil();
          setState((s) => ({
            ...s,
            users: s.users.map((x) =>
              x.id === id
                ? {
                    ...x,
                    score: p.pontuacao,
                    streak: p.sequencia,
                    contactCompleted: p.contatoConfirmado,
                  }
                : x,
            ),
          }));

          /* O quadro de pessoas — quem mais existe no Fluxo.
             Sem isto, `users` continha só quem tinha logado NESTE navegador, e
             o efeito era duplo: ninguém aparecia no Contatos de ninguém, e o
             seletor de responsável de uma tarefa nova mostrava só a própria
             pessoa, o que tornava a delegação impossível.

             Mescla, não substitui. Quem veio do banco entra completo; quem só
             existe aqui (criado antes da migração, sem id numérico) fica onde
             está, pelo mesmo motivo das atas: sumir da tela é perder. */
          const { listarPessoas } = await import("@/lib/perfil.functions");
          const { pessoas } = await listarPessoas();
          setState((s) => {
            const idPorNome = new Map(pessoas.map((p) => [p.nome.trim().toLowerCase(), p.id]));
            const doBanco: User[] = pessoas.map((p) => {
              const existente = s.users.find((u) => u.id === p.id);
              // Mesma rede de segurança do login: chefe apontando para si
              // trava o passeio por ancestrais em Contatos.
              const chefe = p.supervisorNome
                ? idPorNome.get(p.supervisorNome.trim().toLowerCase())
                : undefined;
              return {
                // O que é só do navegador — email, telefone, contactCompleted —
                // sobrevive porque o espalhamento vem primeiro.
                ...existente,
                id: p.id,
                name: p.nome,
                role: (p.papel ?? "adm") as Role,
                jobTitle: p.funcao ?? existente?.jobTitle ?? "",
                sector: p.setor ?? "sem-setor",
                avatar: p.avatar ?? iniciaisDoNome(p.nome),
                supervisorId:
                  chefe && chefe !== p.id ? chefe : existente?.supervisorId,
                score: p.pontuacao,
                streak: p.sequencia,
              };
            });
            const soLocais = s.users.filter((u) => !pessoas.some((p) => p.id === u.id));
            return { ...s, users: [...doBanco, ...soLocais] };
          });

          // Tema e paleta da pessoa, não da máquina.
          const { sincronizarPreferencias } = await import("@/lib/use-theme");
          await sincronizarPreferencias();

          /* As metas são coletivas: o alvo que o gerente traça vale para o
             setor inteiro. Vindas do banco, elas substituem por completo as
             locais — não há mescla, porque mesclar duas listas de meta produz
             alvos duplicados para a mesma pessoa e ninguém saberia qual vale.
             O banco passa a ser a verdade no instante em que ele responde. */
          const { listarMetas } = await import("@/lib/metas.functions");
          const { metas } = await listarMetas();
          setState((s) => ({ ...s, metas }));

          /* A contagem de chamadas volta no formato aninhado que o store usa:
             { quem chamou: { sala: { quem foi chamado: vezes } } }. Ela é
             sempre do ponto de vista de quem está logado, então só existe uma
             chave no primeiro nível. Antes isso morava no navegador — trocar de
             computador zerava "quem você mais chama" e a lista de recentes. */
          const { minhasContagens } = await import("@/lib/contagem-chamadas.functions");
          const { contagens } = await minhasContagens();
          if (contagens.length) {
            const porSala: Record<string, Record<string, number>> = {};
            for (const c of contagens) {
              porSala[c.sala] = { ...(porSala[c.sala] ?? {}), [c.paraPessoaId]: c.vezes };
            }
            setState((s) => ({ ...s, callCounts: { ...s.callCounts, [id]: porSala } }));
          }

          /* Projetos e modelos de pack: coletivos, como as metas.
             Um modelo de pack para "Supervisor de Operações" só faz sentido se
             outros supervisores puderem recebê-lo — no navegador, ele servia a
             uma pessoa só, o que anulava a ideia inteira.

             As duas listas substituem as locais em vez de mesclar. Mesclar
             produziria projetos duplicados assim que a mesma pessoa entrasse em
             dois computadores, e não haveria como saber qual dos dois é o bom. */
          const [{ listarProjetos }, { listarPacks }] = await Promise.all([
            import("@/lib/projetos.functions"),
            import("@/lib/packs.functions"),
          ]);
          const { listarTarefas } = await import("@/lib/tarefas.functions");
          const [proj, pk, tf] = await Promise.all([
            listarProjetos(),
            listarPacks(),
            listarTarefas(),
          ]);

          /* As tarefas do banco entram junto com as locais, não no lugar delas.
             Diferente de projetos e metas, aqui a mescla é necessária: o que já
             está no navegador foi criado antes desta migração e ainda não subiu.
             O id decide — quem veio do banco tem UUID, o que é local tem
             `t-mf3k2a`. Sem essa distinção, recarregar apagaria o trabalho não
             migrado de quem está usando o sistema hoje.

             Os satélites (checklist, comentários, histórico) vêm vazios: eles
             são o bloco D. Uma tarefa que volta do banco perde o checklist que
             tinha localmente — é a lacuna conhecida desta passagem, e some
             quando o bloco D entrar. */
          setState((s) => ({
            ...s,
            // As locais são as que ainda não subiram; as do banco entram
            // completas. A ordem coloca as do banco primeiro, como a consulta
            // já as devolve (por `ordem`, depois por data).
            tasks: [
              ...tf.tarefas.map((t) => ({
                ...t,
                mentions: [] as string[],
                tags: [] as string[],
                comments: [],
                checklist: [],
                activity: [],
              })),
              ...s.tasks.filter((t) => !ehGuid(t.id)),
            ],
            projects: proj.projetos.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              status: p.status,
              ownerId: p.ownerId,
              memberIds: p.memberIds,
              sector: p.sector,
              dueDate: p.dueDate,
              createdAt: p.createdAt,
              createdBy: p.createdBy,
              color: p.color,
              // Anexos vêm por `listarAnexos` quando o projeto é aberto — a
              // lista não carrega arquivo de todos os projetos de uma vez.
              attachments: [],
            })),
            packTemplates: pk.packs,
          }));

          /* Conclusões e sineta — bloco E.
             As duas substituem por completo o que havia no navegador. É o
             mesmo raciocínio das metas, com um agravante: uma conclusão local
             e a sua cópia do banco são a MESMA conclusão com ids diferentes, e
             mesclar contaria os pontos duas vezes. O ranking passaria a premiar
             quem tem mais navegadores.

             A ordem aqui importa. Os avisos de prazo são gerados antes de a
             lista ser lida — invertido, o atraso de hoje só apareceria na sineta
             no login de amanhã. */
          const [conc, notif] = await Promise.all([
            import("@/lib/conclusoes.functions"),
            import("@/lib/notificacoes.functions"),
          ]);
          await notif.gerarAvisosDePrazo().catch(() => {});
          const [cn, nt] = await Promise.all([
            conc.listarConclusoes(),
            notif.listarNotificacoes(),
          ]);
          setState((s) => ({
            ...s,
            completions: cn.conclusoes,
            notifications: nt.notificacoes,
          }));

          /* As atas — bloco F.
             Mescla, e não substituição, ao contrário de tudo acima. O motivo é
             o único caso em que as duas listas não são a mesma coisa: uma ata
             gerada antes desta migração existe só aqui, e não tem cópia no
             banco para substituí-la. Trocar a lista apagaria da tela o registro
             de reuniões que aconteceram — e ata some é ata perdida, porque
             ninguém a redigita. O id decide, como nas tarefas. */
          const { listarAtas } = await import("@/lib/atas.functions");
          const { atas } = await listarAtas();
          setState((s) => ({
            ...s,
            minutes: [...atas, ...(s.minutes ?? []).filter((m) => !ehGuid(m.id))],
          }));
        } catch (e) {
          // Falhar aqui não pode impedir ninguém de trabalhar: a pessoa entra
          // com pontuação zerada e o número se acerta no próximo login.
          console.warn("[fluxo] perfil não carregou do banco:", (e as Error)?.message);
        }
      })();
    },
    logout: () => {
      // Derruba também a sessão da IAM. Sem isto o cookie httpOnly sobreviveria
      // ao "sair" e a próxima pessoa na mesma máquina herdaria a sessão.
      // No-op quando a IAM está desligada; nunca deixa o logout local falhar.
      void iamLogout().catch(() => {});
      setState((s) => ({ ...s, isAuthenticated: false }));
    },
    setCurrentUserId: (id) => setState((s) => ({ ...s, currentUserId: id })),
    currentUser,

    createTask: (t) => {
      setState((s) => {
        /* UUID, e não mais `t-mf3k2a-x9d1`.
           É o que permite a tarefa entrar em `gestor.tarefas` — e, de quebra,
           é o que destrava o anexo de tarefa e de comentário, que precisavam
           de um dono com id de banco. */
        const id = crypto.randomUUID();
        const maxOrder =
          Math.max(0, ...s.tasks.filter((x) => x.status === t.status).map((x) => x.order)) + 1;
        const task: Task = {
          ...t,
          id,
          createdAt: nowIso(),
          order: maxOrder,
          comments: [],
          checklist: t.checklist ?? [],
          activity: [
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "criada",
              text: "criou esta tarefa",
            },
          ],
        };
        /* A gravação sai daqui de dentro, onde a tarefa montada existe.
           É ela que faz a delegação chegar: até hoje isto terminava aqui, com
           a tarefa no navegador de quem criou, e quem recebeu nunca soube.

           Os avisos de "nova tarefa" e de menção também saíam daqui, montados
           corretamente e endereçados a outras pessoas — para ficar guardados
           nesta máquina, onde a sineta de ninguém os leria. Quem os escreve
           agora é o servidor: a atribuição em `salvarTarefa`, a menção em
           `salvarSatelites`, cada um no comando que cria o fato. */
        void gravarTarefa(task);

        return { ...s, tasks: [task, ...s.tasks] };
      });
    },

    updateTask: (id, patch) => {
      const anterior = state.tasks.find((t) => t.id === id);
      if (patch.status === "concluida" && anterior && anterior.status !== "concluida") {
        avisarConclusao(anterior);
      }
      setState((s) => {
        const prev = s.tasks.find((t) => t.id === id);
        if (!prev) return s;
        if (
          patch.status &&
          patch.status !== prev.status &&
          blockIfMissingProof(prev, patch.status)
        ) {
          return s;
        }
        const next = { ...prev, ...patch } as Task;

        /* Os avisos de menção e de repasse eram montados aqui, com o mesmo
           destino de sempre: o `localStorage` de quem editou. O servidor agora
           compara o antes e o depois da própria linha — é a única versão que
           acerta, porque só ele sabe quem era o responsável ANTES desta
           gravação. O navegador sabe o que ele mesmo tinha em tela, que não é a
           mesma coisa quando duas pessoas mexem na tarefa no mesmo dia. */

        // activity log for status change
        const activityAdd: ActivityEntry[] = [];
        if (patch.status && patch.status !== prev.status) {
          activityAdd.push({
            id: rid("a"),
            at: nowIso(),
            userId: currentUser.id,
            kind: "status" as ActivityKind,
            text: `mudou o status para ${patch.status}`,
          });
        }
        if (patch.assigneeId && patch.assigneeId !== prev.assigneeId) {
          const to = s.users.find((u) => u.id === patch.assigneeId);
          activityAdd.push({
            id: rid("a"),
            at: nowIso(),
            userId: currentUser.id,
            kind: "atribuicao",
            text: `atribuiu para ${to?.name ?? "outro"}`,
          });
        }

        const withActivity: Task = { ...next, activity: [...next.activity, ...activityAdd] };

        /* Grava a tarefa já com a mudança aplicada.
           Sai daqui de dentro porque `salvarTarefa` regrava a linha inteira e
           precisa do objeto completo — montá-lo fora exigiria ler o estado de
           novo e correria o risco de pegar a versão anterior ao `patch`. */
        void gravarTarefa(withActivity);

        const base: Persisted = {
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? withActivity : t)),
        };
        if (patch.status === "concluida" && prev.status !== "concluida") {
          return handleCompletionSideEffects(base, prev, withActivity);
        }
        return base;
      });
    },

    /**
     * Tira a tarefa do quadro. O nome continua `deleteTask` porque é assim que
     * uma dúzia de telas a chamam — o que mudou é o que ela faz.
     *
     * Nada é apagado. Arquivar resolve o mesmo problema de quem clica (sumir
     * com o que não interessa mais) sem reescrever o passado: a conclusão
     * continua no placar, e a tarefa volta se tiver sido um engano.
     */
    deleteTask: (id) => {
      const alvo = state.tasks.find((t) => t.id === id);

      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));

      // Desfazer é barato agora que nada some de verdade.
      empilharDesfazer({
        label: alvo?.title ? `"${alvo.title}" arquivada` : "Tarefa arquivada",
        undo: () => {
          if (alvo) setState((s) => ({ ...s, tasks: [alvo, ...s.tasks] }));
          if (ehGuid(id)) {
            void import("@/lib/tarefas.functions")
              .then((api) => api.arquivarTarefa({ data: { id, arquivar: false } }))
              .catch(() => {});
          }
        },
      });

      /* O servidor confere de novo se quem arquivou é o responsável ou o
         criador — a tela não é a fechadura. */
      if (ehGuid(id)) {
        void import("@/lib/tarefas.functions")
          .then((api) => api.arquivarTarefa({ data: { id } }))
          .catch((e) => console.warn("[fluxo] tarefa não arquivou:", (e as Error)?.message));
      }
    },

    reorderTasks: (orderedIds) => {
      setState((s) => {
        const map = new Map(orderedIds.map((id, i) => [id, i]));
        const tarefas = s.tasks.map((t) =>
          map.has(t.id) ? { ...t, order: map.get(t.id)! } : t,
        );
        // Mesma razão do `moveTask`: a ordem é de todos, não de um.
        for (const t of tarefas) if (map.has(t.id)) void gravarTarefa(t);
        return { ...s, tasks: tarefas };
      });
    },

    moveTask: (id, status, targetIndex) => {
      const anterior = state.tasks.find((t) => t.id === id);
      if (status === "concluida" && anterior && anterior.status !== "concluida") {
        avisarConclusao(anterior);
      }
      setState((s) => {
        const prev = s.tasks.find((t) => t.id === id);
        if (!prev) return s;
        if (status !== prev.status && blockIfMissingProof(prev, status)) return s;
        const others = s.tasks.filter((t) => t.id !== id);
        const col = others.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
        const idx = targetIndex ?? col.length;
        const nextTask: Task = { ...prev, status };
        col.splice(idx, 0, nextTask);
        const reordered = col.map((t, i) => ({ ...t, order: i }));
        const rest = others.filter((t) => t.status !== status);
        let tasks = [...rest, ...reordered];

        if (status !== prev.status) {
          tasks = tasks.map((t) =>
            t.id === id
              ? pushActivity(
                  t,
                  { kind: "status", userId: currentUser.id, text: `moveu para ${status}` },
                  currentUser.id,
                )
              : t,
          );
        }

        /* Mover grava a coluna inteira, não só a tarefa arrastada: soltar um
           cartão no meio empurra a ordem de todos os que estão abaixo dele.
           Gravar só a arrastada deixaria a ordem certa nesta tela e errada em
           qualquer outra máquina. */
        for (const t of reordered) void gravarTarefa(t);

        const base: Persisted = { ...s, tasks };
        if (status === "concluida" && prev.status !== "concluida") {
          const updated = tasks.find((t) => t.id === id)!;
          return handleCompletionSideEffects(base, prev, updated);
        }
        return base;
      });
    },

    addComment: (taskId, text, attachments) => {
      if (!text.trim() && !(attachments && attachments.length)) return;
      setState((s) => {
        const t = s.tasks.find((x) => x.id === taskId);
        if (!t) return s;
        // UUID: o comentário é dono de anexo em `gestor.anexos`, e aquela
        // coluna é `uniqueidentifier`.
        const c = {
          id: crypto.randomUUID(),
          userId: currentUser.id,
          text: text.trim(),
          at: nowIso(),
          attachments: attachments && attachments.length ? attachments : undefined,
        };

        /* O comentário vai ao banco por função própria, e não junto com a
           tarefa. O motivo é a autoria: `comentarNaTarefa` grava o autor a
           partir da SESSÃO de quem escreveu. Se ele viajasse dentro de
           `salvarTarefa`, o autor seria quem salvou a tarefa por último — e um
           comentário assinado pela pessoa errada é pior que comentário nenhum.

           O histórico vai junto, pelo mesmo caminho: quem comentou é quem
           aparece no registro. */
        if (ehGuid(taskId)) {
          void (async () => {
            try {
              const api = await import("@/lib/tarefa-satelites.functions");
              await api.comentarNaTarefa({ data: { tarefaId: taskId, texto: c.text } });
              await api.registrarHistorico({
                data: { tarefaId: taskId, tipo: "comentario", texto: "comentou" },
              });
            } catch (e) {
              console.warn("[fluxo] comentário não gravou:", (e as Error)?.message);
            }
          })();
        }
        const updated = pushActivity(
          { ...t, comments: [...t.comments, c] },
          { kind: "comentario", userId: currentUser.id, text: "comentou" },
          currentUser.id,
        );
        /* O aviso do comentário vai junto com o comentário, no servidor.
           A lista de quem precisa saber — responsável, quem pediu a tarefa e
           quem está mencionado — sai da tarefa gravada, não da cópia em tela:
           uma menção acrescentada por outra pessoa hoje de manhã existe lá e
           pode não existir aqui. */
        return {
          ...s,
          tasks: s.tasks.map((x) => (x.id === taskId ? updated : x)),
        };
      });
    },

    addTaskAttachments: (taskId, atts) => {
      if (!atts.length) return;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? pushActivity(
                { ...t, attachments: [...(t.attachments ?? []), ...atts] },
                {
                  kind: "editada",
                  userId: currentUser.id,
                  text: `anexou ${atts.length} arquivo${atts.length > 1 ? "s" : ""}`,
                },
                currentUser.id,
              )
            : t,
        ),
      }));
    },

    removeTaskAttachment: (taskId, attId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, attachments: (t.attachments ?? []).filter((a) => a.id !== attId) }
            : t,
        ),
      }));
    },

    addChecklistItem: (taskId, text) => {
      if (!text.trim()) return;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? pushActivity(
                {
                  ...t,
                  checklist: [...t.checklist, { id: rid("ck"), text: text.trim(), done: false }],
                },
                { kind: "checklist", userId: currentUser.id, text: `adicionou "${text.trim()}"` },
                currentUser.id,
              )
            : t,
        ),
      }));
    },

    toggleChecklistItem: (taskId, itemId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
              }
            : t,
        ),
      }));
    },

    removeChecklistItem: (taskId, itemId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, checklist: t.checklist.filter((c) => c.id !== itemId) } : t,
        ),
      }));
    },

    createUser: (u) => {
      setState((s) => {
        const id = rid("u");
        const user: User = { ...u, id, score: 0, streak: 0 };
        return { ...s, users: [...s.users, user] };
      });
    },

    updateUser: (id, patch) => {
      setState((s) => ({
        ...s,
        users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
      }));
    },

    updateCurrentUser: (patch) => {
      setState((s) => ({
        ...s,
        users: s.users.map((u) => (u.id === s.currentUserId ? { ...u, ...patch } : u)),
      }));
    },

    deleteUser: (id) => {
      setState((s) => {
        if (s.users.length <= 1) return s;
        const remaining = s.users.filter((u) => u.id !== id);
        // reassign tasks assigned to this user to the first gerente
        const fallback = remaining.find((u) => u.role === "gerente") ?? remaining[0]!;
        const tasks = s.tasks.map((t) =>
          t.assigneeId === id ? { ...t, assigneeId: fallback.id } : t,
        );
        return {
          ...s,
          users: remaining,
          tasks,
          currentUserId: s.currentUserId === id ? fallback.id : s.currentUserId,
        };
      });
    },

    upsertMeta: (m) => {
      setState((s) => {
        const existing = s.metas.find(
          (x) =>
            x.scope === m.scope &&
            x.scopeId === m.scopeId &&
            x.period === m.period &&
            x.metric === m.metric,
        );
        if (existing) {
          return {
            ...s,
            metas: s.metas.map((x) =>
              x.id === existing.id ? { ...existing, target: m.target } : x,
            ),
          };
        }
        return { ...s, metas: [...s.metas, { ...m, id: rid("m") }] };
      });

      /* Escrita otimista: a tela já mudou acima, o banco fica sabendo agora.
         A meta é a primeira coisa do estado principal a sair do navegador — até
         hoje o alvo do setor existia só na máquina de quem o definiu, o que
         significa que ninguém mais via a meta que o gerente traçou. */
      void import("@/lib/metas.functions")
        .then((api) => api.salvarMeta({ data: m }))
        .catch((e) => console.warn("[fluxo] meta não gravou:", (e as Error)?.message));
    },

    removeMeta: (id) => {
      setState((s) => ({ ...s, metas: s.metas.filter((m) => m.id !== id) }));
      // Só remove no banco o que tem id de banco. As metas criadas antes desta
      // migração têm id do formato antigo (`m-mf3k2a-x9d1`) e existem apenas
      // no navegador — mandar esse id ao servidor daria erro de formato.
      if (/^[0-9a-f-]{36}$/i.test(id)) {
        void import("@/lib/metas.functions")
          .then((api) => api.removerMeta({ data: { id } }))
          .catch((e) => console.warn("[fluxo] meta não removeu:", (e as Error)?.message));
      }
    },

    /* Lida é estado da pessoa, não do computador.
       Sem a ida ao servidor, quem limpasse a sineta no Tauri encontraria os
       mesmos avisos por ler ao abrir o navegador — e a bolinha vermelha, que só
       vale se for confiável, viraria enfeite. A escrita é otimista: a tela
       apaga na hora, o banco fica sabendo depois. */
    markNotifRead: (id) => {
      // Só o formato novo vai ao servidor. As notificações que já estavam no
      // navegador têm `n-mf3k2a-x9d1` e não existem em `gestor.notificacoes`.
      if (ehGuid(id)) {
        void import("@/lib/notificacoes.functions")
          .then((api) => api.marcarNotificacaoLida({ data: { id } }))
          .catch((e) => console.warn("[fluxo] aviso não marcou:", (e as Error)?.message));
      }
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      }));
    },

    markAllNotifsRead: () => {
      void import("@/lib/notificacoes.functions")
        .then((api) => api.marcarTodasLidas())
        .catch((e) => console.warn("[fluxo] avisos não marcaram:", (e as Error)?.message));
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) =>
          n.userId === s.currentUserId ? { ...n, read: true } : n,
        ),
      }));
    },

    callUserToRoom: (targetUserId, roomName, roomLabel) => {
      if (targetUserId !== currentUser.id) {
        /* A contagem vai à parte da chamada, de propósito.
           Chamar alguém e registrar que você chamou são coisas diferentes: se
           a contagem falhar, a chamada continua tocando. Perder um atalho de
           conveniência não pode derrubar uma ligação. */
        void import("@/lib/contagem-chamadas.functions")
          .then((api) => api.somarChamada({ data: { sala: roomName, paraPessoaId: targetUserId } }))
          .catch(() => {});

        createRoomCall({
          data: {
            targetUserId,
            roomName,
            roomLabel,
          },
        }).catch((err) => {
          console.error("Falha ao chamar usuário", err);
        });

        /* O aviso na sineta é o rastro da chamada, e vale por si.
           `createRoomCall` faz o telefone tocar AGORA — se a pessoa estiver
           longe da mesa, some sem deixar nada. Este aviso é o que ela encontra
           quando volta. Por isso são duas gravações e não uma. */
        void import("@/lib/notificacoes.functions")
          .then((api) =>
            api.avisar({
              data: {
                paraPessoaId: targetUserId,
                tipo: "mencao",
                // Sem o nome aqui: a sineta o coloca na frente, a partir de
                // `de_pessoa_id`, e sempre com o nome atual da pessoa.
                titulo: "está te chamando",
                descricao: `Toque para entrar agora na sala ${roomLabel}`,
                sala: roomName,
                tituloDaSala: roomLabel,
              },
            }),
          )
          .catch(() => {});
      }
      setState((s) => {
        if (targetUserId === s.currentUserId) return s;
        const prevCounts = s.callCounts[currentUser.id] ?? {};
        const roomMap = prevCounts[roomName] ?? {};
        const nextCallCounts = {
          ...s.callCounts,
          [currentUser.id]: {
            ...prevCounts,
            [roomName]: { ...roomMap, [targetUserId]: (roomMap[targetUserId] ?? 0) + 1 },
          },
        };
        const prevRecents = s.recentContactsByUser?.[currentUser.id] ?? [];
        const nextRecents = [
          targetUserId,
          ...prevRecents.filter((id) => id !== targetUserId),
        ].slice(0, 10);
        const recentContactsByUser = {
          ...(s.recentContactsByUser ?? {}),
          [currentUser.id]: nextRecents,
        };
        return { ...s, callCounts: nextCallCounts, recentContactsByUser };
      });
    },

    topContactsForRoom: (roomName, limit = 3) => {
      const roomMap = state.callCounts[state.currentUserId]?.[roomName] ?? {};
      return state.users
        .filter((u) => u.id !== state.currentUserId)
        .map((u) => ({ u, c: roomMap[u.id] ?? 0 }))
        .filter((x) => x.c > 0)
        .sort((a, b) => b.c - a.c)
        .slice(0, limit)
        .map((x) => x.u);
    },

    recentContactIds: state.recentContactsByUser?.[state.currentUserId] ?? [],
    recentContactUsers: (limit = 5) => {
      const ids = state.recentContactsByUser?.[state.currentUserId] ?? [];
      const out: User[] = [];
      for (const id of ids) {
        const u = state.users.find((x) => x.id === id);
        if (u && u.id !== state.currentUserId) out.push(u);
        if (out.length >= limit) break;
      }
      return out;
    },

    dismissRoomCall: (notifId) => {
      if (ehGuid(notifId)) {
        void import("@/lib/notificacoes.functions")
          .then((api) => api.marcarNotificacaoLida({ data: { id: notifId } }))
          .catch(() => {});
      }
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === notifId ? { ...n, read: true } : n)),
      }));
    },

    addMissedCallNotification: (fromUserId, roomName, roomLabel) => {
      /* O registro vai ao banco na minha própria caixa — ver
         `registrarChamadaPerdida`. A janela de 60s que evita a duplicata está
         lá também, do lado que sobrevive a um recarregamento. */
      void import("@/lib/notificacoes.functions")
        .then((api) =>
          api.registrarChamadaPerdida({
            data: { deQuemChamou: fromUserId, sala: roomName, tituloDaSala: roomLabel },
          }),
        )
        .catch(() => {});

      setState((s) => {
        // A mesma janela, aqui, para o aviso aparecer sem esperar a ida e volta.
        const cutoff = Date.now() - 60_000;
        const dupe = s.notifications.some(
          (n) =>
            n.type === "chamada_perdida" &&
            n.userId === s.currentUserId &&
            n.fromUserId === fromUserId &&
            n.roomName === roomName &&
            new Date(n.at).getTime() > cutoff,
        );
        if (dupe) return s;
        const notif: Notification = {
          id: rid("n"),
          userId: s.currentUserId,
          type: "chamada_perdida",
          title: "Chamada perdida",
          desc: `Toque para retornar a ligação na sala ${roomLabel}`,
          at: nowIso(),
          roomName,
          roomLabel,
          fromUserId,
        };
        return { ...s, notifications: [notif, ...s.notifications] };
      });
    },

    canAssignTo,
    visibleUsersForAssign,

    taskDialog,
    openNewTask: (opts) =>
      setQuickCreate({ open: true, status: opts?.status, dueDate: opts?.dueDate }),
    openTask: (id) => {
      setTaskDialog({ open: true, editingId: id });

      /* Os satélites chegam quando a tarefa é aberta, não na listagem.
         Trazer checklist, comentários e histórico de todas as tarefas no login
         seria seis consultas por tarefa para desenhar um quadro que mostra só
         título e prazo. Aqui é uma consulta por tabela, uma vez, para a tarefa
         que a pessoa está de fato olhando.

         Como é assíncrono, o painel abre com o que já está em memória e se
         completa em seguida — o mesmo padrão do perfil no login. */
      if (!ehGuid(id)) return;
      void (async () => {
        try {
          const { carregarSatelites } = await import("@/lib/tarefa-satelites.functions");
          const s = await carregarSatelites({ data: { tarefaId: id } });
          setState((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id
                ? {
                    ...t,
                    checklist: s.checklist,
                    mentions: s.mentions,
                    tags: s.tags,
                    recurringWeekdays: s.recurringWeekdays,
                    comments: s.comments.map((c) => ({
                      id: c.id,
                      userId: c.userId,
                      text: c.text,
                      at: c.at,
                      attachments: [],
                    })),
                    activity: s.activity.map((a) => ({
                      id: a.id,
                      userId: a.userId,
                      kind: a.kind as ActivityKind,
                      text: a.text,
                      at: a.at,
                    })),
                  }
                : t,
            ),
          }));
        } catch (e) {
          console.warn("[fluxo] detalhes da tarefa não carregaram:", (e as Error)?.message);
        }
      })();
    },
    closeTaskDialog: () => setTaskDialog({ open: false }),
    quickCreate,
    openQuickCreate: (opts) =>
      setQuickCreate({
        open: true,
        status: opts?.status,
        dueDate: opts?.dueDate,
        assigneeId: opts?.assigneeId,
      }),
    closeQuickCreate: () => setQuickCreate({ open: false }),

    minutes: state.minutes ?? [],
    saveMinute: (m) => {
      /* UUID na ata e em cada tópico. Os tópicos chegam com `top-mf3k2a` de
         `meeting-extras`, e é aqui que viram id de banco — normalizar na
         gravação evita depender de quem chama lembrar do formato. */
      const minute: MeetingMinute = {
        ...m,
        id: crypto.randomUUID(),
        createdAt: nowIso(),
        createdBy: currentUser.id,
        topics: m.topics.map((t) => ({ ...t, id: ehGuid(t.id) ? t.id : crypto.randomUUID() })),
      };
      setState((s) => ({ ...s, minutes: [minute, ...(s.minutes ?? [])] }));

      /* O par nome↔pessoa é remontado aqui.
         A tela produz dois arrays soltos: os nomes vêm do LiveKit, os ids vêm
         de decifrar a identidade de cada participante. A tabela guarda UMA
         linha por participante, com o id ao lado do nome — e é esse formato que
         responde "quem estava nesta reunião" sem depender de os dois arrays
         terem o mesmo tamanho, que eles não têm: um participante cujo nome não
         casou entra só na lista de nomes. */
      const porNome = new Map<string, string | null>();
      for (const nome of minute.participantNames) {
        if (nome && !porNome.has(nome)) porNome.set(nome, null);
      }
      for (const id of minute.participantIds) {
        const nome = state.users.find((u) => u.id === id)?.name;
        // Sem nome conhecido não há linha possível: `nome` é parte da chave.
        // Com nome diferente do exibido no LiveKit, entra uma linha própria —
        // perder isso custaria à pessoa o acesso à ata de que participou.
        if (nome) porNome.set(nome, id);
      }

      void (async () => {
        try {
          const api = await import("@/lib/atas.functions");
          await api.salvarAta({
            data: {
              id: minute.id,
              roomName: minute.roomName,
              roomLabel: minute.roomLabel,
              markdown: minute.markdown,
              participantes: [...porNome].map(([nome, pessoaId]) => ({ nome, pessoaId })),
              topicos: minute.topics.map((t) => ({ id: t.id, text: t.text, kind: t.kind })),
            },
          });
        } catch (e) {
          console.warn("[fluxo] ata não gravou:", (e as Error)?.message);
        }
      })();

      return minute;
    },
    deleteMinute: (id) => {
      setState((s) => ({ ...s, minutes: (s.minutes ?? []).filter((x) => x.id !== id) }));
      if (ehGuid(id)) {
        void import("@/lib/atas.functions")
          .then((api) => api.apagarAta({ data: { id } }))
          .catch((e) => console.warn("[fluxo] ata não apagou:", (e as Error)?.message));
      }
    },
    minuteTopicToTask: (minuteId, topicId) => {
      const minute = (state.minutes ?? []).find((m) => m.id === minuteId);
      const topic = minute?.topics.find((t) => t.id === topicId);
      if (!minute || !topic) return undefined;
      if (topic.taskId) return topic.taskId;
      /* UUID, e gravada. Nascia com `t-mf3k2a`, que `gravarTarefa` recusa em
         silêncio — o tópico virava uma tarefa que só existia nesta máquina, o
         que é especialmente ruim numa ata, onde o "vira tarefa" é a promessa
         de que a reunião produziu alguma coisa. */
      const newTaskId = crypto.randomUUID();
      setState((s) => {
        const maxOrder =
          Math.max(0, ...s.tasks.filter((x) => x.status === "pendente").map((x) => x.order)) + 1;
        const task: Task = {
          id: newTaskId,
          title: topic.text.slice(0, 140),
          description: `Gerado automaticamente da ata "${minute.roomLabel}" em ${new Date(
            minute.createdAt,
          ).toLocaleDateString("pt-BR")}.`,
          sector: currentUser.sector,
          createdBy: currentUser.id,
          assigneeId: currentUser.id,
          mentions: [],
          frequency: "diaria",
          status: "pendente",
          score: 10,
          dueDate: new Date(Date.now() + 3 * 24 * 3600e3).toISOString(),
          recurring: false,
          priority: "media",
          tags: ["ata"],
          createdAt: nowIso(),
          order: maxOrder,
          comments: [],
          checklist: [],
          activity: [
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "criada",
              text: `criou esta tarefa a partir da ata "${minute.roomLabel}"`,
            },
          ],
        };
        void gravarTarefa(task);

        /* E o tópico aponta para a tarefa, no banco.
           É esse vínculo que faz a ata mostrar quantos tópicos já viraram
           tarefa, e é ele que impede o mesmo tópico de virar duas — a trava de
           verdade está no servidor, porque a ata pode estar aberta em duas
           máquinas e os dois cliques chegariam lá. */
        if (ehGuid(topicId)) {
          void import("@/lib/atas.functions")
            .then((api) =>
              api.ligarTopicoATarefa({ data: { topicoId: topicId, tarefaId: newTaskId } }),
            )
            .catch((e) => console.warn("[fluxo] tópico não ligou:", (e as Error)?.message));
        }

        const minutes = (s.minutes ?? []).map((mm) =>
          mm.id === minuteId
            ? {
                ...mm,
                topics: mm.topics.map((t) => (t.id === topicId ? { ...t, taskId: newTaskId } : t)),
              }
            : mm,
        );
        return { ...s, tasks: [task, ...s.tasks], minutes };
      });
      return newTaskId;
    },
    visibleMinutes: () =>
      (state.minutes ?? []).filter(
        (m) =>
          m.createdBy === currentUser.id || m.participantIds.includes(currentUser.id),
      ),

    // === Projetos ===
    createProject: (p) => {
      /* O id nasce aqui e é UUID, não mais `prj-mf3k2a`.
         Duas razões: ele precisa caber em `uniqueidentifier`, e a tela precisa
         de um id AGORA — quem clica em "criar" já é levado para o projeto,
         antes de a rede responder. Gerar no cliente permite as duas coisas.
         O banco aceita o id que mandamos em vez de gerar o dele. */
      const id = crypto.randomUUID();
      setState((s) => ({
        ...s,
        projects: [
          { ...p, id, createdAt: nowIso(), createdBy: currentUser.id },
          ...s.projects,
        ],
      }));

      void import("@/lib/projetos.functions")
        .then((api) =>
          api.salvarProjeto({
            data: {
              id,
              name: p.name,
              description: p.description,
              status: p.status,
              ownerId: p.ownerId,
              memberIds: p.memberIds,
              sector: p.sector,
              dueDate: p.dueDate,
              color: p.color,
            },
          }),
        )
        .catch((e) => console.warn("[fluxo] projeto não gravou:", (e as Error)?.message));

      return id;
    },
    updateProject: (id, patch) => {
      setState((s) => {
        const atualizado = s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p));

        /* A gravação precisa do projeto INTEIRO, não do trecho alterado: o
           `salvarProjeto` regrava a linha e a lista de membros de uma vez.
           Por isso ela sai daqui de dentro, onde o objeto completo existe —
           montá-la fora exigiria ler o estado de novo e correr o risco de
           pegar a versão anterior à mudança. */
        const p = atualizado.find((x) => x.id === id);
        if (p && /^[0-9a-f-]{36}$/i.test(id)) {
          void import("@/lib/projetos.functions")
            .then((api) =>
              api.salvarProjeto({
                data: {
                  id: p.id,
                  name: p.name,
                  description: p.description,
                  status: p.status,
                  ownerId: p.ownerId,
                  memberIds: p.memberIds,
                  sector: p.sector,
                  dueDate: p.dueDate,
                  color: p.color,
                },
              }),
            )
            .catch((e) => console.warn("[fluxo] projeto não gravou:", (e as Error)?.message));
        }

        return { ...s, projects: atualizado };
      });
    },
    addProjectAttachments: (projectId, atts) => {
      if (!atts.length) return;
      setState((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === projectId
            ? { ...p, attachments: [...(p.attachments ?? []), ...atts] }
            : p,
        ),
      }));
    },
    removeProjectAttachment: (projectId, attId) =>
      setState((s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === projectId
            ? { ...p, attachments: (p.attachments ?? []).filter((a) => a.id !== attId) }
            : p,
        ),
      })),
    deleteProject: (id) => {
      setState((s) => ({
        ...s,
        projects: s.projects.filter((p) => p.id !== id),
        // Desliga as subtarefas do projeto (elas continuam como tarefa normal)
        tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
      }));

      /* O banco faz o mesmo sozinho: a chave estrangeira de `tarefas` para
         `projetos` é `ON DELETE SET NULL`, então a tarefa sobrevive ao projeto
         e fica sem ele. Os membros saem por cascata. Conferido em sys.foreign_keys,
         não suposto — se fosse NO_ACTION, este DELETE falharia. */
      if (/^[0-9a-f-]{36}$/i.test(id)) {
        void import("@/lib/projetos.functions")
          .then((api) => api.apagarProjeto({ data: { id } }))
          .catch((e) => console.warn("[fluxo] projeto não apagou:", (e as Error)?.message));
      }
    },
    visibleProjects: () => {
      if (currentUser.role === "gerente") return state.projects;
      return state.projects.filter(
        (p) => p.ownerId === currentUser.id || p.memberIds.includes(currentUser.id),
      );
    },
    projectTasks: (projectId) => state.tasks.filter((t) => t.projectId === projectId),

    // === Pack templates ===
    createPackTemplate: (p) => {
      // UUID pelo mesmo motivo do projeto: cabe na coluna, e a tela precisa do
      // id antes de a rede responder.
      const id = crypto.randomUUID();
      const modelo: PackTemplate = {
        ...p,
        id,
        createdAt: nowIso(),
        createdBy: currentUser.id,
      };
      setState((s) => ({ ...s, packTemplates: [modelo, ...s.packTemplates] }));
      void gravarPack(modelo);
      return id;
    },
    updatePackTemplate: (id, patch) => {
      setState((s) => {
        const atualizados = s.packTemplates.map((p) => (p.id === id ? { ...p, ...patch } : p));

        // Como no projeto: `salvarPack` regrava o modelo E a lista de itens,
        // então precisa do objeto inteiro, que só existe aqui dentro.
        const p = atualizados.find((x) => x.id === id);
        if (p && ehGuid(id)) void gravarPack(p);

        return { ...s, packTemplates: atualizados };
      });
    },
    deletePackTemplate: (id) => {
      setState((s) => ({
        ...s,
        packTemplates: s.packTemplates.filter((p) => p.id !== id),
      }));
      // Os itens saem por cascata — conferido em sys.foreign_keys.
      if (ehGuid(id)) {
        void import("@/lib/packs.functions")
          .then((api) => api.apagarPack({ data: { id } }))
          .catch((e) => console.warn("[fluxo] modelo não apagou:", (e as Error)?.message));
      }
    },
    applyPackTemplate: (templateId, targetUserId) => {
      const tpl = state.packTemplates.find((p) => p.id === templateId);
      const target = state.users.find((u) => u.id === targetUserId);
      if (!tpl || !target) return 0;
      const end = new Date();
      end.setHours(23, 59, 0, 0);
      const dueISO = end.toISOString();
      const newTasks: Task[] = tpl.items.map((item, i) => ({
        // UUID, e gravadas logo abaixo. Nasciam com `t-mf3k2a-x9d1`, que
        // `gravarTarefa` recusa em silêncio: aplicar um pack em outra pessoa
        // enchia o quadro de quem aplicou e não chegava a ninguém — o mesmo
        // defeito que `createTask` tinha, no caminho que ninguém tinha olhado.
        id: crypto.randomUUID(),
        title: item.title,
        sector: target.sector,
        createdBy: currentUser.id,
        assigneeId: targetUserId,
        mentions: targetUserId !== currentUser.id ? [targetUserId] : [],
        frequency: "diaria",
        status: "pendente",
        score: 10,
        dueDate: dueISO,
        recurring: false,
        priority: "media",
        tags: ["pack", `modelo:${tpl.name}`],
        createdAt: nowIso(),
        order: i,
        comments: [],
        checklist: [],
        activity: [
          {
            id: rid("a"),
            at: nowIso(),
            userId: currentUser.id,
            kind: "criada",
            text: `criou pelo modelo de pack "${tpl.name}"`,
          },
        ],
        inPack: true,
        estimatedMinutes: item.estimatedMinutes,
      }));
      newTasks.forEach((t) => void gravarTarefa(t));

      /* Um aviso só para o pack inteiro. As tarefas de pack não avisam uma a
         uma — a regra está no servidor, em `salvarTarefa`, olhando `no_pack`. */
      if (targetUserId !== currentUser.id) {
        void import("@/lib/notificacoes.functions")
          .then((api) =>
            api.avisar({
              data: {
                paraPessoaId: targetUserId,
                tipo: "atribuida",
                titulo: `Pack "${tpl.name}" atribuído a você`,
                descricao: `${newTasks.length} ${newTasks.length === 1 ? "tarefa" : "tarefas"} adicionadas ao seu pack de hoje`,
              },
            }),
          )
          .catch((e) => console.warn("[fluxo] aviso do pack não saiu:", (e as Error)?.message));
      }

      setState((s) => ({ ...s, tasks: [...newTasks, ...s.tasks] }));
      return newTasks.length;
    },
    transferPack: (fromUserId, toUserId) => {
      if (fromUserId === toUserId) return 0;

      /* A conta é feita FORA do `setState`.
         Estava dentro, somando numa variável de fora do updater — e o React
         chama o updater duas vezes em desenvolvimento, então a tela dizia
         "16 tarefas movidas" quando eram 8. Aqui o número é contado uma vez,
         a partir do estado atual, e é ele que a tela recebe. */
      const target = state.users.find((u) => u.id === toUserId);
      const movidas = state.tasks
        .filter((t) => t.assigneeId === fromUserId && t.inPack && t.status !== "concluida")
        .map((t) => ({
          ...t,
          assigneeId: toUserId,
          sector: target?.sector ?? t.sector,
          activity: [
            ...t.activity,
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "atribuicao" as ActivityKind,
              text: `pack transferido para ${target?.name ?? "outro usuário"}`,
            },
          ],
        }));
      if (movidas.length === 0) return 0;

      // Transferir também não chegava ao banco: o pack mudava de dono só aqui.
      movidas.forEach((t) => void gravarTarefa(t));

      void import("@/lib/notificacoes.functions")
        .then((api) =>
          api.avisar({
            data: {
              paraPessoaId: toUserId,
              tipo: "atribuida",
              titulo: "Pack transferido para você",
              descricao: `${movidas.length} ${movidas.length === 1 ? "tarefa" : "tarefas"} agora ${movidas.length === 1 ? "está" : "estão"} no seu pack`,
            },
          }),
        )
        .catch((e) => console.warn("[fluxo] aviso do pack não saiu:", (e as Error)?.message));

      const porId = new Map(movidas.map((t) => [t.id, t]));
      setState((s) => ({ ...s, tasks: s.tasks.map((t) => porId.get(t.id) ?? t) }));
      return movidas.length;
    },
  };

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useFluxo() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useFluxo must be used inside FluxoProvider");
  return ctx;
}
