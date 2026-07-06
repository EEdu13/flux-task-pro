export type Role = "colaborador" | "gestor_setor" | "gestor_geral";
export type Frequency = "diaria" | "semanal" | "mensal";
export type Status = "pendente" | "andamento" | "concluida";

export interface Task {
  id: string;
  title: string;
  sector: string;
  assignee: string;
  frequency: Frequency;
  status: Status;
  score: number;
  dueLabel: string;
  recurring?: boolean;
  priority: "alta" | "media" | "baixa";
}

export interface Collaborator {
  id: string;
  name: string;
  role: string;
  sector: string;
  score: number;
  streak: number;
  avatar: string;
}

export const sectors = [
  { id: "todos", name: "Todos os setores", icon: "🌐" },
  { id: "comercial", name: "Comercial", icon: "📈" },
  { id: "operacoes", name: "Operações", icon: "⚙️" },
  { id: "marketing", name: "Marketing", icon: "✨" },
  { id: "financeiro", name: "Financeiro", icon: "💎" },
  { id: "rh", name: "Recursos Humanos", icon: "🧭" },
];

export const collaborators: Collaborator[] = [
  { id: "1", name: "Ana Ribeiro", role: "Analista Sr.", sector: "Comercial", score: 2840, streak: 12, avatar: "AR" },
  { id: "2", name: "Bruno Tavares", role: "Coordenador", sector: "Operações", score: 2612, streak: 8, avatar: "BT" },
  { id: "3", name: "Camila Souza", role: "Designer", sector: "Marketing", score: 2498, streak: 15, avatar: "CS" },
  { id: "4", name: "Diego Lima", role: "Analista", sector: "Financeiro", score: 2210, streak: 5, avatar: "DL" },
  { id: "5", name: "Elisa Prado", role: "Business Partner", sector: "RH", score: 2085, streak: 9, avatar: "EP" },
  { id: "6", name: "Felipe Costa", role: "Executivo", sector: "Comercial", score: 1940, streak: 4, avatar: "FC" },
];

export const tasks: Task[] = [
  { id: "t1", title: "Alinhamento com clientes-chave", sector: "Comercial", assignee: "Ana Ribeiro", frequency: "diaria", status: "andamento", score: 40, dueLabel: "Hoje · 14:00", recurring: true, priority: "alta" },
  { id: "t2", title: "Fechar pipeline da semana", sector: "Comercial", assignee: "Felipe Costa", frequency: "diaria", status: "pendente", score: 30, dueLabel: "Hoje · 17:00", priority: "alta" },
  { id: "t3", title: "Revisar OKRs do trimestre", sector: "Operações", assignee: "Bruno Tavares", frequency: "diaria", status: "concluida", score: 25, dueLabel: "Concluída 11:30", priority: "media" },
  { id: "t4", title: "Publicar campanha de lançamento", sector: "Marketing", assignee: "Camila Souza", frequency: "semanal", status: "andamento", score: 80, dueLabel: "Qui · 18:00", priority: "alta" },
  { id: "t5", title: "Auditoria de contas a pagar", sector: "Financeiro", assignee: "Diego Lima", frequency: "semanal", status: "pendente", score: 60, dueLabel: "Sex · 12:00", recurring: true, priority: "media" },
  { id: "t6", title: "1:1 com liderança de setor", sector: "RH", assignee: "Elisa Prado", frequency: "semanal", status: "andamento", score: 50, dueLabel: "Qua · 10:00", recurring: true, priority: "media" },
  { id: "t7", title: "Relatório de desempenho mensal", sector: "Operações", assignee: "Bruno Tavares", frequency: "mensal", status: "pendente", score: 150, dueLabel: "28/07", priority: "alta" },
  { id: "t8", title: "Planejamento de metas Q4", sector: "Comercial", assignee: "Ana Ribeiro", frequency: "mensal", status: "andamento", score: 200, dueLabel: "30/07", priority: "alta" },
  { id: "t9", title: "Pesquisa de clima organizacional", sector: "RH", assignee: "Elisa Prado", frequency: "mensal", status: "pendente", score: 120, dueLabel: "25/07", recurring: true, priority: "baixa" },
];

export const notifications = [
  { id: "n1", type: "meta", title: "Meta diária alcançada", desc: "Setor Comercial atingiu 92% da meta", time: "há 5 min" },
  { id: "n2", type: "aviso", title: "Tarefa recorrente criada", desc: "Auditoria semanal atribuída a Diego Lima", time: "há 22 min" },
  { id: "n3", type: "alerta", title: "Prazo se aproximando", desc: "Fechar pipeline vence em 3h", time: "há 40 min" },
  { id: "n4", type: "conquista", title: "Nova conquista desbloqueada", desc: "Camila Souza — 15 dias consecutivos", time: "há 1h" },
];