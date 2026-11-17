import { createFileRoute } from "@tanstack/react-router";

/**
 * API de integração (17/11/2026): uma tarefa pelo id do CONECTA, para o sistema acompanhar a
 * situação. Só as tarefas que o próprio sistema criou; as outras respondem 404, como se não
 * existissem. Manual: `docs/api-integracao-tarefas.md`.
 */
export const Route = createFileRoute("/api/public/v1/tarefas/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { atenderApi, ErroDaApi } = await import("@/lib/api-integracao.server");
        return atenderApi(request, "leitura", async ({ sistema }) => {
          const { lerTarefaDaApi } = await import("@/lib/api-tarefas.server");
          const tarefa = await lerTarefaDaApi(sistema, String(params.id ?? "").trim());
          if (!tarefa) {
            throw new ErroDaApi(
              404,
              "tarefa_nao_encontrada",
              "Nenhuma tarefa com esse id criada por este sistema.",
            );
          }
          return { corpo: { tarefa } };
        });
      },
      POST: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PUT: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PATCH: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      DELETE: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
    },
  },
});
