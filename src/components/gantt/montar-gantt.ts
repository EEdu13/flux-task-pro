import type { Status } from "@/lib/fluxo-types";

/**
 * Monta as linhas do Gantt a partir das tarefas do CONECTA (17/11/2026).
 *
 * Puro, sem import que rode: os testes (`tests/montar-gantt.test.ts`) o importam
 * direto pelo Node, que não entende `@/` nem import sem extensão. Por isso a regra
 * de atraso (`tarefaVencida`, de `prazo.ts`, que puxa os feriados) chega como
 * parâmetro, em vez de ser importada aqui.
 *
 * As datas são do dia no fuso do navegador, como no resto da tela: quem usa está
 * no Brasil, e o diálogo da tarefa também monta o prazo em hora local.
 */

/** O que o Gantt usa de uma tarefa: o recorte de `Task`. */
export interface TarefaParaGantt {
  id: string;
  title: string;
  status: Status;
  dueDate: string | null;
  startDate?: string | null;
  createdAt: string;
  assigneeId: string;
  projectId?: string;
  completedAt?: string | null;
}

/** O que o Gantt usa de um projeto: o recorte de `Project`. */
export interface ProjetoParaGantt {
  id: string;
  name: string;
  ownerId: string;
  color?: string;
  dueDate?: string;
}

/**
 * A cor da barra. "Atrasada" ganha das outras; "semprazo" desenha a linha na lista
 * da esquerda com a barra escondida (o Gantt grátis não aceita tarefa sem datas).
 */
export type SituacaoNoGantt = "pendente" | "andamento" | "concluida" | "atrasada" | "semprazo";

/**
 * A linha de um projeto na visão geral. "projetovazio" = nenhuma tarefa com prazo no
 * período: a linha fica, a barra se esconde (como a da tarefa sem prazo).
 */
export type TipoDeProjeto = "projeto" | "projetovazio";

/** Uma linha do Gantt, no formato do SVAR (`ITask`) mais os nossos campos. */
export interface ItemDoGantt {
  id: string;
  text: string;
  type: SituacaoNoGantt | TipoDeProjeto;
  start: Date;
  /** Exclusivo, como o SVAR quer: 00:00 do dia seguinte ao do prazo. */
  end: Date;
  responsavelId: string;
  /** ISO do prazo, ou `null` para "Sem prazo" na coluna da esquerda. */
  prazo: string | null;
  /** Só nas tarefas da visão geral: a linha do projeto delas. */
  parent?: string;
  /** Só nos projetos da visão geral. */
  ehProjeto?: boolean;
  open?: boolean;
  cor?: string;
}

export interface MontagemDoGantt {
  tasks: ItemDoGantt[];
  /** Começo e fim do eixo do tempo: todas as barras e hoje, com folga. */
  inicio: Date;
  fim: Date;
  semPrazo: number;
}

export type RegraDeAtraso = (t: TarefaParaGantt, agora: number) => boolean;

/** Meia-noite do dia de `ms`, no fuso do navegador. */
export function inicioDoDia(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `d` mais `n` dias de calendário (por `setDate`, e não somando 24 h). */
export function somarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function situacaoNoGantt(
  t: TarefaParaGantt,
  agora: number,
  atrasada: RegraDeAtraso,
): SituacaoNoGantt {
  if (!t.dueDate) return "semprazo";
  if (t.status === "concluida") return "concluida";
  if (atrasada(t, agora)) return "atrasada";
  return t.status;
}

/**
 * A barra vai do dia do início (`startDate`; sem ele, o dia em que a tarefa foi
 * criada) até o fim do dia do prazo. Se o início cair depois do prazo (o servidor
 * aceita, ver `tarefas.functions.ts`), ou a tarefa nasceu já com o prazo vencido,
 * a barra ocupa só o dia do prazo.
 *
 * Sem prazo, a barra (escondida) fica em hoje, para não esticar o eixo do tempo.
 */
export function barraDaTarefa(t: TarefaParaGantt, agora: number): { start: Date; end: Date } {
  if (!t.dueDate) {
    const hoje = inicioDoDia(agora);
    return { start: hoje, end: somarDias(hoje, 1) };
  }
  const diaDoPrazo = inicioDoDia(Date.parse(t.dueDate));
  const end = somarDias(diaDoPrazo, 1);
  const inicio = inicioDoDia(Date.parse(t.startDate || t.createdAt));
  const start = Number.isNaN(inicio.getTime()) || inicio >= end ? diaDoPrazo : inicio;
  return { start, end };
}

/** Folga do eixo do tempo, em dias, antes da primeira barra e depois da última. */
const FOLGA_ANTES = 3;
const FOLGA_DEPOIS = 7;

const DIA_MS = 86_400_000;

/**
 * O eixo do tempo vai da barra mais cedo à mais tarde e sempre inclui hoje (a linha
 * de hoje precisa de lugar), com uma folga dos dois lados.
 */
class Eixo {
  private inicio: Date;
  private fim: Date;
  constructor(agora: number) {
    this.inicio = inicioDoDia(agora);
    this.fim = somarDias(this.inicio, 1);
  }
  incluir(start: Date, end: Date): void {
    if (start < this.inicio) this.inicio = start;
    if (end > this.fim) this.fim = end;
  }
  comFolga(): { inicio: Date; fim: Date } {
    return { inicio: somarDias(this.inicio, -FOLGA_ANTES), fim: somarDias(this.fim, FOLGA_DEPOIS) };
  }
}

function itemDaTarefa(t: TarefaParaGantt, agora: number, atrasada: RegraDeAtraso): ItemDoGantt {
  const { start, end } = barraDaTarefa(t, agora);
  return {
    id: t.id,
    text: t.title,
    type: situacaoNoGantt(t, agora, atrasada),
    start,
    end,
    responsavelId: t.assigneeId,
    prazo: t.dueDate,
  };
}

/** Pela barra: o que começa antes vem antes. Sem prazo, no fim. */
function porBarra(a: ItemDoGantt, b: ItemDoGantt): number {
  if (!a.prazo !== !b.prazo) return a.prazo ? -1 : 1;
  return (
    a.start.getTime() - b.start.getTime() ||
    a.end.getTime() - b.end.getTime() ||
    a.text.localeCompare(b.text, "pt-BR")
  );
}

/** As tarefas de um projeto, sem a linha do projeto (a aba já está dentro dele). */
export function montarGanttDoProjeto(
  tarefas: readonly TarefaParaGantt[],
  agora: number,
  atrasada: RegraDeAtraso,
): MontagemDoGantt {
  const eixo = new Eixo(agora);
  let semPrazo = 0;
  const itens = tarefas.map((t) => {
    const item = itemDaTarefa(t, agora, atrasada);
    if (t.dueDate) eixo.incluir(item.start, item.end);
    else semPrazo++;
    return item;
  });
  itens.sort(porBarra);
  return { tasks: itens, ...eixo.comFolga(), semPrazo };
}

/* ------------------------------ Visão geral ------------------------------ */

/** O id da linha de um projeto no Gantt: prefixado, para não cruzar com o de uma tarefa. */
export const PREFIXO_DE_PROJETO = "projeto:";
export const idDaLinhaDoProjeto = (projetoId: string) => PREFIXO_DE_PROJETO + projetoId;

/** O projeto de uma linha do Gantt, ou `null` se a linha é de tarefa. */
export function projetoDaLinha(id: string | number): string | null {
  const s = String(id);
  return s.startsWith(PREFIXO_DE_PROJETO) ? s.slice(PREFIXO_DE_PROJETO.length) : null;
}

/** Quantos dias para trás uma tarefa concluída ainda aparece na visão geral. */
export const DIAS_DE_CONCLUIDAS = 30;

/**
 * A tarefa entra na visão geral? As abertas sempre; as concluídas só nos últimos 30
 * dias, pela data de conclusão (sem ela, pelo prazo; sem nenhum dos dois, fica fora).
 * O Módulo 6 troca isto por um filtro de período.
 */
export function entraNaVisaoGeral(t: TarefaParaGantt, agora: number): boolean {
  if (t.status !== "concluida") return true;
  const quando = Date.parse(t.completedAt || t.dueDate || "");
  return !Number.isNaN(quando) && quando >= agora - DIAS_DE_CONCLUIDAS * DIA_MS;
}

/**
 * Todos os projetos, cada um com as suas tarefas embaixo. A barra do projeto vai da
 * tarefa que começa antes à que termina depois (só as que têm prazo). Recolhidos de
 * início; `abertos` diz quais a pessoa abriu, para não fechar quando os dados mudam.
 *
 * A tarefa acha o projeto pelo id sem diferença de caixa (`mesmoId` do store: há
 * projetos antigos gravados com o id em minúsculas).
 */
export function montarGanttGeral(
  projetos: readonly ProjetoParaGantt[],
  tarefas: readonly TarefaParaGantt[],
  agora: number,
  atrasada: RegraDeAtraso,
  abertos: ReadonlySet<string>,
): MontagemDoGantt {
  const eixo = new Eixo(agora);
  const doProjeto = new Map<string, TarefaParaGantt[]>();
  for (const p of projetos) doProjeto.set(p.id.toLowerCase(), []);
  for (const t of tarefas) {
    const lista = t.projectId ? doProjeto.get(t.projectId.toLowerCase()) : undefined;
    if (lista && entraNaVisaoGeral(t, agora)) lista.push(t);
  }

  let semPrazo = 0;
  const blocos = projetos.map((p) => {
    const linhaDoProjeto = idDaLinhaDoProjeto(p.id);
    const filhas: ItemDoGantt[] = [];
    let inicio = Number.POSITIVE_INFINITY;
    let fim = Number.NEGATIVE_INFINITY;
    for (const t of doProjeto.get(p.id.toLowerCase()) ?? []) {
      const item = { ...itemDaTarefa(t, agora, atrasada), parent: linhaDoProjeto };
      if (t.dueDate) {
        inicio = Math.min(inicio, item.start.getTime());
        fim = Math.max(fim, item.end.getTime());
      } else semPrazo++;
      filhas.push(item);
    }
    filhas.sort(porBarra);
    const hoje = inicioDoDia(agora);
    const temBarra = Number.isFinite(inicio);
    const start = temBarra ? new Date(inicio) : hoje;
    const end = temBarra ? new Date(fim) : somarDias(hoje, 1);
    if (temBarra) eixo.incluir(start, end);
    const projeto: ItemDoGantt = {
      id: linhaDoProjeto,
      text: p.name,
      type: temBarra ? "projeto" : "projetovazio",
      start,
      end,
      responsavelId: p.ownerId,
      prazo: p.dueDate ?? null,
      ehProjeto: true,
      open: abertos.has(p.id),
      cor: p.color,
    };
    return { projeto, filhas, temBarra };
  });

  /* Projetos pela barra (quem começa antes vem antes); os sem barra no fim, por nome. */
  blocos.sort((a, b) => {
    if (a.temBarra !== b.temBarra) return a.temBarra ? -1 : 1;
    return (
      (a.temBarra ? a.projeto.start.getTime() - b.projeto.start.getTime() : 0) ||
      a.projeto.text.localeCompare(b.projeto.text, "pt-BR")
    );
  });

  const itens = blocos.flatMap((b) => [b.projeto, ...b.filhas]);
  return { tasks: itens, ...eixo.comFolga(), semPrazo };
}

/* ---------------------------- Arrastar a barra ---------------------------- */

/** O que muda numa tarefa quando a barra é arrastada. Só vem o que mudou. */
export interface MudancaDePlano {
  /** ISO da meia-noite (hora local) do novo início. */
  startDate?: string;
  /** ISO do novo prazo, no horário dela (ou 23:59). */
  dueDate?: string;
}

/** Arredonda para o começo do dia mais próximo: nas escalas de semana e mês o arraste cai no meio do dia. */
function diaMaisProximo(d: Date): Date {
  return inicioDoDia(d.getTime() + DIA_MS / 2);
}

/** Dias de calendário de `a` até `b` (arredondado: dias de 23 ou 25 horas não atrapalham). */
function diasEntre(a: Date, b: Date): number {
  return Math.round(
    (inicioDoDia(b.getTime()).getTime() - inicioDoDia(a.getTime()).getTime()) / DIA_MS,
  );
}

/**
 * Compara a barra de antes com a de depois do arraste e diz o que mudou na tarefa:
 * - moveu a barra inteira: início e prazo andam juntos;
 * - puxou a ponta da direita: só o prazo;
 * - puxou a ponta da esquerda: só o início.
 *
 * Tudo em dias inteiros. O prazo fica no horário que a tarefa já tinha (`dueTime`) e, sem
 * horário, às 23:59: a mesma regra do diálogo da tarefa (`task-dialog.tsx`). Se o início
 * passar do prazo, ele fica no dia do prazo. `null` = nada mudou.
 */
export function replanejamento(
  antes: { start: Date; end: Date },
  depois: { start: Date; end: Date },
  tarefa: { dueTime?: string | null },
): MudancaDePlano | null {
  const andouInicio = diasEntre(antes.start, diaMaisProximo(depois.start));
  const andouFim = diasEntre(antes.end, diaMaisProximo(depois.end));
  if (andouInicio === 0 && andouFim === 0) return null;

  const inicio = somarDias(inicioDoDia(antes.start.getTime()), andouInicio);
  const diaDoPrazo = somarDias(inicioDoDia(antes.end.getTime()), andouFim - 1);
  const mudanca: MudancaDePlano = {};
  if (andouFim !== 0) {
    const [h, m] = /^([01]\d|2[0-3]):([0-5]\d)$/.test(tarefa.dueTime ?? "")
      ? tarefa.dueTime!.split(":").map(Number)
      : [23, 59];
    const prazo = new Date(diaDoPrazo);
    prazo.setHours(h!, m!, 0, 0);
    mudanca.dueDate = prazo.toISOString();
  }
  if (andouInicio !== 0) {
    mudanca.startDate = (inicio > diaDoPrazo ? diaDoPrazo : inicio).toISOString();
  }
  return mudanca;
}

/* ------------------------------ Dependências ------------------------------ */

/** `tarefaId` só começa quando `dependeDeId` terminar (fim → início). Ids em qualquer caixa. */
export interface Dependencia {
  tarefaId: string;
  dependeDeId: string;
}

/** A seta no formato do SVAR: da que precisa terminar (`source`) para a que espera (`target`). */
export interface LigacaoDoGantt {
  id: string;
  source: string;
  target: string;
  type: "e2s";
}

/** O id da seta: "<a que termina antes>><a que espera>", com os ids como estão nas linhas. */
export const idDaLigacao = (dependeDeId: string, tarefaId: string) => `${dependeDeId}>${tarefaId}`;

/** As duas pontas de uma seta, a partir do id dela; `null` se não é uma das nossas. */
export function pontasDaLigacao(id: string | number): Dependencia | null {
  const [dependeDeId, tarefaId, ...resto] = String(id).split(">");
  return dependeDeId && tarefaId && resto.length === 0 ? { tarefaId, dependeDeId } : null;
}

/**
 * As setas que o Gantt desenha: só as que ligam duas TAREFAS que estão nele (nunca projeto),
 * com os ids das linhas (o servidor manda em minúsculas; as tarefas vêm em maiúsculas).
 */
export function ligacoesDoGantt(
  itens: readonly ItemDoGantt[],
  dependencias: readonly Dependencia[],
): LigacaoDoGantt[] {
  const porId = new Map(itens.filter((i) => !i.ehProjeto).map((i) => [i.id.toLowerCase(), i.id]));
  const vistas = new Set<string>();
  const ligacoes: LigacaoDoGantt[] = [];
  for (const d of dependencias) {
    const espera = porId.get(d.tarefaId.toLowerCase());
    const antes = porId.get(d.dependeDeId.toLowerCase());
    if (!espera || !antes || espera === antes) continue;
    const id = idDaLigacao(antes, espera);
    if (vistas.has(id)) continue;
    vistas.add(id);
    ligacoes.push({ id, source: antes, target: espera, type: "e2s" });
  }
  return ligacoes;
}

/**
 * As tarefas que começam antes de uma da qual dependem terminar: id da linha → o aviso
 * ("Começa antes de "X" terminar"). Só entre barras de verdade (com prazo).
 */
export function conflitosDeDependencia(
  itens: readonly ItemDoGantt[],
  dependencias: readonly Dependencia[],
): Map<string, string> {
  const porId = new Map(itens.filter((i) => !i.ehProjeto).map((i) => [i.id.toLowerCase(), i]));
  const nomes = new Map<string, string[]>();
  for (const d of dependencias) {
    const espera = porId.get(d.tarefaId.toLowerCase());
    const antes = porId.get(d.dependeDeId.toLowerCase());
    if (!espera || !antes || !espera.prazo || !antes.prazo) continue;
    if (espera.start.getTime() < antes.end.getTime()) {
      nomes.set(espera.id, [...(nomes.get(espera.id) ?? []), antes.text]);
    }
  }
  return new Map(
    [...nomes].map(([id, lista]) => [
      id,
      `Começa antes de ${lista.map((n) => `"${n}"`).join(" e ")} terminar`,
    ]),
  );
}

/**
 * Ligar `tarefaId` a esperar `dependeDeId` fecharia um ciclo? Sim se forem a mesma tarefa
 * ou se `dependeDeId` já espera, direto ou por outras, por `tarefaId`. O servidor confere
 * de novo; aqui é para avisar antes de pedir.
 */
export function criariaCiclo(
  dependencias: readonly Dependencia[],
  tarefaId: string,
  dependeDeId: string,
): boolean {
  const alvo = tarefaId.toLowerCase();
  const inicio = dependeDeId.toLowerCase();
  if (alvo === inicio) return true;
  const esperaPor = new Map<string, string[]>();
  for (const d of dependencias) {
    const t = d.tarefaId.toLowerCase();
    esperaPor.set(t, [...(esperaPor.get(t) ?? []), d.dependeDeId.toLowerCase()]);
  }
  const vistos = new Set<string>();
  const fila = [inicio];
  while (fila.length) {
    const atual = fila.pop()!;
    if (atual === alvo) return true;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    fila.push(...(esperaPor.get(atual) ?? []));
  }
  return false;
}
