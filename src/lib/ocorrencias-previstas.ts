import type { Task } from "./fluxo-types";
import { dataParaIso } from "./data-iso";
import { concluidaHoje } from "./pack";
import { proximaOcorrencia } from "./recorrencia";

/**
 * As próximas vezes de uma tarefa recorrente, para o calendário.
 *
 * O banco só guarda a ocorrência da vez: a próxima nasce quando esta é
 * concluída (ver `salvarTarefa`). Por isso o compromisso do pack, que volta
 * todo dia útil, aparecia num dia só e o resto da semana ficava vazio. Aqui a
 * série é desenhada adiante a partir do prazo atual, só para ver — a tarefa
 * de verdade continua sendo uma.
 *
 * Uma prevista é a própria tarefa com outro prazo, um `id` composto
 * ("<id>::<dia>") e `prevista` apontando para a original, que é quem abre ao
 * clicar. Nunca vai para a store nem para o servidor.
 */
export type TarefaNoCalendario = Task & { prevista?: { origem: string } };

/** Separador do id composto de uma prevista. */
const SEP = "::";

/** O id da tarefa de verdade por trás de uma pílula do calendário. */
export const idReal = (id: string) => id.split(SEP)[0]!;

/** É uma ocorrência desenhada, não uma tarefa do banco. */
export const ehPrevista = (id: string) => id.includes(SEP);

/** Teto de voltas por tarefa: uma diária atrasada há meses não trava a tela. */
const MAX_PASSOS = 800;

/**
 * As tarefas de `tarefas` mais as ocorrências previstas das recorrentes entre
 * `de` e `ate` ("yyyy-MM-dd", inclusive). Nada antes de hoje: o que passou é
 * o que de fato aconteceu, e a ocorrência atrasada já está no calendário.
 *
 * A série segue da ocorrência mais recente da tarefa. Quando a concluída de
 * ontem e a nova de hoje estão as duas na lista, a mesma data sairia duas
 * vezes; por isso nada é previsto num dia em que a mesma tarefa (título e
 * responsável) já existe.
 */
export function comOcorrenciasPrevistas(
  tarefas: Task[],
  de: string,
  ate: string,
  agora: Date = new Date(),
): TarefaNoCalendario[] {
  const hoje = dataParaIso(agora);
  const inicio = de > hoje ? de : hoje;
  if (inicio > ate) return tarefas;

  const chave = (t: Pick<Task, "title" | "assigneeId">, dia: string) =>
    `${t.assigneeId}|${t.title.trim().toLowerCase()}|${dia}`;
  const ocupado = new Set<string>();
  for (const t of tarefas) if (t.dueDate) ocupado.add(chave(t, dataParaIso(new Date(t.dueDate))));

  const previstas: TarefaNoCalendario[] = [];
  /* O pack sem prazo. Ele é do dia: fica no pack de hoje enquanto não é
     concluído (ver `noPackDeHoje`), mas sem `dueDate` não tinha dia no
     calendário e sumia dele. Aqui ele aparece hoje — com o id de verdade, é a
     própria tarefa — e, se repete, a série segue a partir de amanhã. */
  const hojeNoIntervalo = hoje >= de && hoje <= ate;
  const fimDeHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59);
  const series: { t: Task; ancora: Date }[] = [];
  for (const t of tarefas) {
    if (t.inPack && !t.dueDate) {
      // Concluída antes de hoje: era do pack de outro dia, não volta.
      if (t.status === "concluida" && !concluidaHoje(t, agora)) continue;
      if (hojeNoIntervalo && !ocupado.has(chave(t, hoje))) {
        ocupado.add(chave(t, hoje));
        previstas.push({ ...t, dueDate: fimDeHoje.toISOString() });
      }
      if (t.recurring) series.push({ t, ancora: fimDeHoje });
      continue;
    }
    if (t.recurring && t.dueDate) series.push({ t, ancora: new Date(t.dueDate) });
  }

  for (const { t, ancora } of series) {
    let atual = ancora;
    if (Number.isNaN(atual.getTime())) continue;
    for (let passos = 0; passos < MAX_PASSOS; passos++) {
      const proxima = proximaOcorrencia({ ...t, dueDate: atual.toISOString() }, atual);
      if (!proxima || proxima.getTime() <= atual.getTime()) break;
      const dia = dataParaIso(proxima);
      if (dia > ate) break;
      atual = proxima;
      if (dia < inicio) continue;
      const k = chave(t, dia);
      if (ocupado.has(k)) continue;
      ocupado.add(k);
      previstas.push({
        ...t,
        id: `${t.id}${SEP}${dia}`,
        dueDate: proxima.toISOString(),
        status: "pendente",
        completedAt: undefined,
        prevista: { origem: t.id },
      });
    }
  }
  return previstas.length ? [...tarefas, ...previstas] : tarefas;
}
