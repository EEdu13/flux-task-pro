import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, statusLabels } from "@/lib/fluxo-types";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios · Fluxo" },
      { name: "description", content: "Desempenho por pessoa, setor e evolução ao longo do tempo." },
    ],
  }),
  component: Relatorios,
});

function Relatorios() {
  const { tasks, users, completions } = useFluxo();

  const last30 = useMemo(() => {
    const days: { label: string; concluidas: number; pontos: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const end = new Date(d);
      end.setDate(d.getDate() + 1);
      const items = completions.filter((c) => {
        const t = new Date(c.at).getTime();
        return t >= d.getTime() && t < end.getTime();
      });
      days.push({
        label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        concluidas: items.length,
        pontos: items.reduce((s, c) => s + c.points, 0),
      });
    }
    return days;
  }, [completions]);

  const byUser = useMemo(() => {
    return users
      .map((u) => ({
        name: u.name.split(" ")[0]!,
        concluidas: completions.filter((c) => c.userId === u.id).length,
        pontos: completions.filter((c) => c.userId === u.id).reduce((s, c) => s + c.points, 0),
      }))
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 8);
  }, [users, completions]);

  const bySector = useMemo(() => {
    return sectors.map((s) => {
      const uids = users.filter((u) => u.sector === s.id).map((u) => u.id);
      const total = completions.filter((c) => uids.includes(c.userId)).reduce((sum, c) => sum + c.points, 0);
      return { name: s.name, value: total, color: s.color };
    });
  }, [users, completions]);

  const statusDist = useMemo(() => {
    return (Object.keys(statusLabels) as (keyof typeof statusLabels)[]).map((k) => ({
      name: statusLabels[k],
      value: tasks.filter((t) => t.status === k).length,
    }));
  }, [tasks]);

  return (
    <FluxoLayout title="Relatórios">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Desempenho dos últimos 30 dias, por pessoa, setor e status.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Kpi label="Tarefas concluídas (30d)" value={completions.length} />
          <Kpi label="Pontos gerados (30d)" value={completions.reduce((s, c) => s + c.points, 0).toLocaleString("pt-BR")} />
          <Kpi label="No prazo" value={`${Math.round((completions.filter((c) => c.onTime).length / Math.max(1, completions.length)) * 100)}%`} />
          <Kpi label="Tarefas abertas" value={tasks.filter((t) => t.status !== "concluida").length} />
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Evolução — últimos 30 dias</h2>
          <div className="mt-3 h-72">
            <ResponsiveContainer>
              <LineChart data={last30} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={3} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="concluidas" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} name="Concluídas" />
                <Line type="monotone" dataKey="pontos" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} name="Pontos" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Top pessoas (pontos)</h2>
            <div className="mt-3 h-72">
              <ResponsiveContainer>
                <BarChart data={byUser} margin={{ left: -10, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                  <Bar dataKey="pontos" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Pontos por setor</h2>
            <div className="mt-3 h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={bySector} dataKey="value" nameKey="name" outerRadius={90} label={{ fontSize: 10 }}>
                    {bySector.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Distribuição por status</h2>
          <div className="mt-3 h-56">
            <ResponsiveContainer>
              <BarChart data={statusDist} layout="vertical" margin={{ left: 40, right: 20, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Bar dataKey="value" fill="var(--color-chart-3)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </FluxoLayout>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}