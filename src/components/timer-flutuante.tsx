import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Pause, Play, Square } from "lucide-react";
import { useTaskTimer } from "@/lib/task-timer";
import { useFluxo } from "@/lib/fluxo-store";
import { formatHMS } from "@/lib/time-log";

/**
 * O cronômetro que segue você pelo app.
 *
 * O crachá de tempo é desenhado DENTRO do cartão da tarefa. Sair da aba onde
 * aquele cartão aparece leva o crachá junto — e some da tela a única prova de
 * que algo está sendo contado. A contagem continua (o provider vive na raiz,
 * fora da troca de rota, e o tempo é diferença de relógio, não soma de tiques),
 * mas quem está olhando não tem como saber disso.
 *
 * Este painel resolve pelo lado certo: em vez de pedir para a pessoa confiar,
 * mostra. Fica fixo na tela, aparece só quando há algo rodando, e pode ser
 * arrastado para onde não atrapalhe — o canto que serve numa tela cheia de
 * cartões não é o mesmo que serve no quadro.
 */

const CHAVE_POSICAO = "fluxo:timer-flutuante-pos";
const LARGURA = 232;
const ALTURA = 44;

type Posicao = { x: number; y: number };

/** Mantém o painel dentro da janela, inclusive depois de ela ser redimensionada. */
function dentroDaTela(p: Posicao): Posicao {
  if (typeof window === "undefined") return p;
  return {
    x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - LARGURA - 8)),
    y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - ALTURA - 8)),
  };
}

function posicaoInicial(): Posicao {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  try {
    const bruto = window.localStorage.getItem(CHAVE_POSICAO);
    if (bruto) {
      const p = JSON.parse(bruto) as Posicao;
      if (typeof p?.x === "number" && typeof p?.y === "number") return dentroDaTela(p);
    }
  } catch {
    /* localStorage bloqueado ou valor corrompido: cai no padrão */
  }
  /* Padrão no canto inferior ESQUERDO: o direito já tem o botão de acesso
     rápido e a bolha do chat, e nascer em cima deles seria começar atrapalhando. */
  return dentroDaTela({ x: 24, y: window.innerHeight - ALTURA - 24 });
}

export function TimerFlutuante() {
  const { activeTaskId, paused, elapsedActive, pause, play, stop } = useTaskTimer();
  const { tasks, openTask } = useFluxo();
  const [pos, setPos] = useState<Posicao>(posicaoInicial);
  const [arrastando, setArrastando] = useState(false);
  // Distância entre o ponteiro e o canto do painel, para ele não "pular" ao pegar.
  const pegadaRef = useRef<Posicao>({ x: 0, y: 0 });

  const tarefa = tasks.find((t) => t.id === activeTaskId);

  // Redimensionar a janela pode deixar o painel fora do campo de visão.
  useEffect(() => {
    const aoRedimensionar = () => setPos((p) => dentroDaTela(p));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);

  /* Os ouvintes ficam na JANELA, não no painel: com o ponteiro correndo mais
     rápido que o repintar, ele sai de cima do elemento e os eventos parariam de
     chegar no meio do arrasto. */
  useEffect(() => {
    if (!arrastando) return;
    const mover = (e: PointerEvent) => {
      setPos(dentroDaTela({ x: e.clientX - pegadaRef.current.x, y: e.clientY - pegadaRef.current.y }));
    };
    const soltar = () => setArrastando(false);
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [arrastando]);

  // Grava só ao SOLTAR: gravar a cada pixel encheria o localStorage de escrita.
  useEffect(() => {
    if (arrastando) return;
    try {
      window.localStorage.setItem(CHAVE_POSICAO, JSON.stringify(pos));
    } catch {
      /* sem localStorage o painel só não lembra da posição */
    }
  }, [arrastando, pos]);

  const pegar = useCallback(
    (e: React.PointerEvent) => {
      pegadaRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      setArrastando(true);
    },
    [pos],
  );

  if (!activeTaskId) return null;

  return (
    <div
      style={{ left: pos.x, top: pos.y, width: LARGURA }}
      className={`fixed z-50 flex items-center gap-1 rounded-lg border py-1 pl-1 pr-1.5 shadow-lg backdrop-blur ${
        paused
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-emerald-500/50 bg-emerald-500/10"
      } ${arrastando ? "cursor-grabbing" : ""}`}
    >
      {/* Só esta alça arrasta. O painel inteiro sendo pegável faria o clique em
          pausar virar um micro-arrasto sempre que a mão tremesse. */}
      <button
        type="button"
        onPointerDown={pegar}
        aria-label="Mover o cronômetro"
        title="Arraste para onde preferir"
        className="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          paused ? "bg-amber-500" : "animate-pulse bg-emerald-500"
        }`}
      />

      <button
        type="button"
        onClick={() => activeTaskId && openTask(activeTaskId)}
        title={tarefa?.title ?? "Abrir tarefa"}
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span className="w-full truncate text-[11px] font-medium leading-tight">
          {tarefa?.title ?? "Tarefa"}
        </span>
        <span className="font-mono text-[11px] leading-tight tabular-nums text-muted-foreground">
          {formatHMS(elapsedActive)}
        </span>
      </button>

      <button
        type="button"
        onClick={() => (paused ? play(activeTaskId) : pause())}
        title={paused ? "Retomar" : "Pausar"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-foreground/10"
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={stop}
        title="Parar e registrar"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-destructive/15 hover:text-destructive"
      >
        <Square className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
