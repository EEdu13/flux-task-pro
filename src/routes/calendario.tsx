import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  NotebookPen,
  Palette,
  Plus,
  Repeat,
  RotateCcw,
  Zap,
  Eye,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeletorDeCor } from "@/components/seletor-de-cor";
import { CalendarioLinhas } from "@/components/calendario-linhas";
import { comOcorrenciasPrevistas, ehPrevista, idReal } from "@/lib/ocorrencias-previstas";
import {
  CORES_DO_DIA,
  usePrefsDoCalendario,
  type PrefsDoCalendario,
} from "@/lib/use-prefs-do-calendario";
import { AGENDA_PESSOAL_MUDOU, AgendaDoDia } from "@/components/agenda-do-dia";
import { listarAgendaPessoal } from "@/lib/agenda-pessoal.functions";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, statusColor, statusLabels } from "@/lib/fluxo-types";
import { openTaskContext } from "@/components/task-context-menu";
import { dataParaIso } from "@/lib/data-iso";
import { nomeCurto } from "@/lib/nome-curto";
import { RESERVA_CRIADA, abrirReservaDeSala } from "@/components/reserva-de-sala-modal";
import { listarAgendaDeSalas, type ReservaDeSala } from "@/lib/reservas-sala.functions";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário · SGL - CONECTA" },
      { name: "description", content: "Visão mensal, semanal, diária e lista de todas as tarefas por prazo." },
    ],
  }),
  component: CalendarioPage,
});

type ViewMode = "mes" | "semana" | "dia" | "lista" | "linhas";

const ROTULO_DA_VISAO: Record<ViewMode, string> = {
  mes: "Mês",
  semana: "Semana",
  dia: "Dia",
  lista: "Lista",
  linhas: "Linhas",
};

/** Cores prontas para o fundo e para as minhas tarefas; a personalizada vem do seletor. */
const CORES_PRONTAS = [
  "#2563eb",
  "#0d9488",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
];

/** O dia pintado: a cor escolhida misturada ao cartão, para o texto seguir legível. */
const fundoPintado = (cor: string | null | undefined) =>
  cor ? `color-mix(in oklab, ${cor} 28%, var(--card))` : undefined;

/** Primeiro dia do mês da data. */
const inicioDoMes = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

function CalendarioPage() {
  const { tasks, currentUser, users, openTask, openNewTask, openQuickCreate, reorderTasks } = useFluxo();
  const [view, setView] = useState<ViewMode>("mes");
  /** A largura da visão em linhas: uma semana ou o mês inteiro. */
  const [escalaLinhas, setEscalaLinhas] = useState<"semana" | "mes">("semana");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState<"eu" | "todos">("eu");
  const [prefs, mudarPrefs, pintarDia] = usePrefsDoCalendario(currentUser.id);
  const corMinhas = prefs.minhas ?? "var(--primary)";
  const [dayCtx, setDayCtx] = useState<{ x: number; y: number; date: string; count: number } | null>(null);
  /** O dia em que a agenda abriu ("yyyy-MM-dd"), ou `null`. Aberta, ela troca
   *  de dia sozinha — o calendário por trás não é redesenhado a cada seta. */
  const [agendaDia, setAgendaDia] = useState<string | null>(null);

  useEffect(() => {
    if (!dayCtx) return;
    const close = () => setDayCtx(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [dayCtx]);

  const filtered = useMemo(
    () => (scope === "eu" ? tasks.filter((t) => t.assigneeId === currentUser.id) : tasks),
    [tasks, scope, currentUser.id],
  );

  /* Reservas de sala física por cima do calendário de tarefas.
   *
   * Um prazo e uma sala reservada disputam o mesmo dia da semana da pessoa, e
   * até aqui só um dos dois aparecia — quem olhava a quinta-feira não via que
   * ela já tem duas horas de reunião marcada.
   *
   * A faixa acompanha a visão: o mês pede as 6 semanas inteiras da grade (o
   * Agendador aceita `data`+`data_fim` de uma vez, então é UMA chamada, não
   * 42). A visão de lista fica de fora de propósito — ela é sobre a ordem das
   * tarefas, não sobre o dia. */
  const [reservas, setReservas] = useState<ReservaDeSala[]>([]);
  /** A faixa que `reservas` de fato cobre — só depois de uma busca que deu certo. */
  const [faixaCarregada, setFaixaCarregada] = useState<{ de: string; ate: string } | null>(null);
  const faixa = useMemo(() => {
    if (view === "lista") return null;
    if (view === "dia") {
      const iso = dataParaIso(cursor);
      return { de: iso, ate: iso };
    }
    if (view === "linhas") {
      const inicio = escalaLinhas === "semana" ? startOfWeek(cursor) : inicioDoMes(cursor);
      const fim =
        escalaLinhas === "semana"
          ? new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + 6)
          : new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
      return { de: dataParaIso(inicio), ate: dataParaIso(fim) };
    }
    const inicio =
      view === "semana"
        ? startOfWeek(cursor)
        : (() => {
            const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const g = new Date(first);
            g.setDate(first.getDate() - first.getDay());
            return g;
          })();
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + (view === "semana" ? 6 : 41));
    return { de: dataParaIso(inicio), ate: dataParaIso(fim) };
  }, [view, cursor, escalaLinhas]);

  /* As recorrentes desenhadas adiante — o pack de todo dia útil aparece em
     todos os dias úteis, a semanal uma vez por semana. A lista olha 60 dias. */
  const comPrevistas = useMemo(() => {
    const ate = faixa
      ? faixa.ate
      : dataParaIso(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 59));
    return comOcorrenciasPrevistas(filtered, faixa?.de ?? dataParaIso(cursor), ate);
  }, [filtered, faixa, cursor]);

  /** As salas só são buscadas onde aparecem: fora da visão em linhas e se não estão ocultas. */
  const faixaDasSalas = view === "linhas" || prefs.ocultarSalas ? null : faixa;

  /* Reserva feita por cima do calendário (pela agenda do dia, pelo raio): relê
     a faixa, senão a sala recém-reservada só apareceria ao trocar de mês. */
  const [versaoReservas, setVersaoReservas] = useState(0);
  useEffect(() => {
    const aoCriar = () => setVersaoReservas((v) => v + 1);
    window.addEventListener(RESERVA_CRIADA, aoCriar);
    return () => window.removeEventListener(RESERVA_CRIADA, aoCriar);
  }, []);

  useEffect(() => {
    if (!faixaDasSalas) {
      setReservas([]);
      setFaixaCarregada(null);
      return;
    }
    let vivo = true;
    listarAgendaDeSalas({ data: { data: faixaDasSalas.de, dataFim: faixaDasSalas.ate } })
      .then((r) => {
        if (!vivo) return;
        setReservas(r.reservas);
        setFaixaCarregada(faixaDasSalas);
      })
      /* Falha em silêncio: esta tela é o calendário de TAREFAS, e o Agendador
         fora do ar não pode esvaziá-la nem encher de aviso. Quem precisa saber
         que ele caiu está na tela de reserva, onde o erro aparece. */
      .catch(() => {
        if (!vivo) return;
        setReservas([]);
        setFaixaCarregada(null);
      });
    return () => {
      vivo = false;
    };
  }, [faixaDasSalas, versaoReservas]);

  const reservasPorDia = useMemo(() => {
    const m = new Map<string, ReservaDeSala[]>();
    for (const r of reservas) {
      const lista = m.get(r.data);
      if (lista) lista.push(r);
      else m.set(r.data, [r]);
    }
    for (const lista of m.values()) lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
    return m;
  }, [reservas]);

  /* Marcas de anotação e lembrete nos dias da grade — só as da própria pessoa,
     como tudo da agenda pessoal. Um extra: se a leitura falhar, o calendário
     segue igual, sem as marcas. */
  const [marcas, setMarcas] = useState<Map<string, MarcaDoDia>>(() => new Map());
  const [versaoMarcas, setVersaoMarcas] = useState(0);
  useEffect(() => {
    if (!faixa) return;
    let vivo = true;
    listarAgendaPessoal({ data: { de: faixa.de, ate: faixa.ate } })
      .then((r) => {
        if (!vivo) return;
        const m = new Map<string, MarcaDoDia>();
        const doDia = (iso: string) => {
          let v = m.get(iso);
          if (!v) m.set(iso, (v = { nota: false, lembretes: 0 }));
          return v;
        };
        for (const n of r.anotacoes) doDia(n.dia).nota = true;
        for (const l of r.lembretes) doDia(dataParaIso(new Date(l.quando))).lembretes += 1;
        setMarcas(m);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [faixa, versaoMarcas]);

  /* A agenda avisa a cada anotação salva — e ela salva a cada pausa da
     digitação. Reler a grade a cada aviso seria uma ida ao servidor por frase,
     para marcas que estão escondidas atrás do modal. Então só anota que mudou,
     e relê quando a agenda fecha. */
  const marcasMudaram = useRef(false);
  useEffect(() => {
    const aoMudar = () => {
      marcasMudaram.current = true;
    };
    window.addEventListener(AGENDA_PESSOAL_MUDOU, aoMudar);
    return () => window.removeEventListener(AGENDA_PESSOAL_MUDOU, aoMudar);
  }, []);
  useEffect(() => {
    if (agendaDia !== null || !marcasMudaram.current) return;
    marcasMudaram.current = false;
    setVersaoMarcas((v) => v + 1);
  }, [agendaDia]);

  /* Abre o modal já no dia clicado, em vez de navegar: o calendário é a tela
     de onde se enxerga o conflito, e sair dela para resolver seria perder de
     vista justamente o que motivou a reserva.

     Estes três são estáveis (`useCallback`) porque as grades são memorizadas:
     abrir e fechar a agenda ou o menu do dia não redesenha o mês inteiro. */
  const abrirReservas = useCallback((iso: string) => abrirReservaDeSala(iso), []);
  const abrirMenuDoDia = useCallback(
    (x: number, y: number, iso: string, count: number) => setDayCtx({ x, y, date: iso, count }),
    [],
  );
  const irParaODia = useCallback((iso: string) => {
    setCursor(new Date(iso + "T00:00:00"));
    setView("dia");
  }, []);

  /* O que o calendário já buscou vale como ponto de partida da agenda do dia.
     Fora da faixa carregada — ou com a busca ainda no ar, ou falha — a resposta
     é `undefined`: "não sei". Responder lista vazia ali mostraria as salas
     livres justamente quando o Agendador não respondeu. */
  const reservasConhecidas = (iso: string) =>
    faixaCarregada && iso >= faixaCarregada.de && iso <= faixaCarregada.ate
      ? (reservasPorDia.get(iso) ?? [])
      : undefined;

  /* Mês a mês parte do dia 1: do dia 31, o `setMonth` pulava fevereiro
     inteiro (31/jan + 1 mês = 3/mar). */
  const andar = (sentido: 1 | -1) => {
    const d = new Date(cursor);
    const porMes = view === "mes" || (view === "linhas" && escalaLinhas === "mes");
    if (porMes) {
      d.setDate(1);
      d.setMonth(d.getMonth() + sentido);
    } else if (view === "semana" || view === "linhas") d.setDate(d.getDate() + 7 * sentido);
    else if (view === "dia") d.setDate(d.getDate() + sentido);
    else d.setDate(d.getDate() + 14 * sentido);
    setCursor(d);
  };
  const goPrev = () => andar(-1);
  const goNext = () => andar(1);
  const goToday = () => setCursor(startOfDay(new Date()));

  const headerLabel = useMemo(() => {
    if (view === "mes" || (view === "linhas" && escalaLinhas === "mes")) {
      const d = new Date(cursor);
      d.setDate(1);
      return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    }
    if (view === "semana" || view === "linhas") {
      const s = startOfWeek(cursor);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return `${s.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;
    }
    if (view === "dia") {
      return cursor.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    }
    return "Próximas tarefas";
  }, [view, cursor, escalaLinhas]);

  const abrirTarefa = useCallback((id: string) => openTask(idReal(id)), [openTask]);

  const faixaDasLinhas = useMemo(() => {
    if (view !== "linhas" || !faixa) return null;
    const inicio = new Date(faixa.de + "T00:00:00");
    const fim = new Date(faixa.ate + "T00:00:00");
    return { inicio, dias: Math.round((fim.getTime() - inicio.getTime()) / 86_400_000) + 1 };
  }, [view, faixa]);

  const destaque = useMemo<Destaque>(
    () => ({ euId: currentUser.id, cor: corMinhas, dias: prefs.dias }),
    [currentUser.id, corMinhas, prefs.dias],
  );

  return (
    <FluxoLayout title="Calendário">
      <div className="mx-auto w-full max-w-[2200px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold capitalize tracking-tight">{headerLabel}</h1>
            <p className="text-sm text-muted-foreground">Visualize prazos e distribua carga.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Visão">
              {(["mes", "semana", "dia", "lista", "linhas"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded px-2.5 py-1 ${view === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {ROTULO_DA_VISAO[v]}
                </button>
              ))}
            </div>
            {view === "linhas" && (
              <div className="inline-flex rounded-md border border-border p-0.5 text-xs" role="group" aria-label="Período das linhas">
                {(["semana", "mes"] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-pressed={escalaLinhas === e}
                    onClick={() => setEscalaLinhas(e)}
                    className={`rounded px-2 py-1 ${escalaLinhas === e ? "bg-secondary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {e === "semana" ? "Semana" : "Mês"}
                  </button>
                ))}
              </div>
            )}
            {view !== "linhas" && view !== "lista" && (
              <button
                type="button"
                aria-pressed={prefs.ocultarSalas}
                onClick={() => mudarPrefs({ ocultarSalas: !prefs.ocultarSalas })}
                title={prefs.ocultarSalas ? "Mostrar as reservas de sala" : "Ocultar as reservas de sala"}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                  prefs.ocultarSalas
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <DoorOpen className="h-3.5 w-3.5" />
                {prefs.ocultarSalas ? "Mostrar salas" : "Ocultar salas"}
              </button>
            )}
            <CoresDoCalendario prefs={prefs} aoMudar={mudarPrefs} />

            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <button
                onClick={() => setScope("eu")}
                className={`rounded px-2 py-1 ${scope === "eu" ? "bg-secondary" : "text-muted-foreground"}`}
              >
                Só minhas
              </button>
              <button
                onClick={() => setScope("todos")}
                className={`rounded px-2 py-1 ${scope === "todos" ? "bg-secondary" : "text-muted-foreground"}`}
              >
                Todos
              </button>
            </div>
            <button onClick={goPrev} className="rounded-md border border-border p-1.5 hover:bg-secondary">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={goToday} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">
              Hoje
            </button>
            <button onClick={goNext} className="rounded-md border border-border p-1.5 hover:bg-secondary">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {view === "mes" && (
          <MonthGridMemo
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            reservasPorDia={reservasPorDia}
            marcas={marcas}
            onReservaClick={abrirReservas}
            onDayClick={setAgendaDia}
            onDayContext={abrirMenuDoDia}
            onTaskClick={abrirTarefa}
          />
        )}
        {view === "semana" && (
          <WeekGridMemo
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            reservasPorDia={reservasPorDia}
            marcas={marcas}
            onReservaClick={abrirReservas}
            onDayClick={setAgendaDia}
            onDayContext={abrirMenuDoDia}
            onTaskClick={abrirTarefa}
            onSwitchDay={irParaODia}
          />
        )}
        {view === "dia" && (
          <DayView
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            reservasDoDia={reservasPorDia.get(dataParaIso(cursor)) ?? []}
            mostrarSalas={!prefs.ocultarSalas}
            onReservaClick={abrirReservas}
            onTaskClick={abrirTarefa}
            onNew={() => openNewTask({ dueDate: dataParaIso(cursor) })}
            onReorder={reorderTasks}
          />
        )}
        {view === "lista" && (
          <ListView
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            onTaskClick={abrirTarefa}
            onReorder={reorderTasks}
          />
        )}
        {faixaDasLinhas && (
          <CalendarioLinhas
            tarefas={comPrevistas}
            users={users}
            euId={currentUser.id}
            corMinhas={corMinhas}
            diasPintados={prefs.dias}
            onDiaContexto={(x, y, iso) =>
              abrirMenuDoDia(
                x,
                y,
                iso,
                comPrevistas.filter((t) => t.dueDate && dataParaIso(new Date(t.dueDate)) === iso).length,
              )
            }
            inicio={faixaDasLinhas.inicio}
            dias={faixaDasLinhas.dias}
            onTaskClick={abrirTarefa}
          />
        )}
      </div>
      {dayCtx && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: Math.min(dayCtx.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240),
            top: Math.min(dayCtx.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 200),
            width: 220,
          }}
          className="fixed z-[300] animate-in fade-in-0 zoom-in-95 rounded-lg border border-border bg-card p-1 shadow-2xl"
        >
          <div className="border-b border-border px-2 py-1.5">
            <div className="text-[11px] font-semibold">
              {new Date(dayCtx.date + "T00:00:00").toLocaleDateString("pt-BR", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {dayCtx.count} {dayCtx.count === 1 ? "tarefa" : "tarefas"}
            </div>
          </div>
          {/* Pintar o dia (pedido do usuário, 07/10/2026): "quero deixar o
              dia 10 laranja para lembrar". Clicar na cor que já está tira. */}
          <div className="border-b border-border px-2 py-1.5">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pintar o dia
            </div>
            <div className="flex items-center gap-1">
              {CORES_DO_DIA.map((c) => {
                const atual = prefs.dias[dayCtx.date] === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={atual ? `Tirar a cor ${c}` : `Pintar de ${c}`}
                    aria-pressed={atual}
                    onClick={() => {
                      pintarDia(dayCtx.date, atual ? null : c);
                      setDayCtx(null);
                    }}
                    className={`h-5 w-5 rounded-full border-2 transition hover:scale-110 ${
                      atual ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ background: c }}
                  />
                );
              })}
              {prefs.dias[dayCtx.date] && (
                <button
                  type="button"
                  aria-label="Tirar a cor do dia"
                  title="Tirar a cor"
                  onClick={() => {
                    pintarDia(dayCtx.date, null);
                    setDayCtx(null);
                  }}
                  className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-col">
            <button
              onClick={() => {
                setAgendaDia(dayCtx.date);
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Ver agenda do dia</span>
            </button>
            <button
              onClick={() => {
                openQuickCreate({ dueDate: dayCtx.date });
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Criar rápido</span>
            </button>
            <button
              onClick={() => {
                openNewTask({ dueDate: dayCtx.date });
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Nova tarefa detalhada</span>
            </button>
            <button
              onClick={() => {
                setScope("todos");
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Ver de todos</span>
            </button>
          </div>
        </div>
      )}
      <AgendaDoDia
        diaInicial={agendaDia}
        tarefas={filtered}
        escopo={scope}
        aoMudarEscopo={setScope}
        reservasConhecidas={reservasConhecidas}
        aoFechar={() => setAgendaDia(null)}
        aoVerNoCalendario={(iso) => {
          setAgendaDia(null);
          irParaODia(iso);
        }}
      />
    </FluxoLayout>
  );
}

type DayCell = { date: Date; inMonth: boolean; tasks: any[] };

/** Quem está olhando e as cores que escolheu — o que pinta as pílulas e os dias. */
type Destaque = { euId: string; cor: string; dias: Record<string, string> };

/** A cor de uma tarefa: a minha, na cor escolhida; a dos outros, pela situação. */
const corDaTarefa = (t: { assigneeId: string; status: string }, d: Destaque) =>
  t.assigneeId === d.euId ? d.cor : statusColor[t.status as keyof typeof statusColor];

/** Uma fileira de cores para escolher, mais a personalizada e a volta ao padrão. */
function EscolhaDeCor({
  titulo,
  valor,
  aoMudar,
}: {
  titulo: string;
  valor: string | null;
  aoMudar: (cor: string | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {CORES_PRONTAS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            aria-pressed={valor === c}
            onClick={() => aoMudar(c)}
            className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
              valor === c ? "border-foreground" : "border-transparent"
            }`}
            style={{ background: c }}
          />
        ))}
        <SeletorDeCor
          valor={valor ?? "#2563eb"}
          aoMudar={aoMudar}
          personalizada={!!valor && !CORES_PRONTAS.includes(valor)}
        />
        <button
          type="button"
          onClick={() => aoMudar(null)}
          disabled={!valor}
          className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Padrão
        </button>
      </div>
    </div>
  );
}

/** O botão "Cores" do calendário: o destaque das minhas tarefas. Os dias se pintam
 *  um a um, pelo botão direito no dia. */
function CoresDoCalendario({
  prefs,
  aoMudar,
}: {
  prefs: PrefsDoCalendario;
  aoMudar: (parte: Partial<PrefsDoCalendario>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Palette className="h-3.5 w-3.5" />
          Cores
          {prefs.minhas && (
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-card"
              style={{ background: prefs.minhas }}
              aria-hidden
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[450] w-72 space-y-4">
        <EscolhaDeCor
          titulo="Minhas tarefas"
          valor={prefs.minhas}
          aoMudar={(cor) => aoMudar({ minhas: cor })}
        />
        <p className="text-[11px] text-muted-foreground">
          Para pintar um dia, clique nele com o botão direito. Vale só para você.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** O que a pessoa marcou num dia pela agenda: anotação e quantos lembretes. */
type MarcaDoDia = { nota: boolean; lembretes: number };

/** Os ícones de anotação e lembrete ao lado do número do dia. */
function MarcasDoDia({ marca }: { marca: MarcaDoDia | undefined }) {
  if (!marca || (!marca.nota && marca.lembretes === 0)) return null;
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground" aria-hidden>
      {marca.nota && <NotebookPen className="h-3 w-3" />}
      {marca.lembretes > 0 && <AlarmClock className="h-3 w-3 text-warning" />}
    </span>
  );
}

/** O rótulo do botão do dia diz também o que as marcas mostram — para quem não as vê. */
function rotuloDoDia(data: Date, marca: MarcaDoDia | undefined): string {
  const partes = [`Agenda de ${data.toLocaleDateString("pt-BR")}`];
  if (marca?.nota) partes.push("com anotação");
  if (marca && marca.lembretes > 0)
    partes.push(`${marca.lembretes} ${marca.lembretes === 1 ? "lembrete" : "lembretes"}`);
  return partes.join(", ");
}

/**
 * O clique no vazio do dia: abre a agenda dele (`AgendaDoDia`), de onde se cria
 * tarefa ou se reserva sala. Antes criava tarefa direto, e no mês o duplo clique
 * trocava para o modo Dia — o que a agenda agora faz pelo botão "Ver no modo Dia".
 *
 * Fica POR TRÁS do conteúdo, cobrindo a célula, e não em volta dele. Antes a
 * célula inteira era um <button> com as pílulas de tarefa e de reserva — botões
 * também — dentro: botão dentro de botão é HTML inválido, o React acusava no
 * console e o leitor de tela não chegava nas pílulas. O conteúdo por cima deixa
 * o mouse passar (`pointer-events-none`) e só as pílulas o recebem de volta.
 */
function BotaoDoDia({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      aria-haspopup="dialog"
      onClick={onClick}
      className="absolute inset-0 rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
    />
  );
}

function TaskPill({
  t,
  users,
  destaque,
  onClick,
  onContext,
}: {
  t: any;
  users: any[];
  destaque: Destaque;
  onClick: () => void;
  onContext: (x: number, y: number) => void;
}) {
  const sec = sectors.find((s) => s.id === t.sector);
  const u = users.find((x) => x.id === t.assigneeId);
  const minha = t.assigneeId === destaque.euId;
  const prevista = !!t.prevista;
  const cor = corDaTarefa(t, destaque);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e.clientX, e.clientY);
      }}
      className={`pointer-events-auto flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] transition hover:brightness-95 ${
        minha ? "border-l-[3px] font-medium" : ""
      } ${prevista ? "border border-dashed opacity-80" : ""}`}
      style={{
        background: prevista ? "transparent" : `color-mix(in oklab, ${cor} ${minha ? 24 : 12}%, transparent)`,
        borderColor: cor,
      }}
      title={`${t.title} · ${u?.name}${prevista ? " · próxima ocorrência" : ""}`}
    >
      {prevista && <Repeat className="h-2.5 w-2.5 shrink-0" style={{ color: cor }} aria-label="Recorrente" />}
      <span className="truncate">{t.title}</span>
      <span className="ml-auto shrink-0" style={{ color: sec?.color }}>•</span>
    </button>
  );
}

/**
 * A reserva de sala dentro do calendário de tarefas.
 *
 * Visual de propósito diferente do `TaskPill`: contorno em vez de fundo
 * chapado, ícone de porta e a hora na frente. São duas espécies de compromisso
 * dividindo o mesmo dia, e deixá-las parecidas seria pior do que não mostrar —
 * a pessoa clicaria numa achando que é a outra.
 */
function ReservaPill({ r, onClick }: { r: ReservaDeSala; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${r.sala} · ${r.inicio}–${r.fim} · ${r.motivo} · ${r.responsavel}`}
      className="pointer-events-auto flex w-full items-center gap-1 rounded border border-primary/40 px-1 py-0.5 text-left text-[10px] transition hover:bg-primary/10"
    >
      <DoorOpen className="h-2.5 w-2.5 shrink-0 text-primary" />
      <span className="shrink-0 font-semibold tabular-nums">{r.inicio}</span>
      <span className="truncate text-muted-foreground">{r.motivo}</span>
    </button>
  );
}

function MonthGrid({
  cursor,
  filtered,
  users,
  destaque,
  reservasPorDia,
  marcas,
  onReservaClick,
  onDayClick,
  onDayContext,
  onTaskClick,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  reservasPorDia: Map<string, ReservaDeSala[]>;
  marcas: Map<string, MarcaDoDia>;
  onReservaClick: (iso: string) => void;
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number) => void;
  onTaskClick: (id: string) => void;
}) {
  const cells = useMemo<DayCell[]>(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDow = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startDow);
    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const dayEnd = new Date(d);
      dayEnd.setDate(d.getDate() + 1);
      const dayTasks = filtered.filter((t) => {
        if (!t.dueDate) return false; // sem prazo não tem dia no calendário
        const dt = new Date(t.dueDate).getTime();
        return dt >= d.getTime() && dt < dayEnd.getTime();
      });
      out.push({ date: d, inMonth: d.getMonth() === cursor.getMonth(), tasks: dayTasks });
    }
    return out;
  }, [cursor, filtered]);

  return (
    <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
        <div key={d} className="bg-secondary/60 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {d}
        </div>
      ))}
      {cells.map((cell, i) => {
        const today = cell.date.toDateString() === new Date().toDateString();
        const iso = dataParaIso(cell.date);
        const salas = reservasPorDia.get(iso) ?? [];
        /* A célula tem altura fixa, então as reservas comem o espaço das
           tarefas em vez de esticar o mês: um horário marcado é mais rígido
           que um prazo, que a pessoa remaneja. */
        const cabemTarefas = salas.length > 0 ? 2 : 3;
        return (
          <div
            key={i}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDayContext(e.clientX, e.clientY, iso, cell.tasks.length);
            }}
            className={`relative min-h-[7rem] bg-card p-1.5 text-left transition hover:bg-secondary/40 ${cell.inMonth ? "" : "opacity-40"}`}
            style={{ background: fundoPintado(destaque.dias[iso]) }}
          >
            <BotaoDoDia
              rotulo={rotuloDoDia(cell.date, marcas.get(iso))}
              onClick={() => onDayClick(iso)}
            />
            <div className="pointer-events-none relative flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span
                  className={`text-[11px] font-semibold ${
                    today
                      ? "rounded-full bg-primary px-1.5 text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                <MarcasDoDia marca={marcas.get(iso)} />
              </span>
              {cell.tasks.length > 0 && (
                <span className="text-[10px] text-muted-foreground">{cell.tasks.length}</span>
              )}
            </div>
            <div className="pointer-events-none relative mt-1 space-y-0.5">
              {salas.slice(0, 2).map((r) => (
                <ReservaPill key={r.id} r={r} onClick={() => onReservaClick(iso)} />
              ))}
              {salas.length > 2 && (
                <div className="text-[10px] text-primary">+{salas.length - 2} reservas</div>
              )}
              {cell.tasks.slice(0, cabemTarefas).map((t: any) => (
                <TaskPill
                  key={t.id}
                  t={t}
                  users={users}
                  destaque={destaque}
                  onClick={() => onTaskClick(t.id)}
                  onContext={(x, y) => openTaskContext(idReal(t.id), x, y)}
                />
              ))}
              {cell.tasks.length > cabemTarefas && (
                <div className="text-[10px] text-muted-foreground">
                  +{cell.tasks.length - cabemTarefas} mais
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekGrid({
  cursor,
  filtered,
  users,
  destaque,
  reservasPorDia,
  marcas,
  onReservaClick,
  onDayClick,
  onDayContext,
  onTaskClick,
  onSwitchDay,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  reservasPorDia: Map<string, ReservaDeSala[]>;
  marcas: Map<string, MarcaDoDia>;
  onReservaClick: (iso: string) => void;
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number) => void;
  onTaskClick: (id: string) => void;
  onSwitchDay: (iso: string) => void;
}) {
  const days = useMemo(() => {
    const s = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(s);
      d.setDate(s.getDate() + i);
      const e = new Date(d);
      e.setDate(d.getDate() + 1);
      const dayTasks = filtered
        .filter((t) => {
          if (!t.dueDate) return false; // sem prazo não tem dia no calendário
          const dt = new Date(t.dueDate).getTime();
          return dt >= d.getTime() && dt < e.getTime();
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      return { date: d, tasks: dayTasks };
    });
  }, [cursor, filtered]);

  return (
    <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {days.map((day, i) => {
        const today = day.date.toDateString() === new Date().toDateString();
        const iso = dataParaIso(day.date);
        return (
          <div
            key={i}
            className="flex min-h-[26rem] flex-col bg-card"
            style={{ background: fundoPintado(destaque.dias[iso]) }}
          >
            <button
              onClick={() => onSwitchDay(iso)}
              className="border-b border-border bg-secondary/60 px-2 py-1.5 text-left transition hover:bg-secondary"
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {day.date.toLocaleDateString("pt-BR", { weekday: "short" })}
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-lg font-semibold ${today ? "text-primary" : ""}`}>
                  {day.date.getDate()}
                </span>
                <MarcasDoDia marca={marcas.get(iso)} />
              </div>
            </button>
            <div
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDayContext(e.clientX, e.clientY, iso, day.tasks.length);
              }}
              className="relative flex-1 p-1.5 text-left hover:bg-secondary/30"
            >
              <BotaoDoDia
                rotulo={rotuloDoDia(day.date, marcas.get(iso))}
                onClick={() => onDayClick(iso)}
              />
              <div className="pointer-events-none relative space-y-1">
                {(reservasPorDia.get(iso) ?? []).map((r) => (
                  <ReservaPill key={r.id} r={r} onClick={() => onReservaClick(iso)} />
                ))}
                {day.tasks.length === 0 && (reservasPorDia.get(iso) ?? []).length === 0 && (
                  <div className="text-[10px] text-muted-foreground/60">—</div>
                )}
                {day.tasks.map((t: any) => (
                  <TaskPill
                    key={t.id}
                    t={t}
                    users={users}
                    destaque={destaque}
                    onClick={() => onTaskClick(t.id)}
                    onContext={(x, y) => openTaskContext(idReal(t.id), x, y)}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Memorizadas: a agenda do dia e o menu do dia moram na página, e abrir ou
   fechar qualquer um deles redesenhava as 42 células do mês com todas as
   pílulas. O que elas recebem é estável — ver os `useCallback` na página. */
const MonthGridMemo = memo(MonthGrid);
const WeekGridMemo = memo(WeekGrid);

function DayView({
  cursor,
  filtered,
  users,
  destaque,
  reservasDoDia,
  mostrarSalas,
  onReservaClick,
  onTaskClick,
  onNew,
  onReorder,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  reservasDoDia: ReservaDeSala[];
  mostrarSalas: boolean;
  onReservaClick: (iso: string) => void;
  onTaskClick: (id: string) => void;
  onNew: () => void;
  onReorder: (ids: string[]) => void;
}) {
  const dayTasks = useMemo(() => {
    const s = startOfDay(cursor).getTime();
    const e = s + 24 * 60 * 60 * 1000;
    return filtered
      .filter((t) => {
        if (!t.dueDate) return false; // sem prazo não tem dia no calendário
        const dt = new Date(t.dueDate).getTime();
        return dt >= s && dt < e;
      })
      .sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.dueDate.localeCompare(b.dueDate),
      );
  }, [cursor, filtered]);

  const byStatus = useMemo(() => {
    const g: Record<string, any[]> = { pendente: [], andamento: [], concluida: [] };
    dayTasks.forEach((t) => g[t.status as string]?.push(t));
    return g;
  }, [dayTasks]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ st: string; index: number } | null>(null);

  const { moveTask } = useFluxo();

  const handleDrop = (st: string, insertIdx: number) => {
    if (!dragId) return;
    /* Soltar em outra coluna muda a situação, como no quadro. Antes só a
       ordem era gravada e o cartão voltava para a coluna de onde saiu
       (auditoria de 08/10/2026). `moveTask` cuida de conclusão, pontos e
       comprovante, igual a qualquer outra tela. */
    const arrastada = filtered.find((t) => t.id === dragId);
    if (arrastada && !ehPrevista(dragId) && arrastada.status !== st) {
      moveTask(dragId, st as "pendente" | "andamento" | "concluida");
    }
    const list = (byStatus[st] || []).filter((t) => t.id !== dragId);
    const idx = Math.min(insertIdx, list.length);
    const ids = [
      ...list.slice(0, idx).map((t) => t.id),
      dragId,
      ...list.slice(idx).map((t) => t.id),
    ].filter((id) => !ehPrevista(id)); // a prevista não tem ordem a gravar
    onReorder(ids);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div
      className="mt-4 rounded-lg border border-border bg-card"
      style={{ background: fundoPintado(destaque.dias[dataParaIso(cursor)]) }}
    >
      <div className="flex items-center justify-between border-b border-border p-3">
        <div className="text-sm text-muted-foreground">
          {dayTasks.length} {dayTasks.length === 1 ? "tarefa" : "tarefas"} nesse dia
        </div>
        <button onClick={onNew} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      </div>
      <div className={`grid grid-cols-1 gap-px bg-border ${mostrarSalas ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
        {(["pendente", "andamento", "concluida"] as const).map((st) => (
          <div
            key={st}
            className="flex flex-col bg-card p-3"
            style={{ background: fundoPintado(destaque.dias[dataParaIso(cursor)]) }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId && !dropTarget) setDropTarget({ st, index: (byStatus[st] || []).length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(st, dropTarget?.st === st ? dropTarget.index : (byStatus[st] || []).length);
            }}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: statusColor[st] }} />
              {statusLabels[st]}
              <span className="ml-auto">{byStatus[st].length}</span>
            </div>
            <div className="space-y-1.5">
              {byStatus[st].map((t, index) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                const showBefore =
                  dropTarget?.st === st && dropTarget.index === index && dragId && dragId !== t.id;
                return (
                  <div key={t.id}>
                    {showBefore && <div className="mb-1 h-0.5 rounded-full bg-primary" />}
                    <button
                      draggable={!t.prevista}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(t.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const before = e.clientY < rect.top + rect.height / 2;
                        setDropTarget({ st, index: before ? index : index + 1 });
                      }}
                      onClick={() => onTaskClick(t.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openTaskContext(idReal(t.id), e.clientX, e.clientY);
                      }}
                      className={`w-full rounded-md border border-border bg-background p-2 text-left transition hover:bg-secondary/60 ${
                        t.prevista ? "border-dashed opacity-80" : "cursor-grab active:cursor-grabbing"
                      } ${t.assigneeId === destaque.euId ? "border-l-[3px]" : ""}`}
                      style={
                        t.assigneeId === destaque.euId ? { borderLeftColor: destaque.cor } : undefined
                      }
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 truncate text-xs font-medium">
                            {t.prevista && <Repeat className="h-3 w-3 shrink-0" aria-label="Recorrente" />}
                            <span className="truncate">{t.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span style={{ color: sec?.color }}>{sec?.name}</span>
                            <span>·</span>
                            <span className="truncate">{u?.name}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
              {byStatus[st].length === 0 && <div className="text-[11px] text-muted-foreground/60">Vazio</div>}
            </div>
          </div>
        ))}

        {/* A quarta coluna já existia vazia na grade (`md:grid-cols-4` com três
            filhos). As salas do dia cabem exatamente ali, ao lado do quadro de
            situações, sem mexer na largura de nada. Ocultas, a grade volta a três. */}
        {mostrarSalas && (
        <div className="flex flex-col bg-card p-3" style={{ background: fundoPintado(destaque.dias[dataParaIso(cursor)]) }}>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <DoorOpen className="h-3 w-3 text-primary" />
            Salas de reunião
            <span className="ml-auto">{reservasDoDia.length}</span>
          </div>
          <div className="space-y-1.5">
            {reservasDoDia.map((r) => (
              <button
                key={r.id}
                onClick={() => onReservaClick(r.data)}
                title={`${r.sala} · ${r.motivo} · ${r.responsavel}`}
                className="w-full rounded-md border border-primary/40 bg-primary/5 p-2 text-left transition hover:bg-primary/10"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                  {r.inicio}–{r.fim}
                  <span className="truncate text-[10px] font-medium text-muted-foreground">
                    {r.sala}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px]">{r.motivo}</div>
                {/* `nomeCurto` porque o cadastro vem TODO EM MAIÚSCULAS da IAM,
                    e "EDUARDO FERREIRA DA SILVA" gritando numa coluna estreita
                    rouba a atenção do motivo, que é o que se lê primeiro. */}
                <div className="truncate text-[10px] text-muted-foreground">
                  {nomeCurto(r.para_nome || r.responsavel)}
                </div>
              </button>
            ))}
            {reservasDoDia.length === 0 && (
              <button
                onClick={() => onReservaClick(dataParaIso(cursor))}
                className="w-full rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground transition hover:bg-secondary"
              >
                Nenhuma sala reservada — reservar
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function ListView({
  cursor,
  filtered,
  users,
  destaque,
  onTaskClick,
  onReorder,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  onTaskClick: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const groups = useMemo(() => {
    const start = startOfDay(cursor).getTime();
    const end = start + 60 * 24 * 60 * 60 * 1000; // 60 days window
    const list = filtered
      .filter((t) => {
        if (!t.dueDate) return false; // sem prazo não tem dia no calendário
        const dt = new Date(t.dueDate).getTime();
        return dt >= start && dt < end;
      })
      .sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) || (a.order ?? 0) - (b.order ?? 0),
      );
    const map = new Map<string, any[]>();
    list.forEach((t) => {
      // Dia local: pelo UTC, o prazo de hoje às 23:59 ia para o grupo de amanhã.
      const key = dataParaIso(new Date(t.dueDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    // Sort each day by order
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.dueDate.localeCompare(b.dueDate));
    }
    return Array.from(map.entries());
  }, [cursor, filtered]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ iso: string; index: number } | null>(null);

  const handleDrop = (iso: string, items: any[], insertIdx: number) => {
    if (!dragId) return;
    const list = items.filter((t) => t.id !== dragId);
    const idx = Math.min(insertIdx, list.length);
    const ids = [
      ...list.slice(0, idx).map((t) => t.id),
      dragId,
      ...list.slice(idx).map((t) => t.id),
    ].filter((id) => !ehPrevista(id)); // a prevista não tem ordem a gravar
    onReorder(ids);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="mt-4 space-y-3">
      {groups.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Nenhuma tarefa nos próximos 60 dias.
        </div>
      )}
      {groups.map(([iso, items]) => {
        const d = new Date(iso + "T00:00:00");
        const today = d.toDateString() === new Date().toDateString();
        return (
          <div
            key={iso}
            className="overflow-hidden rounded-lg border border-border bg-card"
            style={{ background: fundoPintado(destaque.dias[iso]) }}
          >
            <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-2">
              <div className={`text-xs font-semibold uppercase tracking-wider ${today ? "text-primary" : "text-muted-foreground"}`}>
                {d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                {today && <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">Hoje</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">{items.length}</div>
            </div>
            <div className="divide-y divide-border">
              {items.map((t: any, index: number) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                const showBefore =
                  dropTarget?.iso === iso && dropTarget.index === index && dragId && dragId !== t.id;
                return (
                  <button
                    key={t.id}
                    draggable={!t.prevista}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(t.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const before = e.clientY < rect.top + rect.height / 2;
                      setDropTarget({ iso, index: before ? index : index + 1 });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(iso, items, dropTarget?.index ?? index);
                    }}
                    onClick={() => onTaskClick(t.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openTaskContext(idReal(t.id), e.clientX, e.clientY);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40 ${
                      t.prevista ? "opacity-80" : "cursor-grab active:cursor-grabbing"
                    } ${showBefore ? "border-t-2 border-t-primary" : ""} ${
                      t.assigneeId === destaque.euId ? "border-l-[3px]" : ""
                    }`}
                    style={
                      t.assigneeId === destaque.euId ? { borderLeftColor: destaque.cor } : undefined
                    }
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {t.prevista && (
                          <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Próxima ocorrência" />
                        )}
                        <span className="truncate">{t.title}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span style={{ color: sec?.color }}>{sec?.name}</span>
                        <span>·</span>
                        <span className="truncate">{u?.name}</span>
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `color-mix(in oklab, ${statusColor[t.status as keyof typeof statusColor]} 15%, transparent)`,
                        color: statusColor[t.status as keyof typeof statusColor],
                      }}
                    >
                      {statusLabels[t.status as keyof typeof statusLabels]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}