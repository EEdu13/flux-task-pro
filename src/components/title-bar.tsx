import { useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";

/** True quando o app roda dentro do shell Tauri (não no navegador). */
function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/**
 * Barra de título própria, na cor do app — substitui a barra branca do Windows.
 * Só renderiza dentro do Tauri; no navegador retorna null e nada muda.
 */
export function TitleBar() {
  const [inTauri, setInTauri] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    setInTauri(true);
    document.documentElement.classList.add("tauri-app");

    let unlisten: (() => void) | undefined;
    void (async () => {
      const w = await currentWindow();
      setMaximized(await w.isMaximized());
      // Mantém o ícone de maximizar/restaurar coerente ao arrastar/encaixar a janela.
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    })();

    return () => unlisten?.();
  }, []);

  if (!inTauri) return null;

  const minimize = async () => (await currentWindow()).minimize();
  const toggleMaximize = async () => (await currentWindow()).toggleMaximize();
  // close() dispara CloseRequested, que o lado Rust intercepta para esconder na bandeja.
  const close = async () => (await currentWindow()).close();

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[9999] flex h-[var(--titlebar-h)] items-center justify-between border-b border-sidebar-border bg-sidebar pl-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
        <span className="text-[11px] font-semibold tracking-[0.18em] text-sidebar-foreground/70">
          FLUXO
        </span>
      </div>

      <div className="flex h-full items-center">
        <button
          type="button"
          onClick={minimize}
          aria-label="Minimizar"
          className="flex h-full w-12 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={toggleMaximize}
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          className="flex h-full w-12 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-sidebar-foreground"
        >
          {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Fechar"
          className="flex h-full w-12 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
