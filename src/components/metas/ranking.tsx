import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Crown, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { scoreBarColor, scoreTextClass } from "@/lib/score";
import { SEM_PRAZO, rotuloDoPrazo } from "@/lib/prazo";
import type { Contagem, Fatia, TaskScore, UserScore } from "./calculo";
import { Avatar, MiniScore } from "./graficos";
import { fmtPontos, leituraDoScore, nomeDoSetor, porScore } from "./formato";

/*
 * Pódio + ranking da aba Metas & Score (13/10/2026). Cada linha mostra o que
 * compõe o score — no prazo, com atraso (½ ponto), pendentes e perdidas — e a
 * minilinha do score dia a dia. Clicar abre o detalhamento das tarefas.
 */

type Ordem = "score" | "pontos" | "atrasadas" | "pendentes" | "perdidas" | "nome";

const ORDENS: { id: Ordem; rotulo: string }[] = [
  { id: "score", rotulo: "Score" },
  { id: "pontos", rotulo: "Pontos" },
  { id: "perdidas", rotulo: "Perdidas" },
  { id: "atrasadas", rotulo: "Com atraso" },
  { id: "pendentes", rotulo: "Pendentes" },
  { id: "nome", rotulo: "Nome" },
];

function ordenar(lista: UserScore[], ordem: Ordem): UserScore[] {
  const r = [...lista];
  const desempate = (a: UserScore, b: UserScore) => porScore(a, b);
  switch (ordem) {
    case "pontos":
      return r.sort((a, b) => b.points - a.points || desempate(a, b));
    case "atrasadas":
      return r.sort((a, b) => b.late - a.late || desempate(a, b));
    case "pendentes":
      return r.sort((a, b) => b.pending - a.pending || desempate(a, b));
    case "perdidas":
      return r.sort((a, b) => b.missed - a.missed || desempate(a, b));
    case "nome":
      return r.sort((a, b) => a.user.name.localeCompare(b.user.name, "pt-BR"));
    default:
      return r.sort(porScore);
  }
}

/* ————— Pódio ————— */

const MEDALHAS = [
  { cor: "var(--color-warning)", altura: "h-24", avatar: "h-16 w-16 text-base" },
  { cor: "var(--color-muted-foreground)", altura: "h-16", avatar: "h-12 w-12 text-sm" },
  {
    cor: "color-mix(in oklch, var(--color-warning) 55%, var(--color-destructive))",
    altura: "h-11",
    avatar: "h-12 w-12 text-sm",
  },
];

export function Podio({
  ranking,
  aoAbrir,
}: {
  ranking: UserScore[];
  aoAbrir: (id: string) => void;
}) {
  const top = ranking.filter((r) => r.assigned > 0).slice(0, 3);
  if (top.length < 2) return null;
  // Ordem de pódio: 2º, 1º, 3º.
  const posicoes = top.length === 3 ? [1, 0, 2] : [1, 0];
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4">
      {posicoes.map((pos, k) => {
        const r = top[pos];
        const m = MEDALHAS[pos];
        return (
          <motion.button
            key={r.user.id}
            type="button"
            onClick={() => aoAbrir(r.user.id)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * k, duration: 0.35, ease: "easeOut" }}
            className="group flex min-w-0 max-w-36 flex-1 flex-col items-center"
            title={`Ver as tarefas de ${r.user.name}`}
          >
            <div className="relative">
              {pos === 0 && (
                <Crown
                  className="absolute -top-5 left-1/2 h-5 w-5 -translate-x-1/2"
                  style={{ color: m.cor }}
                />
              )}
              <div className="rounded-full p-[3px]" style={{ background: m.cor }}>
                <Avatar user={r.user} className={`${m.avatar} ring-2 ring-card`} />
              </div>
              <span
                className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-card"
                style={{ background: m.cor }}
              >
                {pos + 1}
              </span>
            </div>
            <div className="mt-2 w-full truncate text-center text-xs font-semibold group-hover:underline">
              {r.user.name.split(" ").slice(0, 2).join(" ")}
            </div>
            <div
              className={`font-display text-lg font-bold leading-tight tabular-nums ${scoreTextClass(r.pct, r.assigned)}`}
            >
              {Math.round(r.pct)}%
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {fmtPontos(r.points)} de {r.assigned} pts
            </div>
            <div
              className={`mt-1.5 w-full rounded-t-lg border border-b-0 border-border ${m.altura}`}
              style={{
                background: `linear-gradient(to bottom, color-mix(in oklch, ${m.cor} 22%, var(--color-card)), var(--color-card))`,
              }}
            />
          </motion.button>
        );
      })}
    </div>
  );
}

/* ————— Ranking ————— */

function Contador({
  valor,
  rotulo,
  cor,
  titulo,
}: {
  valor: number;
  rotulo: string;
  cor: string;
  titulo: string;
}) {
  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
        valor === 0 ? "bg-secondary/50 text-muted-foreground/60" : cor
      }`}
    >
      <span className="font-semibold">{valor}</span> {rotulo}
    </span>
  );
}

export function Ranking({
  scores,
  series,
  fatias,
  aberto,
  aoAlternar,
  rotuloDoPeriodo,
  grande,
}: {
  scores: UserScore[];
  series: Map<string, Contagem[]>;
  fatias: Fatia[];
  aberto: string | null;
  aoAlternar: (id: string) => void;
  rotuloDoPeriodo: string;
  grande?: boolean;
}) {
  const [ordem, setOrdem] = useState<Ordem>("score");
  const posicao = useMemo(() => {
    const m = new Map<string, number>();
    [...scores].sort(porScore).forEach((s, i) => s.assigned > 0 && m.set(s.user.id, i + 1));
    return m;
  }, [scores]);
  const linhas = useMemo(() => ordenar(scores, ordem), [scores, ordem]);

  if (scores.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        <Target className="mx-auto mb-2 h-6 w-6" />
        Selecione ao menos um colaborador para ver o ranking.
      </div>
    );
  }

  return (
    <div>
      {scores.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="mr-1 text-muted-foreground">Ordenar por</span>
          {ORDENS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOrdem(o.id)}
              aria-pressed={ordem === o.id}
              className={`rounded-full border px-2 py-0.5 font-medium transition ${
                ordem === o.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {linhas.map((row) => {
          const isOpen = aberto === row.user.id;
          const pos = posicao.get(row.user.id);
          const serie = series.get(row.user.id) ?? [];
          return (
            <li key={row.user.id} id={`metas-pessoa-${row.user.id}`} className="scroll-mt-24">
              <button
                type="button"
                onClick={() => aoAlternar(row.user.id)}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-secondary/40 sm:px-4 ${
                  isOpen ? "bg-secondary/30" : ""
                } ${grande ? "py-3.5" : ""}`}
              >
                <span className="w-6 shrink-0 text-center font-display text-sm font-bold tabular-nums text-muted-foreground">
                  {pos ?? "—"}
                </span>
                <Avatar
                  user={row.user}
                  className={grande ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate font-medium ${grande ? "text-base" : "text-sm"}`}>
                      {row.user.name}
                    </span>
                    <span className="hidden shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
                      {nomeDoSetor(row.user.sector)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Contador
                      valor={row.onTime}
                      rotulo="no prazo"
                      cor="bg-success/15 text-success"
                      titulo="Concluídas no prazo — valem 1 ponto"
                    />
                    <Contador
                      valor={row.late}
                      rotulo="com atraso"
                      cor="bg-warning/15 text-warning"
                      titulo="Concluídas depois do prazo — valem ½ ponto"
                    />
                    <Contador
                      valor={row.pending}
                      rotulo="pendentes"
                      cor="bg-secondary text-foreground"
                      titulo="Abertas e ainda dentro do prazo — não pontuam até concluir"
                    />
                    <Contador
                      valor={row.missed}
                      rotulo="perdidas"
                      cor="bg-destructive/15 text-destructive"
                      titulo="Venceram sem concluir — 0 ponto"
                    />
                  </div>
                </div>
                <div
                  className="hidden shrink-0 lg:block"
                  title="Score de cada dia (a linha tracejada é a meta)"
                >
                  <MiniScore serie={serie} fatias={fatias} />
                </div>
                <div className="hidden w-36 shrink-0 md:block">
                  <div className="flex items-baseline justify-between text-[10px] text-muted-foreground">
                    <span>pontos</span>
                    <span className="tabular-nums">
                      {fmtPontos(row.points)} / {row.assigned}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, row.pct)}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      style={{ background: scoreBarColor(row.pct, row.assigned) }}
                    />
                  </div>
                </div>
                <div className="flex w-20 shrink-0 flex-col items-end sm:w-24">
                  <span
                    className={`font-display font-bold leading-none tabular-nums ${grande ? "text-2xl" : "text-xl"} ${scoreTextClass(row.pct, row.assigned)}`}
                  >
                    {row.assigned === 0 ? "—" : `${Math.round(row.pct)}%`}
                  </span>
                  <span className="mt-1 truncate text-[10px] text-muted-foreground">
                    {leituraDoScore(row)}
                  </span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="detalhe"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <Detalhamento row={row} rotuloDoPeriodo={rotuloDoPeriodo} />
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ORDEM_DO_ESTADO: Record<TaskScore["state"], number> = {
  missed: 0,
  pending: 1,
  late: 2,
  "on-time": 3,
};

function Detalhamento({ row, rotuloDoPeriodo }: { row: UserScore; rotuloDoPeriodo: string }) {
  // O que pede ação primeiro: perdidas, depois o que ainda está aberto.
  const itens = [...row.breakdown].sort(
    (a, b) =>
      ORDEM_DO_ESTADO[a.state] - ORDEM_DO_ESTADO[b.state] ||
      new Date(a.task.dueDate ?? 0).getTime() - new Date(b.task.dueDate ?? 0).getTime(),
  );
  return (
    <div className="border-t border-border bg-secondary/30 px-4 py-3 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Tarefas de <strong className="text-foreground">{rotuloDoPeriodo}</strong>
        </span>
        <span className="tabular-nums">
          {row.onTime + row.late} de {row.assigned} concluídas · {fmtPontos(row.points)} pontos
        </span>
      </div>
      {itens.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Nenhuma tarefa com prazo neste período — sem tarefa, não há score.
        </p>
      ) : (
        <ul className="space-y-1">
          {itens.map((b) => (
            <li
              key={b.task.id}
              className="flex items-center justify-between gap-3 rounded-md bg-card px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium">{b.task.title}</span>
                <span className="ml-2 text-muted-foreground">
                  {b.task.dueDate
                    ? `prazo ${rotuloDoPrazo(b.task, { day: "2-digit", month: "2-digit" })}`
                    : SEM_PRAZO.toLowerCase()}
                </span>
              </div>
              <SeloDoEstado state={b.state} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SeloDoEstado({ state }: { state: TaskScore["state"] }) {
  const map: Record<TaskScore["state"], { label: string; className: string }> = {
    "on-time": { label: "No prazo · 1", className: "bg-success/15 text-success" },
    late: { label: "Com atraso · ½", className: "bg-warning/15 text-warning" },
    pending: { label: "Pendente", className: "bg-secondary text-muted-foreground" },
    missed: { label: "Perdida · 0", className: "bg-destructive/15 text-destructive" },
  };
  const m = map[state];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.className}`}>
      {m.label}
    </span>
  );
}
