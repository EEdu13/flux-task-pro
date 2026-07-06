import type { CompletionEntry, Meta, Notification, Task, User } from "./fluxo-types";

function daysFromNow(d: number, hour = 17): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(hour, 0, 0, 0);
  return dt.toISOString();
}

function taskBase(t: Omit<Task, "comments" | "checklist" | "activity">): Task {
  return {
    ...t,
    comments: [],
    checklist: [],
    activity: [
      {
        id: `a-${t.id}-c`,
        at: t.createdAt,
        userId: t.createdBy,
        kind: "criada",
        text: "criou esta tarefa",
      },
    ],
  };
}

export const seedUsers: User[] = [
  { id: "u1", name: "Carla Mendes", role: "gerente", jobTitle: "Head de Operações", sector: "operacoes", avatar: "CM", score: 3120, streak: 18 },
  { id: "u2", name: "Bruno Tavares", role: "supervisor", jobTitle: "Coordenador", sector: "operacoes", avatar: "BT", score: 2612, streak: 8, supervisorId: "u1" },
  { id: "u3", name: "Ana Ribeiro", role: "supervisor", jobTitle: "Head Comercial", sector: "comercial", avatar: "AR", score: 2840, streak: 12, supervisorId: "u1" },
  { id: "u4", name: "Camila Souza", role: "supervisor", jobTitle: "Líder de Marketing", sector: "marketing", avatar: "CS", score: 2498, streak: 15, supervisorId: "u1" },
  { id: "u5", name: "Diego Lima", role: "adm", jobTitle: "Analista Financeiro", sector: "financeiro", avatar: "DL", score: 2210, streak: 5, supervisorId: "u2" },
  { id: "u6", name: "Elisa Prado", role: "adm", jobTitle: "Business Partner RH", sector: "rh", avatar: "EP", score: 2085, streak: 9, supervisorId: "u1" },
  { id: "u7", name: "Felipe Costa", role: "adm", jobTitle: "Executivo de Vendas", sector: "comercial", avatar: "FC", score: 1940, streak: 4, supervisorId: "u3" },
  { id: "u8", name: "Gabriela Nunes", role: "adm", jobTitle: "Designer", sector: "marketing", avatar: "GN", score: 1720, streak: 6, supervisorId: "u4" },
  { id: "u9", name: "Henrique Sá", role: "adm", jobTitle: "Analista de Ops", sector: "operacoes", avatar: "HS", score: 1560, streak: 3, supervisorId: "u2" },
];

export const seedTasks: Task[] = [
  taskBase({
    id: "t1", title: "Alinhamento com clientes-chave", description: "Reunião trimestral com top 5 contas.",
    sector: "comercial", createdBy: "u3", assigneeId: "u3", mentions: ["u1"],
    frequency: "diaria", status: "andamento", score: 40, dueDate: daysFromNow(0),
    recurring: true, priority: "alta", tags: ["Cliente"], createdAt: daysFromNow(-2), order: 0,
  }),
  taskBase({
    id: "t2", title: "Fechar pipeline da semana", description: "",
    sector: "comercial", createdBy: "u3", assigneeId: "u7", mentions: [],
    frequency: "diaria", status: "pendente", score: 30, dueDate: daysFromNow(0),
    recurring: false, priority: "alta", tags: [], createdAt: daysFromNow(-1), order: 0,
  }),
  taskBase({
    id: "t3", title: "Revisar OKRs do trimestre", description: "",
    sector: "operacoes", createdBy: "u1", assigneeId: "u2", mentions: [],
    frequency: "diaria", status: "concluida", score: 25, dueDate: daysFromNow(-1),
    recurring: false, priority: "media", tags: ["OKR"], createdAt: daysFromNow(-3), order: 0,
  }),
  taskBase({
    id: "t4", title: "Publicar campanha de lançamento", description: "",
    sector: "marketing", createdBy: "u4", assigneeId: "u8", mentions: ["u4"],
    frequency: "semanal", status: "andamento", score: 80, dueDate: daysFromNow(3),
    recurring: false, priority: "alta", tags: ["Campanha"], createdAt: daysFromNow(-4), order: 0,
  }),
  taskBase({
    id: "t5", title: "Auditoria de contas a pagar", description: "",
    sector: "financeiro", createdBy: "u5", assigneeId: "u5", mentions: [],
    frequency: "semanal", status: "pendente", score: 60, dueDate: daysFromNow(4),
    recurring: true, priority: "media", tags: [], createdAt: daysFromNow(-2), order: 1,
  }),
  taskBase({
    id: "t6", title: "1:1 com liderança de setor", description: "",
    sector: "rh", createdBy: "u1", assigneeId: "u6", mentions: ["u2", "u3"],
    frequency: "semanal", status: "andamento", score: 50, dueDate: daysFromNow(2),
    recurring: true, priority: "media", tags: [], createdAt: daysFromNow(-5), order: 1,
  }),
  taskBase({
    id: "t7", title: "Relatório de desempenho mensal", description: "",
    sector: "operacoes", createdBy: "u2", assigneeId: "u2", mentions: ["u1"],
    frequency: "mensal", status: "pendente", score: 150, dueDate: daysFromNow(12),
    recurring: false, priority: "alta", tags: ["Relatório"], createdAt: daysFromNow(-8), order: 0,
  }),
  taskBase({
    id: "t8", title: "Planejamento de metas Q4", description: "",
    sector: "comercial", createdBy: "u1", assigneeId: "u3", mentions: [],
    frequency: "mensal", status: "andamento", score: 200, dueDate: daysFromNow(15),
    recurring: false, priority: "alta", tags: ["Estratégia"], createdAt: daysFromNow(-10), order: 1,
  }),
  taskBase({
    id: "t9", title: "Pesquisa de clima organizacional", description: "",
    sector: "rh", createdBy: "u6", assigneeId: "u6", mentions: [],
    frequency: "mensal", status: "pendente", score: 120, dueDate: daysFromNow(20),
    recurring: true, priority: "baixa", tags: [], createdAt: daysFromNow(-6), order: 2,
  }),
];

export const seedNotifications: Notification[] = [
  { id: "n1", userId: "u3", type: "atribuida", title: "Nova tarefa atribuída", desc: "Planejamento de metas Q4", at: new Date(Date.now() - 2 * 3600e3).toISOString(), taskId: "t8" },
  { id: "n2", userId: "u1", type: "mencao", title: "Você foi mencionado", desc: "Alinhamento com clientes-chave", at: new Date(Date.now() - 5 * 60e3).toISOString(), taskId: "t1" },
  { id: "n3", userId: "u7", type: "prazo", title: "Prazo se aproximando", desc: "Fechar pipeline vence hoje", at: new Date(Date.now() - 40 * 60e3).toISOString(), taskId: "t2" },
];

export const seedMetas: Meta[] = [
  { id: "m1", scope: "user", scopeId: "u3", period: "semanal", metric: "tarefas", target: 8 },
  { id: "m2", scope: "user", scopeId: "u7", period: "semanal", metric: "tarefas", target: 6 },
  { id: "m3", scope: "user", scopeId: "u8", period: "semanal", metric: "pontos", target: 300 },
  { id: "m4", scope: "sector", scopeId: "comercial", period: "mensal", metric: "pontos", target: 1500 },
  { id: "m5", scope: "sector", scopeId: "marketing", period: "mensal", metric: "pontos", target: 1200 },
  { id: "m6", scope: "sector", scopeId: "operacoes", period: "mensal", metric: "tarefas", target: 40 },
];

function seedCompletionsGen(): CompletionEntry[] {
  const arr: CompletionEntry[] = [];
  const authors = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"];
  // deterministic-ish seed: use index-based pseudo-random to keep hydration stable
  let s = 42;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let d = 30; d >= 0; d--) {
    const n = 1 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const uid = authors[Math.floor(rand() * authors.length)]!;
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      dt.setHours(10 + Math.floor(rand() * 8), 0, 0, 0);
      arr.push({
        id: `cp-${d}-${i}`,
        taskId: "seed",
        userId: uid,
        points: 15 + Math.floor(rand() * 60),
        priority: (["alta", "media", "baixa"] as const)[Math.floor(rand() * 3)]!,
        onTime: rand() > 0.25,
        at: dt.toISOString(),
      });
    }
  }
  return arr;
}

export const seedCompletions: CompletionEntry[] = seedCompletionsGen();