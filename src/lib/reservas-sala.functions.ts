import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";
import type {
  ReservaCriada,
  ReservaDeSala,
  SalaDeReuniao,
} from "@/integrations/agendador/client.server";

/* Reserva de SALA FÍSICA de reunião, no Agendador.
 *
 * Atenção ao nome: `salas` no Fluxo já são as salas de voz e vídeo do LiveKit
 * (`src/lib/rooms.ts`, `src/routes/salas.*`). Estas aqui são as duas salas de
 * reunião do escritório — Sala Maior e Sala Menor — e por isso o arquivo, as
 * funções e a futura rota falam em "reserva de sala", nunca só em "sala".
 *
 * Quem guarda a reserva é o Agendador, que tem as regras (conflito de horário,
 * lembrete de fim, WhatsApp de confirmação) e a agenda que a TV do corredor
 * mostra. Duplicar isso aqui seria criar uma segunda verdade sobre quem está
 * com a sala — então o Fluxo só conversa com ele por HTTP.
 */

export type { ReservaDeSala, SalaDeReuniao, ReservaCriada };

/* ---------------------------- Validadores ---------------------------- */

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const data = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!ISO_DATA.test(s)) throw new Error("Data inválida (use AAAA-MM-DD)");
  return s;
};

const hora = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!HORA.test(s)) throw new Error("Horário inválido (use HH:MM)");
  return s;
};

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const sala = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Sala inválida");
  return n;
};

/** Id de pessoa na IAM — o mesmo número que o Fluxo usa como `pessoa_id`. */
const pessoa = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Pessoa inválida");
  return n;
};

/** Ids da IAM, sem repetidos. O Agendador diz depois quais ele não conhece. */
const pessoas = (v: unknown): number[] => {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
};

/* ---------------------------- Operações ---------------------------- */

/**
 * As salas que existem, direto do Agendador.
 *
 * Vem da API em vez de uma constante local de propósito: no dia em que uma
 * terceira sala aparecer lá, ela aparece aqui sem deploy do Fluxo.
 */
export const listarSalasDeReuniao = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ salas: SalaDeReuniao[] }> => {
    const { lerSessao } = await import("@/integrations/iam/session.server");
    const ag = await import("@/integrations/agendador/client.server");

    const token = lerSessao();
    if (!token) throw new Error("Sessão expirada. Entre novamente.");

    return { salas: await ag.listarSalas(token, eu) };
  }),
);

/**
 * O que já está ocupado no período.
 *
 * É com isto que a tela evita oferecer um horário que vai bater 409 na hora de
 * gravar — sem ela, a pessoa só descobre o choque depois de tentar.
 */
export const listarAgendaDeSalas = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { data: string; dataFim?: string; salaId?: number }) => ({
      data: data(e.data),
      dataFim: e.dataFim === undefined ? undefined : data(e.dataFim),
      salaId: e.salaId === undefined ? undefined : sala(e.salaId),
    })),
  )
  .handler(
    comSessao(async (eu, dados): Promise<{ reservas: ReservaDeSala[] }> => {
      const { lerSessao } = await import("@/integrations/iam/session.server");
      const ag = await import("@/integrations/agendador/client.server");

      const token = lerSessao();
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      return { reservas: await ag.listarAgenda(token, eu, dados) };
    }),
  );

/**
 * Reserva a sala.
 *
 * Quem reserva é sempre quem está na sessão: `comSessao` entrega o `eu`, e o
 * Agendador por sua vez tira a identidade do próprio token — em nenhum ponto do
 * caminho um id vindo do cliente decide em nome de quem a reserva fica.
 *
 * Os erros que a tela precisa tratar chegam como `AgendadorError` com `motivo`:
 *   • "conflito"    → alguém pegou a sala nesse horário (traz `conflito` com
 *                     início, fim e responsável, para a mensagem ser útil)
 *   • "sem_acesso"  → falta permissão do Agendador na IAM; é a TI que resolve,
 *                     não o usuário
 *   • "invalido"    → data/hora/sala recusadas na validação de lá
 *   • "indisponivel"→ Agendador fora do ar ou com a IAM desligada
 */
export const reservarSalaDeReuniao = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        data: string;
        inicio: string;
        fim: string;
        salaId: number;
        motivo: string;
        participantesIam?: number[];
        paraIamId?: number | null;
        paraNome?: string;
      }) => {
        const inicio = hora(e.inicio);
        const fim = hora(e.fim);
        // Barrado aqui também, e não só no Agendador: erro de digitação não
        // precisa de uma ida à rede para virar mensagem na tela.
        if (inicio >= fim) throw new Error("A hora de término deve ser maior que a de início");

        const motivo = texto(e.motivo, 255);
        if (!motivo) throw new Error("Informe o motivo da reunião");

        return {
          data: data(e.data),
          inicio,
          fim,
          salaId: sala(e.salaId),
          motivo,
          participantesIam: pessoas(e.participantesIam),
          paraIamId: e.paraIamId ? pessoa(e.paraIamId) : null,
          paraNome: texto(e.paraNome, 120),
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, dados): Promise<ReservaCriada> => {
      const { lerSessao } = await import("@/integrations/iam/session.server");
      const ag = await import("@/integrations/agendador/client.server");

      const token = lerSessao();
      if (!token) throw new Error("Sessão expirada. Entre novamente.");

      return ag.criarReserva(token, eu, dados);
    }),
  );
