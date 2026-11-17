// Os adaptadores do PWA: o ÚNICO lugar que conhece os nomes de campo de lá. EXCLUSIVO
// do servidor. Os nomes vieram do teste de leitura de 09/11/2026 (a equipe 400AD, em
// `apontamento.up.railway.app`); se o PWA mudar um campo, o conserto é só aqui.
//
// Regras de leitura:
//   • o que vem fora do formato NÃO é "equipe vazia": é erro (`indisponivel`), para a
//     tela não mostrar uma lista vazia quando o certo era avisar que algo mudou;
//   • texto sempre aparado; número que não é número vira o padrão, nunca NaN;
//   • nada daqui é logado.

import { diaValido, hojeEmBrasilia } from "@/lib/estrutura-datas";
import type { SituacaoDoDia } from "@/lib/estrutura-tipos";
import { ErroDaEstrutura } from "./erro";
import type {
  CobrancaPwa,
  ColaboradorPwa,
  EntradaDoEnvio,
  LinhaDoDiaPwa,
  MinhasEquipesPwa,
  PessoaPwa,
  RespostaDoEnvio,
  VeiculoDoProjetoPwa,
  VeiculoPwa,
} from "./tipos";

const texto = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function formatoInesperado(onde: string): never {
  throw new ErroDaEstrutura(
    "indisponivel",
    `O sistema de apontamento respondeu num formato inesperado (${onde}).`,
  );
}

/* ------------------------------ Equipes ------------------------------ */

/** `{ modoAdm, equipes: [{ lider, equipe, projeto, cliente }] }`. Quem não é ADM recebe `{ modoAdm: false, equipes: [] }`. */
export function lerMinhasEquipes(body: unknown): MinhasEquipesPwa {
  const o = objeto(body);
  if (!o) formatoInesperado("minhas-equipes");
  const equipes = lista(o.equipes).flatMap((x) => {
    const e = objeto(x);
    const equipe = texto(e?.equipe).toUpperCase();
    return e && equipe
      ? [{ equipe, lider: texto(e.lider), projeto: texto(e.projeto), cliente: texto(e.cliente) }]
      : [];
  });
  return { modoAdm: o.modoAdm === true, equipes };
}

/* --------------------------- Pessoas e frota --------------------------- */

/**
 * `colaboradores?equipe=`: lista de `{ id, nome, cpf, cpfMasked, funcao, funcaoExecutante, classe,
 * projeto, coordenador, supervisor, nomeLider, externo?, tipoExterno?, … }`. O externo (PJ e
 * estagiário) tem id NEGATIVO, `cpf` vazio e `externo: true`; no `cpfMasked` dele vem o tipo, e não um CPF.
 */
export function lerPessoas(body: unknown): PessoaPwa[] {
  if (!Array.isArray(body)) formatoInesperado("colaboradores");
  return body.flatMap((x): PessoaPwa[] => {
    const o = objeto(x);
    if (!o) return [];
    const id = Number(o.id);
    const nome = texto(o.nome);
    if (!Number.isInteger(id) || id === 0 || !nome) return [];
    const externo = id < 0 || o.externo === true;
    return [
      {
        id,
        nome,
        funcao: texto(o.funcao) || texto(o.funcaoExecutante),
        cpf: externo ? "" : texto(o.cpf),
        cpfMascarado: externo ? "" : texto(o.cpfMasked),
        classe: texto(o.classe),
        externo,
        tipoExterno: externo ? texto(o.tipoExterno) || texto(o.classe) : "",
        projeto: texto(o.projeto),
        coordenador: texto(o.coordenador),
        supervisor: texto(o.supervisor),
      },
    ];
  });
}

/**
 * `colaboradores/todas-equipes`: lista de `{ id, nome, cpfMasked, funcao, funcaoExecutante, classe,
 * equipe, coordenador, nomeLider, situacao, cliente }` de TODO MUNDO (Eduardo, 10/11/2026). Sem o
 * CPF inteiro e sem PJ nem estagiário; se um externo aparecer um dia, fica de fora aqui também.
 */
export function lerTodosOsColaboradores(body: unknown): ColaboradorPwa[] {
  if (!Array.isArray(body)) formatoInesperado("colaboradores/todas-equipes");
  return body.flatMap((x): ColaboradorPwa[] => {
    const o = objeto(x);
    if (!o) return [];
    const id = Number(o.id);
    const nome = texto(o.nome);
    if (!Number.isInteger(id) || id <= 0 || o.externo === true || !nome) return [];
    return [
      {
        id,
        nome,
        funcao: texto(o.funcao) || texto(o.funcaoExecutante),
        cpfMascarado: texto(o.cpfMasked),
        classe: texto(o.classe),
        equipe: texto(o.equipe),
        coordenador: texto(o.coordenador),
      },
    ];
  });
}

function veiculoDe(o: Record<string, unknown>): VeiculoPwa | null {
  const prefixo = texto(o.prefixo);
  if (!prefixo) return null;
  const classe = texto(o.classe);
  const id = Number(o.id);
  return {
    id: Number.isInteger(id) ? id : 0,
    prefixo,
    placa: texto(o.placa),
    modelo: texto(o.modelo),
    tipo: classe,
    classe,
  };
}

/** `frota/equipe?equipe=`: lista de `{ id, prefixo, modelo, placa, classe, chassi }`. A `classe` agrupa e vai no POST. */
export function lerVeiculos(body: unknown): VeiculoPwa[] {
  if (!Array.isArray(body)) formatoInesperado("frota/equipe");
  return body.flatMap((x): VeiculoPwa[] => {
    const o = objeto(x);
    const v = o && veiculoDe(o);
    return v ? [v] : [];
  });
}

/**
 * `frota?projeto=`: a frota ativa do projeto, com `equipe` e `lider` em cada veículo (Eduardo,
 * 10/11/2026). Os outros campos são os de `frota/equipe`; sem equipe = equipe vazia ou SEM_EQUIPE.
 */
export function lerFrotaDoProjeto(body: unknown): VeiculoDoProjetoPwa[] {
  if (!Array.isArray(body)) formatoInesperado("frota");
  return body.flatMap((x): VeiculoDoProjetoPwa[] => {
    const o = objeto(x);
    const v = o && veiculoDe(o);
    return o && v ? [{ ...v, equipe: texto(o.equipe) }] : [];
  });
}

/** O nome do líder que mais aparece nas pessoas (`nomeLider`): o do organograma, o que a cobrança exige. */
export function liderDasPessoas(body: unknown): string {
  const cont = new Map<string, number>();
  for (const x of lista(body)) {
    const nome = texto(objeto(x)?.nomeLider);
    if (nome) cont.set(nome, (cont.get(nome) ?? 0) + 1);
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/* ------------------------------ Semana e dia ------------------------------ */

/** `ticket-semana`: `{ dias: ["AAAA-MM-DD", …] }`, só os dias que têm estrutura. */
export function lerDiasEnviados(body: unknown): string[] {
  const o = objeto(body);
  if (!o) formatoInesperado("ticket-semana");
  return lista(o.dias).filter((d): d is string => diaValido(d));
}

/**
 * `ticket-estrutura`: `{ found, colaboradores: [{ nome, cpf, classe, status, … }],
 * equipamentos: [{ prefixo, status }] }`. Sem id e sem lote: o efetivo casa pelo CPF, o
 * externo (cpf vazio) pelo nome. O status vem em minúsculas ("à disposição").
 */
export function lerLinhasDoDia(body: unknown): LinhaDoDiaPwa[] {
  const o = objeto(body);
  if (!o) formatoInesperado("ticket-estrutura");
  if (o.found === false) return [];
  const pessoas = lista(o.colaboradores).flatMap((x): LinhaDoDiaPwa[] => {
    const c = objeto(x);
    const nome = texto(c?.nome);
    return c && nome
      ? [{ tipo: "pessoa", nome, cpf: texto(c.cpf), prefixo: "", status: texto(c.status) }]
      : [];
  });
  const veiculos = lista(o.equipamentos).flatMap((x): LinhaDoDiaPwa[] => {
    const e = objeto(x);
    const prefixo = texto(e?.prefixo);
    return e && prefixo
      ? [{ tipo: "veiculo", nome: "", cpf: "", prefixo, status: texto(e.status) }]
      : [];
  });
  return [...pessoas, ...veiculos];
}

/* ------------------------------- Cobrança ------------------------------- */

type DoDia = "feito" | "pendente" | "folga" | "naoCobrado";

/** `a` = feito (existe TICKET), `n` = pendente, `f` = folga, `nb` = fim de semana. */
function situacaoDaCobranca(status: string, x: Record<string, unknown>): DoDia {
  if (status === "a") return "feito";
  if (status === "f" || x.folga === true) return "folga";
  if (status === "n" || x.faltaEstrutura === true) return "pendente";
  return "naoCobrado"; // "nb" e o que não conhecemos: nada a cobrar
}

const paraSituacao = (d: DoDia): SituacaoDoDia => (d === "feito" ? "enviado" : d);

/**
 * A situação de HOJE pelo `scoreDia` (é o que o PWA usa no card e no item do pack, Eduardo
 * 09/11/2026): `{ pct, pontosFeitos, pontosEsperados, folga }`. Folga é folga; nada esperado
 * é fora da cobrança; feito igual ou maior que o esperado é enviado; senão, pendente. Sem
 * `scoreDia`, vale o dia na lista `dias`.
 */
function situacaoDeHoje(
  sd: Record<string, unknown> | null,
  doDia: DoDia | undefined,
): SituacaoDoDia {
  const naLista = doDia ? paraSituacao(doDia) : null;
  let hoje: SituacaoDoDia;
  const esperados = Number(sd?.pontosEsperados);
  if (sd?.folga === true) hoje = "folga";
  else if (sd && Number.isFinite(esperados)) {
    const feitos = Number(sd.pontosFeitos);
    hoje =
      esperados > 0
        ? Number.isFinite(feitos) && feitos >= esperados
          ? "enviado"
          : "pendente"
        : naLista === "folga"
          ? "folga"
          : "naoCobrado";
  } else hoje = naLista ?? "naoCobrado";

  // Só no dev: se o `scoreDia` e a lista de dias discordarem, avisa (sem dado pessoal).
  if (import.meta.env.DEV && naLista && naLista !== hoje) {
    console.warn(`[estrutura] scoreDia diz "${hoje}" e dias[hoje] diz "${naLista}"`);
  }
  return hoje;
}

/**
 * `apontamento-status?adm=1&equipe=&lider=`: `{ lider, mes: "AAAA-MM", diaCorte, modoAdm, score,
 * scoreDia, dias: [{ dia, status, faltaEstrutura, folga, … }] }`. Sem o `lider` igual ao do
 * organograma o PWA devolve a cobrança de CAMPO (`modoAdm` falso), que não serve aqui.
 */
export function lerCobranca(body: unknown, hojeIso: string = hojeEmBrasilia()): CobrancaPwa {
  const o = objeto(body);
  if (!o) formatoInesperado("apontamento-status");
  if (o.modoAdm !== true) {
    throw new ErroDaEstrutura(
      "indisponivel",
      "A cobrança não veio no modo ADM: o nome do líder não bateu com o organograma.",
    );
  }
  const mes = texto(o.mes);
  const dias: CobrancaPwa["dias"] = {};
  if (/^\d{4}-\d{2}$/.test(mes)) {
    for (const d of lista(o.dias)) {
      const x = objeto(d);
      const n = Number(x?.dia);
      if (!x || !Number.isInteger(n) || n < 1 || n > 31) continue;
      dias[`${mes}-${String(n).padStart(2, "0")}`] = situacaoDaCobranca(texto(x.status), x);
    }
  }
  return { dias, hoje: situacaoDeHoje(objeto(o.scoreDia), dias[hojeIso]) };
}

/* -------------------------------- O envio -------------------------------- */

/** Quem enviou: o PWA põe isto no prefixo do `loteId` (`CONECTA-L…`) e devolve na resposta. */
export const ORIGEM_DO_ENVIO = "CONECTA";

/**
 * O corpo do `POST /api/ticket`, como o Eduardo descreveu em 09/11/2026:
 *   • `data` sempre (o PWA então apaga o dia da equipe e grava o novo, na mesma transação), e
 *     NUNCA `hojeCelular`: o servidor do CONECTA já recusa dia futuro antes de chegar aqui;
 *   • `origem: "CONECTA"`, e o `loteId` SEM o prefixo: o PWA o acrescenta (até 50 com ele);
 *   • `user.projeto` é o de `minhas-equipes`. Só se ele vier vazio vale o das pessoas da equipe.
 * Sem GPS e sem `placa` em branco inventada: a placa é a que o PWA devolveu. O externo vai com
 * `cpf: ""`. `nome`, `supervisor` e `coordenador` o PWA só usa se a equipe não estiver no
 * organograma: vão do mesmo jeito, e o organograma prevalece.
 */
export function montarCorpoDoEnvio(e: EntradaDoEnvio) {
  return {
    colaboradores: e.pessoas.map((p) => ({
      nome: p.nome,
      cpf: p.cpf,
      classe: p.classe,
      status: p.status,
    })),
    equipamentos: e.veiculos.map((v) => ({
      prefixo: v.prefixo,
      classe: v.classe,
      status: v.status,
      placa: v.placa,
    })),
    user: {
      projeto: e.equipe.projeto || e.hierarquia.projeto,
      coordenador: e.hierarquia.coordenador,
      supervisor: e.hierarquia.supervisor,
      nome: e.equipe.lider,
      equipe: e.equipe.equipe,
    },
    loteId: e.loteId,
    data: e.dia,
    origem: ORIGEM_DO_ENVIO,
  };
}

/** A resposta do POST: o `preservados` que o Eduardo citou (número, lista ou contagens por tipo). Opcional: sem ele, `null`. */
export function lerRespostaDoEnvio(body: unknown): RespostaDoEnvio {
  const p = objeto(body)?.preservados;
  if (typeof p === "number" && Number.isFinite(p)) return { preservados: p };
  if (Array.isArray(p)) return { preservados: p.length };
  const contagens = objeto(p);
  if (contagens) {
    const soma = Object.values(contagens).reduce<number>(
      (s, v) => s + (typeof v === "number" && Number.isFinite(v) ? v : 0),
      0,
    );
    return { preservados: soma };
  }
  return { preservados: null };
}
