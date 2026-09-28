import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Minus, TrendingUp } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";

/* "Últimos 7 dias · time" na tela inicial.

   Era só um gráfico de colunas no alto do card e um total embaixo; o card
   estica até a altura do "Foco de hoje", ao lado, e metade dele ficava vazia.
   Agora o espaço conta a semana: o total com a comparação aos 7 dias
   anteriores, quanto saiu no prazo, a média por dia, as colunas ocupando a
   altura que sobra e quem mais entregou.

   As conclusões vêm do banco com 90 dias de histórico (ver
   `conclusoes.functions.ts`), então os 7 dias anteriores estão sempre lá. */

type Dia = {
  inicio: number;
  semana: string;
  numero: string;
  extenso: string;
  feitas: number;
  noPrazo: number;
  hoje: boolean;
};

const DIA_MS = 24 * 60 * 60 * 1000;

export function SemanaDoTime() {
  const { completions, users } = useFluxo();
  const [foco, setFoco] = useState<number | null>(null);
  /* Onde está o mouse dentro da área das colunas (e a largura dela), para a
     caixa acompanhar. `null` quando o foco veio do teclado. */
  const [ponteiro, setPonteiro] = useState<{ x: number; y: number; largura: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  /* O tamanho da caixa, medido depois de desenhar, para ela saber onde parar
     nas bordas. Mudou (outro dia, outro texto): desenha de novo com a medida. */
  const caixa = useRef<HTMLDivElement>(null);
  const tamanho = useRef({ w: 170, h: 60 });
  const [, remedir] = useState(0);
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (Math.abs(w - tamanho.current.w) > 1 || Math.abs(h - tamanho.current.h) > 1) {
      tamanho.current = { w, h };
      remedir((n) => n + 1);
    }
  }, [foco]);

  const semana = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dias: Dia[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(d.getDate() - i);
      dias.push({
        inicio: d.getTime(),
        semana: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3),
        numero: String(d.getDate()),
        extenso: d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" }),
        feitas: 0,
        noPrazo: 0,
        hoje: i === 0,
      });
    }
    const inicio = dias[0].inicio;
    const fim = hoje.getTime() + DIA_MS;
    let anteriores = 0;
    const porPessoa = new Map<string, number>();
    for (const c of completions) {
      const t = new Date(c.at).getTime();
      if (t >= inicio - 7 * DIA_MS && t < inicio) anteriores++;
      if (t < inicio || t >= fim) continue;
      // O dia pela data, não por divisão: dia de horário de verão tem 23 ou 25 horas.
      const dia = [...dias].reverse().find((d) => t >= d.inicio);
      if (!dia) continue;
      dia.feitas++;
      if (c.onTime) dia.noPrazo++;
      porPessoa.set(c.userId, (porPessoa.get(c.userId) ?? 0) + 1);
    }
    const total = dias.reduce((s, d) => s + d.feitas, 0);
    const noPrazo = dias.reduce((s, d) => s + d.noPrazo, 0);
    const destaques = [...porPessoa.entries()]
      .map(([id, n]) => ({ pessoa: users.find((u) => u.id === id), n }))
      .filter((x) => !!x.pessoa)
      .sort((a, b) => b.n - a.n || a.pessoa!.name.localeCompare(b.pessoa!.name))
      .slice(0, 3);
    return { dias, total, anteriores, noPrazo, destaques };
  }, [completions, users]);

  const { dias, total, anteriores, noPrazo, destaques } = semana;
  const maior = Math.max(1, ...dias.map((d) => d.feitas));
  const iMaior = dias.findIndex((d) => d.feitas === maior && d.feitas > 0);
  const diferenca = total - anteriores;
  const pctNoPrazo = total ? Math.round((noPrazo / total) * 100) : 0;
  const media = (total / 7).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const intervalo = `${new Date(dias[0].inicio).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${new Date(dias[6].inicio).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
  const Seta = diferenca > 0 ? ArrowUpRight : diferenca < 0 ? ArrowDownRight : Minus;

  const apontar = (i: number, e: React.PointerEvent) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    setFoco(i);
    setPonteiro({ x: e.clientX - r.left, y: e.clientY - r.top, largura: r.width });
  };
  const diaEmFoco = foco !== null ? dias[foco] : null;
  let posicaoDaCaixa: React.CSSProperties = {};
  if (foco !== null && ponteiro) {
    /* Centrada no ponteiro e acima dele, parando nas bordas da área (8px de
       folga, que é o respiro do card). Sem espaço em cima, desce para baixo do
       ponteiro. Continua: a caixa desliza junto, sem trocar de lado no meio. */
    const { w, h } = tamanho.current;
    const left = Math.min(Math.max(ponteiro.x - w / 2, -8), ponteiro.largura - w + 8);
    const acima = ponteiro.y - h - 14;
    posicaoDaCaixa = { left, top: acima < -40 ? ponteiro.y + 18 : acima };
  } else if (foco !== null) {
    const centro = ((foco + 0.5) / dias.length) * 100;
    const x = centro < 35 ? "0" : centro > 65 ? "-100%" : "-50%";
    posicaoDaCaixa = {
      left: `${centro}%`,
      top: 0,
      transform: `translate(${x}, calc(-100% - 8px))`,
    };
  }

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Últimos 7 dias · time</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{intervalo}</span>
      </div>

      {/* O número da semana, com a comparação, e as duas leituras dele. */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold leading-none tracking-tight">{total}</span>
            <span className="text-sm text-muted-foreground">
              {total === 1 ? "tarefa concluída" : "tarefas concluídas"}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs">
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${
                diferenca > 0
                  ? "bg-success/15 text-success"
                  : diferenca < 0
                    ? "bg-destructive/15 text-destructive"
                    : "bg-secondary text-muted-foreground"
              }`}
            >
              <Seta className="h-3 w-3" />
              {diferenca > 0 ? `+${diferenca}` : diferenca}
            </span>
            <span className="text-muted-foreground">vs. os 7 dias anteriores ({anteriores})</span>
          </div>
        </div>
        <div className="flex gap-6">
          <div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-success" /> No prazo
            </div>
            <div className="mt-1 text-lg font-semibold leading-none">
              {total ? `${pctNoPrazo}%` : "—"}
            </div>
            {/* Trilha no mesmo tom, mais claro: a proporção se lê na barra inteira. */}
            <div className="mt-1.5 h-1 w-20 overflow-hidden rounded-full bg-success/15">
              <motion.div
                className="h-full rounded-full bg-success"
                initial={{ width: 0 }}
                animate={{ width: `${pctNoPrazo}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Média por dia</div>
            <div className="mt-1 text-lg font-semibold leading-none">{media}</div>
          </div>
        </div>
      </div>

      {/* As colunas ficam com a altura que sobra no card, cada uma com o número
          em cima — dia sem entrega mostra "0" rente à base, para não parecer
          que faltou dado. O detalhe do dia vem ao passar o mouse (ou no foco). */}
      <div
        ref={area}
        onPointerLeave={() => {
          setFoco(null);
          setPonteiro(null);
        }}
        className="relative mt-5 flex min-h-36 flex-1 items-stretch gap-1 border-b border-border"
      >
        {dias.map((d, i) => {
          const pct = (d.feitas / maior) * 100;
          const ativo = foco === i;
          return (
            <div
              key={d.inicio}
              tabIndex={0}
              aria-label={`${d.extenso}: ${d.feitas} ${d.feitas === 1 ? "tarefa concluída" : "tarefas concluídas"}, ${d.noPrazo} no prazo`}
              onPointerMove={(e) => apontar(i, e)}
              onFocus={() => {
                setFoco(i);
                setPonteiro(null);
              }}
              onBlur={() => setFoco((f) => (f === i ? null : f))}
              className={`relative flex flex-1 flex-col items-center justify-end rounded-t-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${
                ativo ? "bg-foreground/5" : ""
              }`}
            >
              <span
                className={`absolute text-[11px] font-semibold tabular-nums ${
                  d.feitas === 0
                    ? "text-muted-foreground/60"
                    : d.hoje || ativo || i === iMaior
                      ? "text-foreground"
                      : "text-foreground/70"
                }`}
                style={{ bottom: `calc(${pct}% + 4px)` }}
              >
                {d.feitas}
              </span>
              <motion.div
                className={`w-full max-w-6 rounded-t-[4px] transition-colors ${
                  d.hoje || ativo ? "bg-primary" : "bg-primary/55"
                } ${d.feitas ? "min-h-[3px]" : ""}`}
                initial={{ height: 0 }}
                animate={{ height: `${d.feitas ? pct : 0}%` }}
                transition={{ duration: 0.7, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          );
        })}
        {/* Uma caixa só, que acompanha o mouse. Perto das bordas ela abre
            para dentro do card (à direita do ponteiro na borda esquerda, à
            esquerda na direita, embaixo quando o mouse está no alto), para
            não ser cortada. Pelo teclado, fica sobre a coluna em foco. */}
        {diaEmFoco && (
          <div ref={caixa} className="pointer-events-none absolute z-20" style={posicaoDaCaixa}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.12 }}
              className="w-max rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg"
            >
              <div className="font-semibold text-foreground">
                {diaEmFoco.feitas} {diaEmFoco.feitas === 1 ? "tarefa" : "tarefas"}
              </div>
              <div className="text-muted-foreground">{diaEmFoco.extenso}</div>
              {diaEmFoco.feitas > 0 && (
                <div className="text-muted-foreground">
                  {diaEmFoco.noPrazo} no prazo · {diaEmFoco.feitas - diaEmFoco.noPrazo} após o prazo
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-1">
        {dias.map((d) => (
          <div key={d.inicio} className="flex-1 text-center text-[10px] leading-tight">
            <div className={d.hoje ? "font-semibold text-foreground" : "text-muted-foreground"}>
              {d.hoje ? "hoje" : d.semana}
            </div>
            <div className="text-muted-foreground/70">{d.numero}</div>
          </div>
        ))}
      </div>

      {/* Quem mais entregou na semana. */}
      {destaques.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
          <span className="text-[11px] text-muted-foreground">Quem mais entregou</span>
          {destaques.map(({ pessoa, n }) => (
            <span key={pessoa!.id} className="flex items-center gap-1.5 text-xs">
              <UserAvatar
                nome={pessoa!.name}
                iniciais={pessoa!.avatar}
                className="h-5 w-5 text-[9px]"
              />
              <span className="font-medium">{nomeCurto(pessoa!.name)}</span>
              <span className="text-muted-foreground">{n}</span>
            </span>
          ))}
        </div>
      )}

      {/* Os mesmos números sem depender do gráfico, para leitor de tela. Escondida
          por um `div`, e não com `sr-only` na própria tabela: a legenda
          (`caption`) é desenhada fora da caixa da tabela e escapava dela,
          aparecendo por cima do título do card. */}
      <div className="sr-only">
        <table>
          <caption>Tarefas concluídas pelo time nos últimos 7 dias</caption>
          <tbody>
            {dias.map((d) => (
              <tr key={d.inicio}>
                <th scope="row">{d.extenso}</th>
                <td>{d.feitas}</td>
                <td>{d.noPrazo} no prazo</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
