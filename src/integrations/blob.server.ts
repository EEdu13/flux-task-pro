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
  opcoes: { naoSobrescrever?: boolean } = {},
): Promise<string> {
  const { base, sas } = contêiner();
  const alvo = `${base}/${caminho}`;

  const r = await fetch(`${alvo}?${sas}`, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "content-type": tipoMime || "application/octet-stream",
      "content-length": String(conteudo.byteLength),
      // Só cria: se já existe, o Azure responde 409 e o que está lá fica.
      ...(opcoes.naoSobrescrever ? { "if-none-match": "*" } : {}),
    },
    body: conteudo,
  });

  if (opcoes.naoSobrescrever && (r.status === 409 || r.status === 412)) {
    throw new Error("Este arquivo já foi gravado.");
  }

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

/** Endereço (sem assinatura) de um caminho dentro do contêiner — para `lerDoBlob`. */
export function enderecoNoBlob(caminho: string): string {
  return `${contêiner().base}/${caminho}`;
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

/* ------------------------------------------------------------------------- *
 * Envio em pedaços (19/10/2026) — recado de voz e gravação de tela.
 *
 * O `enviarParaOBlob` acima manda o arquivo de uma vez, e o arquivo chega ao
 * servidor inteiro em base64 numa única chamada. Para 5 MB isso passa; para um
 * vídeo de tela de 25 MB seria uma requisição de 33 MB segurada na memória do
 * servidor do começo ao fim.
 *
 * O Azure tem o caminho próprio para isso: cada pedaço sobe como um "bloco"
 * (Put Block) e, no fim, uma lista diz quais blocos formam o arquivo, em que
 * ordem (Put Block List). Só nesse momento o arquivo passa a existir. Os dois
 * aceitam a mesma assinatura de contêiner que já está no `.env` — é escrita, e
 * ela tem escrita — então a credencial continua só aqui no servidor: o
 * navegador manda o pedaço para nós, nós mandamos para o Azure.
 *
 * Bônus de graça: bloco que nunca entra numa lista é descartado pelo próprio
 * Azure depois de 7 dias. Gravação abandonada no meio não deixa arquivo órfão
 * e não exige faxina nossa.
 * ------------------------------------------------------------------------- */

/**
 * Id de bloco no formato que o Azure exige: base64, e TODOS do mesmo tamanho
 * dentro de um arquivo. O zero à esquerda garante o tamanho igual.
 */
export function idDoBloco(indice: number): string {
  return Buffer.from(`bloco-${String(indice).padStart(6, "0")}`).toString("base64");
}

/** Sobe um pedaço (Put Block). O arquivo ainda não existe depois disto. */
export async function enviarBlocoParaOBlob(
  caminho: string,
  indice: number,
  conteudo: ArrayBuffer,
): Promise<void> {
  const { base, sas } = contêiner();
  const bloco = encodeURIComponent(idDoBloco(indice));
  const r = await fetch(`${base}/${caminho}?comp=block&blockid=${bloco}&${sas}`, {
    method: "PUT",
    headers: { "content-length": String(conteudo.byteLength) },
    body: conteudo,
  });
  if (!r.ok) {
    // Mesmo cuidado do PUT inteiro: o corpo do erro pode ecoar a assinatura.
    const detalhe = await r.text().catch(() => "");
    console.error(
      `[blob] Put Block ${caminho} #${indice} falhou (${r.status}):`,
      detalhe.slice(0, 400),
    );
    throw new Error("Não foi possível guardar o arquivo agora.");
  }
}

/**
 * Fecha o arquivo com os blocos 0..total-1 (Put Block List) e devolve a URL
 * SEM a assinatura, igual a `enviarParaOBlob`. O tipo do conteúdo vai aqui —
 * é o que o Azure devolve depois no GET, e o player do navegador precisa dele.
 */
export async function confirmarBlocosNoBlob(
  caminho: string,
  total: number,
  tipoMime: string,
): Promise<string> {
  const { base, sas } = contêiner();
  const alvo = `${base}/${caminho}`;
  const itens = Array.from({ length: total }, (_, i) => `<Latest>${idDoBloco(i)}</Latest>`);
  const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${itens.join("")}</BlockList>`;
  const r = await fetch(`${alvo}?comp=blocklist&${sas}`, {
    method: "PUT",
    headers: {
      "content-type": "application/xml",
      "x-ms-blob-content-type": tipoMime || "application/octet-stream",
    },
    body: xml,
  });
  if (!r.ok) {
    const detalhe = await r.text().catch(() => "");
    console.error(`[blob] Put Block List ${caminho} falhou (${r.status}):`, detalhe.slice(0, 400));
    throw new Error("Não foi possível guardar o arquivo agora.");
  }
  return alvo;
}

/**
 * Lê o arquivo SEM segurá-lo inteiro na memória, repassando o pedido de faixa
 * (`Range`) ao Azure — para áudio e vídeo.
 *
 * O `<video>` do navegador pede o arquivo aos pedaços (`Range: bytes=...`) para
 * poder avançar e voltar sem baixar tudo, e espera a resposta 206 com o
 * `Content-Range`. O Azure já fala isso; o proxy só precisa não atrapalhar.
 * Com `lerDoBlob` (que devolve tudo de uma vez, sem faixa) o vídeo tocava, mas
 * a barra de progresso não deixava pular para o meio.
 */
export async function lerDoBlobEmFluxo(
  url: string,
  faixa: string | null,
): Promise<{
  status: number;
  corpo: ReadableStream<Uint8Array> | null;
  cabecalhos: Record<string, string>;
} | null> {
  const { base, sas } = contêiner();
  if (!url.startsWith(`${base}/`)) {
    console.warn("[blob] recusado: URL fora do contêiner —", url.slice(0, 120));
    return null;
  }
  // Só o formato simples "bytes=início-fim" passa adiante; qualquer outra
  // coisa vira leitura inteira, que é sempre uma resposta válida.
  const faixaValida = faixa && /^bytes=\d*-\d*$/.test(faixa.trim()) ? faixa.trim() : null;
  const r = await fetch(`${url}?${sas}`, {
    headers: faixaValida ? { range: faixaValida } : undefined,
  });
  if (!r.ok) {
    if (r.status !== 404 && r.status !== 416)
      console.error(`[blob] GET (fluxo) falhou (${r.status})`);
    if (r.status === 416) {
      return {
        status: 416,
        corpo: null,
        cabecalhos: { "content-range": r.headers.get("content-range") ?? "" },
      };
    }
    return null;
  }
  const cabecalhos: Record<string, string> = { "accept-ranges": "bytes" };
  for (const nome of ["content-type", "content-length", "content-range"]) {
    const v = r.headers.get(nome);
    if (v) cabecalhos[nome] = v;
  }
  return { status: r.status, corpo: r.body, cabecalhos };
}
