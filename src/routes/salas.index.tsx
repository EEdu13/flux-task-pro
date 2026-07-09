import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Lock, LockOpen, Phone, Plus, Radio, Search, Users2, X } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { inviteToRoom, listSectorRooms, setRoomPrivacy } from "@/lib/livekit-token.functions";

export const Route = createFileRoute("/salas/")({
  component: SalasPage,
  head: () => ({
    meta: [
      { title: "Salas Online · Fluxo" },
      {
        name: "description",
        content: "Salas de voz e vídeo do time por departamento — estilo Discord.",
      },
    ],
  }),
});

interface RoomInfo {
  name: string;
  label: string;
  participants: { identity: string; name: string }[];
}

const EXTRA_KEY = "fluxo.extraRooms.v1";
function loadExtras(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXTRA_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
  } catch {
    return {};
  }
}
function saveExtras(v: Record<string, number[]>) {
  try {
    window.localStorage.setItem(EXTRA_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function SalasPage() {
  const { users, currentUser, callUserToRoom } = useFluxo();
  const recentUsers = useFluxo().recentContactUsers(5);
  const navigate = useNavigate();
  const [bySector, setBySector] = useState<Record<string, RoomInfo[]>>({});
  const [called, setCalled] = useState<Record<string, number>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, number[]>>(() => loadExtras());
  // pending call target awaiting the private/open choice
  const [callChoice, setCallChoice] = useState<{
    userId: string;
    roomName: string;
    roomLabel: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => saveExtras(extras), [extras]);

  useEffect(() => {
    let cancelled = false;
    const sectors = DEPARTMENT_ROOMS.map((r) => r.name);
    async function poll() {
      try {
        const res = await listSectorRooms({ data: { sectors } });
        if (cancelled) return;
        const mapped: Record<string, RoomInfo[]> = {};
        for (const [sector, list] of Object.entries(res.bySector)) {
          const label = DEPARTMENT_ROOMS.find((d) => d.name === sector)?.label ?? sector;
          mapped[sector] = list.map((r) => ({
            name: r.name,
            label,
            participants: r.participants,
          }));
        }
        setBySector(mapped);
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

  function askCall(userId: string, roomName: string, roomLabel: string) {
    setCallChoice({ userId, roomName, roomLabel });
    setOpenFor(null);
  }

  async function confirmCall(kind: "private" | "open") {
    if (!callChoice) return;
    const { userId, roomName, roomLabel } = callChoice;
    if (kind === "private") {
      try {
        await setRoomPrivacy({ data: { roomName, isPrivate: true, userId: currentUser.id } });
        await inviteToRoom({
          data: { roomName, targetUserId: userId, inviterUserId: currentUser.id },
        });
      } catch (e) {
        console.error(e);
      }
    } else {
      try {
        await setRoomPrivacy({ data: { roomName, isPrivate: false, userId: currentUser.id } });
      } catch {
        /* ignore */
      }
    }
    callUserToRoom(userId, roomName, roomLabel);
    const key = `${userId}:${roomName}`;
    setCalled((c) => ({ ...c, [key]: Date.now() }));
    setTimeout(
      () =>
        setCalled((c) => {
          const next = { ...c };
          delete next[key];
          return next;
        }),
      3500,
    );
    setQueries((q) => ({ ...q, [roomName]: "" }));
    setCallChoice(null);
    navigate({ to: "/salas/$roomName", params: { roomName } });
  }

  function roomsForSector(sector: string, label: string): RoomInfo[] {
    const discovered = bySector[sector] ?? [{ name: sector, label, participants: [] }];
    const map = new Map<string, RoomInfo>();
    for (const r of discovered) {
      const n = parseSalaIndex(r.name, sector);
      map.set(r.name, {
        name: r.name,
        label: `${label} · Sala ${n}`,
        participants: r.participants,
      });
    }
    // ensure base "Sala 1" always exists
    if (!map.has(sector)) {
      map.set(sector, { name: sector, label: `${label} · Sala 1`, participants: [] });
    }
    // include user-created extras
    for (const n of extras[sector] ?? []) {
      const roomName = `${sector}-${n}`;
      if (!map.has(roomName)) {
        map.set(roomName, { name: roomName, label: `${label} · Sala ${n}`, participants: [] });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
    );
  }

  function addExtraRoom(sector: string) {
    const rooms = roomsForSector(sector, "");
    const used = new Set(rooms.map((r) => parseSalaIndex(r.name, sector)));
    let n = 2;
    while (used.has(n)) n++;
    setExtras((e) => ({ ...e, [sector]: [...(e[sector] ?? []), n] }));
  }

  return (
    <FluxoLayout title="Salas Online" breadcrumb="Colaboração">
      <div ref={containerRef} className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salas Online</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada departamento tem Sala 1 fixa; crie extras quando a sala principal estiver
              ocupada.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Você entrará como{" "}
            <span className="font-medium text-foreground">{currentUser.name}</span>.
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEPARTMENT_ROOMS.map((r) => {
            const rooms = roomsForSector(r.name, r.label);
            const query = (queries[r.name] ?? "").trim().toLowerCase();
            const matches = query
              ? users
                  .filter((u) => u.id !== currentUser.id && u.name.toLowerCase().includes(query))
                  .slice(0, 6)
              : [];
            const totalOnline = rooms.reduce((a, b) => a + b.participants.length, 0);
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
                      <div className="text-base font-semibold uppercase tracking-wide">
                        {r.label}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.desc}</div>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      totalOnline > 0
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    <Radio className="h-2.5 w-2.5" /> {totalOnline} online
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {rooms.map((room) => {
                    const n = parseSalaIndex(room.name, r.name);
                    return (
                      <button
                        key={room.name}
                        onClick={() =>
                          navigate({ to: "/salas/$roomName", params: { roomName: room.name } })
                        }
                        className="group flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-2 py-1.5 text-left hover:border-primary/50 hover:bg-primary/5"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-xs">
                          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                            #{n}
                          </span>
                          <span className="truncate font-medium">Sala {n}</span>
                          {room.participants.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                              <Users2 className="h-3 w-3" />
                              {room.participants.length}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] font-medium text-muted-foreground group-hover:text-primary">
                          Entrar
                        </span>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => addExtraRoom(r.name)}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-[10px] font-medium text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-3 w-3" /> Nova sala
                  </button>
                </div>

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
                              onClick={() => askCall(m.id, r.name, r.label)}
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
                  {recentUsers.length > 0 && !query && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="mr-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Recentes:
                      </span>
                      {recentUsers.map((m) => {
                        const callKey = `${m.id}:${r.name}`;
                        const wasCalled = !!called[callKey];
                        return (
                          <button
                            key={m.id}
                            onClick={() => askCall(m.id, r.name, r.label)}
                            disabled={wasCalled}
                            title={`Chamar ${m.name} para ${r.label}`}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] hover:border-primary hover:bg-primary/5 disabled:opacity-60"
                          >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-secondary text-[9px] font-bold">
                              {m.avatar}
                            </span>
                            <span className="max-w-[80px] truncate">{m.name.split(" ")[0]}</span>
                            <Phone className="h-2.5 w-2.5 text-primary" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {callChoice && (
          <CallChoiceModal
            targetName={users.find((u) => u.id === callChoice.userId)?.name ?? "convidado"}
            roomLabel={callChoice.roomLabel}
            onCancel={() => setCallChoice(null)}
            onConfirm={confirmCall}
          />
        )}
      </div>
    </FluxoLayout>
  );
}

function parseSalaIndex(name: string, sector: string): number {
  if (name === sector) return 1;
  const m = name.match(new RegExp(`^${sector}-(\\d+)$`));
  return m ? Number(m[1]) : 1;
}

function CallChoiceModal({
  targetName,
  roomLabel,
  onCancel,
  onConfirm,
}: {
  targetName: string;
  roomLabel: string;
  onCancel: () => void;
  onConfirm: (kind: "private" | "open") => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">Chamar {targetName}</div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Como você quer entrar na sala{" "}
          <span className="font-medium text-foreground">{roomLabel}</span>?
        </div>
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          <button
            onClick={() => onConfirm("private")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-3 text-left hover:border-primary hover:bg-primary/5"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Lock className="h-4 w-4 text-primary" /> Chat privado
            </span>
            <span className="text-[11px] text-muted-foreground">
              Só vocês dois. Novas pessoas precisam pedir para entrar e serem aceitas.
            </span>
          </button>
          <button
            onClick={() => onConfirm("open")}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-background p-3 text-left hover:border-primary hover:bg-primary/5"
          >
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <LockOpen className="h-4 w-4 text-emerald-500" /> Chat aberto
            </span>
            <span className="text-[11px] text-muted-foreground">
              Sala pública. Qualquer pessoa do time pode entrar quando quiser.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
