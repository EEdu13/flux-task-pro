import { op } from "@/lib/avatar-op";

/*
 * Parte de cima: roupas e estampas — opções novas do catálogo do avatar (16/10/2026: "crie pelo menos
 * mais 10 de cada, bem criativo, baseado em Roblox").
 *
 * Cada parte do avatar tem o SEU arquivo de catálogo, para mais de uma pessoa
 * (ou agente) poder ampliar o provador ao mesmo tempo sem pisar no outro.
 * `avatar-3d.ts` junta estas listas no fim das originais. Regra de ouro: os
 * valores ficam gravados nos avatares das pessoas — NUNCA renomear nem tirar
 * um valor daqui, só acrescentar no fim. `op<never>()` = lista ainda vazia.
 */

export const EXTRAS_ROUPA = op(
  // —— 16/10/2026: desenhadas em roupa/pecas-cima.ts (seção "novas") ——
  ["flanelaAberta", "Flanela aberta + regata"],
  ["jaquetaPatches", "Jaqueta jeans com patches"],
  ["cortaVento", "Corta-vento colorido"],
  ["jaquetaCouro", "Jaqueta de couro"],
  ["brigadista", "Brigadista florestal"],
  ["coleteCampo", "Colete de campo"],
  ["camisaTime", "Camisa de time"],
  ["moletomCropped", "Moletom cropped"],
  ["bomberCetim", "Bomber de cetim"],
  ["kimono", "Kimono haori"],
  ["sueterRenas", "Suéter de renas"],
  ["vestidoTule", "Vestido de festa com tule"],
  ["vestidoFloral", "Vestido floral"],
  ["jardineira", "Jardineira"],
  ["ombroSo", "Blusa de um ombro só"],
  ["corset", "Corset"],
  ["havaiana", "Camisa havaiana"],
  ["poloRugby", "Polo listrada rugby"],
  // —— 19/10/2026: o uniforme da empresa, com o símbolo no bolso ——
  ["uniformeSocial", "Uniforme · camisa social azul"],
  ["uniformePolo", "Uniforme · polo azul-marinho"],
);

export const EXTRAS_ESTAMPA = op(
  // —— 16/10/2026: desenhadas em roupa/estampas-novas.ts ——
  ["larsil", "Selo árvore"],
  ["pinheiro", "Pinheiro"],
  ["eucalipto", "Eucalipto"],
  ["folha", "Folha"],
  ["trator", "Trator"],
  ["sol", "Pôr do sol retrô"],
  ["raioNeon", "Raio neon"],
  ["caveira", "Caveirinha fofa"],
  ["controle", "Controle de game"],
  ["pizza", "Pizza"],
  ["derretendo", "Smile derretendo"],
  ["onda", "Onda"],
  ["planeta", "Planeta"],
  ["agro", "AGRO"],
  ["sgl", "SGL"],
);

/** Partes de cima femininas novas. */
export const ROUPAS_FEMININAS_CIMA: ReadonlySet<string> = new Set<string>([
  "moletomCropped",
  "vestidoTule",
  "vestidoFloral",
  "jardineira",
  "ombroSo",
  "corset",
]);

/** Partes de cima masculinas novas. */
export const ROUPAS_MASCULINAS_CIMA: ReadonlySet<string> = new Set<string>([
  "coleteCampo",
  "poloRugby",
]);

/** Novas peças que cobrem o corpo todo (vestidos, macacões…). */
export const ROUPA_INTEIRA_EXTRAS: ReadonlySet<string> = new Set<string>([
  "vestidoTule",
  "vestidoFloral",
  "jardineira",
]);

/** Novas partes de cima que aceitam estampa. */
export const COM_ESTAMPA_EXTRAS: ReadonlySet<string> = new Set<string>([
  "flanelaAberta",
  "jaquetaPatches",
  "camisaTime",
  "moletomCropped",
  "jardineira",
]);
