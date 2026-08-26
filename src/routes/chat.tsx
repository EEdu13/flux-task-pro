import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MessageSquare, Search } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { useChat } from "@/lib/chat-store";
import { ChatAvatar, Composer, MessageList, OnlineDot } from "@/components/chat-ui";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Chat · Fluxo" }] }),
  component: ChatPage,
});

function fmtWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function ChatPage() {
  const { users, currentUser } = useFluxo();
  const { threads, isOnline, markRead } = useChat();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const others = useMemo(
    () => users.filter((u) => u.id !== currentUser.id),
    [users, currentUser.id],
  );
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  // Junta threads existentes com todos os contatos (para começar conversa nova).
  const rows = useMemo(() => {
    const byPeer = new Map(threads.map((t) => [t.peer, t]));
    const list = others.map((u) => {
      const t = byPeer.get(u.id);
      return {
        user: u,
        last: t?.body ?? (t?.att_type ? "📎 Anexo" : ""),
        when: t?.created_at ?? "",
        unread: t?.unread ?? 0,
        hasThread: !!t,
      };
    });
    // ordena: com conversa (mais recente) primeiro, depois o resto alfabético
    list.sort((a, b) => {
      if (a.hasThread && b.hasThread) return a.when < b.when ? 1 : -1;
      if (a.hasThread) return -1;
      if (b.hasThread) return 1;
      return a.user.name.localeCompare(b.user.name);
    });
    const query = q.trim().toLowerCase();
    return query ? list.filter((r) => r.user.name.toLowerCase().includes(query)) : list;
  }, [others, threads, q]);

  const peer = selected ? userById.get(selected) : undefined;

  const select = (id: string) => {
    setSelected(id);
    markRead(id);
  };

  return (
    <FluxoLayout title="Chat" breadcrumb="Conversas">
      <div className="mx-auto flex h-[calc(100vh-8.5rem)] w-full max-w-[1400px] overflow-hidden rounded-2xl border border-border bg-card">
        {/* Lista de conversas */}
        <aside className="flex w-full max-w-[360px] flex-col border-r border-border">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar ou começar uma conversa"
                className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {rows.map((r) => {
              const active = selected === r.user.id;
              return (
                <button
                  key={r.user.id}
                  onClick={() => select(r.user.id)}
                  className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition ${
                    active ? "bg-secondary" : "hover:bg-secondary/50"
                  }`}
                >
                  <div className="relative">
                    <ChatAvatar user={r.user} size={46} />
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <OnlineDot online={isOnline(r.user.id)} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{r.user.name}</span>
                      {r.when && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">{fmtWhen(r.when)}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {r.last || (isOnline(r.user.id) ? "online" : r.user.jobTitle)}
                      </span>
                      {r.unread > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                          {r.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Conversa aberta */}
        <section className="flex min-w-0 flex-1 flex-col bg-background/40">
          {!peer ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div className="max-w-sm space-y-2">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessageSquare className="h-6 w-6" />
                </span>
                <h3 className="text-sm font-semibold">Suas conversas</h3>
                <p className="text-xs text-muted-foreground">
                  Escolha alguém à esquerda para conversar. Quem está online aparece com o ponto verde.
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
                <ChatAvatar user={peer} size={40} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{peer.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {isOnline(peer.id) ? (
                      <span className="text-success">online</span>
                    ) : (
                      "offline"
                    )}
                  </div>
                </div>
              </header>
              <MessageList peerId={peer.id} />
              <Composer peerId={peer.id} />
            </>
          )}
        </section>
      </div>
    </FluxoLayout>
  );
}
