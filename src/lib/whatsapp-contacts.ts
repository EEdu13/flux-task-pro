// Mapa de telefone (WhatsApp) → usuário do sistema.
// A chave é apenas dígitos; a comparação usa sufixo, então "4399608994"
// também casa com "5544399608994" (com DDI) e vice-versa.
import type { User } from "./fluxo-types";

export type WhatsAppContact = {
  userId: string;
  name: string;
  avatar: string;
};

/**
 * Vazio de propósito.
 *
 * Havia aqui um telefone real apontando para "Elisa Prado", que é uma pessoa
 * inventada — o bot atendia o número certo e criava a tarefa em nome de alguém
 * que não trabalha na Larsil.
 *
 * O lugar definitivo disto não é uma constante no código: é a IAM, que já sabe
 * quem é quem. Enquanto esse endpoint de telefone → pessoa não existir, o bot
 * não reconhece o remetente, e a tarefa cai sem dono em vez de cair no dono
 * errado.
 */
export const whatsappContacts: Record<string, WhatsAppContact> = {};

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

export function resolveWhatsAppContact(
  telefone: string | null | undefined,
): WhatsAppContact | null {
  const d = digits(telefone);
  if (!d) return null;
  for (const [key, contact] of Object.entries(whatsappContacts)) {
    const k = digits(key);
    if (!k) continue;
    if (d === k || d.endsWith(k) || k.endsWith(d)) return contact;
  }
  return null;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Resolve um "hint" de nome (ex: "elisa", "joão prado") para um usuário.
 * Casa por prefixo/inclusão em nome completo ou primeiro nome.
 */
/* `users` deixou de ter valor padrão. Ele era `seedUsers`, ou seja: esquecer de
   passar a lista não dava erro, só resolvia o nome contra pessoas inventadas.
   Agora quem chama é obrigado a dizer contra quem está comparando. */
export function resolveUserByName(
  hint: string | null | undefined,
  users: User[],
): User | null {
  const h = norm(hint ?? "");
  if (!h) return null;
  if (["mim", "eu", "para mim", "pra mim", "self"].includes(h)) return null;

  // exato
  const exact = users.find((u) => norm(u.name) === h);
  if (exact) return exact;

  // primeiro nome exato
  const first = users.find((u) => norm(u.name.split(" ")[0] ?? "") === h);
  if (first) return first;

  // includes
  const inc = users.find((u) => norm(u.name).includes(h) || h.includes(norm(u.name.split(" ")[0] ?? "")));
  if (inc) return inc;

  return null;
}

export function knownUsersForPrompt(users: User[]): string {
  return users.map((u) => `- ${u.name} (${u.jobTitle}, ${u.sector})`).join("\n");
}