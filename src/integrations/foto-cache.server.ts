/**
 * Cache das miniaturas de rosto servidas por `/api/public/foto/$nome`.
 *
 * Mora fora da rota para que a troca de foto (ver `foto.functions.ts`) possa
 * apagar a entrada da pessoa na hora: sem isso a foto antiga continuaria sendo
 * servida pelas 6h do TTL.
 */

export type EntradaDeFoto = { at: number; buf: Buffer | null; tipo: string };

const MAX_ENTRADAS = 400;
const cache = new Map<string, EntradaDeFoto>();

/** A chave é o nome sem caixa e sem espaço nas pontas — igual à busca no banco. */
const chave = (nome: string) => nome.trim().toUpperCase();

export function fotoEmCache(nome: string): EntradaDeFoto | undefined {
  return cache.get(chave(nome));
}

export function guardarFoto(nome: string, buf: Buffer | null, tipo: string) {
  // Guarda também a ausência: sem isso, cada rosto sem foto viraria uma ida à
  // IAM a cada render.
  if (cache.size > MAX_ENTRADAS) cache.clear();
  cache.set(chave(nome), { at: Date.now(), buf, tipo });
}

export function esquecerFoto(nome: string) {
  cache.delete(chave(nome));
}
