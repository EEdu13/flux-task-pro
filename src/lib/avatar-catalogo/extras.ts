import { op } from "@/lib/avatar-op";

/*
 * Extras: acessórios e tipos de corpo — opções novas do catálogo do avatar (16/10/2026: "crie pelo menos
 * mais 10 de cada, bem criativo, baseado em Roblox").
 *
 * Cada parte do avatar tem o SEU arquivo de catálogo, para mais de uma pessoa
 * (ou agente) poder ampliar o provador ao mesmo tempo sem pisar no outro.
 * `avatar-3d.ts` junta estas listas no fim das originais. Regra de ouro: os
 * valores ficam gravados nos avatares das pessoas — NUNCA renomear nem tirar
 * um valor daqui, só acrescentar no fim. `op<never>()` = lista ainda vazia.
 */

/**
 * Acessórios novos (16/10/2026): os do catálogo do Roblox (mochila a jato,
 * asas, capa, espada…) e os da nossa lida (rádio, prancheta, muda). O que vai
 * na mão fica na mão DIREITA: a esquerda é a do aceno. Desenho em
 * `components/rv/acessorios-extras.tsx`.
 */
export const EXTRAS_ACESSORIO = op(
  ["jetpack", "Mochila a jato"],
  ["asasAnjo", "Asas de anjo"],
  ["asasFada", "Asas de fada"],
  ["capa", "Capa de herói"],
  ["espadaCostas", "Espada nas costas"],
  ["violao", "Violão nas costas"],
  ["cachecol", "Cachecol"],
  ["gravataBorboleta", "Gravata-borboleta"],
  ["correnteOuro", "Corrente de ouro"],
  ["bolsaTransversal", "Bolsa transversal"],
  ["radio", "Rádio comunicador"],
  ["prancheta", "Prancheta de inventário"],
  ["muda", "Muda de eucalipto"],
  ["papagaio", "Papagaio no ombro"],
  ["balao", "Balão"],
);

/** Corpos novos (16/10/2026): as proporções ficam em `components/rv/medidas.ts`. */
export const EXTRAS_CORPO = op(
  ["alto", "Alto"],
  ["gordinho", "Gordinho"],
  ["atletico", "Atlético"],
  ["mini", "Mini (criança)"],
  ["cabecudo", "Cabeçudo"],
  ["gigante", "Gigante"],
);
