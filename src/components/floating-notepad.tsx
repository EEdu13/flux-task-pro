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
import { suggestTasksFromNote, type NoteTaskSuggestion } from "@/lib/notes-ai.functions";

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

const LS_KEY = "fluxo.notepad.v1";
const rid = () => `nt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function loadState(): NotepadState {
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
    const raw = localStorage.getItem(LS_KEY);
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
  const { createTask, currentUser, isAuthenticated } = useFluxo();
  const [state, setState] = useState<NotepadState>(() => loadState());
  const [dragging, setDragging] = useState<null | { dx: number; dy: number }>(null);
  const [resizing, setResizing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<NoteTaskSuggestion[] | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [state]);

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
      const res = await suggestTasksFromNote({
        data: { title: active.title, content: active.content },
      });
      setSuggestions(res.suggestions);
      if (res.suggestions.length === 0) toast.info("A IA não encontrou tarefas acionáveis");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar");
    } finally {
      setLoading(false);
    }
  };

  const createFromSuggestion = (s: NoteTaskSuggestion, index: number) => {
    const due = new Date();
    due.setDate(due.getDate() + s.dueInDays);
    due.setHours(23, 59, 0, 0);
    createTask({
      title: s.title,
      description: s.reason ? `Sugerido pela IA a partir da nota "${active?.title}". Motivo: ${s.reason}` : `Sugerido pela IA a partir da nota "${active?.title}".`,
      sector: currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: currentUser.id,
      mentions: [],
      frequency: "diaria",
      status: "pendente",
      score: 10,
      dueDate: due.toISOString(),
      recurring: false,
      priority: s.priority,
      tags: ["nota"],
    });
    toast.success("Tarefa criada");
    setSuggestions((cur) => (cur ? cur.filter((_, i) => i !== index) : cur));
  };
  const createAll = () => {
    if (!suggestions) return;
    suggestions.forEach((s) => createFromSuggestion(s, -1));
    toast.success(`${suggestions.length} tarefas criadas`);
    setSuggestions([]);
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

      {/* suggestions area */}
      {suggestions && suggestions.length > 0 && (
        <div className="max-h-[45%] overflow-y-auto border-t border-border bg-secondary/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" /> Sugestões da IA
            </div>
            <button
              onClick={createAll}
              className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground hover:brightness-110"
            >
              Criar todas
            </button>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-xs"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    s.priority === "alta"
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : s.priority === "baixa"
                        ? "bg-slate-500/15 text-slate-600 dark:text-slate-300"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {s.priority}
                </span>
                <div className="flex-1">
                  <div className="font-medium leading-snug text-foreground">{s.title}</div>
                  {s.reason && (
                    <div className="text-[10px] text-muted-foreground">{s.reason}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    {s.dueInDays === 0 ? "vence hoje" : `vence em ${s.dueInDays} dia${s.dueInDays > 1 ? "s" : ""}`}
                  </div>
                </div>
                <button
                  onClick={() => createFromSuggestion(s, i)}
                  className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                  title="Criar tarefa"
                >
                  <Check className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
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