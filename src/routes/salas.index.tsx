import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Headphones, Lock, Plus, Radio, Users2 } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";

type Room = {
  name: string;
  label: string;
  desc: string;
  privateRoom: boolean;
};

const DEFAULT_ROOMS: Room[] = [
  { name: "geral", label: "Geral", desc: "Sala aberta para o time todo", privateRoom: false },
  { name: "comercial", label: "Comercial", desc: "Reuniões do time comercial", privateRoom: false },
  { name: "operacoes", label: "Operações", desc: "Alinhamentos de operações", privateRoom: false },
  { name: "1on1", label: "1:1 Privado", desc: "Conversas rápidas 1 a 1", privateRoom: true },
];

const STORAGE_KEY = "fluxo:custom-rooms";

function loadCustom(): Room[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Room[]) : [];
  } catch {
    return [];
  }
}

function saveCustom(rooms: Room[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const Route = createFileRoute("/salas/")({
  component: SalasPage,
  head: () => ({
    meta: [
      { title: "Salas Online · Fluxo" },
      { name: "description", content: "Salas de voz e vídeo do time — reuniões rápidas estilo Discord empresarial." },
    ],
  }),
});

function SalasPage() {
  const { currentUser } = useFluxo();
  const navigate = useNavigate();
  const [custom, setCustom] = useState<Room[]>([]);
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [joinName, setJoinName] = useState("");

  useEffect(() => {
    setCustom(loadCustom());
  }, []);

  const rooms = [...DEFAULT_ROOMS, ...custom];

  function createRoom(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugify(newLabel);
    if (!slug) return;
    if (rooms.some((r) => r.name === slug)) {
      navigate({ to: "/salas/$roomName", params: { roomName: slug } });
      return;
    }
    const next = [...custom, { name: slug, label: newLabel.trim(), desc: newDesc.trim(), privateRoom: newPrivate }];
    setCustom(next);
    saveCustom(next);
    setNewLabel("");
    setNewDesc("");
    setNewPrivate(false);
    setCreating(false);
    navigate({ to: "/salas/$roomName", params: { roomName: slug } });
  }

  function joinByName(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugify(joinName);
    if (!slug) return;
    navigate({ to: "/salas/$roomName", params: { roomName: slug } });
  }

  return (
    <FluxoLayout title="Salas Online" breadcrumb="Colaboração">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salas Online</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Entre em uma sala de voz e vídeo para conversar com o time. Estilo Discord, direto no navegador.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:brightness-110"
          >
            <Plus className="h-4 w-4" /> Nova sala
          </button>
        </header>

        {creating && (
          <form
            onSubmit={createRoom}
            className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[1fr_1fr_auto_auto]"
          >
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Nome da sala (ex: Planejamento Q4)"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Descrição (opcional)"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <input type="checkbox" checked={newPrivate} onChange={(e) => setNewPrivate(e.target.checked)} />
              Privada
            </label>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110"
            >
              Criar e entrar
            </button>
          </form>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Salas do workspace</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((r) => (
              <Link
                key={r.name}
                to="/salas/$roomName"
                params={{ roomName: r.name }}
                className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/60 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {r.privateRoom ? <Lock className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Radio className="h-2.5 w-2.5" /> {r.privateRoom ? "Privada" : "Aberta"}
                  </span>
                </div>
                <div>
                  <div className="text-base font-semibold group-hover:text-primary">{r.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.desc || `sala/${r.name}`}</div>
                </div>
                <div className="mt-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Users2 className="h-3.5 w-3.5" /> Entre para ver quem está online
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-dashed border-border bg-card/50 p-4">
          <h2 className="text-sm font-semibold">Entrar por código</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Recebeu um nome/código de sala? Digite abaixo para entrar direto — quem souber o nome pode entrar.
          </p>
          <form onSubmit={joinByName} className="mt-3 flex gap-2">
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="ex: reuniao-quinta"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-secondary px-4 py-2 text-sm font-medium hover:bg-secondary/80"
            >
              Entrar
            </button>
          </form>
        </section>

        <p className="text-[11px] text-muted-foreground">
          Você entrará como <span className="font-medium text-foreground">{currentUser.name}</span>. Para simular outra
          pessoa, troque o usuário no menu lateral.
        </p>
      </div>
    </FluxoLayout>
  );
}