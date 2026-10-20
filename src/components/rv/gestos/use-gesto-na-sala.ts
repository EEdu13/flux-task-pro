/*
 * use-gesto-na-sala.ts — a MINHA mão na fila e o protocolo "rv-gesto" (envio).
 *
 * Junta três fontes: a câmera (maoAoVivo/momentaneo do useGestos), o botão/tecla L e a rede
 * ("abaixar" de quem conduz). As regras de tempo moram em logica-da-mao.ts (testadas no Node);
 * aqui fica só a cola com React e LiveKit.
 *
 * Envio: sessão aleatória por montagem/conexão + seq crescente; manda quando muda mão, desde,
 * momentâneo ou câmera, no máximo 2 msg/s, coalescendo (vai sempre o estado MAIS NOVO).
 * Quem chega depois recebe o estado pelo reenviarEstado (o integrador chama no
 * ParticipantConnected com a identity de quem chegou).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import type { GestoMomentaneo, LadoDaMao, MensagemGesto } from "../sala/tipos";
import {
  EmissorDeEstado,
  Limitador,
  TravaDaMao,
  mesmoEstado,
  type EstadoParaEnviar,
  type MinhaMao,
  type OrigemDaMao,
} from "./logica-da-mao";
import { publicarGesto } from "./protocolo";

/** De quanto em quanto tempo a regra "falar 4 s abaixa" é conferida. */
const PASSO_DA_FALA_MS = 200;

export interface GestoNaSala {
  minhaMao: LadoDaMao | null;
  minhaMaoDesde: number | null;
  origemMao: OrigemDaMao | null;
  meuMomentaneo: GestoMomentaneo | null;
  /** Botão / tecla L. */
  alternarMao: () => void;
  /** Só quem conduz: manda "abaixar" para o alvo (motivo "vez" = dar a vez de falar). */
  abaixarDeOutro: (alvo: string, motivo: "abaixar" | "vez") => void;
  /** O integrador repassa aqui o "abaixar" que chegou (remetente = participant.identity). */
  receberAbaixar: (m: Extract<MensagemGesto, { k: "abaixar" }>, remetente: string) => void;
  /** Reenvia o estado atual (para todos, ou só para `destino`). */
  reenviarEstado: (destino?: string) => void;
}

function novaSessao(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useGestoNaSala(o: {
  room: Room | null;
  maoAoVivo: LadoDaMao | null;
  momentaneo: GestoMomentaneo | null;
  cameraLigada: boolean;
  /** LiveKit isSpeaking local (o integrador acompanha). */
  euFalando: boolean;
  /** Quem conduz (o integrador calcula: menor joinedAt, empate pela identity). */
  conduzId: string | null;
  aoMensagemLocal: (m: MensagemGesto) => void;
  /** Ex.: "Sua mão foi abaixada porque você começou a falar". */
  aoAvisoLocal: (texto: string) => void;
}): GestoNaSala {
  const { room, maoAoVivo, momentaneo, cameraLigada, euFalando, conduzId } = o;
  const travaRef = useRef(new TravaDaMao());
  const [minha, setMinha] = useState<MinhaMao>(travaRef.current.estado);

  // Callbacks e valores lidos dentro de timers/handlers sem refazer efeitos a cada render.
  const aoMensagemLocalRef = useRef(o.aoMensagemLocal);
  const aoAvisoLocalRef = useRef(o.aoAvisoLocal);
  const maoAoVivoRef = useRef(maoAoVivo);
  const conduzRef = useRef(conduzId);
  const falandoRef = useRef(euFalando);
  useEffect(() => {
    aoMensagemLocalRef.current = o.aoMensagemLocal;
    aoAvisoLocalRef.current = o.aoAvisoLocal;
  }, [o.aoMensagemLocal, o.aoAvisoLocal]);
  useEffect(() => {
    conduzRef.current = conduzId;
  }, [conduzId]);

  /** Copia o estado da trava para o React (só quando mudou). */
  const sincronizar = useCallback(() => {
    const e = travaRef.current.estado;
    setMinha((a) =>
      a.mao === e.mao && a.desde === e.desde && a.origem === e.origem ? a : { ...e },
    );
  }, []);

  /* —————— câmera → trava —————— */
  useEffect(() => {
    maoAoVivoRef.current = maoAoVivo;
    if (travaRef.current.aoVivo(maoAoVivo, Date.now())) sincronizar();
  }, [maoAoVivo, sincronizar]);

  /* —————— falar 4 s seguidos abaixa a própria mão —————— */
  useEffect(() => {
    falandoRef.current = euFalando;
    const passo = () => {
      const caiu = travaRef.current.passoDaFala(
        falandoRef.current,
        Date.now(),
        maoAoVivoRef.current !== null,
      );
      if (caiu) {
        sincronizar();
        aoAvisoLocalRef.current("Sua mão foi abaixada porque você começou a falar");
      }
    };
    passo();
    const id = setInterval(passo, PASSO_DA_FALA_MS);
    return () => clearInterval(id);
  }, [euFalando, sincronizar]);

  /* —————— envio do estado —————— */
  const meuId = room?.localParticipant.identity ?? "";
  const emissorRef = useRef<EmissorDeEstado | null>(null);
  const limitadorRef = useRef(new Limitador(500));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoEnviadoRef = useRef<EstadoParaEnviar | null>(null);
  /** O último estado entregue à MINHA tela (eco local) — separado do último que foi à rede. */
  const ultimoEcoRef = useRef<EstadoParaEnviar | null>(null);
  const atualRef = useRef<EstadoParaEnviar>({
    mao: null,
    maoDesde: null,
    origemMao: null,
    momentaneo: null,
    camera: false,
  });
  atualRef.current = {
    mao: minha.mao,
    maoDesde: minha.desde,
    origemMao: minha.origem,
    momentaneo,
    camera: cameraLigada,
  };

  const enviarAgora = useCallback(
    (destino?: string) => {
      const emissor = emissorRef.current;
      if (!room || !emissor) return;
      const m = emissor.montar(atualRef.current, Date.now());
      if (!destino) {
        limitadorRef.current.enviou(Date.now());
        ultimoEnviadoRef.current = { ...atualRef.current };
      }
      void publicarGesto(room, m, destino ? [destino] : undefined);
    },
    [room],
  );

  // Sessão nova a cada sala/conexão: o receptor vê a sessão diferente e zera o seq.
  useEffect(() => {
    emissorRef.current = room ? new EmissorDeEstado(novaSessao()) : null;
    limitadorRef.current.zerar();
    ultimoEnviadoRef.current = null;
    ultimoEcoRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [room]);

  // Mudou algo que vai à rede? Pede envio ao limitador (já, ou agendado com o estado mais novo).
  useEffect(() => {
    if (!room || !emissorRef.current) return;
    // Eco local: publishData não devolve ao remetente, e a minha tela precisa ver a mudança já
    // (mesmo as intermediárias que o limitador vai coalescer na rede). Cada eco gasta um seq.
    if (!mesmoEstado(ultimoEcoRef.current, atualRef.current)) {
      ultimoEcoRef.current = { ...atualRef.current };
      aoMensagemLocalRef.current(emissorRef.current.montar(atualRef.current, Date.now()));
    }
    if (mesmoEstado(ultimoEnviadoRef.current, atualRef.current)) return;
    const atraso = limitadorRef.current.pedir(Date.now());
    if (atraso === 0) enviarAgora();
    else if (atraso !== null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (mesmoEstado(ultimoEnviadoRef.current, atualRef.current)) {
          limitadorRef.current.enviou(Date.now());
          return;
        }
        enviarAgora();
      }, atraso);
    }
  }, [room, minha, momentaneo, cameraLigada, enviarAgora]);

  /* —————— ações —————— */
  const alternarMao = useCallback(() => {
    travaRef.current.alternar(Date.now(), maoAoVivoRef.current !== null);
    sincronizar();
  }, [sincronizar]);

  const abaixarDeOutro = useCallback(
    (alvo: string, motivo: "abaixar" | "vez") => {
      if (!room || conduzRef.current !== room.localParticipant.identity) return;
      const m: MensagemGesto = { v: 1, k: "abaixar", alvo, motivo };
      void publicarGesto(room, m);
      aoMensagemLocalRef.current(m);
    },
    [room],
  );

  const receberAbaixar = useCallback(
    (m: Extract<MensagemGesto, { k: "abaixar" }>, remetente: string) => {
      const caiu = travaRef.current.receberAbaixar(
        m,
        remetente,
        conduzRef.current,
        meuId,
        maoAoVivoRef.current !== null,
      );
      if (caiu) sincronizar();
    },
    [meuId, sincronizar],
  );

  const reenviarEstado = useCallback(
    (destino?: string) => {
      enviarAgora(destino);
    },
    [enviarAgora],
  );

  return {
    minhaMao: minha.mao,
    minhaMaoDesde: minha.desde,
    origemMao: minha.origem,
    meuMomentaneo: momentaneo,
    alternarMao,
    abaixarDeOutro,
    receberAbaixar,
    reenviarEstado,
  };
}
