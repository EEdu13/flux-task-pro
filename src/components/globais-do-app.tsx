import { useRouterState } from "@tanstack/react-router";
import { useFluxo } from "@/lib/fluxo-store";
import { TaskDialog } from "@/components/task-dialog";
import { QuickTaskModal } from "@/components/quick-task-modal";
import { IncomingCall } from "@/components/incoming-call";
import { AttentionOverlay } from "@/components/attention-overlay";
import { EmojiGigante } from "@/components/emoji-gigante";
import { OutgoingCallWatcher } from "@/components/outgoing-call-watcher";
import { TractorBanner } from "@/components/tractor-banner";
import { ChatDock } from "@/components/chat-dock";
import { TaskContextMenu } from "@/components/task-context-menu";
import { TarefasAtrasadas } from "@/components/tarefas-atrasadas";
import { CommandPalette } from "@/components/command-palette";
import { ReservaDeSalaModal } from "@/components/reserva-de-sala-modal";
import { TeamDelegatePanel } from "@/components/team-delegate-panel";
import { FocusOverlay } from "@/components/focus-overlay";
import { Novidades } from "@/components/novidades";

/** Páginas que não usam o `FluxoLayout` — e não querem as janelas globais. */
const SEM_GLOBAIS = ["/login", "/convidado", "/chamada", "/conferir-dados-antigos"];

/**
 * As janelas e avisos que valem para o app inteiro — chat, chamar atenção,
 * chamada recebida, paleta, menu da tarefa, janela da tarefa…
 *
 * Moravam dentro do `FluxoLayout`, que cada página monta por conta própria:
 * a cada troca de página tudo era desmontado e montado de novo, e as
 * sondagens (avisos de 1 em 1 s, chamadas de 1,5 em 1,5 s) recomeçavam do
 * zero, com uma ida imediata ao servidor. Aqui, na raiz, elas são montadas
 * uma vez e sobrevivem à navegação (auditoria de 08/10/2026).
 */
export function GlobaisDoApp() {
  const { isAuthenticated } = useFluxo();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!isAuthenticated) return null;
  if (SEM_GLOBAIS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return (
    <>
      <TaskDialog />
      <QuickTaskModal />
      <IncomingCall />
      <AttentionOverlay />
      <EmojiGigante />
      <OutgoingCallWatcher />
      <TractorBanner />
      <ChatDock />
      <TaskContextMenu />
      <TarefasAtrasadas />
      <CommandPalette />
      {/* Um só lugar montando: o calendário e a paleta também abrem este
          modal, e duas instâncias disputariam o mesmo evento. */}
      <ReservaDeSalaModal />
      <TeamDelegatePanel />
      <FocusOverlay />
      {/* "O que mudou": uma vez por pessoa, por versão — ver `novidades.tsx`. */}
      <Novidades />
    </>
  );
}
