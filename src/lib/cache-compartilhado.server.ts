/*
 * Respostas guardadas por pouco tempo na memória do servidor, para todo mundo.
 * EXCLUSIVO do servidor: carregue dentro dos handlers, como o `db.server`.
 *
 * As sondagens do app (chamadas, cutucadas, salas, presença, conversas)
 * perguntam a mesma coisa ao banco de segundo em segundo, uma vez por pessoa
 * conectada. Isso cresce em linha reta com a empresa: em 06/10/2026, com todos
 * os setores entrando, passou de 500 consultas por segundo, bem acima do que o
 * pool de 20 conexões atende com a ida e volta até o Azure. Tudo entrou na
 * fila atrás delas, login e salvar tarefa inclusive, e os erros eram
 * "operation timed out" do pool, não do banco: cada consulta levava 0,1 ms lá.
 *
 * Aqui a pergunta vai ao banco no máximo uma vez por período, para todos; cada
 * pessoa filtra a parte dela da resposta guardada. Os intervalos das telas não
 * mudam (ver a memória sobre os tempos calibrados para a latência Brasil↔EUA).
 *
 * Duas regras:
 * - quem chega durante uma busca espera a mesma busca, em vez de abrir outra;
 * - se a busca falhar, a última resposta continua valendo por mais alguns
 *   segundos: uma sondagem um pouco velha é melhor que um erro na tela, e
 *   depois disso o erro aparece, para não mostrar coisa antiga como atual.
 *
 * É memória do processo. Com mais de uma réplica, cada uma guarda a sua e o
 * banco recebe uma busca por réplica: ainda um número fixo, não por pessoa.
 */

type Guardado<T> = { valor?: T; em: number; buscando?: Promise<T> };

const guardados = new Map<string, Guardado<unknown>>();

/** Quanto tempo, além da validade, a última resposta ainda serve se o banco falhar. */
const TOLERANCIA_NA_FALHA_MS = 15_000;

/**
 * A resposta guardada em `chave`, se tiver menos de `validadeMs`; senão busca
 * de novo com `buscar`, uma vez só para quem estiver pedindo ao mesmo tempo.
 */
export function compartilhado<T>(
  chave: string,
  validadeMs: number,
  buscar: () => Promise<T>,
): Promise<T> {
  let g = guardados.get(chave) as Guardado<T> | undefined;
  if (!g) {
    g = { em: 0 };
    guardados.set(chave, g);
  }
  if (g.valor !== undefined && Date.now() - g.em < validadeMs) return Promise.resolve(g.valor);
  if (g.buscando) return g.buscando;

  const atual = g;
  const busca: Promise<T> = buscar()
    .then((valor) => {
      atual.valor = valor;
      atual.em = Date.now();
      return valor;
    })
    .catch((e: unknown) => {
      if (
        atual.valor !== undefined &&
        Date.now() - atual.em < validadeMs + TOLERANCIA_NA_FALHA_MS
      ) {
        return atual.valor;
      }
      throw e;
    })
    .finally(() => {
      if (atual.buscando === busca) atual.buscando = undefined;
    });
  atual.buscando = busca;
  return busca;
}

/**
 * Descarta a resposta guardada: a próxima pergunta vai ao banco. Para quem
 * acabou de gravar o que a resposta mostra (uma chamada nova, uma mensagem).
 * Uma busca que já estava no ar termina sem gravar aqui, porque pode ter lido
 * o banco antes da gravação.
 */
export function esquecer(chave: string): void {
  guardados.delete(chave);
}
