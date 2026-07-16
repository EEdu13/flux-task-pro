import { useState } from "react";
import { Plus, Trash2, Palette, StickyNote, Settings2, X, Check } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { statusColor, statusLabels, type Task } from "@/lib/fluxo-types";
import { COLOR_PALETTE, useMyView, type ColumnType } from "@/lib/my-view-store";

function fmtDue(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function MyView({
  tasks,
  onEdit,
}: {
  tasks: Task[];
  onEdit: (id: string) => void;
}) {
  const { currentUser, users } = useFluxo();
  const view = useMyView(currentUser.id);
  const [managing, setManaging] = useState(false);
  const [newCol, setNewCol] = useState<{ name: string; type: ColumnType; options: string }>({
    name: "",
    type: "text",
    options: "",
  });
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState<string | null>(null);

  const submitNewCol = () => {
    const name = newCol.name.trim();
    if (!name) return;
    view.addColumn({
      name,
      type: newCol.type,
      options:
        newCol.type === "select"
          ? newCol.options
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    });
    setNewCol({ name: "", type: "text", options: "" });
  };

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">Minha visão</div>
          <div className="text-[11px] text-muted-foreground">
            Colunas, cores e anotações pessoais — só você vê. Salvo neste dispositivo.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setManaging((m) => !m)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-secondary"
        >
          <Settings2 className="h-3.5 w-3.5" /> {managing ? "Fechar colunas" : "Gerenciar colunas"}
        </button>
      </div>

      {managing && (
        <div className="border-b border-border bg-background px-4 py-3">
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Colunas personalizadas</div>
          <div className="flex flex-wrap gap-2">
            {view.columns.map((c) => (
              <div
                key={c.id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs"
              >
                <input
                  value={c.name}
                  onChange={(e) => view.updateColumn(c.id, { name: e.target.value })}
                  className="w-28 bg-transparent outline-none"
                />
                <span className="text-[10px] text-muted-foreground">{c.type}</span>
                <button
                  onClick={() => view.removeColumn(c.id)}
                  className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  title="Remover coluna"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="text-xs">
              <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Nome</div>
              <input
                value={newCol.name}
                onChange={(e) => setNewCol((c) => ({ ...c, name: e.target.value }))}
                placeholder="Ex.: Etapa, Cliente…"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              />
            </label>
            <label className="text-xs">
              <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Tipo</div>
              <select
                value={newCol.type}
                onChange={(e) => setNewCol((c) => ({ ...c, type: e.target.value as ColumnType }))}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
              >
                <option value="text">Texto</option>
                <option value="number">Número</option>
                <option value="select">Lista</option>
              </select>
            </label>
            {newCol.type === "select" && (
              <label className="flex-1 text-xs">
                <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  Opções (separadas por vírgula)
                </div>
                <input
                  value={newCol.options}
                  onChange={(e) => setNewCol((c) => ({ ...c, options: e.target.value }))}
                  placeholder="Ex.: Alta, Média, Baixa"
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                />
              </label>
            )}
            <button
              onClick={submitNewCol}
              disabled={!newCol.name.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar coluna
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="w-6 py-2 pl-3"></th>
              <th className="py-2 pr-3">Título</th>
              <th className="w-28 py-2 pr-3">Status</th>
              <th className="w-24 py-2 pr-3">Prazo</th>
              <th className="w-40 py-2 pr-3">Responsável</th>
              {view.columns.map((c) => (
                <th key={c.id} className="w-40 py-2 pr-3">
                  {c.name}
                </th>
              ))}
              <th className="w-24 py-2 pr-3 text-right">Nota</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const m = view.meta[t.id] ?? {};
              const rowCells = view.cells[t.id] ?? {};
              const assignee = users.find((u) => u.id === t.assigneeId);
              return (
                <tr
                  key={t.id}
                  className="group border-b border-border/60 align-top last:border-0 hover:bg-primary/5"
                  style={m.color ? { boxShadow: `inset 4px 0 0 ${m.color}` } : undefined}
                >
                  <td className="relative py-2 pl-3">
                    <button
                      onClick={() => setColorOpen((v) => (v === t.id ? null : t.id))}
                      className="rounded p-1 text-muted-foreground hover:bg-secondary"
                      title="Cor da linha"
                    >
                      <Palette className="h-3.5 w-3.5" style={m.color ? { color: m.color } : undefined} />
                    </button>
                    {colorOpen === t.id && (
                      <div className="absolute left-3 top-8 z-20 flex flex-wrap gap-1 rounded-md border border-border bg-popover p-2 shadow-2xl">
                        {COLOR_PALETTE.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              view.setMetaFor(t.id, { color: c.value || undefined });
                              setColorOpen(null);
                            }}
                            title={c.label}
                            className="h-5 w-5 rounded-full border border-border"
                            style={{ background: c.value || "transparent" }}
                          >
                            {!c.value && <X className="h-3 w-3" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => onEdit(t.id)}
                      className="text-left text-sm font-medium hover:text-primary"
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: statusColor[t.status] }}
                    >
                      {statusLabels[t.status]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{fmtDue(t.dueDate)}</td>
                  <td className="py-2 pr-3 text-xs">{assignee?.name ?? "—"}</td>
                  {view.columns.map((c) => (
                    <td key={c.id} className="py-1.5 pr-3">
                      {c.type === "select" ? (
                        <select
                          value={rowCells[c.id] ?? ""}
                          onChange={(e) => view.setCell(t.id, c.id, e.target.value)}
                          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                        >
                          <option value="">—</option>
                          {(c.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={rowCells[c.id] ?? ""}
                          onChange={(e) => view.setCell(t.id, c.id, e.target.value)}
                          inputMode={c.type === "number" ? "numeric" : undefined}
                          className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-xs outline-none hover:border-border focus:border-primary focus:bg-background"
                          placeholder="—"
                        />
                      )}
                    </td>
                  ))}
                  <td className="relative py-2 pr-3 text-right">
                    <button
                      onClick={() => setNoteOpen((v) => (v === t.id ? null : t.id))}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                        m.note
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <StickyNote className="h-3 w-3" />
                      {m.note ? "Nota" : "Anotar"}
                    </button>
                    {noteOpen === t.id && (
                      <div className="absolute right-3 top-9 z-20 w-72 rounded-md border border-border bg-popover p-2 shadow-2xl">
                        <textarea
                          value={m.note ?? ""}
                          onChange={(e) => view.setMetaFor(t.id, { note: e.target.value })}
                          placeholder="Anotação pessoal…"
                          className="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-primary"
                        />
                        <div className="mt-1 flex justify-end gap-1">
                          <button
                            onClick={() => {
                              view.setMetaFor(t.id, { note: undefined });
                              setNoteOpen(null);
                            }}
                            className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary"
                          >
                            Limpar
                          </button>
                          <button
                            onClick={() => setNoteOpen(null)}
                            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground hover:brightness-110"
                          >
                            <Check className="h-3 w-3" /> Ok
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={5 + view.columns.length + 1} className="py-8 text-center text-xs text-muted-foreground">
                  Nenhuma tarefa no filtro atual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}