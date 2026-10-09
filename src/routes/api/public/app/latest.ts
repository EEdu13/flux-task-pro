import { createFileRoute } from "@tanstack/react-router";

/**
 * O "tem versão nova?" do app de mesa (atualizador do Tauri, desde a 0.2.2).
 *
 * Devolve o `latest.json` que o `scripts/lancar-app.mjs` grava no Blob
 * (`app/latest.json`): versão, notas e, por plataforma, o endereço do
 * instalador e a ASSINATURA dele. O app só instala o que vier assinado com a
 * chave do projeto — este endereço ser público não abre porta para ninguém
 * empurrar instalador falso.
 *
 * Público: o atualizador roda antes de qualquer login.
 */
export const Route = createFileRoute("/api/public/app/latest")({
  server: {
    handlers: {
      GET: async () => {
        const { enderecoNoBlob, lerDoBlob } = await import("@/integrations/blob.server");
        const arquivo = await lerDoBlob(enderecoNoBlob("app/latest.json"));
        // 204: nenhuma versão publicada ainda — o atualizador entende como "nada novo".
        if (!arquivo) return new Response(null, { status: 204 });
        return new Response(arquivo.corpo, {
          headers: { "content-type": "application/json", "cache-control": "no-cache" },
        });
      },
    },
  },
});
