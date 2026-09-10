import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook do bot do Telegram.
 *
 * A segurança é desta rota; o que o bot FAZ mora em `conversa.server.ts`. A
 * separação é o que permite o bot ganhar comandos sem ninguém precisar reabrir
 * a autenticação — que é a parte em que um erro custa caro.
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
        const {
          autenticarWebhook,
          classificar,
          gruposLiberados,
          jaProcessado,
          resumirParaLog,
        } = await import("@/integrations/telegram/webhook.server");
        const { tratar } = await import("@/integrations/telegram/conversa.server");
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
          const atualizacao = classificar(bruto, { permitirGrupos: gruposLiberados() });

          if (atualizacao.updateId >= 0 && jaProcessado(atualizacao.updateId)) {
            console.log(`[telegram-webhook] repetido ${resumirParaLog(atualizacao)}`);
            return respostaOk();
          }

          console.log(`[telegram-webhook] ${resumirParaLog(atualizacao)}`);

          /* O despacho é AGUARDADO, não disparado e esquecido.
             Em ambiente sem servidor, devolver a resposta encerra a invocação —
             e o que estivesse pendente morreria no meio, às vezes depois de
             gravar e antes de responder. O custo é o webhook segurar alguns
             milissegundos a mais; o Telegram tolera até 60 segundos.

             `tratar` nunca lança: o erro dele morre lá dentro, no log. O
             try/catch de fora continua valendo para o `request.json()`. */
          await tratar(atualizacao);
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
