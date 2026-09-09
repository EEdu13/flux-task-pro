import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { AlarmClock, ArrowRight, CalendarX2, X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { TravaScroll } from "@/components/trava-scroll";

/**
 * A cobrança da entrada: o que já venceu e continua aberto.
 *
 * Existe porque a sineta não cobra. Uma tarefa que venceu ontem vira mais um
 * número num contador que a pessoa aprendeu a ignorar — e o aviso de prazo
 * (`tipo='prazo'`) nasce uma vez só, no login, e some no meio da lista. Isto
 * aqui interrompe: abre por cima, diz quantos dias, e sai do caminho.
 *
 * Uma vez por dia, não uma vez por abertura. O app fica aberto o dia inteiro e
 * o Tauri o restaura da bandeja o tempo todo; cobrar a cada volta ensinaria a
 * fechar sem ler, que é o oposto do que a janela serve.
 */

const CHAVE_VISTO = "fluxo:atrasadas-visto";

/** Hoje à meia-noite LOCAL. Comparar com ISO cru erra o dia por fuso. */
function hojeLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `YYYY-MM-DD` do dia local — a marca de "já cobrei hoje". */
function diaLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Dias inteiros de atraso. O prazo também vai para a meia-noite local antes da
 * conta: sem isso, uma tarefa das 18h de ontem e outra das 8h de ontem dariam
 * números diferentes de dias, sendo que as duas venceram no mesmo dia.
 */
function diasDeAtraso(prazoIso: string): number {
  const prazo = new Date(prazoIso);
  if (Number.isNaN(prazo.getTime())) return 0;
  prazo.setHours(0, 0, 0, 0);
  return Math.round((hojeLocal().getTime() - prazo.getTime()) / 86_400_000);
}

const CORES_PRIORIDADE: Record<string, string> = {
  alta: "bg-destructive/15 text-destructive",
  media: "bg-warning/15 text-warning",
  baixa: "bg-muted text-muted-foreground",
};

const ROTULO_PRIORIDADE: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export function TarefasAtrasadas() {
  const { tasks, currentUser, isAuthenticated, openTask } = useFluxo();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  // Uma avaliação por sessão do app: depois de decidir, não reabre sozinho
  // quando a lista de tarefas se atualizar por sincronização.
  const jaAvaliou = useRef(false);

  const atrasadas = useMemo(() => {
    if (!currentUser.id) return [];
    const hoje = hojeLocal().getTime();
    return tasks
      .filter((t) => {
        if (t.assigneeId !== currentUser.id) return false;
        if (t.status === "concluida") return false;
        const prazo = new Date(t.dueDate);
        if (Number.isNaN(prazo.getTime())) return false;
        prazo.setHours(0, 0, 0, 0);
        return prazo.getTime() < hoje;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks, currentUser.id]);

  useEffect(() => {
    if (jaAvaliou.current) return;
    if (!isAuthenticated || !currentUser.id) return;
    // As tarefas chegam depois do login. Enquanto a lista está vazia não dá
    // para concluir que não há atrasadas — só que ainda não sabemos.
    if (tasks.length === 0) return;

    jaAvaliou.current = true;
    if (atrasadas.length === 0) return;

    try {
      if (window.localStorage.getItem(CHAVE_VISTO) === diaLocal()) return;
    } catch {
      /* navegador sem armazenamento: cobra assim mesmo, é o lado seguro */
    }
    setAberto(true);
  }, [isAuthenticated, currentUser.id, tasks.length, atrasadas.length]);

  const fechar = () => {
    setAberto(false);
    try {
      window.localStorage.setItem(CHAVE_VISTO, diaLocal());
    } catch {
      /* ignore */
    }
  };

  const abrirTarefa = (id: string) => {
    fechar();
    openTask(id);
  };

  const ontem = atrasadas.filter((t) => diasDeAtraso(t.dueDate) === 1);
  const antes = atrasadas.filter((t) => diasDeAtraso(t.dueDate) > 1);

  return (
    <AnimatePresence>
      {aberto && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur"
          onClick={fechar}
        >
          <TravaScroll />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[min(80vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl"
          >
            <div className="flex items-start gap-3 border-b border-border bg-destructive/10 px-5 py-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlarmClock className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">
                  {atrasadas.length === 1
                    ? "Você tem 1 tarefa atrasada"
                    : `Você tem ${atrasadas.length} tarefas atrasadas`}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  O prazo passou e elas continuam abertas. Resolva ou reagende.
                </p>
              </div>
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <Grupo titulo="Venceram ontem" tarefas={ontem} aoAbrir={abrirTarefa} />
              <Grupo titulo="Atrasadas há mais tempo" tarefas={antes} aoAbrir={abrirTarefa} />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={fechar}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                Depois
              </button>
              <button
                type="button"
                onClick={() => {
                  fechar();
                  void navigate({ to: "/minhas-tarefas" });
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:brightness-110"
              >
                Ver minhas tarefas
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Grupo({
  titulo,
  tarefas,
  aoAbrir,
}: {
  titulo: string;
  tarefas: { id: string; title: string; dueDate: string; priority: string }[];
  aoAbrir: (id: string) => void;
}) {
  if (tarefas.length === 0) return null;
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {tarefas.map((t) => {
          const dias = diasDeAtraso(t.dueDate);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => aoAbrir(t.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-secondary"
              >
                <CalendarX2 className="h-4 w-4 shrink-0 text-destructive/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {dias === 1 ? "1 dia de atraso" : `${dias} dias de atraso`}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    CORES_PRIORIDADE[t.priority] ?? CORES_PRIORIDADE.baixa
                  }`}
                >
                  {ROTULO_PRIORIDADE[t.priority] ?? t.priority}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
