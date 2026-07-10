import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  FileText,
  Users as UsersIcon,
  Clock,
  Trash2,
  Copy,
  ListChecks,
  ArrowRight,
  CheckCircle2,
  Search,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import type { MeetingMinute, MinuteTopic } from "@/lib/fluxo-types";
import { toast } from "sonner";

export const Route = createFileRoute("/atas")({
  component: AtasPage,
  head: () => ({
    meta: [
      { title: "Atas & Planos — Fluxo" },
      {
        name: "description",
        content:
          "Atas das reuniões geradas por IA e planos de ação. Transforme tópicos em tarefas com um clique.",
      },
    ],
  }),
});

const kindLabel: Record<MinuteTopic["kind"], string> = {
  decisao: "Decisão",
  proximo: "Próximo passo",
  atencao: "Atenção",
};

const kindStyle: Record<MinuteTopic["kind"], string> = {
  decisao: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  proximo: "bg-primary/15 text-primary border-primary/30",
  atencao: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

function AtasPage() {
  const { visibleMinutes, users, minuteTopicToTask, deleteMinute, openTask } = useFluxo();
  const minutes = visibleMinutes();
  const [selectedId, setSelectedId] = useState<string | null>(minutes[0]?.id ?? null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return minutes;
    return minutes.filter(
      (m) =>
        m.roomLabel.toLowerCase().includes(query) ||
        m.markdown.toLowerCase().includes(query) ||
        m.participantNames.some((n) => n.toLowerCase().includes(query)),
    );
  }, [minutes, q]);

  const selected =
    filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? null;

  return (
    <FluxoLayout
      title="Atas & Planos"
      breadcrumb="Reuniões / Atas geradas por IA"
    >
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className="flex flex-col rounded-xl border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por sala, participante ou conteúdo…"
                className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {minutes.length} ata{minutes.length === 1 ? "" : "s"} · você é participante
            </div>
          </div>
          <div className="max-h-[70vh] flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                Nenhuma ata ainda. Gere uma ao final de uma reunião.
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`flex w-full flex-col items-start gap-1 border-b border-border/60 px-3 py-2.5 text-left transition hover:bg-muted/60 ${
                    selected?.id === m.id ? "bg-muted/80" : ""
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    <span className="flex-1 truncate text-sm font-semibold">{m.roomLabel}</span>
                  </div>
                  <div className="flex w-full items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(m.createdAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <span>·</span>
                    <UsersIcon className="h-3 w-3" />
                    {m.participantNames.length}
                  </div>
                  {m.topics.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {m.topics.length} tópico{m.topics.length === 1 ? "" : "s"} ·{" "}
                      {m.topics.filter((t) => t.taskId).length} viraram tarefa
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-xl border border-border bg-card">
          {selected ? (
            <MinuteDetail
              key={selected.id}
              minute={selected}
              usersLookup={Object.fromEntries(users.map((u) => [u.id, u.name]))}
              onConvert={(topicId) => {
                const taskId = minuteTopicToTask(selected.id, topicId);
                if (taskId) toast.success("Tópico virou tarefa");
              }}
              onOpenTask={(taskId) => openTask(taskId)}
              onDelete={() => {
                if (confirm("Excluir esta ata?")) {
                  deleteMinute(selected.id);
                  toast.success("Ata excluída");
                  setSelectedId(null);
                }
              }}
            />
          ) : (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <FileText className="h-12 w-12 opacity-30" />
              Selecione uma ata para ver o conteúdo e transformar tópicos em tarefas.
            </div>
          )}
        </div>
      </div>
    </FluxoLayout>
  );
}

function MinuteDetail({
  minute,
  usersLookup,
  onConvert,
  onOpenTask,
  onDelete,
}: {
  minute: MeetingMinute;
  usersLookup: Record<string, string>;
  onConvert: (topicId: string) => void;
  onOpenTask: (taskId: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(minute.createdAt).toLocaleString("pt-BR")}
          </div>
          <h2 className="mt-1 truncate text-lg font-bold">{minute.roomLabel}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <UsersIcon className="h-3 w-3" />
            {minute.participantNames.length > 0
              ? minute.participantNames.join(", ")
              : "sem participantes"}
          </div>
          {minute.createdBy && usersLookup[minute.createdBy] && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Gerada por {usersLookup[minute.createdBy]}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(minute.markdown).catch(() => {});
              toast.success("Ata copiada");
            }}
            className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted"
            title="Copiar ata"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border border-border p-2 text-destructive hover:bg-destructive/10"
            title="Excluir"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
        {/* Topics / Action plan */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ListChecks className="h-4 w-4 text-primary" />
            Plano de ação
          </h3>
          {minute.topics.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
              A IA não encontrou tópicos acionáveis nesta ata.
            </div>
          ) : (
            <ul className="space-y-2">
              {minute.topics.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-background/50 p-2.5"
                >
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${kindStyle[t.kind]}`}
                  >
                    {kindLabel[t.kind]}
                  </span>
                  <span className="flex-1 text-sm leading-snug">{t.text}</span>
                  {t.taskId ? (
                    <button
                      onClick={() => onOpenTask(t.taskId!)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                      title="Abrir tarefa"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Tarefa
                    </button>
                  ) : (
                    <button
                      onClick={() => onConvert(t.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                      title="Transformar em tarefa"
                    >
                      Virar tarefa
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Markdown */}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" />
            Ata completa
          </h3>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground">
            {minute.markdown}
          </pre>
        </div>
      </div>
    </div>
  );
}