import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Crown } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { scoreBarColor, scoreTextClass } from "@/lib/score";
import { formatDueBucket } from "@/lib/use-theme";
import type { CompletionEntry, Task, User } from "@/lib/fluxo-types";

/*
 * As peças gráficas da tela inicial (repaginada a pedido do usuário,
 * 13/10/2026: "tá sem graça, deixa mais visível com informações úteis").
 *
 * Tudo em SVG e CSS, nas cores do tema: escuro, claro e as paletas do app
 * funcionam sem mexer aqui, e nada pesa — sem biblioteca de gráfico.
 */

const DIA_MS = 86_400_000;

/* ————————————————— Anéis do placar ————————————————— */

export type Placar = { pct: number; assigned: number; done: number };

/**
 * Os três placares de uma vez, um dentro do outro — como os anéis de
 * crescimento de um tronco: o de fora é o mês, o do meio a semana, o de dentro
 * o dia. A cor segue a regra do placar (100% verde, abaixo vermelho, sem
 * tarefa cinza), a mesma da barra em todo o app.
 */
export function AneisDoPlacar({ dia, semana, mes }: { dia: Placar; semana: Placar; mes: Placar }) {
  const aneis = [
    { rotulo: "Mês", p: mes, r: 64 },
    { rotulo: "Semana", p: semana, r: 49 },
    { rotulo: "Hoje", p: dia, r: 34 },
  ];
  const ESPESSURA = 11;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0 -rotate-90" aria-hidden>
        {aneis.map(({ rotulo, p, r }, i) => {
          const volta = 2 * Math.PI * r;
          const fracao = p.assigned === 0 ? 0 : Math.min(p.pct, 100) / 100;
          return (
            <g key={rotulo}>
              <circle
                cx={80}
                cy={80}
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth={ESPESSURA}
                className="text-secondary"
              />
              <motion.circle
                cx={80}
                cy={80}
                r={r}
                fill="none"
                stroke={scoreBarColor(p.pct, p.assigned)}
                strokeWidth={ESPESSURA}
                strokeLinecap="round"
                strokeDasharray={volta}
                initial={{ strokeDashoffset: volta }}
                animate={{ strokeDashoffset: volta * (1 - fracao) }}
                transition={{ duration: 0.9, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />
            </g>
          );
        })}
      </svg>
      <dl className="space-y-2.5">
        {aneis.map(({ rotulo, p }) => (
          <div key={rotulo}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {rotulo}
            </dt>
            <dd className="flex items-baseline gap-1.5">
              <span
                className={`font-display text-xl font-bold tabular-nums leading-none ${scoreTextClass(p.pct, p.assigned)}`}
              >
                {p.assigned === 0 ? "—" : `${Math.round(p.pct)}%`}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {p.assigned === 0 ? "sem tarefas" : `${p.done}/${p.assigned}`}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ————————————————— Dias da semana ————————————————— */

const SEMANAS = 12;
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/**
 * Quais dias da semana são os mais cheios (pedido do usuário, 13/10/2026):
 * um mapa de calor de segunda a domingo com duas linhas — as tarefas que
 * vencem em cada dia e as que a pessoa conclui em cada dia, somadas nas
 * últimas 12 semanas. A cor é relativa ao dia mais forte de cada linha.
 */
export function DiasDaSemana({
  tasks,
  completions,
  userId,
}: {
  tasks: Task[];
  completions: CompletionEntry[];
  userId: string;
}) {
  const { linhas, maisCheio } = useMemo(() => {
    const desde = Date.now() - SEMANAS * 7 * DIA_MS;
    // getDay: 0 = domingo; aqui a semana começa na segunda.
    const indice = (d: Date) => (d.getDay() + 6) % 7;
    const prazos = Array<number>(7).fill(0);
    const feitas = Array<number>(7).fill(0);
    for (const t of tasks) {
      if (t.assigneeId !== userId || !t.dueDate) continue;
      const d = new Date(t.dueDate);
      if (d.getTime() < desde) continue;
      prazos[indice(d)]++;
    }
    for (const c of completions) {
      if (c.userId !== userId) continue;
      const d = new Date(c.at);
      if (d.getTime() < desde) continue;
      feitas[indice(d)]++;
    }
    const maior = prazos.indexOf(Math.max(...prazos));
    return {
      linhas: [
        { rotulo: "Vencem", valores: prazos, cor: "var(--color-warning)" },
        { rotulo: "Concluo", valores: feitas, cor: "var(--color-primary)" },
      ],
      maisCheio: prazos[maior]! > 0 ? maior : -1,
    };
  }, [tasks, completions, userId]);

  return (
    <div>
      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-1.5">
        <span />
        {DIAS.map((d, i) => (
          <span
            key={d}
            className={`text-center text-[10px] font-semibold ${i === maisCheio ? "text-foreground" : "text-muted-foreground"}`}
          >
            {d}
          </span>
        ))}
        {linhas.map((l) => {
          const max = Math.max(1, ...l.valores);
          return (
            <div key={l.rotulo} className="contents">
              <span className="flex items-center text-[11px] font-medium text-muted-foreground">
                {l.rotulo}
              </span>
              {l.valores.map((n, i) => {
                const forca = n === 0 ? 0 : 0.18 + (n / max) * 0.82;
                return (
                  <motion.div
                    key={i}
                    title={`${DIAS[i]}: ${n} ${n === 1 ? "tarefa" : "tarefas"}`}
                    className="flex h-10 items-center justify-center rounded-md text-xs font-bold tabular-nums"
                    style={{
                      background:
                        n === 0
                          ? "var(--color-secondary)"
                          : `color-mix(in oklab, ${l.cor} ${Math.round(forca * 100)}%, var(--color-secondary))`,
                      // No amarelo a letra escura lê melhor; no azul, branca quando a cor é forte.
                      color:
                        forca > 0.6 && l.cor !== "var(--color-warning)"
                          ? "white"
                          : "var(--color-foreground)",
                    }}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                  >
                    {n > 0 ? n : ""}
                  </motion.div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {maisCheio >= 0
          ? `Seu dia mais cheio de prazos é ${["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"][maisCheio]}. Somado das últimas 12 semanas.`
          : "Somado das últimas 12 semanas."}
      </p>
    </div>
  );
}

/* ————————————————— Minha carga (próximos dias) ————————————————— */

/**
 * O que está aberto comigo e quando vence: as atrasadas numa coluna à parte,
 * em vermelho, e os próximos 10 dias. Fim de semana fica mais apagado — é para
 * enxergar onde a semana aperta antes de ela chegar.
 */
export function MinhaCarga({ abertas }: { abertas: Task[] }) {
  const { colunas, atrasadas, semPrazo, maximo } = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const colunas = Array.from({ length: 10 }, (_, i) => {
      const dia = new Date(hoje.getTime() + i * DIA_MS);
      return { dia, n: 0, fds: dia.getDay() === 0 || dia.getDay() === 6 };
    });
    let atrasadas = 0;
    let semPrazo = 0;
    for (const t of abertas) {
      const b = formatDueBucket(t.dueDate);
      if (b === "sem_prazo") semPrazo++;
      else if (b === "atrasada") atrasadas++;
      else {
        const d = new Date(t.dueDate!);
        d.setHours(0, 0, 0, 0);
        const i = Math.round((d.getTime() - hoje.getTime()) / DIA_MS);
        if (i >= 0 && i < colunas.length) colunas[i]!.n++;
      }
    }
    const maximo = Math.max(1, atrasadas, ...colunas.map((c) => c.n));
    return { colunas, atrasadas, semPrazo, maximo };
  }, [abertas]);

  const ALTURA = 96;
  const barra = (n: number) => (n === 0 ? 3 : Math.max(8, (n / maximo) * ALTURA));

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: ALTURA + 36 }}>
        <Coluna
          rotulo="Atras."
          sub=""
          n={atrasadas}
          altura={barra(atrasadas)}
          cor="var(--color-destructive)"
          destaque
        />
        <div className="mx-1 h-full w-px self-stretch bg-border" />
        {colunas.map((c, i) => (
          <Coluna
            key={c.dia.getTime()}
            rotulo={
              i === 0 ? "Hoje" : c.dia.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)
            }
            sub={String(c.dia.getDate())}
            n={c.n}
            altura={barra(c.n)}
            cor={i === 0 ? "var(--color-warning)" : "var(--color-primary)"}
            apagada={c.fds}
            indice={i + 1}
          />
        ))}
      </div>
      {semPrazo > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          + {semPrazo} {semPrazo === 1 ? "tarefa sem prazo" : "tarefas sem prazo"}
        </p>
      )}
    </div>
  );
}

function Coluna({
  rotulo,
  sub,
  n,
  altura,
  cor,
  destaque = false,
  apagada = false,
  indice = 0,
}: {
  rotulo: string;
  sub: string;
  n: number;
  altura: number;
  cor: string;
  destaque?: boolean;
  apagada?: boolean;
  indice?: number;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 ${apagada ? "opacity-45" : ""}`}
      title={`${rotulo} ${sub}: ${n} ${n === 1 ? "tarefa" : "tarefas"}`}
    >
      <span
        className={`text-[11px] font-bold tabular-nums ${n === 0 ? "text-muted-foreground/50" : destaque ? "text-destructive" : "text-foreground"}`}
      >
        {n}
      </span>
      <motion.div
        className="w-full max-w-7 rounded-t-md"
        style={{ background: n === 0 ? "var(--color-secondary)" : cor }}
        initial={{ height: 3 }}
        animate={{ height: altura }}
        transition={{ duration: 0.6, delay: 0.1 + indice * 0.03, ease: [0.22, 1, 0.36, 1] }}
      />
      <span className="text-[10px] font-medium capitalize leading-none text-muted-foreground">
        {rotulo}
      </span>
      <span className="h-3 text-[9px] leading-none text-muted-foreground/70">{sub}</span>
    </div>
  );
}

/* ————————————————— Pódio do ranking ————————————————— */

/**
 * Os três primeiros num pódio (2º, 1º, 3º, como no esporte); o resto segue na
 * lista embaixo. Quem não tem tarefa no período não sobe no pódio.
 */
export function Podio({
  pessoas,
  placar,
}: {
  pessoas: User[];
  placar: Map<string, { pct: number; assigned: number }>;
}) {
  const top = pessoas.filter((u) => (placar.get(u.id)?.assigned ?? 0) > 0).slice(0, 3);
  if (top.length === 0) return null;
  const ordem = [top[1], top[0], top[2]];
  const ALTURAS = [56, 80, 40];
  const LUGAR = [2, 1, 3];
  const CORES = ["oklch(0.82 0.02 260)", "oklch(0.8 0.15 80)", "oklch(0.7 0.1 50)"];
  return (
    <div className="flex items-end justify-center gap-3 border-b border-border pb-0 pt-2">
      {ordem.map((u, i) => {
        if (!u) return <div key={i} className="w-24" />;
        const s = placar.get(u.id)!;
        return (
          <div key={u.id} className="flex w-24 flex-col items-center">
            <div className="relative">
              {LUGAR[i] === 1 && (
                <Crown className="absolute -top-4 left-1/2 h-4 w-4 -translate-x-1/2 text-amber-500" />
              )}
              <UserAvatar
                nome={u.name}
                iniciais={u.avatar}
                className={`${LUGAR[i] === 1 ? "h-12 w-12 text-sm" : "h-10 w-10 text-xs"} ring-2 ring-card`}
              />
            </div>
            <div className="mt-1 w-full truncate text-center text-[11px] font-semibold">
              {u.name.split(" ")[0]}
            </div>
            <div
              className={`text-[11px] font-bold tabular-nums ${scoreTextClass(s.pct, s.assigned)}`}
            >
              {Math.round(s.pct)}%
            </div>
            <motion.div
              className="mt-1 flex w-full items-start justify-center rounded-t-lg pt-1.5 font-display text-lg font-bold text-black/60"
              style={{ background: CORES[i] }}
              initial={{ height: 0 }}
              animate={{ height: ALTURAS[i] }}
              transition={{ duration: 0.55, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              {LUGAR[i]}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

/* ————————————————— Seu ritmo (no topo) ————————————————— */

/** Curva suave pelos pontos (Catmull-Rom convertida em Bézier). */
function curva(p: [number, number][]): string {
  if (p.length < 2) return "";
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * "Seu ritmo": as conclusões por dia dos últimos 30 dias numa linha grande,
 * solta no topo da tela inicial — a mesma minilinha da tabela dos Relatórios,
 * que o usuário gostou e pediu em destaque (13/10/2026). Passar o mouse mostra
 * o dia.
 */
export function SeuRitmo({
  completions,
  userId,
}: {
  completions: CompletionEntry[];
  userId: string;
}) {
  const DIAS_RITMO = 30;
  const [foco, setFoco] = useState<number | null>(null);
  const { dias, total, media, melhor } = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias = Array.from({ length: DIAS_RITMO }, (_, i) => ({
      dia: new Date(hoje.getTime() - (DIAS_RITMO - 1 - i) * DIA_MS),
      n: 0,
    }));
    const inicio = dias[0]!.dia.getTime();
    for (const c of completions) {
      if (c.userId !== userId) continue;
      const d = new Date(c.at);
      d.setHours(0, 0, 0, 0);
      const i = Math.round((d.getTime() - inicio) / DIA_MS);
      if (i >= 0 && i < DIAS_RITMO) dias[i]!.n++;
    }
    const total = dias.reduce((s, d) => s + d.n, 0);
    const melhor = Math.max(0, ...dias.map((d) => d.n));
    return { dias, total, media: total / DIAS_RITMO, melhor };
  }, [completions, userId]);

  const W = 300;
  const H = 90;
  const max = Math.max(1, melhor);
  const pontos = dias.map((d, i): [number, number] => [
    (i / (DIAS_RITMO - 1)) * W,
    H - 6 - (d.n / max) * (H - 14),
  ]);
  const linha = curva(pontos);
  const area = `${linha} L${W},${H} L0,${H} Z`;
  const yMedia = H - 6 - (media / max) * (H - 14);
  const atual = foco !== null ? dias[foco]! : null;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Seu ritmo
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {atual
            ? `${atual.dia.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}: ${atual.n} ${atual.n === 1 ? "concluída" : "concluídas"}`
            : `${total} concluídas em 30 dias · recorde ${melhor}/dia`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1 h-24 w-full overflow-visible"
        onMouseLeave={() => setFoco(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (DIAS_RITMO - 1));
          setFoco(Math.max(0, Math.min(DIAS_RITMO - 1, i)));
        }}
        role="img"
        aria-label={`Seu ritmo: ${total} tarefas concluídas nos últimos 30 dias`}
      >
        <defs>
          <linearGradient id="ritmo-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {media > 0 && (
          <line
            x1={0}
            x2={W}
            y1={yMedia}
            y2={yMedia}
            stroke="var(--color-muted-foreground)"
            strokeOpacity={0.35}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <motion.path
          d={area}
          fill="url(#ritmo-area)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        />
        <motion.path
          d={linha}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
        {foco !== null && (
          <line
            x1={pontos[foco]![0]}
            x2={pontos[foco]![0]}
            y1={0}
            y2={H}
            stroke="var(--color-primary)"
            strokeOpacity={0.35}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>há 30 dias</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t border-dashed border-muted-foreground/60" />
          média {media.toFixed(1).replace(".", ",")}/dia
        </span>
        <span>hoje</span>
      </div>
    </div>
  );
}
