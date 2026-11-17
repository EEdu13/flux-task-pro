import type { DragEvent } from "react";

/**
 * O arraste traz arquivo do computador? Arrastar tarefa, texto ou link (que
 * levam `text/plain`) não mexe na paleta nem na faixa.
 */
export function temArquivo(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}
