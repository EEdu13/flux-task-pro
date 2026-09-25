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

/** O prazo já passou em `agora`? Sem prazo, nunca. */
export function prazoVencido(
  dueDate: string | null | undefined,
  agora: number = Date.now(),
): boolean {
  return !!dueDate && new Date(dueDate).getTime() < agora;
}

/**
 * "25/09/2026", ou "25/09/2026 · 14:00" quando a pessoa escolheu o horário.
 * Sem horário escolhido a hora não aparece: 17:00 e 23:59 são regra da casa,
 * não algo que alguém decidiu.
 */
export function rotuloDoPrazo(
  t: { dueDate: string | null; dueTime?: string | null },
  formato?: Intl.DateTimeFormatOptions,
): string {
  if (!t.dueDate) return SEM_PRAZO;
  const dia = new Date(t.dueDate).toLocaleDateString("pt-BR", formato);
  return t.dueTime ? `${dia} · ${t.dueTime}` : dia;
}
