import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { AlertTriangle, DoorOpen, Loader2, LogIn } from "lucide-react";
import { getGuestLiveKitToken } from "@/lib/livekit-token.functions";
import { CallContents, type MudarMidia } from "@/components/active-call-widget";
import { CabecalhoDaPrevia, PainelDePrevia, usePreviaDeDispositivos } from "@/components/pre-call";
import { rotuloDaSala } from "@/lib/rooms";

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

/** A ligação do convidado, e como ele quer o microfone e a câmera agora. */
type Sessao = {
  token: string;
  url: string;
  micOn: boolean;
  camOn: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
};

/**
 * A reunião para quem entra por link, sem login.
 *
 * Por dentro da chamada é a MESMA tela do time (`CallContents`, em modo
 * convidado): chat, mão levantada, aviso de microfone mudo, fundo de vídeo,
 * volume por pessoa e atalhos. Antes era uma tela à parte, com a barra padrão
 * do LiveKit, e o convidado ficava sem chat — o time escrevia achando que ele
 * lia — e sem ver as mãos dos outros.
 */
function GuestRoomPage() {
  const { roomName } = Route.useParams();
  const { t: guestToken } = Route.useSearch();
  const roomLabel = useMemo(() => rotuloDaSala(roomName), [roomName]);
  const [name, setName] = useState("");
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [saiu, setSaiu] = useState(false);

  /* O microfone e a câmera eram `audio` e `video` fixos em true, e o LiveKit
     reaplica esse valor a cada reconexão: o convidado se mutava, a rede dele
     oscilava, e o microfone reabria sem aviso — ele achando que estava mudo
     e a sala ouvindo. Agora o valor acompanha cada troca feita na chamada.
     `useCallback` sem dependências porque `CallContents` precisa dele estável
     (ver a prop `aoMudarMidia` lá). */
  const aoMudarMidia = useCallback<MudarMidia>((patch) => {
    setSessao((s) => {
      if (!s) return s;
      if (
        (patch.micOn === undefined || patch.micOn === s.micOn) &&
        (patch.camOn === undefined || patch.camOn === s.camOn)
      ) {
        return s;
      }
      return { ...s, ...patch };
    });
  }, []);

  const sair = useCallback(() => {
    setSessao(null);
    setSaiu(true);
  }, []);

  if (sessao) {
    return (
      <div className="fixed inset-0 z-0 bg-black">
        <LiveKitRoom
          token={sessao.token}
          serverUrl={sessao.url}
          connect
          audio={sessao.micOn && (sessao.micDeviceId ? { deviceId: sessao.micDeviceId } : true)}
          video={sessao.camOn && (sessao.camDeviceId ? { deviceId: sessao.camDeviceId } : true)}
          /* As mesmas opções da sala do time — ver `ActiveCallWidget`: o
             aparelho escolhido vale também para quando liga depois, e
             `webAudioMix` é o que deixa o volume por pessoa passar de 100%. */
          options={{
            audioCaptureDefaults: sessao.micDeviceId ? { deviceId: sessao.micDeviceId } : undefined,
            videoCaptureDefaults: sessao.camDeviceId ? { deviceId: sessao.camDeviceId } : undefined,
            webAudioMix: true,
          }}
          style={{ height: "100%", width: "100%" }}
          onDisconnected={sair}
        >
          <CallContents
            convidado
            mini={false}
            roomName={roomName}
            roomLabel={roomLabel}
            onEnd={sair}
            aoMudarMidia={aoMudarMidia}
          />
        </LiveKitRoom>
      </div>
    );
  }

  /* Uma tela de "saiu" em vez de voltar direto para a entrada: a entrada tem
     prévia, e a prévia liga a câmera. Sair da reunião e ver a luz da câmera
     acender de novo, sem ter pedido, é a última coisa que um visitante espera. */
  if (saiu) {
    return <Saiu roomLabel={roomLabel} onVoltar={() => setSaiu(false)} />;
  }

  return (
    <Entrada
      roomName={roomName}
      roomLabel={roomLabel}
      guestToken={guestToken}
      name={name}
      setName={setName}
      onEntrar={setSessao}
    />
  );
}

/**
 * Nome, prévia da câmera e do microfone, e entrar — o mesmo cartão que o time
 * vê antes de entrar numa sala, com o nome no lugar do título da reunião.
 */
function Entrada({
  roomName,
  roomLabel,
  guestToken,
  name,
  setName,
  onEntrar,
}: {
  roomName: string;
  roomLabel: string;
  guestToken: string;
  name: string;
  setName: (v: string) => void;
  onEntrar: (s: Sessao) => void;
}) {
  const previa = usePreviaDeDispositivos();
  const [joining, setJoining] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      const { prefs } = previa;
      // A prévia solta os aparelhos só depois que o convite foi aceito: se ele
      // for recusado, a pessoa continua vendo a própria imagem para tentar de novo.
      previa.soltar();
      onEntrar({
        token: res.token,
        url: res.url,
        micOn: prefs.micOn,
        camOn: prefs.camOn,
        micDeviceId: prefs.micDeviceId,
        camDeviceId: prefs.camDeviceId,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível entrar na sala");
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <CabecalhoDaPrevia
          rotulo="Você foi convidado"
          titulo={roomLabel}
          loading={previa.loading}
          err={previa.err}
        />
        <div className="grid gap-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <PainelDePrevia previa={previa} />
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <div>
              <label
                htmlFor="nome-do-convidado"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Seu nome <span className="text-destructive">*</span>
              </label>
              <input
                id="nome-do-convidado"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Ex.: Maria Silva – Cliente Acme"
                autoFocus
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                É como os outros vão te ver na reunião. Você não precisa criar conta.
              </p>
            </div>

            {err && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-[11px] text-muted-foreground">
                Câmera e microfone são usados só nesta conversa.
              </p>
              <button
                type="submit"
                disabled={joining || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
              >
                {joining ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Entrando…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Entrar na reunião
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function Saiu({ roomLabel, onVoltar }: { roomLabel: string; onVoltar: () => void }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <DoorOpen className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-3 text-base font-semibold">Você não está mais na reunião</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {roomLabel}. Sua câmera e seu microfone foram desligados. Se saiu sem querer, dá para
          voltar enquanto o convite valer.
        </p>
        <button
          type="button"
          onClick={onVoltar}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
        >
          <LogIn className="h-4 w-4" /> Entrar de novo
        </button>
      </div>
    </main>
  );
}
