import { motion } from "framer-motion";
import { Check, Clock, Repeat, Sparkles } from "lucide-react";
import type { Task } from "./dashboard-data";

const priorityColor = {
  alta: "oklch(0.7 0.2 25)",
  media: "oklch(0.82 0.17 85)",
  baixa: "oklch(0.78 0.18 155)",
};

const statusMap = {
  pendente: { label: "Pendente", color: "oklch(0.68 0.03 255)" },
  andamento: { label: "Em andamento", color: "oklch(0.78 0.17 210)" },
  concluida: { label: "Concluída", color: "oklch(0.78 0.18 155)" },
};

export function TaskCard({ task, index }: { task: Task; index: number }) {
  const s = statusMap[task.status];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: "easeOut" }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="glass-panel group relative overflow-hidden rounded-2xl p-4 transition-shadow hover:shadow-[0_10px_40px_-10px_oklch(0.78_0.17_210/0.4)]"
    >
      {/* Priority strip */}
      <div
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: priorityColor[task.priority], boxShadow: `0 0 20px ${priorityColor[task.priority]}` }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 pl-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{task.sector}</span>
            {task.recurring && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-primary">
                <Repeat className="h-2.5 w-2.5" /> Recorrente
              </span>
            )}
          </div>
          <h4 className="mt-1.5 text-sm font-medium leading-snug text-foreground">{task.title}</h4>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.dueLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-primary/20 to-accent/20 px-2.5 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3 w-3" />
            {task.score}
          </div>
          <div className="flex -space-x-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-[10px] font-bold text-primary-foreground ring-2 ring-card">
              {task.assignee
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
          </div>
        </div>
      </div>
      {task.status !== "concluida" && (
        <button className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:bg-primary hover:text-primary-foreground">
          <Check className="h-3 w-3" />
          Marcar como concluída
        </button>
      )}
    </motion.div>
  );
}