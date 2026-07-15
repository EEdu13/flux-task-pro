import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActivityEntry,
  ActivityKind,
  Attachment,
  CompletionEntry,
  MeetingMinute,
  Meta,
  Notification,
  Status,
  Task,
  User,
} from "./fluxo-types";
import { priorityMultiplier } from "./fluxo-types";
import { seedCompletions, seedMetas, seedNotifications, seedTasks, seedUsers } from "./fluxo-seed";
import { createRoomCall } from "./livekit-token.functions";

interface TaskDialogState {
  open: boolean;
  editingId?: string;
  initialStatus?: Status;
  initialDueDate?: string;
}

interface Store {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  metas: Meta[];
  completions: CompletionEntry[];
  currentUserId: string;
  isAuthenticated: boolean;
  login: (userId: string) => void;
  logout: () => void;
  setCurrentUserId: (id: string) => void;
  currentUser: User;
  // task crud
  createTask: (
    t: Omit<Task, "id" | "createdAt" | "order" | "comments" | "checklist" | "activity">,
  ) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, status: Status, targetIndex?: number) => void;
  reorderTasks: (orderedIds: string[]) => void;
  // task details
  addComment: (taskId: string, text: string, attachments?: Attachment[]) => void;
  addChecklistItem: (taskId: string, text: string) => void;
  toggleChecklistItem: (taskId: string, itemId: string) => void;
  removeChecklistItem: (taskId: string, itemId: string) => void;
  addTaskAttachments: (taskId: string, atts: Attachment[]) => void;
  removeTaskAttachment: (taskId: string, attId: string) => void;
  // users crud
  createUser: (u: Omit<User, "id" | "score" | "streak">) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  deleteUser: (id: string) => void;
  updateCurrentUser: (patch: Partial<User>) => void;
  // metas
  upsertMeta: (m: Omit<Meta, "id">) => void;
  removeMeta: (id: string) => void;
  // notifications
  markNotifRead: (id: string) => void;
  markAllNotifsRead: () => void;
  // room calls
  callUserToRoom: (targetUserId: string, roomName: string, roomLabel: string) => void;
  callCounts: Record<string, Record<string, Record<string, number>>>;
  topContactsForRoom: (roomName: string, limit?: number) => User[];
  recentContactIds: string[];
  recentContactUsers: (limit?: number) => User[];
  dismissRoomCall: (notifId: string) => void;
  addMissedCallNotification: (fromUserId: string, roomName: string, roomLabel: string) => void;
  // meeting minutes
  minutes: MeetingMinute[];
  saveMinute: (m: Omit<MeetingMinute, "id" | "createdAt" | "createdBy">) => MeetingMinute;
  deleteMinute: (id: string) => void;
  minuteTopicToTask: (minuteId: string, topicId: string) => string | undefined;
  visibleMinutes: () => MeetingMinute[];
  // permissions
  canAssignTo: (targetUserId: string) => boolean;
  visibleUsersForAssign: () => User[];
  // global task dialog
  taskDialog: TaskDialogState;
  openNewTask: (opts?: { status?: Status; dueDate?: string }) => void;
  openTask: (id: string) => void;
  closeTaskDialog: () => void;
  // quick create modal (spreadsheet-style)
  quickCreate: { open: boolean; status?: Status; dueDate?: string; assigneeId?: string };
  openQuickCreate: (opts?: { status?: Status; dueDate?: string; assigneeId?: string }) => void;
  closeQuickCreate: () => void;
}

const StoreCtx = createContext<Store | null>(null);

const LS_KEY = "fluxo.state.v2";

interface Persisted {
  users: User[];
  tasks: Task[];
  notifications: Notification[];
  metas: Meta[];
  completions: CompletionEntry[];
  currentUserId: string;
  isAuthenticated: boolean;
  callCounts: Record<string, Record<string, Record<string, number>>>;
  // shape: { [callerUserId]: { [roomName]: { [targetUserId]: count } } }
  recentContactsByUser?: Record<string, string[]>;
  minutes?: MeetingMinute[];
}

function load(): Persisted {
  const defaults: Persisted = {
    users: seedUsers,
    tasks: seedTasks,
    notifications: seedNotifications,
    metas: seedMetas,
    completions: seedCompletions,
    currentUserId: "u1",
    isAuthenticated: false,
    callCounts: {},
    recentContactsByUser: {},
    minutes: [],
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

const nowIso = () => new Date().toISOString();
const rid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function pushActivity(task: Task, entry: Omit<ActivityEntry, "id" | "at">, userId: string): Task {
  return {
    ...task,
    activity: [...task.activity, { ...entry, id: rid("a"), at: nowIso(), userId }],
  };
}

function computeScore(base: number, priority: Task["priority"], onTime: boolean): number {
  const mult = priorityMultiplier[priority];
  const modifier = onTime ? 1.1 : 0.8;
  return Math.round(base * mult * modifier);
}

export function FluxoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(() => load());
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>({ open: false });
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; status?: Status; dueDate?: string; assigneeId?: string }>({ open: false });
  const didAutoNotifRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  }, [state]);

  // Auto prazo notifications on mount
  useEffect(() => {
    if (didAutoNotifRef.current) return;
    didAutoNotifRef.current = true;
    setState((s) => {
      const now = Date.now();
      const day = 24 * 3600e3;
      const existing = new Set(
        s.notifications
          .filter((n) => n.type === "prazo" && n.taskId)
          .map((n) => `${n.taskId}:${n.userId}`),
      );
      const extra: Notification[] = [];
      for (const t of s.tasks) {
        if (t.status === "concluida") continue;
        const due = new Date(t.dueDate).getTime();
        const overdue = due < now;
        const soon = due - now < day && due - now >= 0;
        if (!overdue && !soon) continue;
        const key = `${t.id}:${t.assigneeId}`;
        if (existing.has(key)) continue;
        extra.push({
          id: rid("n"),
          userId: t.assigneeId,
          type: "prazo",
          title: overdue ? "Tarefa atrasada" : "Prazo se aproximando",
          desc: t.title,
          at: nowIso(),
          taskId: t.id,
        });
      }
      if (extra.length === 0) return s;
      return { ...s, notifications: [...extra, ...s.notifications] };
    });
  }, []);

  const currentUser = useMemo(
    () => state.users.find((u) => u.id === state.currentUserId) ?? state.users[0]!,
    [state.users, state.currentUserId],
  );

  const visibleUsersForAssign = (): User[] => {
    if (currentUser.role === "gerente") return state.users;
    if (currentUser.role === "supervisor") {
      return state.users.filter(
        (u) => u.id === currentUser.id || u.supervisorId === currentUser.id,
      );
    }
    return state.users.filter((u) => u.id === currentUser.id);
  };

  const canAssignTo = (targetUserId: string) =>
    visibleUsersForAssign().some((u) => u.id === targetUserId);

  const handleCompletionSideEffects = (s: Persisted, prev: Task, next: Task): Persisted => {
    const onTime = new Date(next.dueDate).getTime() >= Date.now();
    const points = computeScore(next.score, next.priority, onTime);

    // users score + streak recompute (simple: latest completion day)
    const users = s.users.map((u) =>
      u.id === next.assigneeId ? { ...u, score: u.score + points } : u,
    );

    const completions: CompletionEntry[] = [
      ...s.completions,
      {
        id: rid("cp"),
        taskId: next.id,
        userId: next.assigneeId,
        points,
        priority: next.priority,
        onTime,
        at: nowIso(),
      },
    ];

    const newNotifs: Notification[] = [];
    if (next.createdBy !== next.assigneeId) {
      newNotifs.push({
        id: rid("n"),
        userId: next.createdBy,
        type: "concluida",
        title: "Tarefa concluída",
        desc: next.title,
        at: nowIso(),
        taskId: next.id,
      });
    }

    const tasks = s.tasks.map((t) =>
      t.id === next.id
        ? pushActivity(
            { ...next },
            {
              kind: "concluida",
              userId: currentUser.id,
              text: `concluiu (${onTime ? "no prazo" : "com atraso"})`,
            },
            currentUser.id,
          )
        : t,
    );

    // Concluir NÃO duplica mais a tarefa. Recorrência agora é apenas um rótulo
    // informativo; a próxima ocorrência deve ser criada manualmente.
    void prev;
    return {
      ...s,
      tasks,
      users,
      completions,
      notifications: newNotifs.length ? [...newNotifs, ...s.notifications] : s.notifications,
    };
  };

  const store: Store = {
    ...state,
    login: (id) =>
      setState((s) => ({
        ...s,
        isAuthenticated: true,
        currentUserId: s.users.some((u) => u.id === id) ? id : s.currentUserId,
      })),
    logout: () => setState((s) => ({ ...s, isAuthenticated: false })),
    setCurrentUserId: (id) => setState((s) => ({ ...s, currentUserId: id })),
    currentUser,

    createTask: (t) => {
      setState((s) => {
        const id = rid("t");
        const maxOrder =
          Math.max(0, ...s.tasks.filter((x) => x.status === t.status).map((x) => x.order)) + 1;
        const task: Task = {
          ...t,
          id,
          createdAt: nowIso(),
          order: maxOrder,
          comments: [],
          checklist: [],
          activity: [
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "criada",
              text: "criou esta tarefa",
            },
          ],
        };
        const recipients = new Set<string>();
        if (task.assigneeId !== currentUser.id) recipients.add(task.assigneeId);
        task.mentions.forEach((m) => m !== currentUser.id && recipients.add(m));
        const newNotifs: Notification[] = Array.from(recipients).map((uid) => ({
          id: rid("n"),
          userId: uid,
          type: task.mentions.includes(uid) && uid !== task.assigneeId ? "mencao" : "atribuida",
          title:
            task.mentions.includes(uid) && uid !== task.assigneeId
              ? "Você foi mencionado"
              : "Nova tarefa",
          desc: task.title,
          at: nowIso(),
          taskId: id,
        }));
        return {
          ...s,
          tasks: [task, ...s.tasks],
          notifications: [...newNotifs, ...s.notifications],
        };
      });
    },

    updateTask: (id, patch) => {
      setState((s) => {
        const prev = s.tasks.find((t) => t.id === id);
        if (!prev) return s;
        const next = { ...prev, ...patch } as Task;
        const newNotifs: Notification[] = [];
        // added mentions
        if (patch.mentions) {
          const added = patch.mentions.filter(
            (m) => !prev.mentions.includes(m) && m !== currentUser.id,
          );
          added.forEach((uid) =>
            newNotifs.push({
              id: rid("n"),
              userId: uid,
              type: "mencao",
              title: "Você foi mencionado",
              desc: next.title,
              at: nowIso(),
              taskId: id,
            }),
          );
        }
        // reassignment
        if (
          patch.assigneeId &&
          patch.assigneeId !== prev.assigneeId &&
          patch.assigneeId !== currentUser.id
        ) {
          newNotifs.push({
            id: rid("n"),
            userId: patch.assigneeId,
            type: "atribuida",
            title: "Tarefa atribuída a você",
            desc: next.title,
            at: nowIso(),
            taskId: id,
          });
        }
        // activity log for status change
        const activityAdd: ActivityEntry[] = [];
        if (patch.status && patch.status !== prev.status) {
          activityAdd.push({
            id: rid("a"),
            at: nowIso(),
            userId: currentUser.id,
            kind: "status" as ActivityKind,
            text: `mudou o status para ${patch.status}`,
          });
        }
        if (patch.assigneeId && patch.assigneeId !== prev.assigneeId) {
          const to = s.users.find((u) => u.id === patch.assigneeId);
          activityAdd.push({
            id: rid("a"),
            at: nowIso(),
            userId: currentUser.id,
            kind: "atribuicao",
            text: `atribuiu para ${to?.name ?? "outro"}`,
          });
        }

        const withActivity: Task = { ...next, activity: [...next.activity, ...activityAdd] };
        const base: Persisted = {
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? withActivity : t)),
          notifications: newNotifs.length ? [...newNotifs, ...s.notifications] : s.notifications,
        };
        if (patch.status === "concluida" && prev.status !== "concluida") {
          return handleCompletionSideEffects(base, prev, withActivity);
        }
        return base;
      });
    },

    deleteTask: (id) => {
      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
    },

    reorderTasks: (orderedIds) => {
      setState((s) => {
        const map = new Map(orderedIds.map((id, i) => [id, i]));
        return {
          ...s,
          tasks: s.tasks.map((t) =>
            map.has(t.id) ? { ...t, order: map.get(t.id)! } : t,
          ),
        };
      });
    },

    moveTask: (id, status, targetIndex) => {
      setState((s) => {
        const prev = s.tasks.find((t) => t.id === id);
        if (!prev) return s;
        const others = s.tasks.filter((t) => t.id !== id);
        const col = others.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
        const idx = targetIndex ?? col.length;
        const nextTask: Task = { ...prev, status };
        col.splice(idx, 0, nextTask);
        const reordered = col.map((t, i) => ({ ...t, order: i }));
        const rest = others.filter((t) => t.status !== status);
        let tasks = [...rest, ...reordered];

        if (status !== prev.status) {
          tasks = tasks.map((t) =>
            t.id === id
              ? pushActivity(
                  t,
                  { kind: "status", userId: currentUser.id, text: `moveu para ${status}` },
                  currentUser.id,
                )
              : t,
          );
        }

        const base: Persisted = { ...s, tasks };
        if (status === "concluida" && prev.status !== "concluida") {
          const updated = tasks.find((t) => t.id === id)!;
          return handleCompletionSideEffects(base, prev, updated);
        }
        return base;
      });
    },

    addComment: (taskId, text, attachments) => {
      if (!text.trim() && !(attachments && attachments.length)) return;
      setState((s) => {
        const t = s.tasks.find((x) => x.id === taskId);
        if (!t) return s;
        const c = {
          id: rid("c"),
          userId: currentUser.id,
          text: text.trim(),
          at: nowIso(),
          attachments: attachments && attachments.length ? attachments : undefined,
        };
        const updated = pushActivity(
          { ...t, comments: [...t.comments, c] },
          { kind: "comentario", userId: currentUser.id, text: "comentou" },
          currentUser.id,
        );
        // notify assignee + creator + mentions (exclude commenter)
        const recipients = new Set<string>([t.assigneeId, t.createdBy, ...t.mentions]);
        recipients.delete(currentUser.id);
        const notifs: Notification[] = Array.from(recipients).map((uid) => ({
          id: rid("n"),
          userId: uid,
          type: "mencao",
          title: `${currentUser.name} comentou`,
          desc: `${t.title}: ${text.trim().slice(0, 60)}`,
          at: nowIso(),
          taskId: t.id,
        }));
        return {
          ...s,
          tasks: s.tasks.map((x) => (x.id === taskId ? updated : x)),
          notifications: [...notifs, ...s.notifications],
        };
      });
    },

    addTaskAttachments: (taskId, atts) => {
      if (!atts.length) return;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? pushActivity(
                { ...t, attachments: [...(t.attachments ?? []), ...atts] },
                {
                  kind: "editada",
                  userId: currentUser.id,
                  text: `anexou ${atts.length} arquivo${atts.length > 1 ? "s" : ""}`,
                },
                currentUser.id,
              )
            : t,
        ),
      }));
    },

    removeTaskAttachment: (taskId, attId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? { ...t, attachments: (t.attachments ?? []).filter((a) => a.id !== attId) }
            : t,
        ),
      }));
    },

    addChecklistItem: (taskId, text) => {
      if (!text.trim()) return;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? pushActivity(
                {
                  ...t,
                  checklist: [...t.checklist, { id: rid("ck"), text: text.trim(), done: false }],
                },
                { kind: "checklist", userId: currentUser.id, text: `adicionou "${text.trim()}"` },
                currentUser.id,
              )
            : t,
        ),
      }));
    },

    toggleChecklistItem: (taskId, itemId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                checklist: t.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
              }
            : t,
        ),
      }));
    },

    removeChecklistItem: (taskId, itemId) => {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, checklist: t.checklist.filter((c) => c.id !== itemId) } : t,
        ),
      }));
    },

    createUser: (u) => {
      setState((s) => {
        const id = rid("u");
        const user: User = { ...u, id, score: 0, streak: 0 };
        return { ...s, users: [...s.users, user] };
      });
    },

    updateUser: (id, patch) => {
      setState((s) => ({
        ...s,
        users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
      }));
    },

    updateCurrentUser: (patch) => {
      setState((s) => ({
        ...s,
        users: s.users.map((u) => (u.id === s.currentUserId ? { ...u, ...patch } : u)),
      }));
    },

    deleteUser: (id) => {
      setState((s) => {
        if (s.users.length <= 1) return s;
        const remaining = s.users.filter((u) => u.id !== id);
        // reassign tasks assigned to this user to the first gerente
        const fallback = remaining.find((u) => u.role === "gerente") ?? remaining[0]!;
        const tasks = s.tasks.map((t) =>
          t.assigneeId === id ? { ...t, assigneeId: fallback.id } : t,
        );
        return {
          ...s,
          users: remaining,
          tasks,
          currentUserId: s.currentUserId === id ? fallback.id : s.currentUserId,
        };
      });
    },

    upsertMeta: (m) => {
      setState((s) => {
        const existing = s.metas.find(
          (x) =>
            x.scope === m.scope &&
            x.scopeId === m.scopeId &&
            x.period === m.period &&
            x.metric === m.metric,
        );
        if (existing) {
          return {
            ...s,
            metas: s.metas.map((x) =>
              x.id === existing.id ? { ...existing, target: m.target } : x,
            ),
          };
        }
        return { ...s, metas: [...s.metas, { ...m, id: rid("m") }] };
      });
    },

    removeMeta: (id) => setState((s) => ({ ...s, metas: s.metas.filter((m) => m.id !== id) })),

    markNotifRead: (id) =>
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      })),

    markAllNotifsRead: () =>
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) =>
          n.userId === s.currentUserId ? { ...n, read: true } : n,
        ),
      })),

    callUserToRoom: (targetUserId, roomName, roomLabel) => {
      if (targetUserId !== currentUser.id) {
        createRoomCall({
          data: {
            callerUserId: currentUser.id,
            targetUserId,
            roomName,
            roomLabel,
          },
        }).catch((err) => {
          console.error("Falha ao chamar usuário", err);
        });
      }
      setState((s) => {
        if (targetUserId === s.currentUserId) return s;
        const notif: Notification = {
          id: rid("n"),
          userId: targetUserId,
          type: "mencao",
          title: `📞 ${currentUser.name} está te chamando`,
          desc: `Toque para entrar agora na sala ${roomLabel}`,
          at: nowIso(),
          roomName,
          fromUserId: currentUser.id,
        };
        const prevCounts = s.callCounts[currentUser.id] ?? {};
        const roomMap = prevCounts[roomName] ?? {};
        const nextCallCounts = {
          ...s.callCounts,
          [currentUser.id]: {
            ...prevCounts,
            [roomName]: { ...roomMap, [targetUserId]: (roomMap[targetUserId] ?? 0) + 1 },
          },
        };
        const prevRecents = s.recentContactsByUser?.[currentUser.id] ?? [];
        const nextRecents = [
          targetUserId,
          ...prevRecents.filter((id) => id !== targetUserId),
        ].slice(0, 10);
        const recentContactsByUser = {
          ...(s.recentContactsByUser ?? {}),
          [currentUser.id]: nextRecents,
        };
        return {
          ...s,
          notifications: [notif, ...s.notifications],
          callCounts: nextCallCounts,
          recentContactsByUser,
        };
      });
    },

    topContactsForRoom: (roomName, limit = 3) => {
      const roomMap = state.callCounts[state.currentUserId]?.[roomName] ?? {};
      return state.users
        .filter((u) => u.id !== state.currentUserId)
        .map((u) => ({ u, c: roomMap[u.id] ?? 0 }))
        .filter((x) => x.c > 0)
        .sort((a, b) => b.c - a.c)
        .slice(0, limit)
        .map((x) => x.u);
    },

    recentContactIds: state.recentContactsByUser?.[state.currentUserId] ?? [],
    recentContactUsers: (limit = 5) => {
      const ids = state.recentContactsByUser?.[state.currentUserId] ?? [];
      const out: User[] = [];
      for (const id of ids) {
        const u = state.users.find((x) => x.id === id);
        if (u && u.id !== state.currentUserId) out.push(u);
        if (out.length >= limit) break;
      }
      return out;
    },

    dismissRoomCall: (notifId) =>
      setState((s) => ({
        ...s,
        notifications: s.notifications.map((n) => (n.id === notifId ? { ...n, read: true } : n)),
      })),

    addMissedCallNotification: (fromUserId, roomName, roomLabel) => {
      setState((s) => {
        // avoid duplicates: same recipient+caller+room within last 60s
        const cutoff = Date.now() - 60_000;
        const dupe = s.notifications.some(
          (n) =>
            n.type === "chamada_perdida" &&
            n.userId === s.currentUserId &&
            n.fromUserId === fromUserId &&
            n.roomName === roomName &&
            new Date(n.at).getTime() > cutoff,
        );
        if (dupe) return s;
        const caller = s.users.find((u) => u.id === fromUserId);
        const notif: Notification = {
          id: rid("n"),
          userId: s.currentUserId,
          type: "chamada_perdida",
          title: `📞 Chamada perdida de ${caller?.name ?? "alguém"}`,
          desc: `Toque para retornar a ligação na sala ${roomLabel}`,
          at: nowIso(),
          roomName,
          roomLabel,
          fromUserId,
        };
        return { ...s, notifications: [notif, ...s.notifications] };
      });
    },

    canAssignTo,
    visibleUsersForAssign,

    taskDialog,
    openNewTask: (opts) =>
      setQuickCreate({ open: true, status: opts?.status, dueDate: opts?.dueDate }),
    openTask: (id) => setTaskDialog({ open: true, editingId: id }),
    closeTaskDialog: () => setTaskDialog({ open: false }),
    quickCreate,
    openQuickCreate: (opts) =>
      setQuickCreate({
        open: true,
        status: opts?.status,
        dueDate: opts?.dueDate,
        assigneeId: opts?.assigneeId,
      }),
    closeQuickCreate: () => setQuickCreate({ open: false }),

    minutes: state.minutes ?? [],
    saveMinute: (m) => {
      const minute: MeetingMinute = {
        ...m,
        id: rid("min"),
        createdAt: nowIso(),
        createdBy: currentUser.id,
      };
      setState((s) => ({ ...s, minutes: [minute, ...(s.minutes ?? [])] }));
      return minute;
    },
    deleteMinute: (id) =>
      setState((s) => ({ ...s, minutes: (s.minutes ?? []).filter((x) => x.id !== id) })),
    minuteTopicToTask: (minuteId, topicId) => {
      const minute = (state.minutes ?? []).find((m) => m.id === minuteId);
      const topic = minute?.topics.find((t) => t.id === topicId);
      if (!minute || !topic) return undefined;
      if (topic.taskId) return topic.taskId;
      const newTaskId = rid("t");
      setState((s) => {
        const maxOrder =
          Math.max(0, ...s.tasks.filter((x) => x.status === "pendente").map((x) => x.order)) + 1;
        const task: Task = {
          id: newTaskId,
          title: topic.text.slice(0, 140),
          description: `Gerado automaticamente da ata "${minute.roomLabel}" em ${new Date(
            minute.createdAt,
          ).toLocaleDateString("pt-BR")}.`,
          sector: currentUser.sector,
          createdBy: currentUser.id,
          assigneeId: currentUser.id,
          mentions: [],
          frequency: "diaria",
          status: "pendente",
          score: 10,
          dueDate: new Date(Date.now() + 3 * 24 * 3600e3).toISOString(),
          recurring: false,
          priority: "media",
          tags: ["ata"],
          createdAt: nowIso(),
          order: maxOrder,
          comments: [],
          checklist: [],
          activity: [
            {
              id: rid("a"),
              at: nowIso(),
              userId: currentUser.id,
              kind: "criada",
              text: `criou esta tarefa a partir da ata "${minute.roomLabel}"`,
            },
          ],
        };
        const minutes = (s.minutes ?? []).map((mm) =>
          mm.id === minuteId
            ? {
                ...mm,
                topics: mm.topics.map((t) => (t.id === topicId ? { ...t, taskId: newTaskId } : t)),
              }
            : mm,
        );
        return { ...s, tasks: [task, ...s.tasks], minutes };
      });
      return newTaskId;
    },
    visibleMinutes: () =>
      (state.minutes ?? []).filter(
        (m) =>
          m.createdBy === currentUser.id || m.participantIds.includes(currentUser.id),
      ),
  };

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useFluxo() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useFluxo must be used inside FluxoProvider");
  return ctx;
}
