import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { dispararEmojiGigante } from "@/lib/avisos-no-chat";
import { REACOES_DO_AVATAR, ehReacaoDoAvatar } from "@/lib/reacoes-do-avatar";
import type { EventoDeReacao } from "@/components/reacao-de-avatar-cena";

/* A cena (three, R3F, o boneco) só é baixada na primeira reação: este
   componente fica montado no app inteiro e não pode puxar o 3D para todas as
   telas — o mesmo cuidado do avatar do Início (`AvatarAcenandoPreguicoso`). */
const CenaDaReacao = lazy(() =>
  import("@/components/reacao-de-avatar-cena").then((m) => ({ default: m.CenaDaReacao })),
);

/**
 * Reações do avatar (pedido do usuário, 17/10/2026): o boneco 3D de quem
 * mandou surge no meio da tela fazendo o gesto — beijo (olhos de coração, mão
 * na boca, atira o beijo e os corações voam) ou bravo (cara fechada, braços
 * cruzados, batendo o pé, 💢 e fumacinha). É o emoji gigante com o avatar.
 *
 * Ouve "fluxo:reacao-avatar" — disparado por quem manda (para ver junto) e
 * pela sondagem de avisos de quem recebe; ver `avisos-no-chat.ts`. O boneco
 * vem do evento (o meu, já carregado) ou do servidor (`avatarDaPessoa`). Quem
 * ainda não montou avatar vira o emoji da reação na tela inteira.
 *
 * Não bloqueia nada (`pointer-events-none`) e some sozinho. O <Canvas> só
 * existe durante a cena. Com movimento reduzido, o boneco fica parado no
 * instante que resume o gesto, sem entrada saltada nem efeitos voando.
 */

type Detalhe = {
  reacao?: unknown;
  deNome?: string;
  deId?: string;
  meu?: boolean;
  avatar?: AvatarConfig | null;
};

export function ReacaoDeAvatar() {
  const [atual, setAtual] = useState<EventoDeReacao | null>(null);
  /** O pedido mais recente: um avatar que chega tarde de um pedido velho é ignorado. */
  const ultimo = useRef(0);

  useEffect(() => {
    let timer: number | undefined;
    const aoReceber = (e: Event) => {
      const d = (e as CustomEvent<Detalhe>).detail;
      if (!d || !ehReacaoDoAvatar(d.reacao)) return;
      const reacao = d.reacao;
      const deNome = d.deNome ?? "";
      const meu = !!d.meu;
      const chave = Date.now();
      ultimo.current = chave;
      const deId = d.deId;
      const buscar: Promise<AvatarConfig | null> =
        d.avatar !== undefined
          ? Promise.resolve(d.avatar)
          : import("@/lib/avatar-3d").then(async (lib) => {
              const achado = meu
                ? await lib.carregarMeuAvatar()
                : deId
                  ? await lib.carregarAvatarDe(deId)
                  : null;
              // Quem ainda não montou o seu manda com o boneco em branco (17/10/2026).
              return achado ?? lib.AVATAR_EM_BRANCO;
            });
      buscar
        .catch((erro: unknown) => {
          console.warn("reação do avatar: não deu para carregar o boneco", erro);
          return null;
        })
        .then((avatar) => {
          if (ultimo.current !== chave) return;
          // Sem boneco, a reação ainda chega: o emoji dela na tela inteira.
          if (!avatar) {
            dispararEmojiGigante(REACOES_DO_AVATAR[reacao].emoji, deNome, meu);
            return;
          }
          setAtual({ reacao, deNome, meu, avatar, chave });
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setAtual(null), REACOES_DO_AVATAR[reacao].duracaoMs);
        });
    };
    window.addEventListener("fluxo:reacao-avatar", aoReceber);
    return () => {
      window.removeEventListener("fluxo:reacao-avatar", aoReceber);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Suspense fallback={null}>
      <AnimatePresence>
        {atual && <CenaDaReacao key={atual.chave} evento={atual} />}
      </AnimatePresence>
    </Suspense>
  );
}
