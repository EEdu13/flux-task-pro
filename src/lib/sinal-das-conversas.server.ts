/*
 * "Esta conversa mudou?" — respondido da memória do servidor (03/11/2026).
 * EXCLUSIVO do servidor: carregue dentro dos handlers, como o `db.server`.
 *
 * A conversa aberta pergunta a cada 1,5 s (o intervalo está calibrado para a
 * latência Brasil↔EUA e não muda). Antes, cada pergunta relia as últimas 200
 * mensagens do banco, e quase sempre a resposta era a mesma da anterior: 85
 * mil leituras por semana para quase nada de novo. Agora todo ponto que grava
 * numa conversa — mandar, ler, anexar, limpar — passa por `conversaMudou`,
 * que sobe o número da conversa. A tela devolve o número que já viu; igual,
 * a resposta é "nada novo", sem ir ao banco.
 *
 * O "está digitando" também mora aqui. Era um UPDATE no banco a cada 2,5 s de
 * quem escrevia e um EXISTS a cada 1,5 s de quem lia, para um dado que vale
 * 6 segundos e não interessa a mais ninguém.
 *
 * É memória do processo, e o CONECTA roda num processo só. Duas proteções
 * para o caso de isso deixar de ser verdade, ou de alguém gravar mensagem por
 * fora (um script, o banco direto):
 * - o número leva a marca deste processo (`INICIO`): reiniciar o servidor
 *   invalida tudo o que as telas guardaram;
 * - quem não foi ao banco há `RELEITURA_MAXIMA_MS` vai de qualquer jeito. O
 *   pior caso de uma gravação por fora é aparecer 30 s depois, não nunca.
 */

import { esquecer } from "@/lib/cache-compartilhado.server";

/** Marca deste processo: um número de antes de reiniciar não vale aqui. */
const INICIO = Date.now().toString(36);

/** Quanto tempo uma tela pode ficar sem reler a conversa do banco. */
export const RELEITURA_MAXIMA_MS = 30_000;

/** Por quanto tempo o aviso de digitando vale sem ser renovado. */
const DIGITANDO_VALE_MS = 6_000;

let contador = 0;
const versoes = new Map<string, number>();
const digitando = new Map<number, { para: number; em: number }>();

/** A chave da conversa é a mesma vista de qualquer uma das duas pontas. */
const par = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** A lista de conversas guardada de uma pessoa (ver `chatThreads`). */
export const chaveDasConversas = (pessoa: number) => `chat:conversas:${pessoa}`;

/** O número atual da conversa entre `a` e `b`, para a tela devolver na próxima pergunta. */
export function versaoDaConversa(a: number, b: number): string {
  return `${INICIO}.${versoes.get(par(a, b)) ?? 0}`;
}

/**
 * A conversa entre `a` e `b` mudou: as telas das duas pontas releem na
 * próxima pergunta, e a lista de conversas guardada de cada uma é descartada.
 * `soDe` restringe a lista descartada a uma ponta — limpar a conversa muda o
 * que eu vejo, não o que o outro vê.
 */
export function conversaMudou(a: number, b: number, soDe?: number): void {
  versoes.set(par(a, b), ++contador);
  if (soDe === undefined || soDe === a) esquecer(chaveDasConversas(a));
  if (soDe === undefined || soDe === b) esquecer(chaveDasConversas(b));
}

/**
 * Entrou ou saiu um anexo da mensagem `mensagemId`. O anexo sobe DEPOIS da
 * mensagem (ver `chatSend`), então sem isto a conversa ficaria mostrando a
 * mensagem sem o arquivo até a próxima releitura obrigatória. Nunca lança:
 * o anexo já está gravado, e o pior caso é aparecer 30 s depois.
 */
export async function anexoDeMensagemMudou(mensagemId: string): Promise<void> {
  try {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("id", sql.UniqueIdentifier, mensagemId)
      .query(
        `SELECT de_pessoa_id AS de, para_pessoa_id AS para FROM gestor.mensagens WHERE id=@id`,
      );
    const m = r.recordset[0] as { de: number; para: number } | undefined;
    if (m) conversaMudou(m.de, m.para);
  } catch (e) {
    console.warn("[chat] anexo sem aviso à conversa:", (e as Error)?.message);
  }
}

/** Quando cada pessoa releu cada conversa do banco pela última vez ("eu>outro"). */
const lidaEm = new Map<string, number>();

/**
 * A tela de `eu` precisa da conversa com `outro` do banco? Sim quando o
 * número que ela viu não é o atual, ou quando a última releitura passou de
 * `RELEITURA_MAXIMA_MS`. Se sim, já anota a releitura como feita agora.
 */
export function precisaReler(eu: number, outro: number, versaoVista: string | undefined): boolean {
  const chave = `${eu}>${outro}`;
  const agora = Date.now();
  if (
    versaoVista === versaoDaConversa(eu, outro) &&
    agora - (lidaEm.get(chave) ?? 0) < RELEITURA_MAXIMA_MS
  )
    return false;
  lidaEm.set(chave, agora);
  return true;
}

/** `quem` está escrevendo para `para` agora. */
export function marcarDigitando(quem: number, para: number): void {
  digitando.set(quem, { para, em: Date.now() });
}

/** `quem` mandou a mensagem: o "digitando" apaga na hora, sem esperar os 6 s. */
export function pararDigitando(quem: number): void {
  digitando.delete(quem);
}

/** `quem` escreveu para `para` nos últimos 6 segundos. */
export function estaDigitando(quem: number, para: number): boolean {
  const d = digitando.get(quem);
  if (!d) return false;
  if (Date.now() - d.em > DIGITANDO_VALE_MS) {
    digitando.delete(quem);
    return false;
  }
  return d.para === para;
}
