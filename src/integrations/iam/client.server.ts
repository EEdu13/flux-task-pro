// Cliente HTTP da IAM Larsil. EXCLUSIVO do servidor — carregue dentro dos
// handlers: const iam = await import("@/integrations/iam/client.server");
//
// Nada aqui pode chegar ao navegador: o token da IAM nunca sai deste lado.
import { IamError, SISTEMA_CODIGO, type IamUsuario } from "./types";

const TIMEOUT_MS = 15_000;

/**
 * A IAM é o padrão: só desliga com `IAM_ENABLED=0` explícito.
 *
 * A polaridade é deliberada. Se fosse opt-in (`=1` para ligar), esquecer a
 * variável num deploy faria a produção cair no login de demonstração, onde
 * qualquer senha entra — porta aberta causada por variável ausente, sem erro
 * visível. Assim, o esquecimento erra para o lado seguro.
 *
 * O caminho de demonstração é temporário: cai fora quando a TI tiver concedido
 * as permissões e o primeiro login real estiver validado.
 */
export function iamHabilitado(): boolean {
  return process.env.IAM_ENABLED !== "0";
}

function iamUrl(): string {
  const url = process.env.IAM_URL;
  if (!url) throw new IamError("IAM_URL não configurado no servidor", "inesperado");
  return url.replace(/\/$/, "");
}

interface RespostaIam {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Chamada crua à IAM. Nunca lança por erro HTTP — devolve status + corpo, para
 * quem chamou decidir. Só lança quando a rede falha (status 0).
 */
async function iamRequest(
  method: "GET" | "POST",
  path: string,
  corpo?: unknown,
  headers: Record<string, string> = {},
): Promise<RespostaIam> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${iamUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* corpo vazio ou não-JSON é aceitável em alguns endpoints */
    }
    return { status: res.status, body };
  } catch {
    // Rede fora, DNS, timeout: a IAM está inalcançável, não é erro de credencial.
    throw new IamError(
      "Não foi possível falar com o sistema de acesso. Tente de novo.",
      "indisponivel",
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ Login ------------------------------ */

export interface LoginIamResultado {
  token: string;
  usuario: IamUsuario;
  senhaProvisoria: boolean;
}

export async function iamLoginRequest(login: string, senha: string): Promise<LoginIamResultado> {
  const { status, body } = await iamRequest("POST", "/api/auth/login", { login, senha });

  if (status === 401) {
    throw new IamError(String(body.erro ?? "Login ou senha inválidos"), "credenciais", 401);
  }
  if (status === 403) {
    // §1 do contrato: a conta existe, mas a TI desativou.
    throw new IamError(
      String(body.erro ?? "Sua conta está desativada. Entre em contato com a TI da empresa."),
      body.motivo === "INATIVO" ? "inativo" : "credenciais",
      403,
    );
  }
  if (status !== 200) {
    throw new IamError(String(body.erro ?? "Não foi possível entrar."), "inesperado", status);
  }

  const token = typeof body.token === "string" ? body.token : "";
  const usuario = body.usuario as IamUsuario | undefined;
  if (!token || !usuario?.id) {
    throw new IamError("Resposta inesperada do sistema de acesso.", "inesperado", 502);
  }

  return { token, usuario, senhaProvisoria: Boolean(body.senha_provisoria) };
}

/* ----------------------------- Resolve ----------------------------- */

export interface IamResolvido {
  usuarioId: number;
  papeis: string[];
  permissoes: string[];
  escopos: { tipo: string; valor: string }[];
  global: boolean;
}

// A IAM roda na Railway (EUA) e nós no Brasil: cada resolve custa uma ida e
// volta. O cache de 60s tira esse custo do caminho comum sem atrasar demais a
// propagação de uma permissão revogada.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; dados: IamResolvido }>();

export async function iamResolve(token: string): Promise<IamResolvido> {
  const agora = Date.now();
  const hit = cache.get(token);
  if (hit && agora - hit.at < CACHE_MS) return hit.dados;

  const { status, body } = await iamRequest("GET", "/api/auth/resolve", undefined, {
    Authorization: `Bearer ${token}`,
  });

  if (status === 401 || status === 403) {
    cache.delete(token);
    throw new IamError("Sessão expirada. Entre novamente.", "credenciais", status);
  }
  if (status !== 200) {
    throw new IamError("Não foi possível validar a sessão.", "inesperado", status);
  }

  const dados: IamResolvido = {
    usuarioId: Number(body.usuario_id ?? 0),
    papeis: Array.isArray(body.papeis) ? (body.papeis as string[]) : [],
    permissoes: Array.isArray(body.permissoes) ? (body.permissoes as string[]) : [],
    escopos: Array.isArray(body.escopos) ? (body.escopos as IamResolvido["escopos"]) : [],
    global: Boolean(body.global),
  };

  // Guarda-chuva contra crescimento sem fim num processo de vida longa.
  if (cache.size > 500) cache.clear();
  cache.set(token, { at: agora, dados });
  return dados;
}

/** Descarta o cache de um token — usado no logout. */
export function iamEsqueceToken(token: string): void {
  cache.delete(token);
}

/** Idade do cache em segundos; 0 quando não há entrada. Útil para depurar permissão. */
export function iamCacheIdade(token: string): number {
  const hit = cache.get(token);
  return hit ? Math.round((Date.now() - hit.at) / 1000) : 0;
}

/* ---------------------------- Onboarding ---------------------------- */

export async function iamOnboardingRequest(
  token: string,
  dados: { novaSenha: string; telefone: string; email: string },
): Promise<void> {
  const { status, body } = await iamRequest("POST", "/api/auth/onboarding", dados, {
    Authorization: `Bearer ${token}`,
  });
  if (status !== 200) {
    throw new IamError(
      String(body.erro ?? "Não foi possível concluir o primeiro acesso."),
      status === 401 || status === 403 ? "credenciais" : "inesperado",
      status,
    );
  }
}

/* ------------------------------ Acesso ------------------------------ */

/**
 * Registra no perfil da pessoa que ela entrou no Fluxo (§1.5 do contrato).
 * Fire-and-forget de propósito: se falhar, o login não pode cair junto.
 */
export function iamRegistrarAcesso(token: string): void {
  void iamRequest(
    "POST",
    "/api/auth/acesso",
    { sistema: SISTEMA_CODIGO },
    {
      Authorization: `Bearer ${token}`,
    },
  ).catch(() => {
    /* silencioso por contrato */
  });
}
