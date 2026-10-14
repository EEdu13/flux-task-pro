import { motion } from "framer-motion";
import {
  AlarmClock,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Hourglass,
  Minus,
  OctagonAlert,
  Search,
  UserX,
  Users2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { User } from "@/lib/fluxo-types";
import { scoreBarColor } from "@/lib/score";
import { semAcento as normalizar } from "@/lib/texto-busca";
import type { Alerta, Contagem, PlacarDoSetor, ProgressoDaMeta } from "./calculo";
import { AnelDoScore, Avatar, Vazio } from "./graficos";
import { corDoSetor, fmtPct, fmtPontos, nomeDoSetor } from "./formato";

/* Os blocos de leitura da aba Metas & Score (13/10/2026): o cartão principal,
   os alertas, o score por setor, as metas cadastradas e o filtro de pessoas. */

/* ————— Cartão principal ————— */

export function CartaoDoScore({
  titulo,
  contagem,
  anterior,
  rotuloAnterior,
  rotuloDoPeriodo,
  grande,
}: {
  titulo: string;
  contagem: Contagem;
  anterior: Contagem;
  rotuloAnterior: string;
  rotuloDoPeriodo: string;
  grande?: boolean;
}) {
  const pct = contagem.pct ?? 0;
  const concluidas = contagem.onTime + contagem.late;
  const faltam = Math.max(0, contagem.assigned - contagem.points);
  // O teto: tudo que ainda está aberto e no prazo concluído no prazo.
  const teto = contagem.assigned
    ? ((contagem.points + contagem.pending) / contagem.assigned) * 100
    : null;
  const delta = contagem.pct != null && anterior.pct != null ? contagem.pct - anterior.pct : null;
  const TomDelta =
    delta == null || Math.abs(delta) < 0.5 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const corDelta =
    delta == null || Math.abs(delta) < 0.5
      ? "bg-secondary text-muted-foreground"
      : delta > 0
        ? "bg-success/15 text-success"
        : "bg-destructive/15 text-destructive";

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
      {/* Brilho discreto na cor do resultado, atrás do anel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full opacity-[0.12] blur-3xl"
        style={{ background: scoreBarColor(pct, contagem.assigned) }}
      />
      <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <AnelDoScore pct={pct} assigned={contagem.assigned} tamanho={grande ? 240 : 188} />
        <div className="w-full min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {titulo}
          </div>
          <div className="mt-1 font-display text-2xl font-bold capitalize tracking-tight sm:text-3xl">
            {rotuloDoPeriodo}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold tabular-nums ${corDelta}`}
              title={`Comparado com ${rotuloAnterior}`}
            >
              <TomDelta className="h-3.5 w-3.5" />
              {delta == null
                ? "sem comparação"
                : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(Math.round(delta))} p.p.`}
            </span>
            <span className="text-muted-foreground">
              {anterior.pct == null
                ? `sem tarefas em ${rotuloAnterior}`
                : `vs. ${fmtPct(anterior.pct)} em ${rotuloAnterior}`}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero rotulo="Concluídas" valor={`${concluidas}/${contagem.assigned}`} />
            <Numero
              rotulo="Pontos"
              valor={`${fmtPontos(contagem.points)}/${contagem.assigned}`}
              nota="1 no prazo · ½ com atraso"
            />
            <Numero
              rotulo="Faltam p/ meta"
              valor={contagem.assigned ? fmtPontos(faltam) : "—"}
              nota={faltam === 0 && contagem.assigned ? "meta batida" : "pontos"}
              cor={faltam === 0 && contagem.assigned ? "var(--color-success)" : undefined}
            />
            <Numero
              rotulo="Ainda dá p/ chegar a"
              valor={fmtPct(teto)}
              nota={
                contagem.pending > 0
                  ? `se as ${contagem.pending} pendentes saírem no prazo`
                  : "nada mais em aberto"
              }
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  cor,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  cor?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary/40 px-3 py-2">
      <dt className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </dt>
      <dd
        className="font-display text-xl font-bold tabular-nums tracking-tight"
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </dd>
      {nota && <dd className="truncate text-[10px] text-muted-foreground">{nota}</dd>}
    </div>
  );
}

/* ————— Precisa de atenção ————— */

const ICONE_DO_ALERTA = {
  perdidas: { Icone: OctagonAlert, cor: "text-destructive bg-destructive/15" },
  atraso: { Icone: AlarmClock, cor: "text-warning bg-warning/15" },
  aberto: { Icone: Hourglass, cor: "text-primary bg-primary/10" },
  "sem-tarefas": { Icone: UserX, cor: "text-muted-foreground bg-secondary" },
} as const;

export function ListaDeAlertas({
  alertas,
  aoAbrir,
}: {
  alertas: Alerta[];
  aoAbrir: (userId: string) => void;
}) {
  const [todos, setTodos] = useState(false);
  if (alertas.length === 0) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-success/40 bg-success/5 px-6 text-center">
        <CheckCircle2 className="h-7 w-7 text-success" />
        <div className="text-sm font-semibold">Tudo em dia</div>
        <div className="text-[11px] text-muted-foreground">
          Ninguém com tarefa vencida, atrasada ou parada neste período.
        </div>
      </div>
    );
  }
  const visiveis = todos ? alertas : alertas.slice(0, 5);
  return (
    <div>
      <ul className="space-y-2">
        {visiveis.map((a, k) => {
          const { Icone, cor } = ICONE_DO_ALERTA[a.tipo];
          return (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(k, 6) * 0.04 }}
              className="flex items-start gap-2.5 rounded-lg border border-border bg-background/40 p-2.5"
            >
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cor}`}
              >
                <Icone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {a.user && (
                  <div className="flex items-center gap-1.5">
                    <Avatar user={a.user} className="h-4 w-4 text-[7px]" />
                    <span className="truncate text-xs font-semibold">{a.user.name}</span>
                  </div>
                )}
                <div className="text-xs font-medium leading-snug">{a.titulo}</div>
                {a.pessoas && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {a.pessoas.slice(0, 8).map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px]"
                      >
                        <Avatar user={p} className="h-3.5 w-3.5 text-[6px]" />
                        {p.name.split(" ")[0]}
                      </span>
                    ))}
                    {a.pessoas.length > 8 && (
                      <span className="text-[10px] text-muted-foreground">
                        e mais {a.pessoas.length - 8}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {a.detalhe}
                </div>
              </div>
              {a.user && (
                <button
                  type="button"
                  onClick={() => aoAbrir(a.user!.id)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/10"
                >
                  Ver tarefas
                </button>
              )}
            </motion.li>
          );
        })}
      </ul>
      {alertas.length > 5 && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          className="mt-2 w-full rounded-md py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
        >
          {todos ? "Mostrar menos" : `Ver todos os ${alertas.length} alertas`}
        </button>
      )}
    </div>
  );
}

/* ————— Score por setor ————— */

export function ScorePorSetor({ setores }: { setores: PlacarDoSetor[] }) {
  return (
    <ul className="space-y-3">
      {setores.map((s) => {
        const c = s.contagem;
        return (
          <li key={s.setor}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: corDoSetor(s.setor) }}
                />
                <span className="truncate font-medium">{nomeDoSetor(s.setor)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {s.pessoas} {s.pessoas === 1 ? "pessoa" : "pessoas"}
                </span>
              </span>
              <span
                className="shrink-0 font-display text-sm font-bold tabular-nums"
                style={{ color: scoreBarColor(c.pct ?? 0, c.assigned) }}
              >
                {fmtPct(c.pct)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, c.pct ?? 0)}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{ background: scoreBarColor(c.pct ?? 0, c.assigned) }}
              />
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
              {c.assigned === 0
                ? "sem tarefas no período"
                : `${c.onTime + c.late} de ${c.assigned} concluídas · ${c.missed} perdidas · ${c.pending} pendentes`}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ————— Metas cadastradas ————— */

const NOME_DO_PERIODO_DA_META = {
  diaria: { meta: "Meta diária", fim: "do dia" },
  semanal: { meta: "Meta semanal", fim: "da semana" },
  mensal: { meta: "Meta mensal", fim: "do mês" },
} as Record<string, { meta: string; fim: string }>;

export function ProgressoDeMetas({ itens }: { itens: ProgressoDaMeta[] }) {
  if (itens.length === 0) {
    return (
      <Vazio altura="h-32">
        Nenhuma meta cadastrada para estas pessoas ou setores. Enquanto isso, a referência é a do
        score: 100% das tarefas concluídas no prazo.
      </Vazio>
    );
  }
  return (
    <ul className="space-y-3.5">
      {itens.map((p) => {
        const nomes = NOME_DO_PERIODO_DA_META[p.meta.period] ?? { meta: "Meta", fim: "do período" };
        const batida = p.pct >= 100;
        const noRitmo = p.projecaoPct != null && p.projecaoPct >= 100;
        const cor = batida
          ? "var(--color-success)"
          : p.projecaoPct == null || noRitmo
            ? "var(--color-primary)"
            : "var(--color-destructive)";
        const unidade = p.meta.metric === "tarefas" ? "tarefas" : "pontos";
        return (
          <li key={p.meta.id}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                {p.user ? (
                  <Avatar user={p.user} className="h-5 w-5 text-[8px]" />
                ) : (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: corDoSetor(p.meta.scopeId) }}
                  />
                )}
                <span className="truncate font-medium">{p.alvoNome}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{fmtPontos(p.realizado)}</span> /{" "}
                {fmtPontos(p.meta.target)} {unidade}
              </span>
            </div>
            <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, p.pct)}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                style={{ background: cor }}
              />
              {p.projecaoPct != null && !batida && (
                <span
                  className="absolute top-0 h-full w-0.5 bg-foreground/50"
                  style={{ left: `calc(${Math.min(100, p.projecaoPct)}% - 1px)` }}
                  title={`Projeção: ${Math.round(p.projecaoPct)}%`}
                />
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-[10px] text-muted-foreground">
              <span>
                {nomes.meta} · {p.meta.scope === "sector" ? "setor" : "pessoa"}
              </span>
              <span>
                {batida
                  ? `meta batida (${Math.round(p.pct)}%)`
                  : p.projecaoPct == null
                    ? `${Math.round(p.pct)}% · cedo para projetar`
                    : `${Math.round(p.pct)}% · no ritmo atual chega a ${Math.round(p.projecaoPct)}% até o fim ${nomes.fim}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ————— Filtro de colaboradores ————— */

/**
 * O filtro do painel numa lista suspensa com busca. Era uma parede de chips —
 * com 30 pessoas, o filtro ocupava mais tela que o resultado.
 */
export function FiltroDeColaboradores({
  pessoas,
  selecionados,
  aoMudar,
  euId,
}: {
  pessoas: User[];
  selecionados: Set<string>;
  aoMudar: (ids: Set<string>) => void;
  euId: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const ordenadas = useMemo(
    () => [...pessoas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [pessoas],
  );
  const setores = useMemo(() => {
    const ids = [...new Set(pessoas.map((p) => p.sector))];
    return ids.sort((a, b) => nomeDoSetor(a).localeCompare(nomeDoSetor(b), "pt-BR"));
  }, [pessoas]);
  const achadas = useMemo(() => {
    const q = normalizar(busca.trim());
    if (!q) return ordenadas;
    return ordenadas.filter(
      (p) => normalizar(p.name).includes(q) || normalizar(p.jobTitle ?? "").includes(q),
    );
  }, [ordenadas, busca]);

  const todos = selecionados.size === pessoas.length;
  const escolhidas = ordenadas.filter((p) => selecionados.has(p.id));
  const alternar = (id: string) => {
    const n = new Set(selecionados);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    aoMudar(n);
  };
  const resumo = todos
    ? `Time todo · ${pessoas.length}`
    : selecionados.size === 0
      ? "Ninguém selecionado"
      : selecionados.size === 1
        ? escolhidas[0]?.name.split(" ").slice(0, 2).join(" ")
        : `${selecionados.size} de ${pessoas.length} pessoas`;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-card pl-1.5 pr-2.5 text-sm font-medium shadow-sm transition hover:bg-secondary ${
            todos ? "border-border" : "border-primary/60"
          }`}
        >
          <span className="flex -space-x-2">
            {(escolhidas.length ? escolhidas : ordenadas).slice(0, 4).map((p) => (
              <Avatar key={p.id} user={p} className="h-6 w-6 text-[9px] ring-2 ring-card" />
            ))}
          </span>
          <span className="max-w-48 truncate">{resumo}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-430 w-80 p-0">
        <div className="border-b border-border p-2">
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa ou cargo"
              className="h-8 w-full bg-transparent text-sm outline-none"
              autoFocus
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            <Atalho ativo={todos} aoClicar={() => aoMudar(new Set(pessoas.map((p) => p.id)))}>
              <Users2 className="h-3 w-3" /> Todos
            </Atalho>
            <Atalho
              ativo={selecionados.size === 1 && selecionados.has(euId)}
              aoClicar={() => aoMudar(new Set([euId]))}
            >
              Só eu
            </Atalho>
            {setores.length > 1 &&
              setores.map((s) => {
                const ids = pessoas.filter((p) => p.sector === s).map((p) => p.id);
                const ativo =
                  !todos &&
                  ids.length === selecionados.size &&
                  ids.every((id) => selecionados.has(id));
                return (
                  <Atalho key={s} ativo={ativo} aoClicar={() => aoMudar(new Set(ids))}>
                    <span className="h-2 w-2 rounded-full" style={{ background: corDoSetor(s) }} />
                    {nomeDoSetor(s)}
                  </Atalho>
                );
              })}
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {achadas.map((p) => {
            const on = selecionados.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => alternar(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary ${
                    on ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <Avatar user={p} className="h-6 w-6 text-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.name}
                      {p.id === euId && (
                        <span className="ml-1.5 rounded-full bg-primary/15 px-1 text-[9px] font-semibold uppercase text-primary">
                          você
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {p.jobTitle} · {nomeDoSetor(p.sector)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {achadas.length === 0 && (
            <li className="px-2 py-6 text-center text-xs text-muted-foreground">
              Ninguém com esse nome.
            </li>
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span>
            {selecionados.size} de {pessoas.length} selecionadas
          </span>
          {selecionados.size > 0 && (
            <button
              type="button"
              onClick={() => aoMudar(new Set())}
              className="font-medium text-primary hover:underline"
            >
              Limpar
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Atalho({
  ativo,
  aoClicar,
  children,
}: {
  ativo: boolean;
  aoClicar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
