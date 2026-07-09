import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { ArrowLeft, PictureInPicture2, WifiOff } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { useActiveCall } from "@/lib/active-call-context";
import { ACTIVE_CALL_MOUNT_ID } from "@/components/active-call-widget";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";

export const Route = createFileRoute("/salas/$roomName")({
  component: RoomPage,
  head: ({ params }) => ({
    meta: [
      { title: `Sala ${params.roomName} · Fluxo` },
      { name: "description", content: "Sala de voz e vídeo do Fluxo." },
    ],
  }),
});

function RoomPage() {
  const { roomName } = Route.useParams();
  const { currentUser } = useFluxo();
  const { startCall, endCall, setMinimized, active, error } = useActiveCall();
  const navigate = useNavigate();

  const identity = useMemo(() => `${currentUser.id}-${currentUser.name.replace(/\s+/g, "_")}`, [currentUser]);
  const roomLabel = useMemo(
    () => DEPARTMENT_ROOMS.find((r) => r.name === roomName)?.label ?? roomName,
    [roomName],
  );

  useEffect(() => {
    startCall({ roomName, roomLabel, identity, name: currentUser.name });
  }, [roomName, roomLabel, identity, currentUser.name, startCall]);

  const connecting = !active || active.roomName !== roomName;

  return (
    <FluxoLayout
      title={`Sala: ${roomLabel}`}
      breadcrumb="Salas Online"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMinimized(true);
              navigate({ to: "/salas" });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm hover:bg-secondary"
            title="Minimiza a chamada para o cantinho e mantém você conectado"
          >
            <PictureInPicture2 className="h-4 w-4" />
            Modo mini
          </button>
          <button
            onClick={() => {
              endCall();
              navigate({ to: "/salas" });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" /> Sair da sala
          </button>
        </div>
      }
    >
      <div className="mx-auto h-[calc(100vh-8rem)] max-w-7xl">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center">
            <WifiOff className="h-10 w-10 text-destructive" />
            <div className="text-sm font-medium text-destructive">Não foi possível entrar na sala</div>
            <div className="max-w-md text-xs text-muted-foreground">{error}</div>
            <button
              onClick={() => {
                endCall();
                navigate({ to: "/salas" });
              }}
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Voltar
            </button>
          </div>
        ) : (
          <div
            id={ACTIVE_CALL_MOUNT_ID}
            className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card"
          >
            {connecting && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                Conectando à sala…
              </div>
            )}
          </div>
        )}
      </div>
    </FluxoLayout>
  );
}