/*
 * protocolo.ts — leitura DEFENSIVA e envio do tópico "rv-gesto" (LiveKit publishData).
 *
 * Por que defensivo: qualquer participante pode mandar qualquer byte. O pacote passa por
 * tamanho, JSON, versão, tipo e cada campo; o que sai daqui é um objeto NOVO só com os campos
 * conhecidos. Quem mandou NUNCA vem no pacote: o integrador usa participant.identity.
 */
import type { Room } from "livekit-client";
import {
  MAX_BYTES_DO_PACOTE,
  TOPICO_GESTO,
  type GestoMomentaneo,
  type LadoDaMao,
  type MensagemGesto,
} from "../sala/tipos";

const LADOS: readonly LadoDaMao[] = ["direita", "esquerda", "duas"];
const MOMENTANEOS: readonly GestoMomentaneo[] = ["aceno", "joinha", "palmas", "coracao"];
const ORIGENS = ["camera", "botao"] as const;
const MOTIVOS = ["abaixar", "vez"] as const;

function umDe<T extends string>(lista: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (lista as readonly string[]).includes(v);
}

const decodificador = new TextDecoder("utf-8", { fatal: true });
const codificador = new TextEncoder();

/** Devolve a mensagem validada ou null (pacote torto, grande demais ou de versão desconhecida). */
export function lerMensagemGesto(payload: Uint8Array): MensagemGesto | null {
  if (!(payload instanceof Uint8Array) || payload.byteLength > MAX_BYTES_DO_PACOTE) return null;
  let dado: unknown;
  try {
    dado = JSON.parse(decodificador.decode(payload));
  } catch {
    return null;
  }
  if (!dado || typeof dado !== "object" || Array.isArray(dado)) return null;
  const o = dado as Record<string, unknown>;
  if (o.v !== 1) return null;

  if (o.k === "estado") {
    if (typeof o.sessao !== "string" || o.sessao.length === 0 || o.sessao.length > 64) return null;
    if (typeof o.seq !== "number" || !Number.isSafeInteger(o.seq) || o.seq < 0) return null;
    if (o.mao !== null && !umDe(LADOS, o.mao)) return null;
    if (o.maoDesde !== null && (typeof o.maoDesde !== "number" || !Number.isFinite(o.maoDesde)))
      return null;
    if (o.origemMao !== null && !umDe(ORIGENS, o.origemMao)) return null;
    if (o.momentaneo !== null && !umDe(MOMENTANEOS, o.momentaneo)) return null;
    if (typeof o.camera !== "boolean") return null;
    return {
      v: 1,
      k: "estado",
      sessao: o.sessao,
      seq: o.seq,
      mao: o.mao,
      // Sem mão não há "desde" nem origem: normaliza para a fila não pegar lixo.
      maoDesde: o.mao === null ? null : (o.maoDesde as number | null),
      origemMao: o.mao === null ? null : (o.origemMao as "camera" | "botao" | null),
      momentaneo: o.momentaneo,
      camera: o.camera,
    };
  }

  if (o.k === "abaixar") {
    if (typeof o.alvo !== "string" || o.alvo.length === 0 || o.alvo.length > 128) return null;
    if (!umDe(MOTIVOS, o.motivo)) return null;
    return { v: 1, k: "abaixar", alvo: o.alvo, motivo: o.motivo };
  }
  return null;
}

/** JSON UTF-8 da mensagem (o que vai no publishData). */
export function codificarMensagemGesto(m: MensagemGesto): Uint8Array<ArrayBuffer> {
  return codificador.encode(JSON.stringify(m));
}

/**
 * Publica no tópico "rv-gesto", sempre reliable. `destino` = destinationIdentities (reenvio
 * para quem acabou de chegar). Falha de rede vira aviso no console, nunca exceção.
 */
export async function publicarGesto(
  room: Room,
  m: MensagemGesto,
  destino?: string[],
): Promise<void> {
  try {
    await room.localParticipant.publishData(codificarMensagemGesto(m), {
      reliable: true,
      topic: TOPICO_GESTO,
      ...(destino?.length ? { destinationIdentities: destino } : {}),
    });
  } catch (e) {
    console.warn("[rv-gesto] não consegui publicar:", e);
  }
}
