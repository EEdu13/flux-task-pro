/**
 * As regras do prazo que valem em toda tela.
 *
 * Desde 25/09/2026 a tarefa pode não ter prazo (`dueDate` nulo). Antes cada
 * tela fazia `new Date(t.dueDate)` por conta própria; com o prazo vazio isso
 * vira 1º/01/1970, e a tarefa sem prazo apareceria como a mais atrasada de
 * todas. As três perguntas que as telas fazem — venceu? em que ordem? como
 * escrever? — ficam aqui, respondidas uma vez.
 */

/** O mesmo texto em toda tela. */
export const SEM_PRAZO = "Sem prazo";

/** Horário no formato que o campo e o banco usam: "HH:mm", 00:00 a 23:59. */
export const HORARIO_VALIDO = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Instante do prazo. Sem prazo vale +∞: fica depois de qualquer data. */
export function prazoMs(dueDate: string | null | undefined): number {
  return dueDate ? new Date(dueDate).getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Para `sort`: prazo mais cedo primeiro, sem prazo por último.
 * Compara em vez de subtrair — ∞ − ∞ é NaN, e NaN embaralha a ordenação.
 */
export function porPrazo(a: { dueDate: string | null }, b: { dueDate: string | null }): number {
  const x = prazoMs(a.dueDate);
  const y = prazoMs(b.dueDate);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Quando a tarefa passa a contar como atrasada, em ms. Sem prazo, +∞.
 *
 * O item do pack é do DIA: o horário que a pessoa põe nele é o plano ("faço
 * às 10h"), não a hora em que ela perde o compromisso. Contar o horário como
 * prazo fazia o item virar atrasado/perdido às 10h01 e a conclusão da tarde
 * valer menos — o pack era perdido por ter horário. Decisão do usuário,
 * 07/10/2026. O servidor faz a mesma conta em `gravarNoBanco`.
 */
export function venceEm(t: { dueDate: string | null | undefined; inPack?: boolean }): number {
  if (!t.dueDate) return Number.POSITIVE_INFINITY;
  const d = new Date(t.dueDate);
  if (!t.inPack) return d.getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

/** A tarefa aberta já está atrasada em `agora` — com a regra do pack. */
export function tarefaVencida(
  t: { dueDate: string | null | undefined; inPack?: boolean },
  agora: number = Date.now(),
): boolean {
  return venceEm(t) < agora;
}

/** O prazo já passou em `agora`? Sem prazo, nunca. */
export function prazoVencido(
  dueDate: string | null | undefined,
  agora: number = Date.now(),
): boolean {
  return !!dueDate && new Date(dueDate).getTime() < agora;
}

/**
 * "25/09/2026", ou "25/09/2026 · 14:00" quando a pessoa escolheu o horário.
 * Sem horário escolhido a hora não aparece: o 23:59 é regra da casa, não algo
 * que alguém decidiu. (Prazos antigos trocados pela janela da tarefa podem
 * estar às 17:00, a regra de lá até 30/09/2026.)
 */
export function rotuloDoPrazo(
  t: { dueDate: string | null; dueTime?: string | null },
  formato?: Intl.DateTimeFormatOptions,
): string {
  if (!t.dueDate) return SEM_PRAZO;
  const dia = new Date(t.dueDate).toLocaleDateString("pt-BR", formato);
  return t.dueTime ? `${dia} · ${t.dueTime}` : dia;
}
