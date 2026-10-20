import { useEffect, useState } from "react";
import { carregarMeuAvatar, type AvatarConfig } from "@/lib/avatar-3d";
import { useFluxo } from "@/lib/fluxo-store";

/**
 * O meu avatar 3D, para quem só MOSTRA (o Início, 16/10/2026). Busca uma vez
 * por sessão e guarda; quando a aba "Meu avatar" das Configurações salva, ela
 * avisa por "fluxo:avatar-atualizado" e todo mundo que usa o hook troca na hora.
 *
 * `null` = ainda carregando ou a pessoa nunca montou o dela.
 */
let guardado: AvatarConfig | null | undefined;
let buscando: Promise<AvatarConfig | null | undefined> | null = null;
/** De quem é o que está guardado: trocar de usuário na mesma janela recomeça. */
let guardadoDe = "";

export const EVENTO_AVATAR_ATUALIZADO = "fluxo:avatar-atualizado";

export function avisarAvatarAtualizado(a: AvatarConfig) {
  guardado = a;
  buscando = Promise.resolve(a);
  window.dispatchEvent(new CustomEvent(EVENTO_AVATAR_ATUALIZADO, { detail: a }));
}

export function useMeuAvatar(): { avatar: AvatarConfig | null; carregado: boolean } {
  const { currentUser } = useFluxo();
  const eu = currentUser?.id ?? "";
  if (guardadoDe !== eu) {
    guardadoDe = eu;
    guardado = undefined;
    buscando = null;
  }
  const [avatar, setAvatar] = useState<AvatarConfig | null>(guardado ?? null);
  const [carregado, setCarregado] = useState(guardado !== undefined);

  useEffect(() => {
    let vivo = true;
    if (guardado === undefined) {
      // Falha (rede, sessão ainda chegando) não fica guardada: tenta de novo depois.
      buscando ??= carregarMeuAvatar().catch(() => {
        buscando = null;
        return undefined;
      });
      void buscando.then((a) => {
        if (a !== undefined) guardado = a;
        if (vivo) {
          setAvatar(a ?? null);
          setCarregado(true);
        }
      });
    }
    const aoMudar = (e: Event) => {
      const a = (e as CustomEvent<AvatarConfig>).detail;
      setAvatar(a);
      setCarregado(true);
    };
    window.addEventListener(EVENTO_AVATAR_ATUALIZADO, aoMudar);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_AVATAR_ATUALIZADO, aoMudar);
    };
  }, [eu]);

  return { avatar, carregado };
}
