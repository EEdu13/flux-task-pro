import { op } from "@/lib/avatar-op";

/*
 * Cabeça: penteados e chapéus — opções novas do catálogo do avatar (16/10/2026: "crie pelo menos
 * mais 10 de cada, bem criativo, baseado em Roblox").
 *
 * Cada parte do avatar tem o SEU arquivo de catálogo, para mais de uma pessoa
 * (ou agente) poder ampliar o provador ao mesmo tempo sem pisar no outro.
 * `avatar-3d.ts` junta estas listas no fim das originais. Regra de ouro: os
 * valores ficam gravados nos avatares das pessoas — NUNCA renomear nem tirar
 * um valor daqui, só acrescentar no fim. `op<never>()` = lista ainda vazia.
 */

// Penteados masculinos do motor novo (`cabelo-estilos-masculinos.ts`), 16/10/2026.
export const EXTRAS_CABELO = op(
  ["undercut", "Undercut"],
  ["socialLambido", "Social de lado com gel"],
  ["topeteQuiff", "Topete quiff"],
  ["buzzCut", "Buzz cut degradê"],
  ["coqueMasculino", "Coque masculino (man bun)"],
  ["surfista", "Surfista ondulado"],
  ["cacheadoDegrade", "Cacheado no topo com degradê"],
  ["heroiAnime", "Herói anime espetado"],
  ["mulletRoqueiro", "Mullet roqueiro"],
  ["hiTop", "Hi-top fade"],
  ["nago", "Trancinhas nagô"],
  ["franjaEboy", "Franja e-boy"],
  ["samurai", "Coque samurai"],
);

// Chapéus e enfeites novos (`cabelo-chapeus-novos.ts`), 16/10/2026: o agro/silvicultura
// e os clássicos divertidos do Roblox. Capacete viking e chifrinhos saíram (17/10/2026:
// "faz referência e não gostamos") — quem tinha volta para "sem chapéu".
export const EXTRAS_CHAPEU = op(
  ["chapeuPalha", "Chapéu de palha"],
  ["boneTrucker", "Boné trucker"],
  ["chapeuCowboy", "Chapéu de cowboy"],
  ["capaceteFlorestal", "Capacete florestal com viseira (EPI)"],
  ["gorroPompom", "Touca com pompom"],
  ["chapeuPescador", "Chapéu bucket"],
  ["coroaFolhas", "Coroa de folhas"],
  ["bandana", "Bandana"],
  ["boina", "Boina"],
  ["chapeuChef", "Chapéu de chef"],
  ["chapeuFesta", "Chapéu de festa"],
  ["boneHelice", "Boné de hélice"],
  ["aureola", "Auréola"],
  ["foneGatinho", "Fone com orelhas de gato"],
  ["sombrero", "Sombrero"],
);

/** Penteados femininos novos. */
export const CABELOS_FEMININOS_EXTRAS: ReadonlySet<string> = new Set<string>([]);

/** Penteados masculinos novos. */
export const CABELOS_MASCULINOS_EXTRAS: ReadonlySet<string> = new Set<string>([
  "undercut",
  "socialLambido",
  "topeteQuiff",
  "buzzCut",
  "coqueMasculino",
  "surfista",
  "cacheadoDegrade",
  "heroiAnime",
  "mulletRoqueiro",
  "hiTop",
  "nago",
  "franjaEboy",
  "samurai",
]);
