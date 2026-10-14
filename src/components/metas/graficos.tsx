import { motion } from "framer-motion";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { UserAvatar } from "@/components/user-avatar";
import type { User } from "@/lib/fluxo-types";
import { scoreBarColor, scoreTone } from "@/lib/score";
import { porcentagensInteiras, type Contagem, type Fatia } from "./calculo";
import { ESTADOS, corDoSetor, fmtPct } from "./formato";

/*
 * Gráficos da aba Metas & Score (13/10/2026). Só tokens do tema — nada de cor
 * fixa — para valer igual no claro, no escuro e nas paletas. As dicas são
 * desenhadas à mão: o tooltip padrão do Recharts pinta o texto de preto e some
 * no tema escuro.
 */

export function Avatar({ user, className }: { user: User; className: string }) {
  return (
    <UserAvatar
      nome={user.name}
      iniciais={user.avatar}
      className={`${className} text-white`}
      style={{ background: corDoSetor(user.sector) }}
    />
  );
}

export function Cartao({
  titulo,
  subtitulo,
  acoes,
  className = "",
  children,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5 ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold tracking-tight">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitulo}</p>}
        </div>
        {acoes}
      </header>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function Vazio({ children, altura = "h-40" }: { children: ReactNode; altura?: string }) {
  return (
    <div
      className={`flex ${altura} items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-xs text-muted-foreground`}
    >
      <div className="max-w-xs">{children}</div>
    </div>
  );
}

/* ————— Anel do score ————— */

/**
 * Medidor de 270°: o fim do arco é a meta (100%). A cor segue a regra da casa
 * (`scoreBarColor`): verde só em 100%, vermelho abaixo, apagado sem tarefa.
 */
export function AnelDoScore({
  pct,
  assigned,
  tamanho = 180,
  legenda = "score",
}: {
  pct: number;
  assigned: number;
  tamanho?: number;
  legenda?: string;
}) {
  const traco = Math.max(10, Math.round(tamanho * 0.085));
  const r = (tamanho - traco) / 2;
  const volta = 2 * Math.PI * r;
  const arco = volta * 0.75;
  const valor = assigned === 0 ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  const cor = scoreBarColor(pct, assigned);
  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg
        width={tamanho}
        height={tamanho}
        viewBox={`0 0 ${tamanho} ${tamanho}`}
        className="rotate-135"
        role="img"
        aria-label={assigned === 0 ? "Sem tarefas no período" : `Score ${Math.round(pct)}% de 100%`}
      >
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke="var(--color-secondary)"
          strokeWidth={traco}
          strokeLinecap="round"
          strokeDasharray={`${arco} ${volta}`}
        />
        <motion.circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth={traco}
          strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${volta}` }}
          animate={{ strokeDasharray: `${Math.max(valor > 0 ? 0.001 : 0, arco * valor)} ${volta}` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-display font-bold leading-none tabular-nums tracking-tight"
          style={{
            fontSize: tamanho * 0.25,
            color: assigned === 0 ? "var(--color-muted-foreground)" : cor,
          }}
        >
          {assigned === 0 ? "—" : `${Math.round(pct)}%`}
        </span>
        <span className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {legenda}
        </span>
      </div>
      <span
        className="absolute text-[10px] font-semibold text-muted-foreground"
        style={{ right: tamanho * 0.06, bottom: tamanho * 0.04 }}
      >
        meta 100%
      </span>
    </div>
  );
}

/* ————— Distribuição ————— */

/**
 * Rosca com os QUATRO estados. A versão antiga listava só três (no prazo, em
 * atraso, perdidas) e deixava de fora as pendentes — 13 + 0 + 0 de 26 não
 * fechava 100% e parecia erro de conta. Agora a soma é sempre o total.
 */
export function Distribuicao({ contagem, grande }: { contagem: Contagem; grande?: boolean }) {
  const valores = ESTADOS.map((e) => contagem[e.chave]);
  const pcts = porcentagensInteiras(valores);
  const dados = ESTADOS.map((e, i) => ({ ...e, valor: valores[i] })).filter((d) => d.valor > 0);
  const lado = grande ? 200 : 160;
  if (contagem.assigned === 0) return <Vazio>Nenhuma tarefa com prazo neste período.</Vazio>;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
      <div className="relative shrink-0" style={{ width: lado, height: lado }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={dados}
              dataKey="valor"
              nameKey="rotulo"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={dados.length > 1 ? 2 : 0}
              stroke="var(--color-card)"
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive
            >
              {dados.map((d) => (
                <Cell key={d.chave} fill={d.cor} fillOpacity={d.opacidade} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold leading-none tabular-nums">
            {contagem.assigned}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            tarefas
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {ESTADOS.map((e, i) => (
          <li key={e.chave} className="flex items-center gap-2.5 text-xs">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: e.cor, opacity: e.opacidade }}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{e.rotulo}</div>
              <div className="truncate text-[10px] text-muted-foreground">{e.nota}</div>
            </div>
            <span className="font-display text-sm font-semibold tabular-nums">{valores[i]}</span>
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
              {pcts[i]}%
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span>Total</span>
          <span className="tabular-nums">{contagem.assigned} tarefas · 100%</span>
        </li>
      </ul>
    </div>
  );
}

/* ————— Evolução do score ————— */

const CORES_PESSOAS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const EIXO = {
  tick: { fontSize: 10, fill: "var(--color-muted-foreground)" },
  axisLine: false,
  tickLine: false,
} as const;

type LinhaDoGrafico = {
  rotulo: string;
  rotuloLongo: string;
  time: number | null;
  contagem: Contagem;
  [chave: string]: unknown;
};

function DicaDaEvolucao({
  active,
  payload,
  pessoas,
}: {
  active?: boolean;
  payload?: { payload?: LinhaDoGrafico }[];
  pessoas?: { user: User; cor: string }[];
}) {
  const linha = payload?.[0]?.payload;
  if (!active || !linha) return null;
  const c = linha.contagem;
  return (
    <div className="min-w-[170px] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-semibold capitalize">{linha.rotuloLongo}</div>
      {pessoas && pessoas.length > 0 ? (
        <ul className="space-y-0.5">
          {pessoas.map((p) => {
            const v = linha[`p_${p.user.id}`] as number | null | undefined;
            return (
              <li key={p.user.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.cor }} />
                  <span className="truncate">{p.user.name.split(" ")[0]}</span>
                </span>
                <span className="font-medium tabular-nums">{fmtPct(v)}</span>
              </li>
            );
          })}
        </ul>
      ) : c.assigned === 0 ? (
        <div className="text-muted-foreground">Sem tarefa com prazo</div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span>Score do time</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: scoreBarColor(c.pct ?? 0, c.assigned) }}
            >
              {fmtPct(c.pct)}
            </span>
          </div>
          <div className="mt-1 space-y-0.5 border-t border-border pt-1 text-muted-foreground">
            {ESTADOS.map((e) =>
              c[e.chave] > 0 ? (
                <div key={e.chave} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: e.cor, opacity: e.opacidade }}
                    />
                    {e.rotulo}
                  </span>
                  <span className="tabular-nums">{c[e.chave]}</span>
                </div>
              ) : null,
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Bolinha de cada dia na cor do resultado: verde em 100%, vermelho abaixo. */
function PontoDoDia(props: { cx?: number; cy?: number; payload?: LinhaDoGrafico }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload || payload.time == null) return <g />;
  const cor = scoreBarColor(payload.time, payload.contagem.assigned);
  return <circle cx={cx} cy={cy} r={3.5} fill={cor} stroke="var(--color-card)" strokeWidth={1.5} />;
}

export function GraficoEvolucao({
  fatias,
  serieDoTime,
  porPessoa,
  altura = 240,
}: {
  fatias: Fatia[];
  serieDoTime: Contagem[];
  /** Quando vem, desenha uma linha por pessoa no lugar da área do time. */
  porPessoa?: { user: User; serie: Contagem[] }[];
  altura?: number;
}) {
  const pessoas = useMemo(
    () => porPessoa?.map((p, i) => ({ ...p, cor: CORES_PESSOAS[i % CORES_PESSOAS.length] })),
    [porPessoa],
  );
  const dados = useMemo(() => {
    const linhas: LinhaDoGrafico[] = [];
    fatias.forEach((f, i) => {
      if (f.futura) return;
      const c = serieDoTime[i];
      const linha: LinhaDoGrafico = {
        rotulo: f.rotulo,
        rotuloLongo: f.rotuloLongo,
        time: c.pct,
        contagem: c,
      };
      pessoas?.forEach((p) => {
        linha[`p_${p.user.id}`] = p.serie[i]?.pct ?? null;
      });
      linhas.push(linha);
    });
    return linhas;
  }, [fatias, serieDoTime, pessoas]);

  if (!dados.some((d) => d.contagem.assigned > 0)) {
    return (
      <Vazio altura="h-56">
        Ainda não há tarefa com prazo nestes dias para desenhar a evolução.
      </Vazio>
    );
  }

  return (
    <div style={{ height: altura }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="metas-area-time" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.6} />
          <XAxis dataKey="rotulo" {...EIXO} minTickGap={10} />
          <YAxis
            {...EIXO}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            width={44}
          />
          <ReferenceLine
            y={100}
            stroke="var(--color-success)"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            label={{
              value: "meta",
              position: "insideTopRight",
              fill: "var(--color-success)",
              fontSize: 10,
            }}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border)" }}
            content={<DicaDaEvolucao pessoas={pessoas} />}
          />
          {pessoas && pessoas.length > 0 ? (
            pessoas.map((p) => (
              <Line
                key={p.user.id}
                type="monotone"
                dataKey={`p_${p.user.id}`}
                name={p.user.name}
                stroke={p.cor}
                strokeWidth={2}
                dot={{ r: 2.5, fill: p.cor, strokeWidth: 0 }}
                connectNulls
                isAnimationActive
              />
            ))
          ) : (
            <>
              <Area
                type="monotone"
                dataKey="time"
                stroke="none"
                fill="url(#metas-area-time)"
                connectNulls
                isAnimationActive
              />
              <Line
                type="monotone"
                dataKey="time"
                name="Score do time"
                stroke="var(--color-primary)"
                strokeWidth={2.5}
                dot={<PontoDoDia />}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {pessoas && pessoas.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {pessoas.map((p) => (
            <li key={p.user.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.cor }} />
              {p.user.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ————— Minilinha do ranking ————— */

/**
 * O score de cada dia da pessoa, em miniatura. A linha tracejada no topo é a
 * meta (100%); dia sem tarefa vira buraco, não zero.
 */
export function MiniScore({ serie, fatias }: { serie: Contagem[]; fatias: Fatia[] }) {
  const w = 96;
  const h = 26;
  const pontos = serie
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => !fatias[i]?.futura)
    .map(({ c }, k, todos) => ({
      x: todos.length > 1 ? (k / (todos.length - 1)) * w : w / 2,
      y: c.pct == null ? null : h - 3 - (c.pct / 100) * (h - 6),
      c,
    }));
  if (!pontos.some((p) => p.y != null)) {
    return <span className="text-[10px] text-muted-foreground">sem histórico</span>;
  }
  // Trechos contínuos: dia sem tarefa quebra a linha.
  const trechos: string[] = [];
  let atual: string[] = [];
  for (const p of pontos) {
    if (p.y == null) {
      if (atual.length) trechos.push(atual.join(" "));
      atual = [];
    } else atual.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  if (atual.length) trechos.push(atual.join(" "));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <line
        x1={0}
        x2={w}
        y1={3}
        y2={3}
        stroke="var(--color-success)"
        strokeOpacity={0.5}
        strokeDasharray="2 3"
      />
      {trechos.map((t) => (
        <polyline
          key={t}
          points={t}
          fill="none"
          stroke="var(--color-primary)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {pontos.map((p, k) =>
        p.y == null ? null : (
          <circle
            key={k}
            cx={p.x}
            cy={p.y}
            r={2}
            fill={scoreBarColor(p.c.pct ?? 0, p.c.assigned)}
          />
        ),
      )}
    </svg>
  );
}

/* ————— Mapa de calor pessoa × dia ————— */

function estiloDaCelula(c: Contagem, futura: boolean): CSSProperties {
  if (c.assigned === 0) return { background: "var(--color-secondary)", opacity: 0.45 };
  const concluidasOuVencidas = c.onTime + c.late + c.missed;
  // Só tarefa em aberto, ainda no prazo: não é fracasso, é "a fazer".
  if (futura || concluidasOuVencidas === 0) {
    return {
      background: "transparent",
      border: "1.5px dashed var(--color-muted-foreground)",
      opacity: 0.6,
    };
  }
  const pct = c.pct ?? 0;
  if (scoreTone(pct, c.assigned) === "perfect") return { background: "var(--color-success)" };
  const forca = Math.round(35 + (100 - pct) * 0.65);
  return {
    background: `color-mix(in oklch, var(--color-destructive) ${forca}%, var(--color-card))`,
    ...(c.pending > 0
      ? { outline: "1.5px dashed var(--color-muted-foreground)", outlineOffset: -1 }
      : {}),
  };
}

function textoDaCelula(nome: string, f: Fatia, c: Contagem): string {
  if (c.assigned === 0) return `${nome} · ${f.rotuloLongo}: sem tarefa com prazo`;
  const partes = [
    c.onTime && `${c.onTime} no prazo`,
    c.late && `${c.late} com atraso`,
    c.pending && `${c.pending} pendente${c.pending > 1 ? "s" : ""}`,
    c.missed && `${c.missed} perdida${c.missed > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return `${nome} · ${f.rotuloLongo}: ${fmtPct(c.pct)} — ${partes.join(", ")}`;
}

export function MapaDeCalor({
  linhas,
  fatias,
  aoAbrir,
  grande,
}: {
  linhas: { user: User; serie: Contagem[] }[];
  fatias: Fatia[];
  aoAbrir: (userId: string) => void;
  grande?: boolean;
}) {
  const [foco, setFoco] = useState<string | null>(null);
  // Fim de semana e feriado sem tarefa de ninguém só ocupariam espaço.
  const colunas = useMemo(
    () =>
      fatias
        .map((f, i) => ({ f, i }))
        .filter(({ f, i }) => f.util || linhas.some((l) => l.serie[i]?.assigned > 0)),
    [fatias, linhas],
  );
  if (linhas.length === 0 || colunas.length === 0) {
    return <Vazio>Selecione ao menos um colaborador.</Vazio>;
  }
  const lado = grande ? 26 : 20;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const porDia =
    colunas.length <= 31 &&
    fatias[0] &&
    fatias[0].end.getTime() - fatias[0].start.getTime() <= 86_400_000;
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <table className="border-separate" style={{ borderSpacing: 3 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-1 bg-card" />
              {colunas.map(({ f }) => {
                const ehHoje = f.start.getTime() === hoje.getTime();
                return (
                  <th
                    key={f.start.getTime()}
                    className={`p-0 text-center text-[9px] font-medium leading-tight ${
                      ehHoje ? "text-primary" : "text-muted-foreground"
                    }`}
                    style={{ minWidth: lado }}
                    title={f.rotuloLongo}
                  >
                    {porDia ? (
                      <>
                        <div className="uppercase">
                          {f.start.toLocaleDateString("pt-BR", { weekday: "narrow" })}
                        </div>
                        <div className="tabular-nums">{f.start.getDate()}</div>
                      </>
                    ) : (
                      <div className="tabular-nums">{f.rotulo}</div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr
                key={l.user.id}
                onMouseEnter={() => setFoco(l.user.id)}
                onMouseLeave={() => setFoco(null)}
              >
                <th className="sticky left-0 z-1 bg-card pr-2 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => aoAbrir(l.user.id)}
                    className={`flex max-w-40 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs transition hover:bg-secondary ${
                      foco === l.user.id ? "text-foreground" : "text-muted-foreground"
                    }`}
                    title={`Ver as tarefas de ${l.user.name}`}
                  >
                    <Avatar user={l.user} className="h-5 w-5 text-[8px]" />
                    <span className="truncate">{l.user.name.split(" ").slice(0, 2).join(" ")}</span>
                  </button>
                </th>
                {colunas.map(({ f, i }) => {
                  const c = l.serie[i];
                  const texto = textoDaCelula(l.user.name, f, c);
                  return (
                    <td key={f.start.getTime()} className="p-0">
                      <div
                        title={texto}
                        aria-label={texto}
                        className="rounded-[5px] transition-transform hover:scale-125"
                        style={{ width: lado, height: lado, ...estiloDaCelula(c, f.futura) }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: "var(--color-success)" }} />
          100% (meta)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{
              background: "color-mix(in oklch, var(--color-destructive) 45%, var(--color-card))",
            }}
          />
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{ background: "var(--color-destructive)" }}
          />
          abaixo (mais forte = pior)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{ border: "1.5px dashed var(--color-muted-foreground)", opacity: 0.6 }}
          />
          em aberto, no prazo
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{ background: "var(--color-secondary)", opacity: 0.45 }}
          />
          sem tarefa
        </li>
      </ul>
    </div>
  );
}
