import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
  useDataChannel,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { LogIn, Loader2, AlertTriangle, Video, Hand } from "lucide-react";
import { getGuestLiveKitToken } from "@/lib/livekit-token.functions";

export const Route = createFileRoute("/convidado/$roomName")({
  component: GuestRoomPage,
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === "string" ? search.t : "",
  }),
  head: ({ params }) => ({
    meta: [
      { title: `Entrar como convidado · ${params.roomName}` },
      { name: "description", content: "Você foi convidado para uma reunião no Fluxo." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function GuestRoomPage() {
  const { roomName } = Route.useParams();
  const { t: guestToken } = Route.useSearch();
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [session, setSession] = useState<{ token: string; url: string } | null>(null);

  async function join() {
    if (!guestToken) {
      setErr("Convite inválido — peça um novo link para quem te chamou.");
      return;
    }
    if (name.trim().length < 2) {
      setErr("Digite um nome para os outros te reconhecerem.");
      return;
    }
    setJoining(true);
    setErr(null);
    try {
      const res = await getGuestLiveKitToken({
        data: { roomName, guestToken, name: name.trim() },
      });
      setSession({ token: res.token, url: res.url });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível entrar na sala");
    } finally {
      setJoining(false);
    }
  }

  if (session) {
    return (
      <div className="fixed inset-0 z-0 bg-black" data-lk-theme="default">
        <LiveKitRoom
          token={session.token}
          serverUrl={session.url}
          connect
          audio
          video
          style={{ height: "100%", width: "100%" }}
          onDisconnected={() => setSession(null)}
        >
          <GuestCall onLeave={() => setSession(null)} />
        </LiveKitRoom>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-neutral-950 via-neutral-900 to-sky-950 p-4">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900/80 p-6 text-white shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 text-sky-300">
          <Video className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-widest">Reunião no Fluxo</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold">Você foi convidado como visitante</h1>
        <p className="mt-1 text-xs text-white/60">
          Sala <span className="font-mono text-white/80">{roomName}</span>. Você não precisa criar
          conta — só digite seu nome e entre.
        </p>

        <label className="mt-5 block text-xs font-medium text-white/70">Seu nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void join();
          }}
          maxLength={60}
          placeholder="Ex.: Maria Silva – Cliente Acme"
          autoFocus
          className="mt-1 w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-400"
        />

        {err && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void join()}
          disabled={joining}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:opacity-60"
        >
          {joining ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Entrando na sala…
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" /> Entrar na reunião
            </>
          )}
        </button>

        <p className="mt-4 text-center text-[10px] text-white/40">
          Ao entrar você concorda em usar sua câmera e microfone apenas para esta conversa.
        </p>
      </section>
    </main>
  );
}

function GuestCall({ onLeave }: { onLeave: () => void }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const visible = useMemo(() => tracks, [tracks]);
  const { localParticipant } = useLocalParticipant();
  const { send } = useDataChannel("fluxo-room");
  const [raised, setRaised] = useState(false);
  const raiseHand = () => {
    const name = localParticipant.name || localParticipant.identity || "Convidado";
    try {
      send?.(new TextEncoder().encode(JSON.stringify({ kind: "raise", name })), { reliable: true });
    } catch {
      /* ignore */
    }
    setRaised(true);
    window.setTimeout(() => setRaised(false), 2500);
  };
  return (
    <div className="flex h-full w-full flex-col bg-black text-white">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/70 px-3 py-1.5 text-xs">
        <span className="font-semibold text-sky-300">Você está na reunião como convidado</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={raiseHand}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${
              raised ? "bg-amber-400 text-black" : "bg-white/10 text-white hover:bg-white/20"
            }`}
            title="Levantar a mão"
          >
            <Hand className="h-3.5 w-3.5" /> Mão
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500"
          >
            Sair
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <GridLayout tracks={visible} style={{ height: "100%" }}>
          <ParticipantTile />
        </GridLayout>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-t border-white/10 bg-black/70 px-2 py-1">
        <ControlBar
          variation="minimal"
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            chat: false,
            leave: true,
            settings: false,
          }}
        />
      </div>
      <RoomAudioRenderer />
    </div>
  );
}