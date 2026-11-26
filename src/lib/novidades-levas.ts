/**
 * Quais levas da janela "O que mudou" a pessoa ainda precisa ver (26/11/2026, quando a leva da
 * estrutura entrou depois da do Gantt). Puro, sem imports: dá para testar com `node --test`.
 *
 * Cada leva tem a sua versão, e o "já vi" guardado é UMA só: a última versão que a pessoa fechou.
 * - `VERSAO_DA_ESTRUTURA`: viu a do Gantt e a da estrutura;
 * - `VERSAO_DO_GANTT`: viu a do Gantt (e a da estrutura não, porque não tinha estrutura para ver);
 * - qualquer outro valor, ou nenhum: não viu nenhuma das duas.
 *
 * A leva da estrutura é só para quem tem equipe para enviar. Quem não tem não a vê nem a perde: se
 * um dia ganhar uma equipe, ela chega nessa hora. A do Gantt é para todos, inclusive quem ficou
 * fora do sistema desde 19/11/2026 e nunca a viu.
 */
export const VERSAO_DO_GANTT = "2026-11-18-gantt";
export const VERSAO_DA_ESTRUTURA = "2026-11-26-estrutura";

export interface LevasDaJanela {
  gantt: boolean;
  estrutura: boolean;
}

export function levasDaJanela(
  visto: string | null | undefined,
  temEstrutura: boolean,
): LevasDaJanela {
  const viuEstrutura = visto === VERSAO_DA_ESTRUTURA;
  const viuGantt = viuEstrutura || visto === VERSAO_DO_GANTT;
  return { gantt: !viuGantt, estrutura: temEstrutura && !viuEstrutura };
}

/**
 * As levas que faltam quando há duas fontes do "já vi": a cópia local (que responde na hora) e o
 * banco (a pessoa pode ter visto em outro computador, ou a gravação no banco pode ter falhado).
 * Vale como visto o que QUALQUER das duas diz que foi visto, como sempre foi.
 */
export function levasPendentes(
  local: string | null | undefined,
  banco: string | null | undefined,
  temEstrutura: boolean,
): LevasDaJanela {
  const a = levasDaJanela(local, temEstrutura);
  const b = levasDaJanela(banco, temEstrutura);
  return { gantt: a.gantt && b.gantt, estrutura: a.estrutura && b.estrutura };
}

export const haLevaParaVer = (l: LevasDaJanela): boolean => l.gantt || l.estrutura;

/**
 * O que guardar ao fechar a janela: quem tem estrutura viu tudo; quem não tem só viu até o Gantt,
 * e a leva da estrutura ainda pode chegar para ele.
 */
export function versaoAoFechar(temEstrutura: boolean): string {
  return temEstrutura ? VERSAO_DA_ESTRUTURA : VERSAO_DO_GANTT;
}
