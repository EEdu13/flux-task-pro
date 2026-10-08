import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlarmClock,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDot,
  Clock,
  DoorOpen,
  ListTodo,
  Loader2,
  NotebookPen,
  Plus,
  Timer,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
import { openTaskContext } from "@/components/task-context-menu";
import {
  RESERVA_CRIADA,
  RESERVA_FECHADA,
  abrirReservaDeSala,
  type EscolhaDeHorario,
} from "@/components/reserva-de-sala-modal";
import { useFluxo } from "@/lib/fluxo-store";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import {
  EXPEDIENTE,
  PASSO,
  duracaoPorExtenso,
  emHora,
  emMinutos,
  janelasLivres,
  type Intervalo,
} from "@/lib/horario-de-sala";
import { nomeCurto } from "@/lib/nome-curto";
import { HORARIO_VALIDO, tarefaVencida } from "@/lib/prazo";
import {
  priorityColor,
  priorityLabels,
  sectors,
  statusColor,
  statusLabels,
  type Priority,
  type Status,
  type Task,
} from "@/lib/fluxo-types";
import {
  listarAgendaDeSalas,
  listarSalasDeReuniao,
  type ReservaDeSala,
  type SalaDeReuniao,
} from "@/lib/reservas-sala.functions";
import {
  apagarLembrete,
  criarLembrete,
  listarAgendaPessoal,
  salvarAnotacao,
  type AnotacaoDoDia,
  type Lembrete,
} from "@/lib/agenda-pessoal.functions";

/* A agenda de um dia, aberta ao clicar numa data do calendário.
 *
 * Antes o clique no dia abria direto a criação de tarefa — e quem só queria
 * saber o que tinha naquele dia criava sem querer, ou fechava a criação para
 * ler as pílulas espremidas na célula. Aqui o dia aparece inteiro primeiro: as
 * reuniões das salas, os lembretes e as tarefas com horário numa linha do
 * tempo, as tarefas sem horário embaixo, e do lado o que se faz com o dia —
 * criar tarefa, anotar, lembrar e reservar sala.
 *
 * Fica aberta por baixo do que ela mesma abre (a tarefa, a criação, a reserva)
 * e se atualiza sozinha quando eles terminam.
 *
 * Trocar de dia não pode custar nada, e por isso três escolhas:
 *   - o dia é estado DESTA tela, não do calendário por baixo — antes cada seta
 *     redesenhava o mês inteiro atrás do modal;
 *   - reuniões, anotações e lembretes chegam em blocos de 28 dias, e o bloco
 *     seguinte é pedido quando o dia chega perto da borda: a seta não espera a
 *     rede, e nada "chega depois" empurrando o conteúdo;
 *   - a troca anima só a entrada, no compositor (`useEntrada`), sem esperar o
 *     dia anterior sair. */

/** Disparado quando uma anotação ou um lembrete muda, com `{ dia }` no detalhe.
 *  O calendário relê as marcas dos dias. */
export const AGENDA_PESSOAL_MUDOU = "fluxo:agenda-pessoal-mudou";

export interface AgendaDoDiaProps {
  /** Dia em que a agenda abre ("yyyy-MM-dd"); `null` fecha. Aberta, ela troca
   *  de dia por conta própria. */
  diaInicial: string | null;
  /** As tarefas que o calendário mostra — já com o recorte "Só minhas"/"Todos". */
  tarefas: Task[];
  escopo: "eu" | "todos";
  aoMudarEscopo: (escopo: "eu" | "todos") => void;
  /** O que o calendário já buscou das salas; `undefined` quando ele não sabe.
   *  Serve para a agenda abrir cheia; os blocos dela chegam logo depois. */
  reservasConhecidas: (dia: string) => ReservaDeSala[] | undefined;
  aoFechar: () => void;
  /** Troca o calendário para o modo Dia nesta data (e fecha a agenda). */
  aoVerNoCalendario: (dia: string) => void;
}

export function AgendaDoDia(props: AgendaDoDiaProps) {
  /* As salas são pedidas quando o CALENDÁRIO abre, não quando a agenda abre:
     assim o primeiro clique num dia já encontra a lista pronta. */
  useEffect(() => {
    void buscarSalas().catch(() => {});
  }, []);

  if (typeof document === "undefined") return null;
  /* Portal para o `body`, como o modal de reserva: `fixed` dentro de um
     ancestral com `transform` passa a ser relativo a ele. */
  return createPortal(
    <AnimatePresence>
      {props.diaInicial !== null && (
        <AgendaAberta key="agenda-do-dia" {...props} diaInicial={props.diaInicial} />
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------- Salas ------------------------------- */

/* As salas mudam quase nunca (duas, desde sempre), então a lista é buscada uma
   vez por sessão, e não a cada dia aberto. Uma sala nova no Agendador aparece
   no próximo carregamento da página. */
let salasEmCache: SalaDeReuniao[] | null = null;
let salasPedido: Promise<SalaDeReuniao[]> | null = null;

function buscarSalas(): Promise<SalaDeReuniao[]> {
  if (salasEmCache) return Promise.resolve(salasEmCache);
  salasPedido ??= listarSalasDeReuniao()
    .then((r) => (salasEmCache = r.salas ?? []))
    .finally(() => {
      salasPedido = null;
    });
  return salasPedido;
}

/** Pela forma do erro, não pela classe — ver `lerFalha` no modal de reserva. */
function falhaDasSalas(e: unknown): string {
  const motivo = (e as { motivo?: string } | null)?.motivo;
  if (motivo === "sem_acesso") return "Seu usuário não tem acesso ao Agendador. Fale com a TI.";
  return "Não deu para consultar as salas agora.";
}

const falhaDoPessoal = () => "Não deu para ler suas anotações e lembretes agora.";

/* ------------------------------ Blocos ------------------------------ */

const DIAS_POR_BLOCO = 28;

/** Dias desde 1970. Em UTC de propósito: é só um número para agrupar datas
 *  "yyyy-MM-dd", sem fuso no meio. */
function numeroDoDia(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(a!, m! - 1, d!) / 86_400_000);
}
const isoDoNumero = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const blocoDoDia = (iso: string) => Math.floor(numeroDoDia(iso) / DIAS_POR_BLOCO);
const faixaDoBloco = (b: number) => ({
  de: isoDoNumero(b * DIAS_POR_BLOCO),
  ate: isoDoNumero((b + 1) * DIAS_POR_BLOCO - 1),
});

/** O bloco do dia e, a quatro dias da borda, o vizinho: a seta nunca chega num
 *  dia cujo bloco ainda não foi pedido. */
function blocosDoDia(iso: string): number[] {
  const n = numeroDoDia(iso);
  return [...new Set([n - 4, n, n + 4].map((x) => Math.floor(x / DIAS_POR_BLOCO)))];
}

/**
 * Dados de um período, buscados em blocos de 28 dias e guardados por dia.
 *
 * Um bloco é pedido uma vez por `versao`. Com a versão nova, os blocos são
 * pedidos de novo e o que já está na tela fica até a resposta chegar — reler
 * não faz o conteúdo sumir e voltar.
 */
function usePorBlocos<T>(
  dia: string,
  versao: number,
  buscar: (de: string, ate: string) => Promise<Map<string, T>>,
  vazio: T,
  mensagemDeFalha: (e: unknown) => string,
) {
  const [porDia, setPorDia] = useState<Record<string, T>>({});
  const [falhas, setFalhas] = useState<Record<number, string>>({});
  const pedidos = useRef(new Map<number, number>());

  useEffect(() => {
    for (const b of blocosDoDia(dia)) {
      if (pedidos.current.get(b) === versao) continue;
      pedidos.current.set(b, versao);
      const { de, ate } = faixaDoBloco(b);
      buscar(de, ate)
        .then((mapa) => {
          setPorDia((atual) => {
            const novo = { ...atual };
            for (let x = b * DIAS_POR_BLOCO; x < (b + 1) * DIAS_POR_BLOCO; x++) {
              const iso = isoDoNumero(x);
              novo[iso] = mapa.get(iso) ?? vazio;
            }
            return novo;
          });
          setFalhas((f) => {
            if (!(b in f)) return f;
            const resto = { ...f };
            delete resto[b];
            return resto;
          });
        })
        .catch((e) => {
          pedidos.current.delete(b); // a próxima troca de dia tenta de novo
          setFalhas((f) => ({ ...f, [b]: mensagemDeFalha(e) }));
        });
    }
  }, [dia, versao, buscar, vazio, mensagemDeFalha]);

  /** Muda um dia na hora, antes de o servidor confirmar (a tela não espera a rede). */
  const mudarDia = useCallback(
    (d: string, mudanca: (atual: T) => T) =>
      setPorDia((m) => ({ ...m, [d]: mudanca(m[d] ?? vazio) })),
    [vazio],
  );

  const bloco = blocoDoDia(dia);
  return {
    doDia: dia in porDia ? porDia[dia] : undefined,
    falha: falhas[bloco] ?? null,
    carregando: !(dia in porDia) && !(bloco in falhas),
    mudarDia,
  };
}

const SEM_RESERVAS: ReservaDeSala[] = [];

async function buscarReservas(de: string, ate: string): Promise<Map<string, ReservaDeSala[]>> {
  const r = await listarAgendaDeSalas({ data: { data: de, dataFim: ate } });
  const mapa = new Map<string, ReservaDeSala[]>();
  for (const res of r.reservas ?? []) {
    const lista = mapa.get(res.data);
    if (lista) lista.push(res);
    else mapa.set(res.data, [res]);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return mapa;
}

type Pessoal = { nota: AnotacaoDoDia | null; lembretes: Lembrete[] };
const SEM_PESSOAL: Pessoal = { nota: null, lembretes: [] };

const porQuando = (a: Lembrete, b: Lembrete) => a.quando.localeCompare(b.quando);

async function buscarPessoal(de: string, ate: string): Promise<Map<string, Pessoal>> {
  const r = await listarAgendaPessoal({ data: { de, ate } });
  const mapa = new Map<string, Pessoal>();
  const doDia = (iso: string) => {
    let v = mapa.get(iso);
    if (!v) mapa.set(iso, (v = { nota: null, lembretes: [] }));
    return v;
  };
  for (const n of r.anotacoes) doDia(n.dia).nota = n;
  // O dia do lembrete é o desta máquina, o mesmo em que a pessoa o marcou.
  for (const l of r.lembretes) doDia(dataParaIso(new Date(l.quando))).lembretes.push(l);
  return mapa;
}

/* ------------------------------ Relógio ------------------------------ */

/**
 * O relógio da tela, de 30 em 30 s.
 *
 * Não é sondagem: nada sai da máquina. Só a linha do "agora", o "livre até" das
 * salas e o "atrasada" das tarefas acompanham o tempo enquanto a agenda está
 * aberta.
 */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

/* ------------------------------ Datas ------------------------------ */

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** O cadastro vem em maiúsculas da IAM e o Agendador guarda como recebeu: a
 *  comparação ignora caixa, acento e espaço sobrando. */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

function rotuloRelativo(dia: Date, agora: number): string {
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((dia.getTime() - hoje.getTime()) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Amanhã";
  if (dias === -1) return "Ontem";
  return dias > 0 ? `Em ${dias} dias` : `Há ${-dias} dias`;
}

const horaLocal = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const minutoLocal = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

/* A tarefa sem horário sobe pela situação (em andamento primeiro — é o que já
   está nas mãos) e, dentro dela, pela prioridade. */
const ORDEM_SITUACAO: Record<Status, number> = { andamento: 0, pendente: 1, concluida: 2 };
const ORDEM_PRIORIDADE: Record<Priority, number> = { alta: 0, media: 1, baixa: 2 };
/** No mesmo minuto: a reunião, que tem hora para começar; depois o lembrete; depois a tarefa. */
const ORDEM_TIPO = { reserva: 0, lembrete: 1, tarefa: 2 } as const;

const SEM_TAREFAS: Task[] = [];

/** Os blocos recolhíveis da coluna de ações. */
type Secao = "nota" | "lembrete" | "salas";
const CHAVE_SECOES = "fluxo.agenda.secoes-abertas";
const SECOES: readonly Secao[] = ["nota", "lembrete", "salas"];

/* Quais blocos ficam abertos: começa tudo recolhido, e o que a pessoa abrir
   fica aberto neste computador — preferência de tela, como o menu recolhido. */
function secoesGuardadas(): Secao[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE_SECOES) ?? "[]");
    return Array.isArray(v) ? SECOES.filter((s) => v.includes(s)) : [];
  } catch {
    return [];
  }
}

function guardarSecao(secao: Secao, aberta: boolean) {
  try {
    const atuais = new Set(secoesGuardadas());
    if (aberta) atuais.add(secao);
    else atuais.delete(secao);
    localStorage.setItem(CHAVE_SECOES, JSON.stringify(SECOES.filter((s) => atuais.has(s))));
  } catch {
    /* navegador sem armazenamento: o bloco só não fica lembrado */
  }
}

/** A primeira linha da anotação, para o cabeçalho recolhido. */
const primeiraLinha = (texto: string) => texto.trim().split("\n")[0]!.slice(0, 90);

/**
 * Como está uma sala no dia: o que está ocupado, as janelas livres e a frase
 * da situação. Uma conta só para o bloco aberto (`DisponibilidadeDaSala`) e
 * para o resumo do cabeçalho recolhido — os dois não podem discordar.
 */
function situacaoDaSala(reservas: ReservaDeSala[], minutoAgora: number | null, passado: boolean) {
  const ocupados = reservas.map((r) => ({ de: emMinutos(r.inicio), ate: emMinutos(r.fim), r }));

  /* Hoje, as janelas começam na próxima meia hora: oferecer 08:00 às 15h
     seria oferecer um horário que a reserva recusa por já ter passado. */
  const desde =
    minutoAgora === null
      ? EXPEDIENTE.de
      : Math.max(EXPEDIENTE.de, Math.ceil(minutoAgora / PASSO) * PASSO);
  const livres = passado ? [] : janelasLivres(ocupados, desde, EXPEDIENTE.ate);

  if (passado)
    return {
      ocupados,
      livres,
      livreAgora: false,
      texto: "Dia encerrado",
      cor: "bg-muted-foreground",
    };
  if (minutoAgora !== null) {
    const atual = ocupados.find((o) => o.de <= minutoAgora && minutoAgora < o.ate);
    if (atual) {
      return {
        ocupados,
        livres,
        livreAgora: false,
        texto: `Ocupada até ${emHora(atual.ate)}`,
        cor: "bg-warning",
      };
    }
    if (minutoAgora >= EXPEDIENTE.ate) {
      return {
        ocupados,
        livres,
        livreAgora: false,
        texto: "Expediente encerrado",
        cor: "bg-muted-foreground",
      };
    }
    const proxima = ocupados.filter((o) => o.de > minutoAgora).sort((a, b) => a.de - b.de)[0];
    return {
      ocupados,
      livres,
      livreAgora: true,
      texto: proxima ? `Livre até ${emHora(proxima.de)}` : "Livre o resto do dia",
      cor: "bg-success",
    };
  }
  if (ocupados.length === 0)
    return { ocupados, livres, livreAgora: false, texto: "Livre o dia todo", cor: "bg-success" };
  if (livres.length === 0)
    return { ocupados, livres, livreAgora: false, texto: "Sem horário livre", cor: "bg-warning" };
  return {
    ocupados,
    livres,
    livreAgora: false,
    texto: `${livres.length} ${livres.length === 1 ? "janela livre" : "janelas livres"}`,
    cor: "bg-success",
  };
}

/** O resumo das salas no cabeçalho recolhido: o que se decide sem abrir o bloco. */
function resumoDasSalas(
  salas: SalaDeReuniao[],
  porSala: Map<number, ReservaDeSala[]>,
  minutoAgora: number | null,
  passado: boolean,
): string {
  if (passado) return "Dia encerrado";
  if (salas.length === 0) return "Nenhuma sala no Agendador";
  const situacoes = salas.map((s) => ({
    nome: s.nome,
    ...situacaoDaSala(porSala.get(s.id) ?? SEM_RESERVAS, minutoAgora, passado),
  }));
  if (minutoAgora !== null) {
    if (minutoAgora >= EXPEDIENTE.ate) return "Expediente encerrado";
    const livres = situacoes.filter((x) => x.livreAgora).map((x) => x.nome);
    if (livres.length === 0) return "Todas ocupadas agora";
    if (livres.length === situacoes.length) return "Todas livres agora";
    return `Livre agora: ${livres.join(", ")}`;
  }
  if (situacoes.every((x) => x.ocupados.length === 0)) return "Livres o dia todo";
  const janelas = situacoes.reduce((n, x) => n + x.livres.length, 0);
  return janelas === 0
    ? "Sem horário livre"
    : `${janelas} ${janelas === 1 ? "janela livre" : "janelas livres"}`;
}

type ItemDaAgenda =
  | { tipo: "reserva"; chave: string; inicio: number; fim: number; r: ReservaDeSala }
  | { tipo: "lembrete"; chave: string; inicio: number; l: Lembrete }
  | { tipo: "tarefa"; chave: string; inicio: number; t: Task };

/**
 * A entrada do dia novo: só opacidade e deslocamento, pela Web Animations API.
 *
 * Nada de classes `animate-in` aqui, nem entrada em cascata dos itens. O
 * tw-animate monta o movimento com variáveis CSS, e animação com variável roda
 * no fio principal: no rastro, a cada quadro o navegador recalculava o estilo
 * de cada item animado com tudo o que havia dentro dele — perto de 750
 * elementos por quadro. Com opacidade e `transform` literais, a animação roda
 * no compositor e o conteúdo fica parado para o resto da página.
 */
function useEntrada(ref: RefObject<HTMLElement | null>, chave: string, direcao: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    // Na abertura quem anima é o cartão; aqui é só a troca de dia.
    if (!el || direcao === 0 || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animacao = el.animate(
      [
        { opacity: 0, transform: `translateX(${direcao * 8}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 150, easing: "ease-out" },
    );
    return () => animacao.cancel();
  }, [ref, chave, direcao]);
}

/* ------------------------------ A agenda aberta ------------------------------ */

function AgendaAberta({
  diaInicial,
  tarefas,
  escopo,
  aoMudarEscopo,
  reservasConhecidas,
  aoFechar,
  aoVerNoCalendario,
}: AgendaDoDiaProps & { diaInicial: string }) {
  const { users, currentUser, openTask, openQuickCreate, quickCreate, taskDialog } = useFluxo();
  const reduzir = useReducedMotion();
  const agora = useAgora();
  const tituloId = useId();

  /* O dia e para onde o conteúdo desliza ao chegar nele (o mais novo vem da
     direita; 0 é a abertura). Juntos num estado só, porque um decide o outro. */
  const [posicao, setPosicao] = useState({ dia: diaInicial, direcao: 0 });
  const { dia, direcao } = posicao;
  const irPara = useCallback(
    (novo: string) =>
      setPosicao((p) => (novo === p.dia ? p : { dia: novo, direcao: novo > p.dia ? 1 : -1 })),
    [],
  );
  const cabecalhoRef = useRef<HTMLDivElement>(null);
  const corpoRef = useRef<HTMLDivElement>(null);
  useEntrada(cabecalhoRef, dia, direcao);
  useEntrada(corpoRef, dia, direcao);

  const data = useMemo(() => isoParaData(dia) ?? new Date(), [dia]);
  const hojeIso = dataParaIso(new Date(agora));
  const ehHoje = dia === hojeIso;
  const passado = dia < hojeIso;
  const minutoAgora = ehHoje
    ? new Date(agora).getHours() * 60 + new Date(agora).getMinutes()
    : null;

  /* ---- Tarefas do dia ---- */

  /* Índice por dia, montado uma vez por lista de tarefas: trocar de dia vira
     uma consulta ao mapa, e não uma varredura de todas as tarefas por tecla. */
  const tarefasPorDia = useMemo(() => {
    const mapa = new Map<string, Task[]>();
    for (const t of tarefas) {
      if (!t.dueDate) continue; // sem prazo não tem dia
      const chave = dataParaIso(new Date(t.dueDate));
      const lista = mapa.get(chave);
      if (lista) lista.push(t);
      else mapa.set(chave, [t]);
    }
    return mapa;
  }, [tarefas]);
  const doDia = tarefasPorDia.get(dia) ?? SEM_TAREFAS;

  const comHora = useMemo(
    () => doDia.filter((t) => !!t.dueTime && HORARIO_VALIDO.test(t.dueTime)),
    [doDia],
  );
  const semHora = useMemo(
    () =>
      doDia
        .filter((t) => !t.dueTime || !HORARIO_VALIDO.test(t.dueTime))
        .sort(
          (a, b) =>
            ORDEM_SITUACAO[a.status] - ORDEM_SITUACAO[b.status] ||
            ORDEM_PRIORIDADE[a.priority] - ORDEM_PRIORIDADE[b.priority] ||
            (a.order ?? 0) - (b.order ?? 0),
        ),
    [doDia],
  );

  /* ---- Reservas das salas ---- */

  const [versaoReservas, setVersaoReservas] = useState(0);
  const salasDoBloco = usePorBlocos(
    dia,
    versaoReservas,
    buscarReservas,
    SEM_RESERVAS,
    falhaDasSalas,
  );
  const reservas: ReservaDeSala[] | null = salasDoBloco.doDia ?? reservasConhecidas(dia) ?? null;
  const falhaReservas = salasDoBloco.falha;
  const buscandoReservas = salasDoBloco.carregando;

  const [salas, setSalas] = useState<SalaDeReuniao[] | null>(salasEmCache);
  useEffect(() => {
    if (salasEmCache) return;
    let vivo = true;
    buscarSalas()
      .then((s) => vivo && setSalas(s))
      .catch(() => vivo && setSalas([]));
    return () => {
      vivo = false;
    };
  }, []);

  /* Sem a lista (Agendador fora do ar na hora de buscá-la), as salas saem das
     próprias reservas do dia — melhor mostrar as que se conhece do que nada. */
  const salasDoDia = useMemo(() => {
    if (salas && salas.length > 0) return salas;
    const vistas = new Map<number, SalaDeReuniao>();
    for (const r of reservas ?? []) vistas.set(r.sala_id, { id: r.sala_id, nome: r.sala });
    return [...vistas.values()];
  }, [salas, reservas]);

  const reservasPorSala = useMemo(() => {
    const mapa = new Map<number, ReservaDeSala[]>();
    for (const r of reservas ?? []) {
      const lista = mapa.get(r.sala_id);
      if (lista) lista.push(r);
      else mapa.set(r.sala_id, [r]);
    }
    return mapa;
  }, [reservas]);

  const eu = normalizar(currentUser.name);
  const ehMinha = useCallback(
    (r: ReservaDeSala) =>
      normalizar(r.responsavel ?? "") === eu || (!!r.para_nome && normalizar(r.para_nome) === eu),
    [eu],
  );

  /* ---- Anotação e lembretes (privados) ---- */

  const pessoal = usePorBlocos(dia, 0, buscarPessoal, SEM_PESSOAL, falhaDoPessoal);
  const nota = pessoal.doDia?.nota ?? null;
  const lembretes = pessoal.doDia?.lembretes ?? SEM_PESSOAL.lembretes;
  const mudarPessoal = pessoal.mudarDia;

  const avisarMudanca = (d: string) =>
    window.dispatchEvent(new CustomEvent(AGENDA_PESSOAL_MUDOU, { detail: { dia: d } }));

  const aoSalvarNota = useCallback(
    (d: string, texto: string, atualizadaEm: string | null) => {
      mudarPessoal(d, (v) => ({
        ...v,
        nota: texto.trim() && atualizadaEm ? { dia: d, texto, atualizadaEm } : null,
      }));
      avisarMudanca(d);
    },
    [mudarPessoal],
  );

  /* O lembrete aparece na hora, com "Salvando…", e é trocado pelo do servidor
     quando ele responde. Se o servidor recusar, sai da tela e a pessoa vê por quê. */
  const criarNovoLembrete = useCallback(
    async (hora: string, texto: string): Promise<boolean> => {
      const quando = isoParaData(dia) ?? new Date();
      const [h, m] = hora.split(":").map(Number);
      quando.setHours(h ?? 0, m ?? 0, 0, 0);
      if (quando.getTime() < Date.now() - 60_000) {
        toast.error("Esse horário já passou");
        return false;
      }
      const d = dia;
      const provisorio: Lembrete = {
        id: `tmp-${Date.now()}`,
        quando: quando.toISOString(),
        texto,
        avisadoEm: null,
      };
      mudarPessoal(d, (v) => ({ ...v, lembretes: [...v.lembretes, provisorio].sort(porQuando) }));
      try {
        const { lembrete } = await criarLembrete({ data: { quando: provisorio.quando, texto } });
        mudarPessoal(d, (v) => ({
          ...v,
          lembretes: v.lembretes.map((l) => (l.id === provisorio.id ? lembrete : l)),
        }));
        avisarMudanca(d);
        return true;
      } catch (e) {
        mudarPessoal(d, (v) => ({
          ...v,
          lembretes: v.lembretes.filter((l) => l.id !== provisorio.id),
        }));
        toast.error("Não foi possível criar o lembrete", { description: (e as Error)?.message });
        return false;
      }
    },
    [dia, mudarPessoal],
  );

  const apagar = useCallback(
    async (l: Lembrete) => {
      const d = dataParaIso(new Date(l.quando));
      mudarPessoal(d, (v) => ({ ...v, lembretes: v.lembretes.filter((x) => x.id !== l.id) }));
      try {
        await apagarLembrete({ data: { id: l.id } });
        avisarMudanca(d);
      } catch {
        mudarPessoal(d, (v) => ({ ...v, lembretes: [...v.lembretes, l].sort(porQuando) }));
        toast.error("Não foi possível apagar o lembrete");
      }
    },
    [mudarPessoal],
  );

  /* ---- Linha do tempo: reuniões, lembretes e tarefas com horário ---- */

  const itens = useMemo(() => {
    const lista: ItemDaAgenda[] = [
      ...(reservas ?? []).map((r) => ({
        tipo: "reserva" as const,
        chave: `r${r.id}`,
        inicio: emMinutos(r.inicio),
        fim: emMinutos(r.fim),
        r,
      })),
      ...lembretes.map((l) => ({
        tipo: "lembrete" as const,
        chave: `l${l.id}`,
        inicio: minutoLocal(l.quando),
        l,
      })),
      ...comHora.map((t) => ({
        tipo: "tarefa" as const,
        chave: t.id,
        inicio: emMinutos(t.dueTime!),
        t,
      })),
    ];
    return lista.sort((a, b) => a.inicio - b.inicio || ORDEM_TIPO[a.tipo] - ORDEM_TIPO[b.tipo]);
  }, [reservas, lembretes, comHora]);

  const posicaoDoAgora =
    minutoAgora === null
      ? -1
      : (() => {
          const i = itens.findIndex((it) => it.inicio > minutoAgora);
          return i === -1 ? itens.length : i;
        })();

  /* ---- Resumo ---- */

  const feitas = doDia.filter((t) => t.status === "concluida").length;
  const atrasadas = doDia.filter(
    (t) => t.status !== "concluida" && tarefaVencida(t, agora),
  ).length;
  const minutosEstimados = doDia
    .filter((t) => t.status !== "concluida")
    .reduce((soma, t) => soma + (t.estimatedMinutes ?? 0), 0);
  const minhasReunioes = (reservas ?? []).filter(ehMinha).length;
  const progresso = doDia.length > 0 ? feitas / doDia.length : 0;
  const vazio =
    doDia.length === 0 && lembretes.length === 0 && reservas !== null && reservas.length === 0;

  /* A barra sai do zero ao abrir e desliza entre os dias — em `transform`, que
     o navegador anima sem refazer o layout da página. */
  const [barra, setBarra] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarra(progresso));
    return () => cancelAnimationFrame(id);
  }, [progresso]);

  /* ---- Navegação e teclado ---- */

  const andar = useCallback(
    (passos: number) => {
      const d = new Date(data);
      d.setDate(d.getDate() + passos);
      irPara(dataParaIso(d));
    },
    [data, irPara],
  );

  /* Enquanto a reserva está aberta por cima, o Esc é dela. O modal de reserva
     avisa quando fecha; a tarefa e a criação estão no store. */
  const reservandoRef = useRef(false);
  useEffect(() => {
    const fechou = () => {
      reservandoRef.current = false;
    };
    const criada = () => setVersaoReservas((v) => v + 1);
    window.addEventListener(RESERVA_FECHADA, fechou);
    window.addEventListener(RESERVA_CRIADA, criada);
    return () => {
      window.removeEventListener(RESERVA_FECHADA, fechou);
      window.removeEventListener(RESERVA_CRIADA, criada);
    };
  }, []);

  /* O teclado lê o estado por referência, e o ouvinte é registrado UMA vez.
     Registrado de novo a cada renderização, ele passaria para o fim da fila
     de quem ouve o Esc, e a ordem entre a agenda e os modais por cima dela
     mudaria sozinha. */
  const teclado = useRef({ outroPorCima: false, aoFechar, andar });
  useEffect(() => {
    teclado.current = { outroPorCima: quickCreate.open || taskDialog.open, aoFechar, andar };
  });

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const { outroPorCima, aoFechar, andar } = teclado.current;
      // Quem está por cima (criação, reserva) já tratou o Esc e avisou.
      if (outroPorCima || reservandoRef.current || e.defaultPrevented) return;
      /* O menu de uma tarefa aberto por cima: o Esc é para fechar só ele.
         É por isso que a agenda ouve na CAPTURA: o menu fecha no ouvinte dele,
         e o navegador roda as microtarefas entre um ouvinte e outro — quando a
         vez da agenda chegasse, o React já teria tirado o menu da tela e esta
         pergunta responderia "não há menu", fechando a agenda junto. */
      if (document.querySelector("[data-menu-da-tarefa]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        andar(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        andar(1);
      }
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, []);

  /* O foco entra na agenda ao abrir e volta para o dia clicado ao fechar — sem
     isso, quem navega pelo teclado fica no topo da página. */
  const cartaoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    /* No quadro seguinte, e não agora: focar no meio da abertura obrigava o
       navegador a refazer o layout da página inteira mais uma vez, antes de
       desenhar o primeiro quadro do modal. */
    const id = requestAnimationFrame(() => cartaoRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(id);
      antes?.focus?.({ preventScroll: true });
    };
  }, []);

  /* Os primeiros 400 ms ignoram o mouse. O mês abria o dia com duplo clique, e
     o segundo clique de quem ainda tem esse costume cairia dentro da agenda que
     acabou de abrir — fechando-a pelo fundo, ou abrindo uma tarefa por acaso.

     Quem ignora é uma película por cima de tudo, que some depois. Não é
     `pointer-events: none` no modal inteiro: a propriedade é herdada, e
     devolvê-la fazia o navegador recalcular o estilo de cada elemento da
     agenda de uma vez — o maior quadro da abertura, no rastro. */
  const [prontaParaClique, setProntaParaClique] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setProntaParaClique(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  /* ---- Ações ---- */

  const reservar = useCallback(
    (escolha?: EscolhaDeHorario) => {
      reservandoRef.current = true;
      abrirReservaDeSala(dia, escolha);
    },
    [dia],
  );
  const reservarJanela = useCallback(
    (salaId: number, janela: Intervalo) =>
      reservar({
        salaId,
        inicio: emHora(janela.de),
        fim: emHora(Math.min(janela.de + 60, janela.ate)),
      }),
    [reservar],
  );

  const criarTarefa = () => openQuickCreate({ dueDate: dia });

  /* ---- Textos do cabeçalho ---- */

  const diaDaSemana = capitalizar(data.toLocaleDateString("pt-BR", { weekday: "long" }));
  const porExtenso = data.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const mesCurto = data
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  const relativo = rotuloRelativo(data, agora);
  const curto = data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.16 }}
      /* z-170: abaixo da reserva (180), da criação e do menu da tarefa (300) e
         da própria tarefa (420) — tudo o que a agenda abre aparece por cima dela. */
      className="fixed inset-0 z-170 flex items-start justify-center overflow-y-auto px-3 pb-8"
      style={{ paddingTop: "calc(var(--titlebar-h) + 1.5rem)" }}
    >
      <TravaScroll />
      {/* Sem desfoque de propósito: o `backdrop-blur` sobre a tela inteira
          era refeito a cada quadro das animações, e em notebook de escritório
          é ele que trava. Um véu mais escuro separa o modal do fundo igual. */}
      <div className="fixed inset-0 bg-black/60" onClick={aoFechar} />
      {!prontaParaClique && <div className="fixed inset-0 z-20" aria-hidden />}

      <motion.div
        ref={cartaoRef}
        tabIndex={-1}
        initial={{ opacity: 0, y: reduzir ? 0 : 16, scale: reduzir ? 1 : 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: reduzir ? 0 : 8,
          scale: reduzir ? 1 : 0.98,
          transition: { duration: 0.12 },
        }}
        transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
        className="relative z-10 w-full max-w-240 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
      >
        {/* ---------------- Cabeçalho ---------------- */}
        <div className="border-b border-border bg-linear-to-b from-primary/10 to-transparent px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-start gap-3">
            <div key={dia} ref={cabecalhoRef} className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className={`flex w-14 shrink-0 flex-col overflow-hidden rounded-xl border bg-background text-center shadow-sm ${
                  ehHoje ? "border-primary ring-2 ring-primary/25" : "border-border"
                }`}
                aria-hidden
              >
                <span className="bg-primary py-0.5 text-[10px] font-bold tracking-wider text-primary-foreground">
                  {mesCurto}
                </span>
                <span className="py-1 text-2xl font-semibold leading-none tabular-nums">
                  {data.getDate()}
                </span>
              </div>
              <div className="min-w-0">
                <h2 id={tituloId} className="truncate text-lg font-semibold leading-tight">
                  {diaDaSemana}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{porExtenso}</span>
                  <span
                    className={`rounded-full px-2 py-px text-[10px] font-semibold ${
                      ehHoje
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-foreground/80"
                    }`}
                  >
                    {relativo}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <BotaoDoTopo rotulo="Dia anterior" onClick={() => andar(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </BotaoDoTopo>
              <button
                type="button"
                onClick={() => irPara(hojeIso)}
                disabled={ehHoje}
                className="hidden h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition hover:bg-secondary disabled:cursor-default disabled:opacity-40 sm:block"
              >
                Hoje
              </button>
              <BotaoDoTopo rotulo="Próximo dia" onClick={() => andar(1)}>
                <ChevronRight className="h-4 w-4" />
              </BotaoDoTopo>
              <button
                type="button"
                onClick={aoFechar}
                aria-label="Fechar"
                className="ml-1 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Resumo do dia + recorte */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Pilula icone={ListTodo}>
              {doDia.length === 0
                ? "Nenhuma tarefa"
                : `${doDia.length} ${doDia.length === 1 ? "tarefa" : "tarefas"}`}
            </Pilula>
            {feitas > 0 && (
              <Pilula icone={CircleCheck} tom="sucesso">
                {feitas} {feitas === 1 ? "concluída" : "concluídas"}
              </Pilula>
            )}
            {atrasadas > 0 && (
              <Pilula icone={TriangleAlert} tom="perigo">
                {atrasadas} {atrasadas === 1 ? "atrasada" : "atrasadas"}
              </Pilula>
            )}
            {reservas && reservas.length > 0 && (
              <Pilula icone={DoorOpen} tom="primario">
                {reservas.length} {reservas.length === 1 ? "reunião" : "reuniões"}
                {minhasReunioes > 0 && ` · ${minhasReunioes} sua${minhasReunioes === 1 ? "" : "s"}`}
              </Pilula>
            )}
            {lembretes.length > 0 && (
              <Pilula icone={AlarmClock} tom="aviso">
                {lembretes.length} {lembretes.length === 1 ? "lembrete" : "lembretes"}
              </Pilula>
            )}
            {minutosEstimados > 0 && (
              <Pilula icone={Timer}>≈ {duracaoPorExtenso(minutosEstimados)} de trabalho</Pilula>
            )}

            <div
              role="radiogroup"
              aria-label="De quem são as tarefas"
              className="ml-auto inline-flex rounded-lg border border-border bg-background p-0.5 text-[11px]"
            >
              {(
                [
                  ["eu", "Só minhas"],
                  ["todos", "Todos"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={escopo === valor}
                  onClick={() => aoMudarEscopo(valor)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    escopo === valor
                      ? "bg-secondary font-semibold text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quanto do dia já foi feito */}
        <div className="h-1 bg-secondary" aria-hidden>
          <div
            className="h-full origin-left bg-success transition-transform duration-500 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${barra})` }}
          />
        </div>

        {/* ---------------- Corpo ----------------
            No desktop o corpo tem altura fixa — a que cabe na janela — e cada
            coluna rola por conta própria. Com a altura presa ao conteúdo, abrir
            um bloco da direita esticava o cartão inteiro a cada quadro da
            animação, e o navegador repintava cartão, sombra e o calendário por
            trás. Fixa, só a coluna da direita se mexe; e o cartão também não
            muda mais de tamanho ao trocar de dia. */}
        <div
          key={dia}
          ref={corpoRef}
          className="grid gap-4 p-4 sm:p-5 lg:h-[clamp(26rem,calc(100dvh-var(--titlebar-h)-15.5rem),50rem)] lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-[minmax(0,1fr)]"
        >
          {/* Agenda */}
          <div className="min-w-0 space-y-5 lg:overflow-y-auto lg:pr-1">
            {vazio ? (
              <div className="flex flex-col items-center px-6 py-14 text-center lg:h-full lg:justify-center lg:py-0">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <CalendarCheck2 className="h-6 w-6" />
                </span>
                <div className="mt-3 text-sm font-semibold">Dia livre</div>
                <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                  {escopo === "eu"
                    ? "Nenhuma tarefa sua e nenhuma reunião nas salas para esta data."
                    : "Nenhuma tarefa e nenhuma reunião nas salas para esta data."}
                </p>
              </div>
            ) : (
              <>
                {(itens.length > 0 || (buscandoReservas && reservas === null)) && (
                  <section>
                    <TituloDaSecao icone={Clock} contagem={itens.length}>
                      Com horário
                    </TituloDaSecao>
                    <ol className="space-y-2">
                      {itens.map((item, i) => (
                        <ItemDaLinha
                          key={item.chave}
                          linhaDoAgora={i === posicaoDoAgora ? minutoAgora : null}
                        >
                          {item.tipo === "reserva" ? (
                            <CartaoDaReserva
                              r={item.r}
                              minha={ehMinha(item.r)}
                              acontecendo={
                                minutoAgora !== null &&
                                item.inicio <= minutoAgora &&
                                minutoAgora < item.fim
                              }
                            />
                          ) : item.tipo === "lembrete" ? (
                            <CartaoDoLembrete l={item.l} aoApagar={apagar} />
                          ) : (
                            <CartaoDaTarefa
                              t={item.t}
                              agora={agora}
                              users={users}
                              euId={currentUser.id}
                              aoAbrir={openTask}
                            />
                          )}
                        </ItemDaLinha>
                      ))}
                      {posicaoDoAgora === itens.length && itens.length > 0 && (
                        <LinhaDoAgora minuto={minutoAgora!} />
                      )}
                      {buscandoReservas && reservas === null && (
                        <li className="flex items-center gap-2 pl-14 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Buscando as reuniões das
                          salas…
                        </li>
                      )}
                    </ol>
                  </section>
                )}

                {semHora.length > 0 && (
                  <section>
                    <TituloDaSecao icone={ListTodo} contagem={semHora.length}>
                      Sem horário marcado
                    </TituloDaSecao>
                    <ul className="space-y-1.5">
                      {semHora.map((t) => (
                        <li key={t.id}>
                          <CartaoDaTarefa
                            t={t}
                            agora={agora}
                            users={users}
                            euId={currentUser.id}
                            aoAbrir={openTask}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>

          {/* Ações: criar tarefa direto; os outros três abrem pelo cabeçalho.
              O espaço da barra de rolagem fica reservado (e sai do respiro da
              borda, `-mr-3`): senão, a barra que aparece no meio de uma
              animação estreitaria a coluna e o texto pularia de linha. */}
          <div className="order-first space-y-2.5 lg:order-0 lg:-mr-3 lg:overflow-y-auto lg:overscroll-contain lg:scrollbar-gutter-stable">
            <div>
              <button
                type="button"
                onClick={criarTarefa}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> Criar tarefa
              </button>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                {passado
                  ? `O prazo vem em ${curto}, que já passou: a tarefa nasce atrasada.`
                  : `O prazo já vem preenchido com ${curto}.`}
              </p>
            </div>

            <SecaoRecolhivel
              secao="nota"
              icone={NotebookPen}
              titulo="Anotação do dia"
              resumo={
                !pessoal.doDia
                  ? (pessoal.falha ?? "Carregando…")
                  : nota
                    ? primeiraLinha(nota.texto)
                    : "Nada anotado · só você vê"
              }
              // Aberto, o texto já está no campo: repetir a primeira linha seria eco.
              resumoAberta={pessoal.doDia ? "Só você vê" : undefined}
              marca={nota ? <span className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
              focarAoAbrir
            >
              {/* A anotação só aparece depois de lida: um campo vazio antes da
                  hora deixaria a pessoa escrever por cima da que já existe. */}
              {pessoal.doDia ? (
                <NotaDoDia dia={dia} nota={nota} aoSalvar={aoSalvarNota} />
              ) : pessoal.falha ? (
                <p className="rounded-md bg-secondary px-2.5 py-2 text-[11px] text-muted-foreground">
                  {pessoal.falha}
                </p>
              ) : (
                <div className="h-20 animate-pulse rounded-lg bg-secondary" aria-hidden />
              )}
            </SecaoRecolhivel>

            <SecaoRecolhivel
              secao="lembrete"
              icone={AlarmClock}
              titulo="Novo lembrete"
              resumo={
                !pessoal.doDia
                  ? (pessoal.falha ?? "Carregando…")
                  : lembretes.length > 0
                    ? `${lembretes.length} ${lembretes.length === 1 ? "lembrete" : "lembretes"} neste dia`
                    : "Avisa na sineta e no Windows"
              }
              marca={
                lembretes.length > 0 ? (
                  <span className="shrink-0 rounded-full bg-warning/15 px-1.5 text-[10px] font-semibold tabular-nums">
                    {lembretes.length}
                  </span>
                ) : null
              }
              focarAoAbrir
            >
              <NovoLembrete
                ehHoje={ehHoje}
                passado={passado}
                indisponivel={!pessoal.doDia}
                aoCriar={criarNovoLembrete}
              />
              {!passado && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Aparece na linha do tempo e avisa na sineta e no Windows na hora marcada.
                </p>
              )}
            </SecaoRecolhivel>

            <SecaoRecolhivel
              secao="salas"
              icone={DoorOpen}
              titulo="Salas de reunião"
              resumo={
                reservas === null
                  ? (falhaReservas ?? "Buscando as salas…")
                  : resumoDasSalas(salasDoDia, reservasPorSala, minutoAgora, passado)
              }
              marca={
                buscandoReservas ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : null
              }
            >
              <p className="text-[11px] text-muted-foreground">
                Expediente das {emHora(EXPEDIENTE.de)} às {emHora(EXPEDIENTE.ate)}
              </p>
              {falhaReservas && reservas === null ? (
                <p className="mt-2.5 rounded-md bg-secondary px-2.5 py-2 text-[11px] text-muted-foreground">
                  {falhaReservas}
                </p>
              ) : reservas === null || salasDoDia.length === 0 ? (
                <div className="mt-2.5 space-y-3" aria-hidden>
                  {[0, 1].map((k) => (
                    <div key={k} className="space-y-1.5">
                      <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
                      <div className="h-2 animate-pulse rounded-full bg-secondary" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2.5 space-y-3.5">
                  {salasDoDia.map((sala) => (
                    <DisponibilidadeDaSala
                      key={sala.id}
                      sala={sala}
                      reservas={reservasPorSala.get(sala.id) ?? SEM_RESERVAS}
                      minutoAgora={minutoAgora}
                      passado={passado}
                      aoEscolher={reservarJanela}
                    />
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => reservar()}
                disabled={passado}
                className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-primary/40 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent"
              >
                <CalendarClock className="h-4 w-4" /> Reservar horário
              </button>
              <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
                {passado
                  ? "Esse dia já passou."
                  : "Clique numa janela livre para abrir a reserva com ela escolhida."}
              </p>
            </SecaoRecolhivel>

            <button
              type="button"
              onClick={() => aoVerNoCalendario(dia)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <CalendarRange className="h-3.5 w-3.5" /> Ver no modo Dia do calendário
            </button>
            <p className="hidden text-center text-[10px] text-muted-foreground/70 lg:block">
              ← → trocam o dia · Esc fecha
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------ Peças ------------------------------ */

function BotaoDoTopo({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-background transition hover:bg-secondary"
    >
      {children}
    </button>
  );
}

const TONS = {
  neutro: "border-border bg-background text-foreground",
  sucesso: "border-success/30 bg-success/10 text-success",
  perigo: "border-destructive/30 bg-destructive/10 text-destructive",
  primario: "border-primary/30 bg-primary/10 text-primary",
  // O amarelo do tema não tem contraste para texto: ele fica no ícone.
  aviso: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
} as const;

function Pilula({
  icone: Icone,
  tom = "neutro",
  children,
}: {
  icone: LucideIcon;
  tom?: keyof typeof TONS;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TONS[tom]}`}
    >
      <Icone className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

function TituloDaSecao({
  icone: Icone,
  contagem,
  children,
}: {
  icone: LucideIcon;
  contagem: number;
  children: ReactNode;
}) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Icone className="h-3.5 w-3.5" />
      {children}
      <span className="rounded-full bg-secondary px-1.5 py-px text-[10px] tabular-nums">
        {contagem}
      </span>
    </h3>
  );
}

/**
 * Um bloco da coluna de ações que abre e fecha pelo cabeçalho.
 *
 * Recolhido, o cabeçalho ainda diz o essencial (`resumo`, `marca`): recolher
 * não pode esconder que o dia tem anotação ou que a sala está ocupada.
 *
 * Três cuidados que vieram do uso:
 *   - aberto ou fechado é estado DO BLOCO, e não da agenda. Guardado na agenda,
 *     cada clique redesenhava o modal inteiro antes de o bloco abrir — era o
 *     "tempinho" entre o clique e a abertura;
 *   - o cabeçalho não encolhe ao ser pressionado. O `styles.css` aperta todo
 *     botão no `:active` (scale 0.97): sutil num botão pequeno, mas num
 *     cabeçalho da largura do bloco a barra encolhia e o fundo escuro aparecia
 *     nas laterais. Aqui o retorno do clique é só a cor;
 *   - abre e fecha deslizando a altura, e os blocos de baixo acompanham.
 *
 * O clique só anima; o trabalho pesado sai de dentro dele. O conteúdo entra na
 * página antes — quando o mouse chega no cabeçalho, ou o foco do teclado —,
 * fechado, com altura zero e inerte; depois de fechado ele fica, pronto para a
 * próxima vez. Montar e estilizar tudo no próprio clique segurava o primeiro
 * quadro da animação.
 *
 * Aberto pelo clique, o foco vai para o campo de texto, para já escrever; aberto
 * porque ficou lembrado, não — senão as setas parariam de trocar o dia assim
 * que a agenda abrisse. E o foco só vem quando o bloco TERMINA de abrir: focar
 * no clique obrigava o navegador a calcular estilo e layout antes do primeiro
 * quadro, pelo mesmo motivo.
 */
function SecaoRecolhivel({
  secao,
  icone: Icone,
  titulo,
  resumo,
  resumoAberta,
  marca,
  focarAoAbrir = false,
  children,
}: {
  secao: Secao;
  icone: LucideIcon;
  titulo: string;
  resumo: ReactNode;
  /** O que o cabeçalho diz com o bloco aberto, quando não é o mesmo `resumo`. */
  resumoAberta?: ReactNode;
  marca?: ReactNode;
  focarAoAbrir?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const reduzir = useReducedMotion();
  const [aberta, setAberta] = useState(() => secoesGuardadas().includes(secao));
  const [montado, setMontado] = useState(aberta);
  const preparar = () => setMontado(true);
  const conteudoRef = useRef<HTMLDivElement>(null);
  const abertaPeloClique = useRef(false);

  useEffect(() => {
    guardarSecao(secao, aberta);
  }, [secao, aberta]);

  // Chamado também ao fim do fechar: aí `aberta` já é false e nada acontece.
  // Com o bloco inteiro à vista, o foco pode rolar a coluna até o campo.
  const aoTerminarAnimacao = () => {
    if (!aberta || !abertaPeloClique.current) return;
    abertaPeloClique.current = false;
    if (focarAoAbrir) {
      conteudoRef.current?.querySelector<HTMLElement>("textarea, input:not([type=time])")?.focus();
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={id}
        onPointerEnter={preparar}
        onFocus={preparar}
        onClick={() => {
          preparar();
          abertaPeloClique.current = !aberta;
          setAberta((v) => !v);
        }}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50 active:transform-none active:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
          aberta ? "bg-secondary/30" : ""
        }`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icone className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">{titulo}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {aberta && resumoAberta !== undefined ? resumoAberta : resumo}
          </span>
        </span>
        {marca}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out ${
            aberta ? "rotate-180" : ""
          }`}
        />
      </button>
      {/* `initial={false}`: o bloco que já abre aberto (lembrado, ou ao trocar
          de dia) aparece pronto, e o montado de antemão nasce fechado; só o
          clique anima. */}
      {montado && (
        <motion.div
          id={id}
          initial={false}
          animate={aberta ? { height: "auto", opacity: 1 } : { height: 0, opacity: 0 }}
          transition={
            reduzir
              ? { duration: 0 }
              : {
                  height: { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] },
                  opacity: { duration: 0.2, ease: "easeOut" },
                }
          }
          onAnimationComplete={aoTerminarAnimacao}
          inert={!aberta}
          className="overflow-hidden"
        >
          <div ref={conteudoRef} className="border-t border-border px-3 pb-3 pt-2.5">
            {children}
          </div>
        </motion.div>
      )}
    </section>
  );
}

/** Uma linha da linha do tempo, com a linha do "agora" antes dela quando é a vez. */
function ItemDaLinha({
  linhaDoAgora,
  children,
}: {
  linhaDoAgora: number | null;
  children: ReactNode;
}) {
  return (
    <>
      {linhaDoAgora !== null && <LinhaDoAgora minuto={linhaDoAgora} />}
      <li>{children}</li>
    </>
  );
}

/** Onde o dia está agora, entre o que já foi e o que vem. */
function LinhaDoAgora({ minuto }: { minuto: number }) {
  return (
    <li className="flex items-center gap-2" aria-label={`Agora, ${emHora(minuto)}`}>
      <span className="w-12 shrink-0 text-right text-[11px] font-bold tabular-nums text-destructive">
        {emHora(minuto)}
      </span>
      <span className="relative h-px flex-1 bg-destructive/70">
        <span className="absolute -left-1 -top-0.75 h-1.75 w-1.75 rounded-full bg-destructive" />
      </span>
    </li>
  );
}

/** A hora na régua, à esquerda do cartão — a mesma coluna para os três tipos. */
function HoraNaRegua({ children }: { children: ReactNode }) {
  return (
    <span className="w-12 shrink-0 pt-2 text-right text-xs font-semibold tabular-nums text-foreground/80">
      {children}
    </span>
  );
}

/**
 * Reunião numa sala.
 *
 * Não abre nada ao clicar, de propósito: o Fluxo não edita nem cancela reserva
 * (quem guarda é o Agendador), e um cartão clicável que não leva a lugar nenhum
 * útil é pior que um que só informa.
 */
const CartaoDaReserva = memo(function CartaoDaReserva({
  r,
  minha,
  acontecendo,
}: {
  r: ReservaDeSala;
  minha: boolean;
  acontecendo: boolean;
}) {
  const minutos = emMinutos(r.fim) - emMinutos(r.inicio);
  return (
    <div className="flex gap-2">
      <HoraNaRegua>{r.inicio}</HoraNaRegua>
      <div
        className="min-w-0 flex-1 rounded-lg border border-l-[3px] border-primary/25 border-l-primary bg-primary/5 px-3 py-2"
        title={`${r.sala} · ${r.inicio}–${r.fim} · ${r.motivo} · ${r.responsavel}`}
      >
        <div className="flex items-center gap-2 text-[11px]">
          <DoorOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-semibold tabular-nums">
            {r.inicio}–{r.fim}
          </span>
          <span className="text-muted-foreground">{duracaoPorExtenso(minutos)}</span>
          {acontecendo && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-px text-[10px] font-semibold text-destructive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
              Agora
            </span>
          )}
          <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {r.sala}
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-medium">{r.motivo || "Reunião"}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {minha ? "Você reservou" : `Reservada por ${nomeCurto(r.responsavel || "—")}`}
        </div>
      </div>
    </div>
  );
});

/** Lembrete na linha do tempo. Só de quem o criou; apaga pela lixeira. */
const CartaoDoLembrete = memo(function CartaoDoLembrete({
  l,
  aoApagar,
}: {
  l: Lembrete;
  aoApagar: (l: Lembrete) => void;
}) {
  const provisorio = l.id.startsWith("tmp-");
  const avisado = !!l.avisadoEm;
  return (
    <div className="flex gap-2">
      <HoraNaRegua>{horaLocal(l.quando)}</HoraNaRegua>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-l-[3px] border-warning/35 border-l-warning bg-warning/5 px-3 py-2">
        <AlarmClock className="h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${avisado ? "text-muted-foreground" : ""}`}>
            {l.texto}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {provisorio ? "Salvando…" : avisado ? "Lembrete · já avisado" : "Lembrete · só você vê"}
          </div>
        </div>
        {!provisorio && (
          <button
            type="button"
            onClick={() => aoApagar(l)}
            aria-label={`Apagar o lembrete "${l.texto}"`}
            title="Apagar lembrete"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});

/** Tarefa do dia. Clique abre; botão direito traz o menu de sempre. */
const CartaoDaTarefa = memo(function CartaoDaTarefa({
  t,
  agora,
  users,
  euId,
  aoAbrir,
}: {
  t: Task;
  agora: number;
  users: { id: string; name: string; avatar: string }[];
  euId: string;
  aoAbrir: (id: string) => void;
}) {
  const feita = t.status === "concluida";
  const atrasada = !feita && tarefaVencida(t, agora);
  const setor = sectors.find((s) => s.id === t.sector);
  const responsavel = t.assigneeId !== euId ? users.find((u) => u.id === t.assigneeId) : undefined;
  const Icone = feita ? CircleCheck : t.status === "andamento" ? CircleDot : Circle;
  const comHora = !!t.dueTime && HORARIO_VALIDO.test(t.dueTime);

  const cartao = (
    <button
      type="button"
      onClick={() => aoAbrir(t.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openTaskContext(t.id, e.clientX, e.clientY);
      }}
      className="group flex w-full min-w-0 flex-1 items-start gap-2.5 rounded-lg border border-l-[3px] border-border bg-background px-3 py-2 text-left transition hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ borderLeftColor: statusColor[t.status] }}
    >
      <Icone className="mt-0.5 h-4 w-4 shrink-0" style={{ color: statusColor[t.status] }} />
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm font-medium ${feita ? "text-muted-foreground line-through" : ""}`}
        >
          {t.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: priorityColor[t.priority] }}
            />
            {priorityLabels[t.priority]}
          </span>
          {setor && (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: setor.color }} />
              {setor.name}
            </span>
          )}
          {responsavel && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserAvatar
                nome={responsavel.name}
                iniciais={responsavel.avatar}
                className="h-4 w-4 text-[7px]"
              />
              <span className="truncate">{nomeCurto(responsavel.name)}</span>
            </span>
          )}
          {!!t.estimatedMinutes && (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {duracaoPorExtenso(t.estimatedMinutes)}
            </span>
          )}
          {t.inPack && (
            <span className="rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">
              Pack
            </span>
          )}
        </div>
      </div>
      {atrasada ? (
        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
          Atrasada
        </span>
      ) : (
        <span className="shrink-0 pt-0.5 text-[10px] text-muted-foreground">
          {statusLabels[t.status]}
        </span>
      )}
    </button>
  );

  // Na linha do tempo a hora vai na régua, à esquerda, como a das reuniões.
  if (!comHora) return cartao;
  return (
    <div className="flex gap-2">
      <HoraNaRegua>{t.dueTime}</HoraNaRegua>
      {cartao}
    </div>
  );
});

/**
 * A anotação do dia: um campo que salva sozinho na pausa da digitação.
 *
 * Trocar de dia ou fechar a agenda no meio de uma frase não perde nada: ao sair,
 * o que falta gravar é gravado na hora, sem esperar a pausa.
 */
function NotaDoDia({
  dia,
  nota,
  aoSalvar,
}: {
  dia: string;
  nota: AnotacaoDoDia | null;
  aoSalvar: (dia: string, texto: string, atualizadaEm: string | null) => void;
}) {
  const [texto, setTexto] = useState(nota?.texto ?? "");
  const [estado, setEstado] = useState<"salvo" | "digitando" | "salvando" | "erro">("salvo");
  const [salvaEm, setSalvaEm] = useState(nota?.atualizadaEm ?? null);
  const pendente = useRef<string | null>(null);
  const relogio = useRef<number | undefined>(undefined);
  const aoSalvarRef = useRef(aoSalvar);
  useEffect(() => {
    aoSalvarRef.current = aoSalvar;
  });

  const gravar = useCallback(
    async (valor: string) => {
      setEstado("salvando");
      try {
        const r = await salvarAnotacao({ data: { dia, texto: valor } });
        aoSalvarRef.current(dia, valor, r.atualizadaEm);
        // Só marca "salvo" se nada novo foi digitado enquanto este ia.
        if (pendente.current === valor) {
          pendente.current = null;
          setEstado("salvo");
          setSalvaEm(r.atualizadaEm);
        }
      } catch {
        setEstado("erro");
      }
    },
    [dia],
  );

  useEffect(
    () => () => {
      window.clearTimeout(relogio.current);
      const falta = pendente.current;
      if (falta === null) return;
      void salvarAnotacao({ data: { dia, texto: falta } })
        .then((r) => aoSalvarRef.current(dia, falta, r.atualizadaEm))
        .catch(() => toast.error("A anotação do dia não foi salva", { description: dia }));
    },
    [dia],
  );

  return (
    <div>
      <textarea
        value={texto}
        onChange={(e) => {
          const valor = e.target.value;
          setTexto(valor);
          pendente.current = valor;
          setEstado("digitando");
          window.clearTimeout(relogio.current);
          relogio.current = window.setTimeout(() => void gravar(valor), 700);
        }}
        onBlur={() => {
          if (pendente.current === null) return;
          window.clearTimeout(relogio.current);
          void gravar(pendente.current);
        }}
        placeholder="O que você quer guardar deste dia…"
        aria-label="Anotação do dia"
        rows={3}
        className="field-sizing-content max-h-60 min-h-20 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
      />
      <div className="mt-0.5 flex h-4 items-center justify-end text-[10px] text-muted-foreground">
        {estado === "salvando" || estado === "digitando" ? (
          "Salvando…"
        ) : estado === "erro" ? (
          <button
            type="button"
            onClick={() => void gravar(texto)}
            className="font-medium text-destructive hover:underline"
          >
            Não salvou — tentar de novo
          </button>
        ) : salvaEm ? (
          `Salva às ${horaLocal(salvaEm)}`
        ) : null}
      </div>
    </div>
  );
}

/** Formulário do lembrete: hora e texto numa linha; Enter cria. */
function NovoLembrete({
  ehHoje,
  passado,
  indisponivel,
  aoCriar,
}: {
  ehHoje: boolean;
  passado: boolean;
  indisponivel: boolean;
  aoCriar: (hora: string, texto: string) => Promise<boolean>;
}) {
  /* Hoje, a próxima meia hora; nos outros dias, 9h — o começo do dia de quem
     planeja com antecedência. */
  const [hora, setHora] = useState(() => {
    if (!ehHoje) return "09:00";
    const d = new Date();
    const proxima = Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / PASSO) * PASSO;
    return emHora(Math.min(proxima, 23 * 60 + 30));
  });
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  if (passado) {
    return (
      <p className="rounded-md bg-secondary px-2.5 py-2 text-[11px] text-muted-foreground">
        Esse dia já passou — lembrete é de hoje em diante.
      </p>
    );
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!texto.trim() || !HORARIO_VALIDO.test(hora) || enviando) return;
    setEnviando(true);
    const criou = await aoCriar(hora, texto.trim());
    setEnviando(false);
    if (criou) setTexto("");
  };

  return (
    <form onSubmit={(e) => void enviar(e)} className="flex items-center gap-1.5">
      <input
        type="time"
        value={hora}
        step={300}
        onChange={(e) => setHora(e.target.value)}
        aria-label="Horário do lembrete"
        disabled={indisponivel}
        className="h-8 w-23 shrink-0 rounded-md border border-border bg-card px-2 text-xs tabular-nums outline-none focus:border-primary/50 disabled:opacity-50"
      />
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={300}
        placeholder="Do que lembrar?"
        aria-label="Do que lembrar"
        disabled={indisponivel}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-primary/50 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!texto.trim() || enviando || indisponivel}
        aria-label="Criar lembrete"
        title="Criar lembrete"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
      >
        {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
      </button>
    </form>
  );
}

/**
 * Como está uma sala no dia: a faixa do expediente com o que já está ocupado,
 * e as janelas livres, que abrem a reserva com o horário já marcado.
 */
const DisponibilidadeDaSala = memo(function DisponibilidadeDaSala({
  sala,
  reservas,
  minutoAgora,
  passado,
  aoEscolher,
}: {
  sala: SalaDeReuniao;
  reservas: ReservaDeSala[];
  minutoAgora: number | null;
  passado: boolean;
  aoEscolher: (salaId: number, janela: Intervalo) => void;
}) {
  const situacao = situacaoDaSala(reservas, minutoAgora, passado);
  const { ocupados, livres } = situacao;

  const total = EXPEDIENTE.ate - EXPEDIENTE.de;
  const posicao = (min: number) =>
    ((Math.min(Math.max(min, EXPEDIENTE.de), EXPEDIENTE.ate) - EXPEDIENTE.de) / total) * 100;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{sala.nome}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
          <span className={`h-1.5 w-1.5 rounded-full ${situacao.cor}`} />
          {situacao.texto}
        </span>
      </div>

      <div className="relative mt-2 h-2 rounded-full bg-secondary">
        {ocupados.map(({ de, ate, r }) => (
          <span
            key={r.id}
            title={`${r.inicio}–${r.fim} · ${r.motivo || "Reunião"}`}
            className="absolute inset-y-0 rounded-full bg-primary/70"
            style={{
              left: `${posicao(de)}%`,
              width: `${Math.max(posicao(ate) - posicao(de), 1.5)}%`,
            }}
          />
        ))}
        {minutoAgora !== null && minutoAgora >= EXPEDIENTE.de && minutoAgora <= EXPEDIENTE.ate && (
          <span
            className="absolute -inset-y-1 w-0.5 rounded-full bg-destructive"
            style={{ left: `${posicao(minutoAgora)}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground/80">
        <span>{emHora(EXPEDIENTE.de)}</span>
        <span>{emHora((EXPEDIENTE.de + EXPEDIENTE.ate) / 2)}</span>
        <span>{emHora(EXPEDIENTE.ate)}</span>
      </div>

      {livres.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {livres.slice(0, 3).map((janela) => (
            <button
              key={janela.de}
              type="button"
              onClick={() => aoEscolher(sala.id, janela)}
              title={`Reservar a ${sala.nome} a partir das ${emHora(janela.de)}`}
              className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
            >
              {emHora(janela.de)}–{emHora(janela.ate)}
            </button>
          ))}
          {livres.length > 3 && (
            <span className="self-center px-1 text-[10px] text-muted-foreground">
              +{livres.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
