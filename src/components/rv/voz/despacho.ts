/**
 * Quando mandar a fala para virar card — a parte de `useCardsDeFala` que não
 * precisa de React, microfone nem rede, para ser testada no Node com relógio
 * falso.
 *
 * Por que não mandar cada frase na hora: brasileiro fala em frases curtas e
 * emendadas ("Então... o relatório... o Paulo leva até sexta"). Cada frase
 * isolada vira um card pior e custa uma chamada. As frases que chegam enquanto
 * uma chamada está em voo, ou a menos de 8 s da anterior, se juntam num
 * PENDENTE (até 1500 caracteres e 20 s de fala) e saem numa chamada só.
 *
 * Freio por minuto: 6 chamadas no último minuto pausam os cards por 60 s. Com
 * o espaçamento de 8 s isso só acontece com fala corrida por ~40 s — monólogo
 * que já tem cards suficientes na tela.
 *
 * Geração: o mudo (ou trilha trocada) sobe a geração. Tudo o que nasceu na
 * geração anterior — pendente, transcrição em voo, card em voo — é descartado
 * sem publicar: é a frase que a pessoa quis esconder ao fechar o microfone.
 */

export const ESPACO_ENTRE_CHAMADAS_MS = 8_000;
export const CHAMADAS_POR_MINUTO = 6;
export const PAUSA_DO_LIMITE_MS = 60_000;
export const PENDENTE_MAX_CARACTERES = 1_500;
export const PENDENTE_MAX_FALA_MS = 20_000;
/** Pendentes fechados esperando a vez; acima disso o mais velho é descartado (já ficou para trás). */
export const FILA_MAX = 2;

export interface Pendente {
  /** `${meuId}:${inicio do primeiro trecho}` — vira o id do card. */
  id: string;
  at: number;
  texto: string;
  falaMs: number;
  geracao: number;
  /** Aceita mais frases (o último da fila, enquanto não estourou os tetos). */
  aberto: boolean;
}

export interface TrechoOuvido {
  inicio: number;
  texto: string;
  falaMs: number;
}

export class Despachante {
  private fila: Pendente[] = [];
  private chamadas: number[] = [];
  private ultimaChamada = -Infinity;
  private pausadoAte = 0;
  geracao = 0;
  emVoo = false;

  readonly meuId: string;

  // Sem "parameter property": o arquivo também roda no Node só com remoção de tipos (testes).
  constructor(meuId: string) {
    this.meuId = meuId;
  }

  /**
   * Junta uma frase transcrita. Devolve o pendente que a recebeu, se for novo
   * (`novo`), e os que caíram da fila por excesso (`descartados`), para a
   * bandeja mostrar cada um.
   */
  juntar(
    t: TrechoOuvido,
    geracao: number,
  ): { pendente: Pendente | null; novo: boolean; descartados: Pendente[] } {
    if (geracao !== this.geracao) return { pendente: null, novo: false, descartados: [] };
    const aberto = this.fila.at(-1);
    if (
      aberto?.aberto &&
      aberto.texto.length + 1 + t.texto.length <= PENDENTE_MAX_CARACTERES &&
      aberto.falaMs + t.falaMs <= PENDENTE_MAX_FALA_MS
    ) {
      aberto.texto = `${aberto.texto} ${t.texto}`;
      aberto.falaMs += t.falaMs;
      return { pendente: aberto, novo: false, descartados: [] };
    }
    if (aberto) aberto.aberto = false;
    const novo: Pendente = {
      id: `${this.meuId}:${Math.round(t.inicio)}`,
      at: Math.round(t.inicio),
      texto: t.texto.slice(0, PENDENTE_MAX_CARACTERES),
      falaMs: t.falaMs,
      geracao,
      aberto: true,
    };
    this.fila.push(novo);
    const descartados: Pendente[] = [];
    while (this.fila.length > FILA_MAX) descartados.push(this.fila.shift()!);
    return { pendente: novo, novo: true, descartados };
  }

  private chamadasNoMinuto(agora: number) {
    this.chamadas = this.chamadas.filter((t) => agora - t < 60_000);
    return this.chamadas.length;
  }

  /** "limite por minuto" enquanto a pausa durar; null fora dela. */
  pausado(agora: number): string | null {
    return agora < this.pausadoAte ? "limite por minuto" : null;
  }

  /** Há frases esperando (para o estado "pensando"). */
  temPendente(): boolean {
    return this.fila.length > 0;
  }

  /** Tira o pendente mais velho se todas as condições deixam; senão null. */
  despachar(agora: number): Pendente | null {
    if (this.emVoo || this.fila.length === 0) return null;
    if (agora - this.ultimaChamada < ESPACO_ENTRE_CHAMADAS_MS) return null;
    if (agora < this.pausadoAte) return null;
    if (this.chamadasNoMinuto(agora) >= CHAMADAS_POR_MINUTO) return null;
    const p = this.fila.shift()!;
    p.aberto = false;
    this.emVoo = true;
    this.ultimaChamada = agora;
    this.chamadas.push(agora);
    if (this.chamadas.length >= CHAMADAS_POR_MINUTO) this.pausadoAte = agora + PAUSA_DO_LIMITE_MS;
    return p;
  }

  /** A chamada voltou (com card, "nada" ou erro). */
  concluir(): void {
    this.emVoo = false;
  }

  /** O resultado ainda vale? Falso se o mudo veio depois que a frase nasceu. */
  vale(p: { geracao: number }): boolean {
    return p.geracao === this.geracao;
  }

  /** Mudo, trilha trocada ou desligar: tudo o que está na fila é jogado fora. */
  novaGeracao(): Pendente[] {
    this.geracao++;
    const fora = this.fila;
    this.fila = [];
    return fora;
  }
}

/** Uma leitura de `room.activeSpeakers[0]` (null = ninguém falando). */
export interface AmostraDeFalante {
  t: number;
  id: string | null;
}

/**
 * Anti-eco, camada 1 (antes de gastar): o trecho fechou no MEU microfone, mas
 * se em mais da metade das leituras daquele intervalo quem o LiveKit apontava
 * como falante era outra pessoa, o que gravei foi a voz dela saindo da minha
 * caixa de som. Descarta sem transcrever.
 */
export function dominadoPorRemoto(
  amostras: readonly AmostraDeFalante[],
  inicio: number,
  fim: number,
  meuId: string,
): boolean {
  let total = 0;
  let remoto = 0;
  for (const a of amostras) {
    if (a.t < inicio || a.t > fim) continue;
    total++;
    if (a.id && a.id !== meuId) remoto++;
  }
  return total > 0 && remoto / total > 0.5;
}
