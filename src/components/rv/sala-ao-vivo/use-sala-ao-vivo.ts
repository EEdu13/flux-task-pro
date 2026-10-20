/*
 * use-sala-ao-vivo.ts — a sala de Realidade Virtual conectada: LiveKit + cards + gestos.
 *
 * É a cola das três frentes. Cada uma já sabe o seu pedaço (a sala desenha, a voz faz cards, os
 * gestos acham a mão); aqui fica só o que precisa de TODAS ao mesmo tempo:
 *   - a Room do LiveKit (áudio, telão, canal de dados) e os eventos dela;
 *   - o estado por participante que chega pela rede ("rv-avatar", "rv-card", "rv-gesto"),
 *     aplicado pelos redutores puros (redutores.ts) — o eco local entra pelo MESMO caminho;
 *   - quem conduz, a fila de mãos e os avisos ("Eduardo levantou a mão ✋").
 *
 * Nada de banco: tudo vive na chamada. Nome e identidade de quem mandou vêm SEMPRE do
 * participante do LiveKit, nunca do pacote.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import { toast } from "sonner";
import { AVATAR_PADRAO, lerAvatar, type AvatarConfig } from "@/lib/avatar-3d";
import { primeiroNome } from "@/integrations/iam/types";
import {
  MAX_BYTES_DO_PACOTE,
  TOPICO_CARD,
  TOPICO_GESTO,
  VISUAL_DO_GESTO,
  gestoDoAvatar,
  type CardDaSala,
  type CardNaSala,
  type MensagemCard,
  type MensagemGesto,
  type NaMesa,
} from "../sala/tipos";
import { useCardsDeFala, type CardsDeFala } from "../voz/use-cards-de-fala";
import { lerMensagemCard, publicarCard } from "../voz/protocolo";
import { lerPreferenciaCardsIa, salvarPreferenciaCardsIa } from "../voz/preferencia-cards-ia";
import { useGestos, type Gestos } from "../gestos/use-gestos";
import { useGestoNaSala, type GestoNaSala } from "../gestos/use-gesto-na-sala";
import { lerMensagemGesto } from "../gestos/protocolo";
import { tocarPlim } from "../gestos/som";
import {
  CARDS_VAZIOS,
  LOG_DE_FALANTES_MS,
  cardsSemPessoa,
  comAviso,
  filaDeMaos,
  gestosSemPessoa,
  ouvidosRecentes,
  podarCards,
  quemConduz,
  reduzirCard,
  reduzirGesto,
  type AvisoDaSala,
  type CardsDaSala,
  type FalantesNoTempo,
  type GestosDaSala,
} from "./redutores";

/** O canal de dados por onde cada um manda o próprio avatar (o mesmo de antes). */
export const TOPICO_AVATAR = "rv-avatar";

/** "Levantou a mão" de quem acabou de chegar só vira aviso se a mão subiu há pouco. */
const MAO_RECENTE_MS = 5_000;
const AVISOS_VIVOS_MS = 5_000;

type Transcrever = (a: {
  audio: string;
  mime: string;
  nomes: string[];
  falaMs: number;
}) => Promise<{ texto: string }>;
type Interpretar = (a: {
  frase: string;
  quem: string;
  participantes: string[];
  anterior?: string;
}) => Promise<{ card: CardDaSala }>;

export type FaseDaSala = "fora" | "conectando" | "na-sala";

export interface TelaoAoVivo {
  video: HTMLVideoElement;
  quem: string;
  meu: boolean;
}

export interface SalaAoVivo {
  /** Chamar NO CLIQUE de "Entrar": cria o AudioContext do integrador (plim, anel do mic). */
  prepararAudio: () => void;
  entrar: (url: string, token: string) => Promise<void>;
  sair: () => void;
  room: Room | null;
  fase: FaseDaSala;
  meuId: string;
  pessoas: NaMesa[];
  mural: CardNaSala[];
  telao: TelaoAoVivo | null;
  filaDeMaos: { id: string; nome: string; desde: number; eu: boolean }[];
  avisos: AvisoDaSala[];
  conduzo: boolean;
  conduzId: string | null;
  micLigado: boolean;
  semMicrofone: boolean;
  alternarMic: () => Promise<void>;
  alternarTela: () => Promise<void>;
  cards: { ligado: boolean; alternar: (ligar?: boolean) => void } & CardsDeFala;
  gestos: { ligado: boolean; alternar: (ligar?: boolean) => void } & Gestos & GestoNaSala;
  apagarCard: (id: string) => void;
  /** AudioContext criado no clique de "Entrar" (null antes). */
  contextoDeAudio: AudioContext | null;
  /** Muda a cada evento de trilha — para quem lê a trilha do mic (anel de nível). */
  versaoDasTrilhas: number;
  /** Diagnóstico (testes): quantos "plim" tocaram. */
  contadores: { plim: number };
}

function publicarAvatar(room: Room, a: AvatarConfig, destino?: string[]) {
  void room.localParticipant
    .publishData(new TextEncoder().encode(JSON.stringify({ config: a })), {
      reliable: true,
      topic: TOPICO_AVATAR,
      ...(destino?.length ? { destinationIdentities: destino } : {}),
    })
    .catch((e) => console.warn("[rv] não consegui enviar o avatar:", e));
}

const nomeDoParticipante = (p: Participant) => primeiroNome(p.name || p.identity);

export function useSalaAoVivo(o: {
  meuId: string;
  meuNome: string;
  meuAvatar: AvatarConfig;
  /**
   * A pessoa saiu da TELA da sala sem sair da reunião (ex.: abriu o editor de avatar). Pausa os
   * cards e a câmera dos gestos — sem o selo "IA ouvindo você" e sem a prévia à vista, ela
   * falaria achando que só edita o avatar e isso viraria card para todos. As preferências
   * (ligado/desligado) ficam guardadas: ao voltar, tudo religa sozinho.
   */
  pausado?: boolean;
  transcrever?: Transcrever;
  interpretar?: Interpretar;
}): SalaAoVivo {
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [fase, setFase] = useState<FaseDaSala>("fora");
  const [versao, setVersao] = useState(0);
  const tocar = useCallback(() => setVersao((v) => v + 1), []);

  const [avatares, setAvatares] = useState<Record<string, AvatarConfig>>({});
  const [falando, setFalando] = useState<Set<string>>(() => new Set());
  const falantesLog = useRef<FalantesNoTempo[]>([]);
  const [cardsSala, setCardsSala] = useState<CardsDaSala>(CARDS_VAZIOS);
  const [gestosSala, setGestosSala] = useState<GestosDaSala>({});
  const [avisos, setAvisos] = useState<AvisoDaSala[]>([]);
  const [telao, setTelao] = useState<TelaoAoVivo | null>(null);
  const [cardsLigado, setCardsLigado] = useState(false);
  const [gestosLigado, setGestosLigado] = useState(false);

  const audioCtx = useRef<AudioContext | null>(null);
  const audiosDiv = useRef<HTMLDivElement | null>(null);
  const contadores = useRef({ plim: 0 });

  const eu = room?.localParticipant.identity || o.meuId;
  const euRef = useRef(eu);
  euRef.current = eu;
  const meuNomeRef = useRef(o.meuNome);
  meuNomeRef.current = o.meuNome;
  const avatarRef = useRef(o.meuAvatar);
  avatarRef.current = o.meuAvatar;
  const cardsSalaRef = useRef(cardsSala);
  cardsSalaRef.current = cardsSala;

  /** Primeiro nome de quem está (ou esteve) na sala, a partir da identity. */
  const nomeDe = useCallback((id: string): string => {
    const r = roomRef.current;
    if (id === euRef.current) return meuNomeRef.current;
    const p = r?.remoteParticipants.get(id);
    return p ? nomeDoParticipante(p) : "Alguém";
  }, []);

  const avisar = useCallback((chave: string, texto: string, emoji = "") => {
    setAvisos((l) => comAviso(l, { chave, texto, emoji, desde: Date.now() }));
  }, []);

  /* ───────── Quem conduz (menor joinedAt; todos calculam igual) ───────── */
  const conduzId = useMemo(() => {
    if (!room) return null;
    const todos = [room.localParticipant, ...room.remoteParticipants.values()];
    return quemConduz(
      todos.map((p) => ({ id: p.identity, entrouEm: p.joinedAt?.getTime() ?? null })),
    );
    // versao: alguém entrou/saiu (o Room é mutável por baixo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, versao]);
  const conduzRef = useRef(conduzId);
  conduzRef.current = conduzId;

  const euFalando = !!room && falando.has(eu);

  /* ───────── Redutores: rede e eco local pelo mesmo caminho ───────── */
  const aplicarCard = useCallback(
    (m: MensagemCard, remetente: string) => {
      setCardsSala((e) =>
        reduzirCard(
          e,
          m,
          { id: remetente, nome: nomeDe(remetente) },
          Date.now(),
          falantesLog.current,
        ),
      );
    },
    [nomeDe],
  );

  /** "Dar a vez" vindo de quem conduz vira aviso para todos (e um diferente para o alvo). */
  const avisoDeVez = useCallback(
    (m: Extract<MensagemGesto, { k: "abaixar" }>, remetente: string) => {
      if (m.motivo !== "vez" || remetente !== conduzRef.current) return;
      if (m.alvo === euRef.current) avisar(`vez:${m.alvo}`, "Sua vez de falar 🎤", "🎤");
      else avisar(`vez:${m.alvo}`, `${nomeDe(m.alvo)}, sua vez 🎤`, "🎤");
    },
    [avisar, nomeDe],
  );

  const aplicarGestoLocal = useCallback(
    (m: MensagemGesto) => {
      if (m.k === "estado") setGestosSala((g) => reduzirGesto(g, m, euRef.current));
      else avisoDeVez(m, euRef.current);
    },
    [avisoDeVez],
  );
  const aplicarCardLocal = useCallback(
    (m: MensagemCard) => aplicarCard(m, euRef.current),
    [aplicarCard],
  );

  /* ───────── Gestos (câmera local → trava → rede) ───────── */
  const gestosAtivos = gestosLigado && fase === "na-sala" && !o.pausado;
  const gestos = useGestos({ ligado: gestosAtivos, falando: euFalando });
  const cameraFuncionando =
    gestosAtivos &&
    !["desligado", "negado", "ocupada", "sem-camera", "erro"].includes(gestos.estado);
  const gestoNaSala = useGestoNaSala({
    room,
    maoAoVivo: gestos.maoAoVivo,
    momentaneo: gestos.momentaneo,
    cameraLigada: cameraFuncionando,
    euFalando,
    conduzId,
    aoMensagemLocal: aplicarGestoLocal,
    aoAvisoLocal: useCallback((texto: string) => avisar("fala", texto, ""), [avisar]),
  });

  /* ───────── Cards por IA (minha fala → card) ───────── */
  const presentes = useMemo(() => {
    if (!room) return [] as { id: string; nome: string }[];
    return [
      { id: room.localParticipant.identity, nome: o.meuNome },
      ...[...room.remoteParticipants.values()].map((p) => ({
        id: p.identity,
        nome: nomeDoParticipante(p),
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, versao, o.meuNome]);
  const nomesPresentes = useMemo(() => presentes.map((p) => p.nome), [presentes]);

  const cards = useCardsDeFala({
    room,
    ligado: cardsLigado && fase === "na-sala" && !o.pausado,
    meuId: eu,
    meuNome: o.meuNome,
    participantes: nomesPresentes,
    aoMensagemLocal: aplicarCardLocal,
    ouvidosRecentes: useCallback(
      () => ouvidosRecentes(cardsSalaRef.current.mural, euRef.current, Date.now()),
      [],
    ),
    transcrever: o.transcrever,
    interpretar: o.interpretar,
  });

  // Os handlers da Room são registrados uma vez: leem a versão mais nova por aqui.
  const vivos = useRef({ gestoNaSala, cardsLigado, avisoDeVez, aplicarCard });
  vivos.current = { gestoNaSala, cardsLigado, avisoDeVez, aplicarCard };

  /* ───────── Avisos de mão levantada + plim ───────── */
  const gestosAntes = useRef<GestosDaSala>({});
  useEffect(() => {
    const antes = gestosAntes.current;
    gestosAntes.current = gestosSala;
    const agora = Date.now();
    for (const [id, g] of Object.entries(gestosSala)) {
      if (!g.mao) continue;
      const a = antes[id];
      // Quem chega encontra mãos já erguidas: isso não é "levantou agora".
      const subiu = a ? !a.mao : agora - (g.maoDesde ?? 0) < MAO_RECENTE_MS;
      if (!subiu) continue;
      const visual = VISUAL_DO_GESTO[gestoDoAvatar(g.mao, null)!];
      const souEu = id === euRef.current;
      avisar(
        `mao:${id}`,
        `${souEu ? "Você" : nomeDe(id)} ${visual.frase} ${visual.emoji}`,
        visual.emoji,
      );
      if (!souEu) {
        contadores.current.plim++;
        if (audioCtx.current) tocarPlim(audioCtx.current);
      }
    }
  }, [gestosSala, avisar, nomeDe]);

  /* ───────── Relógio de 1 s: poda balões vencidos e avisos velhos ───────── */
  useEffect(() => {
    if (fase !== "na-sala") return;
    const id = window.setInterval(() => {
      const agora = Date.now();
      setCardsSala((e) => podarCards(e, agora));
      setAvisos((l) => {
        const f = l.filter((a) => agora - a.desde < AVISOS_VIVOS_MS);
        return f.length === l.length ? l : f;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [fase]);

  /* ───────── Troca de avatar já na sala: os outros veem na hora ───────── */
  useEffect(() => {
    if (room && fase === "na-sala") publicarAvatar(room, o.meuAvatar);
  }, [room, fase, o.meuAvatar]);

  /* ───────── Entrar / sair ───────── */
  const prepararAudio = useCallback(() => {
    try {
      if (!audioCtx.current || audioCtx.current.state === "closed")
        audioCtx.current = new AudioContext();
      void audioCtx.current.resume().catch(() => {});
    } catch (e) {
      // Sem Web Audio só perde o plim e o anel do microfone; a sala funciona.
      console.warn("[rv] sem AudioContext:", e);
    }
  }, []);

  const limparTudo = useCallback(() => {
    roomRef.current = null;
    setRoom(null);
    setTelao(null);
    setAvatares({});
    setFalando(new Set());
    falantesLog.current = [];
    setCardsSala(CARDS_VAZIOS);
    setGestosSala({});
    gestosAntes.current = {};
    setAvisos([]);
    setCardsLigado(false);
    setGestosLigado(false);
    audiosDiv.current?.remove();
    audiosDiv.current = null;
    setFase("fora");
  }, []);

  const entrar = useCallback(
    async (url: string, token: string) => {
      if (roomRef.current) return;
      setFase("conectando");
      const r = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = r;
      const div = document.createElement("div");
      div.hidden = true;
      div.dataset.rvAudios = "";
      document.body.appendChild(div);
      audiosDiv.current = div;

      r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        // Quem chegou não sabe de nada: avatar, chip IA e estado da mão, só para ele.
        publicarAvatar(r, avatarRef.current, [p.identity]);
        if (vivos.current.cardsLigado)
          void publicarCard(r, { v: 1, k: "ouvindo", ligado: true }, [p.identity]).catch(() => {});
        vivos.current.gestoNaSala.reenviarEstado(p.identity);
        avisar(`entrou:${p.identity}`, `${nomeDoParticipante(p)} entrou`);
        tocar();
      })
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          setAvatares((m) => {
            const { [p.identity]: _saiu, ...resto } = m;
            return resto;
          });
          setGestosSala((g) => gestosSemPessoa(g, p.identity));
          setCardsSala((e) => cardsSemPessoa(e, p.identity));
          avisar(`saiu:${p.identity}`, `${nomeDoParticipante(p)} saiu`);
          tocar();
        })
        .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (!participant || payload.byteLength > MAX_BYTES_DO_PACOTE) return;
          const de = participant.identity;
          try {
            switch (topic) {
              case TOPICO_AVATAR: {
                const msg = JSON.parse(new TextDecoder().decode(payload)) as { config?: unknown };
                const a = lerAvatar(msg.config);
                if (a) setAvatares((m) => ({ ...m, [de]: a }));
                break;
              }
              case TOPICO_CARD: {
                const m = lerMensagemCard(payload);
                if (m) vivos.current.aplicarCard(m, de);
                break;
              }
              case TOPICO_GESTO: {
                const m = lerMensagemGesto(payload);
                if (!m) break;
                if (m.k === "estado") setGestosSala((g) => reduzirGesto(g, m, de));
                else {
                  vivos.current.gestoNaSala.receberAbaixar(m, de);
                  vivos.current.avisoDeVez(m, de);
                }
                break;
              }
              default:
                break;
            }
          } catch (e) {
            console.warn(`[rv] mensagem torta em "${topic}" de ${de}:`, e);
          }
        })
        .on(RoomEvent.ActiveSpeakersChanged, (quem: Participant[]) => {
          const ids = quem.map((p) => p.identity);
          const agora = Date.now();
          const log = falantesLog.current;
          log.push({ t: agora, ids });
          while (log.length > 1 && agora - log[1]!.t > LOG_DE_FALANTES_MS) log.shift();
          setFalando(new Set(ids));
        })
        .on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
              audiosDiv.current?.appendChild(track.attach());
            } else if (track.source === Track.Source.ScreenShare) {
              const el = track.attach() as HTMLVideoElement;
              el.muted = true;
              el.playsInline = true;
              void el.play().catch(() => {});
              setTelao({ video: el, quem: nomeDoParticipante(participant), meu: false });
            }
            tocar();
          },
        )
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach().forEach((el) => el.remove());
          if (track.source === Track.Source.ScreenShare) setTelao((t) => (t && !t.meu ? null : t));
          tocar();
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            const el = pub.track.attach() as HTMLVideoElement;
            el.muted = true;
            void el.play().catch(() => {});
            setTelao({ video: el, quem: "Você", meu: true });
          }
          tocar();
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) setTelao((t) => (t?.meu ? null : t));
          tocar();
        })
        // Mudo / sem microfone de qualquer um: a sala lê isMicrophoneEnabled no render.
        .on(RoomEvent.TrackMuted, tocar)
        .on(RoomEvent.TrackUnmuted, tocar)
        .on(RoomEvent.TrackPublished, tocar)
        .on(RoomEvent.TrackUnpublished, tocar)
        .on(RoomEvent.Disconnected, limparTudo);

      try {
        await r.connect(url, token);
      } catch (e) {
        r.removeAllListeners();
        limparTudo();
        throw e;
      }
      // A Room vai para o estado JÁ, antes do await do microfone: quem entrar nesse meio-tempo
      // dispara o ParticipantConnected, e o reenviarEstado dele precisa do emissor de gestos,
      // que só nasce quando o room existe. (O avatar sai pelo efeito [room, fase, meuAvatar]
      // quando a fase vira "na-sala" — mandar aqui também o publicava duas vezes.)
      setRoom(r);
      await r.localParticipant.setMicrophoneEnabled(true).catch(() => {
        toast.error("Sem microfone — você entra só ouvindo");
      });
      if (roomRef.current !== r) return; // saiu (ou caiu) enquanto ligava o microfone
      setFase("na-sala");
      // Quem já aceitou e deixou ligado volta com os cards ligados.
      if (lerPreferenciaCardsIa()) setCardsLigado(true);
      tocar();
    },
    [avisar, limparTudo, tocar],
  );

  const sair = useCallback(() => {
    void roomRef.current?.disconnect();
  }, []);

  // Sair da página sai da sala e solta o áudio.
  useEffect(
    () => () => {
      void roomRef.current?.disconnect();
      audiosDiv.current?.remove();
      void audioCtx.current?.close().catch(() => {});
    },
    [],
  );

  /* ───────── Ações ───────── */
  const alternarMic = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const ligar = !r.localParticipant.isMicrophoneEnabled;
    try {
      await r.localParticipant.setMicrophoneEnabled(ligar);
    } catch (e) {
      toast.error(ligar ? "Não consegui ligar o microfone" : "Não consegui fechar o microfone", {
        description: (e as Error)?.message,
      });
    }
    tocar();
  }, [tocar]);

  const alternarTela = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    try {
      await r.localParticipant.setScreenShareEnabled(!r.localParticipant.isScreenShareEnabled);
    } catch (e) {
      // Cancelar a escolha da tela também cai aqui: só registra.
      console.warn("[rv] compartilhamento de tela:", e);
    }
  }, []);

  const alternarCards = useCallback((ligar?: boolean) => {
    setCardsLigado((a) => {
      const novo = ligar ?? !a;
      salvarPreferenciaCardsIa(novo);
      return novo;
    });
  }, []);
  const alternarGestos = useCallback((ligar?: boolean) => {
    setGestosLigado((a) => ligar ?? !a);
  }, []);

  const apagarCard = useCallback((id: string) => cards.apagar(id), [cards]);

  /* ───────── Quem está na mesa ───────── */
  const fila = useMemo(() => filaDeMaos(gestosSala, presentes, eu), [gestosSala, presentes, eu]);

  const pessoas: NaMesa[] = useMemo(() => {
    if (!room) return [];
    const posicao = new Map(fila.map((f, i) => [f.id, i + 1]));
    const montar = (p: Participant, souEu: boolean): NaMesa => {
      const id = p.identity;
      const g = gestosSala[id];
      const c = cardsSala.porPessoa[id];
      return {
        id,
        nome: souEu ? o.meuNome : nomeDoParticipante(p),
        config: souEu ? o.meuAvatar : (avatares[id] ?? AVATAR_PADRAO),
        falando: falando.has(id),
        eu: souEu,
        mudo: !p.isMicrophoneEnabled,
        semMicrofone: !p.getTrackPublication(Track.Source.Microphone),
        mao: g?.mao ?? null,
        maoDesde: g?.maoDesde ?? null,
        posicaoNaFila: posicao.get(id) ?? null,
        momentaneo: g?.momentaneo ?? null,
        cards: c?.cards ?? [],
        iaOuvindo: c?.iaOuvindo ?? false,
        cameraGestos: g?.camera ?? false,
        conduz: id === conduzId,
        cabeca: null,
      };
    };
    return [
      montar(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => montar(p, false)),
    ];
    // versao: mudo/trilhas mudam dentro do Room (mutável).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    room,
    versao,
    fila,
    gestosSala,
    cardsSala,
    avatares,
    falando,
    conduzId,
    o.meuNome,
    o.meuAvatar,
  ]);

  const minha = room?.localParticipant;
  return {
    prepararAudio,
    entrar,
    sair,
    room,
    fase,
    meuId: eu,
    pessoas,
    mural: cardsSala.mural,
    telao,
    filaDeMaos: fila,
    avisos,
    conduzo: !!room && conduzId === eu,
    conduzId,
    micLigado: !!minha?.isMicrophoneEnabled,
    semMicrofone: !!minha && !minha.getTrackPublication(Track.Source.Microphone),
    alternarMic,
    alternarTela,
    cards: { ligado: cardsLigado, alternar: alternarCards, ...cards },
    gestos: { ligado: gestosLigado, alternar: alternarGestos, ...gestos, ...gestoNaSala },
    apagarCard,
    contextoDeAudio: audioCtx.current,
    versaoDasTrilhas: versao,
    contadores: contadores.current,
  };
}
