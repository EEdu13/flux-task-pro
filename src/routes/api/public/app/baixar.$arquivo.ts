import { createFileRoute } from "@tanstack/react-router";

/**
 * O instalador do app de mesa, guardado no Blob (`app/<arquivo>`).
 *
 * Público como o `latest`: o atualizador baixa sem sessão, e o arquivo não é
 * segredo — quem garante a origem é a assinatura conferida pelo app. O nome é
 * conferido aqui para a rota não virar leitor de qualquer coisa do contêiner.
 */
const NOME = /^[\w.-]+_\d+\.\d+\.\d+_x64-setup\.exe$/;

export const Route = createFileRoute("/api/public/app/baixar/$arquivo")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const nome = String(params.arquivo ?? "");
        if (!NOME.test(nome)) return new Response("arquivo inválido", { status: 400 });
        const { enderecoNoBlob, lerDoBlob } = await import("@/integrations/blob.server");
        const arquivo = await lerDoBlob(enderecoNoBlob(`app/${nome}`));
        if (!arquivo) return new Response("não encontrado", { status: 404 });
        return new Response(arquivo.corpo, {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename="${nome}"`,
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
