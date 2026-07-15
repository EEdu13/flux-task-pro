import { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Zap,
  AtSign,
  StickyNote,
  ListChecks,
  Flame,
  Sparkles,
  Check,
} from "lucide-react";

import { useFluxo } from "@/lib/fluxo-store";
import { toast } from "sonner";
import type { Priority } from "@/lib/fluxo-types";
import { loadPackDone, savePackDone } from "@/lib/pack";
import { sendNudge } from "@/components/attention-overlay";

type Mode = "menu" | "quick" | "mention" | "pack" | "attention";

function todayEnd() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

export function QuickFab() {
  const { createTask, tasks, users, currentUser, isAuthenticated } = useFluxo();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("media");
  const [mentionUser, setMentionUser] = useState<string>("");
  const [mentionText, setMentionText] = useState("");
  const [packDone, setPackDone] = useState<Set<string>>(() => loadPackDone(currentUser.id));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPackDone(loadPackDone(currentUser.id));
  }, [currentUser.id, mode]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!open) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("menu");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setMode("menu");
    };
    window.addEventListener("fluxo:quick-open", onOpen);
    return () => window.removeEventListener("fluxo:quick-open", onOpen);
  }, []);

  const openNotepad = () => {
    window.dispatchEvent(new CustomEvent("fluxo:notepad-open"));
    setOpen(false);
    setMode("menu");
  };

  const packItems = tasks.filter((t) => t.assigneeId === currentUser.id && t.inPack);
  const packPending = packItems.filter((t) => !packDone.has(t.id));

  const togglePackDone = (id: string) => {
    setPackDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      savePackDone(currentUser.id, next);
      window.dispatchEvent(new CustomEvent("fluxo:pack-updated"));
      return next;
    });
  };

  const nudgeUser = async (uid: string) => {
    const target = users.find((u) => u.id === uid);
    setOpen(false);
    setMode("menu");
    try {
      await sendNudge(uid, currentUser.name, currentUser.avatar);
      toast.success(
        `Você chamou a atenção de ${target?.name?.split(" ")[0] ?? "alguém"}`,
      );
    } catch {
      toast.error("Não foi possível enviar agora");
    }
  };

  const submitQuick = () => {
    if (!title.trim()) {
      toast.error("Digite o título");
      return;
    }
    createTask({
      title: title.trim(),
      sector: currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: currentUser.id,
      mentions: [],
      frequency: "diaria",
      status: "pendente",
      score: 10,
      dueDate: todayEnd(),
      recurring: false,
      priority,
      tags: ["rapida"],
    });
    toast.success("Tarefa rápida criada");
    setTitle("");
    setPriority("media");
    setMode("menu");
  };

  const submitMention = () => {
    if (!mentionUser) {
      toast.error("Escolha alguém");
      return;
    }
    if (!mentionText.trim()) {
      toast.error("Descreva o que precisa");
      return;
    }
    createTask({
      title: mentionText.trim(),
      description: `Solicitação urgente enviada por ${currentUser.name}.`,
      sector: currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: mentionUser,
      mentions: [mentionUser],
      frequency: "diaria",
      status: "pendente",
      score: 15,
      dueDate: todayEnd(),
      recurring: false,
      priority: "alta",
      tags: ["mencao", "urgente"],
    });
    toast.success("Enviado — a pessoa foi mencionada");
    setMentionText("");
    setMentionUser("");
    setMode("menu");
    setOpen(false);
  };

  if (!isAuthenticated) return null;

  return (
    <div ref={rootRef} className="fixed bottom-24 right-5 z-[60] flex flex-col items-end gap-2 lg:bottom-5">
      {open && mode === "menu" && (
        <div className="flex flex-col items-stretch gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
          <FabItem
            icon={Zap}
            label="Tarefa rápida"
            hint="para você, vence hoje"
            onClick={() => setMode("quick")}
          />
          <FabItem
            icon={AtSign}
            label="Mencionar alguém"
            hint="tarefa urgente para outra pessoa"
            onClick={() => setMode("mention")}
          />
          <FabItem
            icon={Flame}
            label="Concluir pack"
            hint={
              packItems.length === 0
                ? "sem itens no seu pack"
                : `${packPending.length} de ${packItems.length} pendentes hoje`
            }
            onClick={() => setMode("pack")}
          />
          <FabItem
            icon={Sparkles}
            label="Chamar atenção"
            hint="treme a tela da pessoa"
            onClick={() => setMode("attention")}
          />
          <FabItem
            icon={StickyNote}
            label="Bloco de notas"
            hint="abre o bloco flutuante"
            onClick={openNotepad}
          />
          <FabItem
            icon={ListChecks}
            label="Criação em massa"
            hint="abre a planilha em Minhas tarefas"
            onClick={() => {
              window.location.href = "/minhas-tarefas";
            }}
          />
        </div>
      )}

      {open && mode === "pack" && (
        <div className="w-[320px] rounded-xl border border-border bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Flame className="h-3.5 w-3.5 text-amber-500" /> Concluir pack
            </div>
            <button
              onClick={() => setMode("menu")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Marque o que você já fez hoje. Reseta automaticamente amanhã.
          </p>
          {packItems.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
              Você ainda não adicionou tarefas ao seu pack.
            </div>
          )}
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {packItems.map((t) => {
              const done = packDone.has(t.id);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => togglePackDone(t.id)}
                    className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition ${
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
          {packItems.length > 0 && (
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {packItems.length - packPending.length}/{packItems.length} feitos
              </span>
              <button
                onClick={() => {
                  const all = new Set(packItems.map((t) => t.id));
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
          )}
        </div>
      )}

      {open && mode === "attention" && (
        <div className="w-[300px] rounded-xl border border-border bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" /> Chamar atenção
            </div>
            <button
              onClick={() => setMode("menu")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Estilo MSN — treme a tela da pessoa por 1 segundo. Use com moderação.
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {users
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => nudgeUser(u.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
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
                    <Sparkles className="h-3.5 w-3.5 text-fuchsia-500 opacity-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {open && mode === "quick" && (
        <div className="w-[300px] rounded-xl border border-border bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5 text-primary" /> Tarefa rápida
            </div>
            <button
              onClick={() => setMode("menu")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitQuick();
              if (e.key === "Escape") setMode("menu");
            }}
            placeholder="O que precisa ser feito?"
            className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={submitQuick}
            className="mt-2 w-full rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Criar (Enter) — vence hoje
          </button>
        </div>
      )}

      {open && mode === "mention" && (
        <div className="w-[320px] rounded-xl border border-border bg-card p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <AtSign className="h-3.5 w-3.5 text-primary" /> Mencionar alguém
            </div>
            <button
              onClick={() => setMode("menu")}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Cria uma tarefa urgente (prioridade alta, vence hoje) e notifica a pessoa.
          </p>
          <select
            value={mentionUser}
            onChange={(e) => setMentionUser(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          >
            <option value="">— escolher pessoa —</option>
            {users
              .filter((u) => u.id !== currentUser.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.jobTitle}
                </option>
              ))}
          </select>
          <textarea
            value={mentionText}
            onChange={(e) => setMentionText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitMention();
            }}
            placeholder="O que precisa agora? Ex: revisar proposta ACME antes das 17h"
            rows={3}
            className="mt-2 w-full resize-none rounded-md border border-border bg-background px-2 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={submitMention}
            className="mt-2 w-full rounded-md bg-primary py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Enviar menção urgente
          </button>
        </div>
      )}

      <button
        onClick={() => {
          setOpen((v) => !v);
          setMode("menu");
        }}
        title="Ações rápidas"
        className="group flex flex-col items-center gap-1"
      >
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition group-hover:brightness-110 ${
            open ? "rotate-45" : ""
          }`}
        >
          {open ? <X className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
        </span>
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground shadow-sm">
          Acesso rápido
        </span>
      </button>
    </div>
  );
}

function FabItem({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-secondary"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[10px] text-muted-foreground">{hint}</div>
      </div>
    </button>
  );
}