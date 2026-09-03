// Comparação de segredos. EXCLUSIVO do servidor.
//
// Vive fora das integrações porque mais de uma rota precisa da mesma coisa: o
// webhook do Telegram e as rotas de manutenção. Duas cópias de uma comparação
// de segredo é como uma delas acaba virando um `===` distraído.
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dois segredos em tempo constante.
 *
 * O `===` de string sai no primeiro caractere diferente, então o tempo de
 * resposta conta quantos caracteres o palpite acertou. Pela internet o ruído
 * cobre isso quase sempre — mas fazer certo custa três linhas.
 *
 * Comparamos os digests, não os textos: `timingSafeEqual` exige o mesmo
 * tamanho, e conferir o tamanho antes já vazaria o tamanho do segredo. O
 * SHA-256 é sempre 32 bytes, venha o que vier.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

export type ResultadoSegredo =
  | { ok: true }
  | { ok: false; motivo: "sem-segredo-no-servidor" | "cabecalho-ausente" | "cabecalho-invalido" };

/**
 * Confere um cabeçalho contra uma variável de ambiente.
 *
 * Falta a variável no servidor? FECHA. A polaridade é deliberada, igual à do
 * `IAM_ENABLED`: se a ausência fizesse a checagem ser pulada, esquecer a
 * variável num deploy abriria a rota para qualquer um — porta escancarada
 * causada por variável faltando, sem erro visível.
 */
export function conferirCabecalhoSecreto(
  headers: Headers,
  nomeDoCabecalho: string,
  esperado: string | undefined,
  tamanhoMinimo = 16,
): ResultadoSegredo {
  if (!esperado || esperado.length < tamanhoMinimo) {
    return { ok: false, motivo: "sem-segredo-no-servidor" };
  }
  const recebido = headers.get(nomeDoCabecalho);
  if (!recebido) return { ok: false, motivo: "cabecalho-ausente" };
  return iguaisEmTempoConstante(recebido, esperado)
    ? { ok: true }
    : { ok: false, motivo: "cabecalho-invalido" };
}

/**
 * IP de quem chamou, para log.
 *
 * Na Railway a requisição chega por proxy, então o IP do socket é o do proxy e
 * o real vem no x-forwarded-for. O cabeçalho é falsificável por quem fala
 * direto com o servidor — só serve para log, nunca para decisão de acesso.
 */
export function ipDaRequisicao(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}
