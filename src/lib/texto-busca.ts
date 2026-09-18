/**
 * Normalização de texto para busca — fonte única do lado do cliente.
 *
 * Comparar com `toLowerCase().includes()` é sensível a acento, e em português
 * isso erra o tempo todo: quem digita "reuniao" não acha "reunião", quem digita
 * "orcamento" não acha "orçamento". E ninguém digita acento numa caixa de
 * busca com pressa.
 *
 * Existem outras três cópias disto no projeto (`voz.server.ts`,
 * `excel-paste.ts`, `whatsapp-contacts.ts`), cada uma nascida no seu canto.
 * Elas continuam lá por enquanto: mexer nelas é mexer em parsing de colagem e
 * de contato, que é outro assunto. Código novo usa este.
 */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}
