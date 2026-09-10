import { createFileRoute } from "@tanstack/react-router";

/**
 * Resumo do dia no Telegram — o disparo das 7h da manhã.
 *
 * É uma ROTA, e não um `setInterval` no boot do servidor, pelo mesmo motivo que
 * o webhook não se registra sozinho: um temporizador dentro do processo dispara
 * uma vez por réplica, morre em todo deploy e volta com o relógio zerado. Quem
 * sabe que horas são é o agendador de fora; aqui só mora o que fazer.
 *
 * Na Railway: um Cron Job com `0 10 * * *` (10:00 UTC = 07:00 de Brasília, que
 * não muda porque o Brasil não tem mais horário de verão) chamando
 *
 *   curl -X POST https://SEU-APP/api/public/telegram-diario \
 *        -H "x-fluxo-admin-key: $ADMIN_API_KEY"
 *
 * A mesma chave de manutenção do `purge-rooms`. Sem ela, qualquer um que
 * soubesse a URL despejaria a agenda do time no Telegram na hora que quisesse.
 */
export const CABECALHO_MANUTENCAO = "x-fluxo-admin-key";

/**
 * O dia (em Brasília) do último envio bem-sucedido.
 *
 * Trava contra disparo repetido: agendador que erra e chama duas vezes mandaria
 * o mesmo resumo duas vezes, e um resumo duplicado às 7h da manhã é exatamente
 * o tipo de coisa que faz as pessoas silenciarem o bot.
 *
 * Vive na memória, então um deploy entre as duas chamadas ainda deixaria passar
 * a segunda. É a mesma aposta de instância única que `jaProcessado` já faz, e
 * aqui o pior caso é uma mensagem repetida — não um dado errado. Para forçar o
 * reenvio no mesmo dia (um teste, por exemplo), passe `?forcar=1`.
 */
let ultimoDiaEnviado: string | null = null;

function hojeEmBrasilia(): string {
  // Brasília é UTC-3 o ano inteiro desde 2019.
  return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
}

export const Route = createFileRoute("/api/public/telegram-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { conferirCabecalhoSecreto, ipDaRequisicao } = await import("@/lib/segredo.server");

        const auth = conferirCabecalhoSecreto(
          request.headers,
          CABECALHO_MANUTENCAO,
          process.env.ADMIN_API_KEY,
        );
        if (!auth.ok) {
          console.warn(`[telegram-diario] recusado (${auth.motivo}) de ${ipDaRequisicao(request)}`);
          return json({ erro: "não autorizado" }, 401);
        }

        const { telegramHabilitado } = await import("@/integrations/telegram/client.server");
        if (!telegramHabilitado()) {
          return json({ erro: "Telegram não configurado" }, 500);
        }

        const forcar = new URL(request.url).searchParams.get("forcar") === "1";
        const hoje = hojeEmBrasilia();
        if (!forcar && ultimoDiaEnviado === hoje) {
          console.log(`[telegram-diario] ${hoje} ja enviado, ignorando`);
          return json({ ok: true, jaEnviadoHoje: true, dia: hoje });
        }

        try {
          const { enviarResumoDoDia } = await import("@/integrations/telegram/conversa.server");
          const r = await enviarResumoDoDia();
          /* Só marca o dia quando algo saiu. Uma execução que falhou inteira
             (banco fora, por exemplo) precisa poder ser repetida pelo agendador
             ou na mão, e não ficar bloqueada até amanhã por um "já enviei". */
          if (r.enviados > 0) ultimoDiaEnviado = hoje;
          console.log(
            `[telegram-diario] ${hoje}: ${r.enviados} enviado(s), ${r.pulados} sem tarefa, ${r.falhas} falha(s)`,
          );
          return json({ ok: true, dia: hoje, ...r });
        } catch (e) {
          console.error("[telegram-diario] falhou:", e);
          return json({ erro: "falha ao montar o resumo" }, 500);
        }
      },

      /** Checagem de vida, para o agendador saber que a URL existe. */
      GET: async () => new Response("telegram-diario up", { status: 200 }),
    },
  },
});

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}
