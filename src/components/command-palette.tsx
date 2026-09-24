import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { TravaScroll } from "@/components/trava-scroll";
import {
  CheckSquare,
  Users,
  Headphones,
  FileText,
  StickyNote,
  Inbox,
  Plus,
  Home,
  Calendar,
  Target,
  BarChart3,
  Settings,
  Phone,
  DoorOpen,
  Search,
} from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { abrirReservaDeSala } from "@/components/reserva-de-sala-modal";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { useCallInviter } from "@/lib/call-inviter-context";
import { toast } from "sonner";

function readAllNotesForUser(userId: string): { id: string; title: string; snippet: string }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`fluxo.notepad.v2:${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      tabs?: { id: string; title: string; content: string }[];
    };
    return (parsed.tabs ?? [])
      .filter((t) => (t.content ?? "").trim().length > 0)
      .map((t) => ({
        id: t.id,
        title: t.title,
        snippet: (t.content ?? "").slice(0, 80),
      }));
  } catch {
    return [];
  }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const {
    tasks,
    users,
    currentUser,
    openTask,
    openNewTask,
    visibleMinutes,
    notifications,
  } = useFluxo();
  const { ask: askInvite } = useCallInviter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      /* `/` abre a busca — a convenção da web, e o que o campo da topbar
         anuncia desde que virou botão. Fora de campo de texto, claro: senão
         ninguém escreve uma barra num título de tarefa. */
      if (e.key === "/" && !open) {
        const alvo = e.target as HTMLElement | null;
        const digitando =
          alvo &&
          (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
        if (!digitando) {
          e.preventDefault();
          setOpen(true);
        }
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("fluxo:palette-open", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("fluxo:palette-open", onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const notes = useMemo(() => (open ? readAllNotesForUser(currentUser.id) : []), [
    open,
    currentUser.id,
  ]);

  const minutes = useMemo(() => (open ? visibleMinutes() : []), [open, visibleMinutes]);

  const myInboxMsgs = useMemo(
    () =>
      notifications
        .filter((n) => n.userId === currentUser.id)
        .slice(0, 40),
    [notifications, currentUser.id],
  );

  if (!open) return null;

  const go = (fn: () => void) => {
    setOpen(false);
    // let dialog close cleanly first
    setTimeout(fn, 0);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <TravaScroll />
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <Command label="Busca global" shouldFilter={true} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            {/* "Ctrl+K", não "⌘K": o app roda no Windows, e agora o botão da
                topbar que abre isto aqui anuncia o atalho com esse nome — dois
                nomes para a mesma tecla, lado a lado, é contradição na tela. */}
            <span className="text-xs text-muted-foreground">Ctrl+K</span>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar tarefa, pessoa, sala, ata, nota, ação…"
              className="flex-1 bg-transparent px-1 py-3 text-sm outline-none"
              autoFocus
            />
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              Esc
            </button>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2 text-sm">
            <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nada encontrado.
            </Command.Empty>

            <Command.Group heading="Ações rápidas" className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
              <PaletteItem
                icon={Plus}
                label="Criar nova tarefa"
                shortcut="N"
                onSelect={() => go(() => openNewTask())}
              />
              <PaletteItem
                icon={StickyNote}
                label="Abrir bloco de notas"
                onSelect={() =>
                  go(() => window.dispatchEvent(new CustomEvent("fluxo:notepad-open")))
                }
              />
              <PaletteItem
                icon={Users}
                label="Delegar rápido (painel da equipe)"
                shortcut="⌘E"
                onSelect={() =>
                  go(() => window.dispatchEvent(new CustomEvent("fluxo:team-panel-open")))
                }
              />
              {/* As palavras-chave são o que faz este item aparecer: quem
                  procura pensa em "sala de reunião", "Sala Maior", "reservar"
                  — não no nome da tela. E "sala" sozinho traz também as salas
                  de voz logo abaixo, que é justamente a confusão a evitar. */}
              <PaletteItem
                icon={DoorOpen}
                label="Reservar sala de reunião"
                hint="Sala Maior ou Sala Menor"
                keywords={["sala", "reuniao", "reunião", "reservar", "agendador", "maior", "menor"]}
                onSelect={() => go(() => abrirReservaDeSala())}
              />
            </Command.Group>

            <Command.Group heading="Navegar" className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground">
              {[
                { to: "/", label: "Início", icon: Home },
                { to: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare },
                { to: "/inbox", label: "Caixa de entrada", icon: Inbox },
                { to: "/equipe", label: "Equipe", icon: Users },
                { to: "/atas", label: "Atas & Planos", icon: FileText },
                { to: "/metas", label: "Metas & Score", icon: Target },
                { to: "/calendario", label: "Calendário", icon: Calendar },
                { to: "/relatorios", label: "Relatórios", icon: BarChart3 },
                { to: "/configuracoes", label: "Configurações", icon: Settings },
              ].map((n) => (
                <PaletteItem
                  key={n.to}
                  icon={n.icon}
                  label={n.label}
                  keywords={[n.to]}
                  onSelect={() => go(() => navigate({ to: n.to }))}
                />
              ))}
            </Command.Group>

            <Command.Group
              heading="Tarefas"
              className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {/* A saída para o quadro inteiro. A paleta abre UMA tarefa; quem
                  quer filtrar a lista por um termo — "me mostra tudo que fala
                  de orçamento" — precisava da barra da topbar, que agora é só
                  o gatilho daqui.

                  Este item não precisa escapar do filtro do cmdk: o rótulo
                  carrega o próprio termo digitado, então ele casa sempre,
                  inclusive quando nada mais casa. (`forceMount` seria pior —
                  o item fica montado, mas o cmdk esconde o grupo que não tem
                  nenhum item pontuado, e ele some junto.) */}
              {query.trim() && (
                <PaletteItem
                  icon={Search}
                  label={`Ver todas as tarefas com "${query.trim()}"`}
                  hint="abre o quadro já filtrado"
                  onSelect={() =>
                    go(() => {
                      const q = query.trim();
                      navigate({ to: "/minhas-tarefas", search: { q } });
                      window.dispatchEvent(
                        new CustomEvent("fluxo:busca-global", { detail: { q } }),
                      );
                    })
                  }
                />
              )}
              {tasks.slice(0, 200).map((t) => {
                const assignee = users.find((u) => u.id === t.assigneeId);
                return (
                  <PaletteItem
                    key={t.id}
                    icon={CheckSquare}
                    label={t.title}
                    hint={`${t.status} · ${assignee?.name ?? "sem responsável"}`}
                    keywords={[t.status, assignee?.name ?? "", ...(t.tags ?? [])]}
                    onSelect={() => go(() => openTask(t.id))}
                  />
                );
              })}
            </Command.Group>

            <Command.Group
              heading="Pessoas"
              className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {users
                .filter((u) => u.id !== currentUser.id)
                .map((u) => (
                  <PaletteItem
                    key={u.id}
                    icon={Users}
                    label={u.name}
                    hint={`${u.jobTitle} · ${u.sector}`}
                    keywords={[u.jobTitle, u.sector, u.email ?? ""]}
                    onSelect={() => go(() => navigate({ to: "/equipe" }))}
                  />
                ))}
            </Command.Group>

            <Command.Group
              heading="Salas"
              className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {DEPARTMENT_ROOMS.map((r) => (
                <PaletteItem
                  key={r.name}
                  icon={Headphones}
                  label={`Entrar na sala ${r.label}`}
                  hint={r.desc}
                  keywords={[r.name, r.sector ?? ""]}
                  onSelect={() =>
                    go(() => navigate({ to: "/salas/$roomName", params: { roomName: r.name } }))
                  }
                />
              ))}
            </Command.Group>

            <Command.Group
              heading="Ligar para"
              className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {users
                .filter((u) => u.id !== currentUser.id)
                .slice(0, 40)
                .map((u) => {
                  const sectorRoom =
                    DEPARTMENT_ROOMS.find((r) => r.sector === u.sector) ?? DEPARTMENT_ROOMS[0];
                  return (
                    <PaletteItem
                      key={`call-${u.id}`}
                      icon={Phone}
                      label={`Ligar para ${u.name}`}
                      hint={sectorRoom.label}
                      keywords={["ligar", "chamar", u.sector]}
                      onSelect={() =>
                        go(() => {
                          askInvite(u.id, sectorRoom.name, sectorRoom.label);
                          toast.success(`Chamando ${u.name.split(" ")[0]}…`);
                        })
                      }
                    />
                  );
                })}
            </Command.Group>

            {minutes.length > 0 && (
              <Command.Group
                heading="Atas"
                className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {minutes.slice(0, 30).map((m) => (
                  <PaletteItem
                    key={m.id}
                    icon={FileText}
                    label={`${m.roomLabel} — ${new Date(m.createdAt).toLocaleDateString("pt-BR")}`}
                    hint={m.markdown.slice(0, 80)}
                    keywords={m.participantNames}
                    onSelect={() => go(() => navigate({ to: "/atas" }))}
                  />
                ))}
              </Command.Group>
            )}

            {notes.length > 0 && (
              <Command.Group
                heading="Notas"
                className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {notes.map((n) => (
                  <PaletteItem
                    key={n.id}
                    icon={StickyNote}
                    label={n.title}
                    hint={n.snippet}
                    onSelect={() =>
                      go(() => window.dispatchEvent(new CustomEvent("fluxo:notepad-open")))
                    }
                  />
                ))}
              </Command.Group>
            )}

            {myInboxMsgs.length > 0 && (
              <Command.Group
                heading="Caixa de entrada"
                className="mb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {myInboxMsgs.map((n) => (
                  <PaletteItem
                    key={n.id}
                    icon={Inbox}
                    label={n.title}
                    hint={n.desc}
                    onSelect={() =>
                      go(() => {
                        if (n.taskId) openTask(n.taskId);
                        else if (n.type === "projeto")
                          navigate({
                            to: "/projetos",
                            search: n.projectId ? { projeto: n.projectId } : {},
                          });
                        else navigate({ to: "/inbox" });
                      })
                    }
                  />
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="border-t border-border bg-secondary/40 px-3 py-1.5 text-[10px] text-muted-foreground">
            ↑↓ navegar · Enter abrir · Esc fechar
          </div>
        </Command>
      </div>
    </div>
  );
}

function PaletteItem({
  icon: Icon,
  label,
  hint,
  shortcut,
  keywords,
  onSelect,
}: {
  icon: typeof Plus;
  label: string;
  hint?: string;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={`${label} ${hint ?? ""} ${keywords?.join(" ") ?? ""}`}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs data-[selected=true]:bg-secondary"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate font-medium text-foreground">{label}</span>
      {hint && (
        <span className="ml-2 max-w-[240px] truncate text-[10px] text-muted-foreground">
          {hint}
        </span>
      )}
      {shortcut && (
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </span>
      )}
    </Command.Item>
  );
}