// Mapa de telefone (WhatsApp) → usuário do sistema.
// A chave é apenas dígitos; a comparação usa sufixo, então "4399608994"
// também casa com "5544399608994" (com DDI) e vice-versa.
import { seedUsers } from "./fluxo-seed";
import type { User } from "./fluxo-types";

export type WhatsAppContact = {
  userId: string;
  name: string;
  avatar: string;
};

export const whatsappContacts: Record<string, WhatsAppContact> = {
  // Elisa Prado — número real conectado ao bot
  "4399608994": { userId: "u6", name: "Elisa Prado", avatar: "EP" },
};

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
export function resolveUserByName(
  hint: string | null | undefined,
  users: User[] = seedUsers,
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

export function knownUsersForPrompt(users: User[] = seedUsers): string {
  return users.map((u) => `- ${u.name} (${u.jobTitle}, ${u.sector})`).join("\n");
}