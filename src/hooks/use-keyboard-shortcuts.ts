import { useEffect } from "react";

type Handler = () => void;

export interface CallShortcuts {
  onToggleMic?: Handler;
  onToggleCam?: Handler;
  onEnd?: Handler;
  onToggleChat?: Handler;
  onRaiseHand?: Handler;
  onTogglePresenter?: Handler;
  enabled?: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useCallShortcuts(opts: CallShortcuts) {
  useEffect(() => {
    if (opts.enabled === false) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      let matched = true;
      switch (key) {
        case "m":
          opts.onToggleMic?.();
          break;
        case "v":
          opts.onToggleCam?.();
          break;
        case "e":
          opts.onEnd?.();
          break;
        case "c":
          opts.onToggleChat?.();
          break;
        case "h":
          opts.onRaiseHand?.();
          break;
        case "p":
          opts.onTogglePresenter?.();
          break;
        default:
          matched = false;
      }
      if (matched) e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [opts]);
}