export type Role = "gerente" | "supervisor" | "adm";
export type Frequency = "diaria" | "semanal" | "mensal";
export type Status = "pendente" | "andamento" | "concluida";
export type Priority = "alta" | "media" | "baixa";

export interface User {
  id: string;
  name: string;
  role: Role;
  jobTitle: string;
  sector: string;
  avatar: string;
  supervisorId?: string; // for adm users, who supervises them
  score: number;
  streak: number;
  email?: string;
  phone?: string;
  contactCompleted?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  at: string;
  userId: string;
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  at: string;
  attachments?: Attachment[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type ActivityKind =
  | "criada"
  | "status"
  | "atribuicao"
  | "comentario"
  | "checklist"
  | "editada"
  | "concluida"
  | "mencao";

export interface ActivityEntry {
  id: string;
  at: string;
  userId: string;
  kind: ActivityKind;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  sector: string;
  createdBy: string;
  assigneeId: string;
  mentions: string[]; // user ids mentioned
  frequency: Frequency;
  status: Status;
  score: number;
  dueDate: string; // ISO
  recurring: boolean;
  recurringUntil?: string | null;
  /**
   * Dias da semana em que repete, quando `frequency` é "semanal".
   * 0 = domingo … 6 = sábado. Vazio ou ausente = repete no mesmo dia da semana
   * do prazo atual, que é o comportamento de quem não escolheu nada.
   */
  recurringWeekdays?: number[] | null;
  /**
   * Dia do mês em que repete, quando `frequency` é "mensal".
   * 1 a 31, ou -1 para "último dia do mês". Ausente = mantém o dia do prazo.
   * Meses curtos são tratados por `proximaOcorrencia`: dia 31 em fevereiro cai
   * no dia 28/29, em vez de escorregar para março.
   */
  recurringMonthDay?: number | null;
  priority: Priority;
  tags: string[];
  createdAt: string;
  order: number; // for kanban ordering
  comments: Comment[];
  checklist: ChecklistItem[];
  activity: ActivityEntry[];
  attachments?: Attachment[];
  /**
   * Marks the task as part of "Meu pack" — the user's daily non-negotiables.
   * Only meaningful for the task's assignee.
   */
  inPack?: boolean;
  /**
   * Se true, exige pelo menos um anexo (comprovante) antes de marcar como concluída.
   * Ex: conciliação bancária, pagamento, envio de relatório.
   */
  requireProof?: boolean;
  /**
   * Tempo estimado (em minutos) para executar essa tarefa. Opcional.
   */
  estimatedMinutes?: number;
  /**
   * Se preenchido, a tarefa é uma subtarefa de um Projeto.
   * A subtarefa continua sendo a tarefa do dia-a-dia do assignee.
   */
  projectId?: string;
}

export type ProjectStatus = "ativo" | "pausado" | "concluido";

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  ownerId: string;      // criador / responsável do projeto
  memberIds: string[];  // pessoas participando do projeto
  sector?: string;
  dueDate?: string;     // ISO
  createdAt: string;
  createdBy: string;
  color?: string;       // ex.: oklch(...)
  /**
   * Fotos e arquivos de acompanhamento do projeto — telas, comprovantes,
   * evidências. Visíveis a todos que enxergam o projeto.
   */
  attachments?: Attachment[];
}

export type PackTemplateScope = "cargo" | "pessoa";

export interface PackTemplateItem {
  id: string;
  title: string;
  estimatedMinutes?: number;
}

export interface PackTemplate {
  id: string;
  name: string;                 // ex.: "Supervisor de Operações"
  scope: PackTemplateScope;     // cargo (jobTitle) ou pessoa (userId)
  targetJobTitle?: string;      // usado quando scope="cargo"
  targetUserId?: string;        // usado quando scope="pessoa"
  items: PackTemplateItem[];
  description?: string;
  createdBy: string;
  createdAt: string;
}

export interface MinuteTopic {
  id: string;
  text: string;
  kind: "decisao" | "proximo" | "atencao";
  taskId?: string; // if converted to task
}

export interface MeetingMinute {
  id: string;
  roomName: string;
  roomLabel: string;
  createdAt: string; // ISO
  createdBy: string; // userId who generated
  participantIds: string[]; // user ids (best-effort match)
  participantNames: string[];
  markdown: string;
  topics: MinuteTopic[];
}

export interface Notification {
  id: string;
  userId: string; // recipient
  type: "mencao" | "atribuida" | "prazo" | "concluida" | "chamada_perdida";
  title: string;
  desc: string;
  at: string; // ISO
  read?: boolean;
  taskId?: string;
  roomName?: string;
  roomLabel?: string;
  fromUserId?: string;
}

export interface Meta {
  id: string;
  scope: "user" | "sector";
  scopeId: string;
  period: Frequency;
  metric: "tarefas" | "pontos";
  target: number;
}

export interface CompletionEntry {
  id: string;
  taskId: string;
  userId: string;
  points: number;
  priority: Priority;
  onTime: boolean;
  at: string;
}

/**
 * Setores reais da empresa, como aparecem em `COLABORADORES.SETOR`.
 * Os ids são os slugs produzidos por `setorParaId()` — mudar um exige mudar o outro.
 */
export const sectors = [
  { id: "campo", name: "Campo", color: "oklch(0.792 0.181 146)" },
  { id: "gestao", name: "Gestão", color: "oklch(0.746 0.148 233)" },
  { id: "rh", name: "Recursos Humanos", color: "oklch(0.70 0.19 288)" },
  { id: "pcp", name: "PCP", color: "oklch(0.72 0.20 330)" },
  { id: "administrativo", name: "Administrativo", color: "oklch(0.828 0.171 84)" },
  { id: "financeiro", name: "Financeiro", color: "oklch(0.80 0.16 60)" },
  { id: "qualidade", name: "Qualidade", color: "oklch(0.75 0.15 190)" },
  { id: "seguranca", name: "Segurança", color: "oklch(0.70 0.20 25)" },
  { id: "apoio", name: "Apoio", color: "oklch(0.74 0.12 165)" },
  { id: "compras", name: "Compras", color: "oklch(0.76 0.16 105)" },
  { id: "ti", name: "TI", color: "oklch(0.70 0.17 265)" },
  { id: "manutencao", name: "Manutenção", color: "oklch(0.72 0.14 45)" },
  { id: "frotas", name: "Frotas", color: "oklch(0.68 0.13 210)" },
  { id: "controladoria", name: "Controladoria", color: "oklch(0.73 0.15 310)" },
  { id: "dho", name: "DHO", color: "oklch(0.76 0.14 350)" },
  { id: "facilities", name: "Facilities", color: "oklch(0.71 0.11 130)" },
  { id: "sem-setor", name: "Sem setor", color: "oklch(0.60 0.02 260)" },
];

export const roleLabels: Record<Role, string> = {
  gerente: "Gerente Geral",
  supervisor: "Supervisor",
  adm: "ADM (Colaborador)",
};

export const freqLabels: Record<Frequency, string> = {
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

export const statusLabels: Record<Status, string> = {
  pendente: "A fazer",
  andamento: "Em andamento",
  concluida: "Concluída",
};

export const priorityLabels: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const priorityMultiplier: Record<Priority, number> = {
  alta: 1,
  media: 1,
  baixa: 1,
};

/* Valores claros o bastante para contrastar no tema escuro. */
export const priorityColor: Record<Priority, string> = {
  alta: "oklch(0.70 0.20 20)",
  media: "oklch(0.828 0.171 84)",
  baixa: "oklch(0.66 0.03 155)",
};

export const statusColor: Record<Status, string> = {
  pendente: "oklch(0.68 0.025 155)",
  andamento: "oklch(0.746 0.148 233)",
  concluida: "oklch(0.792 0.181 146)",
};