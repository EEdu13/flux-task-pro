/**
 * Reações do avatar (pedido do usuário, 17/10/2026): o MEU boneco 3D aparece
 * na tela da outra pessoa fazendo um gesto, como o emoji gigante do MSN.
 *
 * Este arquivo é só o CATÁLOGO — puro, sem React nem three — porque é lido dos
 * dois lados: o servidor valida o pedido por ele (`sendNudgeFn`) e a tela
 * desenha por ele (`reacao-de-avatar.tsx`). Os gestos em si (braços, corpo)
 * estão em `rv/poses-de-reacao.ts`; o rosto, em `avatar-texturas.ts`.
 *
 * Regra de ouro, a mesma das opções do avatar: o id viaja na rede e fica
 * gravado no chat — NUNCA renomear nem tirar um id daqui, só acrescentar.
 * Uma reação nova (abraço, obrigado…) é uma linha aqui, um gesto em
 * `poses-de-reacao.ts` e os efeitos em `reacao-de-avatar.tsx`.
 */

export type ReacaoDoAvatar =
  | "beijo"
  | "bravo"
  // As dez novas (17/10/2026: "quero essas 10"):
  | "comemorar"
  | "abraco"
  | "obrigado"
  | "joinha"
  | "olho"
  | "rindo"
  | "bora"
  | "sono"
  | "cafe"
  | "trofeu";

export type DefinicaoDeReacao = {
  emoji: string;
  /** O botão no cabeçalho do chat. */
  rotulo: string;
  /** A faixa na tela de quem recebe: "Eduardo mandou um beijo! 💋". */
  faixa: (quem: string, meu: boolean) => string;
  /**
   * A linha que fica gravada na conversa (depois do emoji). Tem de ser legível
   * sozinha: a tela antiga, que não conhece a reação, mostra este texto como
   * mensagem comum. NUNCA mudar — é por ela que a tela nova reconhece o aviso.
   */
  noChat: string;
  /** Quanto tempo a cena fica na tela (entrada + gesto + saída). */
  duracaoMs: number;
  /**
   * Reservado para "liberar a partir do nível X" (17/10/2026): por ora
   * ninguém é barrado — o campo existe para a trava não exigir mudar o
   * formato depois.
   */
  nivelMinimo?: number;
};

export const REACOES_DO_AVATAR: Record<ReacaoDoAvatar, DefinicaoDeReacao> = {
  beijo: {
    emoji: "💋",
    rotulo: "Beijo",
    faixa: (quem, meu) => (meu ? "Você mandou um beijo! 💋" : `${quem} mandou um beijo! 💋`),
    noChat: "mandou um beijo!",
    duracaoMs: 3800,
  },
  bravo: {
    emoji: "😠",
    rotulo: "Bravo",
    faixa: (quem, meu) => (meu ? "Você está bravo(a)! 😠" : `${quem} está bravo(a)! 😠`),
    noChat: "ficou bravo(a)!",
    duracaoMs: 3800,
  },
  comemorar: {
    emoji: "🎉",
    rotulo: "Comemorando",
    faixa: (quem, meu) => (meu ? "Você está comemorando! 🎉" : `${quem} está comemorando! 🎉`),
    noChat: "está comemorando!",
    duracaoMs: 3900,
  },
  abraco: {
    emoji: "🤗",
    rotulo: "Abraço",
    faixa: (quem, meu) => (meu ? "Você mandou um abraço! 🤗" : `${quem} mandou um abraço! 🤗`),
    noChat: "mandou um abraço!",
    duracaoMs: 3900,
  },
  obrigado: {
    emoji: "🙏",
    rotulo: "Obrigado",
    faixa: (quem, meu) => (meu ? "Você agradeceu! 🙏" : `${quem} agradece! 🙏`),
    noChat: "agradeceu!",
    duracaoMs: 3800,
  },
  joinha: {
    emoji: "👍",
    rotulo: "Joinha",
    faixa: (quem, meu) => (meu ? "Você mandou um joinha! 👍" : `Joinha de ${quem}! 👍`),
    noChat: "mandou um joinha!",
    duracaoMs: 3500,
  },
  olho: {
    emoji: "👀",
    rotulo: "Tô de olho",
    faixa: (quem, meu) => (meu ? "Você está de olho! 👀" : `${quem} está de olho! 👀`),
    noChat: "está de olho!",
    duracaoMs: 4000,
  },
  rindo: {
    emoji: "😂",
    rotulo: "Rindo muito",
    faixa: (quem, meu) => (meu ? "Você está rindo muito! 😂" : `${quem} está rindo muito! 😂`),
    noChat: "está rindo muito!",
    duracaoMs: 3800,
  },
  bora: {
    emoji: "💪",
    rotulo: "Bora!",
    faixa: (quem, meu) => (meu ? "Você disse: bora! 💪" : `${quem} disse: bora! 💪`),
    noChat: "disse: bora!",
    duracaoMs: 3600,
  },
  sono: {
    emoji: "😴",
    rotulo: "Sono",
    faixa: (quem, meu) => (meu ? "Você está com sono… 😴" : `${quem} está com sono… 😴`),
    noChat: "está com sono…",
    duracaoMs: 4200,
  },
  cafe: {
    emoji: "☕",
    rotulo: "Pausa pro café",
    faixa: (quem, meu) => (meu ? "Você chamou pro café! ☕" : `${quem} chamou pro café! ☕`),
    noChat: "chamou pro café!",
    duracaoMs: 4100,
  },
  trofeu: {
    emoji: "🏆",
    rotulo: "Você é top!",
    faixa: (quem, meu) => (meu ? "Você mandou um troféu! 🏆" : `${quem} disse: você é top! 🏆`),
    noChat: "disse que você é top!",
    duracaoMs: 4000,
  },
};

/** A ordem dos botões no chat. */
export const LISTA_DE_REACOES = Object.keys(REACOES_DO_AVATAR) as ReacaoDoAvatar[];

export function ehReacaoDoAvatar(v: unknown): v is ReacaoDoAvatar {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(REACOES_DO_AVATAR, v);
}

/**
 * A reação viaja na tabela de avisos como cutucada com a mensagem
 * "avatar:beijo" — o mesmo truque do emoji gigante (`PREFIXO_EMOJI`): a
 * tabela só aceita `cutucada` e `trator`, e a tela antiga, sem saber do
 * prefixo, recebe uma cutucada comum em vez de nada.
 */
export const PREFIXO_REACAO = "avatar:";
