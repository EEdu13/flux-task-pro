import type { Task, User, Notification } from "./fluxo-types";

function daysFromNow(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(17, 0, 0, 0);
  return dt.toISOString();
}

export const seedUsers: User[] = [
  // Gerente Geral
  { id: "u1", name: "Carla Mendes", role: "gerente", jobTitle: "Head de Operações", sector: "operacoes", avatar: "CM", score: 3120, streak: 18 },
  // Supervisores
  { id: "u2", name: "Bruno Tavares", role: "supervisor", jobTitle: "Coordenador", sector: "operacoes", avatar: "BT", score: 2612, streak: 8 },
  { id: "u3", name: "Ana Ribeiro", role: "supervisor", jobTitle: "Head Comercial", sector: "comercial", avatar: "AR", score: 2840, streak: 12 },
  { id: "u4", name: "Camila Souza", role: "supervisor", jobTitle: "Lider de Marketing", sector: "marketing", avatar: "CS", score: 2498, streak: 15 },
  // ADM (colaboradores individuais)
  { id: "u5", name: "Diego Lima", role: "adm", jobTitle: "Analista Financeiro", sector: "financeiro", avatar: "DL", score: 2210, streak: 5, supervisorId: "u2" },
  { id: "u6", name: "Elisa Prado", role: "adm", jobTitle: "Business Partner RH", sector: "rh", avatar: "EP", score: 2085, streak: 9, supervisorId: "u1" },
  { id: "u7", name: "Felipe Costa", role: "adm", jobTitle: "Executivo de Vendas", sector: "comercial", avatar: "FC", score: 1940, streak: 4, supervisorId: "u3" },
  { id: "u8", name: "Gabriela Nunes", role: "adm", jobTitle: "Designer", sector: "marketing", avatar: "GN", score: 1720, streak: 6, supervisorId: "u4" },
  { id: "u9", name: "Henrique Sá", role: "adm", jobTitle: "Analista de Ops", sector: "operacoes", avatar: "HS", score: 1560, streak: 3, supervisorId: "u2" },
];

export const seedTasks: Task[] = [
  {
    id: "t1", title: "Alinhamento com clientes-chave", description: "Reunião trimestral com top 5 contas.",
    sector: "comercial", createdBy: "u3", assigneeId: "u3", mentions: ["u1"],
    frequency: "diaria", status: "andamento", score: 40, dueDate: daysFromNow(0),
    recurring: true, priority: "alta", tags: ["Cliente"], createdAt: daysFromNow(-2), order: 0,
  },
  {
    id: "t2", title: "Fechar pipeline da semana", description: "",
    sector: "comercial", createdBy: "u3", assigneeId: "u7", mentions: [],
    frequency: "diaria", status: "pendente", score: 30, dueDate: daysFromNow(0),
    recurring: false, priority: "alta", tags: [], createdAt: daysFromNow(-1), order: 0,
  },
  {
    id: "t3", title: "Revisar OKRs do trimestre", description: "",
    sector: "operacoes", createdBy: "u1", assigneeId: "u2", mentions: [],
    frequency: "diaria", status: "concluida", score: 25, dueDate: daysFromNow(-1),
    recurring: false, priority: "media", tags: ["OKR"], createdAt: daysFromNow(-3), order: 0,
  },
  {
    id: "t4", title: "Publicar campanha de lançamento", description: "",
    sector: "marketing", createdBy: "u4", assigneeId: "u8", mentions: ["u4"],
    frequency: "semanal", status: "andamento", score: 80, dueDate: daysFromNow(3),
    recurring: false, priority: "alta", tags: ["Campanha"], createdAt: daysFromNow(-4), order: 0,
  },
  {
    id: "t5", title: "Auditoria de contas a pagar", description: "",
    sector: "financeiro", createdBy: "u5", assigneeId: "u5", mentions: [],
    frequency: "semanal", status: "pendente", score: 60, dueDate: daysFromNow(4),
    recurring: true, priority: "media", tags: [], createdAt: daysFromNow(-2), order: 1,
  },
  {
    id: "t6", title: "1:1 com liderança de setor", description: "",
    sector: "rh", createdBy: "u1", assigneeId: "u6", mentions: ["u2", "u3"],
    frequency: "semanal", status: "andamento", score: 50, dueDate: daysFromNow(2),
    recurring: true, priority: "media", tags: [], createdAt: daysFromNow(-5), order: 1,
  },
  {
    id: "t7", title: "Relatório de desempenho mensal", description: "",
    sector: "operacoes", createdBy: "u2", assigneeId: "u2", mentions: ["u1"],
    frequency: "mensal", status: "pendente", score: 150, dueDate: daysFromNow(12),
    recurring: false, priority: "alta", tags: ["Relatório"], createdAt: daysFromNow(-8), order: 0,
  },
  {
    id: "t8", title: "Planejamento de metas Q4", description: "",
    sector: "comercial", createdBy: "u1", assigneeId: "u3", mentions: [],
    frequency: "mensal", status: "andamento", score: 200, dueDate: daysFromNow(15),
    recurring: false, priority: "alta", tags: ["Estratégia"], createdAt: daysFromNow(-10), order: 1,
  },
  {
    id: "t9", title: "Pesquisa de clima organizacional", description: "",
    sector: "rh", createdBy: "u6", assigneeId: "u6", mentions: [],
    frequency: "mensal", status: "pendente", score: 120, dueDate: daysFromNow(20),
    recurring: true, priority: "baixa", tags: [], createdAt: daysFromNow(-6), order: 2,
  },
];

export const seedNotifications: Notification[] = [
  { id: "n1", userId: "u3", type: "atribuida", title: "Nova tarefa atribuída", desc: "Planejamento de metas Q4", time: "há 2h", taskId: "t8" },
  { id: "n2", userId: "u1", type: "mencao", title: "Você foi mencionado", desc: "Alinhamento com clientes-chave", time: "há 5min", taskId: "t1" },
  { id: "n3", userId: "u7", type: "prazo", title: "Prazo se aproximando", desc: "Fechar pipeline vence hoje", time: "há 40min", taskId: "t2" },
];