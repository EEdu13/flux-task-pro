import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { sectors, statusLabels, type Project, type Task } from "@/lib/fluxo-types";
import { formatHMS } from "@/lib/time-log";
import {
  COR_OUTROS,
  CORES_SERIE,
  DIAS_DA_SEMANA,
  EIXO,
  duracao,
  empilharPorGrupo,
  mapaDeCalor,
  somaSegundos,
  type Balde,
  type Sessao,
} from "./analise";
import { BarrasEmLista, Cartao, DicaDoGrafico, Legenda, Vazio } from "./pecas";

/**
 * O bloco "Tempo" dos Relatórios (13/10/2026): horas por dia empilhadas, onde
 * o tempo foi (projeto, etiqueta, setor, pessoa), o mapa de calor dia × hora,
 * as tarefas que mais tomaram tempo e as últimas sessões.
 *
 * Não existe estimativa de tempo preenchida nas tarefas, então não há
 * "estimado × real" — o quadro antigo mostrava um vazio permanente.
 */

const SEM_PROJETO = "__sem-projeto";

type Agrupamento = "projeto" | "etiqueta" | "setor" | "pessoa";

export function SecaoTempo({
  sessoes,
  baldes,
  granularidade,
  multi,
  nomeDe,
  tarefaPorId,
  projetoPorId,
  carregando,
  erro,
}: {
  /** Só as sessões do escopo e do período. */
  sessoes: Sessao[];
  baldes: Balde[];
  granularidade: "dia" | "semana";
  multi: boolean;
  nomeDe: (userId: string) => string;
  tarefaPorId: Map<string, Task>;
  projetoPorId: Map<string, Project>;
  carregando: boolean;
  erro: string | null;
}) {
  /* ---- horas por dia, empilhadas por pessoa (time) ou por projeto (uma pessoa) */
  const pilha = useMemo(() => {
    if (multi) return empilharPorGrupo(sessoes, baldes, (s) => s.userId, nomeDe);
    return empilharPorGrupo(
      sessoes,
      baldes,
      (s) => tarefaPorId.get(s.taskId)?.projectId ?? SEM_PROJETO,
      (id) => nomeDoProjeto(id, projetoPorId),
    );
  }, [sessoes, baldes, multi, nomeDe, tarefaPorId, projetoPorId]);
  const coresPilha = pilha.series.map((s, i) =>
    s.chave === "__outros" ? COR_OUTROS : CORES_SERIE[i % CORES_SERIE.length]!,
  );
  const maiorBalde = Math.max(
    0,
    ...pilha.linhas.map((l) =>
      pilha.series.reduce((soma, s) => soma + ((l[s.chave] as number) ?? 0), 0),
    ),
  );
  /* Horas quando o maior dia passa de 2h; senão minutos — 0,1h numa escala
     de horas não se lê. */
  const emHoras = maiorBalde >= 7200;
  const unidade = emHoras ? 3600 : 60;
  const linhasNaUnidade = pilha.linhas.map((l) => {
    const r: Record<string, number | string> = { rotulo: l.rotulo };
    for (const s of pilha.series) r[s.chave] = ((l[s.chave] as number) ?? 0) / unidade;
    return r;
  });

  /* ---- onde foi o tempo */
  const [agrupamento, setAgrupamento] = useState<Agrupamento>(multi ? "pessoa" : "projeto");
  const opcoes: { id: Agrupamento; rotulo: string }[] = [
    { id: "projeto", rotulo: "Projeto" },
    { id: "etiqueta", rotulo: "Etiqueta" },
    { id: "setor", rotulo: "Setor" },
    ...(multi ? [{ id: "pessoa" as const, rotulo: "Pessoa" }] : []),
  ];
  const agrupAtual = !multi && agrupamento === "pessoa" ? "projeto" : agrupamento;
  const ondeFoi = useMemo(() => {
    const m = new Map<string, { rotulo: string; valor: number; cor?: string }>();
    const somar = (chave: string, rotulo: string, seg: number, cor?: string) => {
      const cur = m.get(chave) ?? { rotulo, valor: 0, cor };
      cur.valor += seg;
      m.set(chave, cur);
    };
    for (const s of sessoes) {
      const t = tarefaPorId.get(s.taskId);
      if (agrupAtual === "pessoa") somar(s.userId, nomeDe(s.userId), s.seconds);
      else if (agrupAtual === "projeto") {
        const id = t?.projectId ?? SEM_PROJETO;
        somar(id, nomeDoProjeto(id, projetoPorId), s.seconds, projetoPorId.get(id)?.color);
      } else if (agrupAtual === "setor") {
        const sec = sectors.find((x) => x.id === t?.sector);
        somar(sec?.id ?? "?", sec?.name ?? "Sem setor", s.seconds, sec?.color);
      } else {
        /* Uma sessão numa tarefa com duas etiquetas conta nas duas — por isso
           a soma desta visão pode passar do total. */
        const tags = t?.tags?.length ? t.tags : ["__sem"];
        for (const tag of tags) somar(tag, tag === "__sem" ? "Sem etiqueta" : `#${tag}`, s.seconds);
      }
    }
    return [...m.entries()]
      .map(([chave, v]) => ({ chave, ...v }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
  }, [sessoes, agrupAtual, tarefaPorId, projetoPorId, nomeDe]);

  /* ---- tarefas que mais tomaram tempo */
  const topTarefas = useMemo(() => {
    const m = new Map<string, { seg: number; pessoas: Set<string> }>();
    for (const s of sessoes) {
      const cur = m.get(s.taskId) ?? { seg: 0, pessoas: new Set<string>() };
      cur.seg += s.seconds;
      cur.pessoas.add(s.userId);
      m.set(s.taskId, cur);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].seg - a[1].seg)
      .slice(0, 8)
      .map(([taskId, v]) => {
        const t = tarefaPorId.get(taskId);
        const proj = t?.projectId ? projetoPorId.get(t.projectId)?.name : undefined;
        const nota = [
          t ? statusLabels[t.status] : "Tarefa arquivada",
          proj,
          multi ? [...v.pessoas].map(nomeDe).join(", ") : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return { chave: taskId, rotulo: t?.title ?? "(tarefa arquivada)", valor: v.seg, nota };
      });
  }, [sessoes, tarefaPorId, projetoPorId, multi, nomeDe]);

  const calor = useMemo(() => mapaDeCalor(sessoes), [sessoes]);

  const recentes = useMemo(
    () => [...sessoes].sort((a, b) => b.endedAt - a.endedAt).slice(0, 10),
    [sessoes],
  );

  const total = somaSegundos(sessoes);

  if (carregando) {
    return <Vazio altura="h-48">Buscando as sessões do cronômetro no servidor…</Vazio>;
  }
  if (erro) {
    return (
      <Vazio altura="h-48">
        Não deu para carregar o tempo ({erro}). Recarregue a página para tentar de novo.
      </Vazio>
    );
  }
  if (total === 0) {
    return (
      <Vazio altura="h-48">
        Nenhum tempo cronometrado neste período. Para medir, use o <b>▶</b> da tarefa ao começar e
        pare quando terminar — as sessões aparecem aqui, de qualquer computador.
      </Vazio>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Cartao
        className="xl:col-span-2"
        titulo={`Horas por ${granularidade === "dia" ? "dia" : "semana"}`}
        subtitulo={
          <>
            {duracao(total)} no período, {multi ? "por pessoa" : "por projeto"} · em{" "}
            {emHoras ? "horas" : "minutos"}
          </>
        }
      >
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={linhasNaUnidade} margin={{ left: -18, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.6} />
              <XAxis dataKey="rotulo" {...EIXO} minTickGap={12} />
              <YAxis {...EIXO} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "var(--color-secondary)", opacity: 0.5 }}
                content={
                  <DicaDoGrafico
                    formatar={(v) => duracao(v * unidade)}
                    rodape={(itens) => {
                      const s = itens.reduce((a, i) => a + (i.value ?? 0), 0);
                      return s > 0 ? `Total: ${duracao(s * unidade)}` : null;
                    }}
                  />
                }
              />
              {pilha.series.map((s, i) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.rotulo}
                  stackId="t"
                  fill={coresPilha[i]}
                  stroke="var(--color-card)"
                  strokeWidth={1}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Legenda itens={pilha.series.map((s, i) => ({ rotulo: s.rotulo, cor: coresPilha[i]! }))} />
      </Cartao>

      <Cartao
        titulo="Onde foi o tempo"
        subtitulo={
          agrupAtual === "etiqueta"
            ? "Tarefa com várias etiquetas conta em cada uma."
            : "As 8 maiores fatias do período."
        }
        acoes={
          <div className="flex rounded-md border border-border p-0.5">
            {opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setAgrupamento(o.id)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  agrupAtual === o.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.rotulo}
              </button>
            ))}
          </div>
        }
      >
        <BarrasEmLista
          formatar={duracao}
          itens={ondeFoi.map((o) => ({
            chave: o.chave,
            rotulo: (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {o.cor && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.cor }} />
                )}
                <span className="truncate">{o.rotulo}</span>
              </span>
            ),
            valor: o.valor,
          }))}
        />
      </Cartao>

      <Cartao
        className="xl:col-span-2"
        titulo="Quando o trabalho acontece"
        subtitulo="Tempo cronometrado por dia da semana e hora — quanto mais forte, mais tempo."
      >
        <MapaDeCalor calor={calor} />
      </Cartao>

      <Cartao titulo="Tarefas que mais tomaram tempo" subtitulo="Soma das sessões no período.">
        <BarrasEmLista formatar={duracao} itens={topTarefas} />
      </Cartao>

      <Cartao
        className="xl:col-span-3"
        titulo="Últimas sessões"
        subtitulo="As 10 mais recentes do período — a planilha de Sessões traz todas."
      >
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-1 pb-2 font-medium">Tarefa</th>
                {multi && <th className="px-1 pb-2 font-medium">Pessoa</th>}
                <th className="px-1 pb-2 font-medium">Início</th>
                <th className="px-1 pb-2 font-medium">Fim</th>
                <th className="px-1 pb-2 text-right font-medium">Duração</th>
              </tr>
            </thead>
            <tbody>
              {recentes.map((s) => (
                <tr key={s.id} className="border-t border-border/60">
                  <td className="max-w-[320px] truncate px-1 py-1.5">
                    {tarefaPorId.get(s.taskId)?.title ?? "(tarefa arquivada)"}
                  </td>
                  {multi && (
                    <td className="px-1 py-1.5 text-muted-foreground">{nomeDe(s.userId)}</td>
                  )}
                  <td className="px-1 py-1.5 tabular-nums text-muted-foreground">
                    {dataHora(s.startedAt)}
                  </td>
                  <td className="px-1 py-1.5 tabular-nums text-muted-foreground">
                    {dataHora(s.endedAt)}
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono tabular-nums">
                    {formatHMS(s.seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Cartao>
    </div>
  );
}

function nomeDoProjeto(id: string, projetoPorId: Map<string, Project>): string {
  return id === SEM_PROJETO ? "Sem projeto" : (projetoPorId.get(id)?.name ?? "Projeto removido");
}

const dataHora = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const SIGLAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/**
 * Grade dia × hora. Mostra o expediente (7h às 19h) e se estende para as
 * horas de fora quando alguém trabalhou nelas. Uma cor só, do claro ao forte:
 * aqui o que importa é a quantidade, não a categoria.
 */
function MapaDeCalor({ calor }: { calor: number[][] }) {
  let de = 7;
  let ate = 18;
  calor.forEach((linha) =>
    linha.forEach((v, h) => {
      if (v > 0) {
        de = Math.min(de, h);
        ate = Math.max(ate, h);
      }
    }),
  );
  const horas = Array.from({ length: ate - de + 1 }, (_, i) => de + i);
  const max = Math.max(1, ...calor.flat());
  /* Fim de semana só aparece se tiver tempo nele. */
  const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => d < 5 || calor[d]!.some((v) => v > 0));
  const porDia = calor.map((l) => l.reduce((a, b) => a + b, 0));

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[520px] gap-[3px]"
        style={{ gridTemplateColumns: `2.5rem repeat(${horas.length}, minmax(0, 1fr)) 3.5rem` }}
      >
        <div />
        {horas.map((h) => (
          <div key={h} className="text-center text-[9px] tabular-nums text-muted-foreground">
            {h}h
          </div>
        ))}
        <div />
        {dias.map((d) => (
          <Linha key={d}>
            <div className="flex items-center text-[10px] font-medium text-muted-foreground">
              {SIGLAS[d]}
            </div>
            {horas.map((h) => {
              const v = calor[d]![h]!;
              const f = v / max;
              return (
                <div
                  key={h}
                  title={`${DIAS_DA_SEMANA[d]}, ${h}h–${h + 1}h: ${v > 0 ? duracao(v) : "nada"}`}
                  className="h-6 rounded-[3px]"
                  style={{
                    background:
                      v > 0
                        ? `color-mix(in oklab, var(--color-primary) ${Math.round(15 + f * 85)}%, transparent)`
                        : "color-mix(in oklab, var(--color-secondary) 70%, transparent)",
                  }}
                />
              );
            })}
            <div className="flex items-center justify-end text-[10px] tabular-nums text-muted-foreground">
              {porDia[d]! > 0 ? duracao(porDia[d]!) : "—"}
            </div>
          </Linha>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        menos
        {[0.15, 0.4, 0.65, 1].map((f) => (
          <span
            key={f}
            className="h-2.5 w-4 rounded-[2px]"
            style={{
              background: `color-mix(in oklab, var(--color-primary) ${Math.round(f * 100)}%, transparent)`,
            }}
          />
        ))}
        mais
      </div>
    </div>
  );
}

/** Uma linha da grade — `display: contents` para as células caírem no grid do pai. */
function Linha({ children }: { children: ReactNode }) {
  return <div className="contents">{children}</div>;
}
