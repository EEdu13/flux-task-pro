/*
 * Abrir a paleta de conversão de qualquer lugar: o raio das ações rápidas, o
 * item da barra lateral e o Ctrl+K. Quem está montado (uma vez, em
 * `globais-do-app.tsx`) ouve o evento — o mesmo jeito da reserva de sala.
 *
 * Mora num `.ts` à parte, e não junto do componente, para quem só precisa
 * abrir não puxar a paleta inteira para o próprio pacote.
 */

export const EVENTO_ABRIR_CONVERSOR = "fluxo:abrir-conversor";

export function abrirConversor(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONVERSOR));
}
