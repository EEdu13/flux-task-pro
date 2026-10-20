/*
 * painel-lateral.tsx — o painel da direita: Participantes e Cards.
 *
 * Por que existe além da sala 3D: na mesa a informação é "de relance" (selos e balões que somem
 * em 10 s). Aqui fica o que a pessoa quer CONFERIR: quem está mudo, quem está na fila, quem está
 * com a IA ou a câmera ligada (a câmera é só para gestos — o painel diz isso com todas as
 * letras) e o mural completo dos cards da reunião, com o resumo que o balão não mostra.
 */
import { useMemo, useState } from "react";
import { ArrowDown, Hand, Mic, MicOff, Trash2, X } from "lucide-react";
import { VISUAL_DO_CARD, type CardNaSala, type NaMesa, type TipoVisivel } from "../sala/tipos";

export type AbaDoPainel = "participantes" | "cards";

const hora = (t: number) =>
  new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function PainelLateral({
  aba,
  aoMudarAba,
  aoFechar,
  pessoas,
  mural,
  meuId,
  conduzo,
  aoAbaixar,
  aoApagarCard,
}: {
  aba: AbaDoPainel;
  aoMudarAba: (a: AbaDoPainel) => void;
  aoFechar: () => void;
  pessoas: NaMesa[];
  mural: CardNaSala[];
  meuId: string;
  conduzo: boolean;
  aoAbaixar: (id: string) => void;
  aoApagarCard: (id: string) => void;
}) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        {(["participantes", "cards"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => aoMudarAba(a)}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-semibold ${
              aba === a ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {a === "participantes"
              ? `Participantes (${pessoas.length})`
              : `Cards (${mural.length})`}
          </button>
        ))}
        <button
          type="button"
          onClick={aoFechar}
          className="ml-auto grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary"
          aria-label="Fechar painel"
          title="Fechar painel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {aba === "participantes" ? (
          <Participantes pessoas={pessoas} conduzo={conduzo} aoAbaixar={aoAbaixar} />
        ) : (
          <Mural mural={mural} meuId={meuId} aoApagar={aoApagarCard} />
        )}
      </div>
    </aside>
  );
}

function Participantes({
  pessoas,
  conduzo,
  aoAbaixar,
}: {
  pessoas: NaMesa[];
  conduzo: boolean;
  aoAbaixar: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {pessoas.map((p) => (
        <li key={p.id} className="rounded-lg px-2 py-1.5 hover:bg-secondary/60">
          <div className="flex items-center gap-2 text-[13px]">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${p.falando && !p.mudo ? "bg-emerald-500" : "bg-transparent"}`}
              title={p.falando && !p.mudo ? "Falando" : undefined}
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {p.nome}
              {p.eu && <span className="text-muted-foreground"> (você)</span>}
              {p.conduz && (
                <span className="ml-1.5 rounded bg-secondary px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  conduz
                </span>
              )}
            </span>
            {p.iaOuvindo && (
              <span
                className="rounded bg-[#7c3aed] px-1 py-0.5 text-[9px] font-bold uppercase text-white"
                aria-label="Cards por IA ligados"
                title="Cards por IA ligados"
              >
                IA
              </span>
            )}
            {p.posicaoNaFila && (
              // Âmbar sólido com texto escuro, igual ao ✋ da cena: o laranja translúcido
              // sobre o fundo escuro do painel quase não se lia.
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-[#f59e0b] px-1.5 py-0.5 text-[11px] font-bold text-[#1c1917]"
                title={`Mão levantada · ${p.posicaoNaFila}º da fila`}
              >
                <Hand className="h-3 w-3" /> {p.posicaoNaFila}
              </span>
            )}
            {conduzo && !p.eu && p.mao && (
              // Na mesma linha (ícone): o botão numa 2ª linha deixava a lista com alturas desiguais.
              <button
                type="button"
                onClick={() => aoAbaixar(p.id)}
                title={`Abaixar a mão de ${p.nome}`}
                aria-label={`Abaixar a mão de ${p.nome}`}
                className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md border border-[#d97706]/60 text-[#f59e0b] hover:bg-[#f59e0b]/20"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            )}
            {p.mudo ? (
              <MicOff
                className={`h-4 w-4 ${p.semMicrofone ? "text-muted-foreground" : "text-red-500"}`}
                aria-label={p.semMicrofone ? "sem microfone" : "mudo"}
              />
            ) : (
              <Mic className="h-4 w-4 text-emerald-600" aria-label="microfone ligado" />
            )}
          </div>
          {p.cameraGestos && (
            <div className="mt-1 pl-4 text-[11px] text-muted-foreground">
              📷 câmera só para gestos, não transmitida
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Mural({
  mural,
  meuId,
  aoApagar,
}: {
  mural: CardNaSala[];
  meuId: string;
  aoApagar: (id: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoVisivel | "todos">("todos");
  const [autor, setAutor] = useState<string>("todos");
  const autores = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of mural) m.set(c.autorId, c.autorNome);
    return [...m];
  }, [mural]);
  const lista = useMemo(
    () =>
      [...mural]
        .reverse()
        .filter(
          (c) =>
            (tipo === "todos" || c.card.tipo === tipo) &&
            (autor === "todos" || c.autorId === autor),
        ),
    [mural, tipo, autor],
  );

  if (!mural.length)
    return (
      <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
        Os cards da conversa aparecem aqui. Ligue "Cards por IA" na barra para a sua fala virar
        card.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoVisivel | "todos")}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[12px]"
          aria-label="Filtrar por tipo"
        >
          <option value="todos">Todos os tipos</option>
          {(Object.keys(VISUAL_DO_CARD) as TipoVisivel[]).map((t) => (
            <option key={t} value={t}>
              {VISUAL_DO_CARD[t].emoji} {VISUAL_DO_CARD[t].rotulo}
            </option>
          ))}
        </select>
        <select
          value={autor}
          onChange={(e) => setAutor(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[12px]"
          aria-label="Filtrar por autor"
        >
          <option value="todos">Todos</option>
          {autores.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </select>
      </div>
      {lista.map((c) => {
        const v = c.card.tipo === "nada" ? null : VISUAL_DO_CARD[c.card.tipo];
        return (
          <article
            key={c.id}
            className="rounded-lg border border-border bg-background p-2 text-[13px]"
            style={{ borderLeft: `4px solid ${v?.cor ?? "#94a3b8"}` }}
          >
            <div className="flex items-start gap-1.5">
              <span className="text-base leading-5">{c.card.emoji}</span>
              <span className="min-w-0 flex-1 font-semibold leading-5">{c.card.titulo}</span>
              {c.autorId === meuId && (
                <button
                  type="button"
                  onClick={() => aoApagar(c.id)}
                  className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                  aria-label="Apagar este card"
                  title="Apagar este card (some para todos)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {c.card.resumo && (
              <p className="mt-1 text-[12px] text-muted-foreground">{c.card.resumo}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>
                {v?.rotulo} · {c.autorNome} · {hora(c.chegou)}
              </span>
              {c.card.responsavel && (
                <span className="rounded bg-secondary px-1 py-0.5">👤 {c.card.responsavel}</span>
              )}
              {c.card.prazo && (
                <span className="rounded bg-secondary px-1 py-0.5">📅 {c.card.prazo}</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
