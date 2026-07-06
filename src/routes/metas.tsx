import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Target, Trash2, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { freqLabels, sectors, type Frequency, type Meta } from "@/lib/fluxo-types";

export const Route = createFileRoute("/metas")({
  head: () => ({
    meta: [
      { title: "Metas · Fluxo" },
      { name: "description", content: "Metas por colaborador e setor, com progresso em tempo real." },
    ],
  }),
  component: MetasPage,
});

function periodRange(period: Frequency): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (period === "diaria") {
    end.setDate(start.getDate() + 1);
    return { start, end, label: "hoje" };
  }
  if (period === "semanal") {
    const dow = start.getDay();
    start.setDate(start.getDate() - dow);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
    return { start, end, label: "esta semana" };
  }
  start.setDate(1);
  end.setTime(start.getTime());
  end.setMonth(start.getMonth() + 1);
  return { start, end, label: "este mês" };
}

function MetasPage() {
  const { metas, users, completions, currentUser, upsertMeta, removeMeta } = useFluxo();
  const [showDialog, setShowDialog] = useState(false);

  const rows = useMemo(() => {
    return metas.map((m) => {
      const range = periodRange(m.period);
      const inRange = completions.filter((c) => {
        const t = new Date(c.at).getTime();
        return t >= range.start.getTime() && t < range.end.getTime();
      });
      const matched =
        m.scope === "user"
          ? inRange.filter((c) => c.userId === m.scopeId)
          : inRange.filter((c) => {
              const u = users.find((x) => x.id === c.userId);
              return u?.sector === m.scopeId;
            });
      const progress = m.metric === "tarefas" ? matched.length : matched.reduce((s, c) => s + c.points, 0);
      return { meta: m, progress, range };
    });
  }, [metas, completions, users]);

  const isGerente = currentUser.role === "gerente";

  return (
    <FluxoLayout title="Metas & Score">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Metas</h1>
            <p className="text-sm text-muted-foreground">
              Configure alvos por colaborador ou setor. Progresso é calculado a partir das conclusões reais.
            </p>
          </div>
          {isGerente && (
            <button
              onClick={() => setShowDialog(true)}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Nova meta
            </button>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-card py-16 text-center">
              <Target className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nenhuma meta configurada</p>
              <p className="text-xs text-muted-foreground">Comece definindo uma meta semanal para o time.</p>
            </div>
          )}
          {rows.map(({ meta, progress, range }) => {
            const target = meta.target;
            const pct = Math.min(100, (progress / target) * 100);
            const scopeName =
              meta.scope === "user"
                ? users.find((u) => u.id === meta.scopeId)?.name ?? "—"
                : sectors.find((s) => s.id === meta.scopeId)?.name ?? "—";
            const scopeColor =
              meta.scope === "sector" ? sectors.find((s) => s.id === meta.scopeId)?.color ?? "oklch(0.52 0.22 275)" : "oklch(0.52 0.22 275)";
            const done = progress >= target;
            return (
              <div key={meta.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: scopeColor }} />
                      {scopeName}
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {meta.scope === "user" ? "Colaborador" : "Setor"}
                      </span>
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {freqLabels[meta.period]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {progress} / {target} {meta.metric} {range.label}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${done ? "text-success" : "text-muted-foreground"}`}>
                      {Math.round(pct)}%
                    </span>
                    {isGerente && (
                      <button
                        onClick={() => confirm("Remover esta meta?") && removeMeta(meta.id)}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: done ? "var(--color-success)" : "var(--color-primary)",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showDialog && (
        <MetaDialog
          onClose={() => setShowDialog(false)}
          onSave={(m) => {
            upsertMeta(m);
            setShowDialog(false);
          }}
        />
      )}
    </FluxoLayout>
  );
}

function MetaDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (m: Omit<Meta, "id">) => void;
}) {
  const { users } = useFluxo();
  const [scope, setScope] = useState<Meta["scope"]>("user");
  const [scopeId, setScopeId] = useState<string>(users[0]?.id ?? "");
  const [period, setPeriod] = useState<Frequency>("semanal");
  const [metric, setMetric] = useState<Meta["metric"]>("tarefas");
  const [target, setTarget] = useState(5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Nova meta</h2>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block text-xs font-medium text-muted-foreground">
            Alvo
            <div className="mt-1 flex gap-2">
              <select value={scope} onChange={(e) => {
                const s = e.target.value as Meta["scope"];
                setScope(s);
                setScopeId(s === "user" ? users[0]?.id ?? "" : sectors[0]!.id);
              }} className="input flex-1 font-normal text-foreground">
                <option value="user">Colaborador</option>
                <option value="sector">Setor</option>
              </select>
              <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="input flex-1 font-normal text-foreground">
                {(scope === "user" ? users.map((u) => [u.id, u.name] as const) : sectors.map((s) => [s.id, s.name] as const)).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              Período
              <select value={period} onChange={(e) => setPeriod(e.target.value as Frequency)} className="input mt-1 font-normal text-foreground">
                {Object.entries(freqLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Métrica
              <select value={metric} onChange={(e) => setMetric(e.target.value as Meta["metric"])} className="input mt-1 font-normal text-foreground">
                <option value="tarefas">Tarefas</option>
                <option value="pontos">Pontos</option>
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Alvo
              <input type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="input mt-1 font-normal text-foreground" />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancelar</button>
          <button
            onClick={() => onSave({ scope, scopeId, period, metric, target })}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Salvar meta
          </button>
        </div>
      </div>
    </div>
  );
}