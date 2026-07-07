import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels, sectors, type Role, type User } from "@/lib/fluxo-types";
import { userScorePct, scoreTextClass } from "@/lib/score";
import { ScoreBar } from "@/components/score-bar";

export const Route = createFileRoute("/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe · Fluxo" },
      { name: "description", content: "Gerencie colaboradores, cargos, setores e supervisores." },
    ],
  }),
  component: EquipePage,
});

function EquipePage() {
  const { users, currentUser, createUser, updateUser, deleteUser, tasks, completions } = useFluxo();
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const isGerente = currentUser.role === "gerente";

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
                <th className="py-2 pr-4 text-right">Tarefas ativas</th>
                <th className="py-2 pr-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const sup = users.find((x) => x.id === u.supervisorId);
                const sec = sectors.find((s) => s.id === u.sector);
                const activeTasks = tasks.filter((t) => t.assigneeId === u.id && t.status !== "concluida").length;
                const s = userScorePct(u.id, tasks, completions);
                return (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                    <td className="py-2.5 pl-4 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                          {u.avatar}
                        </span>
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
                    <td className="py-2.5 pr-4 text-right text-xs">{activeTasks}</td>
                    <td className="py-2.5 pr-4 text-right">
                      {isGerente && (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditing(u)}
                            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (u.id === currentUser.id) return alert("Você não pode excluir seu próprio usuário simulado.");
                              if (confirm(`Remover ${u.name}? Tarefas dele(a) serão reatribuídas ao gerente.`)) {
                                deleteUser(u.id);
                              }
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
            Somente perfis Gerente podem editar a equipe. Troque para "Carla Mendes (Gerente)" no menu lateral pra testar.
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
    </FluxoLayout>
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