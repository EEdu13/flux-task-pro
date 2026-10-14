import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { priorityColor, priorityLabels, type Priority, type Task } from "@/lib/fluxo-types";
import { rotuloDoPrazo, tarefaVencida } from "@/lib/prazo";
import {
  EIXO,
  FAIXAS_DE_IDADE,
  diasUteisDeAtraso,
  fluxoDoBacklog,
  idadeEmDias,
  indiceDoBalde,
  type Balde,
  type Entrega,
} from "./analise";
import { Cartao, DicaDoGrafico, Legenda, Vazio } from "./pecas";

/**
 * O bloco "Entregas" dos Relatórios (13/10/2026): o ritmo de conclusões com o
 * no prazo separado do atrasado, entrada × saída com o backlog, a idade e a
 * prioridade do que está aberto e a lista do que já venceu.
 *
 * "No prazo" segue a regra do DIA útil (`dias-uteis.ts`), não o `onTime`
 * gravado na conclusão — ver `avaliarEntregas`.
 */

const COR_NO_PRAZO = "var(--color-success)";
const COR_ATRASO = "var(--color-destructive)";
const contagem = (v: number) => (v === 1 ? "1 tarefa" : `${Math.round(v)} tarefas`);

export function SecaoEntregas({
  entregas,
  baldes,
  granularidade,
  tarefasEscopo,
  multi,
  nomeDe,
}: {
  /** Conclusões do escopo dentro do período. */
  entregas: Entrega[];
  baldes: Balde[];
  granularidade: "dia" | "semana";
  /** Todas as tarefas de quem está no escopo (abertas e concluídas). */
  tarefasEscopo: Task[];
  multi: boolean;
  nomeDe: (userId: string) => string;
}) {
  const abertas = useMemo(
    () => tarefasEscopo.filter((t) => t.status !== "concluida"),
    [tarefasEscopo],
  );

  const ritmo = useMemo(() => {
    const linhas = baldes.map((b) => ({ rotulo: b.rotulo, noPrazo: 0, atrasada: 0 }));
    for (const e of entregas) {
      const i = indiceDoBalde(baldes, e.at);
      if (i < 0) continue;
      if (e.noPrazo) linhas[i]!.noPrazo++;
      else linhas[i]!.atrasada++;
    }
    return linhas;
  }, [entregas, baldes]);

  const fluxo = useMemo(
    () => fluxoDoBacklog(tarefasEscopo, entregas, baldes),
    [tarefasEscopo, entregas, baldes],
  );

  const idades = useMemo(() => {
    const faixas = FAIXAS_DE_IDADE.map((f) => ({ ...f, atrasadas: 0, emDia: 0 }));
    for (const t of abertas) {
      const dias = idadeEmDias(t);
      const f = faixas.find((x) => dias <= x.ate)!;
      if (tarefaVencida(t)) f.atrasadas++;
      else f.emDia++;
    }
    return faixas;
  }, [abertas]);

  const prioridades = useMemo(
    () =>
      (["alta", "media", "baixa"] as Priority[]).map((p) => {
        const da = abertas.filter((t) => t.priority === p);
        return { p, abertas: da.length, atrasadas: da.filter((t) => tarefaVencida(t)).length };
      }),
    [abertas],
  );

  const vencidas = useMemo(() => {
    const agora = Date.now();
    return abertas
      .filter((t) => tarefaVencida(t, agora) && t.dueDate)
      .map((t) => ({ t, atraso: diasUteisDeAtraso(t.dueDate!, agora) }))
      .sort((a, b) => b.atraso - a.atraso);
  }, [abertas]);

  const noPrazo = entregas.filter((e) => e.noPrazo).length;
  const maxIdade = Math.max(1, ...idades.map((f) => f.atrasadas + f.emDia));
  const maxPrio = Math.max(1, ...prioridades.map((p) => p.abertas));
  const backlogIni = fluxo[0]?.backlog ?? 0;
  const backlogFim = fluxo[fluxo.length - 1]?.backlog ?? 0;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Cartao
        className="xl:col-span-2"
        titulo={`Concluídas por ${granularidade === "dia" ? "dia" : "semana"}`}
        subtitulo={
          entregas.length
            ? `${entregas.length} no período · ${Math.round((noPrazo / entregas.length) * 100)}% no prazo (dia útil do prazo)`
            : "Nenhuma conclusão no período."
        }
      >
        {entregas.length === 0 ? (
          <Vazio altura="h-56">
            Nada concluído neste período e escopo. Tente um período maior ou outra pessoa no seletor
            acima.
          </Vazio>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={ritmo} margin={{ left: -24, right: 4, top: 8, bottom: 0 }}>
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--color-border)"
                    strokeOpacity={0.6}
                  />
                  <XAxis dataKey="rotulo" {...EIXO} minTickGap={12} />
                  <YAxis {...EIXO} allowDecimals={false} width={44} />
                  <Tooltip
                    cursor={{ fill: "var(--color-secondary)", opacity: 0.5 }}
                    content={<DicaDoGrafico formatar={contagem} />}
                  />
                  <Bar
                    dataKey="noPrazo"
                    name="No prazo"
                    stackId="e"
                    fill={COR_NO_PRAZO}
                    stroke="var(--color-card)"
                    strokeWidth={1}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="atrasada"
                    name="Com atraso"
                    stackId="e"
                    fill={COR_ATRASO}
                    stroke="var(--color-card)"
                    strokeWidth={1}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legenda
              itens={[
                { rotulo: "No prazo", cor: COR_NO_PRAZO },
                { rotulo: "Com atraso", cor: COR_ATRASO },
              ]}
            />
          </>
        )}
      </Cartao>

      <Cartao titulo="Prioridade do que está aberto" subtitulo="Abertas e, delas, as já vencidas.">
        {abertas.length === 0 ? (
          <Vazio>Nenhuma tarefa aberta no escopo.</Vazio>
        ) : (
          <ul className="space-y-3.5">
            {prioridades.map(({ p, abertas: n, atrasadas }) => (
              <li key={p}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: priorityColor[p] }}
                    />
                    {priorityLabels[p]}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    <b className="text-foreground">{n}</b> abertas
                    {atrasadas > 0 && (
                      <span className="text-destructive"> · {atrasadas} vencidas</span>
                    )}
                  </span>
                </div>
                <BarraDupla vermelho={atrasadas} resto={n - atrasadas} max={maxPrio} />
              </li>
            ))}
            <li className="pt-1 text-[11px] text-muted-foreground">
              {abertas.length} abertas no total · {abertas.filter((t) => !t.dueDate).length} sem
              prazo
            </li>
          </ul>
        )}
      </Cartao>

      <Cartao
        className="xl:col-span-2"
        titulo="Entrada × saída"
        subtitulo={`Tarefas criadas e concluídas por ${granularidade}; embaixo, as pendências acumuladas (${backlogIni} → ${backlogFim}).`}
      >
        <div className="h-44">
          <ResponsiveContainer>
            <BarChart data={fluxo} margin={{ left: -24, right: 4, top: 8, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.6} />
              <XAxis dataKey="rotulo" {...EIXO} minTickGap={12} />
              <YAxis {...EIXO} allowDecimals={false} width={44} />
              <Tooltip
                cursor={{ fill: "var(--color-secondary)", opacity: 0.5 }}
                content={<DicaDoGrafico formatar={contagem} />}
              />
              <Bar
                dataKey="criadas"
                name="Criadas"
                fill="var(--color-chart-3)"
                radius={[3, 3, 0, 0]}
                maxBarSize={16}
                isAnimationActive={false}
              />
              <Bar
                dataKey="concluidas"
                name="Concluídas"
                fill="var(--color-chart-1)"
                radius={[3, 3, 0, 0]}
                maxBarSize={16}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Legenda
          itens={[
            { rotulo: "Criadas", cor: "var(--color-chart-3)" },
            { rotulo: "Concluídas", cor: "var(--color-chart-1)" },
          ]}
        />
        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pendências acumuladas
        </div>
        <div className="h-20">
          <ResponsiveContainer>
            <AreaChart data={fluxo} margin={{ left: -24, right: 4, top: 6, bottom: 0 }}>
              <XAxis dataKey="rotulo" hide />
              <YAxis {...EIXO} allowDecimals={false} width={44} domain={["auto", "auto"]} />
              <Tooltip content={<DicaDoGrafico formatar={contagem} />} />
              <Area
                type="monotone"
                dataKey="backlog"
                name="Pendências"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="var(--color-primary)"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Cartao>

      <Cartao titulo="Idade do que está aberto" subtitulo="Dias desde a criação da tarefa.">
        {abertas.length === 0 ? (
          <Vazio>Nenhuma tarefa aberta no escopo.</Vazio>
        ) : (
          <>
            <ul className="space-y-3">
              {idades.map((f) => (
                <li key={f.rotulo}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{f.rotulo}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <b className="text-foreground">{f.atrasadas + f.emDia}</b>
                      {f.atrasadas > 0 && (
                        <span className="text-destructive"> · {f.atrasadas} vencidas</span>
                      )}
                    </span>
                  </div>
                  <BarraDupla vermelho={f.atrasadas} resto={f.emDia} max={maxIdade} />
                </li>
              ))}
            </ul>
            <Legenda
              itens={[
                { rotulo: "Vencidas", cor: COR_ATRASO },
                { rotulo: "Em dia ou sem prazo", cor: "var(--color-chart-3)" },
              ]}
            />
          </>
        )}
      </Cartao>

      <Cartao
        className="xl:col-span-3"
        titulo="Vencidas agora"
        subtitulo="Tarefas abertas com o prazo já passado, da mais atrasada para a menos — em dias úteis."
      >
        {vencidas.length === 0 ? (
          <Vazio altura="h-24">Nenhuma tarefa vencida em aberto.</Vazio>
        ) : (
          <>
            <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
              {vencidas.slice(0, 12).map(({ t, atraso }) => (
                <li
                  key={t.id}
                  className="flex min-w-0 items-center gap-2 border-b border-border/50 py-1.5 text-xs"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: priorityColor[t.priority] }}
                    title={`Prioridade ${priorityLabels[t.priority]}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {multi && (
                    <span className="hidden shrink-0 text-muted-foreground sm:inline">
                      {nomeDe(t.assigneeId)}
                    </span>
                  )}
                  <span
                    className="shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive"
                    title={`Prazo: ${rotuloDoPrazo(t)}`}
                  >
                    {atraso} d.u.
                  </span>
                </li>
              ))}
            </ul>
            {vencidas.length > 12 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                e mais {vencidas.length - 12} vencidas.
              </p>
            )}
          </>
        )}
      </Cartao>
    </div>
  );
}

/** Barra fina com a parte vencida em vermelho e o resto na cor neutra de série. */
function BarraDupla({ vermelho, resto, max }: { vermelho: number; resto: number; max: number }) {
  return (
    <div className="mt-1 flex h-2 gap-[2px] overflow-hidden rounded-full bg-secondary">
      {vermelho > 0 && (
        <div
          className="h-full rounded-full"
          style={{ width: `${(vermelho / max) * 100}%`, background: COR_ATRASO }}
        />
      )}
      {resto > 0 && (
        <div
          className="h-full rounded-full"
          style={{ width: `${(resto / max) * 100}%`, background: "var(--color-chart-3)" }}
        />
      )}
    </div>
  );
}
