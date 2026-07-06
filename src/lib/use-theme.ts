import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const KEY = "fluxo.theme";

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