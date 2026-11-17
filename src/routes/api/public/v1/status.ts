import { createFileRoute } from "@tanstack/react-router";

/**
 * API de integração (17/11/2026): confere a chave e responde quem é o sistema. É a primeira
 * chamada de quem integra, para saber que endereço e chave estão certos. Manual:
 * `docs/api-integracao-tarefas.md`. A portaria de todas as rotas é `api-integracao.server.ts`.
 */
export const Route = createFileRoute("/api/public/v1/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { atenderApi, LIMITE_POR_MINUTO, VERSAO_DA_API } =
          await import("@/lib/api-integracao.server");
        return atenderApi(request, "leitura", async ({ sistema }) => ({
          corpo: {
            ok: true,
            sistema,
            versao: VERSAO_DA_API,
            horaDoServidor: new Date().toISOString(),
            limitesPorMinuto: LIMITE_POR_MINUTO,
          },
        }));
      },
      POST: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PUT: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      PATCH: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
      DELETE: async () => (await import("@/lib/api-integracao.server")).metodoNaoPermitido("GET")(),
    },
  },
});
