export type Role = "gerente" | "supervisor" | "adm";
export type Frequency = "diaria" | "semanal" | "mensal";
export type Status = "pendente" | "andamento" | "revisao" | "concluida";
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

export const sectors = [
  { id: "comercial", name: "Comercial", color: "oklch(0.62 0.16 155)" },
  { id: "operacoes", name: "Operações", color: "oklch(0.62 0.16 230)" },
  { id: "marketing", name: "Marketing", color: "oklch(0.6 0.2 330)" },
  { id: "financeiro", name: "Financeiro", color: "oklch(0.78 0.15 75)" },
  { id: "rh", name: "Recursos Humanos", color: "oklch(0.52 0.22 275)" },
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
  revisao: "Em revisão",
  concluida: "Concluída",
};

export const priorityLabels: Record<Priority, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const priorityMultiplier: Record<Priority, number> = {
  alta: 1.5,
  media: 1,
  baixa: 0.75,
};

export const priorityColor: Record<Priority, string> = {
  alta: "oklch(0.58 0.22 25)",
  media: "oklch(0.72 0.15 70)",
  baixa: "oklch(0.55 0.02 260)",
};

export const statusColor: Record<Status, string> = {
  pendente: "oklch(0.55 0.02 260)",
  andamento: "oklch(0.52 0.22 275)",
  revisao: "oklch(0.78 0.15 75)",
  concluida: "oklch(0.62 0.16 155)",
};