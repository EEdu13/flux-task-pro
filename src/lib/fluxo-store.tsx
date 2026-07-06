import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Notification, Status, Task, User } from "./fluxo-types";
import { seedNotifications, seedTasks, seedUsers } from "./fluxo-seed";

interface Store {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  currentUserId: string;
  setCurrentUserId: (id: string) => void;
  currentUser: User;
  createTask: (t: Omit<Task, "id" | "createdAt" | "order">) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, status: Status, targetIndex?: number) => void;
  markNotifRead: (id: string) => void;
  // permissions
  canAssignTo: (targetUserId: string) => boolean;
  visibleUsersForAssign: () => User[];
}

const StoreCtx = createContext<Store | null>(null);

const LS_KEY = "fluxo.state.v1";

interface Persisted {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  currentUserId: string;
}

function load(): Persisted {
  if (typeof window === "undefined")
    return { users: seedUsers, tasks: seedTasks, notifications: seedNotifications, currentUserId: "u1" };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw new Error("no state");
    return JSON.parse(raw) as Persisted;
  } catch {
    return { users: seedUsers, tasks: seedTasks, notifications: seedNotifications, currentUserId: "u1" };
  }
}

export function FluxoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(() => load());

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  }, [state]);

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === state.currentUserId) ?? state.users[0],
    [state.users, state.currentUserId],
  );

  const visibleUsersForAssign = (): User[] => {
    if (currentUser.role === "gerente") return state.users;
    if (currentUser.role === "supervisor") {
      return state.users.filter(
        (u) => u.id === currentUser.id || u.supervisorId === currentUser.id,
      );
    }
    // adm
    return state.users.filter((u) => u.id === currentUser.id);
  };

  const canAssignTo = (targetUserId: string) =>
    visibleUsersForAssign().some((u) => u.id === targetUserId);

  const notify = (userIds: string[], notif: Omit<Notification, "id" | "userId" | "time">) => {
    setState((s) => {
      const newNotifs: Notification[] = userIds.map((uid, i) => ({
        ...notif,
        id: `n${Date.now()}${i}`,
        userId: uid,
        time: "agora",
      }));
      return { ...s, notifications: [...newNotifs, ...s.notifications] };
    });
  };

  const store: Store = {
    ...state,
    setCurrentUserId: (id) => setState((s) => ({ ...s, currentUserId: id })),
    currentUser,
    createTask: (t) => {
      const id = `t${Date.now()}`;
      const maxOrder =
        Math.max(0, ...state.tasks.filter((x) => x.status === t.status).map((x) => x.order)) + 1;
      const task: Task = { ...t, id, createdAt: new Date().toISOString(), order: maxOrder };
      setState((s) => ({ ...s, tasks: [task, ...s.tasks] }));
      // notify assignee (if not self) and mentions
      const recipients = new Set<string>();
      if (task.assigneeId !== currentUser.id) recipients.add(task.assigneeId);
      task.mentions.forEach((m) => m !== currentUser.id && recipients.add(m));
      if (recipients.size > 0) {
        notify(Array.from(recipients), {
          type: "atribuida",
          title: "Nova tarefa",
          desc: task.title,
          taskId: id,
        });
      }
    },
    updateTask: (id, patch) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },
    deleteTask: (id) => {
      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
    },
    moveTask: (id, status, targetIndex) => {
      setState((s) => {
        const task = s.tasks.find((t) => t.id === id);
        if (!task) return s;
        const others = s.tasks.filter((t) => t.id !== id);
        const col = others.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
        const idx = targetIndex ?? col.length;
        col.splice(idx, 0, { ...task, status });
        const reordered = col.map((t, i) => ({ ...t, order: i }));
        const restCols = others.filter((t) => t.status !== status);
        // award score when moved to concluida
        if (status === "concluida" && task.status !== "concluida") {
          const assignee = s.users.find((u) => u.id === task.assigneeId);
          if (assignee) {
            return {
              ...s,
              tasks: [...restCols, ...reordered],
              users: s.users.map((u) =>
                u.id === assignee.id ? { ...u, score: u.score + task.score } : u,
              ),
            };
          }
        }
        return { ...s, tasks: [...restCols, ...reordered] };
      });
    },
    markNotifRead: (id) => {
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      }));
    },
    canAssignTo,
    visibleUsersForAssign,
  };

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useFluxo() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useFluxo must be used inside FluxoProvider");
  return ctx;
}