import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { CornerDownRight, Loader2, MessageCircle, SendHorizontal, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { confirmar } from "@/components/confirm-dialog";
import { EscolherEmoji, ListaDeQuemReagiu } from "@/components/reacoes-da-tarefa";
import { TextoDoPost } from "@/components/mural/texto-do-post";
import { mencionadosNoTexto, useMencoes } from "@/components/mural/mencoes";
import { useFluxo } from "@/lib/fluxo-store";
import { formatRelative } from "@/lib/use-theme";
import { lembrarEmoji } from "@/lib/emojis";
import { nomeCurto } from "@/lib/nome-curto";
import { ehErroDeMuralInativo, iniciaisDe, MSG_MURAL_INATIVO } from "@/lib/mural-cliente";
import type { ComentarioDoMural, PostDoMural, ReacaoDoMural } from "@/lib/mural.functions";

/*
 * Os comentários de um post do Mural, repaginados (27/11/2026). Pedido do
 * usuário: "dá pra ficar visualmente mais bonita", com um botão "Reagir" (um
 * emoji no comentário) e um "Responder" que coloca a resposta embaixo da
 * mensagem.
 *
 *   - cada comentário é um balão com o nome curto ("Eduardo Silva", não o
 *     cadastro todo em maiúsculas) e, embaixo, a hora, Reagir, Responder e
 *     Excluir; as reações ficam numa pílula no canto do balão;
 *   - as respostas ficam penduradas na raiz, com a linha da conversa à
 *     esquerda. Só um nível: responder a uma resposta continua na mesma
 *     conversa, com o "@Nome" de quem foi respondido já escrito — é a menção
 *     que avisa a pessoa (a regra do Mural: só avisa quem foi marcado);
 *   - o feed traz as 2 últimas raízes e as 2 últimas respostas de cada; os
 *     "ver mais" buscam a conversa inteira.
 *
 * Tudo aparece na hora e o servidor confirma depois; se ele recusar, volta.
 */

const MAX_COMENTARIO = 1000;

const erroAmigavel = (e: unknown, padrao: string) =>
  ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : (e as Error)?.message || padrao;

/** Os ids vêm do SQL Server em maiúsculas, mas não custa comparar sem caixa. */
const mesmoId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase();

export function ComentariosDoPost({
  post,
  souGerente,
  aoMudar,
}: {
  post: PostDoMural;
  souGerente: boolean;
  aoMudar: (p: PostDoMural) => void;
}) {
  const { currentUser, users } = useFluxo();
  /** A conversa inteira, depois de um "ver mais"; antes disso vale a do feed. */
  const [todos, setTodos] = useState<ComentarioDoMural[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  /** A resposta sendo escrita: em qual conversa (raiz) e para quem. */
  const [respondendo, setRespondendo] = useState<{
    raiz: string;
    alvo: string;
    nome: string;
    inicial: string;
  } | null>(null);

  const lista = todos ?? post.comentarios;

  /* As raízes em ordem, cada uma com as respostas que vieram. Uma resposta cuja
     raiz não veio (conversa cortada no limite) aparece como raiz. */
  const { raizes, respostasDe, escondidasNasConversas } = useMemo(() => {
    const ids = new Set(lista.map((c) => c.id.toUpperCase()));
    const raizes: ComentarioDoMural[] = [];
    const respostasDe = new Map<string, ComentarioDoMural[]>();
    for (const c of lista) {
      const raiz = c.respostaDe?.toUpperCase();
      if (raiz && ids.has(raiz)) {
        const l = respostasDe.get(raiz) ?? [];
        l.push(c);
        respostasDe.set(raiz, l);
      } else raizes.push(c);
    }
    let escondidasNasConversas = 0;
    for (const r of raizes) {
      const vieram = respostasDe.get(r.id.toUpperCase())?.length ?? 0;
      escondidasNasConversas += Math.max(0, r.totalRespostas - vieram);
    }
    return { raizes, respostasDe, escondidasNasConversas };
  }, [lista]);

  /** Comentários antigos que nem a raiz veio (o "ver mais" do alto). */
  const faltamAcima = Math.max(0, post.totalComentarios - lista.length - escondidasNasConversas);

  /** Aplica a mesma mudança à conversa inteira (se aberta) e ao post do feed. */
  const mudar = (f: (l: ComentarioDoMural[]) => ComentarioDoMural[], deltaTotal = 0) => {
    setTodos((t) => (t ? f(t) : t));
    aoMudar({
      ...post,
      comentarios: f(post.comentarios),
      totalComentarios: Math.max(0, post.totalComentarios + deltaTotal),
    });
  };

  const verTodos = async () => {
    if (carregando) return;
    setCarregando(true);
    try {
      const { comentariosDoPost } = await import("@/lib/mural.functions");
      const r = await comentariosDoPost({ data: { postId: post.id } });
      setTodos(r.comentarios);
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível carregar os comentários."));
    } finally {
      setCarregando(false);
    }
  };

  /** Comenta no post (`alvo` null) ou responde a um comentário. */
  const enviar = async (texto: string, alvo: string | null): Promise<boolean> => {
    try {
      const { comentarNoPost } = await import("@/lib/mural.functions");
      const c = await comentarNoPost({
        data: {
          postId: post.id,
          texto,
          mencoes: mencionadosNoTexto(texto, users),
          respostaDe: alvo,
        },
      });
      mudar((l) => {
        const nova = [...l, c];
        return c.respostaDe
          ? nova.map((x) =>
              mesmoId(x.id, c.respostaDe) ? { ...x, totalRespostas: x.totalRespostas + 1 } : x,
            )
          : nova;
      }, 1);
      if (alvo) setRespondendo(null);
      return true;
    } catch (e) {
      toast.error(
        erroAmigavel(e, alvo ? "Não foi possível responder." : "Não foi possível comentar."),
      );
      return false;
    }
  };

  const reagir = async (c: ComentarioDoMural, emoji: string | null) => {
    const antes = c.reacoes;
    const outras = c.reacoes.filter((r) => r.userId !== currentUser.id);
    const depois: ReacaoDoMural[] = emoji ? [...outras, { userId: currentUser.id, emoji }] : outras;
    const trocar = (reacoes: ReacaoDoMural[]) => (l: ComentarioDoMural[]) =>
      l.map((x) => (x.id === c.id ? { ...x, reacoes } : x));
    if (emoji) lembrarEmoji(currentUser.id, emoji);
    mudar(trocar(depois));
    try {
      const { reagirNoComentario } = await import("@/lib/mural.functions");
      await reagirNoComentario({ data: { comentarioId: c.id, emoji } });
    } catch (e) {
      mudar(trocar(antes));
      toast.error(erroAmigavel(e, "Não foi possível reagir."));
    }
  };

  const responder = (c: ComentarioDoMural) => {
    const u = users.find((x) => x.id === c.autorId);
    const nome = u?.name.trim() ?? "";
    setRespondendo({
      raiz: (c.respostaDe ?? c.id).toUpperCase(),
      alvo: c.id,
      nome: nome ? nomeCurto(nome) : "alguém",
      // Responder a alguém já escreve o "@Nome" (é ele que avisa a pessoa).
      inicial: c.autorId !== currentUser.id && nome.length >= 3 ? `@${nome} ` : "",
    });
  };

  const excluir = async (c: ComentarioDoMural) => {
    const raizComRespostas = !c.respostaDe && c.totalRespostas > 0;
    const ok = await confirmar({
      titulo: c.respostaDe ? "Excluir esta resposta?" : "Excluir este comentário?",
      descricao: raizComRespostas
        ? `As ${c.totalRespostas === 1 ? "resposta dele também sai" : `${c.totalRespostas} respostas dele também saem`}.`
        : undefined,
      confirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    try {
      const { excluirComentarioDoMural } = await import("@/lib/mural.functions");
      const r = await excluirComentarioDoMural({ data: { id: c.id } });
      mudar(
        (l) =>
          l
            .filter((x) => x.id !== c.id && !mesmoId(x.respostaDe, c.id))
            .map((x) =>
              mesmoId(x.id, c.respostaDe)
                ? { ...x, totalRespostas: Math.max(0, x.totalRespostas - 1) }
                : x,
            ),
        -(r.removidos ?? 1),
      );
      if (respondendo && (mesmoId(respondendo.raiz, c.id) || mesmoId(respondendo.alvo, c.id)))
        setRespondendo(null);
    } catch (e) {
      toast.error(erroAmigavel(e, "Não foi possível excluir."));
    }
  };

  const item = (c: ComentarioDoMural, resposta: boolean, filhos?: ReactNode) => (
    <ItemDoComentario
      key={c.id}
      c={c}
      resposta={resposta}
      autorDoPost={!post.automatico && c.autorId === post.autorId}
      podeExcluir={c.autorId === currentUser.id || souGerente}
      respondendo={!!respondendo && mesmoId(respondendo.alvo, c.id)}
      aoReagir={(e) => void reagir(c, e)}
      aoResponder={() => responder(c)}
      aoExcluir={() => void excluir(c)}
    >
      {filhos}
    </ItemDoComentario>
  );

  return (
    <section className="-mx-4 -mb-4 mt-3 rounded-b-xl border-t border-border/60 bg-muted/30 px-4 pb-4 pt-3">
      {faltamAcima > 0 && (
        <button
          type="button"
          onClick={() => void verTodos()}
          disabled={carregando}
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-60"
        >
          {carregando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5" />
          )}
          Ver mais {faltamAcima} {faltamAcima === 1 ? "comentário" : "comentários"}
        </button>
      )}

      {raizes.length > 0 && (
        <ul className="space-y-3.5">
          <AnimatePresence initial={false}>
            {raizes.map((r) => {
              const k = r.id.toUpperCase();
              const respostas = respostasDe.get(k) ?? [];
              const escondidas = Math.max(0, r.totalRespostas - respostas.length);
              const aqui = respondendo && respondendo.raiz === k ? respondendo : null;
              const temConversa = respostas.length > 0 || escondidas > 0 || !!aqui;
              return item(
                r,
                false,
                temConversa ? (
                  <div className="mt-2 space-y-2.5 border-l-2 border-primary/20 pl-3">
                    {escondidas > 0 && (
                      <button
                        type="button"
                        onClick={() => void verTodos()}
                        disabled={carregando}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-60"
                      >
                        {carregando ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CornerDownRight className="h-3.5 w-3.5" />
                        )}
                        Ver {escondidas === 1 ? "mais 1 resposta" : `mais ${escondidas} respostas`}
                      </button>
                    )}
                    {respostas.length > 0 && (
                      <ul className="space-y-2.5">
                        <AnimatePresence initial={false}>
                          {respostas.map((x) => item(x, true))}
                        </AnimatePresence>
                      </ul>
                    )}
                    {aqui && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <div className="mb-1 flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground">
                          <CornerDownRight className="h-3 w-3" />
                          Respondendo a{" "}
                          <span className="font-semibold text-foreground/80">{aqui.nome}</span>
                          <button
                            type="button"
                            onClick={() => setRespondendo(null)}
                            aria-label="Cancelar a resposta"
                            className="ml-0.5 rounded-full p-0.5 transition hover:bg-secondary hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        <CampoDeComentario
                          key={aqui.alvo}
                          inicial={aqui.inicial}
                          placeholder={`Responda a ${aqui.nome}…`}
                          aoEnviar={(t) => enviar(t, aqui.alvo)}
                          aoCancelar={() => setRespondendo(null)}
                          focar
                          pequeno
                        />
                      </motion.div>
                    )}
                  </div>
                ) : undefined,
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      <div className={raizes.length > 0 || faltamAcima > 0 ? "mt-4" : ""}>
        <CampoDeComentario
          placeholder="Escreva um comentário… (@ para marcar alguém)"
          aoEnviar={(t) => enviar(t, null)}
        />
      </div>
    </section>
  );
}

/** Um comentário (ou resposta): o balão, a pílula de reações e as ações. */
function ItemDoComentario({
  c,
  resposta,
  autorDoPost,
  podeExcluir,
  respondendo,
  aoReagir,
  aoResponder,
  aoExcluir,
  children,
}: {
  c: ComentarioDoMural;
  resposta: boolean;
  autorDoPost: boolean;
  podeExcluir: boolean;
  respondendo: boolean;
  aoReagir: (emoji: string | null) => void;
  aoResponder: () => void;
  aoExcluir: () => void;
  children?: ReactNode;
}) {
  const { currentUser, users } = useFluxo();
  const u = users.find((x) => x.id === c.autorId);
  const nome = u?.name ?? "Alguém";
  const meu = c.autorId === currentUser.id;
  const minha = c.reacoes.find((r) => r.userId === currentUser.id)?.emoji ?? null;
  const temReacao = c.reacoes.length > 0;
  const pulo = useAnimationControls();

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="group/coment flex gap-2.5"
    >
      <UserAvatar
        nome={nome}
        iniciais={u?.avatar ?? iniciaisDe(nome)}
        className={`shrink-0 shadow-sm ring-2 ring-card ${resposta ? "h-6 w-6 text-[8px]" : "h-8 w-8 text-[10px]"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="relative inline-block max-w-full">
          <div
            className={`rounded-2xl rounded-tl-md px-3.5 py-2 shadow-sm ring-1 transition-colors ${
              meu ? "bg-primary/10 ring-primary/20" : "bg-card ring-border/70"
            } ${respondendo ? "ring-2 ring-primary/50" : ""}`}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="truncate text-[13px] font-semibold leading-tight"
                title={u?.jobTitle ? `${nome} · ${u.jobTitle}` : nome}
              >
                {nomeCurto(nome)}
              </span>
              {autorDoPost && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                  Autor
                </span>
              )}
            </div>
            <TextoDoPost
              texto={c.texto}
              users={users}
              className={`mt-0.5 leading-snug text-foreground/90 ${resposta ? "text-[13px]" : "text-sm"}`}
            />
          </div>
          {temReacao && (
            <span className="absolute -bottom-2.5 right-2">
              <PilulaDeReacoes reacoes={c.reacoes} aoTirarMinha={() => aoReagir(null)} />
            </span>
          )}
        </div>

        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-3 text-[11px] text-muted-foreground ${
            temReacao ? "mt-2" : "mt-1"
          }`}
        >
          <time dateTime={c.em} title={new Date(c.em).toLocaleString("pt-BR")}>
            {formatRelative(c.em)}
          </time>
          <EscolherEmoji
            atual={minha}
            aoEscolher={(e) => {
              if (e === minha) {
                aoReagir(null);
                return;
              }
              aoReagir(e);
              // O mesmo pulo do "Reagir" do post e da tarefa.
              void pulo.start({
                scale: [1, 1.5, 0.9, 1.1, 1],
                rotate: [0, -12, 10, 0],
                transition: { duration: 0.5 },
              });
            }}
          >
            <motion.button
              type="button"
              animate={pulo}
              whileHover={{ rotate: [0, -8, 8, -4, 0], transition: { duration: 0.45 } }}
              whileTap={{ scale: 0.85 }}
              className={`inline-flex origin-center items-center gap-1 font-semibold transition-colors ${
                minha ? "text-primary" : "hover:text-foreground"
              }`}
            >
              {minha && <span className="text-[13px] leading-none">{minha}</span>}
              {minha ? "Reagiu" : "Reagir"}
            </motion.button>
          </EscolherEmoji>
          <button
            type="button"
            onClick={aoResponder}
            className={`font-semibold transition-colors ${respondendo ? "text-primary" : "hover:text-foreground"}`}
          >
            Responder
          </button>
          {podeExcluir && (
            <button
              type="button"
              onClick={aoExcluir}
              className="font-semibold opacity-0 transition hover:text-destructive focus:opacity-100 group-hover/coment:opacity-100"
            >
              Excluir
            </button>
          )}
        </div>

        {children}
      </div>
    </motion.li>
  );
}

/** A pílula no canto do balão: os emojis mais usados e, se mais de um, o total. */
function PilulaDeReacoes({
  reacoes,
  aoTirarMinha,
}: {
  reacoes: ReacaoDoMural[];
  aoTirarMinha: () => void;
}) {
  const { currentUser, users } = useFluxo();
  const minha = reacoes.find((r) => r.userId === currentUser.id)?.emoji ?? null;
  const lista = useMemo(() => {
    const porId = new Map(users.map((u) => [u.id, u]));
    const eu = reacoes.filter((r) => r.userId === currentUser.id);
    const outros = reacoes.filter((r) => r.userId !== currentUser.id);
    return [...eu, ...outros].map((r) => ({ ...r, user: porId.get(r.userId) }));
  }, [reacoes, users, currentUser.id]);
  const topo = useMemo(() => {
    const conta = new Map<string, number>();
    for (const r of reacoes) conta.set(r.emoji, (conta.get(r.emoji) ?? 0) + 1);
    return [...conta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([e]) => e);
  }, [reacoes]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <motion.button
          type="button"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 18 }}
          title="Ver quem reagiu"
          className="flex h-5 items-center gap-0.5 rounded-full bg-card pl-0.5 pr-1.5 text-[11px] font-semibold text-muted-foreground shadow-sm ring-1 ring-border transition hover:ring-primary/50"
        >
          <span className="flex -space-x-0.5">
            {topo.map((e) => (
              <span key={e} className="grid h-4 w-4 place-items-center text-[12px] leading-none">
                {e}
              </span>
            ))}
          </span>
          {lista.length > 1 && <span className="pl-0.5">{lista.length}</span>}
        </motion.button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="z-[460] w-64 rounded-xl p-0">
        <ListaDeQuemReagiu
          lista={lista}
          topo={topo}
          ehEu={(r) => r.userId === currentUser.id}
          minha={minha}
          aoTirarMinha={aoTirarMinha}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * O campo de escrever — o do post e o da resposta. Tem o "@" para marcar, o
 * botão de emoji (entra no texto, onde está o cursor) e o enviar, que só
 * acende com texto. Enter envia; Esc cancela a resposta.
 */
function CampoDeComentario({
  inicial = "",
  placeholder,
  aoEnviar,
  aoCancelar,
  focar = false,
  pequeno = false,
}: {
  inicial?: string;
  placeholder: string;
  /** Devolve true quando gravou (aí o campo limpa). */
  aoEnviar: (texto: string) => Promise<boolean>;
  aoCancelar?: () => void;
  focar?: boolean;
  pequeno?: boolean;
}) {
  const { currentUser } = useFluxo();
  const [texto, setTexto] = useState(inicial);
  const [enviando, setEnviando] = useState(false);
  const mencoes = useMencoes<HTMLInputElement>({
    texto,
    setTexto,
    max: MAX_COMENTARIO,
    paraCima: true,
  });

  useEffect(() => {
    if (!focar) return;
    const c = mencoes.campoRef.current;
    if (!c) return;
    c.focus();
    c.setSelectionRange(c.value.length, c.value.length);
    // Só ao abrir: depois o cursor é de quem está escrevendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      if (await aoEnviar(t)) setTexto("");
    } finally {
      setEnviando(false);
    }
  };

  const porEmoji = (e: string) => {
    const c = mencoes.campoRef.current;
    const ini = c?.selectionStart ?? texto.length;
    const fim = c?.selectionEnd ?? texto.length;
    setTexto((texto.slice(0, ini) + e + texto.slice(fim)).slice(0, MAX_COMENTARIO));
    const pos = ini + e.length;
    requestAnimationFrame(() => {
      c?.focus();
      c?.setSelectionRange(pos, pos);
    });
  };

  const temTexto = texto.trim().length > 0;

  return (
    <div className="flex items-center gap-2.5">
      <UserAvatar
        nome={currentUser.name}
        iniciais={currentUser.avatar}
        className={`shrink-0 shadow-sm ring-2 ring-card ${pequeno ? "h-6 w-6 text-[8px]" : "h-8 w-8 text-[10px]"}`}
      />
      <div className="relative flex min-w-0 flex-1 items-center gap-0.5 rounded-full border border-border bg-card pr-1 shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
        <input
          ref={mencoes.campoRef}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value.slice(0, MAX_COMENTARIO));
            mencoes.aoMudar(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (mencoes.aoTeclar(e)) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            } else if (e.key === "Escape" && aoCancelar) {
              e.preventDefault();
              aoCancelar();
            }
          }}
          onBlur={mencoes.fechar}
          placeholder={placeholder}
          className={`min-w-0 flex-1 bg-transparent px-3.5 focus:outline-none ${
            pequeno ? "py-1.5 text-[13px]" : "py-2 text-sm"
          }`}
        />
        {mencoes.lista}
        <EscolherEmoji atual={null} aoEscolher={porEmoji} align="end">
          <button
            type="button"
            aria-label="Pôr um emoji"
            title="Emoji"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Smile className="h-4 w-4" />
          </button>
        </EscolherEmoji>
        <motion.button
          type="button"
          onClick={() => void enviar()}
          disabled={!temTexto || enviando}
          aria-label={aoCancelar ? "Enviar resposta" : "Enviar comentário"}
          whileTap={{ scale: 0.88 }}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
            temTexto
              ? "bg-primary text-primary-foreground shadow-sm hover:brightness-110"
              : "text-muted-foreground/60"
          }`}
        >
          {enviando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <SendHorizontal className="h-3.5 w-3.5" />
          )}
        </motion.button>
      </div>
    </div>
  );
}
