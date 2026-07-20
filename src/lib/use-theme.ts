import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const KEY = "fluxo.theme";
const PALETTE_KEY = "fluxo.palette";

export type Palette = "forest" | "ocean" | "sunset" | "noir";

export const paletteOptions: {
  id: Palette;
  name: string;
  description: string;
  swatch: string[];
}[] = [
  {
    id: "forest",
    name: "Forest Precision",
    description: "Verde profundo com creme quente. Padrão do Fluxo.",
    swatch: ["#f4efe4", "#2f4a34", "#c8e26a", "#1a2820"],
  },
  {
    id: "ocean",
    name: "Ocean Trust",
    description: "Azul corporativo, sereno e confiável.",
    swatch: ["#f0f5fb", "#2653a8", "#7cc7e6", "#152340"],
  },
  {
    id: "sunset",
    name: "Sunset Energy",
    description: "Laranja e âmbar quentes, alta energia.",
    swatch: ["#fbf1e5", "#d9522a", "#f2b968", "#3a1e10"],
  },
  {
    id: "noir",
    name: "Noir Professional",
    description: "Preto e branco monocromático com detalhe âmbar.",
    swatch: ["#ffffff", "#141414", "#c5c5c5", "#e0a52a"],
  },
];

function readPalette(): Palette {
  if (typeof window === "undefined") return "forest";
  const v = localStorage.getItem(PALETTE_KEY) as Palette | null;
  if (v && paletteOptions.some((p) => p.id === v)) return v;
  return "forest";
}

function applyPalette(p: Palette) {
  if (typeof document === "undefined") return;
  if (p === "forest") {
    document.documentElement.removeAttribute("data-palette");
  } else {
    document.documentElement.setAttribute("data-palette", p);
  }
}

/** Applies the saved palette on mount. Call once in the root component. */
export function useApplyPalette() {
  useEffect(() => {
    applyPalette(readPalette());
  }, []);
}

export function usePalette() {
  const [palette, setPaletteState] = useState<Palette>(() => readPalette());
  useEffect(() => {
    applyPalette(palette);
    localStorage.setItem(PALETTE_KEY, palette);
  }, [palette]);
  return { palette, setPalette: setPaletteState };
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(KEY) as Theme) ?? "light";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} mês${m > 1 ? "es" : ""}`;
  return `há ${Math.floor(d / 365)} ano(s)`;
}

export function formatDueBucket(iso: string): "atrasada" | "hoje" | "semana" | "depois" {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(iso);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((dueDay.getTime() - now.getTime()) / (24 * 3600e3));
  if (diffDays < 0) return "atrasada";
  if (diffDays === 0) return "hoje";
  if (diffDays <= 7) return "semana";
  return "depois";
}