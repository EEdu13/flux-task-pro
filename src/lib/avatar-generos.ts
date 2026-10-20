import { CABELOS_FEMININOS_EXTRAS, CABELOS_MASCULINOS_EXTRAS } from "@/lib/avatar-catalogo/cabeca";
import { EXPRESSOES_FEMININAS_EXTRAS } from "@/lib/avatar-catalogo/rosto";

/**
 * Qual peça do avatar é masculina ou feminina — para o filtro "Femininas |
 * Masculinas" do provador (16/10/2026: "divida cabelos masculinos e
 * femininos"). O que não está em nenhum dos dois é unissex e aparece nos dois
 * filtros. As roupas ficam em `avatar-3d.ts` (ROUPAS_FEMININAS/MASCULINAS).
 */

export const CABELOS_FEMININOS: ReadonlySet<string> = new Set([
  ...CABELOS_FEMININOS_EXTRAS,
  "chanel",
  "longo",
  "franjaLonga",
  "ondulado",
  "cacheado",
  "rabo",
  "raboAlto",
  "coque",
  "coqueDuplo",
  "chiquinha",
  "trancas",
  "longoMechas",
  "longoEscorrido",
  "chiquinhaAlta",
  "longoRepicado",
  "raboFranja",
  "coqueSolto",
  "longoFlor",
  "repicadoChiquinhas",
  "longoTrancinhas",
  "trancasBaixas",
  "trancasBoxer",
  "trancaLateral",
  "trancaEspinha",
]);

export const CABELOS_MASCULINOS: ReadonlySet<string> = new Set([
  ...CABELOS_MASCULINOS_EXTRAS,
  "social",
  "topete",
  "anime",
  "baguncado",
  "emo",
  "wolfcut",
  "moicano",
  "cacheadoCurto",
  "raspado",
  "careca",
]);

/** Rostos femininos (maquiados). */
export const EXPRESSOES_FEMININAS: ReadonlySet<string> = new Set<string>([
  ...EXPRESSOES_FEMININAS_EXTRAS,
  "glamSorriso",
  "glamBeicinho",
  "glamPiscadinha",
  "glamSerena",
]);
