import { createFileRoute } from "@tanstack/react-router";

/**
 * API de integração (17/11/2026): os projetos do CONECTA, para o `projetoId` de uma tarefa nova.
 * Manual: `docs/api-integracao-tarefas.md`.
 */
export const Route = createFileRoute("/api/public/v1/projetos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { atenderApi } = await import("@/lib/api-integracao.server");
        return atenderApi(request, "leitura", async () => {
          const { listarProjetosDaApi } = await import("@/lib/api-tarefas.server");
          return { corpo: await listarProjetosDaApi(new URL(request.url).searchParams) };
        });
      },
      POST: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PUT: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PATCH: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      DELETE: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
    },
  },
});
