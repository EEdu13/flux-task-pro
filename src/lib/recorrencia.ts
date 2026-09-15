import type { Frequency, Task } from "./fluxo-types";

/**
 * Cálculo da próxima ocorrência de uma tarefa recorrente.
 *
 * Vive fora da store de propósito: é aritmética de calendário pura, o tipo de
 * coisa que quebra em casos de borda (dia 31 em fevereiro, horário de verão,
 * mês com cinco segundas) e que precisa poder ser conferida isoladamente.
 *
 * Histórico: a geração automática existia e foi removida no commit e708d06,
 * pelo bot do Lovable, sem justificativa — deixando a caixa "repete
 * automaticamente ao concluir" prometendo algo que não acontecia.
 */

/** Nomes dos dias, para os rótulos da interface. 0 = domingo. */
export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** Marcador de "último dia do mês" em `recurringMonthDay`. */
export const ULTIMO_DIA_DO_MES = -1;

/** Marcador de "último dia útil do mês" em `recurringMonthDay`. */
export const ULTIMO_DIA_UTIL = -2;

export const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

/** Último dia do mês de uma data (28, 29, 30 ou 31). */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes + 1, 0).getDate();
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): Date {
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
  return new Date(ano, mes - 1, dia);
}

/**
 * Feriado nacional por lei — só os que param o país inteiro.
 *
 * Carnaval e Corpus Christi ficam de fora: são ponto facultativo, e muita
 * empresa trabalha. Dos que entram, o único que chega a cair no fim do mês é a
 * Sexta-feira Santa (fim de março), mas a lista inteira custa o mesmo.
 */
function feriadoNacional(d: Date): boolean {
  const chave = `${d.getMonth() + 1}-${d.getDate()}`;
  if (["1-1", "4-21", "5-1", "9-7", "10-12", "11-2", "11-15", "11-20", "12-25"].includes(chave)) {
    return true;
  }
  const sextaSanta = pascoa(d.getFullYear());
  sextaSanta.setDate(sextaSanta.getDate() - 2);
  return d.getMonth() === sextaSanta.getMonth() && d.getDate() === sextaSanta.getDate();
}

/** Último dia útil do mês: recua do último dia pulando fim de semana e feriado. */
function ultimoDiaUtil(ano: number, mes: number): number {
  const d = new Date(ano, mes, ultimoDiaDoMes(ano, mes));
  while (d.getDay() === 0 || d.getDay() === 6 || feriadoNacional(d)) d.setDate(d.getDate() - 1);
  return d.getDate();
}

/**
 * Move para o dia do mês pedido, sem escorregar para o mês seguinte.
 *
 * `new Date(2026, 1, 31)` vira 3 de março silenciosamente. Numa tarefa marcada
 * para o dia 31, isso faria a ocorrência de fevereiro aparecer em março e a de
 * março sumir. Aqui o dia é limitado ao tamanho real do mês.
 */
function comDiaDoMes(base: Date, dia: number): Date {
  const d = new Date(base);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const limite = ultimoDiaDoMes(ano, mes);
  d.setDate(
    dia === ULTIMO_DIA_UTIL
      ? ultimoDiaUtil(ano, mes)
      : dia === ULTIMO_DIA_DO_MES
        ? limite
        : Math.min(dia, limite),
  );
  return d;
}

/**
 * A primeira data, a partir de hoje, que obedece à regra escolhida.
 *
 * Usada quando a pessoa escolhe o dia (ou o mês, no anual): o prazo da primeira
 * tarefa passa a seguir a regra também. Sem isso, escolher "último dia útil"
 * com o prazo em hoje criava a primeira para hoje e só as seguintes no dia certo.
 *
 * `mes` só vale para o anual. Devolve a data local à meia-noite.
 */
export function primeiraDataDaRegra(
  frequencia: "mensal" | "anual",
  dia: number,
  mes: number,
  hoje: Date = new Date(),
): Date {
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const tentativa = (ano: number, m: number) => comDiaDoMes(new Date(ano, m, 1), dia);
  if (frequencia === "mensal") {
    const nesteMes = tentativa(inicio.getFullYear(), inicio.getMonth());
    return nesteMes.getTime() >= inicio.getTime()
      ? nesteMes
      : tentativa(inicio.getFullYear(), inicio.getMonth() + 1);
  }
  const nesteAno = tentativa(inicio.getFullYear(), mes);
  return nesteAno.getTime() >= inicio.getTime() ? nesteAno : tentativa(inicio.getFullYear() + 1, mes);
}

/**
 * Próxima data de vencimento depois de `apartirDe`.
 *
 * Devolve `null` quando a recorrência já passou do limite (`recurringUntil`).
 * O horário do prazo original é preservado — tarefa criada para 23:59 continua
 * vencendo 23:59, e uma adiada para 9h mantém as 9h.
 */
export function proximaOcorrencia(
  tarefa: Pick<
    Task,
    "dueDate" | "frequency" | "recurring" | "recurringUntil" | "recurringWeekdays" | "recurringMonthDay"
  >,
  apartirDe: Date = new Date(),
): Date | null {
  if (!tarefa.recurring) return null;

  const prazo = new Date(tarefa.dueDate);
  if (Number.isNaN(prazo.getTime())) return null;

  // A contagem parte do prazo, não de hoje: concluir adiantado não deve
  // empurrar a série toda para frente.
  const base = prazo.getTime() > apartirDe.getTime() ? prazo : apartirDe;
  let proxima: Date;

  switch (tarefa.frequency as Frequency) {
    case "diaria": {
      proxima = new Date(base);
      proxima.setDate(proxima.getDate() + 1);
      break;
    }

    case "semanal": {
      const escolhidos = (tarefa.recurringWeekdays ?? []).filter((d) => d >= 0 && d <= 6);
      if (escolhidos.length === 0) {
        proxima = new Date(base);
        proxima.setDate(proxima.getDate() + 7);
        break;
      }
      // Varre os próximos sete dias e para no primeiro marcado. Cobre "segunda
      // e quinta" sem precisar ordenar nem tratar a virada da semana.
      const ordenados = [...new Set(escolhidos)].sort((a, b) => a - b);
      proxima = new Date(base);
      for (let i = 1; i <= 7; i++) {
        const tentativa = new Date(base);
        tentativa.setDate(tentativa.getDate() + i);
        if (ordenados.includes(tentativa.getDay())) {
          proxima = tentativa;
          break;
        }
      }
      break;
    }

    case "mensal": {
      const dia = tarefa.recurringMonthDay ?? prazo.getDate();
      proxima = new Date(base);
      // Dia 1 antes de trocar de mês: senão, partindo do dia 31, o setMonth
      // pularia um mês inteiro pelo mesmo motivo do comDiaDoMes.
      proxima.setDate(1);
      proxima.setMonth(proxima.getMonth() + 1);
      proxima = comDiaDoMes(proxima, dia);
      break;
    }

    case "anual": {
      /* O mês vem do prazo: a tarefa anual guarda só o dia (`recurringMonthDay`),
         e quem escolhe o mês na tela está movendo o prazo para ele. Assim a série
         não precisa de coluna nova e continua ancorada no prazo, como a mensal.

         Parte do ano do prazo, e não de hoje: concluir com meses de atraso a de
         dezembro passado gera a deste dezembro, não a do ano que vem. */
      const dia = tarefa.recurringMonthDay ?? prazo.getDate();
      const hoje = new Date(apartirDe.getFullYear(), apartirDe.getMonth(), apartirDe.getDate());
      let ano = prazo.getFullYear() + 1;
      proxima = comDiaDoMes(new Date(ano, prazo.getMonth(), 1), dia);
      while (proxima.getTime() < hoje.getTime()) {
        ano += 1;
        proxima = comDiaDoMes(new Date(ano, prazo.getMonth(), 1), dia);
      }
      break;
    }

    default:
      return null;
  }

  // O horário vem sempre do prazo original.
  proxima.setHours(prazo.getHours(), prazo.getMinutes(), prazo.getSeconds(), 0);

  if (tarefa.recurringUntil) {
    const limite = new Date(tarefa.recurringUntil);
    if (!Number.isNaN(limite.getTime()) && proxima.getTime() > limite.getTime()) return null;
  }

  return proxima;
}

/** Descrição curta da regra, para mostrar na interface. */
export function descreverRecorrencia(
  tarefa: Pick<Task, "frequency" | "recurring" | "recurringWeekdays" | "recurringMonthDay"> & {
    /** Só o anual usa: o mês sai do prazo. "yyyy-MM-dd" ou ISO. */
    dueDate?: string;
  },
): string {
  if (!tarefa.recurring) return "Não repete";
  switch (tarefa.frequency as Frequency) {
    case "diaria":
      return "Todo dia";
    case "semanal": {
      const dias = (tarefa.recurringWeekdays ?? []).filter((d) => d >= 0 && d <= 6);
      if (dias.length === 0) return "Toda semana";
      if (dias.length === 7) return "Todo dia";
      const nomes = [...new Set(dias)].sort((a, b) => a - b).map((d) => DIAS_SEMANA[d]);
      return `Toda ${nomes.join(", ")}`;
    }
    case "mensal": {
      const dia = tarefa.recurringMonthDay;
      if (dia === ULTIMO_DIA_UTIL) return "Todo último dia útil do mês";
      if (dia === ULTIMO_DIA_DO_MES) return "Todo último dia do mês";
      if (dia && dia >= 1 && dia <= 31) return `Todo dia ${dia} de cada mês`;
      return "Todo mês";
    }
    case "anual": {
      // "yyyy-MM-dd" é lido no fuso local; um ISO completo passa pelo Date —
      // 23:59 do dia 31 no Brasil já é dia 1º em UTC, e o mês viraria.
      const raw = tarefa.dueDate ?? "";
      const so = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const prazo = so
        ? new Date(Number(so[1]), Number(so[2]) - 1, Number(so[3]))
        : new Date(raw);
      if (!raw || Number.isNaN(prazo.getTime())) return "Todo ano";
      const mes = MESES[prazo.getMonth()];
      const dia = tarefa.recurringMonthDay;
      if (dia === ULTIMO_DIA_UTIL) return `Todo ano, no último dia útil de ${mes}`;
      if (dia === ULTIMO_DIA_DO_MES) return `Todo ano, no último dia de ${mes}`;
      const n = dia && dia >= 1 && dia <= 31 ? dia : prazo.getDate();
      return `Todo ano, em ${n} de ${mes}`;
    }
    default:
      return "Não repete";
  }
}
