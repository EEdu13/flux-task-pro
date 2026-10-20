import { op } from "@/lib/avatar-op";

/*
 * Parte de baixo e calçados — opções novas do catálogo do avatar (16/10/2026: "crie pelo menos
 * mais 10 de cada, bem criativo, baseado em Roblox").
 *
 * Cada parte do avatar tem o SEU arquivo de catálogo, para mais de uma pessoa
 * (ou agente) poder ampliar o provador ao mesmo tempo sem pisar no outro.
 * `avatar-3d.ts` junta estas listas no fim das originais. Regra de ouro: os
 * valores ficam gravados nos avatares das pessoas — NUNCA renomear nem tirar
 * um valor daqui, só acrescentar no fim. `op<never>()` = lista ainda vazia.
 */

/**
 * Partes de baixo novas (16/10/2026). Desenhadas em `rv/roupa/pecas-baixo-extras.ts`.
 * Os ids não podem repetir os da parte de cima nem dos calçados (os filtros
 * de gênero misturam as três listas).
 */
export const EXTRAS_CALCA = op(
  ["calcaBrimCampo", "Brim de campo c/ joelheira"],
  ["cargoCamuflada", "Cargo camuflada"],
  ["calcaAgasalho", "Agasalho c/ faixa lateral"],
  ["jeansRasgado", "Jeans rasgado"],
  ["bermudaCargo", "Bermuda cargo"],
  ["shortAcademia", "Short de academia"],
  ["calcaCouro", "Calça de couro"],
  ["saiaXadrez", "Saia xadrez c/ corrente"],
  ["saiaPlissada", "Saia plissada midi"],
  ["bocaDeSino", "Boca de sino"],
  ["calcaPijama", "Pijama de estrelinhas"],
  ["kilt", "Kilt escocês"],
  ["leggingOnca", "Legging de oncinha"],
  ["saiaTule", "Saia de tule (tutu)"],
  ["shortMeiaCalca", "Short jeans c/ meia-calça"],
);

/** Calçados novos (16/10/2026). Desenhados em `rv/roupa/pecas-pes-extras.ts`. */
export const EXTRAS_SAPATO = op(
  ["galocha", "Galocha de borracha"],
  ["botinaEpi", "Botina c/ biqueira"],
  ["coturno", "Coturno"],
  ["tenisCano", "Tênis cano alto"],
  ["tenisChunky", "Tênis chunky"],
  ["babuche", "Babuche c/ pins"],
  ["chuteira", "Chuteira"],
  ["patins", "Patins"],
  ["pantufa", "Pantufa de bichinho"],
  ["plataforma", "Sandália plataforma"],
  ["mocassim", "Mocassim"],
  ["botaCowboy", "Bota country"],
  ["chineloMeia", "Chinelo com meia"],
);

/** Partes de baixo e calçados femininos novos. */
export const ROUPAS_FEMININAS_BAIXO: ReadonlySet<string> = new Set<string>([
  "saiaXadrez",
  "saiaPlissada",
  "bocaDeSino",
  "leggingOnca",
  "saiaTule",
  "shortMeiaCalca",
  "plataforma",
]);

/** Partes de baixo e calçados masculinos novos. */
export const ROUPAS_MASCULINAS_BAIXO: ReadonlySet<string> = new Set<string>([
  "bermudaCargo",
  "kilt",
  "mocassim",
]);
