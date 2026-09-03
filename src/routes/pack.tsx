import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Flame, Send, Sparkles, Trash2, Users, Layers, ArrowLeftRight, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { motion } from "framer-motion";

import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { loadPackDone, savePackDone } from "@/lib/pack";
import { TaskTimerControls } from "@/components/task-timer-controls";
import type { PackTemplateScope } from "@/lib/fluxo-types";
import { TravaScroll } from "@/components/trava-scroll";

export const Route = createFileRoute("/pack")({
  head: () => ({
    meta: [
      { title: "Pack diário — Fluxo" },
      {
        name: "description",
        content:
          "Monte o pack diário do time: crie o seu ou envie um pack pronto para supervisores, PCP e liderados.",
      },
    ],
  }),
  component: PackPage,
});

function todayEnd() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function parsePackLines(text: string) {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
    .filter((l) => l.length > 0);
}

type Tab = "meu" | "outro" | "concluir" | "modelos";

function PackPage() {
  const {
    createTask,
    tasks,
    users,
    currentUser,
    packTemplates,
    createPackTemplate,
    deletePackTemplate,
    applyPackTemplate,
    transferPack,
  } = useFluxo();
  const initialMyPack = tasks.filter((t) => t.assigneeId === currentUser.id && t.inPack);
  const [tab, setTab] = useState<Tab>(initialMyPack.length > 0 ? "concluir" : "meu");
  const [meuText, setMeuText] = useState("");
  const [outroText, setOutroText] = useState("");
  const [targetId, setTargetId] = useState<string>("");
  const [packDone, setPackDone] = useState<Set<string>>(() => loadPackDone(currentUser.id));

  useEffect(() => {
    setPackDone(loadPackDone(currentUser.id));
  }, [currentUser.id]);

  const myPack = useMemo(
    () => tasks.filter((t) => t.assigneeId === currentUser.id && t.inPack),
    [tasks, currentUser.id],
  );
  const pending = myPack.filter((t) => !packDone.has(t.id));

  const teamPacks = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const u of users) {
      if (u.id === currentUser.id) continue;
      const list = tasks.filter((t) => t.assigneeId === u.id && t.inPack);
      if (list.length > 0) map.set(u.id, list);
    }
    return map;
  }, [tasks, users, currentUser.id]);

  const targetUser = users.find((u) => u.id === targetId);
  const targetPack = useMemo(
    () => (targetId ? tasks.filter((t) => t.assigneeId === targetId && t.inPack) : []),
    [tasks, targetId],
  );
  const [lastSent, setLastSent] = useState<{ to: string; items: string[]; at: number } | null>(null);

  const submit = (assigneeId: string, text: string, clear: () => void) => {
    const lines = parsePackLines(text);
    if (lines.length === 0) {
      toast.error("Escreva pelo menos um item (uma linha por tarefa)");
      return;
    }
    const target = users.find((u) => u.id === assigneeId);
    lines.forEach((title) => {
      createTask({
        title,
        sector: target?.sector ?? currentUser.sector,
        createdBy: currentUser.id,
        assigneeId,
        mentions: assigneeId !== currentUser.id ? [assigneeId] : [],
        frequency: "diaria",
        status: "pendente",
        score: 10,
        dueDate: todayEnd(),
        recurring: false,
        priority: "media",
        tags: ["pack"],
        inPack: true,
      });
    });
    clear();
    if (assigneeId === currentUser.id) {
      toast.success(`Adicionado ao seu pack (${lines.length} ${lines.length === 1 ? "item" : "itens"})`);
      setTab("concluir");
    } else {
      toast.success(`Pack enviado para ${target?.name?.split(" ")[0] ?? "a pessoa"} (${lines.length})`);
      setLastSent({ to: assigneeId, items: lines, at: Date.now() });
    }
  };

  const toggleDone = (id: string) => {
    setPackDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePackDone(currentUser.id, next);
      window.dispatchEvent(new CustomEvent("fluxo:pack-updated"));
      return next;
    });
  };

  const meuCount = parsePackLines(meuText).length;
  const outroCount = parsePackLines(outroText).length;

  return (
    <FluxoLayout title="Pack diário" breadcrumb="Rotinas">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">Pack diário</h1>
              <p className="text-xs text-muted-foreground">
                Compromissos rápidos para o dia. Ideal para supervisores e PCP montarem a rotina do time em segundos.
              </p>
            </div>
          </div>

          <nav className="mt-2 flex gap-1 rounded-lg bg-secondary p-1 text-xs font-semibold">
            {(
              [
                { id: "meu" as const, label: "Criar meu pack", icon: Sparkles },
                { id: "outro" as const, label: "Criar pack para alguém", icon: Send },
                { id: "concluir" as const, label: `Concluir hoje (${pending.length}/${myPack.length})`, icon: Check },
                { id: "modelos" as const, label: "Modelos & transferência", icon: Layers },
              ]
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 transition ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {/* Pílula única que desliza entre as abas, em vez de piscar. */}
                  {active && (
                    <motion.span
                      layoutId="pack-aba-ativa"
                      className="absolute inset-0 rounded-md bg-card shadow-sm"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <t.icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </header>

        {tab === "meu" && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Meu pack de hoje</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Uma linha por tarefa. Tudo entra como prioridade média e vence hoje.
            </p>
            <textarea
              autoFocus
              value={meuText}
              onChange={(e) => setMeuText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(currentUser.id, meuText, () => setMeuText(""));
              }}
              placeholder={"Ex:\nResponder e-mails prioritários\nRevisar proposta ACME\nLigar para fornecedor X"}
              rows={10}
              className="mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{meuCount} {meuCount === 1 ? "item" : "itens"} · ⌘/Ctrl+Enter envia</span>
              <button
                onClick={() => submit(currentUser.id, meuText, () => setMeuText(""))}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Adicionar ao meu pack
              </button>
            </div>
          </section>
        )}

        {tab === "outro" && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="h-3.5 w-3.5" /> Montar pack para alguém do time
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha a pessoa e cole a rotina do dia. Ela recebe tudo já no pack, com menção.
            </p>

            <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-background p-2">
                {users
                  .filter((u) => u.id !== currentUser.id)
                  .map((u) => {
                    const active = targetId === u.id;
                    const count = tasks.filter((t) => t.assigneeId === u.id && t.inPack).length;
                    return (
                      <button
                        key={u.id}
                        onClick={() => setTargetId(u.id)}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                          active ? "bg-primary/10 text-foreground" : "hover:bg-secondary"
                        }`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {u.avatar || u.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{u.name}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {u.jobTitle}
                          </span>
                        </span>
                        {count > 0 && (
                          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>

              <div className="flex flex-col gap-3">
                {targetUser && (
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        {targetUser.avatar || targetUser.name.slice(0, 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold">
                          Pack de {targetUser.name.split(" ")[0]} hoje
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {targetPack.length === 0
                            ? "Nenhum item ainda — você vai ser o primeiro"
                            : `${targetPack.length} ${targetPack.length === 1 ? "item já enviado" : "itens já enviados"}`}
                        </div>
                      </div>
                      {lastSent && lastSent.to === targetId && Date.now() - lastSent.at < 8000 && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                          ✓ enviado agora
                        </span>
                      )}
                    </div>
                    {targetPack.length > 0 && (
                      <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                        {targetPack.map((t) => {
                          const isNew =
                            lastSent && lastSent.to === targetId && lastSent.items.includes(t.title);
                          return (
                            <li
                              key={t.id}
                              className={`truncate text-[11px] ${
                                isNew ? "font-semibold text-emerald-500" : "text-muted-foreground"
                              }`}
                            >
                              {isNew ? "✓" : "•"} {t.title}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                <textarea
                  value={outroText}
                  onChange={(e) => setOutroText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && targetId)
                      submit(targetId, outroText, () => setOutroText(""));
                  }}
                  placeholder={
                    targetId
                      ? "Ex:\nFechar caixa do dia\nEnviar relatório semanal\nConfirmar reuniões de amanhã"
                      : "Escolha uma pessoa ao lado para começar…"
                  }
                  disabled={!targetId}
                  rows={9}
                  className="w-full flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {outroCount} {outroCount === 1 ? "item" : "itens"} · ⌘/Ctrl+Enter envia
                  </span>
                  <button
                    onClick={() => targetId && submit(targetId, outroText, () => setOutroText(""))}
                    disabled={!targetId}
                    className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                  >
                    {targetUser ? `Enviar para ${targetUser.name.split(" ")[0]}` : "Enviar pack"}
                  </button>
                </div>
              </div>
            </div>

            {teamPacks.size > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-muted-foreground">Packs ativos do time hoje</h3>
                <ul className="mt-2 grid gap-2 md:grid-cols-2">
                  {Array.from(teamPacks.entries()).map(([uid, list]) => {
                    const u = users.find((x) => x.id === uid);
                    if (!u) return null;
                    return (
                      <li key={uid} className="rounded-lg border border-border bg-background p-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {u.avatar || u.name.slice(0, 1)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold">{u.name}</div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {list.length} {list.length === 1 ? "item" : "itens"}
                            </div>
                          </div>
                        </div>
                        <ul className="mt-2 space-y-0.5">
                          {list.slice(0, 4).map((t) => (
                            <li key={t.id} className="truncate text-[11px] text-muted-foreground">
                              • {t.title}
                            </li>
                          ))}
                          {list.length > 4 && (
                            <li className="text-[10px] text-muted-foreground">+{list.length - 4} outros</li>
                          )}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        )}

        {tab === "concluir" && (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Concluir meu pack de hoje</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Marque o que já foi feito. Reseta automaticamente amanhã.
            </p>
            {myPack.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                Você ainda não tem itens no pack de hoje. Abra a aba <b>Criar meu pack</b>.
              </div>
            ) : (
              <>
                <ul className="mt-3 space-y-1">
                  {myPack.map((t) => {
                    const done = packDone.has(t.id);
                    return (
                      <li key={t.id}>
                        <div
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                            done
                              ? "border-emerald-500/40 bg-emerald-500/10 text-muted-foreground"
                              : "border-border hover:bg-secondary"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleDone(t.id)}
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              done
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-border bg-background"
                            }`}
                            title={done ? "Desmarcar" : "Concluir"}
                          >
                            {done && <Check className="h-3 w-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleDone(t.id)}
                            className={`flex-1 text-left ${done ? "line-through" : ""}`}
                          >
                            {t.title}
                          </button>
                          <TaskTimerControls taskId={t.id} estimatedMinutes={t.estimatedMinutes} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {myPack.length - pending.length}/{myPack.length} feitos
                  </span>
                  <button
                    onClick={() => {
                      const all = new Set(myPack.map((t) => t.id));
                      setPackDone(all);
                      savePackDone(currentUser.id, all);
                      window.dispatchEvent(new CustomEvent("fluxo:pack-updated"));
                      toast.success("Pack concluído — bom trabalho!");
                    }}
                    className="font-semibold text-primary hover:underline"
                  >
                    Marcar tudo
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {tab === "modelos" && (
          <ModelosSection
            users={users}
            currentUserId={currentUser.id}
            packTemplates={packTemplates}
            createPackTemplate={createPackTemplate}
            deletePackTemplate={deletePackTemplate}
            applyPackTemplate={applyPackTemplate}
            transferPack={transferPack}
            tasks={tasks}
          />
        )}
      </div>
    </FluxoLayout>
  );
}

// keep Trash2 tree-shaken from warning
void Trash2;

type ModelosProps = {
  users: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  packTemplates: ReturnType<typeof useFluxo>["packTemplates"];
  createPackTemplate: ReturnType<typeof useFluxo>["createPackTemplate"];
  deletePackTemplate: ReturnType<typeof useFluxo>["deletePackTemplate"];
  applyPackTemplate: ReturnType<typeof useFluxo>["applyPackTemplate"];
  transferPack: ReturnType<typeof useFluxo>["transferPack"];
  tasks: ReturnType<typeof useFluxo>["tasks"];
};

function ModelosSection({
  users,
  currentUserId,
  packTemplates,
  createPackTemplate,
  deletePackTemplate,
  applyPackTemplate,
  transferPack,
  tasks,
}: ModelosProps) {
  const jobTitles = useMemo(
    () => Array.from(new Set(users.map((u) => u.jobTitle).filter(Boolean))),
    [users],
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    scope: "cargo" as PackTemplateScope,
    targetJobTitle: jobTitles[0] ?? "",
    targetUserId: users[0]?.id ?? "",
    itemsText: "",
  });
  const [applyOpen, setApplyOpen] = useState<{ templateId: string } | null>(null);
  const [applyTargetId, setApplyTargetId] = useState(currentUserId);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");

  const submitDraft = () => {
    if (!draft.name.trim()) {
      toast.error("Dê um nome ao modelo (ex.: Supervisor de Operações)");
      return;
    }
    const items = draft.itemsText
      .split("\n")
      .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
      .filter(Boolean)
      .map((title, i) => ({ id: `it-${Date.now()}-${i}`, title }));
    if (items.length === 0) {
      toast.error("Coloque pelo menos uma tarefa no modelo (uma por linha)");
      return;
    }
    createPackTemplate({
      name: draft.name.trim(),
      scope: draft.scope,
      targetJobTitle: draft.scope === "cargo" ? draft.targetJobTitle : undefined,
      targetUserId: draft.scope === "pessoa" ? draft.targetUserId : undefined,
      items,
    });
    setDraft({
      name: "",
      scope: "cargo",
      targetJobTitle: jobTitles[0] ?? "",
      targetUserId: users[0]?.id ?? "",
      itemsText: "",
    });
    setCreating(false);
    toast.success(`Modelo "${draft.name.trim()}" criado`);
  };

  const doApply = () => {
    if (!applyOpen) return;
    const n = applyPackTemplate(applyOpen.templateId, applyTargetId);
    if (n > 0) {
      const target = users.find((u) => u.id === applyTargetId);
      toast.success(`Pack aplicado a ${target?.name.split(" ")[0] ?? "usuário"} — ${n} tarefas`);
    } else {
      toast.error("Modelo vazio ou usuário inválido");
    }
    setApplyOpen(null);
  };

  const doTransfer = () => {
    if (!transferFrom || !transferTo || transferFrom === transferTo) {
      toast.error("Escolha usuários diferentes");
      return;
    }
    const n = transferPack(transferFrom, transferTo);
    if (n > 0) {
      const from = users.find((u) => u.id === transferFrom);
      const to = users.find((u) => u.id === transferTo);
      toast.success(
        `${n} ${n === 1 ? "tarefa" : "tarefas"} do pack de ${from?.name.split(" ")[0]} → ${to?.name.split(" ")[0]}`,
      );
      setTransferFrom("");
      setTransferTo("");
    } else {
      toast.error("Sem itens de pack em aberto para transferir");
    }
  };

  const usersWithPack = users.filter((u) =>
    tasks.some((t) => t.assigneeId === u.id && t.inPack && t.status !== "concluida"),
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Layers className="h-3.5 w-3.5" /> Modelos de pack
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Salve rotinas de <b>cargo</b> (ex.: Supervisor, Analista) ou de <b>pessoa</b>. Ao
              contratar alguém novo, aplique o modelo — sem redigitar tudo.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Novo modelo
          </button>
        </div>

        {creating && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-background p-3">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder='Nome (ex.: "Supervisor de Operações")'
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              <div className="flex gap-1 rounded-md bg-secondary p-1 text-[11px] font-semibold">
                {(["cargo", "pessoa"] as PackTemplateScope[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft((d) => ({ ...d, scope: s }))}
                    className={`flex-1 rounded-md px-2 py-1 transition ${
                      draft.scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                    }`}
                  >
                    {s === "cargo" ? "Para um cargo" : "Para uma pessoa"}
                  </button>
                ))}
              </div>
              {draft.scope === "cargo" ? (
                <select
                  value={draft.targetJobTitle}
                  onChange={(e) => setDraft((d) => ({ ...d, targetJobTitle: e.target.value }))}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary md:col-span-2"
                >
                  {jobTitles.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={draft.targetUserId}
                  onChange={(e) => setDraft((d) => ({ ...d, targetUserId: e.target.value }))}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary md:col-span-2"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.jobTitle}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              value={draft.itemsText}
              onChange={(e) => setDraft((d) => ({ ...d, itemsText: e.target.value }))}
              rows={7}
              placeholder={
                "Uma tarefa por linha. Ex:\nRevisar KPIs da noite\nAlinhar plano com PCP\nAprovar folhas de ponto\nAtualizar quadro de operações"
              }
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={submitDraft}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Salvar modelo
              </button>
            </div>
          </div>
        )}

        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {packTemplates.length === 0 && (
            <li className="col-span-full rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhum modelo ainda. Crie um para reaproveitar rotinas.
            </li>
          )}
          {packTemplates.map((tpl) => (
            <li key={tpl.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{tpl.name}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {tpl.scope === "cargo"
                      ? `Cargo: ${tpl.targetJobTitle}`
                      : `Pessoa: ${users.find((u) => u.id === tpl.targetUserId)?.name ?? "—"}`}
                    {" · "}
                    {tpl.items.length} {tpl.items.length === 1 ? "item" : "itens"}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const ok = await confirmar({
                      titulo: "Excluir este modelo?",
                      descricao: `"${tpl.name}" deixa de aparecer ao montar o pack. Os packs já criados a partir dele continuam intactos.`,
                      confirmar: "Excluir",
                      perigo: true,
                    });
                    if (!ok) return;
                    deletePackTemplate(tpl.id);
                    toast.success("Modelo excluído");
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Excluir modelo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <ul className="mt-2 space-y-0.5">
                {tpl.items.slice(0, 4).map((it) => (
                  <li key={it.id} className="truncate text-[11px] text-muted-foreground">
                    • {it.title}
                  </li>
                ))}
                {tpl.items.length > 4 && (
                  <li className="text-[10px] text-muted-foreground">
                    +{tpl.items.length - 4} outros
                  </li>
                )}
              </ul>
              <button
                onClick={() => {
                  setApplyOpen({ templateId: tpl.id });
                  setApplyTargetId(
                    tpl.scope === "pessoa" && tpl.targetUserId
                      ? tpl.targetUserId
                      : currentUserId,
                  );
                }}
                className="mt-2 w-full rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
              >
                Aplicar a alguém
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeftRight className="h-3.5 w-3.5" /> Transferir pack (férias, cobertura)
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Move todas as tarefas em aberto do pack de uma pessoa para outra. Ideal quando alguém
          entra de férias ou fica ausente.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
          <select
            value={transferFrom}
            onChange={(e) => setTransferFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="">De: quem sai / cobre</option>
            {usersWithPack.map((u) => {
              const count = tasks.filter(
                (t) => t.assigneeId === u.id && t.inPack && t.status !== "concluida",
              ).length;
              return (
                <option key={u.id} value={u.id}>
                  {u.name} ({count})
                </option>
              );
            })}
          </select>
          <span className="grid place-items-center text-muted-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </span>
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="">Para: quem assume</option>
            {users
              .filter((u) => u.id !== transferFrom)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <button
            onClick={doTransfer}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Transferir
          </button>
        </div>
      </section>

      {applyOpen && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setApplyOpen(null)}
        >
          <TravaScroll />
          <div
            className="w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Aplicar modelo</h3>
              <button
                onClick={() => setApplyOpen(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha para qual pessoa aplicar. Todos os itens entram no pack de hoje.
            </p>
            <select
              value={applyTargetId}
              onChange={(e) => setApplyTargetId(e.target.value)}
              className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.jobTitle}
                </option>
              ))}
            </select>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setApplyOpen(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={doApply}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}