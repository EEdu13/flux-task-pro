import { useEffect, useRef, useState } from "react";
import {
  StickyNote,
  X,
  Plus,
  Trash2,
  Pencil,
  Sparkles,
  Check,
  Loader2,
  GripVertical,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import { sugerirTarefasDaNota } from "@/lib/nota-ia.functions";
import type { Prioridade } from "@/lib/nota-ia.functions";
import { dataParaIso, isoParaData } from "@/lib/data-iso";

/**
 * Uma sugestão como ela fica na tela: já editável.
 *
 * A IA propõe, a pessoa confere. Responsável e prazo são justamente o que ela
 * mais precisa ajustar — a nota costuma dizer o que fazer, e não para quem nem
 * para quando —, então eles são campos, e não texto.
 */
interface Sugestao {
  id: string;
  titulo: string;
  descricao: string;
  responsavelId: string;
  /** AAAA-MM-DD, sempre preenchido: a tarefa precisa de um prazo. */
  prazo: string;
  prioridade: Prioridade;
  origem: string;
  /** A nota não disse o prazo — a data é um palpite da tela, e isso fica à vista. */
  prazoSuposto: boolean;
}

const PRIORIDADES: { valor: Prioridade; rotulo: string }[] = [
  { valor: "alta", rotulo: "Alta" },
  { valor: "media", rotulo: "Média" },
  { valor: "baixa", rotulo: "Baixa" },
];

interface Tab {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

interface NotepadState {
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  activeId: string;
  tabs: Tab[];
}

const LS_PREFIX = "fluxo.notepad.v2:";
const lsKey = (userId: string) => `${LS_PREFIX}${userId}`;

/* Id de nota agora é UUID.
   O formato antigo (`nt-mf3k2a-x9d1`) não cabe na coluna `uniqueidentifier` de
   `gestor.blocos_de_notas` — nota criada com ele nunca chegaria ao banco.
   `crypto.randomUUID` existe em todo navegador atual e no Tauri. */
const rid = () => crypto.randomUUID();

/** Nota do formato antigo, que existe só neste computador. */
const ehUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

function loadState(userId: string): NotepadState {
  if (typeof window === "undefined") {
    return {
      open: false,
      x: 80,
      y: 80,
      w: 420,
      h: 480,
      activeId: "",
      tabs: [],
    };
  }
  try {
    const raw = localStorage.getItem(lsKey(userId));
    if (raw) {
      const p = JSON.parse(raw) as NotepadState;
      if (p.tabs.length === 0) {
        const t: Tab = { id: rid(), title: "Nota 1", content: "", updatedAt: Date.now() };
        p.tabs = [t];
        p.activeId = t.id;
      }
      return { ...p, open: p.open ?? false };
    }
  } catch {
    /* ignore */
  }
  const t: Tab = { id: rid(), title: "Nota 1", content: "", updatedAt: Date.now() };
  return {
    open: false,
    x: Math.max(24, (typeof window !== "undefined" ? window.innerWidth : 1200) - 460),
    y: 96,
    w: 420,
    h: 480,
    activeId: t.id,
    tabs: [t],
  };
}

export function FloatingNotepad() {
  const { createTask, currentUser, isAuthenticated, users, visibleUsersForAssign } = useFluxo();
  const [state, setState] = useState<NotepadState>(() => loadState(currentUser.id));
  const [dragging, setDragging] = useState<null | { dx: number; dy: number }>(null);
  const [resizing, setResizing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Sugestao[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // reload when the active user changes (each user has their own notepad)
  useEffect(() => {
    setState(loadState(currentUser.id));
    setSuggestions(null);
    setRenamingId(null);
  }, [currentUser.id]);

  // persist per-user
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(lsKey(currentUser.id), JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state, currentUser.id]);

  /* ---------- Sincronia com o banco ----------

     O `localStorage` acima continua sendo a gravação imediata: é ele que faz a
     nota sobreviver a um fechamento súbito, sem esperar rede. O banco entra por
     cima, para a nota acompanhar a pessoa entre computadores.

     Note o que NÃO sobe: posição, tamanho e se a janela está aberta. Isso é
     preferência de tela, por máquina — quem usa monitor grande no escritório
     não quer a janelinha no mesmo canto do notebook. */

  /** O que já foi gravado, por id, para não reenviar o que não mudou. */
  const gravadoRef = useRef<Record<string, string>>({});
  const carregouDoBancoRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || carregouDoBancoRef.current) return;
    carregouDoBancoRef.current = true;

    void (async () => {
      try {
        const { listarNotas, salvarNota } = await import("@/lib/notas.functions");
        const { notas } = await listarNotas();

        if (notas.length) {
          // O banco é a verdade quando tem conteúdo.
          setState((s) => ({ ...s, tabs: notas, activeId: notas[0]!.id }));
          for (const n of notas) gravadoRef.current[n.id] = JSON.stringify([n.title, n.content]);
          return;
        }

        /* Banco vazio e notas locais com conteúdo: é a primeira vez desta
           pessoa. Sobe o que existe aqui, trocando o id antigo por UUID — o
           formato `nt-...` não caberia na coluna. Assim ninguém perde o que
           escreveu antes desta migração. */
        const comConteudo = state.tabs.filter((t) => t.content.trim() || t.title !== "Nota 1");
        if (!comConteudo.length) return;

        const migradas = comConteudo.map((t) => ({ ...t, id: ehUuid(t.id) ? t.id : rid() }));
        for (const [i, t] of migradas.entries()) {
          await salvarNota({ data: { id: t.id, title: t.title, content: t.content, ordem: i } });
          gravadoRef.current[t.id] = JSON.stringify([t.title, t.content]);
        }
        setState((s) => ({ ...s, tabs: migradas, activeId: migradas[0]!.id }));
      } catch (e) {
        // Sem rede, o bloco de notas continua funcionando pelo localStorage.
        console.warn("[notas] não sincronizou:", (e as Error)?.message);
      }
    })();
  }, [isAuthenticated, state.tabs]);

  useEffect(() => {
    if (!isAuthenticated) return;

    /* Um segundo de pausa antes de gravar.
       O efeito do `localStorage` roda a cada tecla, e tem que rodar mesmo. Mas
       uma requisição por letra digitada seria absurdo — a pausa agrupa a frase
       inteira numa gravação só. */
    const t = setTimeout(() => {
      void (async () => {
        const { salvarNota } = await import("@/lib/notas.functions");
        for (const [i, aba] of state.tabs.entries()) {
          // Nota do formato antigo fica local até a pessoa mexer nela.
          if (!ehUuid(aba.id)) continue;
          const assinatura = JSON.stringify([aba.title, aba.content]);
          if (gravadoRef.current[aba.id] === assinatura) continue;
          try {
            await salvarNota({
              data: { id: aba.id, title: aba.title, content: aba.content, ordem: i },
            });
            gravadoRef.current[aba.id] = assinatura;
          } catch {
            // Fica para a próxima pausa; o localStorage já guardou.
          }
        }
      })();
    }, 1000);

    return () => clearTimeout(t);
  }, [state.tabs, isAuthenticated]);

  // toggle event from other components
  useEffect(() => {
    const handler = () => setState((s) => ({ ...s, open: !s.open }));
    const openHandler = () => setState((s) => ({ ...s, open: true }));
    window.addEventListener("fluxo:notepad-toggle", handler);
    window.addEventListener("fluxo:notepad-open", openHandler);
    return () => {
      window.removeEventListener("fluxo:notepad-toggle", handler);
      window.removeEventListener("fluxo:notepad-open", openHandler);
    };
  }, []);

  // drag
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      setState((s) => ({
        ...s,
        x: Math.max(0, Math.min(window.innerWidth - 120, e.clientX - dragging.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragging.dy)),
      }));
    };
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  // resize
  useEffect(() => {
    if (!resizing) return;
    const move = (e: PointerEvent) => {
      setState((s) => {
        const w = Math.max(320, Math.min(window.innerWidth - s.x - 8, e.clientX - s.x));
        const h = Math.max(260, Math.min(window.innerHeight - s.y - 8, e.clientY - s.y));
        return { ...s, w, h };
      });
    };
    const up = () => setResizing(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [resizing]);

  const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];

  const updateActive = (patch: Partial<Tab>) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === s.activeId ? { ...t, ...patch, updatedAt: Date.now() } : t,
      ),
    }));
  };

  const addTab = () => {
    const t: Tab = { id: rid(), title: `Nota ${state.tabs.length + 1}`, content: "", updatedAt: Date.now() };
    setState((s) => ({ ...s, tabs: [...s.tabs, t], activeId: t.id }));
    setSuggestions(null);
  };
  const removeTab = (id: string) => {
    /* Apaga no banco também, senão a nota volta no próximo login.
       Isto é fácil de esquecer: a tela some com a aba, o `localStorage` some
       com ela, e tudo parece certo — até a pessoa abrir o Fluxo em outro
       computador e a nota apagada estar lá. */
    if (ehUuid(id) && isAuthenticated) {
      delete gravadoRef.current[id];
      void import("@/lib/notas.functions")
        .then((api) => api.apagarNota({ data: { id } }))
        .catch((e) => console.warn("[notas] não apagou no banco:", (e as Error)?.message));
    }

    setState((s) => {
      if (s.tabs.length === 1) {
        const fresh: Tab = { id: rid(), title: "Nota 1", content: "", updatedAt: Date.now() };
        return { ...s, tabs: [fresh], activeId: fresh.id };
      }
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const nextActive = s.activeId === id ? tabs[Math.max(0, idx - 1)].id : s.activeId;
      return { ...s, tabs, activeId: nextActive };
    });
    setSuggestions(null);
  };

  const analyze = async () => {
    if (!active || !active.content.trim()) {
      toast.error("Nada escrito nesta aba");
      return;
    }
    setLoading(true);
    setSuggestions(null);
    try {
      const hoje = dataParaIso(new Date());
      const res = await sugerirTarefasDaNota({
        data: {
          titulo: active.title,
          conteudo: active.content,
          pessoas: users.map((u) => ({
            id: u.id,
            nome: u.name,
            setor: u.sector,
            cargo: u.jobTitle,
          })),
          quemEscreve: currentUser.id,
          hoje,
        },
      });
      // Sem responsável dito, a tarefa nasce com quem escreveu; sem prazo dito, hoje.
      setSuggestions(
        res.tarefas.map((t, i) => ({
          id: `s${i}-${Math.random().toString(36).slice(2, 7)}`,
          titulo: t.titulo,
          descricao: t.descricao,
          responsavelId: t.responsavelId ?? currentUser.id,
          prazo: t.prazo ?? hoje,
          prioridade: t.prioridade,
          origem: t.origem,
          prazoSuposto: !t.prazo,
        })),
      );
      if (res.tarefas.length === 0) toast.info("A IA não encontrou tarefas nesta nota");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar");
    } finally {
      setLoading(false);
    }
  };

  const ajustar = (id: string, patch: Partial<Sugestao>) =>
    setSuggestions((cur) =>
      cur ? cur.map((s) => (s.id === id ? { ...s, ...patch, prazoSuposto: false } : s)) : cur,
    );
  const descartar = (id: string) =>
    setSuggestions((cur) => (cur ? cur.filter((s) => s.id !== id) : cur));

  /** O OK: cria tudo o que sobrou na lista, já conferido. */
  const criarTodas = () => {
    if (!suggestions?.length) return;
    for (const s of suggestions) {
      const pessoa = users.find((u) => u.id === s.responsavelId) ?? currentUser;
      const prazo = isoParaData(s.prazo) ?? new Date();
      prazo.setHours(23, 59, 0, 0);
      const daNota = `Sugerido pela IA a partir da nota "${active?.title}".`;
      createTask({
        title: s.titulo,
        description: s.descricao ? `${s.descricao}\n\n${daNota}` : daNota,
        sector: pessoa.sector,
        createdBy: currentUser.id,
        assigneeId: pessoa.id,
        mentions: pessoa.id !== currentUser.id ? [pessoa.id] : [],
        frequency: "diaria",
        status: "pendente",
        score: 10,
        dueDate: prazo.toISOString(),
        recurring: false,
        priority: s.prioridade,
        tags: ["nota"],
      });
    }
    toast.success(
      suggestions.length === 1 ? "Tarefa criada" : `${suggestions.length} tarefas criadas`,
    );
    setSuggestions(null);
  };

  if (!isAuthenticated || !state.open) return null;

  return (
    <div
      ref={cardRef}
      style={{
        left: state.x,
        top: state.y,
        width: state.w,
        height: state.h,
      }}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
    >
      {/* header (drag handle) */}
      <div
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,input")) return;
          const rect = cardRef.current?.getBoundingClientRect();
          if (!rect) return;
          setDragging({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
        }}
        className="flex cursor-grab items-center gap-2 border-b border-border bg-secondary/60 px-2 py-1.5 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        <StickyNote className="h-3.5 w-3.5 text-amber-500" />
        <span className="flex-1 text-xs font-semibold">Bloco de notas</span>
        <button
          onClick={() => setState((s) => ({ ...s, open: false }))}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          title="Minimizar (mantém tudo salvo)"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setState((s) => ({ ...s, open: false }))}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Fechar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border bg-background/50 px-1 py-1">
        {state.tabs.map((t) => {
          const isActive = t.id === state.activeId;
          const isRenaming = renamingId === t.id;
          return (
            <div
              key={t.id}
              className={`group flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs ${
                isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  defaultValue={t.title}
                  onBlur={(e) => {
                    setState((s) => ({
                      ...s,
                      tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, title: e.target.value.slice(0, 30) || x.title } : x)),
                    }));
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-24 rounded border border-border bg-background px-1 text-xs outline-none"
                />
              ) : (
                <button
                  onClick={() => {
                    setState((s) => ({ ...s, activeId: t.id }));
                    setSuggestions(null);
                  }}
                  onDoubleClick={() => setRenamingId(t.id)}
                  className="max-w-[120px] truncate font-medium"
                  title="Duplo clique para renomear"
                >
                  {t.title}
                </button>
              )}
              {isActive && !isRenaming && (
                <>
                  <button
                    onClick={() => setRenamingId(t.id)}
                    className="rounded p-0.5 opacity-60 hover:opacity-100"
                    title="Renomear"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => removeTab(t.id)}
                    className="rounded p-0.5 opacity-60 hover:opacity-100 hover:text-destructive"
                    title="Excluir aba"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}
        <button
          onClick={addTab}
          className="ml-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Nova aba"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* editor */}
      <textarea
        value={active?.content ?? ""}
        onChange={(e) => updateActive({ content: e.target.value })}
        placeholder="Anote qualquer coisa aqui… ideias, reuniões, pendências. Depois clique em ‘Sugerir tarefas com IA’ e vire tudo em tarefa."
        className="flex-1 resize-none bg-background px-3 py-2 text-sm outline-none"
      />

      {/* O que a IA achou, para conferir antes de virar tarefa */}
      {suggestions && suggestions.length > 0 && (
        <div className="flex max-h-[62%] flex-col border-t border-border bg-secondary/40">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Confira antes de criar
            </div>
            <button
              onClick={() => setSuggestions(null)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              title="Descartar as sugestões"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2">
            {suggestions.map((s) => (
              <li key={s.id} className="rounded-md border border-border bg-card p-2">
                <div className="flex items-start gap-1.5">
                  <input
                    value={s.titulo}
                    onChange={(e) => ajustar(s.id, { titulo: e.target.value.slice(0, 200) })}
                    aria-label="Título da tarefa"
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-foreground outline-none hover:border-border focus:border-primary"
                  />
                  <button
                    onClick={() => descartar(s.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Tirar da lista"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {s.origem && (
                  <div
                    className="mt-0.5 truncate px-1 text-[10px] italic text-muted-foreground"
                    title={s.origem}
                  >
                    da nota: “{s.origem}”
                  </div>
                )}

                <div className="mt-1.5 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-1">
                  <select
                    value={s.responsavelId}
                    onChange={(e) => ajustar(s.id, { responsavelId: e.target.value })}
                    aria-label="Responsável"
                    className="min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-primary"
                  >
                    {visibleUsersForAssign().map((u) => (
                      <option key={u.id} value={u.id} className="bg-popover text-popover-foreground">
                        {u.id === currentUser.id ? "Eu" : u.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={s.prazo}
                    onChange={(e) => e.target.value && ajustar(s.id, { prazo: e.target.value })}
                    aria-label="Prazo"
                    title={s.prazoSuposto ? "A nota não disse o prazo — confira" : "Prazo"}
                    className={`min-w-0 rounded border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-primary ${
                      s.prazoSuposto ? "border-amber-500/60 text-amber-600 dark:text-amber-400" : "border-border"
                    }`}
                  />
                  <select
                    value={s.prioridade}
                    onChange={(e) => ajustar(s.id, { prioridade: e.target.value as Prioridade })}
                    aria-label="Prioridade"
                    className="rounded border border-border bg-background px-1 py-0.5 text-[11px] outline-none focus:border-primary"
                  >
                    {PRIORIDADES.map((p) => (
                      <option
                        key={p.valor}
                        value={p.valor}
                        className="bg-popover text-popover-foreground"
                      >
                        {p.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="truncate text-[10px] text-muted-foreground">
              {suggestions.some((s) => s.prazoSuposto)
                ? "Prazo em amarelo: a nota não disse quando."
                : "Tudo conferido?"}
            </span>
            <button
              onClick={criarTodas}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:brightness-110"
            >
              <Check className="h-3 w-3" />
              Criar {suggestions.length} {suggestions.length === 1 ? "tarefa" : "tarefas"}
            </button>
          </div>
        </div>
      )}

      {/* footer */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/40 px-2 py-1.5">
        <span className="truncate text-[10px] text-muted-foreground">
          {active?.content.length ?? 0} caracteres · salvo automaticamente
        </span>
        <button
          onClick={analyze}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Sugerir tarefas com IA
        </button>
      </div>

      {/* resize handle */}
      <div
        onPointerDown={() => setResizing(true)}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        title="Redimensionar"
      >
        <div className="absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-muted-foreground/60" />
      </div>
    </div>
  );
}