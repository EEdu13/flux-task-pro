// Sessão do Fluxo: o token da IAM vive num cookie httpOnly definido aqui.
// EXCLUSIVO do servidor.
//
// Por que cookie e não localStorage: httpOnly é invisível ao JavaScript, então
// um script malicioso na página (XSS, dependência comprometida) não consegue
// ler o token. E o navegador o anexa sozinho em toda chamada de server function,
// sem precisarmos de middleware de cliente para isso.
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";

export const IAM_COOKIE = "fluxo_sessao";

/** Teto de validade caso o JWT não traga `exp` legível. */
const FALLBACK_MAX_AGE_S = 8 * 3600;

/**
 * Lê o `exp` do JWT sem validar assinatura.
 *
 * Não é verificação de segurança — é só para o cookie morrer junto com o token,
 * evitando o caso chato de sessão "viva" no navegador com credencial já vencida.
 * Quem valida de verdade é a IAM, no /auth/resolve.
 */
function expDoToken(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * `Secure` só sob HTTPS.
 *
 * Detalhe que custa uma tarde se esquecido: no modo LAN a janela abre em
 * `http://NOTE-LAR-38-24:5199`, que o Chromium NÃO trata como origem confiável
 * (ao contrário de `http://localhost`). Com `Secure` ali, o cookie seria
 * descartado em silêncio e o login pareceria simplesmente não funcionar.
 */
function requisicaoSegura(): boolean {
  try {
    return new URL(getRequest().url).protocol === "https:";
  } catch {
    return false;
  }
}

export function definirSessao(token: string): void {
  const exp = expDoToken(token);
  const restante = exp ? exp - Math.floor(Date.now() / 1000) : null;
  const maxAge = restante && restante > 0 ? restante : FALLBACK_MAX_AGE_S;

  setCookie(IAM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // front e API são a mesma origem; não precisa de None
    path: "/",
    secure: requisicaoSegura(),
    maxAge,
  });
}

export function lerSessao(): string | null {
  const token = getCookie(IAM_COOKIE);
  return token && token.length > 0 ? token : null;
}

export function limparSessao(): void {
  deleteCookie(IAM_COOKIE, { path: "/" });
}

/* ------------------------- Dispositivo conhecido ------------------------- */

const DISPOSITIVO_COOKIE = "fluxo_dispositivos";
const DOIS_ANOS_S = 2 * 365 * 24 * 3600;

/**
 * "Este navegador, para esta pessoa" — não "este navegador" sozinho.
 *
 * `gestor.dispositivos_conhecidos` tem uma linha por (pessoa, aparelho): o
 * notebook do escritório usado por duas pessoas em turnos diferentes é dois
 * dispositivos, um para cada uma, porque é isso que a pessoa espera ver na
 * própria lista de "onde eu entrei" — não o computador de outra pessoa.
 *
 * Por isso o cookie guarda um MAPA, pessoa → id da linha, e não um valor só.
 * Cada entrada é escrita pela própria `dispositivos_conhecidos.id`, gerada no
 * servidor no primeiro acesso daquela pessoa neste navegador — não há campo
 * separado para "o token do navegador"; o id da linha É o token.
 */
function lerMapaDeDispositivos(): Record<string, string> {
  const raw = getCookie(DISPOSITIVO_COOKIE);
  if (!raw) return {};
  try {
    const mapa = JSON.parse(raw) as unknown;
    if (mapa === null || typeof mapa !== "object" || Array.isArray(mapa)) return {};
    return mapa as Record<string, string>;
  } catch {
    return {};
  }
}

/** O id que este navegador guarda para esta pessoa, se já houver. */
export function idDoDispositivo(pessoaId: number): string | null {
  const v = lerMapaDeDispositivos()[String(pessoaId)];
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/**
 * Grava o id deste dispositivo para esta pessoa, preservando o que já existir
 * para outras pessoas que usem o mesmo navegador.
 *
 * O teto de 20 entradas é a válvula de escape de um quiosque compartilhado por
 * muita gente: sem ele, o cookie cresceria para sempre e algum navegador
 * corporativo antigo acabaria recusando o cabeçalho por tamanho.
 */
export function definirDispositivo(pessoaId: number, dispositivoId: string): void {
  const mapa = lerMapaDeDispositivos();
  const chaves = Object.keys(mapa);
  if (chaves.length >= 20 && !(String(pessoaId) in mapa)) {
    delete mapa[chaves[0]!];
  }
  mapa[String(pessoaId)] = dispositivoId;
  setCookie(DISPOSITIVO_COOKIE, JSON.stringify(mapa), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: requisicaoSegura(),
    maxAge: DOIS_ANOS_S,
  });
}
