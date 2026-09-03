import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do bot do Telegram — etapa 1: rota, segredo e 200 rápido.
 *
 * Ainda não existe tela nenhuma. O que esta etapa prova é só isto: o Telegram
 * alcança o servidor, e quem não sabe o segredo não alcança. As etapas
 * seguintes penduram o tratamento em `classificar()` sem tocar na segurança.
 *
 * Duas regras que vêm do desenho e não são detalhe:
 *
 * 1. O cabeçalho é conferido ANTES de o corpo ser lido. Corpo de estranho não
 *    deve nem ser lido, quanto mais parseado.
 *
 * 2. Requisição autenticada devolve 200 SEMPRE, inclusive quando o processamento
 *    falha. O Telegram reenvia o que não recebe 200, e reenvio vira ação
 *    duplicada — concluir de novo, pontuar de novo. Entre perder um update e
 *    executar duas vezes, perder é o dano menor.
 */
export const Route = createFileRoute("/api/public/telegram-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { autenticarWebhook, classificar, jaProcessado, resumirParaLog } = await import(
          "@/integrations/telegram/webhook.server"
        );
        const { ipDaRequisicao } = await import("@/lib/segredo.server");

        const auth = autenticarWebhook(request.headers);
        if (!auth.ok) {
          // Tentativa recusada é exatamente o sinal que vale monitorar: em
          // operação normal isto nunca acontece. Sai com o IP e o motivo, mas
          // nunca com o segredo recebido — o log viraria uma lista de palpites.
          console.warn(
            `[telegram-webhook] recusado (${auth.motivo}) de ${ipDaRequisicao(request)}`,
          );
          // Corpo genérico de propósito: distinguir "faltou" de "está errado"
          // ajudaria quem está tentando adivinhar.
          return new Response("unauthorized", { status: 401 });
        }

        try {
          const bruto: unknown = await request.json();
          const atualizacao = classificar(bruto);

          if (atualizacao.updateId >= 0 && jaProcessado(atualizacao.updateId)) {
            console.log(`[telegram-webhook] repetido ${resumirParaLog(atualizacao)}`);
            return respostaOk();
          }

          console.log(`[telegram-webhook] ${resumirParaLog(atualizacao)}`);

          // Etapa 2 em diante: aqui entra o despacho por `atualizacao.tipo`.
          // Enquanto não entra, reconhecer e registrar já é o objetivo.
        } catch (e) {
          // Engolido de propósito: ver a regra 2 no topo. O erro precisa
          // aparecer no log, mas não pode virar um não-200.
          console.error("[telegram-webhook] falha ao processar:", e);
        }

        return respostaOk();
      },

      /** Checagem de vida. Não revela se o bot está configurado. */
      GET: async () => new Response("telegram-webhook up", { status: 200 }),
    },
  },
});

function respostaOk(): Response {
  return new Response("ok", { status: 200 });
}
