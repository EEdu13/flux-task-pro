import { createFileRoute } from "@tanstack/react-router";

/**
 * API de integração (17/11/2026): quem pode ser responsável ou solicitante de uma tarefa (o mesmo
 * quadro de Contatos do app), com os filtros `email` e `busca`. Manual:
 * `docs/api-integracao-tarefas.md`.
 */
export const Route = createFileRoute("/api/public/v1/pessoas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { atenderApi } = await import("@/lib/api-integracao.server");
        return atenderApi(request, "leitura", async () => {
          const { listarPessoasDaApi } = await import("@/lib/api-tarefas.server");
          return { corpo: await listarPessoasDaApi(new URL(request.url).searchParams) };
        });
      },
      POST: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PUT: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PATCH: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      DELETE: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
    },
  },
});
