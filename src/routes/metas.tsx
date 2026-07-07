import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, FileText, Target, TrendingDown, TrendingUp } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors, type Task, type User } from "@/lib/fluxo-types";

export const Route = createFileRoute("/metas")({
  head: () => ({
    meta: [
      { title: "Metas & Score · Fluxo" },
      { name: "description", content: "Score automático baseado em tarefas diárias e mensais concluídas no prazo." },
    ],
  }),
  component: MetasPage,
});

type Period = "diaria" | "mensal";

interface TaskScore {
  task: Task;
  state: "on-time" | "late" | "pending" | "missed";
  points: number;
}

interface UserScore {
  user: User;
  assigned: number;
  points: number;
  onTime: number;
  late: number;
  pending: number;
  missed: number;
  pct: number;
  breakdown: TaskScore[];
}

function periodRange(period: Period, ref = new Date()): { start: Date; end: Date; label: string } {
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (period === "diaria") {
    end.setDate(start.getDate() + 1);
    return { start, end, label: start.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) };
  }
  start.setDate(1);
  end.setTime(start.getTime());
  end.setMonth(start.getMonth() + 1);
  return { start, end, label: start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) };
}

function scoreTask(task: Task, completionAt: string | null): TaskScore {
  const due = new Date(task.dueDate).getTime();
  const now = Date.now();
  if (task.status === "concluida") {
    const done = completionAt ? new Date(completionAt).getTime() : now;
    if (done <= due) return { task, state: "on-time", points: 1 };
    return { task, state: "late", points: 0.5 };
  }
  if (due < now) return { task, state: "missed", points: 0 };
  return { task, state: "pending", points: 0 };
}

function frequencyLabel(f: Period) {
  return f === "diaria" ? "diária" : "mensal";
}

function MetasPage() {
  const { tasks, users, completions, currentUser } = useFluxo();
  const [period, setPeriod] = useState<Period>("diaria");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const visibleUsers = useMemo(() => {
    if (currentUser.role === "gerente") return users;
    if (currentUser.role === "supervisor")
      return users.filter((u) => u.id === currentUser.id || u.supervisorId === currentUser.id);
    return users.filter((u) => u.id === currentUser.id);
  }, [users, currentUser]);

  const range = useMemo(() => periodRange(period), [period]);

  const scores: UserScore[] = useMemo(() => {
    return visibleUsers.map((u) => {
      const assigned = tasks.filter(
        (t) =>
          t.assigneeId === u.id &&
          t.frequency === period &&
          new Date(t.dueDate).getTime() >= range.start.getTime() &&
          new Date(t.dueDate).getTime() < range.end.getTime(),
      );
      const breakdown = assigned.map((t) => {
        const c = completions.find((x) => x.taskId === t.id);
        return scoreTask(t, c?.at ?? null);
      });
      const points = breakdown.reduce((s, b) => s + b.points, 0);
      return {
        user: u,
        assigned: assigned.length,
        points,
        onTime: breakdown.filter((b) => b.state === "on-time").length,
        late: breakdown.filter((b) => b.state === "late").length,
        pending: breakdown.filter((b) => b.state === "pending").length,
        missed: breakdown.filter((b) => b.state === "missed").length,
        pct: assigned.length ? (points / assigned.length) * 100 : 0,
        breakdown,
      };
    });
  }, [visibleUsers, tasks, completions, period, range]);

  const ranked = [...scores].sort((a, b) => b.pct - a.pct);
  const teamAssigned = scores.reduce((s, r) => s + r.assigned, 0);
  const teamPoints = scores.reduce((s, r) => s + r.points, 0);
  const teamPct = teamAssigned ? (teamPoints / teamAssigned) * 100 : 0;

  return (
    <FluxoLayout title="Metas & Score">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Metas & Score</h1>
            <p className="text-sm text-muted-foreground">
              Cada tarefa concluída no prazo conta cheia; concluída em atraso conta pela metade; não feita não conta.
              O score é a % de tarefas cumpridas sobre as atribuídas no período.
            </p>
          </div>
          <div className="inline-flex overflow-hidden rounded-md border border-border bg-card text-sm">
            {(["diaria", "mensal"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 font-medium ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              >
                {p === "diaria" ? "Diário" : "Mensal"}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-4">
          <KpiCard label={`Período (${frequencyLabel(period)})`} value={range.label} mono />
          <KpiCard label="Tarefas do período" value={teamAssigned} />
          <KpiCard
            label="Concluídas"
            value={`${scores.reduce((s, r) => s + r.onTime + r.late, 0)} / ${teamAssigned}`}
          />
          <KpiCard label="Score do time" value={`${teamPct.toFixed(0)}%`} highlight={teamPct >= 100} />
        </div>

        <section className="rounded-lg border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Ranking do período</h2>
              <p className="text-xs text-muted-foreground">Clique em um colaborador para ver o detalhamento.</p>
            </div>
            <span className="text-xs text-muted-foreground">
              {scores.length} {scores.length === 1 ? "colaborador" : "colaboradores"}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {ranked.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                <Target className="mx-auto mb-2 h-6 w-6" />
                Nenhuma tarefa {frequencyLabel(period)} atribuída no período.
              </li>
            )}
            {ranked.map((row) => {
              const sector = sectors.find((s) => s.id === row.user.sector);
              const good = row.pct >= 100;
              const bad = row.assigned > 0 && row.pct < 100;
              const isOpen = openUserId === row.user.id;
              return (
                <li key={row.user.id}>
                  <button
                    onClick={() => setOpenUserId(isOpen ? null : row.user.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-secondary/40"
                  >
                    <div
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                      style={{ background: sector?.color ?? "oklch(0.52 0.22 275)" }}
                    >
                      {row.user.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {row.user.name}
                        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {sector?.name ?? row.user.sector}
                        </span>
                      </div>
                       <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                         <span>
                           {row.onTime + row.late} de {row.assigned} {row.assigned === 1 ? "tarefa" : "tarefas"}
                         </span>
                         <span className="text-success">✓ {row.onTime} no prazo</span>
                        <span className="text-warning">◐ {row.late} em atraso</span>
                        <span>◌ {row.pending} pendente</span>
                        <span className="text-destructive">✗ {row.missed} perdida</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, row.pct)}%`,
                            background: good
                              ? "var(--color-success)"
                              : bad
                                ? "var(--color-destructive)"
                                : "var(--color-primary)",
                          }}
                        />
                      </div>
                    </div>
                    <div className="ml-3 flex w-20 flex-col items-end">
                      <div className={`text-lg font-semibold tabular-nums ${good ? "text-success" : bad ? "text-destructive" : ""}`}>
                        {row.pct.toFixed(0)}%
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        {good ? <TrendingUp className="h-3 w-3 text-success" /> : bad ? <TrendingDown className="h-3 w-3 text-destructive" /> : null}
                        {row.assigned === 0 ? "sem tarefas" : good ? "excelente" : bad ? "abaixo" : "regular"}
                      </div>
                    </div>
                  </button>
                  {isOpen && <UserBreakdown row={row} period={period} range={range} />}
                </li>
              );
            })}
          </ul>
        </section>

        <ExportMonthly users={visibleUsers} tasks={tasks} completions={completions} />
      </div>
    </FluxoLayout>
  );
}

function UserBreakdown({
  row,
  period,
  range,
}: {
  row: UserScore;
  period: Period;
  range: { label: string };
}) {
  return (
    <div className="border-t border-border bg-secondary/30 px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Tarefas {frequencyLabel(period)}s de <strong>{range.label}</strong>
        </span>
        <span>
          {row.onTime + row.late} de {row.assigned} concluídas
        </span>
      </div>
      {row.breakdown.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma tarefa nesse período.</p>
      ) : (
        <ul className="space-y-1">
          {row.breakdown.map((b) => (
            <li key={b.task.id} className="flex items-center justify-between rounded-md bg-card px-3 py-2 text-xs">
              <div className="min-w-0 flex-1 truncate">
                <span className="font-medium">{b.task.title}</span>
                <span className="ml-2 text-muted-foreground">
                  prazo {new Date(b.task.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </div>
              <StateBadge state={b.state} points={b.points} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: TaskScore["state"]; points?: number }) {
  const map: Record<TaskScore["state"], { label: string; className: string }> = {
    "on-time": { label: "No prazo", className: "bg-success/15 text-success" },
    late: { label: "Em atraso", className: "bg-warning/15 text-warning" },
    pending: { label: "Pendente", className: "bg-secondary text-muted-foreground" },
    missed: { label: "Perdida", className: "bg-destructive/15 text-destructive" },
  };
  const m = map[state];
  return (
    <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.className}`}>
      {m.label}
    </span>
  );
}

function KpiCard({ label, value, mono, highlight }: { label: string; value: string | number; mono?: boolean; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${highlight ? "border-success/40 bg-success/5" : "border-border bg-card"}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tracking-tight ${mono ? "capitalize" : ""}`}>{value}</div>
    </div>
  );
}

function ExportMonthly({
  users,
  tasks,
  completions,
}: {
  users: User[];
  tasks: Task[];
  completions: { taskId: string; at: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(users.map((u) => u.id)));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selected.size === users.length && users.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));
  const selectedUsers = () => users.filter((u) => selected.has(u.id));

  const buildUserData = (list: User[]) => {
    const range = periodRange("mensal");
    return list.map((u) => {
      const uTasks = tasks.filter(
        (t) =>
          t.assigneeId === u.id &&
          (t.frequency === "diaria" || t.frequency === "mensal") &&
          new Date(t.dueDate).getTime() >= range.start.getTime() &&
          new Date(t.dueDate).getTime() < range.end.getTime(),
      );
      const breakdown: TaskScore[] = uTasks.map((t) => {
        const c = completions.find((x) => x.taskId === t.id);
        return scoreTask(t, c?.at ?? null);
      });
      const points = breakdown.reduce((s, b) => s + b.points, 0);
      const pct = uTasks.length ? (points / uTasks.length) * 100 : 0;
      const onTime = breakdown.filter((b) => b.state === "on-time").length;
      const late = breakdown.filter((b) => b.state === "late").length;
      return { user: u, assigned: uTasks.length, points, pct, breakdown, onTime, late };
    });
  };

  const tierFor = (pct: number, assigned: number): string => {
    if (assigned === 0) return "Sem tarefas no período";
    if (pct >= 100) return "Excelência";
    if (pct >= 90) return "Superação";
    if (pct >= 80) return "Meta atingida";
    if (pct >= 50) return "Abaixo da meta";
    return "Crítico";
  };

  const exportCsv = () => {
    const list = selectedUsers();
    if (list.length === 0) return;
    setBusy(true);
    const range = periodRange("mensal");
    const rows: string[] = [];
    rows.push(["Colaborador", "Setor", "Frequência", "Tarefa", "Prazo", "Status"].join(";"));
    for (const u of list) {
      const uTasks = tasks.filter(
        (t) =>
          t.assigneeId === u.id &&
          (t.frequency === "diaria" || t.frequency === "mensal") &&
          new Date(t.dueDate).getTime() >= range.start.getTime() &&
          new Date(t.dueDate).getTime() < range.end.getTime(),
      );
      const breakdown: TaskScore[] = [];
      for (const t of uTasks) {
        const c = completions.find((x) => x.taskId === t.id);
        const b = scoreTask(t, c?.at ?? null);
        breakdown.push(b);
        rows.push(
          [
            escapeCsv(u.name),
            escapeCsv(u.sector),
            t.frequency,
            escapeCsv(t.title),
            new Date(t.dueDate).toLocaleDateString("pt-BR"),
            b.state,
          ].join(";"),
        );
      }
      const pts = breakdown.reduce((s, b) => s + b.points, 0);
      const pct = uTasks.length ? (pts / uTasks.length) * 100 : 0;
      rows.push(
        [
          escapeCsv(`>> TOTAL ${u.name}`),
          "",
          "",
          "",
          "",
          `${pct.toFixed(0)}%`,
        ].join(";"),
      );
    }
    const csv = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fluxo-score-${range.label.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  };

  const exportPdf = () => {
    const list = selectedUsers();
    if (list.length === 0) return;
    setBusyPdf(true);
    try {
      const range = periodRange("mensal");
      const data = buildUserData(list);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;

      const primary: [number, number, number] = [37, 99, 235];
      const dark: [number, number, number] = [17, 24, 39];
      const muted: [number, number, number] = [107, 114, 128];
      const success: [number, number, number] = [22, 163, 74];
      const danger: [number, number, number] = [220, 38, 38];

      const drawHeader = (subtitle: string) => {
        doc.setFillColor(...primary);
        doc.rect(0, 0, pageW, 90, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("FLUXO", margin, 42);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Relatório de Produtividade", margin, 60);
        doc.setFontSize(9);
        doc.text(subtitle, margin, 76);
        doc.setTextColor(...dark);
      };

      const drawFooter = () => {
        const pages = doc.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i);
          doc.setDrawColor(230);
          doc.line(margin, pageH - 42, pageW - margin, pageH - 42);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(
            `Fluxo · Documento gerado em ${new Date().toLocaleString("pt-BR")}`,
            margin,
            pageH - 26,
          );
          doc.text(`Página ${i} de ${pages}`, pageW - margin, pageH - 26, { align: "right" });
        }
      };

      // ============ COVER ============
      drawHeader(`Competência: ${range.label}`);

      const teamAssigned = data.reduce((s, r) => s + r.assigned, 0);
      const teamPoints = data.reduce((s, r) => s + r.points, 0);
      const teamPct = teamAssigned ? (teamPoints / teamAssigned) * 100 : 0;
      const onTimeTotal = data.reduce(
        (s, r) => s + r.breakdown.filter((b) => b.state === "on-time").length,
        0,
      );

      let y = 130;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...dark);
      doc.text("Resumo executivo do mês", margin, y);
      y += 8;
      doc.setDrawColor(...primary);
      doc.setLineWidth(2);
      doc.line(margin, y, margin + 60, y);
      y += 24;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...muted);
      const introLines = doc.splitTextToSize(
        "Este relatório consolida o desempenho no período com base nas tarefas atribuídas e concluídas. Concluir no prazo conta como tarefa cheia, concluir em atraso conta pela metade, e não concluir não conta. O score é a razão entre tarefas cumpridas e tarefas atribuídas.",
        pageW - margin * 2,
      );
      doc.text(introLines, margin, y);
      y += introLines.length * 13 + 14;

      // KPI cards
      const kpis = [
        { label: "Score do time", value: `${teamPct.toFixed(0)}%`, accent: teamPct >= 100 ? success : teamAssigned ? danger : muted },
        { label: "Tarefas atribuídas", value: String(teamAssigned), accent: dark },
        { label: "Concluídas", value: `${data.reduce((s, r) => s + r.onTime + r.late, 0)}/${teamAssigned}`, accent: primary },
        { label: "No prazo", value: `${onTimeTotal}/${teamAssigned}`, accent: success },
      ];
      const cardW = (pageW - margin * 2 - 12 * 3) / 4;
      kpis.forEach((k, i) => {
        const x = margin + i * (cardW + 12);
        doc.setDrawColor(230);
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(x, y, cardW, 68, 6, 6, "FD");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text(k.label.toUpperCase(), x + 12, y + 18);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(...(k.accent as [number, number, number]));
        doc.text(k.value, x + 12, y + 44);
      });
      y += 90;

      // Ranking table
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [["#", "Colaborador", "Setor", "Atribuídas", "Concluídas", "Score", "Classificação"]],
        body: [...data]
          .sort((a, b) => b.pct - a.pct)
          .map((r, i) => {
            return [
              String(i + 1),
              r.user.name,
              sectors.find((s) => s.id === r.user.sector)?.name ?? r.user.sector,
              String(r.assigned),
              String(r.onTime + r.late),
              `${r.pct.toFixed(0)}%`,
              tierFor(r.pct, r.assigned),
            ];
          }),
        styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: dark },
        headStyles: { fillColor: primary, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 26, halign: "center" },
          3: { halign: "center" },
          4: { halign: "center" },
          5: { halign: "center", fontStyle: "bold" },
          6: { halign: "right", fontStyle: "bold", textColor: dark },
        },
      });

      // ============ PER-USER PAGES ============
      const sorted = [...data].sort((a, b) => b.pct - a.pct);
      for (const row of sorted) {
        doc.addPage();
        drawHeader(`Competência: ${range.label}`);
        const tier = tierFor(row.pct, row.assigned);
        let yy = 130;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(...dark);
        doc.text(row.user.name, margin, yy);
        yy += 20;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...muted);
        doc.text(
          `${row.user.jobTitle} · ${sectors.find((s) => s.id === row.user.sector)?.name ?? row.user.sector}`,
          margin,
          yy,
        );
        yy += 24;

        // Score highlight box
        const boxColor: [number, number, number] =
          row.assigned === 0 ? muted : row.pct >= 100 ? success : danger;
        doc.setFillColor(...boxColor);
        doc.roundedRect(margin, yy, pageW - margin * 2, 76, 8, 8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text("SCORE DO MÊS", margin + 20, yy + 22);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(32);
        doc.text(`${row.pct.toFixed(0)}%`, margin + 20, yy + 56);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(tier, pageW - margin - 20, yy + 30, { align: "right" });
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(
          `${row.onTime + row.late} / ${row.assigned} tarefas`,
          pageW - margin - 20,
          yy + 58,
          { align: "right" },
        );
        doc.setTextColor(...dark);
        yy += 96;

        // Stats row
        const onTime = row.breakdown.filter((x) => x.state === "on-time").length;
        const late = row.breakdown.filter((x) => x.state === "late").length;
        const pending = row.breakdown.filter((x) => x.state === "pending").length;
        const missed = row.breakdown.filter((x) => x.state === "missed").length;
        const stats = [
          { l: "No prazo", v: onTime, c: success },
          { l: "Em atraso", v: late, c: [217, 119, 6] as [number, number, number] },
          { l: "Pendentes", v: pending, c: muted },
          { l: "Perdidas", v: missed, c: danger },
        ];
        const sw = (pageW - margin * 2 - 12 * 3) / 4;
        stats.forEach((s, i) => {
          const x = margin + i * (sw + 12);
          doc.setDrawColor(230);
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, yy, sw, 56, 6, 6, "FD");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(s.l.toUpperCase(), x + 10, yy + 16);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(18);
          doc.setTextColor(...s.c);
          doc.text(String(s.v), x + 10, yy + 40);
        });
        yy += 76;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...dark);
        doc.text("Detalhamento das tarefas", margin, yy);
        yy += 10;

        const stateLabel: Record<TaskScore["state"], string> = {
          "on-time": "No prazo",
          late: "Em atraso",
          pending: "Pendente",
          missed: "Perdida",
        };

        autoTable(doc, {
          startY: yy,
          margin: { left: margin, right: margin },
          head: [["Tarefa", "Frequência", "Prazo", "Status"]],
          body:
            row.breakdown.length === 0
              ? [[{ content: "Nenhuma tarefa atribuída no período.", colSpan: 4, styles: { halign: "center", textColor: muted } }]]
              : row.breakdown.map((x) => [
                  x.task.title,
                  x.task.frequency === "diaria" ? "Diária" : x.task.frequency === "mensal" ? "Mensal" : "Semanal",
                  new Date(x.task.dueDate).toLocaleDateString("pt-BR"),
                  stateLabel[x.state],
                ]),
          styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: dark },
          headStyles: { fillColor: [243, 244, 246], textColor: dark, fontStyle: "bold" },
          columnStyles: {
            1: { cellWidth: 60, halign: "center" },
            2: { cellWidth: 70, halign: "center" },
            3: { cellWidth: 70, halign: "center" },
          },
        });

        // Signature block
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 40;
        if (finalY < pageH - 120) {
          doc.setDrawColor(200);
          doc.line(margin, finalY, margin + 200, finalY);
          doc.line(pageW - margin - 200, finalY, pageW - margin, finalY);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(...muted);
          doc.text("Colaborador(a)", margin, finalY + 14);
          doc.text("Gestor responsável", pageW - margin - 200, finalY + 14);
        }
      }

      drawFooter();
      const stamp = range.label.replace(/\s+/g, "-").toLowerCase();
      const filename =
        list.length === 1
          ? `fluxo-score-${list[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}.pdf`
          : `fluxo-score-${stamp}.pdf`;
      doc.save(filename);
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <section className="rounded-lg border border-dashed border-border bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="text-sm font-semibold">Relatório mensal exportável</h2>
          <p className="text-xs text-muted-foreground">
            Selecione um ou mais colaboradores e gere um <strong>PDF profissional</strong> com capa, ranking e uma
            página de detalhamento por pessoa. Também disponível como planilha CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportPdf}
            disabled={busyPdf || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            {busyPdf ? "Gerando..." : `Exportar PDF (${selected.size})`}
          </button>
          <button
            onClick={exportCsv}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 accent-primary"
            />
            Selecionar todos
          </label>
          <span className="text-muted-foreground">
            {selected.size} de {users.length} selecionado{selected.size === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="grid gap-0 sm:grid-cols-2">
          {users.map((u) => {
            const sector = sectors.find((s) => s.id === u.sector);
            const checked = selected.has(u.id);
            return (
              <li key={u.id} className="border-b border-border last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-secondary/40">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(u.id)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <div
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: sector?.color ?? "oklch(0.52 0.22 275)" }}
                  >
                    {u.avatar}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {u.jobTitle} · {sector?.name ?? u.sector}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function escapeCsv(s: string): string {
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
