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
  priority: Priority;
  tags: string[];
  createdAt: string;
  order: number; // for kanban ordering
}

export interface Notification {
  id: string;
  userId: string; // recipient
  type: "mencao" | "atribuida" | "prazo" | "concluida";
  title: string;
  desc: string;
  time: string;
  read?: boolean;
  taskId?: string;
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