/**
 * Os emojis das reações e do chat, e a memória de quais a pessoa usa.
 *
 * A lista é nossa, por categoria, e não um pacote de emoji inteiro: são os que
 * fazem sentido para reagir a trabalho e conversar, e cabem num painel sem
 * rolagem infinita. A ordem de cada categoria é a de uso mais comum.
 */
export const CATEGORIAS_DE_EMOJI: { nome: string; emojis: string[] }[] = [
  {
    nome: "Reações",
    emojis: ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🔥", "✅", "👀", "💯", "🎉", "🤝", "💪", "🚀", "⭐"],
  },
  {
    nome: "Rostos",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😘", "😎", "🤩", "🥳",
      "🤔", "🤨", "😐", "😑", "🙄", "😏", "😬", "😴", "🤯", "😱", "😳", "🥺", "😭", "😤", "😡", "🤬",
      "🤗", "🤭", "🫡", "🤫", "😇", "🤓", "🧐", "😵‍💫", "🥲", "😌", "😋", "🤤", "🤪", "😜", "🫠", "🙃",
    ],
  },
  {
    nome: "Gestos",
    emojis: ["👌", "✌️", "🤞", "🫶", "🤙", "👋", "🙌", "👎", "✊", "👊", "🤘", "☝️", "👆", "👇", "👉", "👈", "🫵", "✍️", "💅", "🤦", "🤷", "🙋", "🙆", "🙅"],
  },
  {
    nome: "Corações",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💖", "💗", "💓", "💞", "💕", "💔", "❣️"],
  },
  {
    nome: "Trabalho",
    emojis: ["📌", "📎", "📝", "📅", "📊", "📈", "📉", "💼", "📁", "🗂️", "🧾", "💰", "💵", "🏆", "🥇", "🎯", "⏰", "⌛", "☕", "💡", "🔔", "📣", "🛠️", "⚙️", "🚜", "🌲", "🌱", "🪵", "🚚", "⛽"],
  },
  {
    nome: "Símbolos",
    emojis: ["✔️", "❌", "⚠️", "❗", "❓", "‼️", "🆗", "🆕", "🔝", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "✨", "💥", "💤", "🎈", "🎁", "🍀", "🌟", "☀️"],
  },
];

/** Os rápidos de quem nunca reagiu: o "visto" e os de sempre. */
const PADRAO_RAPIDO = ["👍", "❤️", "😂", "😮", "🙏", "👏", "🔥", "✅"];

const chave = (pessoaId: string) => `fluxo:emojis:${pessoaId}`;

type Memoria = { recentes: string[]; contagem: Record<string, number> };

function ler(pessoaId: string): Memoria {
  try {
    const v = JSON.parse(localStorage.getItem(chave(pessoaId)) ?? "null") as Partial<Memoria> | null;
    return {
      recentes: Array.isArray(v?.recentes) ? v!.recentes.filter((e) => typeof e === "string") : [],
      contagem: v?.contagem && typeof v.contagem === "object" ? v.contagem : {},
    };
  } catch {
    return { recentes: [], contagem: {} };
  }
}

/** Anota o uso de um emoji: vai para o começo dos recentes e soma na contagem. */
export function lembrarEmoji(pessoaId: string, emoji: string) {
  const m = ler(pessoaId);
  m.recentes = [emoji, ...m.recentes.filter((e) => e !== emoji)].slice(0, 16);
  m.contagem[emoji] = (m.contagem[emoji] ?? 0) + 1;
  try {
    localStorage.setItem(chave(pessoaId), JSON.stringify(m));
  } catch {
    /* sem armazenamento: a lista rápida fica a padrão */
  }
}

/**
 * A fileira rápida: os recentes primeiro, depois os mais usados, e o padrão
 * completando — sempre `quantos`, sem repetir.
 */
export function emojisRapidos(pessoaId: string, quantos = 8): string[] {
  const m = ler(pessoaId);
  const maisUsados = Object.entries(m.contagem)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
  const lista: string[] = [];
  for (const e of [...m.recentes.slice(0, 4), ...maisUsados, ...m.recentes, ...PADRAO_RAPIDO]) {
    if (!lista.includes(e)) lista.push(e);
    if (lista.length >= quantos) break;
  }
  return lista;
}

/** Os emojis grandes que dá para mandar pelo chat, na tela inteira. */
export const EMOJIS_GIGANTES = ["❤️", "😂", "😍", "👏", "🎉", "🔥", "😮", "😢", "😡", "👍", "🙏", "🚀", "☕", "🌲", "💪", "🤝"];
