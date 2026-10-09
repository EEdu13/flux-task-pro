import { createFileRoute } from "@tanstack/react-router";

/**
 * Devolve o conteúdo de um anexo.
 *
 * Por que o arquivo passa por aqui em vez de o navegador ir direto no Azure:
 * a credencial do contêiner tem permissão de apagar tudo e vale até 2030. Um
 * link contendo ela seria uma chave mestra que sobrevive a qualquer
 * encaminhamento — mensagem repassada, histórico do navegador, log de proxy.
 *
 * O caminho mais econômico seria assinar um endereço curto por arquivo, mas
 * isso exige a CHAVE DA CONTA, e o que temos é uma assinatura. Assinatura não
 * gera assinatura. Com o proxy, o que já está configurado basta — o custo é a
 * banda passar por nós, que para anexo de tarefa e chat não pesa.
 *
 * Repare que a rota NÃO está sob /api/public/: ela exige sessão. Anexo é
 * conteúdo de trabalho, e a pasta pública é justamente a que dispensa login.
 */
export const Route = createFileRoute("/api/anexo/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = String(params.id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return new Response("anexo inválido", { status: 400 });
        }

        // A sessão é exigida antes de qualquer consulta: sem ela não há motivo
        // para descobrir sequer se o anexo existe.
        let eu: number;
        try {
          const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
          eu = await pessoaDaSessao();
        } catch {
          return new Response("não autorizado", { status: 401 });
        }

        /* E quem está logado precisa enxergar o dono do arquivo: a tarefa (ou o
           comentário dela) ou a conversa de chat. Bastava estar logado — um
           link repassado abria o anexo de qualquer tarefa, e o arquivo de uma
           conversa particular, para a empresa inteira. A resposta é a mesma de
           anexo inexistente, para não confirmar que ele existe. */
        const { permissaoNoAnexo } = await import("@/lib/permissoes.server");
        if (!(await permissaoNoAnexo(eu, id)).ver) {
          return new Response("anexo não encontrado", { status: 404 });
        }

        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("id", sql.UniqueIdentifier, id)
          .query(`SELECT nome, tipo_mime, url FROM gestor.anexos WHERE id=@id`);

        const linha = r.recordset[0] as
          { nome: string; tipo_mime: string; url: string } | undefined;
        if (!linha) return new Response("anexo não encontrado", { status: 404 });

        const { lerDoBlob } = await import("@/integrations/blob.server");
        const arquivo = await lerDoBlob(linha.url);
        if (!arquivo) return new Response("anexo indisponível", { status: 404 });

        return new Response(arquivo.corpo, {
          headers: {
            "content-type": linha.tipo_mime || arquivo.tipoMime,
            /* `inline` para imagem e PDF abrirem na tela; o navegador decide.
               O nome vai entre aspas e com as aspas internas escapadas — nome de
               arquivo é dado de fora, e uma aspa solta aqui quebraria o
               cabeçalho e deixaria a pessoa baixar com o nome errado. */
            /* `?baixar=1` pede `attachment`: é o download que o app de mesa
               (WebView2) entende e grava em Downloads — o link de blob, ele
               ignorava. O nome vai também em UTF-8 (filename*), para acento
               não virar lixo no arquivo salvo. */
            "content-disposition": `${new URL(request.url).searchParams.has("baixar") ? "attachment" : "inline"}; filename="${linha.nome.replace(/"/g, "'").replace(/[^ -~]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(linha.nome)}`,
            /* `private` porque a resposta depende de quem está logado: um cache
               compartilhado no caminho não pode guardar isto e entregar para
               outra pessoa. Uma hora é o bastante — o arquivo não muda, e o id
               é novo a cada envio. */
            "cache-control": "private, max-age=3600",
          },
        });
      },
    },
  },
});
