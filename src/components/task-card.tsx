import { Check, MessageSquare, Paperclip, Repeat } from "lucide-react";
import type { Task } from "./dashboard-data";

export const priorityMap = {
  alta: { label: "Alta", color: "oklch(0.58 0.22 25)", bg: "oklch(0.58 0.22 25 / 0.1)" },
  media: { label: "Média", color: "oklch(0.7 0.15 60)", bg: "oklch(0.7 0.15 60 / 0.12)" },
  baixa: { label: "Baixa", color: "oklch(0.62 0.16 155)", bg: "oklch(0.62 0.16 155 / 0.12)" },
};

export const statusMap = {
  pendente: { label: "A fazer", color: "oklch(0.55 0.02 260)", bg: "oklch(0.94 0.005 250)" },
  andamento: { label: "Em andamento", color: "oklch(0.52 0.22 275)", bg: "oklch(0.94 0.02 275)" },
  concluida: { label: "Concluída", color: "oklch(0.5 0.15 155)", bg: "oklch(0.9 0.05 155)" },
};

export function TaskRow({ task }: { task: Task }) {
  const s = statusMap[task.status];
  const p = priorityMap[task.priority];
  const initials = task.assignee.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <tr className="group border-b border-border transition-colors hover:bg-secondary/60">
      <td className="py-2.5 pl-4 pr-2">
        <button className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border transition hover:border-success hover:bg-success/10">
          {task.status === "concluida" && <Check className="h-3 w-3" style={{ color: "oklch(0.5 0.15 155)" }} />}
        </button>
      </td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${task.status === "concluida" ? "text-muted-foreground line-through" : "text-foreground"}`}>
            {task.title}
          </span>
          {task.recurring && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium" title="Tarefa recorrente"
              style={{ background: "oklch(0.94 0.02 275)", color: "oklch(0.4 0.15 275)" }}>
              <Repeat className="h-2.5 w-2.5" />
            </span>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground opacity-0 group-hover:opacity-100">
            <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> 2</span>
            <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" /> 1</span>
          </span>
        </div>
      </td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: "oklch(0.52 0.22 275)" }}>
            {initials}
          </div>
          <span className="text-xs text-foreground">{task.assignee}</span>
        </div>
      </td>
      <td className="py-2.5 pr-4 text-xs text-muted-foreground">{task.dueLabel}</td>
      <td className="py-2.5 pr-4">
        <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ background: p.bg, color: p.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} /> {p.label}
        </span>
      </td>
      <td className="py-2.5 pr-4">
        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ background: s.bg, color: s.color }}>
          {s.label}
        </span>
      </td>
      <td className="py-2.5 pr-4 text-xs">
        <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">{task.sector}</span>
      </td>
      <td className="py-2.5 pr-4 text-right text-xs font-semibold text-primary">+{task.score}</td>
    </tr>
  );
}