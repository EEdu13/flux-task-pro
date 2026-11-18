import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Gantt,
  Willow,
  WillowDark,
  locateTask,
  type IApi,
  type IColumnConfig,
  type IScaleConfig,
  type ITask,
} from "@svar-ui/react-gantt";
import { Locale } from "@svar-ui/react-core";
import { CalendarCheck } from "lucide-react";
import "@svar-ui/react-gantt/all.css";
import "./gantt.css";
import { UserAvatar } from "@/components/user-avatar";
import { tarefaVencida } from "@/lib/prazo";
import type { Project, Task, User } from "@/lib/fluxo-types";
import {
  DIAS_DE_CONCLUIDAS,
  inicioDoDia,
  montarGanttDoProjeto,
  montarGanttGeral,
  projetoDaLinha,
  type ItemDoGantt,
} from "./montar-gantt";
import { PALAVRAS_PT } from "./palavras-pt";

/**
 * O Gantt do CONECTA (pedido do Eduardo, 05/11/2026), só leitura por enquanto:
 * - `modo: "projeto"` (Módulo 2, 17/11): a aba de um projeto, só as tarefas dele;
 * - `modo: "geral"` (Módulo 3, 18/11): todos os projetos, cada um com as suas tarefas
 *   embaixo, recolhidos de início.
 *
 * Carregado sob demanda por `./index.tsx`: o SVAR e o CSS dele só baixam quando a
 * tela abre. O clique numa tarefa abre o diálogo da casa (`openTask`); no projeto,
 * abre ou recolhe. O editor do próprio SVAR fica desligado.
 */

interface PropsComuns {
  users: User[];
  onAbrirTarefa: (id: string) => void;
}

export interface PropsDoProjeto extends PropsComuns {
  modo: "projeto";
  tarefas: Task[];
}

export interface PropsGerais extends PropsComuns {
  modo: "geral";
  projetos: Project[];
  /** As tarefas dos projetos (as outras são ignoradas). */
  tarefas: Task[];
}

export type GanttConectaProps = PropsDoProjeto | PropsGerais;

/** A linha que a grade da esquerda e a barra recebem: a montagem mais quem é o responsável. */
interface LinhaDoGantt extends ItemDoGantt {
  pessoaNome: string;
  pessoaIniciais: string;
}

/* Os tipos do SVAR precisam estar registrados: tipo desconhecido vira "task", e a
   classe de cor (`.wx-bar.atrasada`) não sai. */
const TIPOS = [
  { id: "pendente", label: "A fazer" },
  { id: "andamento", label: "Em andamento" },
  { id: "concluida", label: "Concluída" },
  { id: "atrasada", label: "Atrasada" },
  { id: "semprazo", label: "Sem prazo" },
  { id: "projeto", label: "Projeto" },
  { id: "projetovazio", label: "Projeto" },
];

type Escala = "dia" | "semana" | "mes";

/**
 * As três escalas. A semana começa na segunda (`weekStart` de `palavras-pt.ts`), como
 * no Portfólio. Nas três, o SVAR mede o tempo em dias por baixo (a largura do dia
 * muda): as barras ficam exatas em qualquer uma.
 */
const ESCALAS: Record<Escala, { rotulo: string; scales: IScaleConfig[]; cellWidth: number }> = {
  dia: {
    rotulo: "Dia",
    scales: [
      { unit: "month", step: 1, format: "%F %Y" },
      { unit: "day", step: 1, format: "%d" },
    ],
    cellWidth: 36,
  },
  semana: {
    rotulo: "Semana",
    scales: [
      { unit: "month", step: 1, format: "%F %Y" },
      { unit: "week", step: 1, format: "%d/%m" },
    ],
    cellWidth: 84,
  },
  mes: {
    rotulo: "Mês",
    scales: [
      { unit: "year", step: 1, format: "%Y" },
      { unit: "month", step: 1, format: "%F" },
    ],
    cellWidth: 120,
  },
};

/** O "agora" das cores e da linha de hoje anda sozinho, sem consultar o servidor. */
const RELOGIO_MS = 5 * 60_000;

const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/* O SVAR entrega a linha com o tipo genérico dele; os campos são os nossos. */
type ComLinha = { row: { [campo: string]: unknown } };

function CelulaTitulo({ row: r }: ComLinha) {
  const row = r as unknown as LinhaDoGantt;
  if (!row.ehProjeto) {
    return (
      <span className="fluxo-gantt-titulo" title={row.text}>
        {row.text}
      </span>
    );
  }
  return (
    <span className="fluxo-gantt-titulo-projeto" title={row.text}>
      <span className="fluxo-gantt-bolinha" style={{ background: row.cor ?? "var(--primary)" }} />
      <span className="fluxo-gantt-titulo">{row.text}</span>
    </span>
  );
}

function CelulaPessoa({ row: r }: ComLinha) {
  const row = r as unknown as LinhaDoGantt;
  return (
    <div className="fluxo-gantt-pessoa" title={row.pessoaNome}>
      <UserAvatar
        nome={row.pessoaNome}
        iniciais={row.pessoaIniciais}
        className="h-6 w-6 text-[10px]"
      />
    </div>
  );
}

function CelulaPrazo({ row: r }: ComLinha) {
  const row = r as unknown as LinhaDoGantt;
  if (!row.prazo) {
    /* Projeto sem prazo próprio: em branco (o "Sem prazo" é das tarefas). */
    return row.ehProjeto ? null : <span className="fluxo-gantt-sem-prazo">Sem prazo</span>;
  }
  const classe = row.ehProjeto
    ? "fluxo-gantt-prazo-projeto"
    : row.type === "atrasada"
      ? "fluxo-gantt-prazo-atrasado"
      : undefined;
  return <span className={classe}>{DATA_CURTA.format(new Date(row.prazo))}</span>;
}

function RotuloDaBarra({ data }: { data: ITask }) {
  if (data.ehProjeto) {
    return (
      <div
        className="fluxo-gantt-barra-projeto"
        style={{ "--fluxo-cor-projeto": data.cor ?? "var(--primary)" } as CSSProperties}
      >
        {data.text}
      </div>
    );
  }
  return <div className="fluxo-gantt-rotulo">{data.text}</div>;
}

const COLUNA_PESSOA: IColumnConfig = {
  id: "pessoaNome",
  header: "",
  width: 44,
  align: "center",
  cell: CelulaPessoa,
};
const COLUNA_PRAZO: IColumnConfig = {
  id: "prazo",
  header: "Prazo",
  width: 76,
  align: "center",
  cell: CelulaPrazo,
};
const COLUNAS: Record<GanttConectaProps["modo"], IColumnConfig[]> = {
  projeto: [
    { id: "text", header: "Tarefa", flexgrow: 1, cell: CelulaTitulo },
    COLUNA_PESSOA,
    COLUNA_PRAZO,
  ],
  geral: [
    { id: "text", header: "Projeto e tarefa", flexgrow: 1, cell: CelulaTitulo },
    COLUNA_PESSOA,
    COLUNA_PRAZO,
  ],
};

/**
 * A grade do gráfico é uma imagem que o SVAR desenha ao montar, com a cor de
 * `--wx-gantt-border`, e ele só entende hex ali. Converte o token (oklch) pintando
 * um pixel num canvas.
 */
function tokenEmHex(variavel: string): string | null {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(variavel).trim();
  if (!valor) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = valor;
  ctx.fillRect(0, 0, 1, 1);
  /* Com a transparência: no escuro o `--border` é branco a 8–12% (styles.css), e
     sem o alfa a grade sairia branca. `#rrggbbaa` é o formato do próprio SVAR. */
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const canais = a === 255 ? [r, g, b] : [r, g, b, a];
  return "#" + canais.map((v) => v!.toString(16).padStart(2, "0")).join("");
}

/**
 * Onde fica `momento` no gráfico, em px a partir do começo do eixo. Pelas células
 * da escala de baixo, a mesma geometria das barras: vale nas escalas de dia, semana
 * e mês. `null` se o momento está fora do eixo.
 */
function posicaoNoEixo(api: IApi, momento: number): number | null {
  const escala = api.getState()._scales;
  if (!escala) return null;
  const celulas = escala.rows[escala.rows.length - 1]?.cells ?? [];
  let x = 0;
  for (let i = 0; i < celulas.length; i++) {
    const c = celulas[i]!;
    const ini = c.date.getTime();
    const fim = i + 1 < celulas.length ? celulas[i + 1]!.date.getTime() : escala.end.getTime();
    if (momento >= ini && momento < fim) return x + (c.width * (momento - ini)) / (fim - ini);
    x += c.width;
  }
  return null;
}

/**
 * A linha de hoje. A do SVAR (`markers`) é da versão paga; esta entra na camada
 * das barras (`.wx-bars`), que rola junto com o gráfico.
 */
function LinhaDeHoje({ api, raiz, agora }: { api: IApi; raiz: HTMLElement; agora: number }) {
  const [pos, setPos] = useState<{ alvo: Element; x: number } | null>(null);
  useEffect(() => {
    let quadro = 0;
    const calcular = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const alvo = raiz.querySelector(".wx-bars");
        const x = posicaoNoEixo(api, agora);
        if (!alvo || x === null) return setPos(null);
        setPos((p) => (p && p.alvo === alvo && p.x === x ? p : { alvo, x }));
      });
    };
    calcular();
    const desfazer = api.getReactiveState()._scales?.subscribe(calcular);
    const marca = Symbol("linha-de-hoje");
    api.on("render-data", calcular, { tag: marca });
    return () => {
      cancelAnimationFrame(quadro);
      desfazer?.();
      api.detach(marca);
    };
  }, [api, raiz, agora]);
  if (!pos) return null;
  return createPortal(<div className="fluxo-gantt-hoje" style={{ left: pos.x }} />, pos.alvo);
}

/** O tema como a página está agora: escuro ou não, e a cor da grade em hex. */
interface Aparencia {
  escuro: boolean;
  borda: string;
}

function lerAparencia(): Aparencia | null {
  const borda = tokenEmHex("--border");
  if (!borda) return null;
  return { escuro: document.documentElement.classList.contains("dark"), borda };
}

/**
 * A aparência lida da PÁGINA, e não de `useTheme`: a troca de tema roda dentro de
 * uma transição animada (`use-theme.ts`), e a classe `.dark` chega ao `<html>`
 * depois que a loja avisa o React. Lendo pela loja, o Gantt pegava a cor da
 * grade do tema anterior (prova de 17/11/2026). Observa a classe e a paleta do
 * `<html>` e lê depois que elas mudam de fato.
 */
function useAparencia(): Aparencia | null {
  const [aparencia, setAparencia] = useState<Aparencia | null>(null);
  /* Antes de pintar: a cor da grade tem que estar pronta quando o SVAR montar. */
  useLayoutEffect(() => {
    const atualizar = () =>
      setAparencia((antes) => {
        const agora = lerAparencia();
        return antes && agora && antes.escuro === agora.escuro && antes.borda === agora.borda
          ? antes
          : agora;
      });
    atualizar();
    const observador = new MutationObserver(atualizar);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-palette"],
    });
    return () => observador.disconnect();
  }, []);
  return aparencia;
}

/**
 * O que importa das tarefas e dos projetos para o desenho, numa linha só. O store
 * remonta as listas a cada render dele (arrays novos com o mesmo conteúdo), e para o
 * SVAR lista nova = recomeçar o gráfico. Comparando por isto, ele só recomeça quando
 * algo do desenho muda de fato.
 */
function assinatura(props: GanttConectaProps): string {
  let s = props.modo;
  for (const t of props.tarefas) {
    s += `\n${t.id}|${t.title}|${t.status}|${t.dueDate ?? ""}|${t.startDate ?? ""}|${t.createdAt}|${t.assigneeId}|${t.projectId ?? ""}|${t.completedAt ?? ""}`;
  }
  if (props.modo === "geral") {
    for (const p of props.projetos) {
      s += `\n#${p.id}|${p.name}|${p.ownerId}|${p.color ?? ""}|${p.dueDate ?? ""}`;
    }
  }
  return s;
}

export default function GanttConecta(props: GanttConectaProps) {
  const { modo, users, onAbrirTarefa } = props;
  const aparencia = useAparencia();
  const [agora, setAgora] = useState(() => Date.now());
  const [api, setApi] = useState<IApi | null>(null);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  /* A visão geral cobre meses: abre na semana. O projeto, no dia. */
  const [escala, setEscala] = useState<Escala>(modo === "geral" ? "semana" : "dia");
  /* Os projetos que a pessoa abriu. Num ref: abrir não pode remontar os dados (o SVAR
     recomeçaria), mas quando os dados mudam eles nascem já abertos. */
  const abertos = useRef(new Set<string>());

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  const chave = assinatura(props);
  const chavePessoas = users.map((u) => `${u.id}|${u.name}|${u.avatar}`).join("\n");
  const montagem = useMemo(
    () => {
      const atrasada = (t: Parameters<typeof tarefaVencida>[0], ms: number) => tarefaVencida(t, ms);
      const m =
        props.modo === "geral"
          ? montarGanttGeral(props.projetos, props.tarefas, agora, atrasada, abertos.current)
          : montarGanttDoProjeto(props.tarefas, agora, atrasada);
      const pessoas = new Map(users.map((u) => [u.id, u]));
      const linhas: LinhaDoGantt[] = m.tasks.map((item) => {
        const p = pessoas.get(item.responsavelId);
        return { ...item, pessoaNome: p?.name ?? "—", pessoaIniciais: p?.avatar ?? "?" };
      });
      return { ...m, linhas };
    },
    /* Pelo conteúdo (`chave`, `chavePessoas`), não pela identidade das listas: ver `assinatura`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave, chavePessoas, agora],
  );

  const hoje = inicioDoDia(agora).getTime();
  const destacarHoje = useMemo(
    () => (data: Date, unidade: string) =>
      unidade === "day" && inicioDoDia(data.getTime()).getTime() === hoje
        ? "fluxo-gantt-coluna-hoje"
        : "",
    [hoje],
  );

  /* A animação do "Hoje" em andamento (quadro pedido), para cancelar se vier outra. */
  const animacao = useRef(0);

  /**
   * Rola até hoje, deixando um terço da tela para o que já passou. Sempre pelo SVAR
   * (`scroll-chart`): a rolagem mora no estado dele, e rolar o elemento direto com
   * `behavior: "smooth"` ele desfaz no meio (prova de 18/11/2026). O suave é nosso,
   * quadro a quadro; quem pediu menos movimento no sistema vai direto.
   */
  const irParaHoje = useCallback(
    (suave: boolean) => {
      if (!api || !raiz) return;
      const grafico = raiz.querySelector<HTMLElement>(".wx-chart");
      const x = posicaoNoEixo(api, Date.now());
      if (!grafico || x === null) return;
      const alvo = Math.max(0, Math.round(x - grafico.clientWidth / 3));
      cancelAnimationFrame(animacao.current);
      const de = api.getState().scrollLeft ?? 0;
      if (!suave || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        void api.exec("scroll-chart", { left: alvo });
        return;
      }
      const inicio = performance.now();
      const DURACAO_MS = 350;
      const passo = (t: number) => {
        const p = Math.min(1, (t - inicio) / DURACAO_MS);
        const suavizado = 1 - (1 - p) ** 3;
        void api.exec("scroll-chart", { left: Math.round(de + (alvo - de) * suavizado) });
        if (p < 1) animacao.current = requestAnimationFrame(passo);
      };
      animacao.current = requestAnimationFrame(passo);
    },
    [api, raiz],
  );

  /* Ao abrir, ao trocar de tema (o Gantt remonta) e ao trocar de escala: hoje à vista.
     Dois quadros: o primeiro é o SVAR desenhar a escala nova. */
  useEffect(() => {
    let segundo = 0;
    const primeiro = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => irParaHoje(false));
    });
    return () => {
      cancelAnimationFrame(primeiro);
      cancelAnimationFrame(segundo);
      cancelAnimationFrame(animacao.current);
    };
  }, [irParaHoje, escala]);

  const Tema = aparencia?.escuro ? WillowDark : Willow;
  const estilo = aparencia
    ? ({ "--fluxo-borda-hex": `1px solid ${aparencia.borda}` } as CSSProperties)
    : undefined;
  const config = ESCALAS[escala];
  const vazio = montagem.linhas.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div
          className="inline-flex rounded-lg bg-secondary/60 p-0.5"
          role="group"
          aria-label="Escala"
        >
          {(Object.keys(ESCALAS) as Escala[]).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={escala === e}
              onClick={() => setEscala(e)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                escala === e
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {ESCALAS[e].rotulo}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => irParaHoje(true)}
          disabled={vazio}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/60 hover:text-foreground disabled:opacity-50"
          title="Rolar até hoje"
        >
          <CalendarCheck className="h-3.5 w-3.5" />
          Hoje
        </button>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <Legenda classe="pendente" rotulo="A fazer" />
          <Legenda classe="andamento" rotulo="Em andamento" />
          <Legenda classe="atrasada" rotulo="Atrasada" />
          <Legenda classe="concluida" rotulo="Concluída" />
          {modo === "geral" && (
            <span title="O filtro de período chega numa próxima etapa">
              · abertas e concluídas nos últimos {DIAS_DE_CONCLUIDAS} dias
            </span>
          )}
        </span>
      </div>

      {vazio ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {modo === "geral"
            ? "Nenhum projeto para mostrar."
            : "Este projeto ainda não tem tarefas."}
        </div>
      ) : (
        <div
          ref={setRaiz}
          className="fluxo-gantt min-h-0 flex-1"
          style={estilo}
          onClick={(e) => {
            if (!api) return;
            /* O triângulo do projeto o SVAR já abre e recolhe sozinho. */
            if ((e.target as Element).closest?.(".wx-toggle-icon")) return;
            const alvo = locateTask(e.nativeEvent, api);
            if (!alvo) return;
            if (projetoDaLinha(alvo.id) !== null) {
              void api.exec("open-task", { id: alvo.id, mode: !api.getTask(alvo.id).open });
              return;
            }
            onAbrirTarefa(String(alvo.id));
          }}
        >
          {aparencia && (
            <Locale words={PALAVRAS_PT}>
              {/* A chave remonta o Gantt quando o tema muda: a grade é desenhada uma vez só. */}
              <Tema fonts={false} key={`${aparencia.escuro}-${aparencia.borda}`}>
                <Gantt
                  tasks={montagem.linhas}
                  links={[]}
                  taskTypes={TIPOS}
                  scales={config.scales}
                  start={montagem.inicio}
                  end={montagem.fim}
                  cellWidth={config.cellWidth}
                  cellHeight={38}
                  gridWidth={400}
                  columns={COLUNAS[modo]}
                  taskTemplate={RotuloDaBarra}
                  highlightTime={destacarHoje}
                  readonly
                  init={(a: IApi) => {
                    setApi(a);
                    /* O editor do SVAR fica desligado: o duplo clique não abre nada além do nosso. */
                    a.intercept("show-editor", () => false);
                    /* Quem a pessoa abre ou recolhe, para continuar assim quando os dados mudam. */
                    a.on("open-task", (ev: { id: string | number; mode: boolean }) => {
                      const projeto = projetoDaLinha(ev.id);
                      if (projeto === null) return;
                      if (ev.mode) abertos.current.add(projeto);
                      else abertos.current.delete(projeto);
                    });
                  }}
                />
                {api && raiz && <LinhaDeHoje api={api} raiz={raiz} agora={agora} />}
              </Tema>
            </Locale>
          )}
        </div>
      )}
    </div>
  );
}

function Legenda({ classe, rotulo }: { classe: string; rotulo: string }) {
  return (
    <span className="hidden items-center gap-1 md:inline-flex">
      <span className={`fluxo-gantt-legenda ${classe}`} />
      {rotulo}
    </span>
  );
}
