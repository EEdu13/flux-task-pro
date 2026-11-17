import { ehFeriadoNacional } from "@/lib/dias-uteis";

/**
 * Dias da estrutura: sempre "AAAA-MM-DD" de BRASÍLIA, nunca o relógio do
 * computador de quem olha (o servidor roda nos EUA). O Brasil não tem horário
 * de verão desde 2019, então Brasília é sempre UTC−3. Mesma convenção de
 * `dias-uteis.ts`: o "dia" anda como meia-noite UTC daquele dia de Brasília.
 *
 * Sem imports de servidor: a tela e o servidor usam as mesmas contas.
 */

const DIA_MS = 86_400_000;
const BRASILIA_MS = 3 * 3600_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const msDoDia = (dia: string) => Date.parse(`${dia}T00:00:00Z`);
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "AAAA-MM-DD" que existe no calendário (2026-02-31 não vale). */
export function diaValido(dia: unknown): dia is string {
  return typeof dia === "string" && ISO.test(dia) && isoDe(msDoDia(dia)) === dia;
}

/** O dia de hoje em Brasília. */
export function hojeEmBrasilia(agora: number = Date.now()): string {
  return isoDe(agora - BRASILIA_MS);
}

/** A hora cheia (0 a 23) em Brasília. */
export function horaEmBrasilia(agora: number = Date.now()): number {
  return new Date(agora - BRASILIA_MS).getUTCHours();
}

/** Antes das 4h da manhã: o app de campo pede confirmação, e o CONECTA também. */
export function ehMadrugada(agora: number = Date.now()): boolean {
  return horaEmBrasilia(agora) < 4;
}

export function somarDias(dia: string, n: number): string {
  return isoDe(msDoDia(dia) + n * DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(dia: string): number {
  return new Date(msDoDia(dia)).getUTCDay();
}

export function segundaDaSemana(dia: string): string {
  return somarDias(dia, -((diaDaSemana(dia) + 6) % 7));
}

/** Segunda a sexta da semana que contém `dia`. */
export function diasUteisDaSemana(dia: string): string[] {
  const seg = segundaDaSemana(dia);
  return [0, 1, 2, 3, 4].map((i) => somarDias(seg, i));
}

export function ehFimDeSemana(dia: string): boolean {
  const d = diaDaSemana(dia);
  return d === 0 || d === 6;
}

export function ehFeriado(dia: string): boolean {
  const [a, m, d] = dia.split("-").map(Number);
  return ehFeriadoNacional(a!, m! - 1, d!);
}

/** `a` vem antes de `b`? (A ordem do texto "AAAA-MM-DD" é a do calendário.) */
export const antes = (a: string, b: string): boolean => a < b;

const CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const LONGO = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** "seg" */
export const nomeCurtoDoDia = (dia: string): string => CURTO[diaDaSemana(dia)]!;

/** "09" */
export const numeroDoDia = (dia: string): string => dia.slice(8, 10);

/** "09/11" */
export const diaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "segunda-feira, 9 de novembro" */
export function dataPorExtenso(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${LONGO[diaDaSemana(dia)]}, ${d} de ${MESES[m! - 1]}`;
}
