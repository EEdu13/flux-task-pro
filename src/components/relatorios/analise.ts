/**
 * As contas da aba Relatórios, sem React e sem banco.
 *
 * Reforma de 13/10/2026 (pedido do usuário: "a aba relatórios tá horrível …
 * que realmente seja uma análise"). Tudo aqui trabalha sobre o que a tela já
 * tem em memória — tarefas, conclusões dos últimos 90 dias e as sessões do
 * cronômetro, buscadas UMA vez por visita. Nenhuma consulta nova: o teto de DTU
 * do Azure já foi atingido uma vez, e um painel que soma no cliente não
 * custa nada ao banco.
 *
 * As regras de prazo são as do resto do sistema (`dias-uteis.ts`): o prazo é
 * um DIA, prazo em feriado ou fim de semana vence no próximo dia útil, e o
 * atraso conta dias úteis.
 */
import { dataParaIso } from "@/lib/data-iso";
import { entregueNoPrazo, feriadoNacional } from "@/lib/dias-uteis";
import type { CompletionEntry, Task } from "@/lib/fluxo-types";
import type { Persisted } from "@/lib/time-log";

const DIA_MS = 86_400_000;

/* ------------------------------------------------------------------ cores */

/** Ordem fixa das cores das séries (tokens do tema); "Outros" é sempre o cinza. */
export const CORES_SERIE = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
];
export const COR_OUTROS = "var(--color-muted-foreground)";

/** Eixos dos gráficos: recessivos, nunca competindo com os dados. */
export const EIXO = {
  tick: { fontSize: 10, fill: "var(--color-muted-foreground)" },
  axisLine: false,
  tickLine: false,
} as const;

/* ------------------------------------------------------------------ período */

export type Periodo = "7d" | "30d" | "mes" | "90d";

export const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes", rotulo: "Mês atual" },
  { id: "90d", rotulo: "90 dias" },
];

export interface Intervalo {
  inicio: number;
  fim: number;
}

export interface Janela extends Intervalo {
  /** O período imediatamente anterior, do mesmo tamanho. Nulo em 90 dias: o histórico só tem 90. */
  anterior: Intervalo | null;
  dias: number;
  /** "nos últimos 30 dias", "neste mês"… para compor frases. */
  frase: string;
}

function meiaNoite(ms: number | Date): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function janelaDoPeriodo(p: Periodo, agora: Date = new Date()): Janela {
  const hoje = meiaNoite(agora);
  const fim = agora.getTime();
  if (p === "mes") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1).getTime();
    const antInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).getTime();
    /* O mês corrente está pela metade: comparar com o mês passado INTEIRO faria
       todo começo de mês parecer uma queda. Compara com o mesmo trecho. */
    return {
      inicio,
      fim,
      anterior: { inicio: antInicio, fim: Math.min(antInicio + (fim - inicio), inicio) },
      dias: hoje.getDate(),
      frase: "neste mês",
    };
  }
  const n = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const ini = new Date(hoje);
  ini.setDate(ini.getDate() - (n - 1));
  const antIni = new Date(ini);
  antIni.setDate(antIni.getDate() - n);
  return {
    inicio: ini.getTime(),
    fim,
    anterior: n === 90 ? null : { inicio: antIni.getTime(), fim: ini.getTime() },
    dias: n,
    frase: `nos últimos ${n} dias`,
  };
}

export const dentro = (ms: number, i: Intervalo) => ms >= i.inicio && ms < i.fim;

/* ------------------------------------------------------------------- baldes */

export interface Balde extends Intervalo {
  rotulo: string;
}

/** Dia a dia até 31 dias; acima disso, semanas de segunda a domingo. */
export function baldesDaJanela(j: Janela): { baldes: Balde[]; granularidade: "dia" | "semana" } {
  const baldes: Balde[] = [];
  const rot = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (j.dias <= 31) {
    const d = meiaNoite(j.inicio);
    for (let i = 0; i < 40 && d.getTime() < j.fim; i++) {
      const prox = new Date(d);
      prox.setDate(prox.getDate() + 1);
      baldes.push({ inicio: d.getTime(), fim: prox.getTime(), rotulo: rot(d) });
      d.setDate(d.getDate() + 1);
    }
    return { baldes, granularidade: "dia" };
  }
  const d = meiaNoite(j.inicio);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira da semana
  for (let i = 0; i < 20 && d.getTime() < j.fim; i++) {
    const prox = new Date(d);
    prox.setDate(prox.getDate() + 7);
    baldes.push({ inicio: Math.max(d.getTime(), j.inicio), fim: prox.getTime(), rotulo: rot(d) });
    d.setDate(d.getDate() + 7);
  }
  return { baldes, granularidade: "semana" };
}

export function indiceDoBalde(baldes: Balde[], ms: number): number {
  for (let i = 0; i < baldes.length; i++) if (dentro(ms, baldes[i]!)) return i;
  return -1;
}

/* ---------------------------------------------------------------- duração */

/**
 * Duração legível que NUNCA arredonda para "0m".
 *
 * Era o bug da tela antiga (13/10/2026): "Tempo total registrado 0m" ao lado
 * de "Tarefas com tempo 2". As duas sessões existiam — somavam menos de um
 * minuto, e `formatHM` corta os segundos. Abaixo de 1 minuto mostra segundos;
 * abaixo de 10 minutos, minutos e segundos.
 */
export function duracao(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s === 0) return "0m";
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) {
    const r = s % 60;
    return m < 10 && r > 0 ? `${m}m ${r}s` : `${m}m`;
  }
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/* --------------------------------------------------------------- entregas */

function ehDiaUtil(d: Date): boolean {
  const s = d.getDay();
  return s !== 0 && s !== 6 && !feriadoNacional(d);
}

/** O dia útil em que o prazo de fato vence (meia-noite local). */
export function diaUtilDoPrazo(prazo: string): Date {
  const d = meiaNoite(new Date(prazo));
  for (let i = 0; i < 15 && !ehDiaUtil(d); i++) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Dias ÚTEIS entre o prazo e a entrega. Entregue no sábado depois de um prazo
 * de sexta não soma dia útil nenhum, mas é atraso — por isso o mínimo de 1.
 */
export function diasUteisDeAtraso(prazo: string, entregaMs: number): number {
  const d = diaUtilDoPrazo(prazo);
  const entrega = meiaNoite(entregaMs).getTime();
  let n = 0;
  for (let i = 0; i < 400 && d.getTime() < entrega; i++) {
    d.setDate(d.getDate() + 1);
    if (ehDiaUtil(d)) n++;
  }
  return Math.max(1, n);
}

export interface Entrega {
  id: string;
  taskId: string;
  userId: string;
  at: number;
  noPrazo: boolean;
  /** Dias úteis de atraso; 0 no prazo; nulo quando a tarefa não está mais na lista (arquivada). */
  atraso: number | null;
  tarefa?: Task;
}

/**
 * Reavalia cada conclusão pela regra do DIA. O `onTime` gravado vale só quando
 * a tarefa não veio na lista (arquivada): conclusões antigas foram gravadas
 * com a regra do instante, anterior a 13/10/2026.
 */
export function avaliarEntregas(
  completions: CompletionEntry[],
  tarefaPorId: Map<string, Task>,
): Entrega[] {
  return completions.map((c) => {
    const t = tarefaPorId.get(c.taskId);
    const at = new Date(c.at).getTime();
    if (!t) {
      return { id: c.id, taskId: c.taskId, userId: c.userId, at, noPrazo: c.onTime, atraso: null };
    }
    const noPrazo = entregueNoPrazo(t.dueDate, dataParaIso(new Date(at)));
    return {
      id: c.id,
      taskId: c.taskId,
      userId: c.userId,
      at,
      noPrazo,
      atraso: noPrazo || !t.dueDate ? 0 : diasUteisDeAtraso(t.dueDate, at),
      tarefa: t,
    };
  });
}

export interface ResumoEntregas {
  total: number;
  noPrazo: number;
  pctNoPrazo: number | null;
  atrasoMedio: number | null;
  atrasadas: number;
}

export function resumirEntregas(es: Entrega[]): ResumoEntregas {
  const noPrazo = es.filter((e) => e.noPrazo).length;
  const atrasos = es.filter((e) => !e.noPrazo && e.atraso != null).map((e) => e.atraso!);
  return {
    total: es.length,
    noPrazo,
    pctNoPrazo: es.length ? (noPrazo / es.length) * 100 : null,
    atrasoMedio: atrasos.length ? atrasos.reduce((a, b) => a + b, 0) / atrasos.length : null,
    atrasadas: es.length - noPrazo,
  };
}

/* ---------------------------------------------------------------- sessões */

export interface Sessao {
  id: string;
  taskId: string;
  userId: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
}

/** As sessões de quem está no escopo, com o dono de cada uma. */
export function sessoesDoEscopo(logs: Record<string, Persisted>, ids: Set<string>): Sessao[] {
  const saida: Sessao[] = [];
  for (const id of ids) {
    for (const s of logs[id]?.sessions ?? []) saida.push({ ...s, userId: id });
  }
  return saida;
}

export const somaSegundos = (ss: { seconds: number }[]) => ss.reduce((a, s) => a + s.seconds, 0);

/**
 * Segundos por dia da semana (0 = segunda … 6 = domingo) × hora.
 *
 * A sessão é repartida pelas horas que ela atravessa: 1h30 começando às 8h40
 * dá 20 min às 8h, 60 às 9h e 10 às 10h. Somar tudo na hora do início faria
 * uma manhã inteira de trabalho parecer um pico às 8h.
 */
export function mapaDeCalor(sessoes: Sessao[]): number[][] {
  const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const s of sessoes) {
    let t = s.startedAt;
    const fim = s.startedAt + s.seconds * 1000;
    for (let i = 0; i < 400 && t < fim; i++) {
      const d = new Date(t);
      const prox = new Date(d);
      prox.setMinutes(60, 0, 0);
      const ate = Math.min(prox.getTime(), fim);
      m[(d.getDay() + 6) % 7]![d.getHours()]! += (ate - t) / 1000;
      t = ate;
    }
  }
  return m;
}

export interface Serie {
  chave: string;
  rotulo: string;
}

/**
 * Segundos por balde, empilhados por um agrupador (pessoa, projeto…). Os
 * `max` grupos com mais tempo ganham série própria; o resto vira "Outros".
 */
export function empilharPorGrupo(
  sessoes: Sessao[],
  baldes: Balde[],
  grupoDe: (s: Sessao) => string,
  rotuloDe: (chave: string) => string,
  max = 5,
): { linhas: Record<string, number | string>[]; series: Serie[] } {
  const totais = new Map<string, number>();
  for (const s of sessoes) totais.set(grupoDe(s), (totais.get(grupoDe(s)) ?? 0) + s.seconds);
  const ordem = [...totais.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const proprias = new Set(ordem.length > max ? ordem.slice(0, max - 1) : ordem);
  const series: Serie[] = ordem
    .filter((k) => proprias.has(k))
    .map((k) => ({ chave: k, rotulo: rotuloDe(k) }));
  if (ordem.length > proprias.size) series.push({ chave: "__outros", rotulo: "Outros" });

  const linhas: Record<string, number | string>[] = baldes.map((b) => {
    const l: Record<string, number | string> = { rotulo: b.rotulo };
    for (const s of series) l[s.chave] = 0;
    return l;
  });
  for (const s of sessoes) {
    const i = indiceDoBalde(baldes, s.startedAt);
    if (i < 0) continue;
    const g = grupoDe(s);
    const k = proprias.has(g) ? g : "__outros";
    linhas[i]![k] = (linhas[i]![k] as number) + s.seconds;
  }
  return { linhas, series };
}

/* ---------------------------------------------------------- tarefas abertas */

export const FAIXAS_DE_IDADE: { rotulo: string; ate: number }[] = [
  { rotulo: "0–2 dias", ate: 2 },
  { rotulo: "3–7 dias", ate: 7 },
  { rotulo: "8–15 dias", ate: 15 },
  { rotulo: "16–30 dias", ate: 30 },
  { rotulo: "30+ dias", ate: Number.POSITIVE_INFINITY },
];

/** Dias corridos desde a criação, contando por dia local. */
export function idadeEmDias(t: Task, agora: number = Date.now()): number {
  return Math.max(
    0,
    Math.round((meiaNoite(agora).getTime() - meiaNoite(new Date(t.createdAt)).getTime()) / DIA_MS),
  );
}

/**
 * Entradas e saídas por balde e o tamanho do backlog no fim de cada um.
 *
 * O backlog é reconstruído das próprias tarefas: aberta num instante é quem já
 * tinha sido criada e ainda não tinha sido concluída. Tarefas arquivadas não
 * vêm na lista e ficam de fora — é o mesmo recorte do quadro.
 */
export function fluxoDoBacklog(
  tarefas: Task[],
  entregas: Entrega[],
  baldes: Balde[],
  agora: number = Date.now(),
): { rotulo: string; criadas: number; concluidas: number; backlog: number }[] {
  return baldes.map((b) => {
    const corte = Math.min(b.fim, agora);
    let backlog = 0;
    let criadas = 0;
    for (const t of tarefas) {
      const criada = new Date(t.createdAt).getTime();
      if (dentro(criada, b)) criadas++;
      if (criada >= corte) continue;
      const concluida = t.completedAt ? new Date(t.completedAt).getTime() : null;
      const aberta = t.status !== "concluida" || (concluida != null && concluida >= corte);
      if (aberta) backlog++;
    }
    const concluidas = entregas.filter((e) => dentro(e.at, b)).length;
    return { rotulo: b.rotulo, criadas, concluidas, backlog };
  });
}

/* ----------------------------------------------------------------- deltas */

export type Tom = "bom" | "ruim" | "neutro";

export interface Variacao {
  texto: string;
  tom: Tom;
}

/**
 * Quanto mudou em relação ao período anterior. `pct` para contagens e tempo,
 * `pp` para porcentagens (pontos percentuais), `abs` para médias de dias.
 */
export function variacao(
  atual: number | null,
  anterior: number | null,
  formato: "pct" | "pp" | "abs",
  maiorEhMelhor = true,
): Variacao | null {
  if (atual == null || anterior == null) return null;
  const diff = atual - anterior;
  const tom: Tom = Math.abs(diff) < 1e-9 ? "neutro" : diff > 0 === maiorEhMelhor ? "bom" : "ruim";
  const sinal = diff > 0 ? "+" : diff < 0 ? "−" : "";
  if (formato === "pp") return { texto: `${sinal}${Math.abs(Math.round(diff))} p.p.`, tom };
  if (formato === "abs") {
    const v = Math.abs(diff).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return { texto: `${sinal}${v}`, tom };
  }
  if (anterior === 0)
    return atual === 0 ? { texto: "igual", tom: "neutro" } : { texto: "novo", tom };
  return { texto: `${sinal}${Math.abs(Math.round((diff / anterior) * 100))}%`, tom };
}

/* ---------------------------------------------------------------- achados */

export interface Achado {
  tom: Tom;
  titulo: string;
  detalhe: string;
}

export const DIAS_DA_SEMANA = [
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
  "domingo",
];

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const listar = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

const cortar = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Frases curtas tiradas dos números — só fatos calculados, nada de conselho
 * inventado. Vêm em ordem de importância; a tela mostra as quatro primeiras.
 */
export function gerarAchados(x: {
  janela: Janela;
  entregas: ResumoEntregas;
  entregasAnteriores: ResumoEntregas | null;
  listaEntregas: Entrega[];
  criadasNoPeriodo: number;
  backlogInicio: number | null;
  backlogAgora: number;
  tempoPorTarefa: { titulo: string; segundos: number }[];
  calor: number[][];
  atrasadasPorPessoa: { nome: string; n: number }[];
  maisAntiga: { titulo: string; dias: number } | null;
}): Achado[] {
  const saida: Achado[] = [];

  // 1. Entrada × saída
  if (x.criadasNoPeriodo > 0 || x.entregas.total > 0) {
    const saldo = x.criadasNoPeriodo - x.entregas.total;
    const pct =
      x.backlogInicio && x.backlogInicio > 0
        ? Math.round(((x.backlogAgora - x.backlogInicio) / x.backlogInicio) * 100)
        : null;
    saida.push({
      tom: saldo > 0 ? "ruim" : saldo < 0 ? "bom" : "neutro",
      titulo:
        saldo > 0
          ? `As pendências cresceram ${saldo}${pct != null && pct > 0 ? ` (+${pct}%)` : ""}`
          : saldo < 0
            ? `As pendências caíram ${-saldo}${pct != null && pct < 0 ? ` (${pct}%)` : ""}`
            : "Entrada e saída empatadas",
      detalhe: `Entraram ${x.criadasNoPeriodo} tarefa${x.criadasNoPeriodo === 1 ? "" : "s"} e saíram ${x.entregas.total} ${x.janela.frase}.`,
    });
  }

  // 2. No prazo × período anterior
  const a = x.entregas.pctNoPrazo;
  const b = x.entregasAnteriores?.pctNoPrazo ?? null;
  if (a != null && b != null && x.entregas.total >= 3 && (x.entregasAnteriores?.total ?? 0) >= 3) {
    const d = Math.round(a - b);
    if (d !== 0) {
      saida.push({
        tom: d > 0 ? "bom" : "ruim",
        titulo: `No prazo ${d > 0 ? "subiu" : "caiu"} ${Math.abs(d)} p.p.`,
        detalhe: `${Math.round(a)}% agora, contra ${Math.round(b)}% no período anterior.`,
      });
    }
  }

  // 3. Concentração do tempo
  const totalTempo = x.tempoPorTarefa.reduce((s, t) => s + t.segundos, 0);
  if (totalTempo >= 60 && x.tempoPorTarefa.length > 3) {
    const top = x.tempoPorTarefa.slice(0, 3);
    const pct = Math.round((top.reduce((s, t) => s + t.segundos, 0) / totalTempo) * 100);
    saida.push({
      tom: "neutro",
      titulo: `${pct}% do tempo foi em 3 tarefas`,
      detalhe: listar(top.map((t) => `«${cortar(t.titulo, 28)}»`)),
    });
  } else if (totalTempo > 0 && x.tempoPorTarefa.length > 0) {
    const n = x.tempoPorTarefa.length;
    saida.push({
      tom: "neutro",
      titulo: `Todo o tempo em ${n === 1 ? "1 tarefa" : `${n} tarefas`}`,
      detalhe: `${duracao(totalTempo)} cronometrados ${x.janela.frase}.`,
    });
  }

  // 4. Dia da semana do prazo que mais atrasa
  const atrasadas = x.listaEntregas.filter((e) => !e.noPrazo && e.tarefa?.dueDate);
  if (atrasadas.length >= 3) {
    const cont = new Array<number>(7).fill(0);
    for (const e of atrasadas) cont[(diaUtilDoPrazo(e.tarefa!.dueDate!).getDay() + 6) % 7]!++;
    const max = Math.max(...cont);
    if (max >= 2 && cont.filter((c) => c === max).length === 1) {
      const dia = DIAS_DA_SEMANA[cont.indexOf(max)]!;
      saida.push({
        tom: "ruim",
        titulo: `Prazos de ${dia} são os que mais atrasam`,
        detalhe: `${max} de ${atrasadas.length} entregas atrasadas venciam na ${dia}.`,
      });
    }
  }

  // 5. Quem concentra as atrasadas abertas
  const totalAtr = x.atrasadasPorPessoa.reduce((s, p) => s + p.n, 0);
  const primeira = x.atrasadasPorPessoa[0];
  if (
    x.atrasadasPorPessoa.length > 1 &&
    primeira &&
    totalAtr >= 3 &&
    primeira.n / totalAtr >= 0.4
  ) {
    saida.push({
      tom: "ruim",
      titulo: `${primeira.nome} tem ${primeira.n} das ${totalAtr} atrasadas`,
      detalhe: `${Math.round((primeira.n / totalAtr) * 100)}% do atraso aberto da equipe está com uma pessoa.`,
    });
  }

  // 6. A aberta mais antiga
  if (x.maisAntiga && x.maisAntiga.dias > 30) {
    saida.push({
      tom: "ruim",
      titulo: `Tarefa aberta há ${x.maisAntiga.dias} dias`,
      detalhe: `«${cortar(x.maisAntiga.titulo, 48)}» é a mais antiga em aberto.`,
    });
  }

  // 7. Pico de trabalho cronometrado
  if (totalTempo >= 3600) {
    let melhor = { d: 0, h: 0, v: 0 };
    x.calor.forEach((linha, d) =>
      linha.forEach((v, h) => {
        if (v > melhor.v) melhor = { d, h, v };
      }),
    );
    saida.push({
      tom: "neutro",
      titulo: `Pico: ${capitalizar(DIAS_DA_SEMANA[melhor.d]!)}, ${melhor.h}h`,
      detalhe: `A faixa com mais tempo cronometrado (${duracao(melhor.v)}) ${x.janela.frase}.`,
    });
  }

  return saida.slice(0, 4);
}
