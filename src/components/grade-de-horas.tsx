import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DoorOpen, Lock, Repeat } from "lucide-react";
import { dataParaIso } from "@/lib/data-iso";

/* As "linhas de horário" do calendário (pedido do usuário, 14/10/2026), no
 * jeito do Outlook: uma coluna de horas à esquerda, uma coluna por dia, linhas
 * a cada meia hora e a linha vermelha do "agora".
 *
 * A grade não sabe o que é tarefa, reserva ou compromisso: recebe BLOCOS já
 * montados (início e fim em minutos do dia, título, cor, o que fazer no
 * clique) e só cuida de onde eles caem — inclusive lado a lado quando se
 * cruzam. Quem monta é o calendário (`routes/calendario.tsx`).
 *
 * O que não tem hora (a tarefa só com dia) fica na faixa "Dia todo", em cima,
 * desenhada por quem chama (`faixaDoDia`) — assim as pílulas, o clique que
 * abre a agenda do dia e o menu do dia continuam os mesmos de antes.
 *
 * Seleção: arrastar sobre as meias horas marca um intervalo; o botão direito
 * dentro dele (ou numa meia hora solta) chama `aoContextoDoHorario` com o
 * intervalo — é dali que sai o "Travar agenda". Duplo clique faz o mesmo sem
 * o menu (`aoDuploClique`).
 */

/** Altura de uma hora, em px. Meia hora = metade. */
const ALTURA_DA_HORA = 48;
const MEIA_HORA = 30;
const SLOTS = 48;
/** O expediente que aparece sem rolar: 07:00–20:00. Fora dele, a grade fica sombreada. */
const EXPEDIENTE_DE = 7 * 60;
const EXPEDIENTE_ATE = 20 * 60;
/** Bloco curto demais não cabe o título; desenha com pelo menos isto (em minutos). */
const DURACAO_MINIMA_VISUAL = 20;

const px = (minutos: number) => (minutos / 60) * ALTURA_DA_HORA;

export type EstiloDoBloco = "cheio" | "contorno" | "tracejado";

export interface BlocoNaGrade {
  /** Única na grade inteira (o mesmo compromisso em dois dias vira duas chaves). */
  chave: string;
  /** Dia em que o bloco cai ("yyyy-MM-dd"). */
  iso: string;
  /** Minutos desde a meia-noite (0–1440). */
  inicio: number;
  fim: number;
  titulo: string;
  subtitulo?: string;
  /** Cor CSS (hex ou var). */
  cor: string;
  estilo: EstiloDoBloco;
  icone?: "cadeado" | "porta" | "repetir";
  /** Mais apagado — o compromisso de outra pessoa, no modo Equipe. */
  apagado?: boolean;
  dica: string;
  aoClicar: () => void;
  aoContexto?: (x: number, y: number) => void;
}

export interface IntervaloNaGrade {
  iso: string;
  /** Minutos desde a meia-noite. */
  inicio: number;
  fim: number;
}

type Selecao = { iso: string; a: number; b: number };

const ICONES = { cadeado: Lock, porta: DoorOpen, repetir: Repeat } as const;

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Lado a lado: blocos que se cruzam (direta ou indiretamente) formam um grupo,
 * e cada um ganha a primeira coluna livre do grupo. A largura é dividida pelo
 * número de colunas do grupo — o mesmo que o Outlook faz.
 */
function distribuir(blocos: BlocoNaGrade[]) {
  const ordenados = [...blocos].sort(
    (x, y) => x.inicio - y.inicio || y.fim - y.inicio - (x.fim - x.inicio),
  );
  const saida: { b: BlocoNaGrade; col: number; cols: number }[] = [];
  let grupo: { b: BlocoNaGrade; col: number; cols: number }[] = [];
  let colunas: number[] = [];
  let fimDoGrupo = -1;
  const fechar = () => {
    for (const g of grupo) g.cols = colunas.length;
    saida.push(...grupo);
    grupo = [];
    colunas = [];
  };
  for (const b of ordenados) {
    const fimVisual = Math.max(b.fim, b.inicio + DURACAO_MINIMA_VISUAL);
    if (b.inicio >= fimDoGrupo && grupo.length > 0) fechar();
    let col = colunas.findIndex((fimDaColuna) => fimDaColuna <= b.inicio);
    if (col === -1) {
      col = colunas.length;
      colunas.push(fimVisual);
    } else colunas[col] = fimVisual;
    grupo.push({ b, col, cols: 1 });
    fimDoGrupo = grupo.length === 1 ? fimVisual : Math.max(fimDoGrupo, fimVisual);
  }
  if (grupo.length > 0) fechar();
  return saida;
}

/** Minutos de agora, relidos a cada 30 s — só para a linha vermelha. */
function useMinutoAgora(): { iso: string; minuto: number } {
  const ler = () => {
    const d = new Date();
    return { iso: dataParaIso(d), minuto: d.getHours() * 60 + d.getMinutes() };
  };
  const [agora, setAgora] = useState(ler);
  useEffect(() => {
    const id = window.setInterval(() => setAgora(ler()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

export function GradeDeHoras({
  dias,
  blocos,
  cabecalho,
  faixaDoDia,
  fundoDoDia,
  aoContextoDoHorario,
  aoDuploClique,
}: {
  dias: Date[];
  blocos: BlocoNaGrade[];
  /** O topo de cada coluna (dia da semana, número, marcas). */
  cabecalho: (dia: Date, iso: string) => ReactNode;
  /** A faixa "Dia todo" de cada coluna — o que não tem hora. */
  faixaDoDia: (dia: Date, iso: string) => ReactNode;
  /** Fundo pintado do dia, quando há. */
  fundoDoDia?: (iso: string) => string | undefined;
  aoContextoDoHorario: (x: number, y: number, intervalo: IntervaloNaGrade) => void;
  aoDuploClique: (intervalo: IntervaloNaGrade) => void;
}) {
  const isos = useMemo(() => dias.map(dataParaIso), [dias]);
  const agora = useMinutoAgora();
  const corpoRef = useRef<HTMLDivElement>(null);

  const porDia = useMemo(() => {
    const m = new Map<string, ReturnType<typeof distribuir>>();
    const agrupados = new Map<string, BlocoNaGrade[]>();
    for (const b of blocos) {
      const lista = agrupados.get(b.iso);
      if (lista) lista.push(b);
      else agrupados.set(b.iso, [b]);
    }
    for (const [iso, lista] of agrupados) m.set(iso, distribuir(lista));
    return m;
  }, [blocos]);

  /* Rola para o expediente — ou para perto de agora, se hoje está na tela e
     a hora já passou do que cabe. Só quando o período muda, não a cada bloco. */
  const chaveDoPeriodo = isos.join(",");
  const temHoje = isos.includes(agora.iso);
  useEffect(() => {
    const el = corpoRef.current;
    if (!el) return;
    const visivel = el.clientHeight;
    let alvo = px(EXPEDIENTE_DE);
    if (temHoje) {
      const linha = px(agora.minuto);
      if (linha < alvo || linha > alvo + visivel - ALTURA_DA_HORA)
        alvo = linha - ALTURA_DA_HORA * 2;
    }
    el.scrollTop = Math.max(0, alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoPeriodo]);

  /* Seleção por arraste. O soltar é ouvido na janela: o mouse pode sair da
     coluna antes de soltar. */
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const arrastando = useRef(false);
  useEffect(() => {
    const soltar = () => {
      arrastando.current = false;
    };
    window.addEventListener("mouseup", soltar);
    return () => window.removeEventListener("mouseup", soltar);
  }, []);
  // Trocar de período limpa a seleção.
  useEffect(() => setSelecao(null), [chaveDoPeriodo]);

  const slotDoEvento = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(SLOTS - 1, Math.max(0, Math.floor((e.clientY - r.top) / (ALTURA_DA_HORA / 2))));
  };
  const intervaloDe = (s: Selecao): IntervaloNaGrade => ({
    iso: s.iso,
    inicio: Math.min(s.a, s.b) * MEIA_HORA,
    fim: (Math.max(s.a, s.b) + 1) * MEIA_HORA,
  });

  const colunas = `3.5rem repeat(${dias.length}, minmax(0, 1fr))`;
  /* A barra de rolagem existe só no corpo; a reserva do espaço dela também no
     cabeçalho e na faixa mantém as colunas alinhadas. */
  const alinhar: React.CSSProperties = { scrollbarGutter: "stable", overflowY: "hidden" };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Cabeçalho dos dias */}
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: colunas, ...alinhar }}
      >
        <div className="bg-secondary/60" />
        {dias.map((d, i) => (
          <div key={isos[i]} className="min-w-0 border-l border-border">
            {cabecalho(d, isos[i]!)}
          </div>
        ))}
      </div>

      {/* Dia todo: o que não tem hora */}
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: colunas, ...alinhar }}
      >
        <div className="flex items-start justify-end px-1.5 pt-1.5 text-[9px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
          Dia todo
        </div>
        {dias.map((d, i) => (
          <div
            key={isos[i]}
            className="min-w-0 border-l border-border"
            style={{ background: fundoDoDia?.(isos[i]!) }}
          >
            {faixaDoDia(d, isos[i]!)}
          </div>
        ))}
      </div>

      {/* As horas */}
      <div
        ref={corpoRef}
        className="relative overflow-y-auto"
        style={{ height: "min(68vh, 648px)", scrollbarGutter: "stable" }}
      >
        <div
          className="relative grid"
          style={{ gridTemplateColumns: colunas, height: px(24 * 60) }}
        >
          {/* Coluna das horas */}
          <div className="relative select-none">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: px(h * 60) }}
              >
                {h === 0 ? "" : hhmm(h * 60)}
              </div>
            ))}
            {temHoje && (
              <div
                className="absolute right-0 z-10 -translate-y-1/2 rounded bg-destructive px-1 text-[9px] font-semibold tabular-nums text-destructive-foreground"
                style={{ top: px(agora.minuto) }}
              >
                {hhmm(agora.minuto)}
              </div>
            )}
          </div>

          {dias.map((_, i) => {
            const iso = isos[i]!;
            const sel = selecao?.iso === iso ? intervaloDe(selecao) : null;
            return (
              <div
                key={iso}
                className="relative min-w-0 select-none border-l border-border"
                style={{
                  background: fundoDoDia?.(iso),
                  /* Linha cheia na hora, mais clara na meia hora. */
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0 1px, transparent 1px ${ALTURA_DA_HORA / 2}px, color-mix(in oklab, var(--color-border) 45%, transparent) ${ALTURA_DA_HORA / 2}px ${ALTURA_DA_HORA / 2 + 1}px, transparent ${ALTURA_DA_HORA / 2 + 1}px ${ALTURA_DA_HORA}px)`,
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  const s = slotDoEvento(e);
                  arrastando.current = true;
                  setSelecao({ iso, a: s, b: s });
                }}
                onMouseMove={(e) => {
                  if (!arrastando.current || selecao?.iso !== iso) return;
                  const s = slotDoEvento(e);
                  if (s !== selecao.b) setSelecao({ ...selecao, b: s });
                }}
                onDoubleClick={(e) => {
                  const s = slotDoEvento(e);
                  const atual =
                    sel && s * MEIA_HORA >= sel.inicio && s * MEIA_HORA < sel.fim
                      ? sel
                      : { iso, inicio: s * MEIA_HORA, fim: (s + 1) * MEIA_HORA };
                  aoDuploClique(atual);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const s = slotDoEvento(e);
                  let intervalo: IntervaloNaGrade;
                  if (sel && s * MEIA_HORA >= sel.inicio && s * MEIA_HORA < sel.fim)
                    intervalo = sel;
                  else {
                    setSelecao({ iso, a: s, b: s });
                    intervalo = { iso, inicio: s * MEIA_HORA, fim: (s + 1) * MEIA_HORA };
                  }
                  aoContextoDoHorario(e.clientX, e.clientY, intervalo);
                }}
              >
                {/* Fora do expediente, sombreado */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 bg-muted/40"
                  style={{ height: px(EXPEDIENTE_DE) }}
                />
                <div
                  className="pointer-events-none absolute inset-x-0 bg-muted/40"
                  style={{ top: px(EXPEDIENTE_ATE), height: px(24 * 60 - EXPEDIENTE_ATE) }}
                />

                {sel && (
                  <div
                    className="pointer-events-none absolute inset-x-0.5 rounded-sm border border-primary/60 bg-primary/15"
                    style={{ top: px(sel.inicio), height: px(sel.fim - sel.inicio) }}
                  >
                    <span className="px-1 text-[10px] font-semibold tabular-nums text-primary">
                      {hhmm(sel.inicio)}–{hhmm(sel.fim)}
                    </span>
                  </div>
                )}

                {(porDia.get(iso) ?? []).map(({ b, col, cols }) => (
                  <BlocoDaGrade key={b.chave} b={b} col={col} cols={cols} />
                ))}

                {agora.iso === iso && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: px(agora.minuto) }}
                    aria-hidden
                  >
                    <div className="h-0.5 bg-destructive" />
                    <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BlocoDaGrade({ b, col, cols }: { b: BlocoNaGrade; col: number; cols: number }) {
  const duracao = Math.max(b.fim - b.inicio, DURACAO_MINIMA_VISUAL);
  const altura = px(duracao) - 2;
  const Icone = b.icone ? ICONES[b.icone] : null;
  const fundo =
    b.estilo === "cheio"
      ? `color-mix(in oklab, ${b.cor} 24%, var(--color-card))`
      : b.estilo === "contorno"
        ? `color-mix(in oklab, ${b.cor} 8%, var(--color-card))`
        : "var(--color-card)";
  return (
    <button
      type="button"
      title={b.dica}
      aria-label={b.dica}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        b.aoClicar();
      }}
      onContextMenu={(e) => {
        if (!b.aoContexto) return;
        e.preventDefault();
        e.stopPropagation();
        b.aoContexto(e.clientX, e.clientY);
      }}
      className={`absolute z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[10px] leading-tight shadow-sm transition hover:z-30 hover:brightness-95 hover:shadow-md ${
        b.estilo === "cheio"
          ? "border-l-[3px]"
          : b.estilo === "contorno"
            ? "border"
            : "border border-dashed"
      } ${b.apagado ? "opacity-60" : ""}`}
      style={{
        top: px(b.inicio) + 1,
        height: altura,
        left: `calc(${(col / cols) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
        background: fundo,
        borderColor: b.cor,
      }}
    >
      <span className="flex min-w-0 items-center gap-1 font-semibold">
        {Icone && <Icone className="h-3 w-3 shrink-0" style={{ color: b.cor }} />}
        <span className="truncate">{b.titulo}</span>
      </span>
      {b.subtitulo && altura >= 30 && (
        <span className="truncate text-muted-foreground">{b.subtitulo}</span>
      )}
    </button>
  );
}
