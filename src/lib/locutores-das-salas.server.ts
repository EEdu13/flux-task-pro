/*
 * Quem está falando em cada sala — na memória do servidor (03/11/2026).
 * EXCLUSIVO do servidor: carregue dentro dos handlers, como o `db.server`.
 *
 * Morava em `gestor.salas.locutores`. Cada participante de uma reunião
 * gravava a MESMA linha a cada troca de quem fala, e as gravações faziam fila
 * umas atrás das outras: 25 mil por semana somando 258 s de espera no banco
 * para 5 s de trabalho de fato. O dado vale 5 segundos e só serve para o
 * cartão da sala lá fora — memória é o lugar dele. O CONECTA roda num
 * processo só; reiniciar apaga, e na próxima troca de locutor volta.
 */

/** Por quanto tempo a lista vale sem ser renovada (era o mesmo no banco). */
const VALE_MS = 5_000;

const porSala = new Map<string, { locutores: string[]; em: number }>();

export function publicarLocutores(sala: string, locutores: string[]): void {
  if (locutores.length) porSala.set(sala, { locutores, em: Date.now() });
  else porSala.delete(sala);
}

/** Os locutores da sala, se a lista foi renovada nos últimos 5 s. */
export function locutoresDe(sala: string): string[] | undefined {
  const l = porSala.get(sala);
  if (!l) return undefined;
  if (Date.now() - l.em >= VALE_MS) {
    porSala.delete(sala);
    return undefined;
  }
  return l.locutores;
}
