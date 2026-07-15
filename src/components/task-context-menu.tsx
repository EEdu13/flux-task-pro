import { useEffect, useState } from "react";
import { Pencil, CheckCircle2, RotateCcw, Star, Copy, Trash2, AtSign } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { toast } from "sonner";

interface Detail {
  id: string;
  x: number;
  y: number;
}

export function TaskContextMenu() {
  const { tasks, updateTask, deleteTask, createTask, openTask, currentUser } = useFluxo();
  const [ctx, setCtx] = useState<Detail | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<Detail>).detail;
      if (!detail) return;
      setCtx(detail);
    };
    const onClose = () => setCtx(null);
    window.addEventListener("fluxo:task-context", onOpen as EventListener);
    window.addEventListener("click", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") onClose();
    });
    return () => {
      window.removeEventListener("fluxo:task-context", onOpen as EventListener);
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, []);

  if (!ctx) return null;
  const task = tasks.find((t) => t.id === ctx.id);
  if (!task) return null;

  const isDone = task.status === "concluida";
  // clamp position to viewport
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = 220;
  const height = 280;
  const left = Math.min(ctx.x, vw - width - 8);
  const top = Math.min(ctx.y, vh - height - 8);

  const item = (
    icon: typeof Pencil,
    label: string,
    onClick: () => void,
    danger?: boolean,
  ) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
        setCtx(null);
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-secondary"
      }`}
    >
      {(() => {
        const Icon = icon;
        return <Icon className="h-3.5 w-3.5" />;
      })()}
      <span className="flex-1">{label}</span>
    </button>
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left, top, width }}
      className="fixed z-[300] animate-in fade-in-0 zoom-in-95 rounded-lg border border-border bg-card p-1 shadow-2xl"
    >
      <div className="border-b border-border px-2 py-1.5">
        <div className="truncate text-[11px] font-semibold">{task.title}</div>
        <div className="text-[10px] text-muted-foreground">Ações rápidas</div>
      </div>
      <div className="mt-1 flex flex-col">
        {item(Pencil, "Editar", () => openTask(task.id))}
        {isDone
          ? item(RotateCcw, "Reabrir", () =>
              updateTask(task.id, { status: "pendente" }),
            )
          : item(CheckCircle2, "Concluir", () =>
              updateTask(task.id, { status: "concluida" }),
            )}
        {item(
          Star,
          task.inPack ? "Remover do pack" : "Adicionar ao pack",
          () => updateTask(task.id, { inPack: !task.inPack }),
        )}
        {item(AtSign, "Atribuir a mim", () =>
          updateTask(task.id, { assigneeId: currentUser.id }),
        )}
        {item(Copy, "Duplicar", () => {
          createTask({
            title: `${task.title} (cópia)`,
            description: task.description,
            sector: task.sector,
            createdBy: currentUser.id,
            assigneeId: task.assigneeId,
            mentions: task.mentions,
            frequency: task.frequency,
            status: "pendente",
            score: task.score,
            dueDate: task.dueDate,
            recurring: task.recurring,
            priority: task.priority,
            tags: task.tags,
          });
          toast.success("Tarefa duplicada");
        })}
        <div className="my-1 h-px bg-border" />
        {item(
          Trash2,
          "Excluir",
          () => {
            if (confirm(`Excluir "${task.title}"?`)) {
              deleteTask(task.id);
              toast.success("Tarefa excluída");
            }
          },
          true,
        )}
      </div>
    </div>
  );
}

export function openTaskContext(id: string, x: number, y: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("fluxo:task-context", { detail: { id, x, y } }),
  );
}