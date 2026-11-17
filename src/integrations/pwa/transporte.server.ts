// Transporte HTTP do PWA de apontamento (apontamento.up.railway.app). EXCLUSIVO do
// servidor — carregue dentro dos handlers:
//   const t = await import("@/integrations/pwa/transporte.server");
//
// Por que a chamada sai daqui e nunca do navegador: o token da IAM vive no
// cookie httpOnly `fluxo_sessao`, que o JavaScript da página não lê. É o MESMO
// token que o PWA já aceita (os dois usam a mesma IAM e o mesmo JWT_SECRET):
// nenhum segredo novo aqui. Molde: `agendador/client.server.ts`.
//
// TRAVAS (o `npm run dev` usa o mesmo `.env` da produção, ou seja, o PWA de
// verdade — por isso estas travas não dependem de ninguém lembrar de nada):
//   • escrita (POST/PUT) só sai com `ENVIO_REAL_LIGADO` E fora do dev. O dev
//     NUNCA grava no PWA, seja quem for que chame e esteja a chave como estiver;
//   • fora do dev só `https://`, e `redirect: "error"`: o token nunca segue um
//     redirecionamento para outro endereço;
//   • nada é logado aqui: nem token, nem CPF, nem nome.

import { ENVIO_REAL_LIGADO } from "@/lib/estrutura-liberada";
import { ErroDaEstrutura } from "./erro";

const TIMEOUT_LEITURA_MS = 15_000;
const TIMEOUT_ENVIO_MS = 30_000;

/** O envio ao PWA está liberado de verdade? Nunca no dev. */
export function envioDeVerdade(): boolean {
  return ENVIO_REAL_LIGADO && !import.meta.env.DEV;
}

function baseUrl(): string {
  const url = (process.env.PWA_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!url) throw new ErroDaEstrutura("indisponivel", "PWA_API_URL não configurado no servidor");
  if (!import.meta.env.DEV && !/^https:\/\//i.test(url)) {
    throw new ErroDaEstrutura("indisponivel", "PWA_API_URL precisa começar com https://");
  }
  return url;
}

export interface RespostaPwa {
  status: number;
  /** O JSON da resposta, ou `null` se veio outra coisa (a página 404 do Express, por exemplo). */
  body: unknown;
}

/**
 * Nunca lança por erro HTTP: devolve status + corpo, para quem chamou decidir
 * (`exigirOk`). Só lança quando a rede falha, ou quando a escrita está travada.
 */
export async function bruto(
  method: "GET" | "POST" | "PUT",
  caminho: string,
  token: string,
  corpo?: unknown,
): Promise<RespostaPwa> {
  if (method !== "GET" && !envioDeVerdade()) {
    throw new ErroDaEstrutura("inesperado", "O envio ao PWA está desligado (ENVIO_REAL_LIGADO).");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(),
    method === "GET" ? TIMEOUT_LEITURA_MS : TIMEOUT_ENVIO_MS,
  );
  try {
    const res = await fetch(`${baseUrl()}${caminho}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: "error",
      signal: ctrl.signal,
    });
    const texto = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(texto);
    } catch {
      /* 404 e 500 do Express vêm em HTML; o status já diz o que houve */
    }
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof ErroDaEstrutura) throw e;
    // Tempo esgotado ou rede: num POST o PWA pode ter gravado mesmo assim.
    throw new ErroDaEstrutura(
      method === "POST" ? "envio_incerto" : "indisponivel",
      "Não foi possível falar com o sistema de apontamento. Tente de novo.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** A mensagem de erro que o PWA devolve (`error`, `erro` ou `message`), curta. */
export function mensagemDoPwa(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const o = body as Record<string, unknown>;
  const m = o.error ?? o.erro ?? o.message;
  return typeof m === "string" ? m.slice(0, 200) : "";
}

/**
 * Transforma a resposta em dado, ou no erro certo. `escrita`: um 5xx num POST
 * quer dizer "pode ter gravado" (`envio_incerto`), e não "fora do ar".
 */
export function exigirOk(r: RespostaPwa, escrita = false): unknown {
  if (r.status >= 200 && r.status < 300) return r.body;
  const msg = mensagemDoPwa(r.body);
  switch (r.status) {
    case 401:
      return falha(
        "acesso_negado",
        msg || "O sistema de apontamento não reconheceu o seu acesso.",
        r,
      );
    case 403:
      return falha("sem_permissao", msg || "Esta equipe não está no alcance do seu acesso.", r);
    case 409:
      return falha("dia_virou", msg || "O dia mudou. Recarregue a tela.", r);
    case 400:
    case 422:
      return falha("dado_recusado", msg || "O sistema de apontamento recusou os dados.", r);
    case 404:
      // Rota ou endereço errado (foi o que o endereço do Painel PCP deu em 09/11/2026).
      return falha("indisponivel", "O sistema de apontamento não respondeu esta rota.", r);
    default:
      return falha(
        r.status >= 500 && escrita
          ? "envio_incerto"
          : r.status >= 500
            ? "indisponivel"
            : "inesperado",
        msg || "O sistema de apontamento não respondeu como esperado.",
        r,
      );
  }
}

function falha(motivo: ErroDaEstrutura["motivo"], msg: string, r: RespostaPwa): never {
  throw new ErroDaEstrutura(motivo, msg, r.status);
}
