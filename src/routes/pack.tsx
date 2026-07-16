import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Flame, Send, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { loadPackDone, savePackDone } from "@/lib/pack";

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

type Tab = "meu" | "outro" | "concluir";

function PackPage() {
  const { createTask, tasks, users, currentUser } = useFluxo();
  const [tab, setTab] = useState<Tab>("meu");
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
              ]
            ).map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 transition ${
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
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

              <div className="flex flex-col">
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
                  rows={12}
                  className="w-full flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {outroCount} {outroCount === 1 ? "item" : "itens"} · ⌘/Ctrl+Enter envia
                  </span>
                  <button
                    onClick={() => targetId && submit(targetId, outroText, () => setOutroText(""))}
                    disabled={!targetId}
                    className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                  >
                    Enviar pack
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
                        <button
                          onClick={() => toggleDone(t.id)}
                          className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                            done
                              ? "border-emerald-500/40 bg-emerald-500/10 text-muted-foreground"
                              : "border-border hover:bg-secondary"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              done
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-border bg-background"
                            }`}
                          >
                            {done && <Check className="h-3 w-3" />}
                          </span>
                          <span className={`flex-1 ${done ? "line-through" : ""}`}>{t.title}</span>
                        </button>
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
      </div>
    </FluxoLayout>
  );
}

// keep Trash2 tree-shaken from warning
void Trash2;