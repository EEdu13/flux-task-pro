/**
 * Conversão entre "yyyy-MM-dd" e Date no fuso LOCAL.
 *
 * Fica fora do componente de propósito: o `new Date(iso)` errado é o tipo de
 * bug que reaparece toda vez que alguém precisa da data em outro lugar, então
 * o certo tem que estar a um import de distância.
 */

/**
 * "yyyy-MM-dd" -> Date local (ou undefined se não casar).
 *
 * new Date("2026-08-31") é lido pelo runtime como meia-noite UTC, que no
 * Brasil (UTC−3) vira 21h do dia 30 — um dia inteiro a menos. Por isso
 * montamos a data componente a componente, que é sempre local.
 */
export function isoParaData(iso: string | null | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Date local -> "yyyy-MM-dd" (toISOString somaria o fuso e voltaria um dia). */
export function dataParaIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
