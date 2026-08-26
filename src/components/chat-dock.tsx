import { useMemo, useState } from "react";
import { MessageCircle, Minus, Search, X } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { useChat } from "@/lib/chat-store";
import { ChatAvatar, Composer, MessageList, OnlineDot } from "@/components/chat-ui";

/**
 * Dock de chat. Botão no canto inferior direito (ACIMA do FAB ⚡) que expande
 * para cima a lista de contatos. Abrir um contato cria uma janela ancorada no
 * rodapé; minimizar deixa só a barra do cabeçalho; fechar remove.
 */
export function ChatDock() {
  const { users, currentUser, isAuthenticated } = useFluxo();
  const {
    openWindows,
    minimized,
    openChat,
    closeChat,
    minimizeChat,
    isOnline,
    threads,
    markRead,
    totalUnread,
  } = useChat();
  const [panelOpen, setPanelOpen] = useState(false);
  const [q, setQ] = useState("");

  const others = useMemo(
    () => users.filter((u) => u.id !== currentUser.id),
    [users, currentUser.id],
  );
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const unreadByPeer = useMemo(
    () => new Map(threads.map((t) => [t.peer, t.unread || 0])),
    [threads],
  );

  const contacts = useMemo(() => {
    const list = [...others].sort((a, b) => {
      const oa = isOnline(a.id) ? 0 : 1;
      const ob = isOnline(b.id) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const ua = unreadByPeer.get(a.id) ?? 0;
      const ub = unreadByPeer.get(b.id) ?? 0;
      if (ua !== ub) return ub - ua;
      return a.name.localeCompare(b.name);
    });
    const query = q.trim().toLowerCase();
    return query ? list.filter((u) => u.name.toLowerCase().includes(query)) : list;
  }, [others, isOnline, unreadByPeer, q]);

  if (!isAuthenticated) return null;

  const onlineCount = others.filter((u) => isOnline(u.id)).length;
  const minSet = new Set(minimized);
  const expanded = openWindows.filter((id) => !minSet.has(id));
  const collapsed = openWindows.filter((id) => minSet.has(id));

  const open = (id: string) => {
    openChat(id);
    markRead(id);
    setPanelOpen(false);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] hidden lg:block">
      {/* Janelas de conversa abertas — ancoradas no rodapé, à esquerda do launcher */}
      <div className="pointer-events-none absolute bottom-0 right-24 flex flex-row-reverse items-end gap-3">
        {expanded.map((id) => {
          const u = userById.get(id);
          if (!u) return null;
          return (
            <div
              key={id}
              className="pointer-events-auto flex h-[440px] w-[330px] flex-col overflow-hidden rounded-t-xl border border-border bg-card shadow-2xl"
            >
              <header className="flex items-center gap-2 border-b border-border bg-sidebar px-3 py-2 text-sidebar-foreground">
                <div className="relative">
                  <ChatAvatar user={u} size={30} />
                  <span className="absolute -bottom-0.5 -right-0.5">
                    <OnlineDot online={isOnline(u.id)} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{u.name}</div>
                  <div className="text-[10px] opacity-70">{isOnline(u.id) ? "online" : "offline"}</div>
                </div>
                <button
                  onClick={() => minimizeChat(id)}
                  className="rounded p-1 opacity-70 hover:bg-white/10 hover:opacity-100"
                  title="Minimizar"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => closeChat(id)}
                  className="rounded p-1 opacity-70 hover:bg-destructive hover:opacity-100"
                  title="Fechar"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <MessageList peerId={id} compact />
              <Composer peerId={id} />
            </div>
          );
        })}
      </div>

      {/* Barras minimizadas — no rodapé, à esquerda do launcher */}
      {collapsed.length > 0 && (
        <div className="pointer-events-none absolute bottom-0 right-24 flex flex-row-reverse items-end gap-2">
          {/* empurra as barras para não ficarem sob as janelas abertas */}
          <div style={{ width: expanded.length * (330 + 12) }} />
          {collapsed.map((id) => {
            const u = userById.get(id);
            if (!u) return null;
            const unread = unreadByPeer.get(u.id) ?? 0;
            return (
              <div
                key={id}
                className="pointer-events-auto flex w-[220px] items-center gap-2 rounded-t-xl border border-border bg-sidebar px-3 py-2 text-sidebar-foreground shadow-2xl"
              >
                <button
                  onClick={() => open(id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title="Abrir conversa"
                >
                  <div className="relative shrink-0">
                    <ChatAvatar user={u} size={28} />
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <OnlineDot online={isOnline(u.id)} />
                    </span>
                  </div>
                  <span className="truncate text-xs font-semibold">{u.name}</span>
                  {unread > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                      {unread}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => closeChat(id)}
                  className="shrink-0 rounded p-0.5 opacity-70 hover:bg-destructive hover:opacity-100"
                  title="Fechar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Launcher (acima do FAB) + painel de contatos */}
      <div className="pointer-events-auto absolute bottom-24 right-5">
        {panelOpen && (
          <div className="absolute bottom-full right-0 mb-3 flex max-h-[65vh] w-80 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 text-sidebar-foreground">
              <div>
                <div className="text-sm font-semibold">Conversas</div>
                <div className="text-[11px] opacity-70">{onlineCount} online agora</div>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="rounded-md p-1 opacity-80 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar pessoa…"
                  className="w-full rounded-full border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {contacts.map((u) => {
                const unread = unreadByPeer.get(u.id) ?? 0;
                return (
                  <button
                    key={u.id}
                    onClick={() => open(u.id)}
                    className="flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left transition hover:bg-secondary/60"
                  >
                    <div className="relative">
                      <span className={isOnline(u.id) ? "" : "opacity-60 grayscale"}>
                        <ChatAvatar user={u} size={38} />
                      </span>
                      <span className="absolute -bottom-0.5 -right-0.5">
                        <OnlineDot online={isOnline(u.id)} />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {isOnline(u.id) ? <span className="text-success">online</span> : u.jobTitle}
                      </div>
                    </div>
                    {unread > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
              {contacts.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Ninguém encontrado.
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl transition hover:brightness-110"
          title="Chat"
        >
          {panelOpen ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
          {!panelOpen && totalUnread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-card">
              {totalUnread}
            </span>
          )}
          {onlineCount > 0 && !panelOpen && (
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-success ring-2 ring-card" />
          )}
        </button>
      </div>
    </div>
  );
}
