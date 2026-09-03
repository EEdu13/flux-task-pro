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

/** Último dia do mês de uma data (28, 29, 30 ou 31). */
function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(ano, mes + 1, 0).getDate();
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
  const limite = ultimoDiaDoMes(d.getFullYear(), d.getMonth());
  d.setDate(dia === ULTIMO_DIA_DO_MES ? limite : Math.min(dia, limite));
  return d;
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
  tarefa: Pick<Task, "frequency" | "recurring" | "recurringWeekdays" | "recurringMonthDay">,
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
      if (dia === ULTIMO_DIA_DO_MES) return "Todo último dia do mês";
      if (dia && dia >= 1 && dia <= 31) return `Todo dia ${dia} de cada mês`;
      return "Todo mês";
    }
    default:
      return "Não repete";
  }
}
