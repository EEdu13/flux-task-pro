import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Gantt,
  Willow,
  WillowDark,
  locateTask,
  type IApi,
  type IColumnConfig,
  type ITask,
} from "@svar-ui/react-gantt";
import { Locale } from "@svar-ui/react-core";
import "@svar-ui/react-gantt/all.css";
import "./gantt.css";
import { UserAvatar } from "@/components/user-avatar";
import { tarefaVencida } from "@/lib/prazo";
import type { Task, User } from "@/lib/fluxo-types";
import { inicioDoDia, montarGanttDoProjeto, somarDias, type ItemDoGantt } from "./montar-gantt";
import { PALAVRAS_PT } from "./palavras-pt";

/**
 * O Gantt de um projeto (17/11/2026, Módulo 2 do pedido do Eduardo): só leitura.
 *
 * Carregado sob demanda por `./index.tsx`: o SVAR e o CSS dele só baixam quando a
 * aba abre. O clique numa tarefa abre o diálogo da casa (`openTask`); o editor do
 * próprio SVAR fica desligado.
 */

export interface GanttConectaProps {
  tarefas: Task[];
  users: User[];
  onAbrirTarefa: (id: string) => void;
}

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
];

const ESCALA_DIA = [
  { unit: "month", step: 1, format: "%F %Y" },
  { unit: "day", step: 1, format: "%d" },
];

/** O "agora" das cores e da linha de hoje anda sozinho, sem consultar o servidor. */
const RELOGIO_MS = 5 * 60_000;

const DATA_CURTA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/* O SVAR entrega a linha com o tipo genérico dele; os campos são os nossos. */
type ComLinha = { row: { [campo: string]: unknown } };

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
  if (!row.prazo) return <span className="fluxo-gantt-sem-prazo">Sem prazo</span>;
  return (
    <span className={row.type === "atrasada" ? "fluxo-gantt-prazo-atrasado" : undefined}>
      {DATA_CURTA.format(new Date(row.prazo))}
    </span>
  );
}

function RotuloDaBarra({ data }: { data: ITask }) {
  return <div className="fluxo-gantt-rotulo">{data.text}</div>;
}

const COLUNAS: IColumnConfig[] = [
  { id: "text", header: "Tarefa", flexgrow: 1 },
  { id: "pessoaNome", header: "", width: 44, align: "center", cell: CelulaPessoa },
  { id: "prazo", header: "Prazo", width: 76, align: "center", cell: CelulaPrazo },
];

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
 * A linha de hoje. A do SVAR (`markers`) é da versão paga; esta entra na camada
 * das barras (`.wx-bars`), que rola junto com o gráfico. A posição sai das
 * células da escala de baixo, a mesma geometria das barras, e vale nas escalas
 * de dia, semana e mês.
 */
function LinhaDeHoje({ api, raiz, agora }: { api: IApi; raiz: HTMLElement; agora: number }) {
  const [pos, setPos] = useState<{ alvo: Element; x: number } | null>(null);
  useEffect(() => {
    let quadro = 0;
    const calcular = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        const escala = api.getState()._scales;
        const alvo = raiz.querySelector(".wx-bars");
        if (!escala || !alvo) return setPos(null);
        const celulas = escala.rows[escala.rows.length - 1]?.cells ?? [];
        let x = 0;
        for (let i = 0; i < celulas.length; i++) {
          const c = celulas[i]!;
          const ini = c.date.getTime();
          const fim =
            i + 1 < celulas.length ? celulas[i + 1]!.date.getTime() : escala.end.getTime();
          if (agora >= ini && agora < fim) {
            x += (c.width * (agora - ini)) / (fim - ini);
            return setPos((p) => (p && p.alvo === alvo && p.x === x ? p : { alvo, x }));
          }
          x += c.width;
        }
        setPos(null);
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

export default function GanttConecta({ tarefas, users, onAbrirTarefa }: GanttConectaProps) {
  const aparencia = useAparencia();
  const [agora, setAgora] = useState(() => Date.now());
  const [api, setApi] = useState<IApi | null>(null);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), RELOGIO_MS);
    return () => clearInterval(id);
  }, []);

  const montagem = useMemo(() => {
    const pessoas = new Map(users.map((u) => [u.id, u]));
    const m = montarGanttDoProjeto(tarefas, agora, (t, ms) => tarefaVencida(t, ms));
    const linhas: LinhaDoGantt[] = m.tasks.map((item) => {
      const p = pessoas.get(item.responsavelId);
      return { ...item, pessoaNome: p?.name ?? "—", pessoaIniciais: p?.avatar ?? "?" };
    });
    return { ...m, linhas };
  }, [tarefas, users, agora]);

  const hoje = inicioDoDia(agora).getTime();
  const destacarHoje = useMemo(
    () => (data: Date, unidade: string) =>
      unidade === "day" && inicioDoDia(data.getTime()).getTime() === hoje
        ? "fluxo-gantt-coluna-hoje"
        : "",
    [hoje],
  );

  const Tema = aparencia?.escuro ? WillowDark : Willow;
  const estilo = aparencia
    ? ({ "--fluxo-borda-hex": `1px solid ${aparencia.borda}` } as CSSProperties)
    : undefined;

  return (
    <div
      ref={setRaiz}
      className="fluxo-gantt"
      style={estilo}
      onClick={(e) => {
        if (!api) return;
        const alvo = locateTask(e.nativeEvent, api);
        if (alvo) onAbrirTarefa(String(alvo.id));
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
              scales={ESCALA_DIA}
              start={montagem.inicio}
              end={montagem.fim}
              cellWidth={36}
              cellHeight={38}
              gridWidth={400}
              columns={COLUNAS}
              taskTemplate={RotuloDaBarra}
              highlightTime={destacarHoje}
              readonly
              init={(a: IApi) => {
                setApi(a);
                /* O editor do SVAR fica desligado: o duplo clique não abre nada além do nosso. */
                a.intercept("show-editor", () => false);
                /* Abre com a semana passada à vista, e hoje logo depois. */
                requestAnimationFrame(() =>
                  a.exec("scroll-chart", { date: somarDias(new Date(hoje), -7) }),
                );
              }}
            />
            {api && raiz && <LinhaDeHoje api={api} raiz={raiz} agora={agora} />}
          </Tema>
        </Locale>
      )}
    </div>
  );
}
