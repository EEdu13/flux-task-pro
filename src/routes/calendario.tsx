import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  GanttChartSquare,
  List,
  User as IconeEu,
  Users,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Lock,
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
import {
  comOcorrenciasPrevistas,
  ehPrevista,
  idReal,
  type TarefaNoCalendario,
} from "@/lib/ocorrencias-previstas";
import {
  CORES_DO_DIA,
  usePrefsDoCalendario,
  type PrefsDoCalendario,
} from "@/lib/use-prefs-do-calendario";
import { AGENDA_PESSOAL_MUDOU, AgendaDoDia } from "@/components/agenda-do-dia";
import { listarAgendaPessoal } from "@/lib/agenda-pessoal.functions";
import { FluxoLayout } from "@/components/fluxo-layout";
import { UserAvatar } from "@/components/user-avatar";
import { FiltroPessoa } from "@/components/filtro-pessoa";
import { ehChefeDe } from "@/lib/permissoes";
import {
  SEM_SELECAO_DE_PESSOAS,
  passaNoFiltroDePessoas,
  type SelecaoDePessoas,
} from "@/lib/filtro-de-pessoas";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, statusColor, statusLabels, type User } from "@/lib/fluxo-types";
import { openTaskContext } from "@/components/task-context-menu";
import { dataParaIso } from "@/lib/data-iso";
import { nomeCurto } from "@/lib/nome-curto";
import { RESERVA_CRIADA, abrirReservaDeSala } from "@/components/reserva-de-sala-modal";
import { listarAgendaDeSalas, type ReservaDeSala } from "@/lib/reservas-sala.functions";
import { toast } from "sonner";
import { GradeDeHoras, type BlocoNaGrade } from "@/components/grade-de-horas";
import {
  DetalheDoCompromisso,
  TravarAgendaDialog,
  type PedidoDeTravar,
} from "@/components/travar-agenda";
import {
  COMPROMISSOS_MUDARAM,
  COR_DA_AGENDA_TRAVADA,
  faixaDeHorario,
  type Compromisso,
} from "@/lib/compromisso";
import {
  compromissosPorDia as travadosPorDiaDaFaixa,
  lerCompromissos,
} from "@/lib/compromissos-cliente";
import { detalharCompromisso } from "@/lib/compromissos.functions";

export const Route = createFileRoute("/calendario")({
  /* `?compromisso=<id>` (14/10/2026): o aviso da agenda travada abre o
     calendário no dia do compromisso, com o detalhe aberto. */
  validateSearch: (s: Record<string, unknown>): { compromisso?: string } =>
    typeof s.compromisso === "string" && /^[0-9a-f-]{36}$/i.test(s.compromisso)
      ? { compromisso: s.compromisso }
      : {},
  head: () => ({
    meta: [
      { title: "Calendário · SGL - CONECTA" },
      {
        name: "description",
        content: "Visão mensal, semanal, diária e lista de todas as tarefas por prazo.",
      },
    ],
  }),
  component: CalendarioPage,
});

type ViewMode = "mes" | "semana" | "dia" | "lista" | "linhas";

const ICONE_DA_VISAO: Record<ViewMode, typeof CalendarDays> = {
  mes: CalendarDays,
  semana: CalendarRange,
  dia: CalendarClock,
  lista: List,
  linhas: GanttChartSquare,
};

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

/** O instante de um dia ("yyyy-MM-dd") mais minutos desde a meia-noite, no fuso da máquina. */
const instanteNoDia = (iso: string, minutos: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setMinutes(minutos);
  return d;
};

/** Um intervalo de horário escolhido na grade (minutos desde a meia-noite). */
type FaixaDeHorario = { inicio: number; fim: number };

/** 870 → "14:30"; 1440 → "24:00". */
const hhmmDosMinutos = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function CalendarioPage() {
  const { tasks, currentUser, users, openTask, openNewTask, openQuickCreate, reorderTasks } =
    useFluxo();
  const [view, setView] = useState<ViewMode>("mes");
  /** A largura da visão em linhas: uma semana ou o mês inteiro. */
  const [escalaLinhas, setEscalaLinhas] = useState<"semana" | "mes">("semana");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState<"eu" | "todos">("eu");
  const [prefs, mudarPrefs, pintarDia] = usePrefsDoCalendario(currentUser.id);
  const corMinhas = prefs.minhas ?? "var(--primary)";
  const [dayCtx, setDayCtx] = useState<{
    x: number;
    y: number;
    date: string;
    count: number;
    /** O horário marcado na grade de horas, quando o clique veio de lá. */
    faixa?: FaixaDeHorario;
  } | null>(null);
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

  /* Filtro por pessoa da equipe (pedido do usuário, 12/10/2026: "só tem o
     todos"). Em "Equipe" aparece a faixa de rostos — eu e quem está abaixo de
     mim no organograma (a gerência, todo mundo que tem tarefa visível) — e dá
     para marcar uma ou mais pessoas, como na lista de tarefas. */
  const [filtroPessoas, setFiltroPessoas] = useState<SelecaoDePessoas>(SEM_SELECAO_DE_PESSOAS);
  const equipe = useMemo(() => {
    const comTarefa = new Set(tasks.map((t) => t.assigneeId));
    return users.filter(
      (u) =>
        comTarefa.has(u.id) &&
        (u.id === currentUser.id ||
          currentUser.role === "gerente" ||
          ehChefeDe(currentUser, users, u.id)),
    );
  }, [tasks, users, currentUser]);

  const filtered = useMemo(
    () =>
      scope === "eu"
        ? tasks.filter((t) => t.assigneeId === currentUser.id)
        : tasks.filter((t) => passaNoFiltroDePessoas(filtroPessoas, t.assigneeId)),
    [tasks, scope, currentUser.id, filtroPessoas],
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

  /* Agenda travada (pedido do usuário, 14/10/2026): os compromissos do
     período, por cima das tarefas — como as reservas de sala. No "Só minhas",
     os meus; na "Equipe", também os de quem responde a mim (o servidor aplica
     a régua). Sem a migração, `ativa` volta `false` e a lista vem vazia: o
     calendário segue como antes. Todas as visões mostram (14/10/2026: "precisam
     mostrar os compromissos na agenda"): a lista olha os mesmos 60 dias dela.
     A leitura tem memória por período (`lerCompromissos`) — trocar de visão e
     voltar não vai ao servidor de novo. */
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [agendaAtiva, setAgendaAtiva] = useState<boolean | null>(null);
  const [versaoCompromissos, setVersaoCompromissos] = useState(0);
  const faixaDosCompromissos = useMemo(
    () =>
      view === "lista"
        ? {
            de: dataParaIso(cursor),
            ate: dataParaIso(
              new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 59),
            ),
          }
        : faixa,
    [view, cursor, faixa],
  );
  useEffect(() => {
    const aoMudar = () => setVersaoCompromissos((v) => v + 1);
    window.addEventListener(COMPROMISSOS_MUDARAM, aoMudar);
    return () => window.removeEventListener(COMPROMISSOS_MUDARAM, aoMudar);
  }, []);
  useEffect(() => {
    if (!faixaDosCompromissos) return;
    let vivo = true;
    lerCompromissos(faixaDosCompromissos.de, faixaDosCompromissos.ate, scope === "todos")
      .then((r) => {
        if (!vivo) return;
        setAgendaAtiva(r.ativa);
        setCompromissos(r.compromissos);
      })
      // Um extra, como as marcas: falhou, o calendário segue sem os blocos.
      .catch(() => vivo && setCompromissos([]));
    return () => {
      vivo = false;
    };
  }, [faixaDosCompromissos, scope, versaoCompromissos]);

  /* Na Equipe, o filtro de rostos vale também para a agenda travada: passa o
     compromisso em que alguma das pessoas marcadas está (ou que ela criou). */
  const compromissosVisiveis = useMemo(
    () =>
      scope === "eu"
        ? compromissos
        : compromissos.filter((c) =>
            [c.criadoPor, ...c.participantes].some((id) =>
              passaNoFiltroDePessoas(filtroPessoas, id),
            ),
          ),
    [compromissos, scope, filtroPessoas],
  );
  const travadosNaLista = useMemo(
    () =>
      view === "lista" && faixaDosCompromissos
        ? travadosPorDiaDaFaixa(
            compromissosVisiveis,
            faixaDosCompromissos.de,
            faixaDosCompromissos.ate,
          )
        : undefined,
    [view, faixaDosCompromissos, compromissosVisiveis],
  );

  /** O diálogo de travar (novo ou edição) e o detalhe aberto. */
  const [travar, setTravar] = useState<PedidoDeTravar | null>(null);
  const [detalhe, setDetalhe] = useState<Compromisso | null>(null);
  const abrirTravar = useCallback((iso: string, faixa?: FaixaDeHorario) => {
    let inicio = faixa?.inicio;
    if (inicio === undefined) {
      /* Sem horário marcado: a próxima meia hora, se for hoje; senão, 09:00. */
      const agora = new Date();
      inicio =
        iso === dataParaIso(agora)
          ? Math.min(
              23 * 60 + 30,
              Math.ceil((agora.getHours() * 60 + agora.getMinutes()) / 30) * 30,
            )
          : 9 * 60;
    }
    const fim = faixa?.fim ?? inicio + 30;
    setTravar({ inicio: instanteNoDia(iso, inicio), fim: instanteNoDia(iso, fim) });
  }, []);

  /* `?compromisso=<id>`: vindo do aviso, vai ao dia dele no modo Dia e abre o
     detalhe. Depois tira o parâmetro, para voltar à página não reabrir. */
  const { compromisso: compromissoDaUrl } = Route.useSearch();
  const navigate = useNavigate();
  useEffect(() => {
    if (!compromissoDaUrl) return;
    let vivo = true;
    detalharCompromisso({ data: { id: compromissoDaUrl } })
      .then((r) => {
        if (!vivo) return;
        if (!r.compromisso) {
          toast("Essa agenda não está mais de pé — pode ter sido cancelada.");
          return;
        }
        setCursor(startOfDay(new Date(r.compromisso.inicio)));
        setView("dia");
        setDetalhe(r.compromisso);
      })
      .catch((e) => vivo && toast.error((e as Error)?.message || "Não deu para abrir a agenda."))
      .finally(() => {
        if (vivo) void navigate({ to: "/calendario", search: {}, replace: true });
      });
    return () => {
      vivo = false;
    };
  }, [compromissoDaUrl, navigate]);

  /* Abre o modal já no dia clicado, em vez de navegar: o calendário é a tela
     de onde se enxerga o conflito, e sair dela para resolver seria perder de
     vista justamente o que motivou a reserva.

     Estes três são estáveis (`useCallback`) porque as grades são memorizadas:
     abrir e fechar a agenda ou o menu do dia não redesenha o mês inteiro. */
  const abrirReservas = useCallback((iso: string) => abrirReservaDeSala(iso), []);
  const abrirMenuDoDia = useCallback(
    (x: number, y: number, iso: string, count: number, faixa?: FaixaDeHorario) =>
      setDayCtx({ x, y, date: iso, count, faixa }),
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
      return cursor.toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
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
        {/* Cabeçalho repaginado (pedido do usuário, 14/10/2026: "os botões em
            cima estão muito ruins"). Em cima: navegar, o período e a ação
            principal. Embaixo, uma barra só, agrupada por assunto: como ver
            (visão), de quem (só minhas / equipe) e os ajustes de exibição. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
            <button
              type="button"
              onClick={goPrev}
              title="Anterior"
              aria-label="Anterior"
              className="rounded-md p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="rounded-md px-3 py-1.5 text-sm font-semibold transition hover:bg-secondary"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={goNext}
              title="Próximo"
              aria-label="Próximo"
              className="rounded-md p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0">
            {/* Só a primeira letra maiúscula: "Outubro de 2026", não "Outubro De 2026". */}
            <h1 className="font-display text-2xl font-bold tracking-tight first-letter:uppercase">
              {headerLabel}
            </h1>
            <p className="text-xs text-muted-foreground">
              Prazos, salas e agendas travadas. Botão direito num horário para travar a agenda.
            </p>
          </div>
          <button
            type="button"
            onClick={() => abrirTravar(dataParaIso(view === "mes" ? new Date() : cursor))}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            <Lock className="h-4 w-4" /> Travar agenda
          </button>
        </div>

        <div className="mb-3 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/70 p-1.5 shadow-sm backdrop-blur">
          <div
            className="inline-flex rounded-lg bg-secondary/60 p-0.5"
            role="group"
            aria-label="Visão"
          >
            {(["mes", "semana", "dia", "lista", "linhas"] as ViewMode[]).map((v) => {
              const Icone = ICONE_DA_VISAO[v];
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    view === v
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icone className="h-3.5 w-3.5" />
                  {ROTULO_DA_VISAO[v]}
                </button>
              );
            })}
          </div>
          {view === "linhas" && (
            <div
              className="inline-flex rounded-lg bg-secondary/60 p-0.5"
              role="group"
              aria-label="Período das linhas"
            >
              {(["semana", "mes"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={escalaLinhas === e}
                  onClick={() => setEscalaLinhas(e)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    escalaLinhas === e
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e === "semana" ? "Semana" : "Mês"}
                </button>
              ))}
            </div>
          )}

          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />

          <div
            className="inline-flex rounded-lg bg-secondary/60 p-0.5"
            role="group"
            aria-label="De quem"
          >
            {(
              [
                ["eu", "Só minhas", IconeEu],
                ["todos", "Equipe", Users],
              ] as const
            ).map(([v, rotulo, Icone]) => (
              <button
                key={v}
                type="button"
                aria-pressed={scope === v}
                onClick={() => setScope(v)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  scope === v
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icone className="h-3.5 w-3.5" />
                {rotulo}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {view !== "linhas" && view !== "lista" && (
              <button
                type="button"
                aria-pressed={!prefs.ocultarSalas}
                onClick={() => mudarPrefs({ ocultarSalas: !prefs.ocultarSalas })}
                title={
                  prefs.ocultarSalas ? "Mostrar as reservas de sala" : "Ocultar as reservas de sala"
                }
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                  prefs.ocultarSalas
                    ? "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    : "bg-primary/10 font-medium text-primary hover:bg-primary/15"
                }`}
              >
                <DoorOpen className="h-3.5 w-3.5" />
                Salas
              </button>
            )}
            <CoresDoCalendario prefs={prefs} aoMudar={mudarPrefs} />
          </div>
        </div>

        {scope === "todos" && equipe.length > 1 && (
          <div className="mb-3">
            <FiltroPessoa
              pessoas={equipe}
              setor="todos"
              valor={filtroPessoas}
              aoMudar={setFiltroPessoas}
            />
          </div>
        )}

        {view === "mes" && (
          <MonthGridMemo
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            reservasPorDia={reservasPorDia}
            compromissos={compromissosVisiveis}
            marcas={marcas}
            onReservaClick={abrirReservas}
            onCompromissoClick={setDetalhe}
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
            compromissos={compromissosVisiveis}
            marcas={marcas}
            onReservaClick={abrirReservas}
            onCompromissoClick={setDetalhe}
            onDayClick={setAgendaDia}
            onDayContext={abrirMenuDoDia}
            onTravar={abrirTravar}
            onTaskClick={abrirTarefa}
            onSwitchDay={irParaODia}
          />
        )}
        {/* As linhas de horário do dia (14/10/2026), em cima do quadro por
            situação, que continua igual embaixo. */}
        {view === "dia" && (
          <DayGridMemo
            cursor={cursor}
            filtered={comPrevistas}
            users={users}
            destaque={destaque}
            reservasDoDia={reservasPorDia.get(dataParaIso(cursor)) ?? SEM_RESERVAS}
            compromissos={compromissosVisiveis}
            onReservaClick={abrirReservas}
            onCompromissoClick={setDetalhe}
            onDayClick={setAgendaDia}
            onDayContext={abrirMenuDoDia}
            onTravar={abrirTravar}
            onTaskClick={abrirTarefa}
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
            travadosPorDia={travadosNaLista}
            onCompromissoClick={setDetalhe}
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
                comPrevistas.filter((t) => t.dueDate && dataParaIso(new Date(t.dueDate)) === iso)
                  .length,
              )
            }
            inicio={faixaDasLinhas.inicio}
            dias={faixaDasLinhas.dias}
            compromissos={compromissosVisiveis}
            onCompromissoClick={setDetalhe}
            onTaskClick={abrirTarefa}
          />
        )}
      </div>
      {dayCtx && (
        <div
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            left: Math.min(
              dayCtx.x,
              (typeof window !== "undefined" ? window.innerWidth : 1200) - 240,
            ),
            top: Math.min(
              dayCtx.y,
              (typeof window !== "undefined" ? window.innerHeight : 800) - 200,
            ),
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
            {/* Travar agenda (14/10/2026): trava o horário de alguém, como no
                Outlook. Vindo da grade de horas, já leva o horário marcado. */}
            <button
              onClick={() => {
                abrirTravar(dayCtx.date, dayCtx.faixa);
                setDayCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Travar agenda</span>
              {dayCtx.faixa && (
                <span className="ml-auto font-normal tabular-nums text-muted-foreground">
                  {hhmmDosMinutos(dayCtx.faixa.inicio)}–{hhmmDosMinutos(dayCtx.faixa.fim)}
                </span>
              )}
            </button>
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
        aoAbrirCompromisso={setDetalhe}
        aoVerNoCalendario={(iso) => {
          setAgendaDia(null);
          irParaODia(iso);
        }}
      />
      <TravarAgendaDialog
        pedido={travar}
        ativa={agendaAtiva}
        reservasConhecidas={reservasConhecidas}
        aoFechar={() => setTravar(null)}
      />
      <DetalheDoCompromisso
        compromisso={detalhe}
        aoFechar={() => setDetalhe(null)}
        aoEditar={(c) => {
          setDetalhe(null);
          setTravar({ inicio: new Date(c.inicio), fim: new Date(c.fim), compromisso: c });
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
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
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
        background: prevista
          ? "transparent"
          : `color-mix(in oklab, ${cor} ${minha ? 24 : 12}%, transparent)`,
        borderColor: cor,
      }}
      title={`${t.title} · ${u?.name}${prevista ? " · próxima ocorrência" : ""}`}
    >
      {prevista && (
        <Repeat className="h-2.5 w-2.5 shrink-0" style={{ color: cor }} aria-label="Recorrente" />
      )}
      <span className="truncate">{t.title}</span>
      <span className="ml-auto shrink-0" style={{ color: sec?.color }}>
        •
      </span>
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
  compromissos,
  marcas,
  onReservaClick,
  onCompromissoClick,
  onDayClick,
  onDayContext,
  onTaskClick,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  reservasPorDia: Map<string, ReservaDeSala[]>;
  compromissos: Compromisso[];
  marcas: Map<string, MarcaDoDia>;
  onReservaClick: (iso: string) => void;
  onCompromissoClick: (c: Compromisso) => void;
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
  const travadosPorDia = useMemo(
    () =>
      compromissosPorDia(
        compromissos,
        cells.map((c) => c.date),
      ),
    [compromissos, cells],
  );

  return (
    <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
        <div
          key={d}
          className="bg-secondary/60 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {d}
        </div>
      ))}
      {cells.map((cell, i) => {
        const today = cell.date.toDateString() === new Date().toDateString();
        const iso = dataParaIso(cell.date);
        const salas = reservasPorDia.get(iso) ?? [];
        const travados = travadosPorDia.get(iso) ?? [];
        /* A célula tem altura fixa, então as reservas comem o espaço das
           tarefas em vez de esticar o mês: um horário marcado é mais rígido
           que um prazo, que a pessoa remaneja. A agenda travada também. */
        const cabemTarefas = salas.length > 0 || travados.length > 0 ? 2 : 3;
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
              {travados.slice(0, 2).map((c) => (
                <CompromissoPill key={c.id} c={c} onClick={() => onCompromissoClick(c)} />
              ))}
              {travados.length > 2 && (
                <div className="text-[10px]" style={{ color: COR_DA_AGENDA }}>
                  +{travados.length - 2} agendas
                </div>
              )}
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

/** A cor dos blocos da agenda travada — a mesma para todos, com cadeado. */
const COR_DA_AGENDA = COR_DA_AGENDA_TRAVADA;

/** "HH:mm" válido no prazo — o mesmo teste da agenda do dia. */
const HORARIO_DO_PRAZO = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A tarefa tem hora marcada e por isso vai para a grade, e não para a faixa "Dia todo". */
const temHora = (t: { dueTime?: string | null }) => !!t.dueTime && HORARIO_DO_PRAZO.test(t.dueTime);

/** Os compromissos que tocam cada dia ("yyyy-MM-dd"), na ordem do início. */
function compromissosPorDia(compromissos: Compromisso[], dias: Date[]) {
  const m = new Map<string, Compromisso[]>();
  for (const d of dias) {
    const s = startOfDay(d).getTime();
    const e = s + 86_400_000;
    const doDia = compromissos.filter((c) => Date.parse(c.inicio) < e && Date.parse(c.fim) > s);
    if (doDia.length) m.set(dataParaIso(d), doDia);
  }
  return m;
}

/**
 * Os blocos da grade de horas: tarefas com hora, reservas de sala e a agenda
 * travada. Cada espécie com seu visual — tarefa cheia na cor dela, reserva só
 * contornada com a porta, compromisso roxo com o cadeado — para ninguém clicar
 * numa achando que é a outra (o mesmo cuidado de `ReservaPill`).
 */
function blocosDaGrade({
  dias,
  tarefas,
  reservasPorDia,
  compromissos,
  users,
  destaque,
  onTaskClick,
  onReservaClick,
  onCompromissoClick,
}: {
  dias: Date[];
  tarefas: TarefaNoCalendario[];
  reservasPorDia: Map<string, ReservaDeSala[]>;
  compromissos: Compromisso[];
  users: User[];
  destaque: Destaque;
  onTaskClick: (id: string) => void;
  onReservaClick: (iso: string) => void;
  onCompromissoClick: (c: Compromisso) => void;
}): BlocoNaGrade[] {
  const blocos: BlocoNaGrade[] = [];
  const nomeDe = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? nomeCurto(u.name) : "";
  };
  for (const d of dias) {
    const iso = dataParaIso(d);
    const s = startOfDay(d).getTime();
    const e = s + 86_400_000;

    for (const t of tarefas) {
      if (!t.dueDate || !temHora(t)) continue;
      const dt = new Date(t.dueDate).getTime();
      if (dt < s || dt >= e) continue;
      const [h, m] = (t.dueTime as string).split(":").map(Number);
      const inicio = h! * 60 + m!;
      const duracao = Math.min(240, Math.max(30, Number(t.estimatedMinutes) || 30));
      const u = users.find((x) => x.id === t.assigneeId);
      const prevista = !!t.prevista;
      blocos.push({
        chave: `t-${t.id}-${iso}`,
        iso,
        inicio,
        fim: Math.min(24 * 60, inicio + duracao),
        titulo: t.title,
        subtitulo: `${t.dueTime}${u ? ` · ${nomeCurto(u.name)}` : ""}`,
        cor: corDaTarefa(t, destaque),
        estilo: prevista ? "tracejado" : t.assigneeId === destaque.euId ? "cheio" : "contorno",
        icone: prevista ? "repetir" : undefined,
        dica: `${t.title} · ${t.dueTime}${u ? ` · ${u.name}` : ""}${prevista ? " · próxima ocorrência" : ""}`,
        aoClicar: () => onTaskClick(t.id),
        aoContexto: (x, y) => openTaskContext(idReal(t.id), x, y),
      });
    }

    for (const r of reservasPorDia.get(iso) ?? []) {
      const [hi, mi] = r.inicio.split(":").map(Number);
      const [hf, mf] = r.fim.split(":").map(Number);
      blocos.push({
        chave: `r-${r.id}`,
        iso,
        inicio: hi! * 60 + mi!,
        fim: hf! * 60 + mf!,
        titulo: r.motivo || r.sala,
        subtitulo: `${r.inicio}–${r.fim} · ${r.sala}`,
        cor: "var(--color-primary)",
        estilo: "contorno",
        icone: "porta",
        dica: `${r.sala} · ${r.inicio}–${r.fim} · ${r.motivo} · ${r.responsavel}`,
        aoClicar: () => onReservaClick(iso),
      });
    }

    for (const c of compromissos) {
      const ci = Date.parse(c.inicio);
      const cf = Date.parse(c.fim);
      if (ci >= e || cf <= s) continue;
      const pessoas = c.participantes.map(nomeDe).filter(Boolean);
      const meu = c.criadoPor === destaque.euId || c.participantes.includes(destaque.euId);
      const quem = pessoas.length ? ` · ${pessoas.join(", ")}` : "";
      blocos.push({
        chave: `c-${c.id}-${iso}`,
        iso,
        inicio: Math.round((Math.max(ci, s) - s) / 60_000),
        fim: Math.round((Math.min(cf, e) - s) / 60_000),
        titulo: c.assunto,
        subtitulo: `${faixaDeHorario(c)}${quem}`,
        cor: COR_DA_AGENDA,
        estilo: "cheio",
        icone: "cadeado",
        apagado: !meu,
        dica: `Agenda travada · ${c.assunto} · ${faixaDeHorario(c)}${quem}`,
        aoClicar: () => onCompromissoClick(c),
      });
    }
  }
  return blocos;
}

/** A agenda travada na Lista (14/10/2026): uma linha com cadeado, horário, assunto e rostos. */
function CompromissoNaLista({
  c,
  users,
  euId,
  onClick,
}: {
  c: Compromisso;
  users: User[];
  euId: string;
  onClick: () => void;
}) {
  const criador = users.find((u) => u.id === c.criadoPor);
  const pessoas = c.participantes
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is User => !!u);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-l-[3px] px-3 py-2 text-left hover:bg-secondary/40"
      style={{
        borderLeftColor: COR_DA_AGENDA,
        background: `color-mix(in oklab, ${COR_DA_AGENDA} 6%, transparent)`,
      }}
    >
      <Lock className="h-4 w-4 shrink-0" style={{ color: COR_DA_AGENDA }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{c.assunto}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {faixaDeHorario(c)} ·{" "}
          {c.criadoPor === euId ? "você travou" : `travada por ${nomeCurto(criador?.name ?? "—")}`}
        </div>
      </div>
      <span className="flex shrink-0 -space-x-1.5">
        {pessoas.slice(0, 5).map((u) => (
          <UserAvatar
            key={u.id}
            nome={u.name}
            iniciais={u.avatar}
            className="h-6 w-6 text-[9px] ring-2 ring-card"
          />
        ))}
      </span>
    </button>
  );
}

/** A agenda travada no mês: uma pílula com o cadeado e a hora. */
function CompromissoPill({ c, onClick }: { c: Compromisso; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`Agenda travada · ${c.assunto} · ${faixaDeHorario(c)}`}
      className="pointer-events-auto flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition hover:brightness-95"
      style={{ background: `color-mix(in oklab, ${COR_DA_AGENDA} 18%, transparent)` }}
    >
      <Lock className="h-2.5 w-2.5 shrink-0" style={{ color: COR_DA_AGENDA }} />
      <span className="shrink-0 font-semibold tabular-nums">
        {new Date(c.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="truncate">{c.assunto}</span>
    </button>
  );
}

/** A faixa "Dia todo" de um dia na grade de horas: as tarefas sem hora. O clique no
 *  vazio abre a agenda do dia e o botão direito, o menu do dia — como antes. */
function FaixaDoDia({
  dia,
  iso,
  tarefas,
  users,
  destaque,
  marca,
  onDayClick,
  onDayContext,
  onTaskClick,
}: {
  dia: Date;
  iso: string;
  tarefas: TarefaNoCalendario[];
  users: User[];
  destaque: Destaque;
  marca: MarcaDoDia | undefined;
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number) => void;
  onTaskClick: (id: string) => void;
}) {
  const semHora = tarefas.filter((t) => !temHora(t));
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDayContext(e.clientX, e.clientY, iso, tarefas.length);
      }}
      className="relative max-h-32 min-h-[2.25rem] overflow-y-auto p-1 text-left hover:bg-secondary/30"
    >
      <BotaoDoDia rotulo={rotuloDoDia(dia, marca)} onClick={() => onDayClick(iso)} />
      <div className="pointer-events-none relative space-y-0.5">
        {semHora.map((t) => (
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
  );
}

/**
 * A semana com as linhas de horário (14/10/2026), no jeito do Outlook: o que
 * tem hora cai no seu horário, o que é só do dia fica na faixa "Dia todo" de
 * cima. O cabeçalho do dia continua levando ao modo Dia, o clique no vazio da
 * faixa continua abrindo a agenda do dia e o botão direito nela, o menu do dia.
 * O botão direito numa hora (ou num trecho arrastado) abre o mesmo menu, com o
 * "Travar agenda" já no horário; o duplo clique abre o "Travar agenda" direto.
 */
function WeekGrid({
  cursor,
  filtered,
  users,
  destaque,
  reservasPorDia,
  compromissos,
  marcas,
  onReservaClick,
  onCompromissoClick,
  onDayClick,
  onDayContext,
  onTravar,
  onTaskClick,
  onSwitchDay,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  reservasPorDia: Map<string, ReservaDeSala[]>;
  compromissos: Compromisso[];
  marcas: Map<string, MarcaDoDia>;
  onReservaClick: (iso: string) => void;
  onCompromissoClick: (c: Compromisso) => void;
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number, faixa?: FaixaDeHorario) => void;
  onTravar: (iso: string, faixa?: FaixaDeHorario) => void;
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
  const datas = useMemo(() => days.map((d) => d.date), [days]);
  const porIso = useMemo(() => new Map(days.map((d) => [dataParaIso(d.date), d])), [days]);

  const blocos = useMemo(
    () =>
      blocosDaGrade({
        dias: datas,
        tarefas: filtered,
        reservasPorDia,
        compromissos,
        users,
        destaque,
        onTaskClick,
        onReservaClick,
        onCompromissoClick,
      }),
    [
      datas,
      filtered,
      reservasPorDia,
      compromissos,
      users,
      destaque,
      onTaskClick,
      onReservaClick,
      onCompromissoClick,
    ],
  );

  const hojeIso = dataParaIso(new Date());
  return (
    <div className="mt-4">
      <GradeDeHoras
        dias={datas}
        blocos={blocos}
        fundoDoDia={(iso) => fundoPintado(destaque.dias[iso])}
        cabecalho={(d, iso) => (
          <button
            onClick={() => onSwitchDay(iso)}
            className="w-full bg-secondary/60 px-2 py-1.5 text-left transition hover:bg-secondary"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {d.toLocaleDateString("pt-BR", { weekday: "short" })}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-lg font-semibold ${iso === hojeIso ? "text-primary" : ""}`}>
                {d.getDate()}
              </span>
              <MarcasDoDia marca={marcas.get(iso)} />
            </div>
          </button>
        )}
        faixaDoDia={(d, iso) => (
          <FaixaDoDia
            dia={d}
            iso={iso}
            tarefas={porIso.get(iso)?.tasks ?? []}
            users={users}
            destaque={destaque}
            marca={marcas.get(iso)}
            onDayClick={onDayClick}
            onDayContext={onDayContext}
            onTaskClick={onTaskClick}
          />
        )}
        aoContextoDoHorario={(x, y, { iso, inicio, fim }) =>
          onDayContext(x, y, iso, porIso.get(iso)?.tasks.length ?? 0, { inicio, fim })
        }
        aoDuploClique={({ iso, inicio, fim }) => onTravar(iso, { inicio, fim })}
      />
    </div>
  );
}

/* Memorizadas: a agenda do dia e o menu do dia moram na página, e abrir ou
   fechar qualquer um deles redesenhava as 42 células do mês com todas as
   pílulas. O que elas recebem é estável — ver os `useCallback` na página. */
const MonthGridMemo = memo(MonthGrid);
const WeekGridMemo = memo(WeekGrid);

/** Lista vazia estável — a grade do dia é memorizada. */
const SEM_RESERVAS: ReservaDeSala[] = [];

/** As linhas de horário de um dia só (modo Dia) — a mesma grade da semana. */
function DayGrid({
  cursor,
  filtered,
  users,
  destaque,
  reservasDoDia,
  compromissos,
  onReservaClick,
  onCompromissoClick,
  onDayClick,
  onDayContext,
  onTravar,
  onTaskClick,
}: {
  cursor: Date;
  filtered: TarefaNoCalendario[];
  users: User[];
  destaque: Destaque;
  reservasDoDia: ReservaDeSala[];
  compromissos: Compromisso[];
  onReservaClick: (iso: string) => void;
  onCompromissoClick: (c: Compromisso) => void;
  onDayClick: (iso: string) => void;
  onDayContext: (x: number, y: number, iso: string, count: number, faixa?: FaixaDeHorario) => void;
  onTravar: (iso: string, faixa?: FaixaDeHorario) => void;
  onTaskClick: (id: string) => void;
}) {
  const dias = useMemo(() => [startOfDay(cursor)], [cursor]);
  const iso = dataParaIso(cursor);
  const doDia = useMemo(() => {
    const s = startOfDay(cursor).getTime();
    const e = s + 86_400_000;
    return filtered.filter((t) => {
      if (!t.dueDate) return false; // sem prazo não tem dia no calendário
      const dt = new Date(t.dueDate).getTime();
      return dt >= s && dt < e;
    });
  }, [cursor, filtered]);
  const reservasPorDia = useMemo(() => new Map([[iso, reservasDoDia]]), [iso, reservasDoDia]);
  const blocos = useMemo(
    () =>
      blocosDaGrade({
        dias,
        tarefas: doDia,
        reservasPorDia,
        compromissos,
        users,
        destaque,
        onTaskClick,
        onReservaClick,
        onCompromissoClick,
      }),
    [
      dias,
      doDia,
      reservasPorDia,
      compromissos,
      users,
      destaque,
      onTaskClick,
      onReservaClick,
      onCompromissoClick,
    ],
  );
  return (
    <div className="mt-4">
      <GradeDeHoras
        dias={dias}
        blocos={blocos}
        fundoDoDia={(i) => fundoPintado(destaque.dias[i])}
        cabecalho={(d) => (
          <div className="bg-secondary/60 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })}
          </div>
        )}
        faixaDoDia={(d, i) => (
          <FaixaDoDia
            dia={d}
            iso={i}
            tarefas={doDia}
            users={users}
            destaque={destaque}
            marca={undefined}
            onDayClick={onDayClick}
            onDayContext={onDayContext}
            onTaskClick={onTaskClick}
          />
        )}
        aoContextoDoHorario={(x, y, f) =>
          onDayContext(x, y, f.iso, doDia.length, { inicio: f.inicio, fim: f.fim })
        }
        aoDuploClique={(f) => onTravar(f.iso, { inicio: f.inicio, fim: f.fim })}
      />
    </div>
  );
}
const DayGridMemo = memo(DayGrid);

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
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.dueDate.localeCompare(b.dueDate));
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
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      </div>
      <div
        className={`grid grid-cols-1 gap-px bg-border ${mostrarSalas ? "md:grid-cols-4" : "md:grid-cols-3"}`}
      >
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
              handleDrop(
                st,
                dropTarget?.st === st ? dropTarget.index : (byStatus[st] || []).length,
              );
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
                        t.prevista
                          ? "border-dashed opacity-80"
                          : "cursor-grab active:cursor-grabbing"
                      } ${t.assigneeId === destaque.euId ? "border-l-[3px]" : ""}`}
                      style={
                        t.assigneeId === destaque.euId
                          ? { borderLeftColor: destaque.cor }
                          : undefined
                      }
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 truncate text-xs font-medium">
                            {t.prevista && (
                              <Repeat className="h-3 w-3 shrink-0" aria-label="Recorrente" />
                            )}
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
              {byStatus[st].length === 0 && (
                <div className="text-[11px] text-muted-foreground/60">Vazio</div>
              )}
            </div>
          </div>
        ))}

        {/* A quarta coluna já existia vazia na grade (`md:grid-cols-4` com três
            filhos). As salas do dia cabem exatamente ali, ao lado do quadro de
            situações, sem mexer na largura de nada. Ocultas, a grade volta a três. */}
        {mostrarSalas && (
          <div
            className="flex flex-col bg-card p-3"
            style={{ background: fundoPintado(destaque.dias[dataParaIso(cursor)]) }}
          >
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
  travadosPorDia,
  onCompromissoClick,
  onTaskClick,
  onReorder,
}: {
  cursor: Date;
  filtered: any[];
  users: any[];
  destaque: Destaque;
  /** Agenda travada (14/10/2026): os compromissos de cada dia, no topo do grupo. */
  travadosPorDia?: Map<string, Compromisso[]>;
  onCompromissoClick: (c: Compromisso) => void;
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
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.order ?? 0) - (b.order ?? 0));
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
    // O dia só com agenda travada também ganha o seu grupo.
    for (const iso of travadosPorDia?.keys() ?? []) if (!map.has(iso)) map.set(iso, []);
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [cursor, filtered, travadosPorDia]);

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
          Nenhuma tarefa nem agenda travada nos próximos 60 dias.
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
              <div
                className={`text-xs font-semibold uppercase tracking-wider ${today ? "text-primary" : "text-muted-foreground"}`}
              >
                {d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                {today && (
                  <span className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">
                    Hoje
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">{items.length}</div>
            </div>
            <div className="divide-y divide-border">
              {(travadosPorDia?.get(iso) ?? []).map((c) => (
                <CompromissoNaLista
                  key={c.id}
                  c={c}
                  users={users}
                  euId={destaque.euId}
                  onClick={() => onCompromissoClick(c)}
                />
              ))}
              {items.map((t: any, index: number) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const sec = sectors.find((s) => s.id === t.sector);
                const showBefore =
                  dropTarget?.iso === iso &&
                  dropTarget.index === index &&
                  dragId &&
                  dragId !== t.id;
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
                          <Repeat
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label="Próxima ocorrência"
                          />
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
