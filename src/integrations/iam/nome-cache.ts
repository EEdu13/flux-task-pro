/**
 * Cache local de `login → nome completo`.
 *
 * Serve a um problema específico: a tela de login precisa da foto ANTES de
 * autenticar, mas só temos o que foi digitado — e a IAM guarda a foto por
 * NOME. Buscar por "reginaldo.junior" pode cair num registro diferente do de
 * "REGINALDO MARCOS GONCALVES JUNIOR", com foto antiga.
 *
 * A saída é a mesma que o PCP usa (`larsil_nome_cache`): quando alguém loga com
 * sucesso, guardamos o nome que a IAM devolveu. Da segunda vez em diante,
 * naquela máquina, a foto certa aparece já na digitação.
 *
 * Na primeira vez numa máquina nova, cai no palpite formatado — mesmo
 * comportamento do PCP.
 */

const CHAVE = "larsil_nome_cache";

type Mapa = Record<string, string>;

function ler(): Mapa {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? "{}") as Mapa;
  } catch {
    return {};
  }
}

/** Nome completo já conhecido para este login, ou null. */
export function nomeConhecido(login: string): string | null {
  const l = login.trim().toLowerCase();
  if (!l) return null;
  return ler()[l] ?? null;
}

/** Guarda o nome que a IAM devolveu no login. */
export function guardarNome(login: string, nome: string): void {
  const l = login.trim().toLowerCase();
  if (typeof window === "undefined" || !l || !nome.trim()) return;
  try {
    const mapa = ler();
    mapa[l] = nome.trim();
    localStorage.setItem(CHAVE, JSON.stringify(mapa));
  } catch {
    /* localStorage cheio ou bloqueado: seguir sem cache é aceitável */
  }
}

/** "reginaldo.junior" → "Reginaldo Junior". Palpite para quem ainda não logou aqui. */
export function nomeFormatado(login: string): string {
  return login
    .replace(/[._]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/** A chave de busca da foto: o nome conhecido, ou o palpite formatado. */
export function chaveDaFoto(login: string): string {
  const l = login.trim();
  if (l.length < 3) return "";
  return nomeConhecido(l) ?? nomeFormatado(l);
}
