/**
 * Duas peças para escrever operação de servidor sem poder errar a identidade.
 *
 * No item 1 a correção foi manual: em cada uma das 18 funções, uma linha
 * chamando `pessoaDaSessao()`. Funciona, mas depende de lembrar — e o item 3
 * traz mais 51 oportunidades de escrever uma função que aceita o id como
 * parâmetro. O buraco voltaria pela porta nova, sem nada avisando, porque o
 * código compilaria e funcionaria: só estaria acreditando na pessoa errada.
 *
 * `semIdentidade` fecha a entrada, `comSessao` entrega a pessoa pronta:
 *
 *     export const concluirTarefa = createServerFn({ method: "POST" })
 *       .inputValidator(semIdentidade((e: { tarefaId: string }) => ({
 *         tarefaId: String(e.tarefaId),
 *       })))
 *       .handler(comSessao(async (eu, dados) => { ... }));
 *
 * Nenhuma conversão de tipo em nenhuma das duas. Elas envolvem só o VALIDADOR e
 * só o CORPO — nunca o `createServerFn` inteiro. A diferença importa: envolvendo
 * o construtor, o tipo do retorno ainda é uma incógnita quando o framework vai
 * conferir se ele atravessa a rede, e ele recusa. Envolvendo o corpo, o tipo já
 * está resolvido antes de o `.handler()` sequer olhar.
 */

/**
 * Campos de identidade proibidos na entrada.
 *
 * `userId?: never` significa "esta chave não pode existir com valor". Um
 * validador que devolva `{ userId: string }` deixa de ser atribuível, e o erro
 * aparece na linha de quem escreveu — não em produção, semanas depois.
 *
 * A lista cobre os nomes que o projeto usava de fato antes do item 1. Nenhuma
 * regra automática pegaria um nome inventado amanhã; o que ela garante é que
 * copiar o padrão antigo não compila mais.
 */
type SemIdentidade<T> = T & {
  userId?: never;
  usuarioId?: never;
  pessoaId?: never;
  fromUserId?: never;
  callerUserId?: never;
  inviterUserId?: never;
  resolverUserId?: never;
  actorUserId?: never;
};

/**
 * Marca um validador como livre de identidade.
 *
 * Em tempo de execução ele devolve a mesma função que recebeu — o trabalho todo
 * é do tipo, e acontece na hora da chamada: para o argumento ser aceito, o que
 * ele devolve precisa caber em `SemIdentidade`, e um `userId` não cabe.
 *
 * Repare que o tipo de SAÍDA descarta o `SemIdentidade` e fica só o `TValidado`
 * limpo. É de propósito: a proibição já valeu na porta de entrada, e um tipo
 * cheio de `never` opcional confunde o framework depois — ele achatava tudo
 * para `{}` e o handler perdia os campos.
 */
export function semIdentidade<TBruto, TValidado extends object>(
  validador: (bruto: TBruto) => SemIdentidade<TValidado>,
): (bruto: TBruto) => TValidado {
  return validador;
}

/**
 * Envolve o corpo do handler, entregando a pessoa da sessão como primeiro
 * argumento.
 *
 * O `Omit` no contexto é o que impede o corpo de espiar o `data` cru por outro
 * caminho: ele recebe os dados já validados, e nada mais.
 */
export function comSessao<TEntrada, TSaida>(
  corpo: (eu: number, dados: TEntrada) => Promise<TSaida>,
): (contexto: { data: TEntrada }) => Promise<TSaida> {
  return async ({ data }) => {
    // Carregado aqui dentro, e não no topo: este módulo é importado por
    // arquivos que o cliente também enxerga, e `identidade.server` só existe no
    // servidor.
    const { pessoaDaSessao } = await import("./identidade.server");
    return corpo(await pessoaDaSessao(), data);
  };
}

/** Mesma ideia para operação sem entrada: "me traga o que é meu". */
export function comSessaoSemEntrada<TSaida>(
  corpo: (eu: number) => Promise<TSaida>,
): () => Promise<TSaida> {
  return async () => {
    const { pessoaDaSessao } = await import("./identidade.server");
    return corpo(await pessoaDaSessao());
  };
}
