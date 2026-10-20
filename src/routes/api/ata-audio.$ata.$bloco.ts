import { createFileRoute } from "@tanstack/react-router";

/**
 * O áudio de um trecho da reunião (19/10/2026): cada bloco de fala transcrito
 * para a ata fica guardado no Blob, e daqui ele toca — para conferir o que
 * alguém realmente disse.
 *
 * Mesma regra de quem vê a ata em Atas & Planos: quem a criou ou esteve na
 * reunião. Sessão exigida; o arquivo passa pelo servidor (a credencial do
 * Blob nunca vai ao navegador, ver `/api/anexo/$id`).
 */
export const Route = createFileRoute("/api/ata-audio/$ata/$bloco")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const ata = String(params.ata ?? "").toLowerCase();
        const bloco = String(params.bloco ?? "").toLowerCase();
        if (!/^[0-9a-f-]{36}$/.test(ata) || !/^[0-9a-f-]{36}$/.test(bloco)) {
          return new Response("trecho inválido", { status: 400 });
        }

        let eu: number;
        try {
          const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
          eu = await pessoaDaSessao();
        } catch {
          return new Response("não autorizado", { status: 401 });
        }

        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("ata", sql.UniqueIdentifier, ata)
          .input("eu", sql.Int, eu)
          .query(
            `SELECT 1 AS ok FROM gestor.atas a
              WHERE a.id = @ata AND (a.criada_por = @eu
                OR EXISTS (SELECT 1 FROM gestor.ata_participantes p
                            WHERE p.ata_id = a.id AND p.pessoa_id = @eu))`,
          );
        // A mesma resposta para "não existe" e "não pode": não confirma nada.
        if (!r.recordset.length) return new Response("trecho não encontrado", { status: 404 });

        const { enderecoNoBlob, lerDoBlobEmFluxo } = await import("@/integrations/blob.server");
        const midia = await lerDoBlobEmFluxo(
          enderecoNoBlob(`atas/${ata}/${bloco}.wav`),
          request.headers.get("range"),
        );
        if (!midia) return new Response("trecho não encontrado", { status: 404 });
        return new Response(midia.corpo, {
          status: midia.status,
          headers: {
            ...midia.cabecalhos,
            "content-type": "audio/wav",
            "cache-control": "private, max-age=3600",
            // O navegador não "adivinha" outro tipo: arquivo enviado não vira página.
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
