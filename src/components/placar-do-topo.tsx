import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import {
  scoreBarColor,
  scoreBgClass,
  scoreTextClass,
  userScorePct,
  type PeriodoDoPlacar,
} from "@/lib/score";

/* O placar do topo: foto, nome, barra e a porcentagem.

   Passar o mouse abre, logo abaixo, a escolha do período que a porcentagem
   conta — hoje, esta semana ou este mês —, com o placar de cada um ao lado,
   para comparar antes de escolher. A escolha fica guardada neste computador,
   por pessoa: vale nos próximos dias, e quem entra na mesma máquina com outro
   login tem a sua.
   Antes era sempre o mês, e o número do dia a dia não aparecia em lugar
   nenhum. */

const PERIODOS: { v: PeriodoDoPlacar; rotulo: string; curto: string; doPeriodo: string }[] = [
  { v: "dia", rotulo: "Hoje", curto: "hoje", doPeriodo: "de hoje" },
  { v: "semana", rotulo: "Esta semana", curto: "semana", doPeriodo: "da semana" },
  { v: "mes", rotulo: "Este mês", curto: "mês", doPeriodo: "do mês" },
];

const chave = (pessoaId: string) => `fluxo:placar-periodo:${pessoaId}`;
const MOLA = { type: "spring", stiffness: 520, damping: 34 } as const;

function lerPeriodo(pessoaId: string): PeriodoDoPlacar {
  if (typeof window === "undefined") return "mes";
  try {
    const v = window.localStorage.getItem(chave(pessoaId));
    return v === "dia" || v === "semana" || v === "mes" ? v : "mes";
  } catch {
    return "mes";
  }
}

/** A barra: nunca some de todo quando há tarefa, para a cor dizer algo. */
const larguraDaBarra = (pct: number, assigned: number) =>
  `${Math.min(100, Math.max(assigned === 0 ? 0 : 6, pct))}%`;

/** O número desliza até o novo valor em vez de trocar de repente. */
function Porcentagem({ valor, vazio }: { valor: number; vazio: boolean }) {
  const mv = useMotionValue(valor);
  const texto = useTransform(mv, (v) => `${Math.round(v)}%`);
  useEffect(() => {
    const a = animate(mv, valor, { duration: 0.6, ease: [0.22, 1, 0.36, 1] });
    return () => a.stop();
  }, [mv, valor]);
  if (vazio) return <span>—</span>;
  return <motion.span className="tabular-nums">{texto}</motion.span>;
}

export function PlacarDoTopo() {
  const { currentUser, tasks, completions } = useFluxo();
  const [periodo, setPeriodo] = useState<PeriodoDoPlacar>(() => lerPeriodo(currentUser.id));
  // Trocou de login sem recarregar a página: vale a escolha de quem entrou.
  useEffect(() => setPeriodo(lerPeriodo(currentUser.id)), [currentUser.id]);
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const espera = useRef<number | undefined>(undefined);

  const placares = useMemo(() => {
    const agora = new Date();
    return Object.fromEntries(
      PERIODOS.map((p) => [p.v, userScorePct(currentUser.id, tasks, completions, agora, p.v)]),
    ) as Record<PeriodoDoPlacar, ReturnType<typeof userScorePct>>;
  }, [currentUser.id, tasks, completions]);
  const atual = placares[periodo];
  const info = PERIODOS.find((p) => p.v === periodo)!;

  const escolher = (v: PeriodoDoPlacar) => {
    setPeriodo(v);
    try {
      window.localStorage.setItem(chave(currentUser.id), v);
    } catch {
      /* navegador sem armazenamento: vale só nesta sessão */
    }
  };

  /* Abre com um instante de atraso, para não piscar quando o mouse só passa
     por cima a caminho de outro lugar; fecha com outro, para dar tempo de
     descer até as opções. */
  const agendar = (abrir: boolean) => {
    window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => setAberto(abrir), abrir ? 90 : 160);
  };
  useEffect(() => () => window.clearTimeout(espera.current), []);

  // No toque não há "sair com o mouse": toque fora fecha.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);

  return (
    <div
      ref={raiz}
      className="relative hidden sm:block"
      onMouseEnter={() => agendar(true)}
      onMouseLeave={() => agendar(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setAberto(false);
      }}
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-label={`Placar ${info.doPeriodo}: ${atual.done} de ${atual.assigned} tarefas. Escolher o período.`}
        className={`flex items-center gap-2 rounded-full border py-0.5 pl-0.5 pr-1 text-xs transition-colors ${
          aberto
            ? "border-primary/40 bg-secondary"
            : "border-border bg-secondary/50 hover:bg-secondary"
        }`}
      >
        <UserAvatar
          nome={currentUser.name}
          iniciais={currentUser.avatar}
          className="h-6 w-6 text-[10px]"
        />
        <span className="font-medium">{currentUser.name.split(" ")[0]}</span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-foreground/10">
          <motion.div
            className="h-full rounded-full"
            initial={false}
            animate={{
              width: larguraDaBarra(atual.pct, atual.assigned),
              backgroundColor: scoreBarColor(atual.pct, atual.assigned),
            }}
            transition={MOLA}
          />
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-1 text-[10px] font-semibold ${scoreBgClass(atual.pct, atual.assigned)}`}
        >
          {/* O troféu dá uma balançada a cada troca de período. */}
          <motion.span
            key={periodo}
            className="inline-flex"
            initial={{ rotate: 0, scale: 1 }}
            animate={{ rotate: [0, -18, 14, -6, 0], scale: [1, 1.25, 1] }}
            transition={{ duration: 0.5 }}
          >
            <Trophy className="h-2.5 w-2.5" />
          </motion.span>
          <Porcentagem valor={atual.pct} vazio={atual.assigned === 0} />
          <span className="relative overflow-hidden rounded-full bg-background/60 px-1 text-[9px] font-medium uppercase tracking-wide opacity-80">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={periodo}
                className="inline-block"
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={MOLA}
              >
                {info.curto}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            role="radiogroup"
            aria-label="Período do placar"
            initial={{ opacity: 0, y: -6, scale: 0.94, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 0.97, filter: "blur(2px)" }}
            transition={MOLA}
            style={{ originX: 1, originY: 0 }}
            /* A ponte invisível (`before`) cobre o vão entre a pílula e o
               painel: sem ela o mouse "saía" no caminho e o painel fechava. */
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl before:absolute before:inset-x-0 before:-top-2.5 before:h-2.5"
          >
            <div className="px-2 pb-1.5 pt-1">
              <div className="text-[11px] font-semibold">O que a porcentagem conta</div>
              <div className="text-[10px] text-muted-foreground">
                Tarefas com prazo no período · no prazo vale 1, atrasada ½
              </div>
            </div>
            {PERIODOS.map((p, i) => {
              const s = placares[p.v];
              const ativo = p.v === periodo;
              return (
                <motion.button
                  key={p.v}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => escolher(p.v)}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...MOLA, delay: 0.035 * i }}
                  whileTap={{ scale: 0.97 }}
                  className="relative block w-full rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {/* O destaque desliza de uma opção para a outra. */}
                  {ativo && (
                    <motion.span
                      layoutId="placar-periodo-destaque"
                      className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-primary/30"
                      transition={MOLA}
                    />
                  )}
                  <span className="relative flex items-center justify-between gap-2">
                    <span className={`text-xs ${ativo ? "font-semibold" : "font-medium"}`}>
                      {p.rotulo}
                    </span>
                    <span
                      className={`text-xs font-semibold tabular-nums ${scoreTextClass(s.pct, s.assigned)}`}
                    >
                      {s.assigned === 0 ? "—" : `${Math.round(s.pct)}%`}
                    </span>
                  </span>
                  <span className="relative mt-1 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
                      <motion.span
                        className="block h-full rounded-full"
                        style={{ background: scoreBarColor(s.pct, s.assigned) }}
                        initial={{ width: 0 }}
                        animate={{ width: larguraDaBarra(s.pct, s.assigned) }}
                        transition={{ ...MOLA, delay: 0.08 + 0.05 * i }}
                      />
                    </span>
                    <span className="w-16 text-right text-[10px] text-muted-foreground tabular-nums">
                      {s.assigned === 0 ? "sem prazos" : `${s.done} de ${s.assigned}`}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
