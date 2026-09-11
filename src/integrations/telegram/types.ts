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
 * A classificação não decide nada: ela só nomeia o que veio. Quem age é
 * `conversa.server.ts`, e a separação existe para que a segurança da rota
 * (segredo, 200 sempre, repetição) não precise ser tocada quando o bot ganha
 * um comando novo.
 */
/**
 * `privado` acompanha toda mensagem porque nem tudo que o bot faz cabe em
 * grupo. Identificar-se, por exemplo: o vínculo pede o telefone pelo botão de
 * contato, e um teclado desses num grupo pede o telefone de alguém na frente
 * dos outros. Quem trata precisa poder decidir caso a caso, e para isso precisa
 * saber onde está.
 */
export type AtualizacaoClassificada =
  | {
      tipo: "contato";
      updateId: number;
      deId: number;
      chatId: number;
      privado: boolean;
      contato: TelegramContato;
    }
  | {
      tipo: "comando";
      updateId: number;
      deId: number;
      chatId: number;
      privado: boolean;
      comando: string;
      /** O que veio depois do comando: "/start abc" → "abc". */
      argumento: string;
    }
  | {
      tipo: "texto";
      updateId: number;
      deId: number;
      chatId: number;
      privado: boolean;
      texto: string;
    }
  | {
      tipo: "callback";
      updateId: number;
      deId: number;
      /* O chat vem de `callback_query.message.chat.id`, e por isso pode faltar:
         o Telegram omite `message` em botão pendurado em mensagem velha demais
         (mais de 48h). Sem chat não dá para responder nada — o tratamento
         reconhece o toque e para por aí. */
      chatId: number | null;
      callbackId: string;
      data: string;
    }
  | { tipo: "ignorada"; updateId: number; motivo: string };

/* ----------------------- Teclados ----------------------- */

/** Botão que dispara um `callback_query` com `data` de volta para o webhook. */
export interface BotaoCallback {
  text: string;
  callback_data: string;
}

/** Botão que pede o telefone. Só aparece no teclado de baixo, não no da mensagem. */
export interface BotaoContato {
  text: string;
  request_contact: true;
}

/**
 * Botão comum do teclado de baixo: tocar nele MANDA o rótulo como mensagem.
 *
 * É a diferença que decide onde cada teclado serve. O botão em linha
 * (`BotaoCallback`) devolve um código escondido e não escreve nada no chat; este
 * aqui vira texto de verdade, então o mesmo tratamento que lê "hoje" digitado lê
 * o toque no botão Hoje, sem código novo.
 */
export interface BotaoTexto {
  text: string;
}

export interface TecladoEmLinha {
  inline_keyboard: BotaoCallback[][];
}

/**
 * O teclado de baixo, que ocupa o lugar do teclado do sistema.
 *
 * `input_field_placeholder` é o que faz aparecer a dica DENTRO do campo de
 * digitação ("Título da tarefa"). Sem ela, uma pergunta do bot com botões
 * embaixo não deixa claro que a resposta é digitada — a pessoa procura o botão
 * que responde e não acha.
 *
 * Uma mensagem tem UM `reply_markup` só: ou este teclado, ou o de botões em
 * linha. Não dá para ter os dois, e é por isso que as etapas de texto do /nova
 * carregam o "Cancelar" aqui dentro em vez de um botão em linha.
 */
export interface TecladoDeResposta {
  keyboard: (BotaoContato | BotaoTexto)[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
}

/**
 * Limite do Telegram para `callback_data`: 64 BYTES, não caracteres.
 *
 * Passar disso não dá erro no envio — o botão simplesmente não funciona quando
 * alguém aperta. Por isso os dados dos botões são códigos curtos (`p:alta:<id>`)
 * e nunca texto legível.
 */
export const CALLBACK_DATA_MAX = 64;

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
