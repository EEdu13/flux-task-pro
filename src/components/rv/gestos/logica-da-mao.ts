/*
 * logica-da-mao.ts — a parte PURA do useGestoNaSala (sem React, sem LiveKit, sem relógio
 * próprio): trava da mão, fala que abaixa, ordem do condutor, sessão/seq e o limitador de envio.
 *
 * Por que separado: são regras de tempo que precisam de teste no Node (scratchpad
 * sala-imersiva/gestos/teste-heuristica.mts), e um hook não roda fora do React.
 *
 * Regras (especificação §4.3):
 *  - mão vinda da câmera TRAVA: abaixar o braço não solta (é a intenção de falar na fila);
 *  - só cai pelo botão/tecla L, por falar FALA_QUE_ABAIXA_MS seguidos (lacunas < 700 ms
 *    toleradas) ou por "abaixar" vindo de QUEM CONDUZ com alvo = eu;
 *  - depois de cair com o braço ainda no alto, só trava de novo quando o braço descer
 *    (senão o botão "Abaixar" não funcionaria com a pessoa ainda de mão erguida).
 */
import {
  FALA_QUE_ABAIXA_MS,
  type GestoMomentaneo,
  type LadoDaMao,
  type MensagemGesto,
} from "../sala/tipos";

export type OrigemDaMao = "camera" | "botao";

export interface MinhaMao {
  mao: LadoDaMao | null;
  desde: number | null;
  origem: OrigemDaMao | null;
}

/** Lacuna de fala (ms) que ainda conta como "falando seguido" — respirar não zera. */
export const LACUNA_DE_FALA_MS = 700;

export type MotivoDeQueda = "botao" | "fala" | "condutor";

export class TravaDaMao {
  estado: MinhaMao = { mao: null, desde: null, origem: null };
  /** O braço precisa descer antes de a câmera poder travar de novo. */
  private esperandoBracoDescer = false;
  private falaDesde: number | null = null;
  private ultimaFala = Number.NEGATIVE_INFINITY;

  /** A câmera viu (ou deixou de ver) a mão erguida. Devolve true se o estado mudou. */
  aoVivo(maoAoVivo: LadoDaMao | null, agora: number): boolean {
    if (maoAoVivo === null) {
      this.esperandoBracoDescer = false;
      return false;
    }
    if (this.esperandoBracoDescer) return false;
    const e = this.estado;
    if (e.mao === null) {
      this.estado = { mao: maoAoVivo, desde: agora, origem: "camera" };
      return true;
    }
    // Travada: a câmera pode trocar o lado (direita → duas), mas o "desde" (posição na fila) fica.
    if (e.mao !== maoAoVivo) {
      this.estado = { ...e, mao: maoAoVivo };
      return true;
    }
    return false;
  }

  /** Botão / tecla L. `bracoNoAlto` = maoAoVivo agora (para não travar de novo na hora). */
  alternar(agora: number, bracoNoAlto: boolean): void {
    if (this.estado.mao !== null) this.soltar(bracoNoAlto);
    else this.estado = { mao: "direita", desde: agora, origem: "botao" };
  }

  /**
   * Chamar quando o "falando" muda e periodicamente (≈ 200 ms). Devolve true quando a fala
   * acabou de derrubar a mão (o hook mostra o aviso local).
   */
  passoDaFala(falando: boolean, agora: number, bracoNoAlto: boolean): boolean {
    if (falando) {
      if (this.falaDesde === null || agora - this.ultimaFala > LACUNA_DE_FALA_MS)
        this.falaDesde = agora;
      this.ultimaFala = agora;
    } else if (agora - this.ultimaFala > LACUNA_DE_FALA_MS) {
      this.falaDesde = null;
    }
    const e = this.estado;
    if (e.mao === null || this.falaDesde === null || e.desde === null) return false;
    // Conta só a fala DEPOIS de levantar: quem já falava e ergue a mão não perde a vez na hora.
    const inicio = Math.max(this.falaDesde, e.desde);
    if (agora - inicio >= FALA_QUE_ABAIXA_MS) {
      this.soltar(bracoNoAlto);
      return true;
    }
    return false;
  }

  /** "abaixar" que chegou pela rede. Só vale de quem conduz e com alvo = eu. */
  receberAbaixar(
    m: Extract<MensagemGesto, { k: "abaixar" }>,
    remetente: string,
    conduzId: string | null,
    meuId: string,
    bracoNoAlto: boolean,
  ): boolean {
    if (!conduzId || remetente !== conduzId || m.alvo !== meuId) return false;
    if (this.estado.mao === null) return false;
    this.soltar(bracoNoAlto);
    return true;
  }

  private soltar(bracoNoAlto: boolean): void {
    this.estado = { mao: null, desde: null, origem: null };
    this.esperandoBracoDescer = bracoNoAlto;
  }
}

/**
 * Limitador "no máximo 1 envio a cada intervaloMs" (500 ms = 2 msg/s), coalescendo: pedidos
 * no meio do intervalo viram UM envio no fim dele, com o estado mais novo.
 */
export class Limitador {
  private ultimoEnvio = Number.NEGATIVE_INFINITY;
  private agendado = false;
  readonly intervaloMs: number;

  constructor(intervaloMs = 500) {
    this.intervaloMs = intervaloMs;
  }

  /**
   * Pede um envio. Devolve 0 (envie já), o atraso em ms até o envio agendado, ou null
   * (já há um envio agendado: ele levará o estado mais novo).
   */
  pedir(agora: number): number | null {
    if (this.agendado) return null;
    const espera = this.ultimoEnvio + this.intervaloMs - agora;
    if (espera <= 0) return 0;
    this.agendado = true;
    return espera;
  }

  /** O envio aconteceu (imediato ou agendado). */
  enviou(agora: number): void {
    this.ultimoEnvio = agora;
    this.agendado = false;
  }

  /** Cancela o agendado (desmontou / trocou de sala). */
  zerar(): void {
    this.agendado = false;
    this.ultimoEnvio = Number.NEGATIVE_INFINITY;
  }
}

export interface EstadoParaEnviar {
  mao: LadoDaMao | null;
  maoDesde: number | null;
  origemMao: OrigemDaMao | null;
  momentaneo: GestoMomentaneo | null;
  camera: boolean;
}

/** Sessão (aleatória por conexão) + seq crescente: o receptor ignora pacote velho/repetido. */
export class EmissorDeEstado {
  readonly sessao: string;
  private seq = 0;

  constructor(sessao: string) {
    this.sessao = sessao;
  }

  montar(e: EstadoParaEnviar, agora: number): Extract<MensagemGesto, { k: "estado" }> {
    return {
      v: 1,
      k: "estado",
      sessao: this.sessao,
      seq: this.seq++,
      mao: e.mao,
      // O grampo é feito AQUI, no emissor: o receptor usa o valor cru para ordenar a fila.
      maoDesde: e.maoDesde === null ? null : Math.min(e.maoDesde, agora),
      origemMao: e.mao === null ? null : e.origemMao,
      momentaneo: e.momentaneo,
      camera: e.camera,
    };
  }
}

/** Mesma coisa que vai à rede? (para não reenviar um estado idêntico ao último). */
export function mesmoEstado(a: EstadoParaEnviar | null, b: EstadoParaEnviar): boolean {
  return (
    !!a &&
    a.mao === b.mao &&
    a.maoDesde === b.maoDesde &&
    a.origemMao === b.origemMao &&
    a.momentaneo === b.momentaneo &&
    a.camera === b.camera
  );
}

/** A ordem da fila (exportada para o integrador calcular posicaoNaFila igual). */
export function ordenarFila<T extends { id: string; desde: number }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => a.desde - b.desde || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
