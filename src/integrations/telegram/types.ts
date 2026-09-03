/**
 * Contrato do bot do Telegram — etapa 1 (webhook e segurança).
 *
 * Isomórfico: só tipos e constantes puras. Quem fala com a rede mora em
 * `client.server.ts` e a validação do webhook em `webhook.server.ts`, mesma
 * divisão da integração da IAM.
 *
 * Os tipos cobrem só o que a etapa 1 precisa reconhecer. O resto do payload do
 * Telegram é grande e a maior parte não nos interessa — declarar campo que não
 * usamos só cria a ilusão de que ele foi validado.
 */

/** Nome exato do cabeçalho que o Telegram envia. Não é case-sensitive no HTTP. */
export const CABECALHO_SEGREDO = "x-telegram-bot-api-secret-token";

/**
 * Só pedimos ao Telegram os tipos que sabemos tratar.
 *
 * Sem isto ele manda tudo — edições, entradas em grupo, reações, membros. São
 * requisições que o servidor recebe para descartar, e cada uma é superfície
 * que não precisava existir.
 */
export const ATUALIZACOES_ACEITAS = ["message", "callback_query"] as const;

export interface TelegramUsuario {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

/** Vem do botão "compartilhar contato". O `user_id` é o que prova a identidade. */
export interface TelegramContato {
  phone_number: string;
  first_name: string;
  last_name?: string;
  /** Ausente quando o contato compartilhado não é uma conta do Telegram. */
  user_id?: number;
}

export interface TelegramMensagem {
  message_id: number;
  from?: TelegramUsuario;
  chat: TelegramChat;
  date: number;
  text?: string;
  contact?: TelegramContato;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUsuario;
  data?: string;
  message?: TelegramMensagem;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMensagem;
  callback_query?: TelegramCallbackQuery;
}

/**
 * O que chegou, já classificado.
 *
 * A etapa 1 só classifica e registra: nenhum caso escreve nada ainda. As etapas
 * seguintes ligam o tratamento de cada um sem mexer na rota nem na segurança.
 */
export type AtualizacaoClassificada =
  | { tipo: "contato"; updateId: number; deId: number; chatId: number; contato: TelegramContato }
  | { tipo: "comando"; updateId: number; deId: number; chatId: number; comando: string }
  | { tipo: "texto"; updateId: number; deId: number; chatId: number; texto: string }
  | { tipo: "callback"; updateId: number; deId: number; callbackId: string; data: string }
  | { tipo: "ignorada"; updateId: number; motivo: string };

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly metodo: string,
    readonly codigo = 0,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}
