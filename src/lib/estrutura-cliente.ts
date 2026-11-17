import { useSyncExternalStore } from "react";
import {
  EVENTO_ESTRUTURA_ENVIADA,
  type CobrancaDaEquipe,
  type EquipeDaEstrutura,
  type FalhaDaEstrutura,
  type MotivoDaFalha,
  type SituacaoDoDia,
} from "@/lib/estrutura-tipos";
import { hojeEmBrasilia } from "@/lib/estrutura-datas";

/*
 * A estrutura do dia do lado da tela: UMA memória para o menu, o card do
 * Início, o lembrete do Pack e a própria tela, lida com `useSyncExternalStore`.
 * Ninguém além da `VigiaDaEstrutura` busca nada por conta própria: o layout
 * só lê, e navegar entre telas não gera uma chamada nova ao PWA.
 *
 * Nada no localStorage: a resposta mora na memória da aba. A fechadura de
 * verdade é o servidor (`estrutura.functions.ts`); isto só decide o que
 * aparece.
 */

export interface EstadoDaEstrutura {
  /** Já perguntamos ao servidor ao menos uma vez? Antes disso nada aparece. */
  pronto: boolean;
  /** A estrutura está aberta para esta pessoa? */
  aberta: boolean;
  equipes: EquipeDaEstrutura[];
  /** Tem o seletor de equipe? Só o Eduardo (usuário global). */
  trocaDeEquipe: boolean;
  /** A equipe em que a tela abre: a da própria pessoa. */
  inicial: string;
  /** A situação de HOJE por equipe (a cobrança). */
  cobranca: CobrancaDaEquipe[];
  /** O dia (Brasília) a que `cobranca` se refere: na virada ela deixa de valer. */
  cobrancaDoDia: string;
  /** A última busca falhou (a tela de verdade mostra; o card e o menu calam). */
  erro: MotivoDaFalha | null;
}

const VAZIO: EstadoDaEstrutura = {
  pronto: false,
  aberta: false,
  equipes: [],
  trocaDeEquipe: false,
  inicial: "",
  cobranca: [],
  cobrancaDoDia: "",
  erro: null,
};

let estado: EstadoDaEstrutura = VAZIO;
const ouvintes = new Set<() => void>();

function definir(mudanca: Partial<EstadoDaEstrutura>): void {
  estado = { ...estado, ...mudanca };
  ouvintes.forEach((f) => f());
}

export function useEstrutura(): EstadoDaEstrutura {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => void ouvintes.delete(f);
    },
    () => estado,
    () => VAZIO,
  );
}

/** Tem estrutura para esta pessoa? É o que decide menu, Ctrl+K, card e lembrete. */
export function useTemEstrutura(): boolean {
  const e = useEstrutura();
  return e.pronto && e.aberta && e.equipes.length > 0;
}

/** O motivo da falha, lido pela forma do objeto (a classe não atravessa o servidor). */
export function motivoDaFalha(e: unknown): MotivoDaFalha {
  return ((e ?? {}) as FalhaDaEstrutura).motivo ?? "inesperado";
}

/* ------------------------------ Buscas ------------------------------ */

const UM_DIA_MS = 24 * 3600_000;
let equipesEm = 0;
let buscandoEquipes: Promise<void> | null = null;
let buscandoCobranca: Promise<void> | null = null;

/**
 * As equipes da pessoa. Guardadas por um dia na aba (o servidor guarda 12 h): quem entra ou sai de
 * uma equipe é raro, e o menu não precisa saber na hora. `forcar` = a tela abriu para apontar: pula
 * a validade aqui E no servidor, que confere com o PWA agora (quem não é mais da equipe sai aqui).
 */
export function carregarEquipes(forcar = false): Promise<void> {
  if (!forcar && estado.pronto && !estado.erro && Date.now() - equipesEm < UM_DIA_MS) {
    return Promise.resolve();
  }
  if (buscandoEquipes) return buscandoEquipes;
  buscandoEquipes = import("@/lib/estrutura.functions")
    .then(({ minhasEquipesDeEstrutura }) => minhasEquipesDeEstrutura({ data: { fresco: forcar } }))
    .then((r) => {
      equipesEm = Date.now();
      definir({
        pronto: true,
        aberta: r.aberta,
        equipes: r.equipes,
        trocaDeEquipe: r.trocaDeEquipe,
        inicial: r.inicial,
        erro: null,
      });
    })
    .catch((e: unknown) => {
      // Sem barulho: o menu e o card simplesmente não aparecem; a tela mostra o erro.
      definir({ pronto: true, erro: motivoDaFalha(e) });
    })
    .finally(() => {
      buscandoEquipes = null;
    });
  return buscandoEquipes;
}

/** A situação de hoje de cada equipe. Só roda se há equipe. */
export function carregarCobranca(): Promise<void> {
  if (!estado.aberta || estado.equipes.length === 0) return Promise.resolve();
  if (buscandoCobranca) return buscandoCobranca;
  buscandoCobranca = import("@/lib/estrutura.functions")
    .then(({ cobrancaDaEstrutura }) => cobrancaDaEstrutura())
    .then((r) => {
      definir({ cobranca: r.equipes, cobrancaDoDia: hojeEmBrasilia(), erro: null });
    })
    .catch((e: unknown) => {
      definir({ erro: motivoDaFalha(e) });
    })
    .finally(() => {
      buscandoCobranca = null;
    });
  return buscandoCobranca;
}

/* --------------------------- O que a tela lê --------------------------- */

/** A situação de hoje de uma equipe; `null` se a cobrança é de outro dia ou ainda não veio. */
export function situacaoDeHoje(e: EstadoDaEstrutura, equipe: string): SituacaoDoDia | null {
  if (e.cobrancaDoDia !== hojeEmBrasilia()) return null;
  return e.cobranca.find((c) => c.equipe === equipe)?.hoje ?? null;
}

/** As equipes com a estrutura de hoje PENDENTE. */
export function equipesPendentes(e: EstadoDaEstrutura): EquipeDaEstrutura[] {
  return e.equipes.filter((q) => situacaoDeHoje(e, q.equipe) === "pendente");
}

/** Alguém enviou: o card e o lembrete ficam verdes na hora, sem esperar a próxima leitura. */
export function marcarEnviadaHoje(equipe: string): void {
  const outras = estado.cobranca.filter((c) => c.equipe !== equipe);
  definir({
    cobranca: [...outras, { equipe, hoje: "enviado" }],
    cobrancaDoDia: hojeEmBrasilia(),
  });
}

/** Avisa a aba inteira de um envio de HOJE (o evento que o card e o lembrete escutam). */
export function avisarEnvio(equipe: string, dia: string): void {
  if (dia === hojeEmBrasilia()) marcarEnviadaHoje(equipe);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENTO_ESTRUTURA_ENVIADA, { detail: { equipe, dia } }));
  }
}

/** O estado de agora, fora do React (intervalos e eventos não podem usar a captura de uma renderização). */
export function estadoDaEstrutura(): EstadoDaEstrutura {
  return estado;
}
