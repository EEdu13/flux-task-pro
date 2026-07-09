import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  formatChatMessageLinks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft, Loader2, PictureInPicture2, WifiOff } from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { getLiveKitToken } from "@/lib/livekit-token.functions";

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
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    setPipSupported(typeof document !== "undefined" && !!document.pictureInPictureEnabled);
    const onLeave = () => setPipActive(false);
    document.addEventListener("leavepictureinpicture", onLeave);
    return () => document.removeEventListener("leavepictureinpicture", onLeave);
  }, []);

  async function togglePip() {
    try {
      const doc = document as Document & { pictureInPictureElement?: Element | null };
      if (doc.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setPipActive(false);
        return;
      }
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video"));
      const target =
        videos.find((v) => !v.paused && v.readyState >= 2 && v.videoWidth > 0) ??
        videos.find((v) => v.readyState >= 2 && v.videoWidth > 0);
      if (!target) return;
      await target.requestPictureInPicture();
      setPipActive(true);
    } catch (err) {
      console.error("PiP falhou", err);
    }
  }

  const identity = useMemo(() => `${currentUser.id}-${currentUser.name.replace(/\s+/g, "_")}`, [currentUser]);

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setError(null);
    setConnected(false);
    getLiveKitToken({ data: { roomName, identity, name: currentUser.name } })
      .then((res) => {
        if (cancelled) return;
        setToken(res.token);
        setServerUrl(res.url);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao gerar token");
      });
    return () => {
      cancelled = true;
    };
  }, [roomName, identity, currentUser.name]);

  return (
    <FluxoLayout
      title={`Sala: ${roomName}`}
      breadcrumb="Salas Online"
      actions={
        <div className="flex items-center gap-2">
          {pipSupported && connected && (
            <button
              onClick={togglePip}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm hover:bg-secondary"
              title="Modo mini (Picture-in-Picture) — a chamada flutua enquanto você usa o app"
            >
              <PictureInPicture2 className="h-4 w-4" />
              {pipActive ? "Sair do mini" : "Modo mini"}
            </button>
          )}
          <button
            onClick={() => navigate({ to: "/salas" })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" /> Sair da sala
          </button>
        </div>
      }
    >
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col overflow-hidden rounded-xl border border-border bg-card">
        {error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <WifiOff className="h-10 w-10 text-destructive" />
            <div className="text-sm font-medium text-destructive">Não foi possível entrar na sala</div>
            <div className="max-w-md text-xs text-muted-foreground">{error}</div>
            <button
              onClick={() => navigate({ to: "/salas" })}
              className="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            >
              Voltar
            </button>
          </div>
        )}

        {!error && !token && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <div className="text-sm">Conectando à sala…</div>
          </div>
        )}

        {token && serverUrl && (
          <LiveKitRoom
            token={token}
            serverUrl={serverUrl}
            connect
            audio
            video
            data-lk-theme="default"
            style={{ height: "100%", width: "100%" }}
            onConnected={() => setConnected(true)}
            onDisconnected={() => setConnected(false)}
            onError={(e) => setError(e.message)}
          >
            <VideoConference chatMessageFormatter={formatChatMessageLinks} />
            <RoomAudioRenderer />
          </LiveKitRoom>
        )}
      </div>
      {token && !connected && !error && (
        <p className="mt-3 text-center text-xs text-muted-foreground">Aguardando permissão de câmera/microfone…</p>
      )}
    </FluxoLayout>
  );
}