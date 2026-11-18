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
}

/**
 * A cor da barra. "Atrasada" ganha das outras; "semprazo" desenha a linha na lista
 * da esquerda com a barra escondida (o Gantt grátis não aceita tarefa sem datas).
 */
export type SituacaoNoGantt = "pendente" | "andamento" | "concluida" | "atrasada" | "semprazo";

/** Uma linha do Gantt, no formato do SVAR (`ITask`) mais os nossos campos. */
export interface ItemDoGantt {
  id: string;
  text: string;
  type: SituacaoNoGantt;
  start: Date;
  /** Exclusivo, como o SVAR quer: 00:00 do dia seguinte ao do prazo. */
  end: Date;
  responsavelId: string;
  /** ISO do prazo, ou `null` para "Sem prazo" na coluna da esquerda. */
  prazo: string | null;
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

/** As tarefas de um projeto, sem a linha do projeto (a aba já está dentro dele). */
export function montarGanttDoProjeto(
  tarefas: readonly TarefaParaGantt[],
  agora: number,
  atrasada: RegraDeAtraso,
): MontagemDoGantt {
  const hoje = inicioDoDia(agora);
  let inicio = hoje;
  let fim = somarDias(hoje, 1);
  let semPrazo = 0;
  const itens = tarefas.map((t): ItemDoGantt => {
    const { start, end } = barraDaTarefa(t, agora);
    if (t.dueDate) {
      if (start < inicio) inicio = start;
      if (end > fim) fim = end;
    } else semPrazo++;
    return {
      id: t.id,
      text: t.title,
      type: situacaoNoGantt(t, agora, atrasada),
      start,
      end,
      responsavelId: t.assigneeId,
      prazo: t.dueDate,
    };
  });
  /* Pela barra: o que começa antes vem antes. Sem prazo, no fim. */
  itens.sort((a, b) => {
    if (!a.prazo !== !b.prazo) return a.prazo ? -1 : 1;
    return (
      a.start.getTime() - b.start.getTime() ||
      a.end.getTime() - b.end.getTime() ||
      a.text.localeCompare(b.text, "pt-BR")
    );
  });
  return {
    tasks: itens,
    inicio: somarDias(inicio, -FOLGA_ANTES),
    fim: somarDias(fim, FOLGA_DEPOIS),
    semPrazo,
  };
}
