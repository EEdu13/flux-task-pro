import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Headphones, Phone, Radio, Users2 } from "lucide-react";
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

  function isUserOnline(roomName: string, userId: string) {
    const parts = presence[roomName] ?? [];
    return parts.some((p) => p.identity.startsWith(`${userId}-`));
  }

  function handleCall(userId: string, roomName: string, roomLabel: string) {
    callUserToRoom(userId, roomName, roomLabel);
    const key = `${userId}:${roomName}`;
    setCalled((c) => ({ ...c, [key]: Date.now() }));
    setTimeout(() => setCalled((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    }), 3500);
  }

  return (
    <FluxoLayout title="Salas Online" breadcrumb="Colaboração">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salas Online</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Uma sala por departamento. Veja quem está online, entre com um clique ou chame alguém para uma ligação
              rápida.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Você entrará como <span className="font-medium text-foreground">{currentUser.name}</span>.
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          {DEPARTMENT_ROOMS.map((r) => {
            const parts = presence[r.name] ?? [];
            const members = users.filter((u) => u.sector === r.sector);
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
                      <Link
                        to="/salas/$roomName"
                        params={{ roomName: r.name }}
                        className="text-base font-semibold uppercase tracking-wide hover:text-primary"
                      >
                        {r.label}
                      </Link>
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

                {members.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Membros ({members.length})
                    </div>
                    <ul className="flex flex-col gap-1">
                      {members.map((m) => {
                        const online = isUserOnline(r.name, m.id);
                        const isSelf = m.id === currentUser.id;
                        const callKey = `${m.id}:${r.name}`;
                        const wasCalled = !!called[callKey];
                        return (
                          <li
                            key={m.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary/50"
                          >
                            <div className="relative">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[10px] font-bold">
                                {m.avatar}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${
                                  online ? "bg-emerald-500" : "bg-muted-foreground/40"
                                }`}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium">
                                {m.name} {isSelf && <span className="text-muted-foreground">(você)</span>}
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">{m.jobTitle}</div>
                            </div>
                            {online ? (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                                na sala
                              </span>
                            ) : isSelf ? null : (
                              <button
                                onClick={() => handleCall(m.id, r.name, r.label)}
                                disabled={wasCalled}
                                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/20 disabled:opacity-60"
                                title={`Chamar ${m.name.split(" ")[0]} para a sala ${r.label}`}
                              >
                                <Phone className="h-3 w-3" />
                                {wasCalled ? "Chamando…" : "Chamar"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Nenhum membro cadastrado com setor <code className="rounded bg-muted px-1">{r.sector}</code>. Ajuste
                    o setor de um usuário em Equipe para vê-lo aqui.
                  </p>
                )}

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