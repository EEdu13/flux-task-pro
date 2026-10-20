/**
 * As proporções de cada tipo de corpo do avatar (em metros). Compartilhado
 * entre o corpo (`avatar-3d.tsx`) e a cabeça (`cabeca-3d.tsx`).
 */
export const MEDIDAS = {
  classico: {
    troncoW: 0.56,
    troncoH: 0.6,
    troncoD: 0.3,
    bracoW: 0.24,
    pernaW: 0.27,
    pernaH: 0.72,
    cabeca: 0.46,
  },
  esguio: {
    troncoW: 0.46,
    troncoH: 0.64,
    troncoD: 0.27,
    bracoW: 0.2,
    pernaW: 0.22,
    pernaH: 0.8,
    cabeca: 0.44,
  },
  forte: {
    troncoW: 0.68,
    troncoH: 0.62,
    troncoD: 0.34,
    bracoW: 0.29,
    pernaW: 0.3,
    pernaH: 0.7,
    cabeca: 0.46,
  },
  baixinho: {
    troncoW: 0.52,
    troncoH: 0.48,
    troncoD: 0.3,
    bracoW: 0.22,
    pernaW: 0.25,
    pernaH: 0.48,
    cabeca: 0.52,
  },
  /*
   * Corpos novos (16/10/2026, catálogo `EXTRAS_CORPO`). Tudo o que veste o
   * boneco (roupa, cabelo, chapéu, acessório) lê só estes 7 campos, então um
   * corpo novo é só uma linha aqui. Limites para não quebrar as peças: as duas
   * pernas (2·pernaW + 1 cm) cabem no tronco e o braço é bem mais fino que ele.
   */
  /** Alto: pernas e tronco compridos, mesma largura do clássico. */
  alto: {
    troncoW: 0.55,
    troncoH: 0.68,
    troncoD: 0.3,
    bracoW: 0.23,
    pernaW: 0.26,
    pernaH: 0.88,
    cabeca: 0.45,
  },
  /** Gordinho: barrigudo (tronco largo e fundo), pernas curtas e grossas. */
  gordinho: {
    troncoW: 0.74,
    troncoH: 0.6,
    troncoD: 0.44,
    bracoW: 0.27,
    pernaW: 0.32,
    pernaH: 0.62,
    cabeca: 0.48,
  },
  /** Atlético: ombros largos e cintura de perna fina — o "V" do bloco. */
  atletico: {
    troncoW: 0.72,
    troncoH: 0.66,
    troncoD: 0.3,
    bracoW: 0.27,
    pernaW: 0.26,
    pernaH: 0.78,
    cabeca: 0.44,
  },
  /** Mini: criança — tudo menor, cabeça proporcionalmente grande. */
  mini: {
    troncoW: 0.44,
    troncoH: 0.42,
    troncoD: 0.25,
    bracoW: 0.19,
    pernaW: 0.2,
    pernaH: 0.4,
    cabeca: 0.54,
  },
  /** Cabeçudo: o "chibi" do Roblox — cabeça enorme num corpinho. */
  cabecudo: {
    troncoW: 0.48,
    troncoH: 0.44,
    troncoD: 0.28,
    bracoW: 0.2,
    pernaW: 0.22,
    pernaH: 0.44,
    cabeca: 0.64,
  },
  /** Gigante: alto E forte, o maior de todos. */
  gigante: {
    troncoW: 0.76,
    troncoH: 0.7,
    troncoD: 0.38,
    bracoW: 0.3,
    pernaW: 0.33,
    pernaH: 0.86,
    cabeca: 0.47,
  },
} as const;
export type Medidas = (typeof MEDIDAS)[keyof typeof MEDIDAS];
