import { useEffect, useSyncExternalStore } from "react";
import type { AvatarConfig } from "@/lib/avatar-3d";
import {
  assinarAniversarios,
  fazAniversarioHojeId,
  garantirAniversariosDeHoje,
  versaoDosAniversarios,
} from "@/lib/aniversario-hoje";

/**
 * O avatar de quem faz aniversário hoje ganha o chapéu de festa por 24h
 * (19/10/2026: "até na sala 3D dá pra deixar o chapéu"). Só na tela: o
 * avatar salvo não muda. Usa a lista de aniversariantes que já existe
 * (`aniversario-hoje.ts`, uma pergunta ao servidor por dia).
 */
const comChapeu = new WeakMap<AvatarConfig, AvatarConfig>();

export function comChapeuDeFesta(pessoaId: string, config: AvatarConfig): AvatarConfig {
  if (!fazAniversarioHojeId(pessoaId)) return config;
  /* Sempre o mesmo objeto para o mesmo avatar: o boneco refaz as texturas do
     rosto quando o objeto muda, e um novo a cada desenho era trabalho à toa. */
  let c = comChapeu.get(config);
  if (!c) {
    c = { ...config, chapeu: "chapeuFesta" };
    comChapeu.set(config, c);
  }
  return c;
}

/** Re-renderiza quando a lista de aniversariantes de hoje chega. */
export function useAniversariosDeHoje(): number {
  useEffect(() => garantirAniversariosDeHoje(), []);
  return useSyncExternalStore(assinarAniversarios, versaoDosAniversarios, () => 0);
}
