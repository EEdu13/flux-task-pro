/*
 * Enquadramento da câmera da sala: o FOV que cabe no palco e quando o meu
 * próprio avatar sai de cena.
 *
 * Por que funções puras num arquivo à parte: a câmera (sala-3d.tsx), o meu
 * boneco (avatar-na-cadeira.tsx) e o Projetor dos crachás precisam da MESMA
 * resposta. Se o boneco some mas o selo de mudo dele continua, o selo fica
 * flutuando no meio da mesa — exatamente o defeito que isto corrige.
 */
import type { Lugar } from "./lugares";
import {
  ALTURA_DA_NUCA,
  CAMERA_FOV,
  CAMERA_FOV_MAX,
  CAMERA_PERTO_DA_CABECA,
  CAMERA_TAN_HORIZONTAL_MIN,
} from "./medidas-da-sala";

const GRAU = Math.PI / 180;

/**
 * FOV vertical para a proporção do palco (largura / altura). Nunca menos que
 * CAMERA_FOV (palco largo fica como sempre foi) e, em palco estreito, o
 * bastante para o campo HORIZONTAL ter tan(h/2) ≥ CAMERA_TAN_HORIZONTAL_MIN.
 */
export function fovParaProporcao(proporcao: number): number {
  if (!Number.isFinite(proporcao) || proporcao <= 0) return CAMERA_FOV;
  const vertical = (2 * Math.atan(CAMERA_TAN_HORIZONTAL_MIN / proporcao)) / GRAU;
  return Math.min(CAMERA_FOV_MAX, Math.max(CAMERA_FOV, vertical));
}

/** A câmera está colada na minha nuca: o meu boneco e os selos dele não aparecem. */
export function meuAvatarEscondido(
  camera: { x: number; y: number; z: number },
  lugar: Pick<Lugar, "x" | "z">,
  elevacao: number,
): boolean {
  const dx = camera.x - lugar.x;
  const dy = camera.y - (ALTURA_DA_NUCA + elevacao);
  const dz = camera.z - lugar.z;
  return Math.hypot(dx, dy, dz) < CAMERA_PERTO_DA_CABECA;
}
