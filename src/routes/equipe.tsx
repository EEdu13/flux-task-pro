import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarRange, Pencil, Plus, Trash2, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import {
  roleLabels,
  sectors,
  statusColor,
  statusLabels,
  type Role,
  type Task,
  type User,
} from "@/lib/fluxo-types";
import { userScorePct, scoreTextClass } from "@/lib/score";
import { ScoreBar } from "@/components/score-bar";
import { UserAvatar } from "@/components/user-avatar";
import { confirmar } from "@/components/confirm-dialog";
import { CampoData } from "@/components/campo-data";
import { toast } from "sonner";

export const Route = createFileRoute("/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe · Fluxo" },
      { name: "description", content: "Gerencie colaboradores, cargos, setores e supervisores." },
    ],
  }),
  component: EquipePage,
});

type DatePreset =
  | "todas"
  | "ontem"
  | "hoje"
  | "amanha"
  | "esta-semana"
  | "sem-passada"
  | "este-mes"
  | "mes-passado"
  | "entre";

const presetLabels: Record<DatePreset, string> = {
  todas: "Todas as datas",
  ontem: "Ontem",
  hoje: "Hoje",
  amanha: "Amanhã",
  "esta-semana": "Esta semana",
  "sem-passada": "Semana passada",
  "este-mes": "Este mês",
  "mes-passado": "Mês passado",
  entre: "Entre datas…",
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // segunda
  x.setDate(x.getDate() - diff);
  return x;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  return endOfDay(s);
}
function startOfMonth(d: Date) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
function endOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return endOfDay(x);
}

function dateRangeFor(preset: DatePreset, from?: string, to?: string): [number, number] | null {
  const now = new Date();
  if (preset === "todas") return null;
  if (preset === "hoje") return [startOfDay(now).getTime(), endOfDay(now).getTime()];
  if (preset === "amanha") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "ontem") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }
  if (preset === "esta-semana") return [startOfWeek(now).getTime(), endOfWeek(now).getTime()];
  if (preset === "sem-passada") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return [startOfWeek(d).getTime(), endOfWeek(d).getTime()];
  }
  if (preset === "este-mes") return [startOfMonth(now).getTime(), endOfMonth(now).getTime()];
  if (preset === "mes-passado") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    return [startOfMonth(d).getTime(), endOfMonth(d).getTime()];
  }
  if (preset === "entre") {
    if (!from || !to) return null;
    return [startOfDay(new Date(from)).getTime(), endOfDay(new Date(to)).getTime()];
  }
  return null;
}

function EquipePage() {
  const { users, currentUser, createUser, updateUser, deleteUser, tasks, completions } = useFluxo();
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [preset, setPreset] = useState<DatePreset>("todas");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);

  const isGerente = currentUser.role === "gerente";

  const range = useMemo(
    () => dateRangeFor(preset, fromDate, toDate),
    [preset, fromDate, toDate],
  );

  const inRange = (t: Task) => {
    if (!range) return true;
    const due = new Date(t.dueDate).getTime();
    return due >= range[0] && due <= range[1];
  };

  const filteredTasks = useMemo(() => tasks.filter(inRange), [tasks, range]);

  const viewingUser = viewingUserId ? users.find((u) => u.id === viewingUserId) ?? null : null;

  return (
    <FluxoLayout title="Equipe">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Equipe</h1>
            <p className="text-sm text-muted-foreground">
              {users.length} pessoas, {sectors.length} setores.
            </p>
          </div>
          {isGerente && (
            <button
              onClick={() => setEditing("new")}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Novo colaborador
            </button>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <CalendarRange className="h-3.5 w-3.5" />
            Filtrar tarefas por prazo
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(Object.keys(presetLabels) as DatePreset[]).map((k) => {
              const active = preset === k;
              return (
                <button
                  key={k}
                  onClick={() => setPreset(k)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {presetLabels[k]}
                </button>
              );
            })}
            {preset === "entre" && (
              <div className="ml-1 inline-flex items-center gap-1.5 text-[11px]">
                <CampoData
                  value={fromDate}
                  onChange={setFromDate}
                  placeholder="Início"
                  title="Data inicial"
                  className="py-1"
                />
                <span className="text-muted-foreground">até</span>
                <CampoData
                  value={toDate}
                  onChange={setToDate}
                  placeholder="Fim"
                  title="Data final"
                  className="py-1"
                />
              </div>
            )}
          </div>
          {range && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Mostrando tarefas com prazo entre{" "}
              <b>{new Date(range[0]).toLocaleDateString("pt-BR")}</b> e{" "}
              <b>{new Date(range[1]).toLocaleDateString("pt-BR")}</b>. Clique numa pessoa para
              ver as tarefas dela.
            </p>
          )}
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-border bg-secondary/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pl-4 pr-4">Pessoa</th>
                <th className="py-2 pr-4">Cargo</th>
                <th className="py-2 pr-4">Setor</th>
                <th className="py-2 pr-4">Perfil</th>
                <th className="py-2 pr-4">Supervisor</th>
                <th className="py-2 pr-4 text-right">Score do mês</th>
                <th className="py-2 pr-4 text-right">
                  Tarefas {range ? "no período" : "ativas"}
                </th>
                <th className="py-2 pr-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const sup = users.find((x) => x.id === u.supervisorId);
                const sec = sectors.find((s) => s.id === u.sector);
                const userTasks = filteredTasks.filter((t) => t.assigneeId === u.id);
                const taskCount = range
                  ? userTasks.length
                  : userTasks.filter((t) => t.status !== "concluida").length;
                const s = userScorePct(u.id, tasks, completions);
                return (
                  <tr
                    key={u.id}
                    onClick={() => setViewingUserId(u.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/40"
                  >
                    <td className="py-2.5 pl-4 pr-4">
                      <div className="flex items-center gap-2">
                        <UserAvatar
                          nome={u.name}
                          iniciais={u.avatar}
                          className="h-8 w-8 text-xs"
                        />
                        <div>
                          <div className="text-sm font-medium">{u.name}</div>
                          <div className="text-[10px] text-muted-foreground">{u.jobTitle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{u.jobTitle}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
                        style={{
                          background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                          color: sec?.color,
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: sec?.color }} />
                        {sec?.name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs">{roleLabels[u.role]}</td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{sup?.name ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <div className="ml-auto flex w-32 flex-col items-end gap-1">
                        <span className={`text-xs font-semibold tabular-nums ${scoreTextClass(s.pct, s.assigned)}`}>
                          {s.assigned === 0 ? "—" : `${Math.round(s.pct)}%`}
                        </span>
                        <ScoreBar pct={s.pct} assigned={s.assigned} showLabel={false} size="sm" />
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-semibold">
                        {taskCount}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {isGerente && (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditing(u)}
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (u.id === currentUser.id) {
                                toast.error("Você não pode remover a si mesmo");
                                return;
                              }
                              const ok = await confirmar({
                                titulo: `Remover ${u.name.split(" ")[0]} da equipe?`,
                                descricao:
                                  "As tarefas dessa pessoa serão reatribuídas ao gerente. Não dá para desfazer.",
                                confirmar: "Remover",
                                perigo: true,
                              });
                              if (!ok) return;
                              deleteUser(u.id);
                              toast.success(`${u.name.split(" ")[0]} removido da equipe`);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isGerente && (
          <p className="mt-3 text-xs text-muted-foreground">
            Somente perfis Gerente podem editar a equipe. Se precisar de alguma alteração
            aqui, fale com quem tem esse perfil.
          </p>
        )}
      </div>

      {editing && (
        <UserDialog
          user={editing === "new" ? null : editing}
          users={users}
          onClose={() => setEditing(null)}
          onSave={(payload) => {
            if (editing === "new") createUser(payload);
            else updateUser(editing.id, payload);
            setEditing(null);
          }}
        />
      )}

      {viewingUser && (
        <UserTasksDrawer
          user={viewingUser}
          tasks={filteredTasks.filter((t) => t.assigneeId === viewingUser.id)}
          rangeLabel={presetLabels[preset]}
          onClose={() => setViewingUserId(null)}
        />
      )}
    </FluxoLayout>
  );
}

function UserTasksDrawer({
  user,
  tasks,
  rangeLabel,
  onClose,
}: {
  user: User;
  tasks: Task[];
  rangeLabel: string;
  onClose: () => void;
}) {
  const { openTask } = useFluxo();
  const sec = sectors.find((s) => s.id === user.sector);
  const grouped = useMemo(() => {
    const g: Record<string, Task[]> = {};
    for (const t of tasks) {
      (g[t.status] ||= []).push(t);
    }
    return g;
  }, [tasks]);
  const order: (keyof typeof statusLabels)[] = ["pendente", "andamento", "concluida"];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <UserAvatar
              nome={user.name}
              iniciais={user.avatar}
              className="h-11 w-11 text-sm"
            />
            <div>
              <div className="text-base font-semibold">{user.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {user.jobTitle} · {sec?.name}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <CalendarRange className="h-3 w-3" />
                {rangeLabel} — {tasks.length} tarefa{tasks.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa atribuída a {user.name.split(" ")[0]} nesse período.
            </div>
          ) : (
            <div className="space-y-4">
              {order.map((st) => {
                const list = grouped[st] ?? [];
                if (list.length === 0) return null;
                return (
                  <section key={st}>
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: statusColor[st] }}
                      />
                      <span style={{ color: statusColor[st] }}>{statusLabels[st]}</span>
                      <span className="text-muted-foreground">({list.length})</span>
                    </div>
                    <ul className="space-y-1.5">
                      {list
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
                        )
                        .map((t) => (
                          <li key={t.id}>
                            <button
                              onClick={() => {
                                openTask(t.id);
                              }}
                              className="flex w-full items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm transition hover:border-primary/40 hover:bg-secondary"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{t.title}</div>
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>
                                    Prazo{" "}
                                    {new Date(t.dueDate).toLocaleDateString("pt-BR", {
                                      day: "2-digit",
                                      month: "short",
                                    })}
                                  </span>
                                  {t.tags.length > 0 && (
                                    <span className="truncate">· {t.tags.join(", ")}</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserDialog({
  user,
  users,
  onClose,
  onSave,
}: {
  user: User | null;
  users: User[];
  onClose: () => void;
  onSave: (u: Omit<User, "id" | "score" | "streak">) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "adm");
  const [sector, setSector] = useState<string>(user?.sector ?? sectors[0]!.id);
  const [supervisorId, setSupervisorId] = useState<string>(user?.supervisorId ?? "");
  const [avatar, setAvatar] = useState(user?.avatar ?? "");

  const supervisors = users.filter((u) => u.role === "gerente" || u.role === "supervisor");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">{user ? `Editar ${user.name}` : "Novo colaborador"}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          <label className="col-span-2 text-xs font-medium text-muted-foreground">
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} className="input mt-1 font-normal text-foreground" autoFocus />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Cargo
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className="input mt-1 font-normal text-foreground" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Iniciais (avatar)
            <input value={avatar} maxLength={3} onChange={(e) => setAvatar(e.target.value.toUpperCase())} className="input mt-1 font-normal text-foreground uppercase" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Perfil
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="input mt-1 font-normal text-foreground">
              {(Object.entries(roleLabels) as [Role, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Setor
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="input mt-1 font-normal text-foreground">
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 text-xs font-medium text-muted-foreground">
            Supervisor (opcional)
            <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className="input mt-1 font-normal text-foreground">
              <option value="">Sem supervisor</option>
              {supervisors.filter((s) => s.id !== user?.id).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {roleLabels[s.role]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!name.trim()) return;
              const iniciais = avatar || name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
              onSave({
                name: name.trim(),
                jobTitle: jobTitle.trim() || roleLabels[role],
                role,
                sector,
                avatar: iniciais,
                supervisorId: supervisorId || undefined,
              });
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            {user ? "Salvar" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}