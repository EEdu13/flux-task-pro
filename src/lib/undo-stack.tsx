import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "sonner";

export type UndoAction = { label: string; undo: () => void };

interface UndoCtx {
  push: (a: UndoAction) => void;
  popAndRun: () => boolean;
}

const Ctx = createContext<UndoCtx | null>(null);

const EVENTO_EMPILHAR = "fluxo:undo-push";

/**
 * Empilha um desfazer de fora da árvore do provider.
 *
 * O `UndoProvider` mora dentro do FluxoLayout, abaixo do FluxoProvider — então
 * a store de tarefas não enxerga o contexto. Como é lá que toda conclusão passa,
 * é de lá que o aviso precisa sair. O evento resolve isso sem inverter a ordem
 * dos providers.
 */
export function empilharDesfazer(a: UndoAction) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UndoAction>(EVENTO_EMPILHAR, { detail: a }));
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<UndoAction[]>([]);

  const push = useCallback((a: UndoAction) => {
    stackRef.current.push(a);
    if (stackRef.current.length > 30) stackRef.current.shift();
    toast(a.label, {
      duration: 8000,
      action: {
        label: "Desfazer",
        onClick: () => {
          const idx = stackRef.current.indexOf(a);
          if (idx >= 0) {
            stackRef.current.splice(idx, 1);
            try {
              a.undo();
              toast.success("Desfeito");
            } catch {
              toast.error("Não deu pra desfazer");
            }
          }
        },
      },
    });
    setTimeout(() => {
      const idx = stackRef.current.indexOf(a);
      if (idx >= 0) stackRef.current.splice(idx, 1);
    }, 30_000);
  }, []);

  const popAndRun = useCallback(() => {
    const a = stackRef.current.pop();
    if (!a) return false;
    try {
      a.undo();
      toast.success(`Desfeito: ${a.label}`);
    } catch {
      toast.error("Não deu pra desfazer");
    }
    return true;
  }, []);

  useEffect(() => {
    const aoEmpilhar = (e: Event) => push((e as CustomEvent<UndoAction>).detail);
    window.addEventListener(EVENTO_EMPILHAR, aoEmpilhar);
    return () => window.removeEventListener(EVENTO_EMPILHAR, aoEmpilhar);
  }, [push]);

  // Global Ctrl/Cmd+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;
      if (stackRef.current.length === 0) return;
      e.preventDefault();
      popAndRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popAndRun]);

  return <Ctx.Provider value={{ push, popAndRun }}>{children}</Ctx.Provider>;
}

export function useUndo() {
  const c = useContext(Ctx);
  if (!c) throw new Error("UndoProvider missing");
  return c;
}