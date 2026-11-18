import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { ehFalhaDeCarregamento } from "@/components/conversor/falha-de-carregamento";
import { useFluxo } from "@/lib/fluxo-store";
import type { Task } from "@/lib/fluxo-types";
import { tarefasQuePossoReplanejar } from "@/lib/gantt.functions";
import { empilharDesfazer } from "@/lib/undo-stack";
import type { GanttConectaProps, PropsDoProjeto, PropsGerais } from "./gantt-conecta";
import type { MudancaDePlano } from "./montar-gantt";

/**
 * A porta do Gantt (17/11/2026). O SVAR e o CSS dele pesam, e só quem abre o
 * Gantt precisa deles: o componente vem por `import()`, só no navegador (o SVAR
 * mede a tela, e o servidor não tem tela).
 *
 * A porta também liga o Gantt ao resto do app (Módulo 4, 18/11/2026): pergunta ao
 * servidor quem pode arrastar cada tarefa e grava o arraste pelo `updateTask`, o
 * mesmo caminho do diálogo (histórico e avisos inclusive), com Desfazer.
 */
const GanttConecta = lazy(() => import("./gantt-conecta"));

const MENSAGEM_DE_ATUALIZACAO =
  "O CONECTA foi atualizado enquanto estava aberto. Recarregue a página (Ctrl+R) para ver o Gantt.";

/**
 * Segura o erro do Gantt aqui dentro, como o conversor faz (05/11/2026): depois
 * de um deploy com a aba aberta, o arquivo antigo do Gantt dá 404, e sem este
 * limite a tela inteira cairia no erro da raiz.
 */
class LimiteDoGantt extends Component<{ children: ReactNode }, { erro: unknown }> {
  state = { erro: null as unknown };

  static getDerivedStateFromError(erro: unknown) {
    return { erro };
  }

  componentDidCatch(erro: unknown) {
    console.warn("[gantt] não carregou", erro);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        role="alert"
      >
        <p className="max-w-sm text-sm text-muted-foreground">
          {ehFalhaDeCarregamento(this.state.erro)
            ? MENSAGEM_DE_ATUALIZACAO
            : "Não foi possível mostrar o Gantt. Recarregue a página para tentar de novo."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
        >
          Recarregar a página
        </button>
      </div>
    );
  }
}

function Carregando() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Abrindo o Gantt…
    </div>
  );
}

/**
 * Quem pode arrastar o quê, perguntado ao servidor (a mesma regra da trava do prazo,
 * ver `tarefasQuePodeReplanejar`). Pergunta ao abrir, no `fluxo:sincronizar` (que já
 * existe: o app o dispara quando algo muda nas tarefas) e quando aparece no Gantt uma
 * tarefa que a última resposta não cobria, como uma criada agora. Nenhum intervalo novo.
 */
function usePodeReplanejar(tarefas: readonly Task[]): GanttConectaProps["podeReplanejar"] {
  const [pode, setPode] = useState<GanttConectaProps["podeReplanejar"]>(null);
  const [pedido, setPedido] = useState(0);
  const conferidas = useRef<ReadonlySet<string> | null>(null);
  const atendido = useRef(-1);
  const ids = tarefas.map((t) => t.id.toLowerCase());
  const conferidasAgora = conferidas.current;
  const falta = !conferidasAgora || ids.some((id) => !conferidasAgora.has(id));
  /* Muda quando há tarefa que o servidor ainda não conferiu. */
  const motivo = falta ? ids.join("|") : "conferido";

  useEffect(() => {
    const aoSincronizar = () => setPedido((n) => n + 1);
    window.addEventListener("fluxo:sincronizar", aoSincronizar);
    return () => window.removeEventListener("fluxo:sincronizar", aoSincronizar);
  }, []);

  useEffect(() => {
    if (motivo === "conferido" && pedido === atendido.current) return;
    atendido.current = pedido;
    let vivo = true;
    const idsDaPergunta = new Set(
      motivo === "conferido" ? (conferidas.current ?? []) : motivo.split("|"),
    );
    /* Um respiro: várias tarefas chegando juntas viram uma pergunta só. */
    const espera = window.setTimeout(() => {
      tarefasQuePossoReplanejar()
        .then((r) => {
          if (!vivo) return;
          conferidas.current = idsDaPergunta;
          /* A mesma resposta mantém o mesmo objeto: senão o Gantt recomeçaria à toa. */
          setPode((antes) =>
            antes instanceof Set && antes.size === r.length && r.every((id) => antes.has(id))
              ? antes
              : new Set(r),
          );
        })
        .catch((e: unknown) => {
          if (!vivo) return;
          console.warn("[gantt] não deu para conferir quem pode replanejar", e);
          setPode((antes) => (antes && antes !== "erro" ? antes : "erro"));
        });
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [motivo, pedido]);

  return pode;
}

const DIA_E_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const diaMes = (iso: string | null | undefined) => (iso ? DIA_E_MES.format(new Date(iso)) : "—");

/** Grava o arraste pelo caminho de sempre e empilha o Desfazer, com o "antes" e o "depois". */
function useReplanejar(tarefas: readonly Task[]) {
  const { updateTask } = useFluxo();
  const lista = useRef(tarefas);
  useEffect(() => {
    lista.current = tarefas;
  });
  return useCallback(
    (id: string, mudanca: MudancaDePlano) => {
      const t = lista.current.find((x) => x.id === id);
      if (!t) return;
      const antes: Partial<Task> = { startDate: t.startDate ?? null, dueDate: t.dueDate };
      updateTask(id, mudanca);
      const inicioAntes = diaMes(t.startDate || t.createdAt);
      const label = mudanca.dueDate
        ? `Prazo de "${t.title}": ${diaMes(t.dueDate)} → ${diaMes(mudanca.dueDate)}`
        : `Início de "${t.title}": ${inicioAntes} → ${diaMes(mudanca.startDate)}`;
      empilharDesfazer({
        label,
        descricao:
          mudanca.dueDate && mudanca.startDate
            ? `Início: ${inicioAntes} → ${diaMes(mudanca.startDate)}`
            : undefined,
        undo: () => updateTask(id, antes),
      });
    },
    [updateTask],
  );
}

type SemLigacao<P> = Omit<P, "podeReplanejar" | "onReplanejar">;
type PropsDaPorta = SemLigacao<PropsDoProjeto> | SemLigacao<PropsGerais>;

function Porta(props: PropsDaPorta) {
  /* Só depois de montar: no servidor (SSR) a tela desenha o "Abrindo". */
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const podeReplanejar = usePodeReplanejar(props.tarefas);
  const onReplanejar = useReplanejar(props.tarefas);
  return (
    <LimiteDoGantt>
      {montado ? (
        <Suspense fallback={<Carregando />}>
          <GanttConecta
            {...(props as GanttConectaProps)}
            podeReplanejar={podeReplanejar}
            onReplanejar={onReplanejar}
          />
        </Suspense>
      ) : (
        <Carregando />
      )}
    </LimiteDoGantt>
  );
}

/** A aba Gantt de um projeto: só as tarefas dele. */
export function GanttDoProjeto(props: Omit<SemLigacao<PropsDoProjeto>, "modo">) {
  return <Porta {...props} modo="projeto" />;
}

/** A visão geral: todos os projetos, cada um com as suas tarefas embaixo. */
export function GanttGeral(props: Omit<SemLigacao<PropsGerais>, "modo">) {
  return <Porta {...props} modo="geral" />;
}
