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
 * O token é fatiado entre vários cookies porque UM cookie não cabe o JWT inteiro.
 *
 * Navegadores limitam cada cookie a 4096 bytes contando nome + valor (RFC 6265
 * pede que se aceite ao menos isso; Chrome/Firefox/Safari param aí). O JWT da
 * IAM carrega a lista completa de permissões efetivas da pessoa — ~36 bytes por
 * permissão —, então quem acumula acesso cresce o token: com 122 permissões ele
 * passa de 4800 bytes. Acima do limite o navegador DESCARTA o Set-Cookie em
 * silêncio: o login responde 200, o cookie nunca chega, e a pessoa volta para a
 * tela de entrada sem nenhum erro visível. Só quebra para quem tem muito acesso,
 * o que faz parecer problema de conta e não de tamanho.
 *
 * 3500 bytes por fatia deixa folga para o nome, os atributos e proxies que
 * contam o cabeçalho inteiro. Quatro fatias cobrem ~14 KB de token, ainda dentro
 * do teto de cabeçalho do Node (16 KB) somado aos outros cookies do domínio.
 */
const TAMANHO_FATIA = 3500;
const MAX_FATIAS = 4;

/** Nome do cookie de cada fatia. A fatia 0 mantém o nome antigo, sem sufixo. */
function nomeDaFatia(i: number): string {
  return i === 0 ? IAM_COOKIE : `${IAM_COOKIE}_${i}`;
}

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

  const fatias: string[] = [];
  for (let i = 0; i < token.length; i += TAMANHO_FATIA) {
    fatias.push(token.slice(i, i + TAMANHO_FATIA));
  }

  // Falha ALTO em vez de gravar uma sessão pela metade: um token acima do teto
  // viria de permissão descontrolada na IAM, e sessão truncada volta a ser o
  // mesmo bug silencioso — com a diferença de custar horas para achar de novo.
  if (fatias.length > MAX_FATIAS) {
    throw new Error(
      `Token da IAM com ${token.length} bytes excede o teto de ${MAX_FATIAS * TAMANHO_FATIA} ` +
        `suportado pelo cookie de sessão. Reduza as permissões da pessoa na IAM ou aumente MAX_FATIAS.`,
    );
  }

  const opcoes = {
    httpOnly: true,
    sameSite: "lax" as const, // front e API são a mesma origem; não precisa de None
    path: "/",
    secure: requisicaoSegura(),
    maxAge,
  };

  fatias.forEach((fatia, i) => setCookie(nomeDaFatia(i), fatia, opcoes));

  // Uma sessão anterior pode ter usado MAIS fatias que esta (a pessoa perdeu
  // permissões, ou trocou de conta). Sobra não apagada seria concatenada na
  // leitura e corromperia o token.
  for (let i = fatias.length; i < MAX_FATIAS; i++) {
    if (getCookie(nomeDaFatia(i))) deleteCookie(nomeDaFatia(i), { path: "/" });
  }
}

export function lerSessao(): string | null {
  const primeira = getCookie(IAM_COOKIE);
  if (!primeira) return null;

  let token = primeira;
  // Para na primeira ausência: as fatias são sempre gravadas em sequência, e
  // pular um buraco montaria um token inválido em vez de recusar a sessão.
  for (let i = 1; i < MAX_FATIAS; i++) {
    const fatia = getCookie(nomeDaFatia(i));
    if (!fatia) break;
    token += fatia;
  }

  return token.length > 0 ? token : null;
}

export function limparSessao(): void {
  for (let i = 0; i < MAX_FATIAS; i++) {
    deleteCookie(nomeDaFatia(i), { path: "/" });
  }
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
