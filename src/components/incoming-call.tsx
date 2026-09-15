import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Phone, PhoneOff } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { DEPARTMENT_ROOMS } from "@/lib/rooms";
import { listIncomingRoomCalls, updateRoomCallStatus } from "@/lib/livekit-token.functions";
import {
  closeIncomingCallWindow,
  desktopBringToFront,
  desktopFlashTaskbar,
  onCallAction,
  showIncomingCallWindow,
} from "@/lib/desktop";

interface IncomingRoomCall {
  id: string;
  caller_user_id: string;
  target_user_id: string;
  room_name: string;
  room_label: string;
  status: string;
  created_at: string;
}

/** Uma ligação na tela: todos os convites tocando da mesma pessoa para a mesma sala. */
interface Ligacao {
  chave: string;
  fromUserId: string;
  roomName: string;
  roomLabel: string;
  callIds: string[];
}

const chaveDe = (c: IncomingRoomCall) => `${c.caller_user_id}|${c.room_name}`;

/**
 * O aviso de ligação recebida: um só, e ele fica até alguém responder.
 *
 * Aparecia várias vezes, empilhado, por três caminhos que se somavam:
 *
 * 1. Cada clique em "chamar" grava uma chamada nova, e as anteriores continuam
 *    tocando até expirar. Com um card por chamada, quem insistia abria um card
 *    novo por clique. Agora os convites da mesma pessoa para a mesma sala são
 *    UMA ligação: o card continua o mesmo, e atender ou recusar responde todos.
 *
 * 2. Este componente também tocava a partir dos AVISOS da sineta que tinham sala
 *    e remetente — resto de quando as chamadas moravam só no navegador. Só que
 *    todo convite grava um aviso "está te chamando", e toda chamada que expira
 *    grava um "chamada perdida", os dois com sala e remetente. Resultado: depois
 *    de recusar, o aviso do mesmo convite tocava de novo; e uma chamada perdida
 *    voltava a tocar como se fosse nova. A chamada que toca agora vem só de
 *    `gestor.chamadas`. Os avisos continuam na sineta, que é o lugar deles.
 *
 * 3. No app de desktop, o card nativo do canto e o card de dentro do app
 *    apareciam juntos, praticamente no mesmo lugar. Agora é um ou outro.
 */
export function IncomingCall() {
  const { users, currentUser, addMissedCallNotification } = useFluxo();
  const navigate = useNavigate();
  /** Ids de chamada já respondidos aqui — não voltam a tocar. */
  const respondidasRef = useRef<Set<string>>(new Set());
  /** Ligações tocando na sondagem anterior, para saber quais foram perdidas. */
  const anterioresRef = useRef<Map<string, Ligacao>>(new Map());
  const [chamadas, setChamadas] = useState<IncomingRoomCall[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<number | null>(null);
  /** Ligação cujo card nativo já foi aberto. */
  const avisadaRef = useRef<string | null>(null);
  /** O card nativo abriu? Se sim, o card de dentro do app não aparece. */
  const [nativoAberto, setNativoAberto] = useState(false);
  /** A ligação na tela fica na tela enquanto tocar — um convite novo de outra
      pessoa espera, em vez de trocar o card no meio da leitura. */
  const atualRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (ringIntervalRef.current) window.clearInterval(ringIntervalRef.current);
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const ligacoes = useMemo(() => {
    const porChave = new Map<string, Ligacao>();
    for (const c of chamadas) {
      if (respondidasRef.current.has(c.id)) continue;
      const chave = chaveDe(c);
      const l = porChave.get(chave);
      if (l) l.callIds.push(c.id);
      else
        porChave.set(chave, {
          chave,
          fromUserId: c.caller_user_id,
          roomName: c.room_name,
          roomLabel: c.room_label,
          callIds: [c.id],
        });
    }
    return porChave;
  }, [chamadas]);

  // Calls must work between different browsers/devices, so poll the backend instead of only local state.
  useEffect(() => {
    let cancelled = false;
    async function pollIncomingCalls() {
      try {
        const res = await listIncomingRoomCalls();
        if (cancelled) return;
        setChamadas(res.calls);
      } catch {
        /* Falha de rede mantém o que já estava. Zerar aqui fechava o card no
           meio da chamada, e a sondagem seguinte não reabria: para esta tela a
           ligação "já tinha sido avisada". */
      }
    }
    pollIncomingCalls();
    const id = window.setInterval(pollIncomingCalls, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentUser.id]);

  /* Perdida é a LIGAÇÃO que some sem resposta — não cada convite dela. Quem
     chamou três vezes deixa um aviso de chamada perdida, não três. */
  useEffect(() => {
    anterioresRef.current.forEach((l, chave) => {
      if (ligacoes.has(chave)) return;
      const respondida = l.callIds.some((id) => respondidasRef.current.has(id));
      if (!respondida) addMissedCallNotification(l.fromUserId, l.roomName, l.roomLabel);
    });
    anterioresRef.current = new Map(
      [...ligacoes].map(([chave, l]) => [chave, { ...l, callIds: [...l.callIds] }]),
    );
  }, [ligacoes, addMissedCallNotification]);

  const active = useMemo(() => {
    const atual = atualRef.current ? ligacoes.get(atualRef.current) : undefined;
    // A API devolve da mais nova para a mais antiga; sem ligação na tela, vale a mais nova.
    return atual ?? ligacoes.values().next().value ?? null;
  }, [ligacoes]);

  useEffect(() => {
    atualRef.current = active?.chave ?? null;
  }, [active]);

  // Card nativo no canto da tela (estilo Teams): abre UMA vez por ligação.
  useEffect(() => {
    if (!active) {
      avisadaRef.current = null;
      setNativoAberto(false);
      void closeIncomingCallWindow();
      return;
    }
    if (avisadaRef.current === active.chave) return;
    avisadaRef.current = active.chave;
    const caller = users.find((u) => u.id === active.fromUserId);
    const room = DEPARTMENT_ROOMS.find((r) => r.name === active.roomName);
    void showIncomingCallWindow({
      callIds: active.callIds,
      caller: caller?.name ?? "Alguém",
      roomLabel: room?.label ?? active.roomLabel ?? active.roomName,
      userId: currentUser.id,
    }).then((abriu) => {
      if (avisadaRef.current === active.chave) setNativoAberto(abriu);
    });
    void desktopFlashTaskbar();
  }, [active, users, currentUser.id]);

  // Play ringtone while active
  const tocando = !!active;
  useEffect(() => {
    if (!tocando) {
      if (ringIntervalRef.current) {
        window.clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      return;
    }
    const play = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx =
            (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
              .AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        const t0 = ctx.currentTime;
        [0, 0.4].forEach((offset) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0, t0 + offset);
          gain.gain.linearRampToValueAtTime(0.15, t0 + offset + 0.02);
          gain.gain.linearRampToValueAtTime(0, t0 + offset + 0.28);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0 + offset);
          osc.stop(t0 + offset + 0.3);
        });
      } catch {
        /* ignore audio errors (autoplay policies etc.) */
      }
    };
    play();
    // Um toque só, e não um por troca de dados: `tocando` não muda a cada sondagem.
    ringIntervalRef.current = window.setInterval(play, 1500);
    return () => {
      if (ringIntervalRef.current) window.clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    };
  }, [tocando]);

  // Resolve a ligação — usado tanto pelos botões do app quanto pelo card nativo.
  const resolveCall = useCallback(
    async (action: "accept" | "decline") => {
      if (!active) return;
      for (const id of active.callIds) respondidasRef.current.add(id);
      setChamadas((cs) => cs.filter((c) => !active.callIds.includes(c.id)));
      void closeIncomingCallWindow();
      await Promise.all(
        active.callIds.map((callId) =>
          updateRoomCallStatus({
            data: { callId, status: action === "accept" ? "accepted" : "declined" },
          }).catch(() => {}),
        ),
      );
      if (action === "accept") {
        void desktopBringToFront();
        if (active.roomName) {
          navigate({ to: "/salas/$roomName", params: { roomName: active.roomName } });
        }
      }
    },
    [active, navigate],
  );

  // Escuta o que o usuário escolheu no card nativo do canto da tela.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onCallAction(({ action }) => {
      void resolveCall(action);
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [resolveCall]);

  if (!active || nativoAberto) return null;

  const caller = users.find((u) => u.id === active.fromUserId);
  const room = DEPARTMENT_ROOMS.find((r) => r.name === active.roomName);

  const accept = () => resolveCall("accept");
  const decline = () => resolveCall("decline");

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-3 border-b border-border bg-primary/5 px-4 py-3">
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {caller?.avatar ?? "?"}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-card">
            <Phone className="h-2.5 w-2.5 text-white" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{caller?.name ?? "Alguém"} está chamando</div>
          <div className="truncate text-xs text-muted-foreground">
            Sala {room?.label ?? active.roomLabel ?? active.roomName}
          </div>
        </div>
        <span className="flex h-2 w-2 animate-ping rounded-full bg-emerald-500" />
      </div>
      <div className="flex gap-2 p-3">
        <button
          onClick={decline}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm font-medium hover:bg-secondary"
        >
          <PhoneOff className="h-4 w-4" /> Recusar
        </button>
        <button
          onClick={accept}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
        >
          <Phone className="h-4 w-4" /> Atender
        </button>
      </div>
    </div>
  );
}
