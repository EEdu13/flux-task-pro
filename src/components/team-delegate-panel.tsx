import { useEffect, useMemo, useState } from "react";
import { X, Search, UserPlus, Plus } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { statusLabels, type Task } from "@/lib/fluxo-types";
import { toast } from "sonner";

export function TeamDelegatePanel() {
  const {
    users,
    tasks,
    currentUser,
    visibleUsersForAssign,
    updateTask,
    openTask,
    reorderTasks,
    openQuickCreate,
  } = useFluxo();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        const target = e.target as HTMLElement | null;
        const inField =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (inField) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("fluxo:team-panel-open", openHandler);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("fluxo:team-panel-open", openHandler);
    };
  }, []);

  const teammates = useMemo(
    () => visibleUsersForAssign().filter((u) => u.id !== currentUser.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, currentUser.id],
  );

  const myOpenTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.assigneeId === currentUser.id &&
          t.status !== "concluida" &&
          (query.trim().length === 0 ||
            t.title.toLowerCase().includes(query.toLowerCase())),
      ),
    [tasks, currentUser.id, query],
  );

  if (!open) return null;

  const activeForUser = (uid: string) =>
    tasks
      .filter((t) => t.assigneeId === uid && t.status !== "concluida")
      .sort((a, b) => a.order - b.order || a.dueDate.localeCompare(b.dueDate));

  const delegate = (taskId: string, toUserId: string, insertIndex?: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const wasOtherUser = task.assigneeId !== toUserId;
    if (wasOtherUser) updateTask(taskId, { assigneeId: toUserId });
    // Rebuild target user's ordered list with the dragged task inserted at position
    const target = tasks
      .filter((t) => t.assigneeId === toUserId && t.status !== "concluida" && t.id !== taskId)
      .sort((a, b) => a.order - b.order || a.dueDate.localeCompare(b.dueDate));
    const idx = insertIndex == null ? target.length : Math.min(insertIndex, target.length);
    const nextIds = [
      ...target.slice(0, idx).map((t) => t.id),
      taskId,
      ...target.slice(idx).map((t) => t.id),
    ];
    reorderTasks(nextIds);
    const to = users.find((u) => u.id === toUserId);
    if (wasOtherUser) {
      toast.success(`"${task.title}" delegada para ${to?.name.split(" ")[0] ?? "outro"}`);
    } else {
      toast.success(`Ordem atualizada`);
    }
  };

  const quickCreate = (toUserId: string) => {
    setOpen(false);
    setTimeout(() => openQuickCreate({ assigneeId: toUserId }), 0);
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background/95 backdrop-blur">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <UserPlus className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Delegar rápido</div>
          <div className="text-[11px] text-muted-foreground">
            Arraste tarefas suas para a coluna de quem vai fazer · Esc fecha
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar minhas tarefas…"
            className="w-56 bg-transparent py-1.5 text-xs outline-none"
          />
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden p-3">
        {/* Minhas tarefas */}
        <div className="w-72 shrink-0 overflow-y-auto rounded-lg border border-border bg-card p-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Minhas tarefas abertas
            </div>
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold">
              {myOpenTasks.length}
            </span>
          </div>
          {myOpenTasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
              Nada aberto pra delegar.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {myOpenTasks.map((t) => (
                <TaskChip
                  key={t.id}
                  task={t}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setHoverCol(null);
                    setHoverIndex(null);
                  }}
                  onClick={() => openTask(t.id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Colunas de pessoas */}
        <div className="flex flex-1 gap-3 overflow-x-auto">
          {teammates.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Você não tem colaboradores visíveis para delegar.
            </div>
          ) : (
            teammates.map((u) => {
              const list = activeForUser(u.id);
              const soon = list.filter(
                (t) => new Date(t.dueDate).getTime() - Date.now() < 3 * 24 * 3600e3,
              ).length;
              const isHover = hoverCol === u.id;
              return (
                <div
                  key={u.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHoverCol(u.id);
                    if (hoverIndex == null) setHoverIndex(list.length);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget === e.target) {
                      setHoverCol((h) => (h === u.id ? null : h));
                    }
                  }}
                  onDrop={() => {
                    if (dragId) delegate(dragId, u.id, hoverIndex ?? list.length);
                    setDragId(null);
                    setHoverCol(null);
                    setHoverIndex(null);
                  }}
                  className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-card transition ${
                    isHover
                      ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2 border-b border-border p-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {u.avatar || u.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{u.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {u.jobTitle}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold">{list.length}</div>
                      <div className="text-[9px] uppercase text-muted-foreground">ativas</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-2 py-1 text-[10px] text-muted-foreground">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        list.length > 8 ? "bg-red-500" : list.length > 4 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    />
                    <span>
                      {list.length > 8
                        ? "Sobrecarregado"
                        : list.length > 4
                          ? "Carga alta"
                          : "Disponível"}
                    </span>
                    <span className="ml-auto">{soon} vencendo em 3d</span>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
                    {list.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                        Livre. Solta uma tarefa aqui.
                      </div>
                    ) : (
                      <>
                        {list.slice(0, 20).map((t, index) => {
                          const showIndicator =
                            hoverCol === u.id && hoverIndex === index && dragId && dragId !== t.id;
                          return (
                            <div key={t.id}>
                              {showIndicator && (
                                <div className="mb-1 h-0.5 rounded-full bg-primary" />
                              )}
                              <div
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("text/plain", t.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  setDragId(t.id);
                                }}
                                onDragEnd={() => {
                                  setDragId(null);
                                  setHoverCol(null);
                                  setHoverIndex(null);
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  const before = e.clientY < rect.top + rect.height / 2;
                                  setHoverCol(u.id);
                                  setHoverIndex(before ? index : index + 1);
                                }}
                                onClick={() => openTask(t.id)}
                                className="group flex cursor-grab items-start gap-2 rounded-md border border-border bg-background p-2 text-left text-xs hover:border-primary/40 active:cursor-grabbing"
                              >
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">{t.title}</div>
                                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>{statusLabels[t.status]}</span>
                                    <span>
                                      {new Date(t.dueDate).toLocaleDateString("pt-BR", {
                                        day: "2-digit",
                                        month: "2-digit",
                                      })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {hoverCol === u.id && hoverIndex === list.length && dragId && (
                          <div className="h-0.5 rounded-full bg-primary" />
                        )}
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => quickCreate(u.id)}
                    className="flex items-center justify-center gap-1 border-t border-border bg-secondary/40 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" /> Criar tarefa aqui
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function TaskChip({
  task,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: Task;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="cursor-grab rounded-md border border-border bg-background p-2 text-xs shadow-sm hover:border-primary/60 active:cursor-grabbing"
    >
      <div className="truncate font-medium">{task.title}</div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{statusLabels[task.status]}</span>
        <span>
          {new Date(task.dueDate).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
          })}
        </span>
      </div>
    </li>
  );
}