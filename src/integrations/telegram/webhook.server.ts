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
 * Descobre o que chegou. Não age sobre nada — a etapa 1 só precisa provar que
 * o Telegram alcança o servidor e que sabemos ler o que ele manda.
 */
export function classificar(bruto: unknown): AtualizacaoClassificada {
  if (!ehUpdate(bruto)) {
    return { tipo: "ignorada", updateId: -1, motivo: "corpo sem update_id" };
  }
  const updateId = bruto.update_id;

  const cb = bruto.callback_query;
  if (cb) {
    if (!cb.data) return { tipo: "ignorada", updateId, motivo: "callback sem data" };
    return { tipo: "callback", updateId, deId: cb.from.id, callbackId: cb.id, data: cb.data };
  }

  const msg = bruto.message;
  if (!msg) return { tipo: "ignorada", updateId, motivo: "update sem message nem callback_query" };

  // O bot é de conversa privada. Em grupo, o vínculo pessoa↔conta não vale:
  // qualquer participante tocaria nos botões de outro.
  if (msg.chat.type !== "private") {
    return { tipo: "ignorada", updateId, motivo: `chat ${msg.chat.type} não é privado` };
  }
  if (!msg.from || msg.from.is_bot) {
    return { tipo: "ignorada", updateId, motivo: "mensagem sem remetente humano" };
  }

  const base = { updateId, deId: msg.from.id, chatId: msg.chat.id };

  if (msg.contact) return { tipo: "contato", ...base, contato: msg.contact };

  const texto = msg.text?.trim();
  if (!texto) return { tipo: "ignorada", updateId, motivo: "mensagem sem texto nem contato" };

  if (texto.startsWith("/")) {
    // "/start@FluxoBot algum_param" → "/start". O sufixo @bot aparece quando o
    // mesmo comando é usado onde há mais de um bot.
    const comando = texto.split(/[\s@]/, 1)[0]!.toLowerCase();
    return { tipo: "comando", ...base, comando };
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
