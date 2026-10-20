import { useEffect, useMemo, useState } from "react";
import { Check, HeartHandshake, Loader2, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { normalizarNome } from "@/lib/aniversario-hoje";
import { avisarMuralPublicado, ehErroDeMuralInativo, MSG_MURAL_INATIVO } from "@/lib/mural-cliente";

/*
 * "Agradecer alguém" (Mural, fase 2 — 14/10/2026): um elogio público. Escolhe
 * a(s) pessoa(s), opcionalmente a tarefa que motivou ("pela entrega de 'X'"),
 * escreve a mensagem — e vira um cartão no Mural; quem foi agradecido recebe
 * um aviso na sineta.
 *
 * Abre de dois lugares: o compositor do Mural e a tarefa (menu do botão
 * direito e a janela da tarefa). Para a tarefa não precisar montar nada, a
 * janela mora uma vez só na raiz (`PortaDoAgradecer`, em GlobaisDoApp) e é
 * chamada por evento: `abrirAgradecer({ pessoas, tarefaId })`.
 */

const EVENTO_ABRIR = "fluxo:agradecer";
const MAX_PESSOAS = 10;
const MAX_MENSAGEM = 1000;
const SUGESTOES = ["Mandou muito bem! 👏", "Valeu demais pela ajuda! 🙌", "Entrega caprichada! 🚀"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PedidoDeAgradecimento = { pessoas?: string[]; tarefaId?: string | null };

/** Abre a janela de agradecer de qualquer lugar do app. */
export function abrirAgradecer(pedido: PedidoDeAgradecimento = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PedidoDeAgradecimento>(EVENTO_ABRIR, { detail: pedido }));
}

/** Montada uma vez, na raiz: escuta `abrirAgradecer` e mostra a janela. */
export function PortaDoAgradecer() {
  const [pedido, setPedido] = useState<PedidoDeAgradecimento | null>(null);
  useEffect(() => {
    const abrir = (e: Event) => setPedido((e as CustomEvent<PedidoDeAgradecimento>).detail ?? {});
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);
  if (!pedido) return null;
  return (
    <AgradecerDialog
      inicial={pedido}
      aoFechar={() => setPedido(null)}
      aoPublicar={avisarMuralPublicado}
    />
  );
}

export function AgradecerDialog({
  inicial,
  aoFechar,
  aoPublicar,
}: {
  inicial?: PedidoDeAgradecimento;
  aoFechar: () => void;
  aoPublicar: () => void;
}) {
  useEscFecha(true, aoFechar);
  const { currentUser, users, tasks } = useFluxo();
  const [pessoas, setPessoas] = useState<string[]>(() =>
    (inicial?.pessoas ?? []).filter((id) => id !== currentUser.id).slice(0, MAX_PESSOAS),
  );
  const [tarefaId, setTarefaId] = useState<string>(() =>
    inicial?.tarefaId && GUID.test(inicial.tarefaId) ? inicial.tarefaId : "",
  );
  const [busca, setBusca] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [enviando, setEnviando] = useState(false);

  const encontrados = useMemo(() => {
    const q = normalizarNome(busca);
    return users
      .filter((u) => u.id !== currentUser.id && !pessoas.includes(u.id))
      .filter((u) => {
        if (!q) return true;
        const n = normalizarNome(u.name);
        return n.startsWith(q) || n.includes(` ${q}`);
      })
      .slice(0, 6);
  }, [busca, users, pessoas, currentUser.id]);

  /* As tarefas que fazem sentido citar: de quem está sendo agradecido (feitas
     por ela ou criadas por ela), as concluídas mais recentes primeiro. O
     servidor confere a mesma regra. */
  const tarefas = useMemo(() => {
    if (!pessoas.length) return [];
    const alvo = new Set(pessoas);
    return tasks
      .filter((t) => GUID.test(t.id) && (alvo.has(t.assigneeId) || alvo.has(t.createdBy)))
      .sort((a, b) => {
        const fa = a.status === "concluida" ? 1 : 0;
        const fb = b.status === "concluida" ? 1 : 0;
        if (fa !== fb) return fb - fa;
        return (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
      })
      .slice(0, 40);
  }, [tasks, pessoas]);
  const tarefaInicial = tasks.find((t) => t.id === tarefaId);
  const tarefaValida = !tarefaId || tarefas.some((t) => t.id === tarefaId);

  const escolher = (id: string) => {
    if (pessoas.length >= MAX_PESSOAS) {
      toast.info(`No máximo ${MAX_PESSOAS} pessoas por agradecimento.`);
      return;
    }
    setPessoas((l) => [...l, id]);
    setBusca("");
  };

  const pode = pessoas.length > 0 && (mensagem.trim().length > 0 || !!tarefaId) && !enviando;

  const enviar = async () => {
    if (!pode) return;
    setEnviando(true);
    try {
      const { publicarNoMural } = await import("@/lib/mural.functions");
      await publicarNoMural({
        data: {
          tipo: "elogio",
          texto: mensagem,
          elogio: { pessoas, tarefaId: tarefaId && tarefaValida ? tarefaId : null },
        },
      });
      const nomes = pessoas
        .map((id) => nomeCurto(users.find((u) => u.id === id)?.name ?? ""))
        .filter(Boolean);
      toast.success(`Agradecimento publicado no mural 💛`, {
        description: nomes.length ? `${nomes.join(", ")} vai receber um aviso.` : undefined,
      });
      aoPublicar();
      aoFechar();
    } catch (e) {
      toast.error(
        ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : "Não foi possível publicar o agradecimento.",
        { description: ehErroDeMuralInativo(e) ? undefined : (e as Error)?.message },
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[450] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agradecer alguém"
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border bg-gradient-to-r from-pink-500/10 via-amber-400/10 to-transparent p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/15 text-pink-600 dark:text-pink-300">
            <HeartHandshake className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Agradecer alguém</h2>
            <p className="text-[11px] text-muted-foreground">
              Vira um cartão no Mural, e a pessoa recebe um aviso.
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {/* Quem */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Quem você quer agradecer?
            </label>
            {pessoas.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pessoas.map((id) => {
                  const u = users.find((x) => x.id === id);
                  const nome = u?.name ?? "Alguém";
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-0.5 pr-2 text-xs font-medium"
                    >
                      <UserAvatar
                        nome={nome}
                        iniciais={u?.avatar ?? "?"}
                        className="h-5 w-5 text-[8px]"
                      />
                      {nomeCurto(nome)}
                      <button
                        type="button"
                        onClick={() => setPessoas((l) => l.filter((x) => x !== id))}
                        aria-label={`Tirar ${nome}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value.slice(0, 60))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && encontrados[0]) {
                    e.preventDefault();
                    escolher(encontrados[0].id);
                  }
                }}
                autoFocus={pessoas.length === 0}
                placeholder="Buscar pelo nome…"
                className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {(busca || pessoas.length === 0) && encontrados.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border">
                {encontrados.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => escolher(u.id)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-secondary"
                    >
                      <UserAvatar
                        nome={u.name}
                        iniciais={u.avatar}
                        className="h-6 w-6 text-[9px]"
                      />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {u.jobTitle && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {u.jobTitle}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pela tarefa */}
          {pessoas.length > 0 && (
            <div>
              <label
                htmlFor="agradecer-tarefa"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Por uma tarefa? <span className="font-normal">(opcional)</span>
              </label>
              <select
                id="agradecer-tarefa"
                value={tarefaValida ? tarefaId : ""}
                onChange={(e) => setTarefaId(e.target.value)}
                className="input w-full"
              >
                <option value="">— Sem tarefa —</option>
                {tarefaInicial && !tarefas.includes(tarefaInicial) && tarefaValida && (
                  <option value={tarefaInicial.id}>{tarefaInicial.title}</option>
                )}
                {tarefas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.status === "concluida" ? "✓ " : ""}
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mensagem */}
          <div>
            <label
              htmlFor="agradecer-mensagem"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Mensagem
            </label>
            <textarea
              id="agradecer-mensagem"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value.slice(0, MAX_MENSAGEM))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={3}
              placeholder="Conte o que a pessoa fez de bom…"
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMensagem((m) => (m.trim() ? `${m.trim()} ${s}` : s))}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-[11px] text-muted-foreground">
            {pessoas.length === 0
              ? "Escolha pelo menos uma pessoa."
              : !mensagem.trim() && !tarefaId
                ? "Escreva uma mensagem ou escolha a tarefa."
                : "Todo mundo vê no Mural."}
          </span>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!pode}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : pessoas.length ? (
              <Send className="h-4 w-4" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Publicar agradecimento
          </button>
        </div>
      </div>
    </div>
  );
}
