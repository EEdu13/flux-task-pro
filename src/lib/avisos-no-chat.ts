/**
 * Chamar atenção, trator e emoji gigante — agora do chat (pedido do usuário,
 * 08/10/2026: "traz pro chat, fica mais intuitivo e força usarem o chat").
 *
 * Cada um faz duas coisas: o aviso de tela de sempre (`sendNudge`, que treme,
 * passa o trator ou enche a tela de emoji) e uma linha na conversa ("Eduardo
 * chamou sua atenção"), para o registro ficar onde a conversa está.
 *
 * A linha é uma mensagem comum com uma MARCA invisível na frente (U+2063,
 * separador invisível). A tela nova reconhece a marca e desenha a linha como
 * aviso; a tela antiga, sem saber dela, mostra o texto legível que vem depois
 * — "🔔 chamou sua atenção!" — e nada quebra.
 */
import type { AvatarConfig } from "@/lib/avatar-3d";
import { LISTA_DE_REACOES, REACOES_DO_AVATAR, type ReacaoDoAvatar } from "@/lib/reacoes-do-avatar";

const MARCA = "⁣";

export type AvisoNoChat =
  | { tipo: "cutucada" }
  | { tipo: "trator"; texto: string }
  | { tipo: "emoji"; emoji: string }
  // Reação do avatar (17/10/2026): ver `reacoes-do-avatar.ts`.
  | { tipo: "avatar"; reacao: ReacaoDoAvatar };

const TRATOR = "🚜 mandou um trator: ";
const CUTUCADA = "🔔 chamou sua atenção!";
const EMOJI = " mandou um emoji gigante";

export function corpoDoAviso(a: AvisoNoChat): string {
  if (a.tipo === "cutucada") return `${MARCA}${CUTUCADA}`;
  if (a.tipo === "trator") return `${MARCA}${TRATOR}${a.texto}`;
  if (a.tipo === "avatar") return `${MARCA}${linhaDaReacao(a.reacao)}`;
  return `${MARCA}${a.emoji}${EMOJI}`;
}

/** A mensagem é um aviso? Devolve qual, ou `null` para mensagem comum. */
export function lerAviso(corpo: string | null | undefined): AvisoNoChat | null {
  if (!corpo || !corpo.startsWith(MARCA)) return null;
  const resto = corpo.slice(MARCA.length);
  if (resto.startsWith(TRATOR)) return { tipo: "trator", texto: resto.slice(TRATOR.length) };
  if (resto === CUTUCADA) return { tipo: "cutucada" };
  const reacao = LISTA_DE_REACOES.find((r) => resto === linhaDaReacao(r));
  if (reacao) return { tipo: "avatar", reacao };
  if (resto.endsWith(EMOJI)) return { tipo: "emoji", emoji: resto.slice(0, -EMOJI.length) };
  return null;
}

/** Enche a tela com o emoji — quem manda vê junto, como no MSN. `meu` = fui eu que mandei. */
export function dispararEmojiGigante(emoji: string, deNome: string, meu = false) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:emoji-gigante", { detail: { emoji, deNome, meu } }));
}

/** "💋 mandou um beijo!" — legível sozinha na tela antiga, que não conhece a reação. */
function linhaDaReacao(r: ReacaoDoAvatar): string {
  return `${REACOES_DO_AVATAR[r].emoji} ${REACOES_DO_AVATAR[r].noChat}`;
}

/**
 * Põe o avatar de quem mandou na tela, fazendo a reação (17/10/2026) — ver
 * `reacao-de-avatar.tsx`. `deId` é de quem buscar o boneco; `avatar`, quando
 * já está à mão (quem manda vê o próprio), poupa a ida ao servidor.
 */
export function dispararReacaoDoAvatar(
  reacao: ReacaoDoAvatar,
  deNome: string,
  deId: string,
  meu = false,
  avatar?: AvatarConfig | null,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fluxo:reacao-avatar", { detail: { reacao, deNome, deId, meu, avatar } }),
  );
}

/** Abre a conversa com a pessoa no dock do chat. */
export function abrirConversa(pessoaId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("fluxo:abrir-chat", { detail: { pessoaId } }));
}
