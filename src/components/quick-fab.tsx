import { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Zap,
  AtSign,
  StickyNote,
  ListChecks,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { toast } from "sonner";
import type { Priority } from "@/lib/fluxo-types";

type Mode = "menu" | "quick" | "mention";

function todayEnd() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

export function QuickFab() {
  const { createTask, users, currentUser, isAuthenticated } = useFluxo();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("media");
  const [mentionUser, setMentionUser] = useState<string>("");
  const [mentionText, setMentionText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

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

  const openNotepad = () => {
    window.dispatchEvent(new CustomEvent("fluxo:notepad-open"));
    setOpen(false);
    setMode("menu");
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
    <div ref={rootRef} className="fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2">
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
          <div className="mt-2 flex items-center gap-1">
            {(["alta", "media", "baixa"] as Priority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold capitalize ${
                  priority === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
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
        className={`flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition hover:brightness-110 ${
          open ? "rotate-45" : ""
        }`}
      >
        <Plus className="h-5 w-5" />
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