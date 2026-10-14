/* Agenda travada — o que o cliente e o servidor compartilham (14/10/2026).
 *
 * Um "compromisso" é o horário que alguém travou na agenda de uma ou mais
 * pessoas pelo calendário (botão direito → "Travar agenda"), como no Outlook.
 * As tabelas são gestor.compromissos e gestor.compromisso_participantes (ver
 * db/migracoes/2026-10-14-agenda-travada.sql); as operações moram em
 * `compromissos.functions.ts`.
 *
 * Este arquivo não fala com o banco: tipos, o prefixo que distingue o aviso de
 * "começa em X min" dos demais avisos de compromisso, e utilidades de tela.
 */

import { semAcento } from "@/lib/texto-busca";

export type Compromisso = {
  id: string;
  /** Quem travou — id da pessoa, como string (o mesmo de `User.id`). */
  criadoPor: string;
  assunto: string;
  descricao: string | null;
  /** Texto livre ("Sala Maior", "Fazenda 820"…). */
  local: string | null;
  /** Sala de voz e vídeo do CONECTA (`name` de `rooms.ts`), quando há. */
  sala: string | null;
  /** ISO (UTC). */
  inicio: string;
  /** ISO (UTC). */
  fim: string;
  /** Ids das pessoas com a agenda travada. Quem criou só está aqui se se incluiu. */
  participantes: string[];
};

/** Um choque de horário de uma pessoa com outro compromisso. */
export type ConflitoDeAgenda = {
  pessoaId: string;
  compromissoId: string;
  /** `null` quando o compromisso é de alguém que eu não enxergo — só o horário. */
  assunto: string | null;
  inicio: string;
  fim: string;
};

/**
 * O aviso de "começa em X min" é gravado com este começo de título.
 *
 * Os avisos de compromisso são de dois tipos na mesma coluna `tipo`: os
 * informativos (travou, mudou, cancelou) e os de horário, 30 e 10 minutos
 * antes. Só os de horário trazem o app para frente com o cartão grande — e é
 * pelo título que a tela os separa, sem uma coluna nova na sineta (que
 * quebraria `listarNotificacoes` enquanto a migração não roda).
 */
export const PREFIXO_ALERTA_DE_COMPROMISSO = "Agenda em ";

/** A notificação é o alerta de 30/10 minutos de um compromisso. */
export function ehAlertaDeCompromisso(n: { type: string; title: string }): boolean {
  return n.type === "compromisso" && n.title.startsWith(PREFIXO_ALERTA_DE_COMPROMISSO);
}

/** Disparado depois de travar, mudar ou cancelar um compromisso: quem mostra relê. */
export const COMPROMISSOS_MUDARAM = "fluxo:compromissos-mudaram";

/** "14:00" no fuso da máquina. */
export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "14:00–15:00" (com o dia na frente quando atravessa a meia-noite). */
export function faixaDeHorario(c: Pick<Compromisso, "inicio" | "fim">): string {
  const a = new Date(c.inicio);
  const b = new Date(c.fim);
  if (a.toDateString() === b.toDateString()) return `${horaCurta(c.inicio)}–${horaCurta(c.fim)}`;
  const dia = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${dia(a)} ${horaCurta(c.inicio)} – ${dia(b)} ${horaCurta(c.fim)}`;
}

/** Nome sem acento e sem caixa, para casar "JOÃO" com "João" (via `semAcento`). */
export function nomeComparavel(nome: string | null | undefined): string {
  return semAcento(nome ?? "");
}

/** A cor da agenda travada em todas as visões — roxa, com o cadeado. */
export const COR_DA_AGENDA_TRAVADA = "#7c3aed";
