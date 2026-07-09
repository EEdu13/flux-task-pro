import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Phone, Radio, Search, Users2 } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listRoomsPresence } from "@/lib/livekit-token.functions";

export const Route = createFileRoute("/salas/")({
  component: SalasPage,
  head: () => ({
    meta: [
      { title: "Salas Online · Fluxo" },
      { name: "description", content: "Salas de voz e vídeo do time por departamento — estilo Discord." },
    ],
  }),
});

function SalasPage() {
  const { users, currentUser, callUserToRoom } = useFluxo();
  const navigate = useNavigate();
  const [presence, setPresence] = useState<Record<string, { identity: string; name: string }[]>>({});
  const [called, setCalled] = useState<Record<string, number>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const roomNames = DEPARTMENT_ROOMS.map((r) => r.name);
    async function poll() {
      try {
        const res = await listRoomsPresence({ data: { rooms: roomNames } });
        if (!cancelled) setPresence(res.presence);
      } catch {
        /* silent */
      }
    }
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpenFor(null);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleCall(userId: string, roomName: string, roomLabel: string) {
    callUserToRoom(userId, roomName, roomLabel);
    const key = `${userId}:${roomName}`;
    setCalled((c) => ({ ...c, [key]: Date.now() }));
    setTimeout(() => setCalled((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    }), 3500);
    setOpenFor(null);
    setQueries((q) => ({ ...q, [roomName]: "" }));
  }

  return (
    <FluxoLayout title="Salas Online" breadcrumb="Colaboração">
      <div ref={containerRef} className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salas Online</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Uma sala por departamento. Entre com um clique ou busque alguém pelo nome e chame direto.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Você entrará como <span className="font-medium text-foreground">{currentUser.name}</span>.
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DEPARTMENT_ROOMS.map((r) => {
            const parts = presence[r.name] ?? [];
            const query = (queries[r.name] ?? "").trim().toLowerCase();
            const matches = useMemo(
              () =>
                query
                  ? users
                      .filter((u) => u.id !== currentUser.id && u.name.toLowerCase().includes(query))
                      .slice(0, 6)
                  : [],
              [query, users, currentUser.id],
            );
            return (
              <section
                key={r.name}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Headphones className="h-5 w-5" />
                    </div>
                    <div>
                      <button
                        onClick={() => navigate({ to: "/salas/$roomName", params: { roomName: r.name } })}
                        className="text-base font-semibold uppercase tracking-wide hover:text-primary"
                      >
                        {r.label}
                      </button>
                      <div className="text-xs text-muted-foreground">{r.desc}</div>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      parts.length > 0
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    <Radio className="h-2.5 w-2.5" /> {parts.length} online
                  </span>
                </div>

                {parts.length > 0 && (
                  <div className="flex items-center gap-2 rounded-md bg-emerald-500/5 px-2 py-1.5">
                    <Users2 className="h-3.5 w-3.5 text-emerald-500" />
                    <div className="flex flex-wrap gap-1.5">
                      {parts.map((p) => (
                        <span
                          key={p.identity}
                          className="inline-flex items-center gap-1 rounded-full bg-background px-1.5 py-0.5 text-[10px]"
                          title={p.name}
                        >
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                            {(p.name || p.identity).slice(0, 1).toUpperCase()}
                          </span>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="relative">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Chamar alguém para esta sala
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={queries[r.name] ?? ""}
                      onChange={(e) => {
                        setQueries((q) => ({ ...q, [r.name]: e.target.value }));
                        setOpenFor(r.name);
                      }}
                      onFocus={() => setOpenFor(r.name)}
                      placeholder="Digite o nome…"
                      className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
                    />
                  </div>
                  {openFor === r.name && matches.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                      {matches.map((m) => {
                        const callKey = `${m.id}:${r.name}`;
                        const wasCalled = !!called[callKey];
                        return (
                          <li key={m.id}>
                            <button
                              onClick={() => handleCall(m.id, r.name, r.label)}
                              disabled={wasCalled}
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-secondary disabled:opacity-60"
                            >
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
                                {m.avatar}
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                <span className="font-medium">{m.name}</span>
                                <span className="ml-1 text-muted-foreground">· {m.jobTitle}</span>
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                <Phone className="h-3 w-3" /> {wasCalled ? "Chamando…" : "Chamar"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {openFor === r.name && query && matches.length === 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover p-3 text-center text-[11px] text-muted-foreground shadow-lg">
                      Ninguém encontrado.
                    </div>
                  )}
                </div>

                <button
                  onClick={() => navigate({ to: "/salas/$roomName", params: { roomName: r.name } })}
                  className="mt-auto inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
                >
                  <Headphones className="h-3.5 w-3.5" /> Entrar na sala {r.label}
                </button>
              </section>
            );
          })}
        </div>
      </div>
    </FluxoLayout>
  );
}