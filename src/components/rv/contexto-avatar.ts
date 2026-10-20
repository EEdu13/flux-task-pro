import { createContext } from "react";
import type { AvatarConfig } from "@/lib/avatar-3d";

export type Qualidade = "alta" | "media";
export type PoseAvatar = "em-pe" | "sentado";

/** Fornecida pela SALA dentro do <Canvas>; provador e rv-render ficam em "alta". */
export const QualidadeDoAvatar = createContext<Qualidade>("alta");

/** Fornecido pelo Avatar3D envolvendo todo o boneco. */
export type ContextoAvatar = {
  config: AvatarConfig | null;
  pose: PoseAvatar;
  qualidade: Qualidade;
};
export const ContextoDoAvatar = createContext<ContextoAvatar>({
  config: null,
  pose: "sentado",
  qualidade: "alta",
});
