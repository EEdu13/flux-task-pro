import type { AvatarConfig } from "@/lib/avatar-3d";
import { desenharEstampa } from "@/components/rv/avatar-texturas";
import { desenharEstampaNova } from "./estampas-novas";
import type { CtxFace } from "./molde";

/**
 * A estampa do peito, pintada DENTRO do atlas da peça (antes era um plano
 * transparente colado na frente, que não sombreava junto com o pano).
 *
 * As estampas antigas vêm do desenho de `avatar-texturas.ts`; a guarda
 * `ANTIGAS.has(e)` é obrigatória: aquele switch não é exaustivo, e um valor
 * novo devolveria uma textura vazia — a estampa sumiria em silêncio.
 */
type EstampaNova = "universidade" | "kawaii";
export type TipoEstampa = AvatarConfig["estampa"] | EstampaNova;

const ANTIGAS = new Set<string>(["coracao", "raio", "estrela", "smile", "arvore", "dez"]);

/** Desenha a estampa centrada em (cx, cy), num quadrado de `lado` metros. */
export function desenharEstampaNaFace(
  f: CtxFace,
  e: TipoEstampa,
  corDaRoupa: string,
  cx: number,
  cy: number,
  lado: number,
): void {
  if (e === "nenhuma" || f.mascara) return;
  if (ANTIGAS.has(e)) {
    const tex = desenharEstampa(e as AvatarConfig["estampa"], corDaRoupa);
    if (!tex) return;
    const img = tex.image as HTMLCanvasElement;
    const { g } = f;
    g.save();
    // tinta de silk: leve transparência para o pano "aparecer" por baixo
    g.globalAlpha = 0.94;
    g.drawImage(img, cx - lado / 2, cy - lado / 2, lado, lado);
    g.restore();
    tex.dispose();
    return;
  }
  // Estampas novas do catálogo (16/10/2026): desenho vetorial em `estampas-novas.ts`.
  if (desenharEstampaNova(f, e, corDaRoupa, cx, cy, lado)) return;
  // Valores novos (Fase 1): até lá, nada — mas nunca uma textura vazia.
}
