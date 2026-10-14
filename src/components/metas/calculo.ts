import { feriadoNacional } from "@/lib/dias-uteis";
import type { CompletionEntry, Meta, Task, User } from "@/lib/fluxo-types";
import { venceEm } from "@/lib/prazo";
import { janelaDoPlacar } from "@/lib/score";

/*
 * As contas da aba Metas & Score (reforma de 13/10/2026).
 *
 * Tudo aqui é puro e roda no navegador, em cima do que o `useFluxo` já trouxe:
 * nenhuma consulta nova ao banco. O Azure já bateu no teto de DTU uma vez, e um
 * painel que se abre na TV da sala não pode ser o motivo da segunda.
 *
 * A regra do score NÃO mudou: conta a tarefa cujo prazo cai no período; vale 1
 * se concluída no prazo, ½ se concluída com atraso e 0 se ainda aberta. O que
 * mudou é a leitura: "0%" de quem ainda tem tudo dentro do prazo passa a dizer
 * "nada concluído ainda", e não mais "0 perdidas · 0 em atraso", que soava como
 * contradição.
 */

/* Isto é um PERÍODO, não uma frequência de tarefa.
   Parece a mesma coisa e não é — e a confusão entre as duas deixava a aba
   Mensal permanentemente vazia. O filtro exigia `t.frequency === period`, ou
   seja, "tarefas cuja recorrência é mensal", e não "tarefas que vencem neste
   mês". Agora a aba escolhe só a janela de datas; a recorrência da tarefa não
   entra na conta. A Semanal entrou em 13/10/2026 (segunda a domingo, como no
   resto do app). */
export type Periodo = "diaria" | "semanal" | "mensal" | "personalizado";

export const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: "diaria", rotulo: "Diário" },
  { id: "semanal", rotulo: "Semanal" },
  { id: "mensal", rotulo: "Mensal" },
  { id: "personalizado", rotulo: "Personalizado" },
];

export interface Janela {
  start: Date;
  end: Date;
  label: string;
}

export type EstadoDaTarefa = "on-time" | "late" | "pending" | "missed";

export interface TaskScore {
  task: Task;
  state: EstadoDaTarefa;
  points: number;
}

export interface UserScore {
  user: User;
  assigned: number;
  points: number;
  onTime: number;
  late: number;
  pending: number;
  missed: number;
  pct: number;
  breakdown: TaskScore[];
}

/** Os quatro estados somam o total — é o que a Distribuição precisa mostrar. */
export interface Contagem {
  assigned: number;
  points: number;
  onTime: number;
  late: number;
  pending: number;
  missed: number;
  /** null quando não há tarefa: "sem dado" não é o mesmo que 0%. */
  pct: number | null;
}

const DIA = 86_400_000;

/**
 * Converte "2026-09-01" do <input type="date"> em meia-noite LOCAL.
 *
 * `new Date("2026-09-01")` seria meia-noite em UTC, que no Brasil é 21h do dia
 * anterior — e o período inteiro escorregaria um dia.
 */
export function dataLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ddmm = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export function periodRange(
  period: Periodo,
  ref = new Date(),
  personalizado?: { de: string; ate: string },
): Janela {
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (period === "personalizado") {
    const de = dataLocal(personalizado?.de ?? "");
    const ate = dataLocal(personalizado?.ate ?? "");
    /* Datas incompletas ou invertidas caem no mês corrente em vez de mostrar
       uma tela vazia no meio da digitação. */
    if (de && ate && ate.getTime() >= de.getTime()) {
      // O fim é EXCLUSIVO na comparação: soma um dia para o último entrar inteiro.
      const fim = new Date(ate);
      fim.setDate(fim.getDate() + 1);
      const fmt = (d: Date) => d.toLocaleDateString("pt-BR");
      return { start: de, end: fim, label: `${fmt(de)} a ${fmt(ate)}` };
    }
    return periodRange("mensal", ref);
  }

  if (period === "diaria") {
    end.setDate(start.getDate() + 1);
    return {
      start,
      end,
      label: start.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }),
    };
  }

  if (period === "semanal") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
    const ultimo = new Date(end.getTime() - DIA);
    return { start, end, label: `semana de ${ddmm(start)} a ${ddmm(ultimo)}` };
  }

  start.setDate(1);
  end.setTime(start.getTime());
  end.setMonth(start.getMonth() + 1);
  return {
    start,
    end,
    label: start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
  };
}

export function ehDiaUtil(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !feriadoNacional(d);
}

/**
 * O período anterior equivalente, para a tendência do score.
 *
 * No Diário é o dia útil anterior, não "ontem": na segunda, comparar com o
 * domingo (sem tarefa nenhuma) daria sempre "sem comparação". No Mensal é o
 * mês anterior inteiro; no Semanal, a semana anterior; no Personalizado, a
 * mesma quantidade de dias logo antes do início.
 */
export function janelaAnterior(period: Periodo, atual: Janela): Janela {
  if (period === "diaria") {
    const d = new Date(atual.start);
    do d.setDate(d.getDate() - 1);
    while (!ehDiaUtil(d));
    return periodRange("diaria", d);
  }
  if (period === "semanal") {
    const d = new Date(atual.start);
    d.setDate(d.getDate() - 7);
    return periodRange("semanal", d);
  }
  if (period === "mensal") {
    const d = new Date(atual.start);
    d.setMonth(d.getMonth() - 1);
    return periodRange("mensal", d);
  }
  const dias = Math.round((atual.end.getTime() - atual.start.getTime()) / DIA);
  const start = new Date(atual.start);
  start.setDate(start.getDate() - dias);
  const ultimo = new Date(atual.start.getTime() - DIA);
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR");
  return { start, end: new Date(atual.start), label: `${fmt(start)} a ${fmt(ultimo)}` };
}

/** O prazo cai no período? Sem prazo não cai em período nenhum. */
export function prazoNoPeriodo(t: Task, range: { start: Date; end: Date }): boolean {
  if (!t.dueDate) return false;
  const due = new Date(t.dueDate).getTime();
  return due >= range.start.getTime() && due < range.end.getTime();
}

export function scoreTask(task: Task, completionAt: string | null, now = Date.now()): TaskScore {
  // Sem prazo: não há atraso possível. Concluída vale inteira; aberta, pendente.
  // O prazo vence no fim do dia útil, não no horário — ver `venceEm`.
  const due = venceEm(task);
  if (task.status === "concluida") {
    const done = completionAt ? new Date(completionAt).getTime() : now;
    if (done <= due) return { task, state: "on-time", points: 1 };
    return { task, state: "late", points: 0.5 };
  }
  if (due < now) return { task, state: "missed", points: 0 };
  return { task, state: "pending", points: 0 };
}

/** Nome do período para os rótulos. */
export function periodoLabel(p: Periodo): string {
  return p === "diaria"
    ? "diário"
    : p === "semanal"
      ? "semanal"
      : p === "mensal"
        ? "mensal"
        : "personalizado";
}

/**
 * Hora da conclusão de cada tarefa, num mapa. Fica com a PRIMEIRA entrada da
 * lista, igual ao `completions.find` que a tela usava — mesmo resultado, sem
 * varrer a lista inteira para cada tarefa.
 */
export function mapaDeConclusoes(
  completions: { taskId: string; at: string }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of completions) if (!m.has(c.taskId)) m.set(c.taskId, c.at);
  return m;
}

/** As tarefas COM prazo de cada pessoa do conjunto. Sem prazo não pontua. */
export function tarefasPorPessoa(tasks: Task[], ids: Set<string>): Map<string, Task[]> {
  const m = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.dueDate || !ids.has(t.assigneeId)) continue;
    const lista = m.get(t.assigneeId);
    if (lista) lista.push(t);
    else m.set(t.assigneeId, [t]);
  }
  return m;
}

export function contar(itens: TaskScore[]): Contagem {
  const c: Contagem = {
    assigned: itens.length,
    points: 0,
    onTime: 0,
    late: 0,
    pending: 0,
    missed: 0,
    pct: null,
  };
  for (const b of itens) {
    c.points += b.points;
    if (b.state === "on-time") c.onTime++;
    else if (b.state === "late") c.late++;
    else if (b.state === "pending") c.pending++;
    else c.missed++;
  }
  c.pct = c.assigned ? (c.points / c.assigned) * 100 : null;
  return c;
}

export function somar(lista: Contagem[]): Contagem {
  const c = contar([]);
  for (const x of lista) {
    c.assigned += x.assigned;
    c.points += x.points;
    c.onTime += x.onTime;
    c.late += x.late;
    c.pending += x.pending;
    c.missed += x.missed;
  }
  c.pct = c.assigned ? (c.points / c.assigned) * 100 : null;
  return c;
}

/** O placar de uma pessoa numa janela. */
export function pontuarPessoa(
  user: User,
  tarefas: Task[],
  range: { start: Date; end: Date },
  conclusoes: Map<string, string>,
  now = Date.now(),
): UserScore {
  const breakdown = tarefas
    .filter((t) => prazoNoPeriodo(t, range))
    .map((t) => scoreTask(t, conclusoes.get(t.id) ?? null, now));
  const c = contar(breakdown);
  return {
    user,
    assigned: c.assigned,
    points: c.points,
    onTime: c.onTime,
    late: c.late,
    pending: c.pending,
    missed: c.missed,
    pct: c.pct ?? 0,
    breakdown,
  };
}

/* ————— Fatias do período (eixo do gráfico, do mapa de calor e das minilinhas) ————— */

export interface Fatia {
  start: Date;
  end: Date;
  /** Rótulo curto do eixo: "13/10" ou "sem 13/10". */
  rotulo: string;
  /** Rótulo da dica: "seg, 13/10". */
  rotuloLongo: string;
  /** Ainda não começou: entra no mapa (o que vem por aí), não na linha. */
  futura: boolean;
  util: boolean;
}

/**
 * Corta o período em dias (ou semanas, num personalizado longo).
 *
 * O Diário é um dia só — um gráfico de um ponto não conta história nenhuma.
 * Nele a evolução mostra os últimos 10 dias úteis até hoje, e o subtítulo diz
 * isso com todas as letras.
 */
export function fatiasDoPeriodo(
  period: Periodo,
  range: Janela,
  agora = new Date(),
): { fatias: Fatia[]; descricao: string } {
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const diaria = (d: Date): Fatia => {
    const s = new Date(d);
    const e = new Date(d);
    e.setDate(e.getDate() + 1);
    return {
      start: s,
      end: e,
      rotulo: ddmm(s),
      rotuloLongo: s.toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      }),
      futura: s.getTime() > agora.getTime(),
      util: ehDiaUtil(s),
    };
  };

  if (period === "diaria") {
    const dias: Fatia[] = [];
    const d = new Date(range.start);
    while (dias.length < 10) {
      if (ehDiaUtil(d) || d.getTime() === range.start.getTime()) dias.unshift(diaria(d));
      d.setDate(d.getDate() - 1);
    }
    return { fatias: dias, descricao: "últimos 10 dias úteis" };
  }

  const dias = Math.round((range.end.getTime() - range.start.getTime()) / DIA);
  if (dias > 45) {
    const fatias: Fatia[] = [];
    const s = new Date(range.start);
    while (s.getTime() < range.end.getTime()) {
      const e = new Date(s);
      e.setDate(e.getDate() + 7);
      const fim = e.getTime() > range.end.getTime() ? new Date(range.end) : e;
      fatias.push({
        start: new Date(s),
        end: fim,
        rotulo: ddmm(s),
        rotuloLongo: `semana de ${ddmm(s)}`,
        futura: s.getTime() > agora.getTime(),
        util: true,
      });
      s.setTime(fim.getTime());
    }
    return { fatias, descricao: "por semana" };
  }

  const fatias: Fatia[] = [];
  const d = new Date(range.start);
  while (d.getTime() < range.end.getTime()) {
    fatias.push(diaria(d));
    d.setDate(d.getDate() + 1);
  }
  return { fatias, descricao: "por dia" };
}

/** Índice da fatia em que o prazo cai, ou -1. As fatias são contíguas e em ordem. */
function indiceDaFatia(fatias: Fatia[], ms: number): number {
  let lo = 0;
  let hi = fatias.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ms < fatias[mid].start.getTime()) hi = mid - 1;
    else if (ms >= fatias[mid].end.getTime()) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Contagem de uma pessoa (ou de várias) em cada fatia. */
export function placarPorFatia(
  tarefas: Task[],
  fatias: Fatia[],
  conclusoes: Map<string, string>,
  now = Date.now(),
): Contagem[] {
  const grupos: TaskScore[][] = fatias.map(() => []);
  for (const t of tarefas) {
    if (!t.dueDate) continue;
    const i = indiceDaFatia(fatias, new Date(t.dueDate).getTime());
    if (i >= 0) grupos[i].push(scoreTask(t, conclusoes.get(t.id) ?? null, now));
  }
  return grupos.map(contar);
}

/**
 * Porcentagens inteiras que somam 100 (maior resto). Arredondar cada uma por
 * conta própria dá 99% ou 101% de vez em quando — e a Distribuição existe
 * justamente para fechar a conta.
 */
export function porcentagensInteiras(valores: number[]): number[] {
  const total = valores.reduce((s, v) => s + v, 0);
  if (total === 0) return valores.map(() => 0);
  const brutos = valores.map((v) => (v / total) * 100);
  const base = brutos.map(Math.floor);
  let falta = 100 - base.reduce((s, v) => s + v, 0);
  const ordem = brutos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto);
  for (const o of ordem) {
    if (falta <= 0) break;
    base[o.i]++;
    falta--;
  }
  return base;
}

/* ————— Alertas ("Precisa de atenção") ————— */

export type TipoDeAlerta = "perdidas" | "atraso" | "aberto" | "sem-tarefas";

export interface Alerta {
  id: string;
  tipo: TipoDeAlerta;
  /** 3 = vermelho, 2 = amarelo, 1 = informativo. */
  peso: number;
  user?: User;
  /** Só no "sem tarefas": um alerta para o grupo inteiro, não um por pessoa. */
  pessoas?: User[];
  titulo: string;
  detalhe: string;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Transforma o ranking numa lista do que fazer.
 *
 * O cartão antigo pegava o pior score e escrevia "LOUISE 0% — 0 perdidas · 0 em
 * atraso". As duas coisas eram verdade, e juntas não diziam nada: ela tinha
 * tarefas ainda dentro do prazo. Agora cada situação tem o seu nome — vencida
 * sem concluir, concluída com atraso, ainda em aberto, sem tarefa no período.
 */
export function montarAlertas(scores: UserScore[], range: Janela, now = Date.now()): Alerta[] {
  const alertas: Alerta[] = [];
  const semTarefas: User[] = [];
  for (const s of scores) {
    if (s.assigned === 0) {
      semTarefas.push(s.user);
      continue;
    }
    if (s.missed > 0) {
      alertas.push({
        id: `perdidas-${s.user.id}`,
        tipo: "perdidas",
        peso: 3,
        user: s.user,
        titulo: `${plural(s.missed, "tarefa venceu", "tarefas venceram")} sem concluir`,
        detalhe: `Score ${Math.round(s.pct)}% · ${s.onTime + s.late} de ${s.assigned} concluídas`,
      });
    }
    if (s.late >= 2 || (s.late > 0 && s.late / s.assigned >= 0.3)) {
      alertas.push({
        id: `atraso-${s.user.id}`,
        tipo: "atraso",
        peso: 2,
        user: s.user,
        titulo: `${plural(s.late, "concluída", "concluídas")} com atraso`,
        detalhe: `Cada uma vale ½ ponto · ${Math.round((s.late / s.assigned) * 100)}% das tarefas`,
      });
    }
    if (s.onTime + s.late === 0 && s.missed === 0 && s.pending > 0) {
      const proximo = s.breakdown
        .filter((b) => b.state === "pending")
        .map((b) => venceEm(b.task))
        .filter((v) => Number.isFinite(v))
        .sort((a, b) => a - b)[0];
      const quando = proximo
        ? new Date(proximo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
        : null;
      alertas.push({
        id: `aberto-${s.user.id}`,
        tipo: "aberto",
        // Perto do fim do período (ou vencendo hoje) o aviso sobe de tom.
        peso: proximo && proximo - now < DIA ? 2 : 1,
        user: s.user,
        titulo: `Nada concluído ainda — ${plural(s.pending, "tarefa", "tarefas")} em aberto`,
        detalhe: `Ainda dentro do prazo${quando ? ` · a próxima vence em ${quando}` : ""}. O score fica em 0% até concluir.`,
      });
    }
  }
  if (semTarefas.length > 0) {
    alertas.push({
      id: "sem-tarefas",
      tipo: "sem-tarefas",
      peso: 1,
      pessoas: semTarefas,
      titulo: `${plural(semTarefas.length, "pessoa", "pessoas")} sem tarefa com prazo em ${range.label}`,
      detalhe: "Sem tarefa no período não há score — vale combinar o que se espera delas.",
    });
  }
  return alertas.sort((a, b) => b.peso - a.peso);
}

/* ————— Score por setor ————— */

export interface PlacarDoSetor {
  setor: string;
  pessoas: number;
  contagem: Contagem;
}

export function placarPorSetor(scores: UserScore[]): PlacarDoSetor[] {
  const m = new Map<string, { pessoas: number; lista: Contagem[] }>();
  for (const s of scores) {
    const g = m.get(s.user.sector) ?? { pessoas: 0, lista: [] };
    g.pessoas++;
    g.lista.push(contar(s.breakdown));
    m.set(s.user.sector, g);
  }
  return [...m.entries()]
    .map(([setor, g]) => ({ setor, pessoas: g.pessoas, contagem: somar(g.lista) }))
    .sort((a, b) => (b.contagem.pct ?? -1) - (a.contagem.pct ?? -1));
}

/* ————— Metas cadastradas (gestor.metas, já carregadas pelo useFluxo) ————— */

export interface ProgressoDaMeta {
  meta: Meta;
  /** Nome da pessoa ou do setor. */
  alvoNome: string;
  user?: User;
  janela: { start: number; end: number };
  realizado: number;
  pct: number;
  /** null quando é cedo demais para projetar (menos de 10% da janela). */
  projecaoPct: number | null;
}

/**
 * Progresso de cada meta na janela CORRENTE dela (dia, semana ou mês), não na
 * do painel: uma meta semanal se mede na semana, escolha a aba que escolher.
 *
 * A conta é a de sempre das metas: "tarefas" conta conclusões na janela e
 * "pontos" soma os pontos dessas conclusões (`CompletionEntry.points`).
 */
export function progressoDasMetas(
  metas: Meta[],
  pessoas: User[],
  todos: User[],
  completions: CompletionEntry[],
  sectorName: (id: string) => string,
  agora = new Date(),
): ProgressoDaMeta[] {
  const ids = new Set(pessoas.map((p) => p.id));
  const setores = new Set(pessoas.map((p) => p.sector));
  const setorDe = new Map(todos.map((u) => [u.id, u.sector]));
  const out: ProgressoDaMeta[] = [];
  for (const meta of metas) {
    const daPessoa = meta.scope === "user" && ids.has(meta.scopeId);
    const doSetor = meta.scope === "sector" && setores.has(meta.scopeId);
    if (!daPessoa && !doSetor) continue;
    if (!(meta.target > 0)) continue;
    // O banco só aceita estes três (ver `metas.functions.ts`); o tipo do app é mais largo.
    if (meta.period !== "diaria" && meta.period !== "semanal" && meta.period !== "mensal") continue;
    const periodo = meta.period === "diaria" ? "dia" : meta.period === "semanal" ? "semana" : "mes";
    const janela = janelaDoPlacar(periodo, agora);
    let realizado = 0;
    for (const c of completions) {
      const t = new Date(c.at).getTime();
      if (t < janela.start || t >= janela.end) continue;
      const conta = daPessoa ? c.userId === meta.scopeId : setorDe.get(c.userId) === meta.scopeId;
      if (!conta) continue;
      realizado += meta.metric === "tarefas" ? 1 : c.points;
    }
    const decorrido = (agora.getTime() - janela.start) / (janela.end - janela.start);
    const user = daPessoa ? todos.find((u) => u.id === meta.scopeId) : undefined;
    out.push({
      meta,
      alvoNome: user?.name ?? (daPessoa ? meta.scopeId : sectorName(meta.scopeId)),
      user,
      janela,
      realizado,
      pct: (realizado / meta.target) * 100,
      projecaoPct: decorrido >= 0.1 ? (realizado / decorrido / meta.target) * 100 : null,
    });
  }
  return out.sort((a, b) => a.pct - b.pct);
}
