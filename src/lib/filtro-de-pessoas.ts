/**
 * Quem o filtro de pessoas marca, e o que fazer com essas pessoas: mostrar só
 * as tarefas delas (`so`) ou todas menos as delas (`exceto`). Sem ninguém
 * marcado, o filtro não filtra nada, seja qual for o modo. O controle é o
 * `FiltroPessoa`.
 */
export type SelecaoDePessoas = { modo: "so" | "exceto"; ids: string[] };

export const SEM_SELECAO_DE_PESSOAS: SelecaoDePessoas = { modo: "so", ids: [] };

/** A tarefa desta pessoa passa pelo filtro? */
export function passaNoFiltroDePessoas(sel: SelecaoDePessoas, pessoaId: string): boolean {
  if (sel.ids.length === 0) return true;
  const marcada = sel.ids.includes(pessoaId);
  return sel.modo === "so" ? marcada : !marcada;
}
