import {
  NAO_ESTA_NA_EQUIPE,
  semAcento,
  statusDaPessoa,
  statusDoVeiculo,
  type EstruturaDoDia,
  type MarcaDePessoa,
  type MarcaDeVeiculo,
  type PessoaDaEquipe,
  type VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";

/*
 * As contas das marcas da estrutura, SEM rede e SEM React: o que está marcado,
 * quem falta, "Todos ADM", "Repetir último dia" e o que o envio manda. Tudo
 * devolve um objeto novo (nada é mudado no lugar), para o React ver a mudança e
 * para o "Desfazer" ser guardar o objeto anterior.
 */

export interface Marcas {
  /** id da pessoa → status canônico. Sem entrada = ainda sem marca. */
  pessoas: Record<number, string>;
  /** PREFIXO em maiúsculas → status canônico. */
  veiculos: Record<string, string>;
}

export const SEM_MARCAS: Marcas = { pessoas: {}, veiculos: {} };

const chaveDoVeiculo = (prefixo: string): string => prefixo.trim().toUpperCase();

export const marcaDaPessoa = (m: Marcas, id: number): string | null => m.pessoas[id] ?? null;
export const marcaDoVeiculo = (m: Marcas, prefixo: string): string | null =>
  m.veiculos[chaveDoVeiculo(prefixo)] ?? null;

export function marcarPessoa(m: Marcas, id: number, status: string): Marcas {
  return { ...m, pessoas: { ...m.pessoas, [id]: status } };
}

export function marcarVeiculo(m: Marcas, prefixo: string, status: string): Marcas {
  return { ...m, veiculos: { ...m.veiculos, [chaveDoVeiculo(prefixo)]: status } };
}

/** Quantos itens (pessoas e veículos) ainda não têm marca. Só envia com 0. */
export function quantosFaltam(
  m: Marcas,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[],
): number {
  return (
    pessoas.filter((p) => marcaDaPessoa(m, p.id) === null).length +
    veiculos.filter((v) => marcaDoVeiculo(m, v.prefixo) === null).length
  );
}

/** "Todos ADM": só as pessoas, todas (quem já tinha outra marca também). O "Desfazer" guarda o antes. */
export function todosAdm(m: Marcas, pessoas: readonly PessoaDaEquipe[]): Marcas {
  const novas: Record<number, string> = { ...m.pessoas };
  for (const p of pessoas) novas[p.id] = "ADM";
  return { ...m, pessoas: novas };
}

/** Tira as marcas de quem não está mais na lista (a lista mudou entre uma leitura e outra). */
export function podarMarcas(
  m: Marcas,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[],
): Marcas {
  const ids = new Set(pessoas.map((p) => p.id));
  const prefixos = new Set(veiculos.map((v) => chaveDoVeiculo(v.prefixo)));
  return {
    pessoas: Object.fromEntries(Object.entries(m.pessoas).filter(([id]) => ids.has(Number(id)))),
    veiculos: Object.fromEntries(Object.entries(m.veiculos).filter(([p]) => prefixos.has(p))),
  };
}

/**
 * "Repetir último dia": preenche com o que foi enviado antes, só para quem está
 * na lista de hoje e só com status da lista. NÃO leva a retirada adiante ("NÃO ESTÁ
 * NA EQUIPE" é um ato deliberado de cada dia) nem sobrescreve o que a pessoa já marcou.
 * Devolve quantos itens foram preenchidos.
 */
export function repetirDe(
  m: Marcas,
  anterior: EstruturaDoDia,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[],
): { marcas: Marcas; preenchidos: number } {
  const ids = new Set(pessoas.map((p) => p.id));
  const prefixos = new Set(veiculos.map((v) => chaveDoVeiculo(v.prefixo)));
  let marcas = m;
  let preenchidos = 0;
  for (const x of anterior.pessoas) {
    const status = statusDaPessoa(x.status);
    if (!status || status === NAO_ESTA_NA_EQUIPE || !ids.has(x.id)) continue;
    if (marcaDaPessoa(marcas, x.id) !== null) continue;
    marcas = marcarPessoa(marcas, x.id, status);
    preenchidos++;
  }
  for (const x of anterior.veiculos) {
    const status = statusDoVeiculo(x.status);
    if (!status || status === NAO_ESTA_NA_EQUIPE) continue;
    if (!prefixos.has(chaveDoVeiculo(x.prefixo))) continue;
    if (marcaDoVeiculo(marcas, x.prefixo) !== null) continue;
    marcas = marcarVeiculo(marcas, x.prefixo, status);
    preenchidos++;
  }
  return { marcas, preenchidos };
}

/**
 * "Reenviar / corrigir": as marcas do dia já enviado. O que estava com um status
 * fora da lista fica SEM marca (o envio não passa até a pessoa escolher) e volta
 * em `estavaP` e `estavaV`, para a tela dizer "Estava: X — marque um dos botões".
 */
export function marcasDaEstrutura(
  e: EstruturaDoDia,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[],
): { marcas: Marcas; estavaP: Record<number, string>; estavaV: Record<string, string> } {
  const ids = new Set(pessoas.map((p) => p.id));
  const prefixos = new Set(veiculos.map((v) => chaveDoVeiculo(v.prefixo)));
  let marcas = SEM_MARCAS;
  const estavaP: Record<number, string> = {};
  const estavaV: Record<string, string> = {};
  for (const x of e.pessoas) {
    if (!ids.has(x.id)) continue;
    const status = statusDaPessoa(x.status);
    if (status) marcas = marcarPessoa(marcas, x.id, status);
    else estavaP[x.id] = x.status;
  }
  for (const x of e.veiculos) {
    if (!prefixos.has(chaveDoVeiculo(x.prefixo))) continue;
    const status = statusDoVeiculo(x.status);
    if (status) marcas = marcarVeiculo(marcas, x.prefixo, status);
    else estavaV[chaveDoVeiculo(x.prefixo)] = x.status;
  }
  return { marcas, estavaP, estavaV };
}

/** O que o envio manda, ou `null` enquanto faltar alguém. */
export function paraEnvio(
  m: Marcas,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[],
): { pessoas: MarcaDePessoa[]; veiculos: MarcaDeVeiculo[] } | null {
  if (quantosFaltam(m, pessoas, veiculos) > 0) return null;
  return {
    pessoas: pessoas.map((p) => ({ id: p.id, status: marcaDaPessoa(m, p.id)! })),
    veiculos: veiculos.map((v) => ({ prefixo: v.prefixo, status: marcaDoVeiculo(m, v.prefixo)! })),
  };
}

/**
 * Quem está marcado NÃO ESTÁ NA EQUIPE. O efetivo é movido para SEM EQUIPE depois
 * do envio; o externo (id negativo) não: para ele o PWA responde success e não
 * faz nada, então ele continua na lista e a tela avisa. O veículo marcado também sai
 * da equipe e volta para o projeto (Eduardo, 10/11/2026), para não repetir todo dia.
 */
export function aSeremRetirados(
  m: Marcas,
  pessoas: readonly PessoaDaEquipe[],
  veiculos: readonly VeiculoDaEquipe[] = [],
): { efetivos: PessoaDaEquipe[]; externos: PessoaDaEquipe[]; veiculos: VeiculoDaEquipe[] } {
  const marcados = pessoas.filter((p) => marcaDaPessoa(m, p.id) === NAO_ESTA_NA_EQUIPE);
  return {
    efetivos: marcados.filter((p) => !p.externo),
    externos: marcados.filter((p) => p.externo),
    veiculos: veiculos.filter((v) => marcaDoVeiculo(m, v.prefixo) === NAO_ESTA_NA_EQUIPE),
  };
}

/** Os veículos por tipo, para a tela agrupar. Tipo vazio vira "Outros", e vai por último. */
export function agruparVeiculos(
  veiculos: readonly VeiculoDaEquipe[],
): { tipo: string; veiculos: VeiculoDaEquipe[] }[] {
  const grupos = new Map<string, VeiculoDaEquipe[]>();
  for (const v of veiculos) {
    const tipo = v.tipo.trim() || "Outros";
    grupos.set(tipo, [...(grupos.get(tipo) ?? []), v]);
  }
  const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === "Outros" ? 1 : b === "Outros" ? -1 : porNome(a, b)))
    .map(([tipo, lista]) => ({
      tipo,
      veiculos: [...lista].sort((a, b) => porNome(a.prefixo, b.prefixo)),
    }));
}

/**
 * Quem está logado começa como ADM: só pelo nome normalizado, e só se bater
 * EXATAMENTE uma pessoa da lista. É comodidade, nunca autorização.
 */
export function idDoLogado(
  pessoas: readonly PessoaDaEquipe[],
  nomeDoLogado: string,
): number | null {
  const alvo = semAcento(nomeDoLogado);
  if (!alvo) return null;
  const iguais = pessoas.filter((p) => semAcento(p.nome) === alvo);
  return iguais.length === 1 ? iguais[0]!.id : null;
}
