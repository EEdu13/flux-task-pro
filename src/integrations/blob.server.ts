// Azure Blob Storage — EXCLUSIVO do servidor.
//
// O contêiner e a credencial vivem numa URL só, no `.env`:
//
//     URL_SAAS_TOKEN = https://<conta>.blob.core.windows.net/gestor?<sas>
//
// Aquele `<sas>` é uma assinatura de contêiner com permissão de ler, escrever,
// criar, anexar, APAGAR e listar, válida até 2030. Duas consequências:
//
//   1. A validade longa está certa. É credencial de servidor, guardada no
//      `.env`, e se ela vencesse o sistema pararia de gravar anexo. O arquivo
//      em si não depende dela para continuar existindo — blob não some quando
//      a chave vence, só fica sem chave.
//
//   2. Ela NUNCA pode chegar ao navegador. Quem tiver esta assinatura apaga
//      todos os anexos da empresa. Por isso a leitura é feita por proxy: o
//      navegador pede ao nosso servidor, o servidor busca no Blob e devolve o
//      conteúdo. A credencial não atravessa a fronteira.
//
// A alternativa seria gerar uma assinatura curta por arquivo, o que é mais
// econômico em banda. Mas para isso é preciso a CHAVE DA CONTA, e o que existe
// aqui é uma assinatura — assinatura não gera assinatura. Com o proxy, o que
// já está configurado basta.

/** Base do contêiner e a query da assinatura, separadas. */
function contêiner(): { base: string; sas: string } {
  const bruto = process.env.URL_SAAS_TOKEN;
  if (!bruto) throw new Error("Armazenamento de arquivos não configurado no servidor");
  const url = new URL(bruto);
  const sas = url.search.startsWith("?") ? url.search.slice(1) : url.search;
  if (!sas) throw new Error("A URL do armazenamento está sem a assinatura");
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, sas };
}

/**
 * Caminho do arquivo dentro do contêiner.
 *
 * Organizado por dono e por mês, e não numa pasta só: contêiner com dezenas de
 * milhares de objetos na raiz fica ruim de listar e de olhar no portal. O nome
 * final é um GUID, nunca o nome que a pessoa deu — dois arquivos "orçamento.pdf"
 * não podem disputar o mesmo lugar, e nome de arquivo é dado de fora.
 */
export function caminhoDoAnexo(donoTipo: string, id: string): string {
  const agora = new Date();
  const ano = agora.getUTCFullYear();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${donoTipo}/${ano}/${mes}/${id}`;
}

/**
 * Grava o arquivo. Devolve a URL SEM a assinatura — ver o comentário do topo.
 *
 * `ArrayBuffer` e não `Uint8Array` no parâmetro: o `fetch` aceita os dois em
 * tempo de execução, mas o TypeScript recente distingue a visão do buffer e
 * recusa a primeira. Pedir o buffer direto evita uma conversão de tipo aqui.
 */
export async function enviarParaOBlob(
  caminho: string,
  conteudo: ArrayBuffer,
  tipoMime: string,
): Promise<string> {
  const { base, sas } = contêiner();
  const alvo = `${base}/${caminho}`;

  const r = await fetch(`${alvo}?${sas}`, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "content-type": tipoMime || "application/octet-stream",
      "content-length": String(conteudo.byteLength),
    },
    body: conteudo,
  });

  if (!r.ok) {
    // O corpo do erro do Azure traz o motivo, mas pode ecoar a URL inteira —
    // com a assinatura junto. Fica no log do servidor, nunca na resposta.
    const detalhe = await r.text().catch(() => "");
    console.error(`[blob] PUT ${caminho} falhou (${r.status}):`, detalhe.slice(0, 400));
    throw new Error("Não foi possível guardar o arquivo agora.");
  }

  // Guardar sem a assinatura é a decisão que mantém a credencial fora do banco.
  // Uma assinatura gravada numa tabela é um link público parado ali — e este
  // vale até 2030.
  return alvo;
}

/** Lê o arquivo de volta, para o proxy devolver ao navegador. */
export async function lerDoBlob(
  url: string,
): Promise<{ corpo: ArrayBuffer; tipoMime: string } | null> {
  const { base, sas } = contêiner();

  // A URL vem do banco, mas conferir que ela aponta para o nosso contêiner é
  // barato e fecha a porta para alguém gravar uma linha apontando para fora e
  // usar o servidor como buscador de qualquer endereço.
  if (!url.startsWith(`${base}/`)) {
    console.warn("[blob] recusado: URL fora do contêiner —", url.slice(0, 120));
    return null;
  }

  const r = await fetch(`${url}?${sas}`);
  if (!r.ok) {
    if (r.status !== 404) console.error(`[blob] GET falhou (${r.status})`);
    return null;
  }
  return {
    corpo: await r.arrayBuffer(),
    tipoMime: r.headers.get("content-type") || "application/octet-stream",
  };
}

/** Remove o arquivo. Só para quando a linha em `gestor.anexos` também sair. */
export async function apagarDoBlob(url: string): Promise<void> {
  const { base, sas } = contêiner();
  if (!url.startsWith(`${base}/`)) return;
  const r = await fetch(`${url}?${sas}`, { method: "DELETE" });
  // 404 significa que já não estava lá, o que para nós é sucesso.
  if (!r.ok && r.status !== 404) console.error(`[blob] DELETE falhou (${r.status})`);
}
