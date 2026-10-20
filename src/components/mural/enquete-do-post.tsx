import { useState } from "react";
import { Check, Loader2, Lock, Vote } from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { ehErroDeMuralInativo, MSG_MURAL_INATIVO } from "@/lib/mural-cliente";
import type { EnqueteDoPost } from "@/lib/mural.functions";

/*
 * A enquete de um post do Mural (fase 3, 14/10/2026): de 2 a 6 opções, uma
 * escolha por pessoa. Antes de votar, as opções são botões; depois de votar
 * (ou com a enquete encerrada), viram barras com a porcentagem e a contagem,
 * com a sua escolha marcada. Dá para trocar o voto enquanto estiver aberta.
 * Quem publicou (e a gerência) pode encerrar. Ninguém vê quem votou no quê.
 */

const erroAmigavel = (e: unknown, padrao: string) =>
  ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : (e as Error)?.message || padrao;

export function EnqueteDoPost({
  postId,
  enquete,
  podeEncerrar,
  aoMudar,
}: {
  postId: string;
  enquete: EnqueteDoPost;
  podeEncerrar: boolean;
  aoMudar: (e: EnqueteDoPost) => void;
}) {
  const [votando, setVotando] = useState<number | null>(null);
  const [trocando, setTrocando] = useState(false);
  const votei = enquete.meuVoto !== null;
  const mostrarResultado = (votei && !trocando) || enquete.fechada;

  const votar = async (ordem: number) => {
    if (votando !== null || enquete.fechada) return;
    if (ordem === enquete.meuVoto) {
      setTrocando(false);
      return;
    }
    setVotando(ordem);
    try {
      const { votarNaEnquete } = await import("@/lib/mural-interacoes.functions");
      const r = await votarNaEnquete({ data: { postId, ordem } });
      aoMudar({ ...enquete, opcoes: r.opcoes, total: r.total, meuVoto: r.meuVoto });
      setTrocando(false);
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível votar agora."));
    } finally {
      setVotando(null);
    }
  };

  const encerrar = async () => {
    const ok = await confirmar({
      titulo: "Encerrar esta enquete?",
      descricao: "Ninguém mais vota; o resultado fica à vista de todos.",
      confirmar: "Encerrar",
    });
    if (!ok) return;
    try {
      const { encerrarEnquete } = await import("@/lib/mural-interacoes.functions");
      await encerrarEnquete({ data: { postId } });
      aoMudar({ ...enquete, fechada: true });
      toast.success("Enquete encerrada.");
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível encerrar."));
    }
  };

  const maior = Math.max(0, ...enquete.opcoes.map((o) => o.votos));
  const rodape = enquete.fechada
    ? "Encerrada"
    : enquete.fim
      ? `Aberta até ${new Date(enquete.fim).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "Aberta";

  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/20 p-3">
      <ul className="space-y-1.5">
        {enquete.opcoes.map((o) => {
          const pct = enquete.total ? Math.round((o.votos / enquete.total) * 100) : 0;
          const minha = enquete.meuVoto === o.ordem;
          if (mostrarResultado) {
            const vencedora = enquete.fechada && o.votos > 0 && o.votos === maior;
            return (
              <li
                key={o.ordem}
                className="relative overflow-hidden rounded-md border border-border/70 bg-background"
              >
                <div
                  className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${
                    minha ? "bg-primary/25" : vencedora ? "bg-success/20" : "bg-secondary"
                  }`}
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-2 px-3 py-1.5 text-sm">
                  {minha && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className={`min-w-0 flex-1 truncate ${minha ? "font-semibold" : ""}`}>
                    {o.texto}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs font-semibold">{pct}%</span>
                  <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {o.votos}
                  </span>
                </div>
              </li>
            );
          }
          return (
            <li key={o.ordem}>
              <button
                type="button"
                onClick={() => void votar(o.ordem)}
                disabled={votando !== null}
                className={`flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60 ${
                  minha ? "border-primary/60 bg-primary/10" : "border-border bg-background"
                }`}
              >
                {votando === o.ordem ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                      minha ? "border-primary bg-primary" : "border-muted-foreground/50"
                    }`}
                  />
                )}
                <span className="min-w-0 flex-1">{o.texto}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {enquete.fechada ? <Lock className="h-3 w-3" /> : <Vote className="h-3 w-3" />}
          {enquete.total} {enquete.total === 1 ? "voto" : "votos"} · {rodape}
        </span>
        {!enquete.fechada && votei && !trocando && (
          <button
            type="button"
            onClick={() => setTrocando(true)}
            className="font-medium text-primary hover:underline"
          >
            Trocar voto
          </button>
        )}
        {!enquete.fechada && trocando && (
          <button
            type="button"
            onClick={() => setTrocando(false)}
            className="font-medium hover:underline"
          >
            Ver resultado
          </button>
        )}
        {!enquete.fechada && podeEncerrar && (
          <button
            type="button"
            onClick={() => void encerrar()}
            className="ml-auto font-medium hover:text-foreground hover:underline"
          >
            Encerrar enquete
          </button>
        )}
      </div>
    </div>
  );
}
