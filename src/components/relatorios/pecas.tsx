import type { ComponentType, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Tom, Variacao } from "./analise";

/**
 * Peças visuais da aba Relatórios (reforma de 13/10/2026): o cartão de
 * seção, o número com variação, o estado vazio que diz o que fazer, a dica
 * dos gráficos e a minilinha da tabela do time. Tudo com os tokens do tema —
 * nada de cor fixa, para valer igual no claro, no escuro e nas paletas.
 */

export function Cartao({
  titulo,
  subtitulo,
  acoes,
  className = "",
  children,
}: {
  titulo: string;
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
          <h3 className="font-display text-sm font-semibold tracking-tight">{titulo}</h3>
          {subtitulo && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitulo}</p>}
        </div>
        {acoes}
      </header>
      <div className="mt-3 min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function TituloDeBloco({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pt-2">
      <h2 className="font-display text-lg font-bold tracking-tight">{titulo}</h2>
      <p className="text-xs text-muted-foreground">{descricao}</p>
    </div>
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

const corDoTom: Record<Tom, string> = {
  bom: "text-success bg-success/15",
  ruim: "text-destructive bg-destructive/15",
  neutro: "text-muted-foreground bg-secondary",
};

export function SeloVariacao({ v }: { v: Variacao | null }) {
  if (!v) return null;
  const Icone =
    v.tom === "neutro" ? Minus : v.texto.startsWith("−") ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      title="Em relação ao período anterior, do mesmo tamanho"
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${corDoTom[v.tom]}`}
    >
      <Icone className="h-3 w-3" />
      {v.texto}
    </span>
  );
}

export function Indicador({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  variacao,
  cor,
}: {
  icone: ComponentType<{ className?: string }>;
  rotulo: string;
  valor: string;
  detalhe?: ReactNode;
  variacao?: Variacao | null;
  /** Cor do número, quando o número em si é um estado (ex.: atrasadas). */
  cor?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{rotulo}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1">
        <span
          className="font-display text-2xl font-bold leading-none tabular-nums tracking-tight"
          style={cor ? { color: cor } : undefined}
        >
          {valor}
        </span>
        <SeloVariacao v={variacao ?? null} />
      </div>
      {detalhe && <div className="mt-1.5 text-[11px] text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

/**
 * A dica de todos os gráficos. Desenhada à mão em vez do tooltip padrão do
 * Recharts, que pinta o texto de preto fixo quando a série não tem cor e some
 * no tema escuro (ver o comentário antigo de `TOOLTIP` em relatorios.tsx).
 * O texto usa as cores do popover; a cor da série fica só na bolinha.
 */
export function DicaDoGrafico({
  active,
  payload,
  label,
  formatar,
  rodape,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[];
  label?: string;
  formatar: (v: number) => string;
  rodape?: (itens: { value?: number }[]) => string | null;
}) {
  if (!active || !payload?.length) return null;
  const itens = payload.filter((p) => (p.value ?? 0) > 0);
  const extra = rodape?.(payload) ?? null;
  return (
    <div className="min-w-[140px] rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      {itens.length === 0 ? (
        <div className="text-muted-foreground">Nada registrado</div>
      ) : (
        <ul className="space-y-0.5">
          {itens.map((p) => (
            <li key={String(p.dataKey)} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="font-medium tabular-nums">{formatar(p.value ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      {extra && (
        <div className="mt-1 border-t border-border pt-1 text-muted-foreground">{extra}</div>
      )}
    </div>
  );
}

/** Legenda em HTML, com o texto na cor do texto e a cor da série só no quadradinho. */
export function Legenda({ itens }: { itens: { rotulo: string; cor: string }[] }) {
  if (itens.length < 2) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.cor }} />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}

/** Lista de barras horizontais: rótulo, valor e a fração do maior. */
export function BarrasEmLista({
  itens,
  formatar,
}: {
  itens: { chave: string; rotulo: ReactNode; valor: number; cor?: string; nota?: string }[];
  formatar: (v: number) => string;
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const total = itens.reduce((s, i) => s + i.valor, 0);
  return (
    <ul className="space-y-2.5">
      {itens.map((i) => (
        <li key={i.chave} className="min-w-0">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{i.rotulo}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {total > 0 && (
                <span className="mr-1.5 text-[10px]">{Math.round((i.valor / total) * 100)}%</span>
              )}
              <span className="font-medium text-foreground">{formatar(i.valor)}</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (i.valor / max) * 100)}%`,
                background: i.cor ?? "var(--color-primary)",
              }}
            />
          </div>
          {i.nota && (
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{i.nota}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Minilinha das conclusões por dia/semana, para a tabela do time. */
export function MiniLinha({ valores }: { valores: number[] }) {
  const w = 84;
  const h = 22;
  const max = Math.max(1, ...valores);
  if (valores.length < 2) return null;
  const pontos = valores
    .map((v, i) => `${(i / (valores.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline
        points={pontos}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
