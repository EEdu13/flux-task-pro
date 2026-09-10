// Validação e triagem do webhook do Telegram. EXCLUSIVO do servidor — carregue
// dentro do handler: await import("@/integrations/telegram/webhook.server").
//
// Nada aqui pode chegar ao navegador: o segredo do webhook nunca sai deste lado.
import { conferirCabecalhoSecreto, type ResultadoSegredo } from "@/lib/segredo.server";
import {
  CABECALHO_SEGREDO,
  type AtualizacaoClassificada,
  type TelegramUpdate,
} from "./types";

export type ResultadoAutenticacao = ResultadoSegredo;

/**
 * Confere o cabeçalho secreto ANTES de ler o corpo.
 *
 * A ordem importa: um corpo de estranho não deve nem ser lido, quanto mais
 * parseado. Ler primeiro entregaria a um desconhecido o direito de nos fazer
 * gastar CPU com JSON arbitrário.
 *
 * A comparação em tempo constante e a regra de "variável faltando FECHA" vivem
 * em @/lib/segredo.server, compartilhadas com as rotas de manutenção.
 */
export function autenticarWebhook(headers: Headers): ResultadoAutenticacao {
  return conferirCabecalhoSecreto(
    headers,
    CABECALHO_SEGREDO,
    process.env.TELEGRAM_WEBHOOK_SECRET,
  );
}

/* --------------------------- Repetições --------------------------- */

const VISTAS_MAX = 500;
/**
 * Últimos update_id processados.
 *
 * Cinto de segurança, não garantia: vive na memória do processo, então some no
 * restart e não é compartilhado entre instâncias. Serve para o caso comum (o
 * Telegram reenviar o mesmo update segundos depois quando a conexão cai antes
 * do 200 chegar nele). A versão que sobrevive a restart precisa de banco —
 * mesma dependência do Azure SQL que o resto do projeto tem.
 */
const vistas = new Set<number>();

export function jaProcessado(updateId: number): boolean {
  if (vistas.has(updateId)) return true;
  vistas.add(updateId);
  if (vistas.size > VISTAS_MAX) {
    // Set preserva ordem de inserção: o primeiro é sempre o mais antigo.
    const maisAntigo = vistas.values().next().value;
    if (maisAntigo !== undefined) vistas.delete(maisAntigo);
  }
  return false;
}

/** Só para teste — a rota nunca chama isto. */
export function limparVistas(): void {
  vistas.clear();
}

/* -------------------------- Classificação -------------------------- */

function ehUpdate(v: unknown): v is TelegramUpdate {
  return typeof v === "object" && v !== null && typeof (v as TelegramUpdate).update_id === "number";
}

/**
 * O bot pode responder em grupo?
 *
 * Fechado por padrão, e a polaridade é a mesma do segredo: variável ausente
 * FECHA. Um dia alguém restaura este ambiente sem a variável, e o que se perde
 * é a liberação temporária — não a proteção.
 *
 * Por que é variável e não uma linha comentada no código: a liberação nasceu
 * com prazo ("libera para eu demonstrar para uma pessoa, depois volta a ser
 * particular"). Desligar tem que ser apagar a variável na Railway, não achar e
 * reverter um `if` — porque o segundo é o que ninguém faz.
 *
 * O que muda ao ligar, e vale saber antes: a resposta vai para o CHAT, então a
 * lista de tarefas de quem pediu fica visível para o grupo inteiro. Quem é a
 * pessoa continua vindo do `from.id` autenticado pelo Telegram, e a permissão
 * de cada botão continua sendo reconferida no banco — isso não afrouxa. O que
 * afrouxa é a privacidade do conteúdo.
 */
export function gruposLiberados(): boolean {
  return process.env.TELEGRAM_PERMITIR_GRUPOS === "1";
}

/**
 * Descobre o que chegou. Não age sobre nada — a etapa 1 só precisa provar que
 * o Telegram alcança o servidor e que sabemos ler o que ele manda.
 *
 * `permitirGrupos` entra por parâmetro, e não lendo o ambiente aqui dentro,
 * para esta função continuar pura: ela é a que dá para conferir lendo, e o dia
 * em que ela passar a depender do ambiente é o dia em que ela deixa de ser.
 */
export function classificar(
  bruto: unknown,
  opcoes: { permitirGrupos?: boolean } = {},
): AtualizacaoClassificada {
  if (!ehUpdate(bruto)) {
    return { tipo: "ignorada", updateId: -1, motivo: "corpo sem update_id" };
  }
  const updateId = bruto.update_id;

  const cb = bruto.callback_query;
  if (cb) {
    if (!cb.data) return { tipo: "ignorada", updateId, motivo: "callback sem data" };
    return {
      tipo: "callback",
      updateId,
      deId: cb.from.id,
      // Pode faltar: o Telegram omite `message` quando o botão está pendurado
      // numa mensagem velha demais. Ver a nota no tipo.
      chatId: cb.message?.chat.id ?? null,
      callbackId: cb.id,
      data: cb.data,
    };
  }

  const msg = bruto.message;
  if (!msg) return { tipo: "ignorada", updateId, motivo: "update sem message nem callback_query" };

  /* O bot é de conversa privada por padrão. Em grupo, a resposta vai para o
     chat: a lista de tarefas de quem pediu fica à vista de todos, e o botão de
     outra pessoa fica ao alcance de qualquer participante — o toque age como
     quem apertou, mas a lista na tela é de outro.

     `TELEGRAM_PERMITIR_GRUPOS=1` abre isso de propósito e temporariamente (ver
     `gruposLiberados`). Sem a variável, continua fechado. */
  const privado = msg.chat.type === "private";
  if (!privado && !opcoes.permitirGrupos) {
    return { tipo: "ignorada", updateId, motivo: `chat ${msg.chat.type} não é privado` };
  }
  if (!msg.from || msg.from.is_bot) {
    return { tipo: "ignorada", updateId, motivo: "mensagem sem remetente humano" };
  }

  const base = { updateId, deId: msg.from.id, chatId: msg.chat.id, privado };

  if (msg.contact) return { tipo: "contato", ...base, contato: msg.contact };

  const texto = msg.text?.trim();
  if (!texto) return { tipo: "ignorada", updateId, motivo: "mensagem sem texto nem contato" };

  if (texto.startsWith("/")) {
    // "/start@FluxoBot algum_param" → comando "/start", argumento "algum_param".
    // O sufixo @bot aparece quando o mesmo comando é usado onde há mais de um
    // bot; o argumento é o que o `deep link` t.me/bot?start=xxx entrega.
    const comando = texto.split(/[\s@]/, 1)[0]!.toLowerCase();
    const argumento = texto.slice(texto.indexOf(" ") + 1 || texto.length).trim();
    return { tipo: "comando", ...base, comando, argumento: argumento === texto ? "" : argumento };
  }

  return { tipo: "texto", ...base, texto };
}

/**
 * Resumo de uma linha para o log.
 *
 * Sem conteúdo de mensagem: o log serve para saber que chegou e de que tipo,
 * não para virar um arquivo do que as pessoas escrevem. Comando é exceção —
 * é vocabulário fechado nosso, não texto livre.
 */
export function resumirParaLog(a: AtualizacaoClassificada): string {
  switch (a.tipo) {
    case "contato":
      return `#${a.updateId} contato de ${a.deId} (user_id ${a.contato.user_id ?? "ausente"})`;
    case "comando":
      return `#${a.updateId} comando ${a.comando} de ${a.deId}`;
    case "texto":
      return `#${a.updateId} texto de ${a.deId} (${a.texto.length} caracteres)`;
    case "callback":
      return `#${a.updateId} callback ${a.data} de ${a.deId}`;
    case "ignorada":
      return `#${a.updateId} ignorada: ${a.motivo}`;
  }
}
