// Cliente HTTP da API do Telegram. EXCLUSIVO do servidor — carregue dentro dos
// handlers: const tg = await import("@/integrations/telegram/client.server");
//
// Nada aqui pode chegar ao navegador: o token do bot dá controle total sobre
// ele, inclusive ler tudo que as pessoas mandam.
import {
  ATUALIZACOES_ACEITAS,
  TelegramError,
  type TecladoDeResposta,
  type TecladoEmLinha,
} from "./types";

const TIMEOUT_MS = 15_000;

/** O bot só existe com token E segredo. Faltando um, a integração fica desligada. */
export function telegramHabilitado(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET);
}

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new TelegramError("TELEGRAM_BOT_TOKEN não configurado", "-");
  return t;
}

interface RespostaTelegram<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/**
 * Chamada crua à API.
 *
 * A URL carrega o token, então ela NUNCA entra em log ou mensagem de erro —
 * só o nome do método. Um stack trace com a URL completa vaza o bot inteiro
 * para quem tiver acesso aos logs da Railway.
 */
async function chamar<T>(metodo: string, corpo?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${metodo}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => ({}))) as RespostaTelegram<T>;
    if (!json.ok) {
      throw new TelegramError(
        json.description ?? `Falha em ${metodo}`,
        metodo,
        json.error_code ?? res.status,
      );
    }
    return json.result as T;
  } catch (e) {
    if (e instanceof TelegramError) throw e;
    throw new TelegramError("Não foi possível falar com o Telegram.", metodo);
  } finally {
    clearTimeout(timer);
  }
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
  can_join_groups: boolean;
}

/** Prova que o token vale. Não expõe nada sensível. */
export function obterBot(): Promise<BotInfo> {
  return chamar<BotInfo>("getMe");
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

export function obterWebhook(): Promise<WebhookInfo> {
  return chamar<WebhookInfo>("getWebhookInfo");
}

/**
 * Registra o webhook.
 *
 * O `secret_token` é o que faz o Telegram mandar o cabeçalho que a rota exige —
 * sem ele aqui, a rota recusaria as próprias mensagens do Telegram.
 *
 * `allowed_updates` restringe a assinatura ao que sabemos tratar. O padrão do
 * Telegram é mandar quase tudo, e o que não tratamos vira requisição recebida
 * só para ser descartada.
 */
export function definirWebhook(
  url: string,
  opcoes: { descartarPendentes?: boolean } = {},
): Promise<boolean> {
  const segredo = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!segredo) throw new TelegramError("TELEGRAM_WEBHOOK_SECRET não configurado", "setWebhook");
  if (!url.startsWith("https://")) {
    // O Telegram só entrega em HTTPS. Falhar aqui é mais claro que receber um
    // erro genérico da API depois.
    throw new TelegramError("O webhook precisa ser HTTPS.", "setWebhook");
  }
  return chamar<boolean>("setWebhook", {
    url,
    secret_token: segredo,
    allowed_updates: ATUALIZACOES_ACEITAS,
    drop_pending_updates: opcoes.descartarPendentes ?? false,
  });
}

export function removerWebhook(descartarPendentes = false): Promise<boolean> {
  return chamar<boolean>("deleteWebhook", { drop_pending_updates: descartarPendentes });
}

/* ----------------------------- Envio ----------------------------- */

/**
 * Escapa texto para o modo MarkdownV2.
 *
 * A lista de caracteres é a do próprio Telegram, e não é negociável: um único
 * caractere reservado sem escape faz a API RECUSAR a mensagem inteira com
 * "can't parse entities" — não é degradação visual, é a mensagem não chegar. E
 * como nomes de tarefa e de pessoas vêm de texto livre, isto vale para tudo que
 * não é literal nosso.
 */
export function escaparMd(texto: string): string {
  return texto.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

export interface MensagemEnviada {
  message_id: number;
}

/**
 * Manda uma mensagem para um chat.
 *
 * `disable_notification` fica por conta de quem chama: aviso que a pessoa pediu
 * (ela apertou um botão) não precisa acordar o celular dela; aviso que o
 * sistema empurrou, sim.
 */
export function enviarMensagem(
  chatId: number,
  texto: string,
  opcoes: {
    teclado?: TecladoEmLinha | TecladoDeResposta;
    silencioso?: boolean;
  } = {},
): Promise<MensagemEnviada> {
  return chamar<MensagemEnviada>("sendMessage", {
    chat_id: chatId,
    text: texto,
    parse_mode: "MarkdownV2",
    // Sem isto, mandar um link do sistema faz o Telegram colar um cartão de
    // pré-visualização embaixo — que aqui é ruído, e às vezes vaza o título de
    // uma página que a pessoa nem abriu ainda.
    link_preview_options: { is_disabled: true },
    disable_notification: opcoes.silencioso === true,
    reply_markup: opcoes.teclado,
  });
}

/**
 * Reescreve uma mensagem já enviada — usado quando um botão muda o estado.
 *
 * Editar em vez de mandar outra é o que evita a conversa virar uma pilha de
 * versões da mesma lista. O Telegram recusa a edição quando nada mudou
 * ("message is not modified"), e isso é tratado como sucesso por quem chama:
 * apertar duas vezes o mesmo botão não é erro.
 */
export function editarMensagem(
  chatId: number,
  messageId: number,
  texto: string,
  teclado?: TecladoEmLinha,
): Promise<unknown> {
  return chamar<unknown>("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: texto,
    parse_mode: "MarkdownV2",
    link_preview_options: { is_disabled: true },
    reply_markup: teclado,
  });
}

/**
 * Responde o toque no botão.
 *
 * Obrigatório: enquanto o Telegram não recebe isto, o botão fica com o
 * relógio girando na tela de quem apertou, por até 30 segundos. É o "recebi" da
 * interface, independente de a ação ter dado certo — por isso ele carrega o
 * texto do resultado, inclusive quando o resultado é uma recusa.
 */
export function responderCallback(
  callbackId: string,
  texto?: string,
  alerta = false,
): Promise<unknown> {
  return chamar<unknown>("answerCallbackQuery", {
    callback_query_id: callbackId,
    // Sem parse_mode: este texto aparece num balão do próprio Telegram, que
    // não interpreta Markdown. Escapar aqui mostraria as barras invertidas.
    text: texto?.slice(0, 200),
    show_alert: alerta,
  });
}

/** Some com o teclado de baixo (o de "compartilhar contato"). */
export function removerTeclado(chatId: number, texto: string): Promise<MensagemEnviada> {
  return chamar<MensagemEnviada>("sendMessage", {
    chat_id: chatId,
    text: texto,
    parse_mode: "MarkdownV2",
    reply_markup: { remove_keyboard: true },
  });
}
