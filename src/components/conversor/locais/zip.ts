import { zipSync } from "fflate";
import type { Saida } from "../tipos";
import { blobDe, bytesDe } from "./arquivos";

/**
 * Vários arquivos num .zip só (04/11/2026), para o navegador baixar de uma vez
 * — sem o aviso de "este site quer baixar vários arquivos". Só no navegador:
 * o app de mesa não grava .zip (ver `entregar.ts`).
 *
 * Sem compressão (nível 0): PDF e imagem já vêm comprimidos, e comprimir de
 * novo só gastaria tempo.
 */
export async function zipar(nome: string, saidas: Saida[]): Promise<Saida> {
  const conteudo: Record<string, Uint8Array> = {};
  for (const s of saidas) conteudo[s.nome] = await bytesDe(s.blob);
  return { nome, blob: blobDe(zipSync(conteudo, { level: 0 }), "application/zip") };
}
