import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { getLiveKitToken } from "@/lib/livekit-token.functions";

export interface ActiveCall {
  roomName: string;
  roomLabel: string;
  token: string;
  serverUrl: string;
  identity: string;
  name: string;
  meetingTitle: string;
  autoMinute: boolean;
  /**
   * O que a pessoa quer AGORA: câmera e microfone ligados ou não.
   *
   * Nasce do escolhido na prévia, mas não para aí — `setMediaState` mantém isto
   * em dia a cada clique nos botões da própria ligação. Precisa ser assim
   * porque o LiveKit usa este valor não só para conectar, mas para decidir o
   * que ligar de novo depois de toda reconexão de sinalização (queda breve de
   * rede, por exemplo): sem a atualização, quem entrasse calado e ligasse o
   * microfone na sala via ele apagar sozinho na primeira soluçada da rede,
   * porque o LiveKit reaplicava a escolha velha da prévia. Ver o uso em
   * `<LiveKitRoom audio=… video=…>`, em `active-call-widget.tsx`.
   */
  micOn: boolean;
  camOn: boolean;
  micDeviceId?: string;
  camDeviceId?: string;
}

interface ActiveCallContextValue {
  active: ActiveCall | null;
  minimized: boolean;
  loading: boolean;
  error: string | null;
  startCall(args: {
    roomName: string;
    roomLabel?: string;
    identity: string;
    name: string;
    // `userId` saiu: quem entra na sala é decidido pela sessão no servidor.
    meetingTitle?: string;
    autoMinute?: boolean;
    micOn?: boolean;
    camOn?: boolean;
    micDeviceId?: string;
    camDeviceId?: string;
  }): Promise<void>;
  endCall(): void;
  setMinimized(v: boolean): void;
  setMeetingTitle(t: string): void;
  /** O botão de mic/câmera da ligação chama isto a cada troca. Ver o
      comentário de `micOn`/`camOn` em `ActiveCall`. */
  setMediaState(patch: { micOn?: boolean; camOn?: boolean }): void;
}

const Ctx = createContext<ActiveCallContextValue | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCall = useCallback<ActiveCallContextValue["startCall"]>(
    async ({
      roomName,
      roomLabel,
      identity,
      name,
      meetingTitle,
      autoMinute,
      micOn,
      camOn,
      micDeviceId,
      camDeviceId,
    }) => {
      const prev = activeRef.current;
      if (prev && prev.roomName === roomName && prev.identity === identity) {
        setMinimized(false);
        if (meetingTitle && meetingTitle !== prev.meetingTitle) {
          const next = { ...prev, meetingTitle };
          activeRef.current = next;
          setActive(next);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        /* Havia aqui um `as { ...; userId?: string }`.
           A asserção mandava o TypeScript confiar numa forma escrita à mão em
           vez da forma real da server function — e foi por isso que ela
           continuou compilando depois que o `userId` saiu da entrada. Nenhum
           erro, e o cliente seguiria mandando o id no corpo da requisição.
           Sem a asserção, a assinatura de verdade volta a valer. */
        const res = await getLiveKitToken({ data: { roomName, identity, name } });
        const next: ActiveCall = {
          roomName,
          roomLabel: roomLabel ?? roomName,
          token: res.token,
          serverUrl: res.url,
          identity,
          name,
          meetingTitle: (meetingTitle && meetingTitle.trim()) || (roomLabel ?? roomName),
          autoMinute: autoMinute ?? true,
          micOn: micOn ?? true,
          camOn: camOn ?? true,
          micDeviceId,
          camDeviceId,
        };
        activeRef.current = next;
        setActive(next);
        setMinimized(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao entrar na sala");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const endCall = useCallback(() => {
    activeRef.current = null;
    setActive(null);
    setMinimized(false);
    setError(null);
  }, []);

  const setMeetingTitle = useCallback((t: string) => {
    const cur = activeRef.current;
    if (!cur) return;
    const title = t.trim() || cur.roomLabel;
    const next = { ...cur, meetingTitle: title };
    activeRef.current = next;
    setActive(next);
  }, []);

  const setMediaState = useCallback((patch: { micOn?: boolean; camOn?: boolean }) => {
    const cur = activeRef.current;
    if (!cur) return;
    // Nada mudou: não gera um render (e uma nova identidade de objeto) à toa
    // a cada evento do LiveKit que só confirma o que já estava certo.
    if (
      (patch.micOn === undefined || patch.micOn === cur.micOn) &&
      (patch.camOn === undefined || patch.camOn === cur.camOn)
    ) {
      return;
    }
    const next = { ...cur, ...patch };
    activeRef.current = next;
    setActive(next);
  }, []);

  return (
    <Ctx.Provider
      value={{
        active,
        minimized,
        loading,
        error,
        startCall,
        endCall,
        setMinimized,
        setMeetingTitle,
        setMediaState,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActiveCall() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useActiveCall must be used within ActiveCallProvider");
  return v;
}
