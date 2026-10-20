/**
 * Envio de anexo em pedaços — o lado do servidor (19/10/2026).
 *
 * Nasceu com o recado de voz e a gravação de tela. O envio de sempre
 * (`enviarAnexo`) recebe o arquivo inteiro em base64 numa chamada só, com teto
 * de 5 MB; um vídeo de tela de 2 minutos passa disso. Aqui o arquivo chega em
 * pedaços de até 2 MB, e cada pedaço segue direto para o Azure Blob como um
 * bloco (ver o fim de `blob.server.ts`). O servidor nunca segura mais que um
 * pedaço na memória, e o BANCO só vê o arquivo no final, como uma linha com a
 * URL em `gestor.anexos` — exatamente como os outros anexos.
 *
 * Três chamadas: começar (confere permissão, tipo e tamanho e reserva o id),
 * mandar cada pedaço (na ordem) e concluir (fecha o arquivo no Blob e grava a
 * linha). O que liga as três é o `envioId`, guardado AQUI, na memória do
 * processo — e é de propósito que não fica no banco: não existe tabela para
 * isto e não deve existir; um envio dura segundos. Se o servidor reiniciar no
 * meio, o envio falha com uma mensagem clara e a pessoa manda de novo; os
 * blocos que já tinham subido o próprio Azure descarta em 7 dias.
 */

import type { AnexoGravado } from "@/lib/anexo.functions";

/** Onde o anexo pode ser pendurado por este caminho. Sem tipo novo no banco. */
export const DONOS_EM_PEDACOS = ["tarefa", "comentario", "mensagem"] as const;
export type DonoEmPedacos = (typeof DONOS_EM_PEDACOS)[number];

/** Tamanho máximo de um pedaço. O navegador manda exatamente isto (o último, menos). */
export const MAX_PEDACO = 2 * 1024 * 1024;

/** Vídeo de tela: 2 minutos a ~700 kbps dão uns 11 MB; 25 MB é a folga. */
const MAX_VIDEO = 25 * 1024 * 1024;
/** Todo o resto (o recado de voz) fica no teto de sempre. */
const MAX_OUTROS = 5 * 1024 * 1024;

/**
 * Só formatos que os gravadores do navegador produzem. O Chrome e o Edge gravam
 * WebM; o Safari grava MP4. OGG fica pelo Firefox antigo.
 */
const TIPOS_ACEITOS = ["audio/webm", "audio/ogg", "audio/mp4", "video/webm", "video/mp4"];

/** Envio esquecido (a aba fechou no meio) sai da memória depois disto. */
const VALIDADE_MS = 30 * 60 * 1000;
/** Mais que isso em paralelo, por pessoa, não é gravação — é abuso ou defeito. */
const MAX_ABERTOS_POR_PESSOA = 4;

type Envio = {
  id: string;
  eu: number;
  donoTipo: DonoEmPedacos;
  donoId: string;
  nome: string;
  tipoMime: string;
  tamanho: number;
  caminho: string;
  recebidos: number;
  proximo: number;
  ocupado: boolean;
  criadoEm: number;
};

/* No `globalThis` para sobreviver à recarga de módulo do servidor de
   desenvolvimento: sem isto, salvar um arquivo no meio de um envio de teste
   esvaziaria o mapa. Em produção não faz diferença. */
const g = globalThis as typeof globalThis & { __fluxoEnviosEmPedacos?: Map<string, Envio> };
const envios: Map<string, Envio> = (g.__fluxoEnviosEmPedacos ??= new Map());

function limparVencidos() {
  const agora = Date.now();
  for (const [id, e] of envios) if (agora - e.criadoEm > VALIDADE_MS) envios.delete(id);
}

/** `audio/webm;codecs=opus` → `audio/webm`. O parâmetro não ajuda o player e varia por navegador. */
export function tipoBase(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

export function limiteDoTipo(mime: string): number {
  return mime.startsWith("video/") ? MAX_VIDEO : MAX_OUTROS;
}

/**
 * Confere os primeiros bytes contra o tipo declarado. O tipo vem do navegador,
 * e é dado de fora: sem isto, qualquer arquivo entraria dizendo ser áudio — e
 * seria servido de volta com `content-type` de áudio.
 */
function assinaturaConfere(mime: string, bytes: Uint8Array): boolean {
  const b = bytes;
  if (mime.endsWith("/webm")) {
    return b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  }
  if (mime === "audio/ogg") {
    return b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53;
  }
  if (mime.endsWith("/mp4")) {
    // Caixa `ftyp` logo no começo: 4 bytes de tamanho e depois o nome.
    return b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  }
  return false;
}

export async function comecarEnvio(
  eu: number,
  dados: {
    donoTipo: DonoEmPedacos;
    donoId: string;
    nome: string;
    tipoMime: string;
    tamanho: number;
  },
): Promise<{ envioId: string; tamanhoDoPedaco: number }> {
  limparVencidos();

  const tipoMime = tipoBase(dados.tipoMime);
  if (!TIPOS_ACEITOS.includes(tipoMime)) {
    throw new Error("Tipo de arquivo não aceito aqui. Só áudio e vídeo gravados no app.");
  }
  if (!Number.isInteger(dados.tamanho) || dados.tamanho <= 0) throw new Error("Arquivo vazio");
  const limite = limiteDoTipo(tipoMime);
  if (dados.tamanho > limite) {
    throw new Error(`Arquivo muito grande. O limite é ${Math.round(limite / 1024 / 1024)} MB.`);
  }

  let abertos = 0;
  for (const e of envios.values()) if (e.eu === eu) abertos++;
  if (abertos >= MAX_ABERTOS_POR_PESSOA) {
    throw new Error("Há envios demais em andamento. Espere terminar e tente de novo.");
  }

  // Só anexa em quem enxerga — a mesma regra do envio de sempre.
  const { podeVerDonoDeAnexo } = await import("@/lib/permissoes.server");
  if (!(await podeVerDonoDeAnexo(eu, dados.donoTipo, dados.donoId))) {
    throw new Error("Você não tem acesso a onde este arquivo seria anexado.");
  }

  /* O id nomeia o blob e depois vira o id da linha. Gerado aqui e não com
     `SELECT NEWID()`: é a mesma garantia de unicidade sem uma ida ao banco. O
     caminho (com o mês) é fixado agora — um envio que cruzasse a meia-noite
     do dia 1º não pode mudar de pasta no meio. */
  const id = crypto.randomUUID();
  const { caminhoDoAnexo } = await import("@/integrations/blob.server");
  envios.set(id, {
    id,
    eu,
    donoTipo: dados.donoTipo,
    donoId: dados.donoId,
    nome: dados.nome,
    tipoMime,
    tamanho: dados.tamanho,
    caminho: caminhoDoAnexo(dados.donoTipo, id),
    recebidos: 0,
    proximo: 0,
    ocupado: false,
    criadoEm: Date.now(),
  });
  return { envioId: id, tamanhoDoPedaco: MAX_PEDACO };
}

function envioDe(eu: number, envioId: string): Envio {
  const e = envios.get(envioId);
  // Envio de outra pessoa responde igual a envio inexistente: não confirma nada.
  if (!e || e.eu !== eu) {
    throw new Error("Este envio não existe mais (o servidor pode ter reiniciado). Envie de novo.");
  }
  return e;
}

export async function receberPedaco(
  eu: number,
  dados: { envioId: string; indice: number; conteudo: string },
): Promise<{ recebidos: number }> {
  const e = envioDe(eu, dados.envioId);
  /* Um pedaço por vez e na ordem. A ordem é o que permite fechar o arquivo
     com "blocos 0 a N" sem guardar lista nenhuma; e o "um por vez" impede que
     dois pedidos repetidos do mesmo pedaço contem os bytes duas vezes. */
  if (e.ocupado) throw new Error("Pedaço anterior ainda em envio.");
  if (dados.indice !== e.proximo) throw new Error("Pedaço fora de ordem. Envie de novo.");

  const bytes = Buffer.from(dados.conteudo, "base64");
  if (!bytes.byteLength) throw new Error("Pedaço vazio");
  if (bytes.byteLength > MAX_PEDACO) throw new Error("Pedaço grande demais");
  if (e.recebidos + bytes.byteLength > e.tamanho) {
    envios.delete(e.id);
    throw new Error("O arquivo veio maior do que o anunciado. Envio cancelado.");
  }
  if (e.proximo === 0 && !assinaturaConfere(e.tipoMime, bytes)) {
    envios.delete(e.id);
    throw new Error("O conteúdo não confere com o tipo do arquivo. Envio cancelado.");
  }

  // Cópia para um ArrayBuffer próprio — o mesmo motivo do `enviarAnexo`.
  const corpo = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(corpo).set(bytes);

  e.ocupado = true;
  try {
    const { enviarBlocoParaOBlob } = await import("@/integrations/blob.server");
    await enviarBlocoParaOBlob(e.caminho, e.proximo, corpo);
    e.recebidos += bytes.byteLength;
    e.proximo += 1;
  } finally {
    e.ocupado = false;
  }
  return { recebidos: e.recebidos };
}

export async function concluirEnvio(eu: number, envioId: string): Promise<AnexoGravado> {
  const e = envioDe(eu, envioId);
  if (e.ocupado) throw new Error("Ainda há pedaço em envio.");
  if (e.recebidos !== e.tamanho) {
    throw new Error("O arquivo chegou incompleto. Envie de novo.");
  }
  envios.delete(e.id);

  /* A permissão é conferida de novo no fim: o envio de um vídeo leva alguns
     segundos, e nesse meio tempo a pessoa pode ter perdido o acesso à tarefa. */
  const { podeVerDonoDeAnexo } = await import("@/lib/permissoes.server");
  if (!(await podeVerDonoDeAnexo(eu, e.donoTipo, e.donoId))) {
    throw new Error("Você não tem acesso a onde este arquivo seria anexado.");
  }

  // Primeiro o arquivo passa a existir no Blob; só depois entra a linha.
  // A mesma ordem do `enviarAnexo`, pelo mesmo motivo.
  const { confirmarBlocosNoBlob } = await import("@/integrations/blob.server");
  const url = await confirmarBlocosNoBlob(e.caminho, e.proximo, e.tipoMime);

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.UniqueIdentifier, e.id)
    .input("dono_tipo", sql.NVarChar, e.donoTipo)
    .input("dono_id", sql.UniqueIdentifier, e.donoId)
    .input("nome", sql.NVarChar, e.nome)
    .input("tamanho", sql.BigInt, e.tamanho)
    .input("mime", sql.NVarChar, e.tipoMime)
    .input("url", sql.NVarChar, url)
    .input("por", sql.Int, eu)
    .query(
      `INSERT INTO gestor.anexos
         (id, dono_tipo, dono_id, nome, tamanho, tipo_mime, url, enviado_por)
       VALUES (@id, @dono_tipo, @dono_id, @nome, @tamanho, @mime, @url, @por)`,
    );

  if (e.donoTipo === "tarefa") {
    const { registrarNoHistorico } = await import("@/lib/historico.server");
    await registrarNoHistorico(e.donoId, eu, [{ tipo: "editada", texto: `anexou "${e.nome}"` }]);
  }

  return {
    id: e.id,
    nome: e.nome,
    tamanho: e.tamanho,
    tipoMime: e.tipoMime,
    url: `/api/anexo/${e.id}`,
  };
}

/** Desistência explícita (a pessoa cancelou). Os blocos o Azure descarta sozinho. */
export function cancelarEnvio(eu: number, envioId: string): void {
  const e = envios.get(envioId);
  if (e && e.eu === eu) envios.delete(envioId);
}
