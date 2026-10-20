import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { iniciaisDe } from "@/lib/mural-cliente";
import type { LeiturasDoComunicado } from "@/lib/mural.functions";

/*
 * "Lido por N de M" (Mural, 14/10/2026): quem marcou "Li e estou ciente" e
 * quem ainda falta. Só o autor do comunicado e a gerência abrem — o servidor
 * confere.
 */
export function LeiturasDoComunicadoDialog({
  postId,
  titulo,
  aoFechar,
}: {
  postId: string;
  titulo: string;
  aoFechar: () => void;
}) {
  useEscFecha(true, aoFechar);
  const { users } = useFluxo();
  const [dados, setDados] = useState<LeiturasDoComunicado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"faltam" | "lidos">("faltam");

  useEffect(() => {
    let vivo = true;
    import("@/lib/mural.functions")
      .then(({ leiturasDoComunicado }) => leiturasDoComunicado({ data: { postId } }))
      .then((r) => {
        if (!vivo) return;
        setDados(r);
        if (r.faltam.length === 0) setAba("lidos");
      })
      .catch(
        (e: unknown) => vivo && setErro((e as Error)?.message || "Não foi possível carregar."),
      );
    return () => {
      vivo = false;
    };
  }, [postId]);

  const pessoa = (id: string, nome: string) => {
    const u = users.find((x) => x.id === id);
    return (
      <UserAvatar
        nome={u?.name ?? nome}
        iniciais={u?.avatar ?? iniciaisDe(nome)}
        className="h-7 w-7 text-[9px]"
      />
    );
  };

  return (
    <div
      className="fixed inset-0 z-[400] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leituras do comunicado"
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Leituras do comunicado
            </div>
            <h2 className="truncate text-sm font-semibold">{titulo}</h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!dados && !erro && (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}
        {erro && <p className="p-6 text-sm text-destructive">{erro}</p>}

        {dados && (
          <>
            <div className="flex gap-1 border-b border-border px-3 pt-2">
              {(
                [
                  { id: "faltam", rotulo: `Faltam (${dados.faltam.length})`, icone: Clock },
                  { id: "lidos", rotulo: `Leram (${dados.lidos.length})`, icone: CheckCircle2 },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAba(t.id)}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${
                    aba === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icone className="h-3.5 w-3.5" /> {t.rotulo}
                  {aba === t.id && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
            <ul className="flex-1 divide-y divide-border/60 overflow-y-auto p-2">
              {aba === "faltam" &&
                (dados.faltam.length === 0 ? (
                  <li className="p-6 text-center text-sm text-muted-foreground">
                    Todo mundo já leu. 🎉
                  </li>
                ) : (
                  dados.faltam.map((p) => (
                    <li key={p.id} className="flex items-center gap-2.5 px-2 py-1.5">
                      {pessoa(p.id, p.nome)}
                      <span className="truncate text-sm">{p.nome}</span>
                    </li>
                  ))
                ))}
              {aba === "lidos" &&
                (dados.lidos.length === 0 ? (
                  <li className="p-6 text-center text-sm text-muted-foreground">
                    Ninguém marcou ainda.
                  </li>
                ) : (
                  dados.lidos.map((p) => (
                    <li key={p.id} className="flex items-center gap-2.5 px-2 py-1.5">
                      {pessoa(p.id, p.nome)}
                      <span className="min-w-0 flex-1 truncate text-sm">{p.nome}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {new Date(p.em).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))
                ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
