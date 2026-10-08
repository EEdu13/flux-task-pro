import { useMemo, useState } from "react";
import { Repeat, Users } from "lucide-react";
import type { User } from "@/lib/fluxo-types";
import { statusColor, statusLabels } from "@/lib/fluxo-types";
import { dataParaIso } from "@/lib/data-iso";
import { nomeCurto } from "@/lib/nome-curto";
import { idReal, type TarefaNoCalendario } from "@/lib/ocorrencias-previstas";

/**
 * A visão em linhas do calendário: uma linha por tarefa, os dias em colunas e
 * a barra cobrindo do dia em que a tarefa nasceu até o prazo — a linha do
 * tempo que toda ferramenta de controle de tarefas tem.
 *
 * Tarefa recorrente não é uma barra comprida: é um bloco em cada dia em que
 * ela acontece, reais e previstos juntos numa linha só. Sem juntar, o
 * compromisso diário do pack viraria uma linha por dia já concluído.
 */

type Linha = {
  chave: string;
  titulo: string;
  /** A tarefa que abre ao clicar no título: a em aberto, se houver. */
  abrir: string;
  responsavel: string;
  recorrente: boolean;
  status: TarefaNoCalendario["status"];
  minha: boolean;
  atrasada: boolean;
  /** Recorrente: os dias, cada um com a pílula que abre. */
  dias: { idx: number; id: string; prevista: boolean; concluida: boolean }[];
  /** Não recorrente: a barra, em índices de coluna já recortados. */
  barra: { de: number; ate: number; cortadaAntes: boolean; cortadaDepois: boolean } | null;
};

export function CalendarioLinhas({
  tarefas,
  users,
  euId,
  corMinhas,
  diasPintados,
  inicio,
  dias,
  onTaskClick,
  onDiaContexto,
}: {
  tarefas: TarefaNoCalendario[];
  users: User[];
  euId: string;
  /** Cor CSS que destaca as minhas tarefas. */
  corMinhas: string;
  /** Os dias pintados pela pessoa: "yyyy-MM-dd" → cor. */
  diasPintados: Record<string, string>;
  /** Primeiro dia da faixa, à meia-noite. */
  inicio: Date;
  dias: number;
  onTaskClick: (id: string) => void;
  /** Botão direito no dia do cabeçalho: o menu do dia, que pinta a coluna. */
  onDiaContexto?: (x: number, y: number, iso: string) => void;
}) {
  const [executante, setExecutante] = useState<string | null>(null);

  const colunas = useMemo(
    () =>
      Array.from({ length: dias }, (_, i) => {
        const d = new Date(inicio);
        d.setDate(inicio.getDate() + i);
        return d;
      }),
    [inicio, dias],
  );
  const isoDe = useMemo(() => colunas.map(dataParaIso), [colunas]);
  const hojeIso = dataParaIso(new Date());
  const hojeIdx = isoDe.indexOf(hojeIso);

  const nomeDe = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.name]));
    return (id: string) => m.get(id) ?? "Sem responsável";
  }, [users]);

  const { grupos, pessoas } = useMemo(() => {
    const primeiro = isoDe[0]!;
    const ultimo = isoDe[isoDe.length - 1]!;
    const idxDoDia = new Map(isoDe.map((iso, i) => [iso, i]));
    const porChave = new Map<string, Linha>();

    for (const t of tarefas) {
      if (!t.dueDate) continue;
      const prazoIso = dataParaIso(new Date(t.dueDate));
      const prevista = !!t.prevista;
      const concluida = t.status === "concluida";
      const atrasada = !concluida && !prevista && prazoIso < hojeIso;

      if (t.recurring) {
        const chave = `r|${t.assigneeId}|${t.title.trim().toLowerCase()}`;
        let l = porChave.get(chave);
        if (!l) {
          l = {
            chave,
            titulo: t.title,
            abrir: idReal(t.id),
            responsavel: t.assigneeId,
            recorrente: true,
            status: t.status,
            minha: t.assigneeId === euId,
            atrasada: false,
            dias: [],
            barra: null,
          };
          porChave.set(chave, l);
        }
        // A que abre é a da vez: a em aberto ganha da concluída.
        if (!prevista && !concluida) {
          l.abrir = t.id;
          l.status = t.status;
        }
        l.atrasada ||= atrasada;
        const idx = idxDoDia.get(prazoIso);
        if (idx !== undefined) l.dias.push({ idx, id: t.id, prevista, concluida });
        continue;
      }

      // Barra do nascimento ao prazo. Criada depois do prazo (prazo no
      // passado escolhido à mão): a barra fica só no dia do prazo.
      let nasceuIso = t.createdAt ? dataParaIso(new Date(t.createdAt)) : prazoIso;
      if (nasceuIso > prazoIso) nasceuIso = prazoIso;
      if (prazoIso < primeiro || nasceuIso > ultimo) continue;
      const de = nasceuIso < primeiro ? 0 : idxDoDia.get(nasceuIso)!;
      const ate = prazoIso > ultimo ? isoDe.length - 1 : idxDoDia.get(prazoIso)!;
      porChave.set(t.id, {
        chave: t.id,
        titulo: t.title,
        abrir: t.id,
        responsavel: t.assigneeId,
        recorrente: false,
        status: t.status,
        minha: t.assigneeId === euId,
        atrasada,
        dias: [],
        barra: { de, ate, cortadaAntes: nasceuIso < primeiro, cortadaDepois: prazoIso > ultimo },
      });
    }

    const linhas = [...porChave.values()].filter((l) => l.barra || l.dias.length > 0);
    const pessoas = [...new Set(linhas.map((l) => l.responsavel))].sort((a, b) =>
      a === euId ? -1 : b === euId ? 1 : nomeDe(a).localeCompare(nomeDe(b), "pt-BR"),
    );
    const visiveis = executante ? linhas.filter((l) => l.responsavel === executante) : linhas;
    const inicioDe = (l: Linha) => l.barra?.de ?? Math.min(...l.dias.map((d) => d.idx));
    const grupos = pessoas
      .filter((p) => !executante || p === executante)
      .map((p) => ({
        pessoa: p,
        linhas: visiveis
          .filter((l) => l.responsavel === p)
          .sort((a, b) => inicioDe(a) - inicioDe(b) || a.titulo.localeCompare(b.titulo, "pt-BR")),
      }))
      .filter((g) => g.linhas.length > 0);
    return { grupos, pessoas };
  }, [tarefas, isoDe, hojeIso, euId, executante, nomeDe]);

  const molde = `minmax(14rem, 18rem) repeat(${dias}, minmax(2.25rem, 1fr))`;
  const pintado = (i: number) => {
    const cor = isoDe[i] ? diasPintados[isoDe[i]] : undefined;
    return cor ? `color-mix(in oklab, ${cor} 28%, transparent)` : undefined;
  };
  const corDa = (l: Pick<Linha, "minha" | "status">) =>
    l.minha ? corMinhas : statusColor[l.status as keyof typeof statusColor];

  return (
    <div className="mt-4 space-y-3">
      {pessoas.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Executante">
          <span className="mr-1 inline-flex items-center gap-1 text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Executante:
          </span>
          <button
            type="button"
            aria-pressed={executante === null}
            onClick={() => setExecutante(null)}
            className={`rounded-full border px-2.5 py-1 transition ${
              executante === null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:bg-secondary"
            }`}
          >
            Todos
          </button>
          {pessoas.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={executante === p}
              onClick={() => setExecutante(executante === p ? null : p)}
              className={`rounded-full border px-2.5 py-1 transition ${
                executante === p
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-secondary"
              }`}
            >
              {p === euId ? "Eu" : nomeCurto(nomeDe(p))}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="min-w-max" style={{ minWidth: "100%" }}>
          {/* Cabeçalho dos dias */}
          <div
            className="sticky top-0 z-10 grid border-b border-border bg-secondary/60"
            style={{ gridTemplateColumns: molde }}
          >
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tarefa
            </div>
            {colunas.map((d, i) => (
              <div
                key={i}
                onContextMenu={(e) => {
                  if (!onDiaContexto) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onDiaContexto(e.clientX, e.clientY, isoDe[i]!);
                }}
                title="Botão direito: pintar o dia"
                className={`cursor-context-menu border-l border-border py-1.5 text-center leading-tight ${
                  i === hojeIdx ? "bg-primary/10 text-primary" : "text-muted-foreground"
                }`}
                // A coluna pintada começa no cabeçalho, para se ver de longe qual dia é.
                style={{ background: pintado(i) }}
              >
                <div className="text-[9px] uppercase">
                  {d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                </div>
                <div className="text-xs font-semibold tabular-nums">{d.getDate()}</div>
              </div>
            ))}
          </div>

          {grupos.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa com prazo neste período.
            </div>
          )}

          {grupos.map((g) => (
            <div key={g.pessoa}>
              <div className="border-b border-border bg-secondary/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.pessoa === euId ? "Minhas tarefas" : nomeCurto(nomeDe(g.pessoa))}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {g.linhas.length} {g.linhas.length === 1 ? "tarefa" : "tarefas"}
                </span>
              </div>
              {g.linhas.map((l) => (
                <div
                  key={l.chave}
                  className="grid border-b border-border last:border-b-0"
                  style={{ gridTemplateColumns: molde }}
                >
                  <button
                    type="button"
                    onClick={() => onTaskClick(l.abrir)}
                    className="flex min-w-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/50"
                    title={`${l.titulo} · ${statusLabels[l.status as keyof typeof statusLabels]}`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: corDa(l) }}
                      aria-hidden
                    />
                    <span className={`truncate ${l.minha ? "font-semibold" : ""}`}>{l.titulo}</span>
                    {l.recorrente && (
                      <Repeat className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Recorrente" />
                    )}
                    {l.atrasada && (
                      <span className="shrink-0 rounded bg-destructive/15 px-1 text-[9px] font-semibold text-destructive">
                        atrasada
                      </span>
                    )}
                  </button>

                  {/* A pista: as linhas dos dias e, por cima, a barra ou os blocos. */}
                  <div
                    className="relative grid"
                    style={{
                      gridColumn: `2 / span ${dias}`,
                      gridTemplateColumns: `repeat(${dias}, minmax(2.25rem, 1fr))`,
                    }}
                  >
                    {colunas.map((_, i) => (
                      <div
                        key={i}
                        className={`border-l border-border ${i === hojeIdx ? "bg-primary/5" : ""}`}
                        style={{ gridColumn: i + 1, gridRow: 1, background: pintado(i) }}
                        aria-hidden
                      />
                    ))}
                    {l.barra && (
                      <button
                        type="button"
                        onClick={() => onTaskClick(l.abrir)}
                        title={l.titulo}
                        className={`relative z-[1] my-1.5 flex min-w-0 items-center overflow-hidden px-2 text-[10px] font-medium text-white shadow-sm transition hover:brightness-110 ${
                          l.barra.cortadaAntes ? "rounded-l-none" : "rounded-l-md"
                        } ${l.barra.cortadaDepois ? "rounded-r-none" : "rounded-r-md"} ${
                          l.atrasada ? "ring-2 ring-destructive" : ""
                        } ${l.status === "concluida" ? "opacity-60" : ""}`}
                        style={{
                          gridColumn: `${l.barra.de + 1} / ${l.barra.ate + 2}`,
                          gridRow: 1,
                          background: corDa(l),
                        }}
                      >
                        <span className="truncate drop-shadow-sm">{l.titulo}</span>
                      </button>
                    )}
                    {l.dias.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => onTaskClick(idReal(d.id))}
                        title={`${l.titulo}${d.prevista ? " · prevista" : d.concluida ? " · concluída" : ""}`}
                        aria-label={`${l.titulo}, ${isoDe[d.idx]}${d.prevista ? ", prevista" : ""}`}
                        className={`relative z-[1] mx-0.5 my-1.5 rounded-md transition hover:brightness-110 ${
                          d.prevista ? "border-2 border-dashed bg-transparent" : ""
                        } ${d.concluida ? "opacity-50" : ""}`}
                        style={{
                          gridColumn: d.idx + 1,
                          gridRow: 1,
                          ...(d.prevista
                            ? { borderColor: corDa(l) }
                            : { background: corDa(l) }),
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        A barra vai do dia em que a tarefa foi criada até o prazo. Nas recorrentes, cada bloco é um
        dia em que ela acontece; o tracejado é uma ocorrência prevista.
        <span className="ml-1 inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: corMinhas }} /> minhas
          tarefas
        </span>
      </p>
    </div>
  );
}
