import { useMemo, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { Plus, SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { CATEGORIAS_DE_EMOJI, emojisRapidos, lembrarEmoji } from "@/lib/emojis";
import type { Task, User } from "@/lib/fluxo-types";

/**
 * As reações de uma tarefa — o "visto" de quem recebeu, com cara de rede
 * social (pedidos do usuário, 08/10/2026): o botão "Reagir" que se mexe, os
 * emojis empilhados, as fotinhas e os nomes ("Paulo, Ana e mais 2"), e a
 * lista completa de quem reagiu ao clicar no resumo.
 *
 * Uma reação por pessoa: tocar no mesmo emoji tira, em outro troca.
 *
 * Vive dentro de cartões clicáveis e arrastáveis: todo clique para aqui, para
 * não abrir a tarefa nem começar um arraste.
 */
export function ReacoesDaTarefa({ task, compacto = false }: { task: Task; compacto?: boolean }) {
  const { currentUser, users, reactToTask } = useFluxo();
  const reacoes = task.reactions ?? [];
  const minha = reacoes.find((r) => r.userId === currentUser.id)?.emoji ?? null;
  const pulo = useAnimationControls();

  /* Eu primeiro, como no Facebook ("Você, Paulo e mais 2"); os outros na
     ordem em que chegaram. */
  const lista = useMemo(() => {
    const porId = new Map(users.map((u) => [u.id, u]));
    const eu = reacoes.filter((r) => r.userId === currentUser.id);
    const outros = reacoes.filter((r) => r.userId !== currentUser.id);
    return [...eu, ...outros].map((r) => ({ ...r, user: porId.get(r.userId) }));
  }, [reacoes, users, currentUser.id]);

  // Os emojis mais usados nesta tarefa, até três, para a pilha.
  const topo = useMemo(() => {
    const conta = new Map<string, number>();
    for (const r of reacoes) conta.set(r.emoji, (conta.get(r.emoji) ?? 0) + 1);
    return [...conta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e);
  }, [reacoes]);

  const nome = (r: { userId: string; user?: User }) =>
    r.userId === currentUser.id ? "Você" : (r.user?.name.split(" ")[0] ?? "Alguém");

  const resumo = useMemo(() => {
    const nomes = lista.map(nome);
    if (nomes.length <= 3) {
      return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
    }
    return `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista]);

  const reagir = (emoji: string) => {
    if (emoji === minha) {
      reactToTask(task.id, null);
      return;
    }
    lembrarEmoji(currentUser.id, emoji);
    reactToTask(task.id, emoji);
    void pulo.start({ scale: [1, 1.5, 0.9, 1.1, 1], rotate: [0, -12, 10, 0] , transition: { duration: 0.5 } });
  };

  const parar = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      onClick={parar}
      onPointerDown={parar}
      onMouseDown={parar}
      onDoubleClick={parar}
      draggable={false}
    >
      <SeletorDeReacao
        atual={minha}
        aoEscolher={reagir}
        compacto={compacto}
        pessoaId={currentUser.id}
        pulo={pulo}
      />
      <AnimatePresence initial={false}>
        {lista.length > 0 && (
          <motion.div
            key="resumo"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className="min-w-0"
          >
            <QuemReagiu
              lista={lista}
              topo={topo}
              resumo={resumo}
              nome={nome}
              compacto={compacto}
              minha={minha}
              aoTirarMinha={() => reactToTask(task.id, null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Item = { userId: string; emoji: string; user?: User };

/** O resumo (emojis + fotinhas + nomes) que abre a lista de quem reagiu. */
function QuemReagiu({
  lista,
  topo,
  resumo,
  nome,
  compacto,
  minha,
  aoTirarMinha,
}: {
  lista: Item[];
  topo: string[];
  resumo: string;
  nome: (r: Item) => string;
  compacto: boolean;
  minha: string | null;
  aoTirarMinha: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Ver quem reagiu"
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-1 pr-2 transition hover:border-primary/50 hover:bg-secondary/60"
        >
          {/* Os emojis empilhados, como os ícones de reação do Facebook. */}
          <span className="flex shrink-0 -space-x-1">
            {topo.map((e, i) => (
              <motion.span
                key={e}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 15, delay: i * 0.05 }}
                className={`grid place-items-center rounded-full bg-card ring-2 ring-card ${
                  compacto ? "h-5 w-5 text-sm" : "h-6 w-6 text-base"
                }`}
                style={{ zIndex: 3 - i }}
              >
                {e}
              </motion.span>
            ))}
          </span>
          {/* As fotinhas dos três primeiros. */}
          <span className="flex shrink-0 -space-x-1.5">
            {lista.slice(0, 3).map((r) => (
              <UserAvatar
                key={r.userId}
                nome={r.user?.name ?? ""}
                iniciais={r.user?.avatar ?? ""}
                className={`ring-2 ring-card ${compacto ? "h-4 w-4 text-[7px]" : "h-5 w-5 text-[8px]"}`}
              />
            ))}
          </span>
          <span
            className={`min-w-0 truncate font-medium text-foreground/80 ${compacto ? "max-w-28 text-[11px]" : "max-w-48 text-xs"}`}
          >
            {resumo}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="z-[460] w-64 rounded-xl p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">
            {lista.length} {lista.length === 1 ? "reação" : "reações"}
          </span>
          <span className="flex gap-0.5 text-base">{topo.join("")}</span>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {lista.map((r) => (
            <li key={r.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/60">
              <UserAvatar
                nome={r.user?.name ?? ""}
                iniciais={r.user?.avatar ?? ""}
                className="h-7 w-7 text-[10px]"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{nome(r) === "Você" ? "Você" : (r.user?.name ?? "Alguém")}</div>
                {r.user?.jobTitle && nome(r) !== "Você" && (
                  <div className="truncate text-[10px] text-muted-foreground">{r.user.jobTitle}</div>
                )}
              </div>
              <span className="text-xl">{r.emoji}</span>
            </li>
          ))}
        </ul>
        {minha && (
          <button
            type="button"
            onClick={aoTirarMinha}
            className="w-full border-t border-border px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            Tirar a minha reação
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SeletorDeReacao({
  atual,
  aoEscolher,
  compacto,
  pessoaId,
  pulo,
}: {
  atual: string | null;
  aoEscolher: (emoji: string) => void;
  compacto: boolean;
  pessoaId: string;
  pulo: ReturnType<typeof useAnimationControls>;
}) {
  const [aberto, setAberto] = useState(false);
  const [todos, setTodos] = useState(false);
  // Relidos a cada abertura: o que foi usado agora há pouco já vem na frente.
  const rapidos = useMemo(() => (aberto ? emojisRapidos(pessoaId) : []), [aberto, pessoaId]);

  const escolher = (e: string) => {
    aoEscolher(e);
    setAberto(false);
    setTodos(false);
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setTodos(false);
      }}
    >
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          animate={pulo}
          whileHover={{ rotate: [0, -8, 8, -4, 0], transition: { duration: 0.45 } }}
          whileTap={{ scale: 0.88 }}
          title={atual ? "Trocar a reação" : "Reagir"}
          aria-label="Reagir à tarefa"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold transition-colors ${
            compacto ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs"
          } ${
            atual
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-primary"
          }`}
        >
          {atual ? (
            <span className={compacto ? "text-sm leading-none" : "text-base leading-none"}>{atual}</span>
          ) : (
            <SmilePlus className={compacto ? "h-3.5 w-3.5" : "h-4 w-4"} />
          )}
          {atual ? "Reagiu" : "Reagir"}
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="z-[460] w-auto max-w-[19rem] rounded-2xl p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-0.5">
          {rapidos.map((e, i) => (
            <motion.div
              key={e}
              initial={{ y: 12, opacity: 0, scale: 0.5 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 20, delay: i * 0.03 }}
            >
              <BotaoEmoji emoji={e} marcado={e === atual} aoClicar={() => escolher(e)} grande />
            </motion.div>
          ))}
          <button
            type="button"
            onClick={() => setTodos((v) => !v)}
            title="Todos os emojis"
            aria-label="Todos os emojis"
            className={`grid h-9 w-9 place-items-center rounded-full transition ${
              todos ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {todos && (
          <div className="mt-1.5 max-h-64 overflow-y-auto border-t border-border pt-1.5">
            {CATEGORIAS_DE_EMOJI.map((c) => (
              <div key={c.nome} className="mb-1.5">
                <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {c.nome}
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {c.emojis.map((e) => (
                    <BotaoEmoji key={`${c.nome}${e}`} emoji={e} marcado={e === atual} aoClicar={() => escolher(e)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function BotaoEmoji({
  emoji,
  marcado,
  aoClicar,
  grande = false,
}: {
  emoji: string;
  marcado: boolean;
  aoClicar: () => void;
  grande?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={`grid place-items-center rounded-full transition hover:-translate-y-1 hover:scale-125 hover:bg-secondary ${
        grande ? "h-9 w-9 text-2xl" : "h-8 w-8 text-lg"
      } ${marcado ? "bg-primary/20 ring-1 ring-primary" : ""}`}
    >
      {emoji}
    </button>
  );
}
