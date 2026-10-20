/*
 * cabecalho.tsx — a linha de 44 px no topo da Realidade Virtual.
 *
 * Uma linha só (o h1 grande e o subtítulo saíram): na sala, cada pixel de altura é da mesa.
 * Fora da sala (editor, antessala) aparece só o título; na sala ganha o "N na sala", a tela
 * cheia e o atalho para o editor de avatar.
 */
import { Glasses, Maximize, Pencil, Users } from "lucide-react";

export function CabecalhoRv({
  quantos,
  aoTelaCheia,
  aoAvatar,
}: {
  /** Na sala: quantas pessoas. Fora: undefined (só o título). */
  quantos?: number;
  aoTelaCheia?: () => void;
  aoAvatar?: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
        <Glasses className="h-4 w-4" />
      </span>
      <h1 className="text-[15px] font-semibold tracking-tight">Realidade Virtual</h1>
      {quantos !== undefined && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
          <Users className="h-3.5 w-3.5" /> {quantos} na sala
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        {aoTelaCheia && (
          <button
            type="button"
            onClick={aoTelaCheia}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
          >
            <Maximize className="h-3.5 w-3.5" /> Tela cheia
          </button>
        )}
        {aoAvatar && (
          <button
            type="button"
            onClick={aoAvatar}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
          >
            <Pencil className="h-3.5 w-3.5" /> Avatar
          </button>
        )}
      </span>
    </header>
  );
}
