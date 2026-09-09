// Vínculo entre uma conta do Telegram e uma pessoa do Fluxo.
// EXCLUSIVO do servidor — carregue dentro do handler.
//
// Este arquivo é a fronteira de identidade do bot, e vale dizer por quê.
//
// No app, quem é a pessoa vem do cookie da IAM (`pessoaDaSessao`). No Telegram
// não existe cookie: o que existe é o `from.id` que o Telegram autentica, e a
// prova de que a requisição veio mesmo do Telegram (o segredo do webhook). Daí
// para frente, TUDO que o bot faz em nome de alguém depende exclusivamente
// desta tabela estar certa. Um vínculo errado aqui não é um bug de tela — é
// uma pessoa lendo e mexendo nas tarefas de outra.
//
// Por isso o vínculo não aceita telefone digitado. Ver `vincularPorContato`.

import type { TelegramContato } from "./types";

export interface ContaVinculada {
  pessoaId: number;
  chatId: number;
}

/** Só dígitos, e sem o DDI do Brasil — os números chegam em formatos variados. */
function normalizarTelefone(bruto: string): string {
  const d = bruto.replace(/\D+/g, "");
  /* O Telegram devolve com DDI ("5541999998888"); a IAM grava ora com, ora sem.
     Cortar o 55 dos dois lados é o que faz os dois formatos casarem. O corte só
     acontece em número longo o bastante para ter DDI + DDD + assinante, senão
     um fixo começando com 55 perderia os dois primeiros dígitos. */
  return d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
}

/**
 * Quem é esta conta do Telegram? `null` = não vinculada.
 *
 * Toda ação do bot começa por aqui. Nenhum comando aceita um id de pessoa vindo
 * da mensagem — nem como argumento, nem dentro de um `callback_data`.
 */
export async function pessoaPorTelegram(telegramUserId: number): Promise<ContaVinculada | null> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("tg", sql.BigInt, telegramUserId)
    .query(
      `SELECT pessoa_id, chat_id FROM gestor.telegram_contas WHERE telegram_user_id=@tg`,
    );
  const l = r.recordset[0] as { pessoa_id: number; chat_id: string | number } | undefined;
  // chat_id é BIGINT e o driver devolve string quando passa do inteiro seguro
  // do JavaScript. Ids de chat do Telegram cabem, mas a conversão é explícita
  // para não depender disso continuar verdade.
  return l ? { pessoaId: l.pessoa_id, chatId: Number(l.chat_id) } : null;
}

export type ResultadoVinculo =
  | { ok: true; pessoaId: number; nome: string; jaEra: boolean }
  | { ok: false; motivo: "contato_de_terceiro" | "sem_conta_telegram" | "telefone_desconhecido" };

/**
 * Vincula pela partilha de contato do Telegram.
 *
 * O telefone NÃO é digitado: ele vem do botão "compartilhar contato", ou seja,
 * do cadastro que a própria pessoa fez no Telegram. Isso remove o ataque óbvio
 * — escrever o telefone de outra pessoa e virar ela.
 *
 * Sobra um ataque menos óbvio, e é o que a primeira checagem fecha: o Telegram
 * também deixa encaminhar o cartão de contato de OUTRA pessoa. Nesse caso
 * `contato.user_id` é o id dela, não o de quem mandou. Exigir que os dois sejam
 * o mesmo número é o que separa "este é o meu telefone" de "este é o telefone
 * de alguém que eu conheço".
 *
 * O casamento com o Fluxo é por `gestor.perfis.telefone`, que é reescrito a
 * cada login a partir da IAM — então é o número que a empresa tem, não um que
 * alguém cadastrou aqui.
 */
export async function vincularPorContato(
  telegramUserId: number,
  chatId: number,
  contato: TelegramContato,
): Promise<ResultadoVinculo> {
  if (contato.user_id === undefined) return { ok: false, motivo: "sem_conta_telegram" };
  if (contato.user_id !== telegramUserId) return { ok: false, motivo: "contato_de_terceiro" };

  const telefone = normalizarTelefone(contato.phone_number);
  if (telefone.length < 10) return { ok: false, motivo: "telefone_desconhecido" };

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();

  /* A comparação normaliza os DOIS lados dentro do banco, porque o que está
     gravado é irregular: uns com DDI, uns com máscara, uns limpos. `RIGHT(...)`
     em cima do número já sem pontuação compara os últimos 11 dígitos, que é o
     celular brasileiro completo com DDD.

     Isto é um scan em `perfis` — tabela de dezenas de linhas, uma vez por
     vínculo. Se um dia ela crescer para milhares, o certo é gravar uma coluna
     de telefone já normalizado. */
  const achado = await pool
    .request()
    .input("tel", sql.VarChar, telefone.slice(-11))
    .query(
      `SELECT TOP 2 pessoa_id, nome
         FROM gestor.perfis
        WHERE nome IS NOT NULL
          AND telefone IS NOT NULL
          AND RIGHT(
                REPLACE(REPLACE(REPLACE(REPLACE(telefone,' ',''),'-',''),'(',''),')',''),
                11
              ) = @tel`,
    );

  /* Dois perfis com o mesmo telefone é dado errado, não empate a resolver no
     código: vincular ao primeiro entregaria a conta de alguém a quem calhou de
     ordenar antes. Recusar deixa o problema visível para ser corrigido. */
  if (achado.recordset.length !== 1) return { ok: false, motivo: "telefone_desconhecido" };
  const p = achado.recordset[0] as { pessoa_id: number; nome: string };

  /* MERGE por pessoa_id: uma pessoa tem uma conta do Telegram, e trocar de
     conta (celular novo) reaproveita a linha em vez de criar uma segunda.
     O índice único em telegram_user_id cuida do outro lado — uma conta do
     Telegram não vira duas pessoas. */
  const antes = await pool
    .request()
    .input("pessoa", sql.Int, p.pessoa_id)
    .query(`SELECT telegram_user_id FROM gestor.telegram_contas WHERE pessoa_id=@pessoa`);
  const jaEra = antes.recordset.length > 0;

  await pool
    .request()
    .input("pessoa", sql.Int, p.pessoa_id)
    .input("tg", sql.BigInt, telegramUserId)
    .input("chat", sql.BigInt, chatId)
    .query(
      `IF EXISTS (SELECT 1 FROM gestor.telegram_contas WHERE pessoa_id=@pessoa)
         UPDATE gestor.telegram_contas
            SET telegram_user_id=@tg, chat_id=@chat, vinculado_em=SYSDATETIMEOFFSET()
          WHERE pessoa_id=@pessoa;
       ELSE
         INSERT INTO gestor.telegram_contas (pessoa_id, telegram_user_id, chat_id)
         VALUES (@pessoa, @tg, @chat);`,
    );

  return { ok: true, pessoaId: p.pessoa_id, nome: p.nome, jaEra };
}

/** Desfaz o vínculo. Devolve false quando não havia nada para desfazer. */
export async function desvincular(telegramUserId: number): Promise<boolean> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("tg", sql.BigInt, telegramUserId)
    .query(`DELETE FROM gestor.telegram_contas WHERE telegram_user_id=@tg`);
  return (r.rowsAffected[0] ?? 0) > 0;
}
