/*
 * Sorteio determinístico do cabelo: o mesmo penteado sai igual em todo
 * computador e a cada remontagem (a sala inteira vê o mesmo avatar). Por isso
 * é proibido `Math.random` no motor do cabelo — tudo passa por aqui.
 */

/** Gerador a partir de um texto: hash FNV-1a da semente + mulberry32. Devolve [0, 1). */
export function semente(txt: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) h = Math.imul(h ^ txt.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gerador a partir de um número (texturas pintadas: cada uma tem a sua). */
export function sementeNum(n: number): () => number {
  let h = n >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let x = h;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
