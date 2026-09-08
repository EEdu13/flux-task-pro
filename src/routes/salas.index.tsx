import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Headphones,
  Lock,
  LockOpen,
  Phone,
  Radio,
  Search,
  Users2,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { sectors } from "@/lib/fluxo-types";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listSectorRooms } from "@/lib/livekit-token.functions";
import { useCallInviter } from "@/lib/call-inviter-context";
import { useRoomPresence } from "@/lib/room-presence-context";

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
  isPrivate: boolean;
  participants: { identity: string; name: string }[];
  activeSpeakers?: string[];
}

function SalasPage() {
  const { users, currentUser } = useFluxo();
  const recentUsers = useFluxo().recentContactUsers(5);
  const navigate = useNavigate();
  const { ask } = useCallInviter();
  const { speakersByRoom } = useRoomPresence();
  const [bySector, setBySector] = useState<Record<string, RoomInfo[]>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
            isPrivate: r.isPrivate,
            participants: r.participants,
            activeSpeakers: r.activeSpeakers,
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

  /* A identidade no LiveKit é montada como `${id}-${nome_com_underscores}`
     (ver `salas.$roomName.tsx`), então o pedaço antes do primeiro hífen é o id
     da pessoa. Quem não for encontrado entrou por link de convidado externo e
     não tem setor nenhum — daí o rótulo próprio em vez de campo vazio. */
  const pessoasPorId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function quemE(identity: string, nomeNaSala: string): { nome: string; setor: string } {
    const u = pessoasPorId.get(identity.split("-")[0]);
    if (!u) return { nome: nomeNaSala, setor: "Convidado" };
    return {
      nome: u.name,
      setor: sectors.find((s) => s.id === u.sector)?.name ?? u.sector,
    };
  }

  function askCall(userId: string, roomName: string, roomLabel: string) {
    ask(userId, roomName, roomLabel);
    setOpenFor(null);
    setQueries((q) => ({ ...q, [roomName]: "" }));
  }

  function roomsForSector(sector: string, label: string): RoomInfo[] {
    const discovered = new Map<string, RoomInfo>();
    for (const r of bySector[sector] ?? []) discovered.set(r.name, r);
    // fixed: exactly two rooms per sector — Sala 1 and Sala 2
    const forcePrivate = sector === "diretoria";
    const fixed: RoomInfo[] = [
      { name: sector, label: `${label} · Sala 1`, isPrivate: forcePrivate, participants: [] },
      { name: `${sector}-2`, label: `${label} · Sala 2`, isPrivate: forcePrivate, participants: [] },
    ];
    return fixed.map((base) => {
      const d = discovered.get(base.name);
      /* `activeSpeakers` estava ficando para trás aqui: o objeto remontado só
         copiava nome, privacidade e participantes, então `room.activeSpeakers`
         chegava sempre `undefined` na tela e o destaque de "falando agora"
         dependia inteiramente do contexto de presença como reserva. */
      return d
        ? {
            name: base.name,
            label: base.label,
            isPrivate: forcePrivate || d.isPrivate,
            participants: d.participants,
            activeSpeakers: d.activeSpeakers,
          }
        : base;
    });
  }

  return (
    <FluxoLayout title="Salas Online" breadcrumb="Colaboração">
      <div ref={containerRef} className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salas Online</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada departamento tem duas salas fixas: Sala 1 e Sala 2.
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
            const isDiretoria = r.name === "diretoria";
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
                className={`flex flex-col gap-3 rounded-lg border p-4 transition ${
                  isDiretoria
                    ? "border-amber-500/60 bg-gradient-to-br from-amber-500/10 via-card to-card ring-1 ring-amber-500/40 hover:border-amber-500"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-md ${
                        isDiretoria ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary"
                      }`}
                    >
                      {isDiretoria ? <Lock className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 text-base font-semibold uppercase tracking-wide">
                        {r.label}
                        {isDiretoria && (
                          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            Restrita
                          </span>
                        )}
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
                     const inUse = room.participants.length > 0;
                     const speaking = new Set(speakersByRoom[room.name] ?? room.activeSpeakers ?? []);
                     const stateClasses = room.isPrivate
                       ? "border-amber-500/60 bg-amber-500/5 hover:border-amber-500 hover:bg-amber-500/10"
                       : inUse
                         ? "border-emerald-500/50 bg-emerald-500/5 hover:border-emerald-500 hover:bg-emerald-500/10"
                         : "border-border/70 bg-background hover:border-primary/50 hover:bg-primary/5";
                     return (
                       <button
                         key={room.name}
                         onClick={() =>
                           navigate({ to: "/salas/$roomName", params: { roomName: room.name } })
                         }
                        className={`group flex flex-col gap-1 rounded-md border px-2 py-1.5 text-left transition ${stateClasses}`}
                       >
                         <span className="flex items-center justify-between gap-2">
                           <span className="flex min-w-0 items-center gap-2 text-xs">
                             <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                               #{n}
                             </span>
                             <span className="truncate font-medium">Sala {n}</span>
                              {/* Quantas pessoas estão NESTA sala. O hover abre a
                                  lista — nome e setor, que é o que identifica
                                  alguém sem transformar o cartão num painel. */}
                              {inUse && (
                               <span className="group/pessoas relative inline-flex">
                                 <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                   <Users2 className="h-3 w-3" />
                                   {room.participants.length}
                                 </span>
                                 <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-max max-w-[240px] -translate-x-1/2 flex-col gap-1 rounded-md border border-border bg-popover p-2 shadow-lg group-hover/pessoas:flex">
                                   <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                                     Na chamada
                                   </span>
                                   {room.participants.map((p) => {
                                     const quem = quemE(p.identity, p.name);
                                     return (
                                       <span
                                         key={p.identity}
                                         className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
                                       >
                                         <span
                                           className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                             speaking.has(p.identity)
                                               ? "animate-pulse bg-primary"
                                               : "bg-emerald-500"
                                           }`}
                                         />
                                         <span className="font-medium text-foreground">
                                           {quem.nome}
                                         </span>
                                         <span className="text-muted-foreground">
                                           · {quem.setor}
                                         </span>
                                       </span>
                                     );
                                   })}
                                 </span>
                               </span>
                             )}
                              {(inUse || room.isPrivate) && (
                               <span
                                 className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                                   room.isPrivate
                                     ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                     : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                 }`}
                               >
                                 {room.isPrivate ? (
                                   <>
                                     <Lock className="h-2.5 w-2.5" /> Restrita
                                   </>
                                 ) : (
                                   <>
                                     <LockOpen className="h-2.5 w-2.5" /> Aberto
                                   </>
                                 )}
                               </span>
                             )}
                           </span>
                           <span className="text-[10px] font-medium text-muted-foreground group-hover:text-primary">
                             Entrar
                           </span>
                         </span>
                         {/* A lista fixa de nomes que ficava aqui saiu: era a
                             mesma informação do hover, só que sempre aberta, e
                             com cinco salas ocupadas o cartão virava uma parede
                             de etiquetas. O destaque de quem está falando foi
                             junto para dentro do hover. */}
                       </button>
                     );
                   })}
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
                         return (
                          <li key={m.id}>
                            <button
                              onClick={() => askCall(m.id, r.name, r.label)}
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
                                <Phone className="h-3 w-3" /> Chamar
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
                        return (
                          <button
                            key={m.id}
                            onClick={() => askCall(m.id, r.name, r.label)}
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

      </div>
    </FluxoLayout>
  );
}

function parseSalaIndex(name: string, sector: string): number {
  if (name === sector) return 1;
  const m = name.match(new RegExp(`^${sector}-(\\d+)$`));
  return m ? Number(m[1]) : 1;
}

