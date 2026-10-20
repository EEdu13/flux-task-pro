import { useState } from "react";
import { CalendarCheck, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import {
  dataDoEvento,
  ehErroDeMuralInativo,
  iniciaisDe,
  MSG_MURAL_INATIVO,
} from "@/lib/mural-cliente";
import type { EventoDoPost } from "@/lib/mural.functions";

/*
 * O bloco de um evento no Mural (fase 3, 14/10/2026): a folhinha com dia e
 * mês, hora e local, e o "Vou participar" com quantos vão e os rostos de
 * quem vai.
 */

const MAX_ROSTOS = 8;

export function EventoDoPost({
  postId,
  evento,
  aoMudar,
}: {
  postId: string;
  evento: EventoDoPost;
  aoMudar: (e: EventoDoPost) => void;
}) {
  const { currentUser, users } = useFluxo();
  const [salvando, setSalvando] = useState(false);
  const inicio = new Date(evento.inicio);
  const passou = inicio.getTime() < Date.now() - 12 * 3600_000;
  const vou = evento.participantes.includes(currentUser.id);

  const alternar = async () => {
    setSalvando(true);
    const antes = evento;
    aoMudar({
      ...evento,
      participantes: vou
        ? evento.participantes.filter((id) => id !== currentUser.id)
        : [...evento.participantes, currentUser.id],
    });
    try {
      const { participarDoEvento } = await import("@/lib/mural-interacoes.functions");
      const r = await participarDoEvento({ data: { postId, vou: !vou } });
      aoMudar({ ...evento, participantes: r.participantes });
    } catch (e) {
      aoMudar(antes);
      toast.error(
        ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : (e as Error)?.message || "Não deu agora.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const mes = inicio.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const nomes = evento.participantes
    .map((id) => users.find((u) => u.id === id)?.name)
    .filter((n): n is string => !!n);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3">
      <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-card text-center shadow-sm">
        <span className="w-full bg-sky-600 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {mes}
        </span>
        <span className="font-display text-xl font-bold leading-tight">{inicio.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium capitalize">{dataDoEvento(evento.inicio)}</div>
        {evento.local && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{evento.local}</span>
          </div>
        )}
        {evento.participantes.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2" title={nomes.join(", ")}>
            <div className="flex -space-x-2">
              {evento.participantes.slice(0, MAX_ROSTOS).map((id) => {
                const u = users.find((x) => x.id === id);
                const nome = u?.name ?? "Alguém";
                return (
                  <UserAvatar
                    key={id}
                    nome={nome}
                    iniciais={u?.avatar ?? iniciaisDe(nome)}
                    className="h-6 w-6 text-[8px] ring-2 ring-card"
                  />
                );
              })}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {evento.participantes.length === 1
                ? `${nomeCurto(nomes[0] ?? "1 pessoa")} vai`
                : `${evento.participantes.length} vão`}
            </span>
          </div>
        )}
      </div>
      {!passou ? (
        <button
          type="button"
          onClick={() => void alternar()}
          disabled={salvando}
          aria-pressed={vou}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            vou
              ? "bg-success/15 text-success hover:bg-success/25"
              : "bg-sky-600 text-white shadow-sm hover:brightness-110"
          }`}
        >
          {salvando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CalendarCheck className="h-3.5 w-3.5" />
          )}
          {vou ? "Vou participar ✓" : "Vou participar"}
        </button>
      ) : (
        <span className="text-[11px] font-medium text-muted-foreground">Já aconteceu</span>
      )}
    </div>
  );
}
