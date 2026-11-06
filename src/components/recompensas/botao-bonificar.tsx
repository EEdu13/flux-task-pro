import { useEffect, useRef, useState } from "react";
import { BadgeDollarSign, Check, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { brl, useSouDonoDasRecompensas } from "@/lib/use-recompensas";
import type { ValorDaTarefa } from "@/lib/recompensas.functions";

/**
 * O "dinheirinho" no topo da tarefa — só para o dono do teste de recompensas.
 *
 * Tarefa dele: mostra quanto ela vale (padrão R$ 8, ou R$ 15 se for módulo
 * "N/M") e deixa trocar para 3/8/15 ou tirar do cálculo.
 * Tarefa criada por eles: BONIFICAR com 2/5/10, ou tirar a bonificação.
 *
 * Não aparece em tarefa de quem não participa, nem em item de pack (o pack tem
 * regra própria). Não grava histórico nem avisa ninguém.
 */
export function BotaoBonificar({ tarefaId }: { tarefaId: string }) {
  const souDono = useSouDonoDasRecompensas();
  const [info, setInfo] = useState<ValorDaTarefa | null>(null);
  const [aberto, setAberto] = useState(false);
  const [gravando, setGravando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!souDono) return;
    let vivo = true;
    void import("@/lib/recompensas.functions")
      .then(({ valorDaTarefa }) => valorDaTarefa({ data: { tarefaId } }))
      .then((r) => vivo && setInfo(r))
      .catch(() => vivo && setInfo(null));
    return () => {
      vivo = false;
    };
  }, [souDono, tarefaId]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  if (!souDono || !info?.participa) return null;

  const definir = async (valor: number | null) => {
    setGravando(true);
    try {
      const { definirValorDaTarefa } = await import("@/lib/recompensas.functions");
      await definirValorDaTarefa({ data: { tarefaId, valor } });
      const escolhido = valor;
      const novo = escolhido ?? info.padrao;
      setInfo({ ...info, escolhido, valor: novo });
      setAberto(false);
      toast.success(
        novo > 0
          ? info.doDono
            ? `Tarefa vale ${brl(novo)}`
            : `Bonificada: ${brl(novo)}`
          : info.doDono
            ? "Tarefa fora do cálculo"
            : "Bonificação retirada",
      );
    } catch (e) {
      toast.error("Não deu para gravar o valor.", { description: (e as Error)?.message });
    } finally {
      setGravando(false);
    }
  };

  const vale = info.valor > 0;
  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={info.doDono ? "Quanto esta tarefa vale (só você vê)" : "Bonificar (só você vê)"}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
          vale
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
            : "border-border text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-300"
        }`}
      >
        {gravando ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <BadgeDollarSign className="h-3.5 w-3.5" />
        )}
        {vale ? brl(info.valor) : info.doDono ? "R$ 0" : "Bonificar"}
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-border bg-card p-2 shadow-xl">
          <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {info.doDono ? "Quanto vale" : "Bonificar"} · só você vê
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {info.opcoes.map((v) => {
              const atual = info.valor === v;
              return (
                <button
                  key={v}
                  type="button"
                  disabled={gravando}
                  onClick={() => void definir(info.doDono && v === info.padrao ? null : v)}
                  className={`flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-sm font-bold transition ${
                    atual
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                  }`}
                >
                  {atual && <Check className="h-3 w-3" />}
                  {v}
                </button>
              );
            })}
          </div>
          {info.doDono && info.escolhido !== null && info.escolhido !== 0 && (
            <button
              type="button"
              disabled={gravando}
              onClick={() => void definir(null)}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              <RotateCcw className="h-3 w-3" /> Voltar ao padrão ({brl(info.padrao)})
            </button>
          )}
          {vale && (
            <button
              type="button"
              disabled={gravando}
              onClick={() => void definir(info.doDono ? 0 : null)}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              <X className="h-3 w-3" /> {info.doDono ? "Não contar esta tarefa" : "Tirar bonificação"}
            </button>
          )}
          {info.doDono && info.escolhido === 0 && (
            <button
              type="button"
              disabled={gravando}
              onClick={() => void definir(null)}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              <RotateCcw className="h-3 w-3" /> Voltar a contar ({brl(info.padrao)})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
