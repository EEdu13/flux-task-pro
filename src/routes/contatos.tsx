import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  Crown,
  Mail,
  Phone,
  Search,
  Shield,
  Users as UsersIcon,
  X,
  PhoneCall,
  MessageCircle,
  Headphones,
  Mail as MailIcon,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels, sectors, type Role, type User } from "@/lib/fluxo-types";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { useCallInviter } from "@/lib/call-inviter-context";
import { toast } from "sonner";

export const Route = createFileRoute("/contatos")({
  head: () => ({
    meta: [
      { title: "Contatos · Fluxo" },
      {
        name: "description",
        content:
          "Busque colaboradores e visualize a hierarquia de reporte até a diretoria.",
      },
    ],
  }),
  component: ContatosPage,
});

const roleIcon: Record<Role, typeof Crown> = {
  gerente: Crown,
  supervisor: Shield,
  adm: UsersIcon,
};

const roleAccent: Record<Role, string> = {
  gerente: "from-amber-400/25 to-amber-500/5 border-amber-400/40 text-amber-500",
  supervisor: "from-primary/25 to-primary/5 border-primary/40 text-primary",
  adm: "from-emerald-400/20 to-emerald-500/5 border-emerald-400/30 text-emerald-500",
};

function sectorMeta(id: string) {
  return sectors.find((s) => s.id === id) ?? { name: id, color: "oklch(0.6 0.02 260)" };
}

function buildChain(users: User[], userId: string): User[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const chain: User[] = [];
  const seen = new Set<string>();
  let cur = byId.get(userId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.supervisorId) break;
    cur = byId.get(cur.supervisorId);
  }
  // From selected up to top (leaf → root). Reverse for top → down display.
  return chain.reverse();
}

function Avatar({ user, size = "md" }: { user: User; size?: "sm" | "md" | "lg" }) {
  const sec = sectorMeta(user.sector);
  const dim = size === "lg" ? "h-14 w-14 text-lg" : size === "sm" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-xs";
  return (
    <div
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full font-bold text-white shadow-md`}
      style={{ background: sec.color }}
    >
      {user.avatar}
    </div>
  );
}

function ContactCard({
  user,
  onSelect,
  onCall,
}: {
  user: User;
  onSelect: (id: string) => void;
  onCall: (user: User) => void;
}) {
  const sec = sectorMeta(user.sector);
  const RoleIcon = roleIcon[user.role];
  return (
    <motion.button
      type="button"
      layout
      onClick={() => onSelect(user.id)}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-primary/50 hover:shadow-md"
    >
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <RoleIcon className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{user.jobTitle}</div>
        <div
          className="mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
          style={{ background: `color-mix(in oklab, ${sec.color} 15%, transparent)`, color: sec.color }}
        >
          <Building2 className="h-2.5 w-2.5" />
          {sec.name}
        </div>
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onCall(user);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onCall(user);
          }
        }}
        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm transition hover:bg-primary hover:text-primary-foreground"
      >
        <PhoneCall className="h-3 w-3" />
        Chamar
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
    </motion.button>
  );
}

function HierarchyNode({
  user,
  level,
  isSelected,
  isTop,
}: {
  user: User;
  level: number;
  isSelected: boolean;
  isTop: boolean;
}) {
  const sec = sectorMeta(user.sector);
  const RoleIcon = roleIcon[user.role];
  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.95 }}
      transition={{ delay: level * 0.12, type: "spring", stiffness: 200, damping: 20 }}
      className={`relative flex w-full max-w-md flex-col items-center rounded-2xl border bg-gradient-to-br p-4 shadow-lg ${roleAccent[user.role]} ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
    >
      {isTop && (
        <span className="absolute -top-2.5 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-950 shadow">
          Diretoria
        </span>
      )}
      <div className="flex items-center gap-3">
        <Avatar user={user} size="lg" />
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-base font-bold">{user.name}</div>
            <RoleIcon className="h-4 w-4" />
          </div>
          <div className="text-xs text-muted-foreground">{user.jobTitle}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium"
              style={{
                background: `color-mix(in oklab, ${sec.color} 18%, transparent)`,
                color: sec.color,
              }}
            >
              <Building2 className="h-2.5 w-2.5" />
              {sec.name}
            </span>
            <span className="rounded-full bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
              {roleLabels[user.role]}
            </span>
          </div>
        </div>
      </div>
      {(user.email || user.phone) && (
        <div className="mt-3 flex w-full flex-wrap gap-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          {user.email && (
            <a
              href={`mailto:${user.email}`}
              className="inline-flex items-center gap-1 hover:text-primary"
            >
              <Mail className="h-3 w-3" /> {user.email}
            </a>
          )}
          {user.phone && (
            <a href={`tel:${user.phone}`} className="inline-flex items-center gap-1 hover:text-primary">
              <Phone className="h-3 w-3" /> {user.phone}
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}

function ContatosPage() {
  const { users, currentUser } = useFluxo();
  const navigate = useNavigate();
  const { ask: askInvite } = useCallInviter();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>("todos");
  const [callMenu, setCallMenu] = useState<User | null>(null);
  const [roomPicker, setRoomPicker] = useState<User | null>(null);

  const handleCall = (u: User) => setCallMenu(u);

  const openWhatsApp = (u: User) => {
    const phone = (u.phone ?? "").replace(/\D/g, "");
    if (!phone) {
      toast.error(`${u.name} não tem telefone cadastrado.`);
      return;
    }
    const text = encodeURIComponent(`Olá, ${u.name.split(" ")[0]}! Aqui é ${currentUser.name}.`);
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
    setCallMenu(null);
  };

  const openEmail = (u: User) => {
    if (!u.email) {
      toast.error(`${u.name} não tem e-mail cadastrado.`);
      return;
    }
    window.location.href = `mailto:${u.email}`;
    setCallMenu(null);
  };

  const startGestor = (u: User) => {
    setCallMenu(null);
    setRoomPicker(u);
  };

  const inviteToRoom = (u: User, roomName: string, roomLabel: string) => {
    askInvite(u.id, roomName, roomLabel);
    toast.success(`Convite enviado para ${u.name.split(" ")[0]} • ${roomLabel}`);
    setRoomPicker(null);
    navigate({ to: "/salas/$roomName", params: { roomName } });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => (sectorFilter === "todos" ? true : u.sector === sectorFilter))
      .filter((u) => {
        if (!q) return true;
        return (
          u.name.toLowerCase().includes(q) ||
          u.jobTitle.toLowerCase().includes(q) ||
          u.sector.toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, query, sectorFilter]);

  const chain = useMemo(
    () => (selectedId ? buildChain(users, selectedId) : []),
    [selectedId, users],
  );
  const selected = users.find((u) => u.id === selectedId) ?? null;

  return (
    <FluxoLayout
      title="Contatos"
      breadcrumb="Pessoas · Hierarquia"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* Search + list */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, cargo, setor…"
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSectorFilter("todos")}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                sectorFilter === "todos"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              }`}
            >
              Todos
            </button>
            {sectors.map((s) => (
              <button
                key={s.id}
                onClick={() => setSectorFilter(s.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  sectorFilter === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "pessoa" : "pessoas"}
          </div>
          <div className="flex flex-col gap-2 pr-1">
            <AnimatePresence initial={false}>
              {filtered.map((u) => (
                <motion.div
                  key={u.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <ContactCard user={u} onSelect={setSelectedId} onCall={handleCall} />
                </motion.div>
              ))}
            </AnimatePresence>
            {filtered.length === 0 && (
              <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                Nenhum contato encontrado.
              </div>
            )}
          </div>
        </div>

        {/* Hierarchy panel */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex h-full min-h-[300px] flex-col items-center justify-center text-center"
              >
                <div className="mb-3 rounded-full bg-primary/10 p-4 text-primary">
                  <UsersIcon className="h-8 w-8" />
                </div>
                <div className="text-sm font-semibold">Escolha um contato</div>
                <div className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Clique em qualquer pessoa da lista para visualizar a linha de reporte,
                  do colaborador até a diretoria.
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="mb-4 flex items-center justify-between">
                  <button
                    onClick={() => setSelectedId(null)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-primary"
                  >
                    <ArrowLeft className="h-3 w-3" /> Voltar
                  </button>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Linha de reporte · {chain.length} {chain.length === 1 ? "nível" : "níveis"}
                  </div>
                </div>
                <div className="flex flex-col items-center gap-0">
                  <AnimatePresence>
                    {chain.map((u, idx) => (
                      <div key={u.id} className="flex w-full flex-col items-center">
                        <HierarchyNode
                          user={u}
                          level={idx}
                          isSelected={u.id === selected.id}
                          isTop={idx === 0}
                        />
                        {idx < chain.length - 1 && (
                          <motion.div
                            initial={{ scaleY: 0, opacity: 0 }}
                            animate={{ scaleY: 1, opacity: 1 }}
                            transition={{ delay: idx * 0.12 + 0.15, duration: 0.35 }}
                            className="my-2 h-8 w-0.5 origin-top bg-gradient-to-b from-primary/60 to-primary/10"
                          />
                        )}
                      </div>
                    ))}
                  </AnimatePresence>
                </div>
                {chain.length === 1 && (
                  <div className="mt-4 text-center text-[11px] text-muted-foreground">
                    Esta pessoa está no topo da hierarquia.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Call action menu */}
      <AnimatePresence>
        {callMenu && (
          <motion.div
            key="call-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setCallMenu(null)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="flex items-center gap-3 border-b border-border bg-gradient-to-br from-primary/10 via-card to-card p-4">
                <Avatar user={callMenu} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{callMenu.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{callMenu.jobTitle}</div>
                </div>
                <button
                  onClick={() => setCallMenu(null)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col p-2">
                <button
                  onClick={() => openWhatsApp(callMenu)}
                  className="group flex items-center gap-3 rounded-lg p-3 text-left transition hover:bg-emerald-500/10"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 transition group-hover:bg-emerald-500 group-hover:text-white">
                    <MessageCircle className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">WhatsApp</div>
                    <div className="text-[11px] text-muted-foreground">
                      {callMenu.phone ?? "Sem telefone cadastrado"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
                <button
                  onClick={() => startGestor(callMenu)}
                  className="group flex items-center gap-3 rounded-lg p-3 text-left transition hover:bg-primary/10"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                    <Headphones className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Chamar no gestor</div>
                    <div className="text-[11px] text-muted-foreground">
                      Escolha uma sala e envie o convite
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
                <button
                  onClick={() => openEmail(callMenu)}
                  className="group flex items-center gap-3 rounded-lg p-3 text-left transition hover:bg-amber-500/10"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 transition group-hover:bg-amber-500 group-hover:text-white">
                    <MailIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">E-mail</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {callMenu.email ?? "Sem e-mail cadastrado"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Room picker */}
      <AnimatePresence>
        {roomPicker && (
          <motion.div
            key="room-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setRoomPicker(null)}
          >
            <motion.div
              initial={{ scale: 0.92, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Escolha uma sala
                  </div>
                  <div className="text-sm font-semibold">
                    Convidar {roomPicker.name.split(" ")[0]}
                  </div>
                </div>
                <button
                  onClick={() => setRoomPicker(null)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid max-h-[60vh] grid-cols-1 gap-1.5 overflow-y-auto p-3 sm:grid-cols-2">
                {DEPARTMENT_ROOMS.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => inviteToRoom(roomPicker, r.name, r.label)}
                    className="group flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary hover:bg-primary/5"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                      <Headphones className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{r.label}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{r.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </FluxoLayout>
  );
}
