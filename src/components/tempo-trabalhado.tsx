import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Medal, Timer } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { feriadoNacional } from "@/lib/dias-uteis";
import { formatHM, type Persisted } from "@/lib/time-log";
import type { Task, User } from "@/lib/fluxo-types";

/**
 * "Tempo trabalhado" na tela inicial (pedido do usuário, 13/10/2026: "o
 * pessoal está usando muito o tempo, deixa o tempo de ontem ali").
 *
 * O destaque é o ÚLTIMO DIA ÚTIL — numa segunda, ou depois de feriado,
 * "ontem" seria um domingo zerado e não diria nada. Junto vão o de hoje até
 * agora, os 7 últimos dias úteis em colunas e as tarefas que mais tomaram
 * tempo naquele dia. Quem é chefia tem também a aba do time, com as horas de
 * cada um no mesmo dia.
 *
 * As sessões vêm do servidor (90 dias, já com o recorte de quem cada um pode
 * ver — ver `listarSessoesDeTempo`), não do navegador: o cronômetro pode ter
 * rodado em outro computador.
 */

const DIA_MS = 86_400_000;

function ehDiaUtil(d: Date): boolean {
  const s = d.getDay();
  return s !== 0 && s !== 6 && !feriadoNacional(d);
}

/** Meia-noite local dos últimos `n` dias úteis antes de hoje, do mais antigo ao mais novo. */
function diasUteisAntesDeHoje(n: number): Date[] {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const saida: Date[] = [];
  for (let i = 0; i < 40 && saida.length < n; i++) {
    d.setDate(d.getDate() - 1);
    if (ehDiaUtil(d)) saida.unshift(new Date(d));
  }
  return saida;
}

/* Uma busca só para a tela inicial inteira: o card do tempo e o ranking de
   tarefas leem as mesmas sessões. A promessa fica guardada por alguns minutos
   — voltar para a tela não refaz a consulta toda hora.

   Só o MEU tempo (`meuTempoRecente`, uma busca direta no índice): a consulta
   dos Relatórios monta a equipe inteira e era cara demais para a tela mais
   aberta do sistema. O do time vem à parte, só quando a chefia abre a aba. */
async function carregarMeuTempo(): Promise<Record<string, Persisted>> {
  const { meuTempoRecente } = await import("@/lib/tempo.functions");
  const { sessoes } = await meuTempoRecente();
  const meu: Persisted = { sessions: [], totals: {} };
  let pessoa = "";
  for (const x of sessoes) {
    pessoa = x.pessoaId;
    meu.sessions.push({
      id: x.id,
      taskId: x.taskId,
      startedAt: x.startedAt,
      endedAt: x.endedAt,
      seconds: x.seconds,
    });
    meu.totals[x.taskId] = (meu.totals[x.taskId] ?? 0) + x.seconds;
  }
  return pessoa ? { [pessoa]: meu } : {};
}

let busca: { quando: number; promessa: Promise<Record<string, Persisted>> } | null = null;
function buscarTempo(): Promise<Record<string, Persisted>> {
  if (!busca || Date.now() - busca.quando > 3 * 60_000) {
    const promessa = carregarMeuTempo();
    busca = { quando: Date.now(), promessa };
    promessa.catch(() => {
      busca = null; // falhou: a próxima tentativa busca de novo
    });
  }
  return busca.promessa;
}

function useTempoDoServidor(): { logs: Record<string, Persisted> | null; erro: boolean } {
  const [logs, setLogs] = useState<Record<string, Persisted> | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    buscarTempo()
      .then((d) => vivo && setLogs(d))
      .catch((e: unknown) => {
        console.warn("[fluxo] tempo da tela inicial não carregou:", (e as Error)?.message);
        if (vivo) setErro(true);
      });
    return () => {
      vivo = false;
    };
  }, []);
  return { logs, erro };
}

function segundosNoDia(log: Persisted | undefined, inicio: number): number {
  if (!log) return 0;
  let s = 0;
  for (const x of log.sessions)
    if (x.startedAt >= inicio && x.startedAt < inicio + DIA_MS) s += x.seconds;
  return s;
}

export function TempoTrabalhado({
  eu,
  tasks,
  time,
  ehChefia,
}: {
  eu: User;
  tasks: Task[];
  /** As pessoas do time (sem a própria), para a aba da chefia. */
  time: User[];
  ehChefia: boolean;
}) {
  const { logs, erro } = useTempoDoServidor();
  const [aba, setAba] = useState<"eu" | "time">("eu");
  // As horas do time: só buscadas quando a aba é aberta.
  const [doTimeBruto, setDoTimeBruto] = useState<Record<string, number> | null>(null);

  const dias = useMemo(() => diasUteisAntesDeHoje(7), []);
  const ultimo = dias[dias.length - 1]!;
  const ontem = new Date();
  ontem.setHours(0, 0, 0, 0);
  ontem.setDate(ontem.getDate() - 1);
  const rotuloDoUltimo =
    ultimo.getTime() === ontem.getTime()
      ? "Ontem"
      : `${ultimo.toLocaleDateString("pt-BR", { weekday: "long" })}, ${ultimo.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;

  const meu = logs?.[eu.id];
  const dados = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const colunas = dias.map((d) => ({ dia: d, s: segundosNoDia(meu, d.getTime()) }));
    const doUltimo = colunas[colunas.length - 1]!.s;
    const deHoje = segundosNoDia(meu, hoje.getTime());
    const comTempo = colunas.filter((c) => c.s > 0);
    const media = comTempo.length ? comTempo.reduce((a, c) => a + c.s, 0) / comTempo.length : 0;
    // As tarefas que mais tomaram tempo no último dia útil.
    const porTarefa = new Map<string, number>();
    for (const x of meu?.sessions ?? []) {
      if (x.startedAt < ultimo.getTime() || x.startedAt >= ultimo.getTime() + DIA_MS) continue;
      porTarefa.set(x.taskId, (porTarefa.get(x.taskId) ?? 0) + x.seconds);
    }
    const tarefas = [...porTarefa]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, s]) => ({ id, s, titulo: tasks.find((t) => t.id === id)?.title ?? "Tarefa" }));
    const maximo = Math.max(1, ...colunas.map((c) => c.s));
    return { colunas, doUltimo, deHoje, media, tarefas, maximo };
  }, [meu, dias, ultimo, tasks]);

  const diaIso = `${ultimo.getFullYear()}-${String(ultimo.getMonth() + 1).padStart(2, "0")}-${String(ultimo.getDate()).padStart(2, "0")}`;
  useEffect(() => {
    if (aba !== "time" || doTimeBruto) return;
    let vivo = true;
    void import("@/lib/tempo.functions")
      .then(({ tempoDoTimeNoDia }) => tempoDoTimeNoDia({ data: { dia: diaIso } }))
      .then((r) => vivo && setDoTimeBruto(r.porPessoa))
      .catch((e: unknown) => {
        console.warn("[fluxo] tempo do time não carregou:", (e as Error)?.message);
        if (vivo) setDoTimeBruto({});
      });
    return () => {
      vivo = false;
    };
  }, [aba, doTimeBruto, diaIso]);

  const doTime = useMemo(() => {
    if (!doTimeBruto) return [];
    return time.map((u) => ({ u, s: doTimeBruto[u.id] ?? 0 })).sort((a, b) => b.s - a.s);
  }, [doTimeBruto, time]);
  const maxTime = Math.max(1, ...doTime.map((x) => x.s));

  // Comparação com a média dos dias com registro: mostra se o dia foi puxado.
  const variacao =
    dados.media > 0 && dados.doUltimo > 0
      ? Math.round(((dados.doUltimo - dados.media) / dados.media) * 100)
      : null;

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Timer className="h-4 w-4 text-primary" /> Tempo trabalhado
          </h2>
          <p className="text-xs text-muted-foreground">Registrado no cronômetro das tarefas.</p>
        </div>
        {ehChefia && (
          <div className="inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium">
            {(
              [
                ["eu", "Meu"],
                ["time", "Time"],
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setAba(v)}
                className={`rounded px-2 py-0.5 transition ${
                  aba === v
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {!logs && !erro && (
        <div
          className="mt-4 flex-1 animate-pulse rounded-lg bg-secondary/60"
          style={{ minHeight: 150 }}
        />
      )}
      {erro && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Não deu para carregar o tempo agora. Recarregue a página para tentar de novo.
        </p>
      )}

      {logs && aba === "eu" && (
        <>
          <div className="mt-4 flex items-end gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first-letter:uppercase">
                {rotuloDoUltimo}
              </div>
              <div className="font-display text-4xl font-bold tabular-nums tracking-tight text-primary">
                {dados.doUltimo > 0 ? formatHM(dados.doUltimo) : "0m"}
              </div>
              {variacao !== null && (
                <div
                  className={`text-[11px] font-semibold ${variacao >= 0 ? "text-success" : "text-muted-foreground"}`}
                >
                  {variacao >= 0 ? "+" : ""}
                  {variacao}% vs. sua média ({formatHM(dados.media)})
                </div>
              )}
            </div>
            <div className="pb-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Hoje até agora
              </div>
              <div className="font-display text-xl font-bold tabular-nums">
                {formatHM(dados.deHoje)}
              </div>
            </div>
          </div>

          {/* Os 7 últimos dias úteis; o último (o destacado acima) em cor cheia. */}
          <div className="mt-4 flex h-20 items-end gap-1.5">
            {dados.colunas.map((c, i) => {
              const ultimoDia = i === dados.colunas.length - 1;
              return (
                <div
                  key={c.dia.getTime()}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  title={`${c.dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}: ${formatHM(c.s)}`}
                >
                  <motion.div
                    className="w-full max-w-8 rounded-t-md"
                    style={{
                      background:
                        c.s === 0
                          ? "var(--color-secondary)"
                          : ultimoDia
                            ? "var(--color-primary)"
                            : "color-mix(in oklab, var(--color-primary) 40%, var(--color-secondary))",
                    }}
                    initial={{ height: 3 }}
                    animate={{ height: c.s === 0 ? 3 : Math.max(6, (c.s / dados.maximo) * 60) }}
                    transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  />
                  <span className="text-[10px] capitalize leading-none text-muted-foreground">
                    {c.dia.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
              Onde foi o tempo — {rotuloDoUltimo.toLowerCase()}
            </div>
            {dados.tarefas.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum tempo registrado nesse dia. Use o ▶ da tarefa para cronometrar.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {dados.tarefas.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(t.s / dados.doUltimo) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 text-right font-semibold tabular-nums">
                      {formatHM(t.s)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {aba === "time" && !doTimeBruto && (
        <div className="mt-4 h-40 animate-pulse rounded-lg bg-secondary/60" />
      )}
      {aba === "time" && doTimeBruto && (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first-letter:uppercase">
            {rotuloDoUltimo} — horas de cada um
          </div>
          {doTime.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguém do time por aqui.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {doTime.map(({ u, s }) => (
                <li key={u.id} className="flex items-center gap-2">
                  <UserAvatar nome={u.name} iniciais={u.avatar} className="h-6 w-6 text-[9px]" />
                  <span className="w-28 truncate text-xs font-medium">
                    {u.name.split(" ").slice(0, 2).join(" ")}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <motion.span
                      className="block h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${(s / maxTime) * 100}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                  <span
                    className={`w-14 text-right text-xs font-semibold tabular-nums ${s === 0 ? "text-muted-foreground/60" : ""}`}
                  >
                    {s === 0 ? "—" : formatHM(s)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ————————————————— Ranking de tempo por tarefa ————————————————— */

type PeriodoDoTempo = "semana" | "mes" | "tudo";

const PERIODOS: [PeriodoDoTempo, string][] = [
  ["semana", "7 dias"],
  ["mes", "30 dias"],
  ["tudo", "90 dias"],
];

const MEDALHAS = ["oklch(0.8 0.15 80)", "oklch(0.78 0.02 260)", "oklch(0.68 0.11 50)"];

/**
 * As tarefas que mais tomaram o MEU tempo no período (pedido do usuário,
 * 13/10/2026: "um ranking de tarefas que tomaram mais tempo"). A barra é
 * relativa à primeira; ao lado, quantas vezes o cronômetro rodou nela.
 * Clicar abre a tarefa.
 */
export function RankingDeTempo({
  eu,
  tasks,
  aoAbrir,
}: {
  eu: User;
  tasks: Task[];
  aoAbrir: (taskId: string) => void;
}) {
  const { logs, erro } = useTempoDoServidor();
  const [periodo, setPeriodo] = useState<PeriodoDoTempo>("semana");

  const linhas = useMemo(() => {
    const desde = periodo === "tudo" ? 0 : Date.now() - (periodo === "semana" ? 7 : 30) * DIA_MS;
    const porTarefa = new Map<string, { s: number; vezes: number }>();
    for (const x of logs?.[eu.id]?.sessions ?? []) {
      if (x.startedAt < desde) continue;
      const atual = porTarefa.get(x.taskId) ?? { s: 0, vezes: 0 };
      atual.s += x.seconds;
      atual.vezes++;
      porTarefa.set(x.taskId, atual);
    }
    const total = [...porTarefa.values()].reduce((a, v) => a + v.s, 0);
    const lista = [...porTarefa]
      .sort((a, b) => b[1].s - a[1].s)
      .slice(0, 6)
      .map(([id, v]) => {
        const t = tasks.find((x) => x.id === id);
        return { id, ...v, titulo: t?.title ?? "Tarefa removida", existe: !!t };
      });
    return { lista, total };
  }, [logs, eu.id, periodo, tasks]);

  const maior = linhas.lista[0]?.s ?? 1;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Medal className="h-4 w-4 text-amber-500" /> Tarefas que mais tomaram tempo
          </h2>
          <p className="text-xs text-muted-foreground">
            {linhas.total > 0
              ? `${formatHM(linhas.total)} cronometradas no período.`
              : "O seu tempo no cronômetro, por tarefa."}
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-md border border-border p-0.5 text-[11px] font-medium">
          {PERIODOS.map(([v, r]) => (
            <button
              key={v}
              type="button"
              onClick={() => setPeriodo(v)}
              className={`rounded px-2 py-0.5 transition ${
                periodo === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {!logs && !erro && <div className="mt-3 h-40 animate-pulse rounded-lg bg-secondary/60" />}
      {erro && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Não deu para carregar o tempo agora. Recarregue a página para tentar de novo.
        </p>
      )}
      {logs && linhas.lista.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          Nenhum tempo cronometrado nesse período. Use o ▶ da tarefa para começar a contar.
        </p>
      )}
      {logs && linhas.lista.length > 0 && (
        <ol className="mt-3 space-y-1">
          {linhas.lista.map((l, i) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={!l.existe}
                onClick={() => aoAbrir(l.id)}
                className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition hover:bg-secondary/60 disabled:cursor-default"
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={
                    i < 3
                      ? { background: MEDALHAS[i], color: "oklch(0.25 0.03 60)" }
                      : {
                          background: "var(--color-secondary)",
                          color: "var(--color-muted-foreground)",
                        }
                  }
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium group-hover:text-primary">
                    {l.titulo}
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{
                        background:
                          i === 0
                            ? "var(--color-primary)"
                            : "color-mix(in oklab, var(--color-primary) 55%, var(--color-secondary))",
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(l.s / maior) * 100}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                </span>
                <span className="w-16 shrink-0 text-right">
                  <span className="block text-xs font-bold tabular-nums">{formatHM(l.s)}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {l.vezes} {l.vezes === 1 ? "vez" : "vezes"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
