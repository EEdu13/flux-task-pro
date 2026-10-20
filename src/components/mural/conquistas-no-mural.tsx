import { useEffect, useState } from "react";
import { Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";

/*
 * "Conquistas no Mural" (Configurações → Perfil, fase 2 — 14/10/2026): o
 * Mural publica sozinho algumas coisas boas — pack fechado vários dias
 * seguidos, recorde pessoal, primeira tarefa concluída, tempo de casa,
 * boas-vindas. Só coisas boas, nunca nota baixa; mesmo assim, quem preferir
 * não aparecer desliga aqui (vale para as próximas publicações).
 */
export function ConquistasNoMural() {
  const [carregando, setCarregando] = useState(true);
  const [participar, setParticipar] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    import("@/lib/mural-interacoes.functions")
      .then(({ minhasConquistasNoMural }) => minhasConquistasNoMural())
      .then((r) => vivo && setParticipar(r.participar))
      .catch((e: unknown) => console.warn("[mural] conquistas:", (e as Error)?.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const mudar = async (valor: boolean) => {
    const antes = participar;
    setParticipar(valor);
    setSalvando(true);
    try {
      const { salvarConquistasNoMural } = await import("@/lib/mural-interacoes.functions");
      await salvarConquistasNoMural({ data: { participar: valor } });
      toast.success(
        valor
          ? "Combinado! Suas conquistas vão aparecer no Mural 🎉"
          : "Combinado, suas conquistas não vão mais aparecer no Mural.",
      );
    } catch (e) {
      setParticipar(antes);
      toast.error("Não foi possível salvar agora.", { description: (e as Error)?.message });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-300">
          <PartyPopper className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Conquistas no Mural</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            O Mural comemora sozinho coisas boas: pack em dia vários dias seguidos, recorde de
            tarefas num dia, primeira tarefa concluída, tempo de casa e boas-vindas. Nunca mostra
            nota baixa.
          </p>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm">
        {carregando || salvando ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <input
            type="checkbox"
            checked={participar}
            onChange={(e) => void mudar(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
        )}
        Aparecer nas conquistas automáticas do Mural
      </label>
    </section>
  );
}
