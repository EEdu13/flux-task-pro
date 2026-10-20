import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { escolher } from "@/components/confirm-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import { primeiroNome } from "@/integrations/iam/types";
import {
  AVATAR_EM_BRANCO,
  carregarMeuAvatar,
  salvarMeuAvatar,
  type AvatarConfig,
} from "@/lib/avatar-3d";
import { avisarAvatarAtualizado } from "@/lib/use-meu-avatar";

/* O editor carrega o three.js inteiro: só quando a aba é aberta. */
const EditorDeAvatar = lazy(() =>
  import("@/components/rv/editor-de-avatar").then((m) => ({ default: m.EditorDeAvatar })),
);

/**
 * "Meu avatar", nas Configurações (16/10/2026). O provador saiu da sala de
 * Realidade Virtual, que ficou escondida por enquanto: o avatar agora aparece
 * no Início, acenando, e é montado aqui.
 */
/**
 * A guarda da aba aberta agora (as Configurações perguntam antes de trocar de
 * aba). `true` = pode sair.
 */
let guardaAtual: (() => Promise<boolean>) | null = null;
export function podeSairDoAvatar(): Promise<boolean> {
  return guardaAtual ? guardaAtual() : Promise.resolve(true);
}

export function AbaAvatar() {
  const { currentUser } = useFluxo();
  const [inicial, setInicial] = useState<AvatarConfig | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [montado, setMontado] = useState(false);

  // O 3D só no navegador: o servidor não tem WebGL.
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    let vivo = true;
    carregarMeuAvatar()
      .then((a) => vivo && setInicial(a ?? AVATAR_EM_BRANCO))
      .catch(() => vivo && setInicial(AVATAR_EM_BRANCO));
    return () => {
      vivo = false;
    };
  }, []);

  /* Mexeu e não salvou (20/10/2026: "não deixa sair sem perguntar se quer
     salvar o avatar, senão perde tudo o que fez"). */
  const sujoRef = useRef(false);
  const atualRef = useRef<AvatarConfig | null>(null);

  const salvar = async (a: AvatarConfig): Promise<boolean> => {
    setSalvando(true);
    try {
      await salvarMeuAvatar(a);
      avisarAvatarAtualizado(a);
      sujoRef.current = false;
      setInicial(a);
      toast.success("Avatar salvo! Ele já aparece no seu Início. 👋");
      return true;
    } catch {
      toast.error("Não foi possível salvar o avatar agora.");
      return false;
    } finally {
      setSalvando(false);
    }
  };

  /** Pergunta, se houver mudança. `true` = pode sair. */
  const perguntar = async (): Promise<boolean> => {
    if (!sujoRef.current || !atualRef.current) return true;
    const r = await escolher({
      titulo: "Salvar o seu avatar?",
      descricao: "Você mexeu no avatar e ainda não salvou. Se sair agora, as mudanças se perdem.",
      confirmar: "Salvar e sair",
      cancelar: "Continuar editando",
      alternativa: "Sair sem salvar",
    });
    if (r === "nao") return false;
    if (r === "alternativa") {
      sujoRef.current = false;
      return true;
    }
    return salvar(atualRef.current);
  };
  const perguntarRef = useRef(perguntar);
  perguntarRef.current = perguntar;

  useEffect(() => {
    guardaAtual = () => perguntarRef.current();
    return () => {
      guardaAtual = null;
    };
  }, []);

  // Trocar de página pelo menu.
  useBlocker({
    shouldBlockFn: async () => !(await perguntarRef.current()),
    enableBeforeUnload: false,
  });

  // Fechar ou recarregar a aba do navegador: aí só o aviso do próprio navegador é possível.
  useEffect(() => {
    const aoSair = (e: BeforeUnloadEvent) => {
      if (!sujoRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, []);

  const carregando = (
    <div className="grid h-[calc(100vh-170px)] min-h-[460px] place-items-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o provador…
      </span>
    </div>
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Meu avatar</h2>
        <p className="text-xs text-muted-foreground">
          Monte o seu boneco: corpo, rosto, cabelo, roupa e acessórios. Ele te recebe no Início.
        </p>
      </div>
      {!montado || !inicial ? (
        carregando
      ) : (
        <Suspense fallback={carregando}>
          <EditorDeAvatar
            key={JSON.stringify(inicial)}
            inicial={inicial}
            nome={primeiroNome(currentUser.name)}
            salvando={salvando}
            aoSalvar={(a) => void salvar(a)}
            aoMudar={(sujo, atual) => {
              sujoRef.current = sujo;
              atualRef.current = atual;
            }}
            rotuloSalvar="Salvar avatar"
          />
        </Suspense>
      )}
    </section>
  );
}
