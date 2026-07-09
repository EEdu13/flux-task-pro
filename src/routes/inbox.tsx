import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AtSign, Bell, Check, CheckCircle2, Clock, Inbox as InboxIcon, PhoneMissed } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { formatRelative } from "@/lib/use-theme";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Caixa de entrada · Fluxo" },
      { name: "description", content: "Todas as menções, atribuições, prazos e conclusões em um só lugar." },
    ],
  }),
  component: InboxPage,
});

const filters = [
  { id: "todas", label: "Todas" },
  { id: "nao_lidas", label: "Não lidas" },
  { id: "mencao", label: "Menções" },
  { id: "atribuida", label: "Atribuídas" },
  { id: "prazo", label: "Prazos" },
  { id: "concluida", label: "Concluídas" },
  { id: "chamada_perdida", label: "Chamadas" },
] as const;

function InboxPage() {
  const { notifications, currentUser, markNotifRead, markAllNotifsRead, openTask, callUserToRoom } = useFluxo();
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("todas");
  const navigate = useNavigate();

  const mine = notifications.filter((n) => n.userId === currentUser.id);
  const items = mine.filter((n) => {
    if (filter === "todas") return true;
    if (filter === "nao_lidas") return !n.read;
    return n.type === filter;
  });

  const iconFor = (type: string) => {
    if (type === "prazo") return Clock;
    if (type === "mencao") return AtSign;
    if (type === "concluida") return CheckCircle2;
    if (type === "chamada_perdida") return PhoneMissed;
    return Bell;
  };

  return (
    <FluxoLayout title="Caixa de entrada">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Caixa de entrada</h1>
            <p className="text-sm text-muted-foreground">
              {mine.length} notificações · {mine.filter((n) => !n.read).length} não lidas.
            </p>
          </div>
          <button
            onClick={() => markAllNotifsRead()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <Check className="h-4 w-4" /> Marcar todas como lidas
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1 border-b border-border">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`relative px-3 py-2 text-sm font-medium ${
                filter === f.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
              {filter === f.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>

        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
          {items.length === 0 && (
            <li className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
              <InboxIcon className="h-8 w-8 opacity-50" />
              Nada aqui.
            </li>
          )}
          {items.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <li key={n.id}>
                <button
                  onClick={() => {
                    markNotifRead(n.id);
                    if (n.type === "chamada_perdida" && n.fromUserId && n.roomName) {
                      callUserToRoom(n.fromUserId, n.roomName, n.roomLabel ?? n.roomName);
                      navigate({ to: "/salas/$roomName", params: { roomName: n.roomName } });
                      return;
                    }
                    if (n.taskId) openTask(n.taskId);
                    if (n.roomName)
                      navigate({ to: "/salas/$roomName", params: { roomName: n.roomName } });
                  }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-secondary/50 ${
                    n.read ? "opacity-70" : ""
                  }`}
                >
                  <div
                    className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full"
                    style={{
                      background:
                        n.type === "prazo"
                          ? "color-mix(in oklab, oklch(0.58 0.22 25) 15%, transparent)"
                          : n.type === "mencao"
                          ? "color-mix(in oklab, oklch(0.6 0.2 330) 15%, transparent)"
                          : n.type === "concluida"
                          ? "color-mix(in oklab, oklch(0.62 0.16 155) 15%, transparent)"
                          : "color-mix(in oklab, oklch(0.52 0.22 275) 15%, transparent)",
                      color:
                        n.type === "prazo"
                          ? "oklch(0.58 0.22 25)"
                          : n.type === "mencao"
                          ? "oklch(0.6 0.2 330)"
                          : n.type === "concluida"
                          ? "oklch(0.62 0.16 155)"
                          : "oklch(0.52 0.22 275)",
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {n.title}
                      {!n.read && (
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary">
                          novo
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{n.desc}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground/70">{formatRelative(n.at)}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </FluxoLayout>
  );
}