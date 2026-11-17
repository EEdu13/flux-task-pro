import { createFileRoute } from "@tanstack/react-router";

/**
 * API de integração (17/11/2026): criar tarefa (POST) e listar as tarefas que o próprio sistema
 * criou (GET). Manual: `docs/api-integracao-tarefas.md`. A regra mora em `api-tarefas.server.ts`;
 * a portaria (chave, limite, JSON) em `api-integracao.server.ts`.
 */
export const Route = createFileRoute("/api/public/v1/tarefas")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { atenderApi } = await import("@/lib/api-integracao.server");
        return atenderApi(request, "leitura", async ({ sistema }) => {
          const { listarTarefasDaApi } = await import("@/lib/api-tarefas.server");
          return { corpo: await listarTarefasDaApi(sistema, new URL(request.url).searchParams) };
        });
      },

      POST: async ({ request }) => {
        const { atenderApi, lerCorpoJson } = await import("@/lib/api-integracao.server");
        return atenderApi(request, "escrita", async ({ sistema }) => {
          const corpo = await lerCorpoJson(request);
          const { criarTarefaDaApi } = await import("@/lib/api-tarefas.server");
          const { tarefa, jaExistia } = await criarTarefaDaApi(sistema, corpo);
          return {
            // 201 = criou agora; 200 = o idExterno já tinha tarefa, e é ela que volta.
            status: jaExistia ? 200 : 201,
            corpo: { tarefa, jaExistia },
            cabecalhos: { location: `/api/public/v1/tarefas/${tarefa.id}` },
          };
        });
      },

      PUT: async () =>
        (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET, POST")(),
      PATCH: async () =>
        (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET, POST")(),
      DELETE: async () =>
        (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET, POST")(),
    },
  },
});
