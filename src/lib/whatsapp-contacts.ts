// Mapa de telefone (WhatsApp) → usuário do sistema.
// A chave é apenas dígitos; a comparação usa sufixo, então "4399608994"
// também casa com "5544399608994" (com DDI) e vice-versa.
export type WhatsAppContact = {
  userId: string;
  name: string;
  avatar: string;
};

export const whatsappContacts: Record<string, WhatsAppContact> = {
  // Elisa Prado — número usado pra criar tarefas via WhatsApp
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