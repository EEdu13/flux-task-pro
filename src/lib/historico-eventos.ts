/* "O histórico desta tarefa mudou no banco."
 *
 * Quem escreve o histórico é o servidor, então a tela não tem a linha nova em
 * mãos depois de gravar — precisa ir buscar. Quem sabe que gravou é quem chama
 * o servidor (a gravação da tarefa, o envio e a remoção de anexo), e quem sabe
 * qual tarefa está aberta no painel é o store. Este evento liga os dois sem que
 * um precise importar o outro.
 */

export const EVENTO_HISTORICO = "fluxo:historico";

export type DetalheDoHistorico = { tarefaId: string };

export function avisarHistoricoMudou(tarefaId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DetalheDoHistorico>(EVENTO_HISTORICO, { detail: { tarefaId } }),
  );
}
