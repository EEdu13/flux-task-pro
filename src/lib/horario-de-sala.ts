/**
 * A conta de horas das salas físicas de reunião, num lugar só.
 *
 * O modal de reserva e a agenda do dia precisam enxergar o MESMO expediente e o
 * mesmo passo de 30 min: um horário que a agenda oferece como livre tem que ser
 * um horário que a grade da reserva aceita. Com as contas copiadas nos dois
 * arquivos, bastava mudar uma delas para a agenda oferecer o que a grade recusa.
 */

/** "14:30" → 870. A conta toda é em minutos desde a meia-noite. */
export const emMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export const emHora = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Passo da grade. 30 min é a menor reunião que se marca. */
export const PASSO = 30;

/** Expediente. Só o padrão: uma reserva fora dele alarga a janela da grade. */
export const EXPEDIENTE = { de: 7 * 60, ate: 19 * 60 };

export interface Intervalo {
  de: number;
  ate: number;
}

/**
 * As janelas livres entre `de` e `ate`, com pelo menos um passo cada.
 *
 * Uma sobra menor que 30 min não é oferecida: a grade da reserva não deixa
 * marcar menos que isso, e mostrar "14:10–14:30" como livre seria convidar a
 * pessoa para um horário que ela não consegue reservar.
 */
export function janelasLivres(ocupados: Intervalo[], de: number, ate: number): Intervalo[] {
  const livres: Intervalo[] = [];
  let cursor = de;
  for (const o of [...ocupados].sort((a, b) => a.de - b.de)) {
    if (o.ate <= cursor) continue;
    if (o.de >= ate) break;
    if (o.de - cursor >= PASSO) livres.push({ de: cursor, ate: o.de });
    cursor = Math.max(cursor, o.ate);
  }
  if (ate - cursor >= PASSO) livres.push({ de: cursor, ate });
  return livres;
}

/** "1h", "30 min", "1h30". */
export function duracaoPorExtenso(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
