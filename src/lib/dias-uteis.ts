/**
 * Dias úteis e feriados — uma regra só, na tela e no servidor.
 *
 * Por que existe (relato de 13/10/2026): o 12/10 é feriado nacional, mas a
 * recorrência de "dias úteis" (a do pack) e o cálculo de atraso só conheciam
 * sábado e domingo. O pack nasceu para o feriado e, no dia seguinte, o sistema
 * cobrou essas tarefas como atrasadas.
 *
 * As regras:
 *   - o PRAZO É UM DIA, não um instante: concluir no dia do prazo é no prazo,
 *     seja qual for o horário (o horário é o plano do dia — decisão de
 *     07/10/2026 para o pack, estendida a todas as tarefas em 13/10/2026);
 *   - prazo que cai em feriado ou fim de semana vence no PRÓXIMO DIA ÚTIL;
 *   - a recorrência de dias da semana não nasce em feriado.
 *
 * Sem imports e sem `Date` local nas contas de calendário do servidor: tudo o
 * que é "dia" anda como meia-noite UTC daquele dia de Brasília. O Brasil não
 * tem horário de verão desde 2019, então Brasília é sempre UTC−3.
 */

const BRASILIA_MS = 3 * 3600_000;
const DIA_MS = 86_400_000;

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher): mês 0..11 e dia. */
function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes: mes - 1, dia };
}

/**
 * Feriado nacional por lei — os que param o país inteiro: Confraternização,
 * Tiradentes, Trabalho, Independência, Aparecida, Finados, República,
 * Consciência Negra, Natal e a Sexta-feira Santa.
 *
 * Carnaval e Corpus Christi ficam de fora: são ponto facultativo, e a empresa
 * trabalha. Feriado municipal ou da empresa, se um dia for preciso, entra aqui.
 */
export function ehFeriadoNacional(ano: number, mes: number, dia: number): boolean {
  const chave = `${mes + 1}-${dia}`;
  if (["1-1", "4-21", "5-1", "9-7", "10-12", "11-2", "11-15", "11-20", "12-25"].includes(chave))
    return true;
  const p = pascoa(ano);
  const sexta = new Date(Date.UTC(ano, p.mes, p.dia) - 2 * DIA_MS);
  return sexta.getUTCMonth() === mes && sexta.getUTCDate() === dia;
}

/** Feriado nacional, lendo os campos LOCAIS da data (o navegador está em Brasília). */
export function feriadoNacional(d: Date): boolean {
  return ehFeriadoNacional(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Dia (meia-noite UTC) de Brasília em que cai um instante. */
function diaBr(instante: number): number {
  const d = new Date(instante - BRASILIA_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function ehDiaUtilUtc(dia: number): boolean {
  const d = new Date(dia);
  const sem = d.getUTCDay();
  return (
    sem !== 0 &&
    sem !== 6 &&
    !ehFeriadoNacional(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/** O próprio dia, se útil; senão o próximo dia útil. */
function primeiroDiaUtilDesde(dia: number): number {
  let d = dia;
  for (let i = 0; i < 15 && !ehDiaUtilUtc(d); i++) d += DIA_MS;
  return d;
}

/**
 * Quando a tarefa passa a contar como atrasada, em ms: o FIM do dia útil do
 * prazo em Brasília (23:59:59,999). Prazo em feriado ou fim de semana vai para
 * o fim do próximo dia útil.
 */
export function fimDoPrazoEfetivo(prazo: string | number | Date): number {
  const ms = new Date(prazo).getTime();
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return primeiroDiaUtilDesde(diaBr(ms)) + DIA_MS - 1 + BRASILIA_MS;
}

/**
 * Entregue no prazo? Compara DIAS: o dia da entrega ("AAAA-MM-DD", em
 * Brasília) contra o dia útil do prazo.
 */
export function entregueNoPrazo(prazo: string | null | undefined, diaDaEntrega: string): boolean {
  if (!prazo) return true;
  const [a, m, d] = diaDaEntrega.split("-").map(Number);
  if (!a || !m || !d) return true;
  return Date.UTC(a, m - 1, d) <= primeiroDiaUtilDesde(diaBr(new Date(prazo).getTime()));
}

/**
 * Para o SQL do servidor: o último dia útil ANTES de hoje (Brasília), em
 * "AAAA-MM-DD". Uma tarefa está atrasada hoje se, e só se, o DIA do prazo é
 * menor ou igual a ele — um prazo num feriado/fim de semana logo antes de hoje
 * fica depois dele, e por isso ainda não conta como atraso.
 */
export function ultimoDiaUtilAntesDeHoje(agora: number = Date.now()): string {
  let d = diaBr(agora) - DIA_MS;
  for (let i = 0; i < 15 && !ehDiaUtilUtc(d); i++) d -= DIA_MS;
  return new Date(d).toISOString().slice(0, 10);
}

/** Dias de atraso contados em dias de Brasília a partir do dia útil do prazo. ≤ 0 = no prazo. */
export function diasDeAtraso(prazo: string | number | Date, agora: number = Date.now()): number {
  const efetivo = primeiroDiaUtilDesde(diaBr(new Date(prazo).getTime()));
  return Math.round((diaBr(agora) - efetivo) / DIA_MS);
}
