// A API de INTEGRAÇÃO (pedido do usuário, 17/11/2026): outros sistemas da empresa criam e
// consultam tarefas no CONECTA sem ninguém logado. EXCLUSIVO do servidor.
//
// As rotas ficam em `src/routes/api/public/v1/`. O "public" do caminho segue a convenção do projeto
// (rota que não usa a sessão de uma pessoa, como os webhooks): aqui quem entra é um SISTEMA, pela
// chave dele, e toda rota passa por `atenderApi`. O manual para quem integra está em
// `docs/api-integracao-tarefas.md` (fora do git).
//
// Este arquivo é a portaria; o que cada rota faz com as tarefas mora em `api-tarefas.server.ts`.
//   • Chave por sistema, na variável API_INTEGRACAO_CHAVES da Railway:
//       API_INTEGRACAO_CHAVES=gantt=<chave de 32+ caracteres>,outro-sistema=<outra chave>
//     O nome do sistema vai para o histórico ("criou esta tarefa pela integração gantt"), marca a
//     tarefa como dele e separa os `idExterno` de um sistema dos de outro. Sem a variável, a API
//     inteira fica FECHADA (a mesma polaridade de `conferirCabecalhoSecreto`).
//   • A chave chega em `Authorization: Bearer <chave>` e é comparada em tempo constante.
//   • Limite por sistema, por minuto: escrita e leitura contadas à parte.
//   • Toda resposta é JSON, inclusive os erros, com um `requestId` que também vai para o log.
//     Uma exceção solta viraria a página de erro em HTML do `start.ts`, que o outro sistema não lê.
//   • O log leva sistema, rota, status e tempo. Nunca a chave, nunca o corpo do pedido.
import { randomUUID } from "node:crypto";
import { iguaisEmTempoConstante, ipDaRequisicao } from "@/lib/segredo.server";

export const VERSAO_DA_API = "1";

/** O nome do sistema: minúsculas, números e hífen. Vai para etiqueta, histórico e `id_legado`. */
const NOME_DE_SISTEMA = /^[a-z0-9-]{2,16}$/;
/** Chave curta é fácil de adivinhar; abaixo disto o sistema é ignorado (e o log avisa). */
const TAMANHO_MINIMO_DA_CHAVE = 32;

/** Pedidos por minuto, por sistema. Muito acima do uso de uma integração; existe contra laço errado. */
export const LIMITE_POR_MINUTO = { escrita: 60, leitura: 300 } as const;
export type TipoDePedido = keyof typeof LIMITE_POR_MINUTO;

/** O maior corpo aceito num POST: uma tarefa com descrição longa e checklist cabe com folga. */
const MAIOR_CORPO_BYTES = 256 * 1024;

type Sistema = { nome: string; chave: string };

let lidoDe: string | null = null;
let sistemasLidos: Sistema[] = [];

/** Os sistemas da variável, lidos de novo só quando ela muda (um redeploy na Railway). */
function sistemasConfigurados(): Sistema[] {
  const bruto = process.env.API_INTEGRACAO_CHAVES ?? "";
  if (bruto === lidoDe) return sistemasLidos;
  const lista: Sistema[] = [];
  for (const parte of bruto.split(/[,;\n]/)) {
    const p = parte.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    const nome = (i > 0 ? p.slice(0, i) : "").trim().toLowerCase();
    const chave = i > 0 ? p.slice(i + 1).trim() : "";
    if (!NOME_DE_SISTEMA.test(nome) || chave.length < TAMANHO_MINIMO_DA_CHAVE) {
      // O nome ajuda a achar o erro; a chave nunca vai para o log.
      console.warn(
        `[api] API_INTEGRACAO_CHAVES: item ignorado (${nome || "sem nome"}): o nome precisa ter de 2 a 16 letras minúsculas, números ou hífen, e a chave ao menos ${TAMANHO_MINIMO_DA_CHAVE} caracteres`,
      );
      continue;
    }
    if (lista.some((s) => s.nome === nome)) {
      console.warn(
        `[api] API_INTEGRACAO_CHAVES: o sistema "${nome}" aparece duas vezes; vale o primeiro`,
      );
      continue;
    }
    lista.push({ nome, chave });
  }
  lidoDe = bruto;
  sistemasLidos = lista;
  return lista;
}

/**
 * Um erro com cara de resposta: o status HTTP, um `codigo` estável (o outro sistema decide por
 * ele) e uma `mensagem` em português para quem lê o log de lá. `detalhes` lista campo a campo.
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: { campo: string; mensagem: string }[],
    readonly cabecalhos?: Record<string, string>,
  ) {
    super(mensagem);
  }
}

export type ContextoDaApi = {
  /** O nome do sistema dono da chave. */
  sistema: string;
  requestId: string;
};

/** Uma resposta da API: o corpo em JSON, o status e, se precisar, cabeçalhos a mais. */
export type RespostaDaApi = {
  status?: number;
  corpo: unknown;
  cabecalhos?: Record<string, string>;
};

function json(
  status: number,
  corpo: unknown,
  requestId: string,
  extras: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...extras,
    },
  });
}

function respostaDeErro(e: ErroDaApi, requestId: string): Response {
  return json(
    e.status,
    {
      erro: {
        codigo: e.codigo,
        mensagem: e.message,
        ...(e.detalhes?.length ? { detalhes: e.detalhes } : {}),
      },
      requestId,
    },
    requestId,
    e.cabecalhos,
  );
}

/** Quem é o sistema, pela chave. Confere TODAS as chaves, para o tempo não dizer qual quase bateu. */
function sistemaDaChave(request: Request): string {
  const sistemas = sistemasConfigurados();
  if (sistemas.length === 0) {
    throw new ErroDaApi(
      503,
      "integracao_desligada",
      "A API de integração não está configurada neste servidor.",
    );
  }
  const cabecalho = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho);
  if (!m) {
    throw new ErroDaApi(
      401,
      "nao_autorizado",
      "Envie a chave do seu sistema no cabeçalho Authorization: Bearer <chave>.",
      undefined,
      { "www-authenticate": 'Bearer realm="conecta"' },
    );
  }
  let achado: string | null = null;
  for (const s of sistemas) {
    if (iguaisEmTempoConstante(m[1]!, s.chave) && achado === null) achado = s.nome;
  }
  if (!achado) {
    throw new ErroDaApi(401, "nao_autorizado", "Chave inválida.", undefined, {
      "www-authenticate": 'Bearer realm="conecta", error="invalid_token"',
    });
  }
  return achado;
}

/* O limite, em memória: uma réplica só na Railway (a mesma aposta do resto do servidor). Um
   redeploy zera a contagem, e tudo bem: o limite é contra um laço errado, não uma cota. */
const usos = new Map<string, number[]>();

function conferirLimite(sistema: string, tipo: TipoDePedido): void {
  const chave = `${sistema}:${tipo}`;
  const agora = Date.now();
  const recentes = (usos.get(chave) ?? []).filter((t) => agora - t < 60_000);
  if (recentes.length >= LIMITE_POR_MINUTO[tipo]) {
    usos.set(chave, recentes);
    const espera = Math.max(1, Math.ceil((60_000 - (agora - recentes[0]!)) / 1000));
    throw new ErroDaApi(
      429,
      "limite_excedido",
      `Limite de ${LIMITE_POR_MINUTO[tipo]} pedidos de ${tipo} por minuto atingido. Tente de novo em ${espera} s.`,
      undefined,
      { "retry-after": String(espera) },
    );
  }
  recentes.push(agora);
  usos.set(chave, recentes);
}

/**
 * Atende um pedido da API: autentica, confere o limite, roda `fazer` e transforma QUALQUER
 * desfecho em JSON. Toda rota de `api/public/v1` passa por aqui.
 */
export async function atenderApi(
  request: Request,
  tipo: TipoDePedido,
  fazer: (ctx: ContextoDaApi) => Promise<RespostaDaApi>,
): Promise<Response> {
  const requestId = randomUUID();
  const inicio = Date.now();
  const url = new URL(request.url);
  const rota = `${request.method} ${url.pathname}`;
  let sistema = "-";
  let status = 500;
  try {
    sistema = sistemaDaChave(request);
    conferirLimite(sistema, tipo);
    const r = await fazer({ sistema, requestId });
    status = r.status ?? 200;
    return json(status, r.corpo, requestId, r.cabecalhos);
  } catch (e) {
    if (e instanceof ErroDaApi) {
      status = e.status;
      if (status === 401) {
        console.warn(`[api] ${requestId} recusado (${e.codigo}) de ${ipDaRequisicao(request)}`);
      }
      return respostaDeErro(e, requestId);
    }
    status = 500;
    // A mensagem técnica fica no log, com o requestId; o outro sistema recebe só o código.
    console.error(`[api] ${requestId} ${sistema} ${rota} falhou:`, (e as Error)?.message ?? e);
    return respostaDeErro(
      new ErroDaApi(
        500,
        "erro_interno",
        "Erro interno no CONECTA. Tente de novo; se continuar, informe o requestId.",
      ),
      requestId,
    );
  } finally {
    console.log(`[api] ${requestId} ${sistema} ${rota} -> ${status} (${Date.now() - inicio} ms)`);
  }
}

/** Para os métodos que a rota não tem (PUT, PATCH, DELETE…): 405 em JSON, e não a página HTML. */
export function metodoNaoPermitido(permitidos: string): () => Response {
  return () => {
    const requestId = randomUUID();
    return json(
      405,
      {
        erro: {
          codigo: "metodo_nao_permitido",
          mensagem: `Esta rota aceita só ${permitidos}.`,
        },
        requestId,
      },
      requestId,
      { allow: permitidos },
    );
  };
}

/**
 * O corpo JSON de um POST: confere o tipo, o tamanho e que é um objeto. Os campos de dentro são
 * conferidos por quem chamou.
 */
export async function lerCorpoJson(request: Request): Promise<Record<string, unknown>> {
  const tipo = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(tipo.trim())) {
    throw new ErroDaApi(
      415,
      "tipo_de_conteudo",
      "Envie o corpo em JSON, com o cabeçalho Content-Type: application/json.",
    );
  }
  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (declarado > MAIOR_CORPO_BYTES) {
    throw new ErroDaApi(413, "corpo_grande_demais", "O corpo passa de 256 KB.");
  }
  const texto = await request.text();
  if (Buffer.byteLength(texto, "utf8") > MAIOR_CORPO_BYTES) {
    throw new ErroDaApi(413, "corpo_grande_demais", "O corpo passa de 256 KB.");
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new ErroDaApi(400, "json_invalido", "O corpo não é um JSON válido.");
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    throw new ErroDaApi(400, "json_invalido", "O corpo precisa ser um objeto JSON ({ ... }).");
  }
  return corpo as Record<string, unknown>;
}
