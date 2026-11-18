import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import { CalendarCheck, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import "@svar-ui/react-gantt/all.css";
import "./gantt.css";
import { UserAvatar } from "@/components/user-avatar";
import { tarefaVencida } from "@/lib/prazo";
import type { Project, Task, User } from "@/lib/fluxo-types";
import {
  FILTROS_VAZIOS,
  conflitosDeDependencia,
  filtrarGantt,
  type FiltrosDoGantt,
  criariaCiclo,
  inicioDoDia,
  ligacoesDoGantt,
  montarGanttDoProjeto,
  montarGanttGeral,
  pontasDaLigacao,
  projetoDaLinha,
  replanejamento,
  somarDias,
  type Dependencia,
  type ItemDoGantt,
  type MudancaDePlano,
} from "./montar-gantt";
import { PALAVRAS_PT } from "./palavras-pt";
import { BarraDeFiltros } from "./filtros-do-gantt";

/**
 * O Gantt do CONECTA (pedido do Eduardo, 05/11/2026):
 * - `modo: "projeto"` (Módulo 2, 17/11): a aba de um projeto, só as tarefas dele;
 * - `modo: "geral"` (Módulo 3, 18/11): todos os projetos, cada um com as suas tarefas
 *   embaixo, recolhidos de início;
 * - arrastar e redimensionar a barra replaneja a tarefa (Módulo 4, 18/11), e arrastar o
 *   fundo anda pelo gráfico;
 * - setas de dependência (Módulo 5, 18/11): ligar pelas bolinhas das pontas, apagar
 *   clicando na seta, e a barra avisa quando começa antes da outra terminar.
 *
 * Carregado sob demanda por `./index.tsx`: o SVAR e o CSS dele só baixam quando a
 * tela abre. O clique numa tarefa abre o diálogo da casa (`openTask`); no projeto,
 * abre ou recolhe. O editor do próprio SVAR fica desligado, e o SVAR não muda dado
 * nenhum sozinho: quem grava é `onReplanejar`, pelo mesmo caminho da tela.
 */

interface PropsComuns {
  users: User[];
  onAbrirTarefa: (id: string) => void;
  /**
   * Os ids (minúsculos) das tarefas que a pessoa pode arrastar, vindos do servidor com a
   * mesma regra da trava do prazo. `null` = ainda conferindo; `"erro"` = a conferência
   * falhou. Nos dois casos nada arrasta.
   */
  podeReplanejar: ReadonlySet<string> | null | "erro";
  /** A barra foi arrastada: grava (e empilha o Desfazer). */
  onReplanejar: (tarefaId: string, mudanca: MudancaDePlano) => void;
  /** As dependências que a pessoa vê (vindas do servidor; ids em qualquer caixa). */
  dependencias: readonly Dependencia[];
  /** Ligar: `tarefaId` passa a esperar `dependeDeId`. Grava (e empilha o Desfazer). */
  onLigar: (tarefaId: string, dependeDeId: string) => void;
  /** Desligar a seta. Grava (e empilha o Desfazer). */
  onDesligar: (tarefaId: string, dependeDeId: string) => void;
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
  /** A barra não arrasta (projeto, concluída ou sem permissão): o cursor avisa antes. */
  travada: boolean;
  /** Começa antes de uma da qual depende terminar: o aviso. `null` = tudo certo. */
  conflito: string | null;
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
  /* Começa antes de uma da qual depende terminar (Módulo 5): o triângulo de alerta, a borda
     (ver `gantt.css`) e o motivo ao parar o mouse em cima. */
  const conflito = data.conflito as string | null | undefined;
  const alerta = conflito ? (
    <TriangleAlert className="fluxo-gantt-alerta" aria-label={conflito} />
  ) : null;
  /* Ao passar o mouse, a barra mostra o que dá para fazer com ela (pedido do usuário,
     18/11/2026: só o cursor mudava). Alças nas pontas = esticar; o cadeado = não arrasta. */
  if (data.travada) {
    return (
      <div
        className={`fluxo-gantt-rotulo fluxo-gantt-travada${conflito ? " fluxo-gantt-conflito" : ""}`}
        title={conflito ?? undefined}
      >
        {alerta}
        <Lock className="fluxo-gantt-cadeado" aria-hidden />
        {data.text}
      </div>
    );
  }
  return (
    <div
      className={`fluxo-gantt-rotulo${conflito ? " fluxo-gantt-conflito" : ""}`}
      title={conflito ?? undefined}
    >
      <span className="fluxo-gantt-alca fluxo-gantt-alca-inicio" aria-hidden />
      {alerta}
      {data.text}
      <span className="fluxo-gantt-alca fluxo-gantt-alca-fim" aria-hidden />
    </div>
  );
}

/** Por que esta barra não arrasta; `null` = arrasta. */
function motivoDaTrava(
  linha: LinhaDoGantt | undefined,
  pode: GanttConectaProps["podeReplanejar"],
): string | null {
  if (!linha) return "Esta linha não se arrasta.";
  if (linha.ehProjeto) return "A barra do projeto acompanha as tarefas dele: arraste as tarefas.";
  if (linha.type === "concluida") return "Tarefa concluída: o prazo fica como estava.";
  if (pode === "erro") {
    return "Não deu para conferir quem pode replanejar agora. Recarregue a página para tentar de novo.";
  }
  if (!pode) return "Um instante: conferindo quem pode replanejar esta tarefa.";
  if (!pode.has(linha.id.toLowerCase())) {
    return "Só o responsável, quem criou, a chefia ou a gerência mudam o prazo desta tarefa.";
  }
  return null;
}

/**
 * O que o SVAR faria sozinho e não pode: criar, apagar, copiar ou mover tarefa (tecla
 * Delete, Ctrl+C/V, arrastar linha da grade) e mudar o tipo de uma seta. Ligar e desligar
 * setas passa pelos ouvintes do `init` (Módulo 5). Tudo que muda dado passa por nós.
 */
const ACOES_BLOQUEADAS = [
  "add-task",
  "delete-task",
  "copy-task",
  "move-task",
  "indent-task",
  "split-task",
  "update-link",
] as const;

/** Por que esta tarefa não pode ESPERAR outra (ser a ponta de chegada de uma seta). */
function motivoParaNaoEsperar(
  linha: LinhaDoGantt,
  pode: GanttConectaProps["podeReplanejar"],
): string | null {
  if (linha.type === "concluida") return "Tarefa concluída: não passa a esperar outra.";
  const motivo = motivoDaTrava(linha, pode);
  return motivo?.startsWith("Só o responsável")
    ? "Só o responsável, quem criou, a chefia ou a gerência ligam dependências a esta tarefa."
    : motivo;
}

/** Quanto o mouse anda antes de um clique virar arraste do fundo. */
const LIMIAR_DO_ARRASTE_PX = 4;
/** Um clique que chega até aqui depois de um arraste é o fim do arraste, não um clique. */
const CLIQUE_DEPOIS_DO_ARRASTE_MS = 300;

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
  const { modo, users, onAbrirTarefa, podeReplanejar, onReplanejar, dependencias } = props;
  const aparencia = useAparencia();
  const [agora, setAgora] = useState(() => Date.now());
  const [api, setApi] = useState<IApi | null>(null);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  /* A visão geral cobre meses: abre na semana. O projeto, no dia. */
  const [escala, setEscala] = useState<Escala>(modo === "geral" ? "semana" : "dia");
  /* Os filtros (Módulo 6): só desta tela, começam limpos a cada vez que ela abre. */
  const [filtros, setFiltros] = useState<FiltrosDoGantt>(FILTROS_VAZIOS);
  /* Os projetos que a pessoa abriu. Num ref: abrir não pode remontar os dados (o SVAR
     recomeçaria), mas quando os dados mudam eles nascem já abertos. */
  const abertos = useRef(new Set<string>());

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  const chave = assinatura(props);
  const chavePessoas = users.map((u) => `${u.id}|${u.name}|${u.avatar}`).join("\n");
  /* O Gantt remonta quando o tema muda (a grade é desenhada uma vez só). A montagem é refeita
     junto, para ler os projetos abertos de AGORA: com a de antes, trocar o tema recolhia tudo
     o que a pessoa tinha aberto (checagem de 18/11/2026). */
  const chaveDoTema = aparencia ? `${aparencia.escuro}-${aparencia.borda}` : "";
  /* As setas também pelo conteúdo: um array novo a cada desenho, o SVAR toma por dado novo
     e recalcula as barras, e no meio de um arraste a barra voltava para o lugar de antes
     (prova de 18/11/2026). */
  const chaveDasSetas = dependencias
    .map((d) => `${d.dependeDeId}>${d.tarefaId}`.toLowerCase())
    .sort()
    .join("|");
  const montagem = useMemo(
    () => {
      const atrasada = (t: Parameters<typeof tarefaVencida>[0], ms: number) => tarefaVencida(t, ms);
      const pessoas = new Map(users.map((u) => [u.id, u]));
      /* Primeiro os filtros (setor, pessoa, projeto, situação e período), depois o desenho. */
      const filtrado = filtrarGantt(
        props.tarefas,
        props.modo === "geral" ? props.projetos : [],
        filtros,
        {
          agora,
          atrasada,
          setorDe: (id) => pessoas.get(id)?.sector,
          regraDosTrintaDias: props.modo === "geral",
        },
      );
      const m =
        props.modo === "geral"
          ? montarGanttGeral(filtrado.projetos, filtrado.tarefas, agora, atrasada, abertos.current)
          : montarGanttDoProjeto(filtrado.tarefas, agora, atrasada);
      /* O conflito é do plano, não da vista: conta com TODAS as tarefas, até as que o filtro
         escondeu (a que espera continua avisando que começa antes de a outra terminar). */
      const conflitos = conflitosDeDependencia(
        montarGanttDoProjeto(props.tarefas, agora, atrasada).tasks,
        dependencias,
      );
      const linhas: LinhaDoGantt[] = m.tasks.map((item) => {
        const p = pessoas.get(item.responsavelId);
        const linha = {
          ...item,
          pessoaNome: p?.name ?? "—",
          pessoaIniciais: p?.avatar ?? "?",
          travada: false,
          conflito: conflitos.get(item.id) ?? null,
        };
        linha.travada = motivoDaTrava(linha, podeReplanejar) !== null;
        return linha;
      });
      return {
        ...m,
        linhas,
        porId: new Map(linhas.map((l) => [l.id, l])),
        setas: ligacoesDoGantt(m.tasks, dependencias),
        mostrando: filtrado.tarefas.length,
      };
    },
    /* Pelo conteúdo (`chave`, `chavePessoas`, `chaveDasSetas`), não pela identidade das
       listas: ver `assinatura`. Os filtros só mudam pela mão da pessoa; o tema, ver `chaveDoTema`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave, chavePessoas, chaveDasSetas, agora, podeReplanejar, filtros, chaveDoTema],
  );

  /* Os rostos do filtro: só quem é responsável por alguma tarefa deste Gantt. */
  const pessoasDoGantt = useMemo(() => {
    const responsaveis = new Set(props.tarefas.map((t) => t.assigneeId));
    return users.filter((u) => responsaveis.has(u.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, chavePessoas]);

  /*
   * O que os ouvintes do SVAR leem na hora do gesto. Eles são registrados uma vez (no
   * `init`), então leem por refs, e não pelas variáveis de quando foram criados.
   */
  const atual = useRef({
    montagem,
    podeReplanejar,
    onReplanejar,
    tarefas: props.tarefas,
    dependencias,
    onLigar: props.onLigar,
    onDesligar: props.onDesligar,
  });
  useEffect(() => {
    atual.current = {
      montagem,
      podeReplanejar,
      onReplanejar,
      tarefas: props.tarefas,
      dependencias,
      onLigar: props.onLigar,
      onDesligar: props.onDesligar,
    };
  });
  /**
   * Ligando uma seta: já clicou na primeira bolinha, falta a segunda. Só o `onClick` mexe
   * nisto: no segundo clique o SVAR dispara o `add-link` ANTES de o clique chegar até nós.
   */
  const ligando = useRef(false);
  /** O aviso do segundo passo. Um id por vez: reusar o id logo depois de fechar, o sonner engole. */
  const avisoDeLigar = useRef(0);
  const fecharAvisoDeLigar = () => toast.dismiss(`gantt-ligar-${avisoDeLigar.current}`);
  /** Quando houve o último arraste (de barra ou do fundo): o clique que vem junto não abre nada. */
  const ultimoArraste = useRef(0);
  /** O SVAR avisa o fim do arraste duas vezes; grava uma. */
  const ultimaGravacao = useRef({ chave: "", em: 0 });

  /** O arraste de barra em andamento: onde ela estava (px) quando o gesto começou. */
  const gesto = useRef<{ id: string; x: number; w: number } | null>(null);
  /** As datas que a barra terá ao soltar, num rótulo em cima dela. */
  const mostrarRotulo = useRef<(r: Rotulo | null) => void>(() => {});
  const setRotulo = (r: Rotulo | null) => mostrarRotulo.current(r);

  const encerrarGesto = () => {
    gesto.current = null;
    setRotulo(null);
  };

  /* Soltou o mouse fora de tudo (ou o SVAR não avisou o fim): o rótulo não pode ficar.
     Só refs aqui dentro, como em `encerrarGesto`. */
  useEffect(() => {
    const aoSoltar = () =>
      window.setTimeout(() => {
        gesto.current = null;
        mostrarRotulo.current(null);
      }, 0);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
    return () => {
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
    };
  }, []);

  /**
   * A barra anda de DIA EM DIA enquanto é arrastada, e o rótulo mostra as datas em que ela
   * vai cair (pedido do usuário, 18/11/2026: ela corria solta, pixel a pixel, caía no dia
   * mais próximo só ao soltar, e era preciso ir e voltar até acertar o dia, ainda mais na
   * escala de semana ou de mês, em que o dia tem poucos pixels).
   *
   * O SVAR aplica a posição que vem no evento (`$x = left`, `$w = width`), e a
   * interceptação roda antes: basta encaixar `left`/`width` em dias inteiros, contados de
   * onde a barra estava no começo do gesto. Ao soltar ele conta os dias do mesmo jeito
   * (`Math.round(deslocamento / largura do dia)`), então onde a barra está é onde ela fica.
   */
  const encaixarEmDias = (
    a: IApi,
    linha: LinhaDoGantt,
    ev: { id: string | number; left?: number; width?: number },
  ) => {
    if (typeof ev.left !== "number" || typeof ev.width !== "number") return;
    const id = String(ev.id);
    if (!gesto.current || gesto.current.id !== id) {
      const t = a.getTask(ev.id) as ITask & { $x?: number; $w?: number };
      gesto.current = { id, x: t.$x ?? ev.left, w: t.$w ?? ev.width };
    }
    const escala = a.getState()._scales;
    const porDia = escala ? escala.lengthUnitWidth / (escala.lengthUnit === "week" ? 7 : 1) : 0;
    if (!(porDia > 0)) return;
    const g = gesto.current;
    const diasInicio = Math.round((ev.left - g.x) / porDia);
    const diasFim = Math.round((ev.left + ev.width - (g.x + g.w)) / porDia);
    ev.left = g.x + diasInicio * porDia;
    ev.width = Math.max(porDia, g.x + g.w + diasFim * porDia - ev.left);

    const inicio = DATA_CURTA.format(somarDias(linha.start, diasInicio));
    const prazo = DATA_CURTA.format(somarDias(linha.end, diasFim - 1));
    /* O que o gesto está fazendo agora: mover a barra inteira, puxar uma ponta, ou nada
       (voltou ao ponto de partida). O deslocamento é o da data que muda. */
    const conteudo: ConteudoDoRotulo =
      diasInicio !== 0 && diasFim !== 0
        ? { datas: `${inicio} → ${prazo}`, dias: diasInicio }
        : diasFim !== 0
          ? { datas: `Prazo ${prazo}`, dias: diasFim }
          : diasInicio !== 0
            ? { datas: `Início ${inicio}`, dias: diasInicio }
            : { datas: `${inicio} → ${prazo}`, dias: 0 };
    const barra = document.querySelector(`.fluxo-gantt .wx-bar[data-id=":${CSS.escape(id)}"]`);
    if (!barra) return;
    /* A barra na tela ainda está onde o SVAR a pôs no evento anterior (`$x` de agora): o
       rótulo vai para onde ela vai, centrado em cima dela. */
    const caixa = barra.getBoundingClientRect();
    const xAgora = (a.getTask(ev.id) as { $x?: number }).$x ?? g.x;
    setRotulo({ x: caixa.left + (ev.left - xAgora) + ev.width / 2, y: caixa.top, ...conteudo });
  };

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

  /**
   * Arrastar o FUNDO do gráfico anda por ele, para os lados e para cima e para baixo
   * (pedido do usuário, 18/11/2026). Só no fundo: o arraste que começa numa barra é dela
   * (replanejar), e a barra de rolagem fica com o navegador. Rola pelo SVAR, como o "Hoje".
   */
  const aoApertar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!api || e.button !== 0) return;
    const alvo = e.target as Element;
    const grafico = alvo.closest?.(".wx-chart") as HTMLElement | null;
    if (!grafico || alvo.closest(".wx-bar")) return;
    const caixa = grafico.getBoundingClientRect();
    if (
      e.clientX - caixa.left > grafico.clientWidth ||
      e.clientY - caixa.top > grafico.clientHeight
    ) {
      return;
    }
    const raizDoGantt = e.currentTarget;
    const estado = api.getState();
    const inicio = {
      x: e.clientX,
      y: e.clientY,
      left: estado.scrollLeft ?? 0,
      top: estado.scrollTop ?? 0,
    };
    const maxLeft = Math.max(0, grafico.scrollWidth - grafico.clientWidth);
    const maxTop = Math.max(0, grafico.scrollHeight - grafico.clientHeight);
    let andando = false;
    const mover = (ev: PointerEvent) => {
      const dx = ev.clientX - inicio.x;
      const dy = ev.clientY - inicio.y;
      if (!andando && Math.hypot(dx, dy) < LIMIAR_DO_ARRASTE_PX) return;
      if (!andando) {
        andando = true;
        raizDoGantt.classList.add("fluxo-gantt-andando");
      }
      ev.preventDefault();
      void api.exec("scroll-chart", {
        left: Math.min(maxLeft, Math.max(0, inicio.left - dx)),
        top: Math.min(maxTop, Math.max(0, inicio.top - dy)),
      });
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
      if (andando) {
        ultimoArraste.current = performance.now();
        raizDoGantt.classList.remove("fluxo-gantt-andando");
      }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
  };

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
        </span>
      </div>
      <BarraDeFiltros
        filtros={filtros}
        aoMudar={setFiltros}
        pessoas={pessoasDoGantt}
        projetos={props.modo === "geral" ? props.projetos : null}
        mostrando={montagem.mostrando}
        total={props.tarefas.length}
      />

      {vazio ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          {props.tarefas.length > 0 || (props.modo === "geral" && props.projetos.length > 0) ? (
            <>
              Nada com esses filtros.
              <button
                type="button"
                onClick={() => setFiltros(FILTROS_VAZIOS)}
                className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-foreground transition hover:border-primary/60"
              >
                Limpar filtros
              </button>
            </>
          ) : modo === "geral" ? (
            "Nenhum projeto para mostrar."
          ) : (
            "Este projeto ainda não tem tarefas."
          )}
        </div>
      ) : (
        <div
          ref={setRaiz}
          className="fluxo-gantt min-h-0 flex-1"
          style={estilo}
          onPointerDown={aoApertar}
          onClick={(e) => {
            if (!api) return;
            const el = e.target as Element;
            /* Ligar uma seta: o SVAR cuida das duas bolinhas; aqui só o aviso do segundo passo. */
            if (el.classList?.contains("wx-link")) {
              if (!ligando.current) {
                ligando.current = true;
                fecharAvisoDeLigar();
                avisoDeLigar.current += 1;
                toast.message(
                  el.classList.contains("wx-left")
                    ? "Agora clique na bolinha do FIM da tarefa que precisa terminar antes."
                    : "Agora clique na bolinha do INÍCIO da tarefa que vai esperar.",
                  { id: `gantt-ligar-${avisoDeLigar.current}`, duration: 8000 },
                );
              } else {
                ligando.current = false;
                fecharAvisoDeLigar();
              }
              return;
            }
            if (ligando.current) {
              ligando.current = false;
              fecharAvisoDeLigar();
            }
            /* O fim de um arraste (de barra ou do fundo) não é clique. */
            if (performance.now() - ultimoArraste.current < CLIQUE_DEPOIS_DO_ARRASTE_MS) return;
            /* O × de apagar a seta é do SVAR. */
            if (el.closest?.(".wx-delete-button")) return;
            /* O triângulo do projeto o SVAR já abre e recolhe sozinho. */
            if (el.closest?.(".wx-toggle-icon")) return;
            /* No fundo vazio do gráfico o clique não abre nada: só a barra e a linha da grade. */
            if (el.closest?.(".wx-chart") && !el.closest(".wx-bar")) return;
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
              <Tema fonts={false} key={chaveDoTema}>
                <Gantt
                  tasks={montagem.linhas}
                  links={montagem.setas}
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
                  init={(a: IApi) => {
                    setApi(a);
                    /* O editor do SVAR fica desligado: o duplo clique não abre nada além do nosso. */
                    a.intercept("show-editor", () => false);
                    for (const acao of ACOES_BLOQUEADAS) a.intercept(acao, () => false);
                    /* Ligar (Módulo 5): o SVAR não guarda a seta sozinho. Vale fim → início;
                       ligado ao contrário (início com fim), é a mesma intenção, invertida. */
                    a.intercept(
                      "add-link",
                      (ev: {
                        link?: {
                          source?: string | number;
                          target?: string | number;
                          type?: string;
                        };
                      }) => {
                        fecharAvisoDeLigar();
                        const {
                          montagem: m,
                          podeReplanejar: pode,
                          dependencias: deps,
                        } = atual.current;
                        const de = m.porId.get(String(ev.link?.source));
                        const para = m.porId.get(String(ev.link?.target));
                        const avisar = (texto: string) => {
                          toast.message(texto, { id: "gantt-trava" });
                          return false;
                        };
                        if (!de || !para || de.ehProjeto || para.ehProjeto) {
                          return avisar("A dependência liga duas tarefas, não projetos.");
                        }
                        const tipo = ev.link?.type;
                        const [antes, espera] =
                          tipo === "e2s" ? [de, para] : tipo === "s2e" ? [para, de] : [null, null];
                        if (!antes || !espera) {
                          return avisar(
                            "Ligue o FIM da tarefa que precisa terminar antes ao INÍCIO da que vai esperar.",
                          );
                        }
                        const motivo = motivoParaNaoEsperar(espera, pode);
                        if (motivo) return avisar(motivo);
                        const ja = deps.some(
                          (d) =>
                            d.tarefaId.toLowerCase() === espera.id.toLowerCase() &&
                            d.dependeDeId.toLowerCase() === antes.id.toLowerCase(),
                        );
                        if (ja) return avisar("Essa dependência já existe.");
                        if (criariaCiclo(deps, espera.id, antes.id)) {
                          return avisar(
                            `Isso criaria um ciclo: "${antes.text}" já espera, direto ou por outras, por "${espera.text}".`,
                          );
                        }
                        atual.current.onLigar(espera.id, antes.id);
                        return false;
                      },
                    );
                    /* Apagar: clique na seta, depois no × que aparece na tarefa que espera. */
                    a.intercept("delete-link", (ev: { id: string | number }) => {
                      const pontas = pontasDaLigacao(ev.id);
                      const { montagem: m, podeReplanejar: pode } = atual.current;
                      const espera = pontas ? m.porId.get(pontas.tarefaId) : undefined;
                      if (!pontas || !espera) return false;
                      const motivo = motivoParaNaoEsperar(espera, pode);
                      if (motivo && espera.type !== "concluida") {
                        toast.message(motivo, { id: "gantt-trava" });
                        return false;
                      }
                      atual.current.onDesligar(pontas.tarefaId, pontas.dependeDeId);
                      return false;
                    });
                    /* Arrastar: a barra travada nem sai do lugar, e o motivo aparece (um aviso
                       só por vez: o mesmo `id` substitui o anterior). */
                    a.intercept(
                      "drag-task",
                      (ev: {
                        id: string | number;
                        left?: number;
                        width?: number;
                        inProgress?: boolean;
                      }) => {
                        ultimoArraste.current = performance.now();
                        const { montagem: m, podeReplanejar: pode } = atual.current;
                        const linha = m.porId.get(String(ev.id));
                        const motivo = motivoDaTrava(linha, pode);
                        if (motivo) {
                          toast.message(motivo, { id: "gantt-trava" });
                          return false;
                        }
                        if (!ev.inProgress || !linha) return encerrarGesto();
                        encaixarEmDias(a, linha, ev);
                      },
                    );
                    /* Soltou: o SVAR quer mudar a tarefa (manda o objeto INTEIRO, não só as
                       datas). Só valem as datas, de quem pode, e só se o dia mudou; fora isso
                       o SVAR não muda nada. Quem grava é `onReplanejar`. */
                    a.intercept(
                      "update-task",
                      (ev: {
                        id: string | number;
                        task: Partial<ITask>;
                        diff?: number;
                        inProgress?: boolean;
                      }) => {
                        if (ev.inProgress) return;
                        encerrarGesto();
                        const { montagem: m, podeReplanejar: pode, tarefas } = atual.current;
                        const linha = m.porId.get(String(ev.id));
                        if (!linha || motivoDaTrava(linha, pode) || !ev.task) return false;
                        /* No fim do arraste o SVAR manda os campos que o gesto mexe com os valores
                           de ANTES (mover: start e end; ponta esquerda: start; direita: end) e o
                           deslocamento em `diff`, na unidade da escala (nas nossas, o dia). */
                        let start = linha.start;
                        let end = linha.end;
                        if (typeof ev.diff === "number" && ev.diff !== 0) {
                          const unidade = a.getState()._scales?.lengthUnit;
                          const dias = ev.diff * (unidade === "week" ? 7 : 1);
                          if ("start" in ev.task) start = somarDias(linha.start, dias);
                          if ("end" in ev.task) end = somarDias(linha.end, dias);
                        } else {
                          start = ev.task.start ?? linha.start;
                          end =
                            ev.task.end ??
                            (ev.task.start && typeof ev.task.duration === "number"
                              ? somarDias(ev.task.start, ev.task.duration)
                              : linha.end);
                        }
                        const tarefa = tarefas.find((t) => t.id === linha.id);
                        const mudanca = replanejamento(
                          linha,
                          { start, end },
                          {
                            dueTime: tarefa?.dueTime,
                          },
                        );
                        if (!mudanca) return false;
                        const chaveDoGesto = `${linha.id}|${mudanca.startDate ?? ""}|${mudanca.dueDate ?? ""}`;
                        const ultima = ultimaGravacao.current;
                        if (ultima.chave === chaveDoGesto && performance.now() - ultima.em < 1500) {
                          return;
                        }
                        ultimaGravacao.current = { chave: chaveDoGesto, em: performance.now() };
                        atual.current.onReplanejar(linha.id, mudanca);
                      },
                    );
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
      <RotuloDoArraste mostrar={mostrarRotulo} />
    </div>
  );
}

/** O que o rótulo do arraste diz: as datas e quantos dias a data que muda anda (0 = como estava). */
interface ConteudoDoRotulo {
  datas: string;
  dias: number;
}

/** Onde e o que o rótulo do arraste mostra. */
interface Rotulo extends ConteudoDoRotulo {
  x: number;
  y: number;
}

/**
 * O rótulo com as datas durante o arraste, com estado PRÓPRIO: ele muda a cada movimento
 * do mouse, e se o estado morasse no Gantt, cada mudança redesenharia o SVAR no meio do
 * gesto (e o SVAR, ao redesenhar, devolvia a barra ao lugar de antes: prova de 18/11/2026).
 * O Gantt fala com ele pela função que ele deixa em `mostrar`.
 */
function RotuloDoArraste({ mostrar }: { mostrar: { current: (r: Rotulo | null) => void } }) {
  const [rotulo, setRotulo] = useState<Rotulo | null>(null);
  useEffect(() => {
    mostrar.current = setRotulo;
    return () => {
      mostrar.current = () => {};
    };
  }, [mostrar]);
  if (!rotulo) return null;
  const { dias } = rotulo;
  /* As cores e o "Como estava" pedidos pelo usuário em 18/11/2026: o deslocamento em verde
     quando a data anda para a frente, em vermelho quando volta, e um rótulo neutro,
     tracejado, quando a barra voltou ao ponto de partida (soltar ali não muda nada). */
  const conteudo =
    dias === 0 ? (
      <>
        <RotateCcw className="h-3 w-3" aria-hidden />
        Como estava · {rotulo.datas}
      </>
    ) : (
      <>
        {rotulo.datas}
        <span className="text-muted-foreground" aria-hidden>
          ·
        </span>
        <span className={dias > 0 ? "text-success" : "text-destructive"}>
          {dias > 0 ? "+" : "−"}
          {Math.abs(dias)} {Math.abs(dias) === 1 ? "dia" : "dias"}
        </span>
      </>
    );
  /* No `body`: dentro do layout há `transform`, e o `fixed` sairia do lugar. */
  return createPortal(
    <div
      role="status"
      className={`pointer-events-none fixed z-50 inline-flex -translate-x-1/2 -translate-y-full items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold shadow-md ${
        dias === 0
          ? "border-dashed border-muted-foreground/60 bg-muted text-muted-foreground"
          : "border-border bg-popover text-popover-foreground"
      }`}
      style={{ left: rotulo.x, top: rotulo.y - 6 }}
    >
      {conteudo}
    </div>,
    document.body,
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
