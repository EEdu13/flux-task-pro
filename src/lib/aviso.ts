import type { Notification, User } from "./fluxo-types";

/**
 * O título do aviso, com o nome de quem o mandou na frente.
 *
 * O nome entra na hora de desenhar, e não vai gravado dentro da notificação.
 * Quem escreve o aviso agora é o servidor, que conhece o id da pessoa mas não o
 * nome — nome mora na IAM. E é melhor assim: congelado dentro do aviso, ele
 * mostraria para sempre como a pessoa se chamava no dia em que ligou.
 *
 * Por isso os títulos gravados são curtos e sem sujeito — "está te chamando",
 * "Novo comentário", "Chamada perdida". É esta função que completa a frase.
 */
export function tituloDoAviso(n: Notification, users: User[]): string {
  const nome = n.fromUserId ? users.find((u) => u.id === n.fromUserId)?.name : undefined;
  return nome ? `${nome} · ${n.title}` : n.title;
}

/**
 * Para onde vai o clique num aviso do Mural (27/11/2026): direto no post, e no
 * comentário quando o aviso é de um. Aviso antigo, sem post gravado, abre o
 * Mural no topo como antes. Um lugar só, para a sineta e a caixa de entrada
 * levarem ao mesmo ponto.
 */
export function rumoDoAvisoDoMural(n: Notification) {
  return {
    to: "/mural" as const,
    search: n.muralPostId
      ? {
          post: n.muralPostId,
          ...(n.muralComentarioId ? { comentario: n.muralComentarioId } : {}),
        }
      : {},
  };
}
