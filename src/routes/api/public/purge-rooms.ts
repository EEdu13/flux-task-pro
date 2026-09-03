import { createFileRoute } from "@tanstack/react-router";

/**
 * Manutenção: limpa salas de chamada travadas no LiveKit.
 *
 * Estava sem autenticação NENHUMA, num caminho /api/public/. Um POST vazio de
 * quem soubesse a URL derrubava todas as chamadas da empresa e ainda zerava as
 * tabelas de sala. Agora exige a chave de manutenção.
 *
 * A segunda proteção é sobre o que a rota faz, não sobre quem chama: por padrão
 * ela NÃO apaga sala com gente dentro. A ferramenta existe para limpar sala
 * travada — sala ocupada não está travada, está em uso, e apagá-la derruba a
 * ligação de quem está falando. Para incluí-las é preciso pedir de propósito.
 */
export const CABECALHO_MANUTENCAO = "x-fluxo-admin-key";

export const Route = createFileRoute("/api/public/purge-rooms")({
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
          console.warn(`[purge-rooms] recusado (${auth.motivo}) de ${ipDaRequisicao(request)}`);
          // Motivo genérico: distinguir "faltou" de "está errada" ajudaria
          // quem está adivinhando. O log do servidor guarda o detalhe.
          return json({ erro: "não autorizado" }, 401);
        }

        const apiKey = process.env.LIVEKIT_API_KEY;
        const apiSecret = process.env.LIVEKIT_API_SECRET;
        const wsUrl = process.env.LIVEKIT_URL;
        if (!apiKey || !apiSecret || !wsUrl) {
          return json({ erro: "LiveKit não configurado" }, 500);
        }

        // Só apaga sala ocupada se pedirem explicitamente.
        const url = new URL(request.url);
        const incluirOcupadas = url.searchParams.get("incluir-ocupadas") === "1";

        try {
          const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);

          const salas = await svc.listRooms();
          const alvos = incluirOcupadas ? salas : salas.filter((r) => r.numParticipants === 0);
          const preservadas = salas
            .filter((r) => !alvos.includes(r))
            .map((r) => ({ nome: r.name, participantes: r.numParticipants }));

          const apagadas: { nome: string; ok: boolean; erro?: string }[] = [];
          await Promise.all(
            alvos.map(async (r) => {
              try {
                await svc.deleteRoom(r.name);
                apagadas.push({ nome: r.name, ok: true });
              } catch (e) {
                apagadas.push({ nome: r.name, ok: false, erro: String(e) });
              }
            }),
          );

          /* As tabelas acompanham só o que foi apagado, e isso já custou dois
             consertos.

             O primeiro: elas eram zeradas inteiras, o que descartava também o
             estado das salas que continuaram de pé — quem estava numa chamada
             perdia a lista de participantes e a marcação de privada.

             O segundo, agora: as consultas ainda apontavam para o Supabase.
             Ficaram para trás quando as salas migraram para o schema `gestor`,
             e a rota seguia rodando sem erro nenhum, limpando tabelas que nada
             mais lê. Quem chamasse isto para liberar as salas veria "ok" e
             encontraria a diretoria ainda trancada, com os mesmos membros — o
             pior tipo de defeito, porque ele responde que deu certo. */
          const nomesApagados = apagadas.filter((a) => a.ok).map((a) => a.nome);
          if (nomesApagados.length) {
            const { getPool, sql } = await import("@/integrations/db.server");
            const pool = await getPool();

            /* Lista parametrizada em vez de nomes concatenados na consulta.
               Eles vêm do LiveKit, não do cliente, mas a rota é pública e o
               hábito de concatenar é o que uma hora encontra um dado de fora. */
            const marcadores = nomesApagados.map((_, i) => `@s${i}`).join(",");
            const comNomes = (req: ReturnType<typeof pool.request>) => {
              nomesApagados.forEach((n, i) => req.input(`s${i}`, sql.NVarChar, n));
              return req;
            };

            await comNomes(pool.request()).query(
              `DELETE FROM gestor.sala_pedidos_de_entrada WHERE sala IN (${marcadores})`,
            );
            await comNomes(pool.request()).query(
              `DELETE FROM gestor.sala_participantes WHERE sala IN (${marcadores})`,
            );
            await comNomes(pool.request()).query(
              `UPDATE gestor.salas
                  SET privada = 0, atualizada_em = SYSDATETIMEOFFSET()
                WHERE sala IN (${marcadores})`,
            );
          }

          console.log(
            `[purge-rooms] ${nomesApagados.length} apagada(s), ${preservadas.length} preservada(s) por estarem em uso`,
          );
          return json({ apagadas, preservadas });
        } catch (e) {
          console.error("[purge-rooms] falhou:", e);
          return json({ erro: "falha ao limpar as salas" }, 500);
        }
      },
    },
  },
});

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}
