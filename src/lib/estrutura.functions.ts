import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";
import { diaValido } from "@/lib/estrutura-datas";
import {
  statusDaPessoa,
  statusDoVeiculo,
  type Candidatos,
  type CobrancaDaEquipe,
  type DiaDaSemana,
  type EquipesDaPessoa,
  type EstruturaDoDia,
  type MarcaDePessoa,
  type MarcaDeVeiculo,
  type PedidoDeAdicao,
  type PedidoDeEnvio,
  type PessoaDaEquipe,
  type ResultadoDaAdicao,
  type ResultadoDoEnvio,
  type TipoDeCandidato,
  type VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";

/* A estrutura do dia (Parte A, spec de 04/11/2026): as funções de servidor.
 *
 * O CONECTA NÃO grava no banco: cada função chama a API do PWA de apontamento
 * com o token da IAM da própria pessoa (ver `estrutura.server.ts`). Todas
 * recusam quando a estrutura não está aberta para quem chama, e as que mexem em
 * uma equipe conferem que ela é de quem chama ANTES de ler qualquer coisa.
 *
 * Os erros chegam à tela como `ErroDaEstrutura` com `motivo` (ver
 * `estrutura-tipos.ts`): a tela decide pelo motivo, nunca pelo texto. */

/* ---------------------------- Validadores ---------------------------- */

const EQUIPE = /^[0-9A-Z]{2,16}$/;
const MAX_ITENS = 300;

const equipe = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  if (!EQUIPE.test(s)) throw new Error("Equipe inválida");
  return s;
};

const dia = (v: unknown): string => {
  if (!diaValido(v)) throw new Error("Dia inválido (use AAAA-MM-DD)");
  return v;
};

const marcasDePessoas = (v: unknown): MarcaDePessoa[] => {
  if (!Array.isArray(v) || v.length > MAX_ITENS) throw new Error("Lista de pessoas inválida");
  const vistos = new Set<number>();
  return v.map((item) => {
    const o = (item ?? {}) as { id?: unknown; status?: unknown };
    const id = Number(o.id);
    if (!Number.isInteger(id) || id === 0) throw new Error("Pessoa inválida");
    if (vistos.has(id)) throw new Error("Pessoa repetida");
    vistos.add(id);
    const status = typeof o.status === "string" ? statusDaPessoa(o.status) : null;
    if (!status) throw new Error("Status de pessoa inválido");
    return { id, status };
  });
};

const marcasDeVeiculos = (v: unknown): MarcaDeVeiculo[] => {
  if (!Array.isArray(v) || v.length > MAX_ITENS) throw new Error("Lista de veículos inválida");
  const vistos = new Set<string>();
  return v.map((item) => {
    const o = (item ?? {}) as { prefixo?: unknown; status?: unknown };
    const prefixo = typeof o.prefixo === "string" ? o.prefixo.trim() : "";
    if (!prefixo || prefixo.length > 40) throw new Error("Veículo inválido");
    const chave = prefixo.toUpperCase();
    if (vistos.has(chave)) throw new Error("Veículo repetido");
    vistos.add(chave);
    const status = typeof o.status === "string" ? statusDoVeiculo(o.status) : null;
    if (!status) throw new Error("Status de veículo inválido");
    return { prefixo, status };
  });
};

const idsDeRetirada = (v: unknown): number[] => {
  if (!Array.isArray(v) || v.length > MAX_ITENS) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
};

/** Os prefixos que o popup de retirada mostrou: aparados, em maiúsculas e sem repetidos. O servidor confere com os marcados. */
const prefixosDeRetirada = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > MAX_ITENS) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const p = item.trim().toUpperCase();
    if (p && p.length <= 40 && !out.includes(p)) out.push(p);
  }
  return out;
};

/** Ids positivos, sem repetidos, no máximo 100: o servidor confere um a um depois. */
const idsPositivos = (v: unknown): number[] => {
  if (!Array.isArray(v) || v.length > 100) return [];
  const out: number[] = [];
  for (const item of v) {
    const n = Number(item);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
};

/* ---------------------------- Operações ---------------------------- */

/**
 * As equipes de quem chama. `aberta: false` quando a estrutura não está aberta
 * para a pessoa: a tela esconde menu, card e lembrete sem barulho. Nunca é erro.
 */
export const minhasEquipesDeEstrutura = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { fresco?: boolean }) => ({ fresco: e?.fresco === true })))
  .handler(
    comSessao(async (eu, dados): Promise<EquipesDaPessoa> => {
      const s = await import("@/lib/estrutura.server");
      // `fresco` = a tela abriu para apontar: confere com o PWA agora.
      return s.minhasEquipes(eu, dados);
    }),
  );

/** Pessoas (CPF mascarado) e veículos da equipe. */
export const pessoasEFrotaDaEquipe = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { equipe: string }) => ({ equipe: equipe(e.equipe) })))
  .handler(
    comSessao(
      async (eu, dados): Promise<{ pessoas: PessoaDaEquipe[]; veiculos: VeiculoDaEquipe[] }> => {
        const s = await import("@/lib/estrutura.server");
        return s.pessoasEFrota(eu, dados.equipe);
      },
    ),
  );

/** Segunda a sexta da semana de `dia`: enviado, pendente, folga, não cobrado ou futuro. */
export const semanaDaEquipe = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { equipe: string; dia: string }) => ({
      equipe: equipe(e.equipe),
      dia: dia(e.dia),
    })),
  )
  .handler(
    comSessao(async (eu, dados): Promise<{ dias: DiaDaSemana[] }> => {
      const s = await import("@/lib/estrutura.server");
      return { dias: await s.semanaDaEquipe(eu, dados.equipe, dados.dia) };
    }),
  );

/** O que foi enviado para um dia, casado com a lista de hoje. */
export const estruturaDoDia = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { equipe: string; dia: string }) => ({
      equipe: equipe(e.equipe),
      dia: dia(e.dia),
    })),
  )
  .handler(
    comSessao(async (eu, dados): Promise<EstruturaDoDia> => {
      const s = await import("@/lib/estrutura.server");
      return s.estruturaDoDia(eu, dados.equipe, dados.dia);
    }),
  );

/** O último dia enviado antes de `dia` (até 7 dias atrás), para o "Repetir último dia". */
export const ultimaEstruturaDaEquipe = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { equipe: string; dia: string }) => ({
      equipe: equipe(e.equipe),
      dia: dia(e.dia),
    })),
  )
  .handler(
    comSessao(
      async (eu, dados): Promise<{ achada: { dia: string; estrutura: EstruturaDoDia } | null }> => {
        const s = await import("@/lib/estrutura.server");
        return { achada: await s.ultimaEstruturaAntes(eu, dados.equipe, dados.dia) };
      },
    ),
  );

/** O envio. Com o envio desligado, é uma simulação (ver `ENVIO_REAL_LIGADO`). */
export const enviarEstrutura = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        equipe: string;
        dia: string;
        pessoas: MarcaDePessoa[];
        veiculos: MarcaDeVeiculo[];
        confirmacao?: {
          madrugada?: boolean;
          reenvio?: boolean;
          retirados?: number[];
          retiradosVeiculos?: string[];
        };
      }): PedidoDeEnvio => ({
        equipe: equipe(e.equipe),
        dia: dia(e.dia),
        pessoas: marcasDePessoas(e.pessoas),
        veiculos: marcasDeVeiculos(e.veiculos),
        confirmacao: {
          madrugada: e.confirmacao?.madrugada === true,
          reenvio: e.confirmacao?.reenvio === true,
          retirados: idsDeRetirada(e.confirmacao?.retirados),
          retiradosVeiculos: prefixosDeRetirada(e.confirmacao?.retiradosVeiculos),
        },
      }),
    ),
  )
  .handler(
    comSessao(async (eu, dados): Promise<ResultadoDoEnvio> => {
      const s = await import("@/lib/estrutura.server");
      return s.enviar(eu, dados);
    }),
  );

/** A situação de HOJE de cada equipe de quem chama: o que o card do Início e o lembrete do Pack leem. */
export const cobrancaDaEstrutura = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ equipes: CobrancaDaEquipe[] }> => {
    const s = await import("@/lib/estrutura.server");
    return { equipes: await s.cobrancaDeHoje(eu) };
  }),
);

/**
 * Quem está SEM EQUIPE e pode ser puxado para a equipe: as pessoas efetivas da coordenação dela
 * (CPF mascarado) ou os veículos do projeto dela. Só para quem é da equipe de destino.
 */
export const candidatosDaEquipe = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { equipe: string; tipo: TipoDeCandidato }) => {
      if (e.tipo !== "pessoas" && e.tipo !== "veiculos") throw new Error("Tipo inválido");
      return { equipe: equipe(e.equipe), tipo: e.tipo };
    }),
  )
  .handler(
    comSessao(async (eu, dados): Promise<Candidatos> => {
      const s = await import("@/lib/estrutura.server");
      return s.candidatosParaEquipe(eu, dados.equipe, dados.tipo);
    }),
  );

/**
 * Puxa para a equipe quem o líder escolheu (o espelho da retirada). Muda quem é da equipe no
 * PWA: só liga com `ADICIONAR_NA_EQUIPE_LIGADO`.
 */
export const adicionarNaEquipe = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: { equipe: string; pessoas?: number[]; veiculos?: number[] }): PedidoDeAdicao => ({
        equipe: equipe(e.equipe),
        pessoas: idsPositivos(e.pessoas),
        veiculos: idsPositivos(e.veiculos),
      }),
    ),
  )
  .handler(
    comSessao(async (eu, dados): Promise<ResultadoDaAdicao> => {
      const s = await import("@/lib/estrutura.server");
      return s.adicionar(eu, dados);
    }),
  );
