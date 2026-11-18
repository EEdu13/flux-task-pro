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
