import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { VISUAL_DO_CARD, type TipoVisivel } from "../sala/tipos";
import type { ItemDaBandeja } from "./use-cards-de-fala";

/**
 * "Seus cards": o que a IA fez da MINHA fala. Sobre o meu avatar não aparece
 * balão (eu não preciso ler o que acabei de dizer), mas eu preciso saber o que
 * os outros estão lendo — e poder desfazer um card que saiu errado.
 *
 * Os 3 mais novos, compactos. "Desfazer" vale por 15 s depois de publicado
 * (depois disso ele continua no mural, de onde o autor também apaga). O "não
 * publicado" fica 5 s em cinza só para a pessoa entender por que nada apareceu,
 * e some. Posicionada pelo integrador.
 */

const DESFAZER_MS = 15_000;
const NAO_PUBLICADO_MS = 5_000;
const VISIVEIS = 3;

export function BandejaDeCards({
  itens,
  aoApagar,
  className,
}: {
  itens: ItemDaBandeja[];
  aoApagar: (id: string) => void;
  className?: string;
}) {
  const [verTodos, setVerTodos] = useState(false);
  /* Relógio de 1 s só enquanto há algo que expira (Desfazer ou não-publicado).
     O estado é só o "tique" que redesenha; a hora é lida na renderização —
     guardar a hora no estado mostrava "Desfazer · 26s" no primeiro segundo. */
  const [, setTique] = useState(0);
  const agora = Date.now();
  const temRelogio = itens.some(
    (i) => i.situacao === "publicado" || i.situacao === "nao-publicado",
  );
  useEffect(() => {
    if (!temRelogio) return;
    const id = window.setInterval(() => setTique((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [temRelogio]);

  /* "Quando" de cada item é o `at` (início da fala); a contagem do Desfazer e
     do sumiço parte de quando o item mudou de situação — guardado aqui. */
  const [mudouEm, setMudouEm] = useState<Record<string, { situacao: string; t: number }>>({});
  useEffect(() => {
    setMudouEm((antes) => {
      let mudou = false;
      const novo: typeof antes = {};
      for (const i of itens) {
        const a = antes[i.id];
        if (a && a.situacao === i.situacao) novo[i.id] = a;
        else {
          novo[i.id] = { situacao: i.situacao, t: Date.now() };
          mudou = true;
        }
      }
      return mudou || Object.keys(antes).length !== itens.length ? novo : antes;
    });
  }, [itens]);

  // Situação recém-mudada ainda não registrada (o efeito roda depois): conta de agora.
  const desde = (i: ItemDaBandeja) => {
    const m = mudouEm[i.id];
    return m && m.situacao === i.situacao ? m.t : agora;
  };
  const mostrar = itens.filter((i) => {
    if (i.situacao === "descartado" || i.situacao === "apagado") return false;
    if (i.situacao === "nao-publicado") return agora - desde(i) < NAO_PUBLICADO_MS;
    return true;
  });
  if (mostrar.length === 0) return null;
  const lista = verTodos ? mostrar : mostrar.slice(0, VISIVEIS);

  return (
    <div
      className={cn(
        "pointer-events-auto w-64 rounded-xl bg-black/55 p-2 text-white shadow-lg backdrop-blur-sm",
        className,
      )}
      aria-label="Seus cards"
    >
      <div className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide text-white/70">
        <span>Seus cards</span>
        {mostrar.length > VISIVEIS && (
          <button
            type="button"
            className="cursor-pointer normal-case tracking-normal text-white/80 underline-offset-2 hover:underline"
            onClick={() => setVerTodos((v) => !v)}
          >
            {verTodos ? "ver menos" : `ver todos (${mostrar.length})`}
          </button>
        )}
      </div>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {lista.map((i) => (
          <ItemDaLista key={i.id} item={i} desde={desde(i)} agora={agora} aoApagar={aoApagar} />
        ))}
      </ul>
    </div>
  );
}

function ItemDaLista({
  item,
  desde,
  agora,
  aoApagar,
}: {
  item: ItemDaBandeja;
  desde: number;
  agora: number;
  aoApagar: (id: string) => void;
}) {
  if (item.situacao === "pensando") {
    return (
      <li className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1.5 text-[13px]">
        <span aria-hidden>💭</span>
        <span>pensando</span>
        <span className="rv-pontos flex gap-0.5" aria-label="pensando">
          <i className="h-1 w-1 rounded-full bg-white/80 [animation:rv-ponto_1s_infinite]" />
          <i className="h-1 w-1 rounded-full bg-white/80 [animation:rv-ponto_1s_.2s_infinite]" />
          <i className="h-1 w-1 rounded-full bg-white/80 [animation:rv-ponto_1s_.4s_infinite]" />
        </span>
        <style>{`@keyframes rv-ponto{0%,80%,100%{opacity:.25}40%{opacity:1}}@media (prefers-reduced-motion:reduce){.rv-pontos i{animation:none!important;opacity:.7}}`}</style>
      </li>
    );
  }

  const card = item.card;
  const tipo = card && card.tipo !== "nada" ? (card.tipo as TipoVisivel) : null;
  const cor = tipo ? VISUAL_DO_CARD[tipo].cor : "#6b7280";

  if (item.situacao === "nao-publicado") {
    return (
      <li
        className="rounded-lg bg-white/5 px-2 py-1.5 text-[12px] text-white/55"
        title={item.ouvido ? `Ouvido: ${item.ouvido}` : undefined}
      >
        <div className="truncate">
          {card?.emoji ?? "💬"} {card?.titulo || "Fala sem card"}
        </div>
        <div className="text-[11px]">Não publicado (IA achou pouco relevante)</div>
      </li>
    );
  }

  // publicado
  const resta = Math.ceil((DESFAZER_MS - (agora - desde)) / 1000);
  return (
    <li
      className="flex items-center gap-2 rounded-lg bg-white/95 px-2 py-1.5 text-[13px] text-slate-900"
      style={{ borderLeft: `4px solid ${cor}` }}
      title={card?.resumo || undefined}
    >
      <span aria-hidden className="text-base leading-none">
        {card?.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{card?.titulo}</div>
        <div className="text-[11px] text-slate-500">Publicado</div>
      </div>
      {resta > 0 && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-md border border-slate-300 px-1.5 py-0.5 text-[11px] font-medium hover:bg-slate-100"
          onClick={() => aoApagar(item.id)}
          aria-label={`Desfazer o card ${card?.titulo ?? ""}`}
        >
          Desfazer · {resta}s
        </button>
      )}
    </li>
  );
}
