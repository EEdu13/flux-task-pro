// Perfil funcional da pessoa: cargo, setor e hierarquia.
// EXCLUSIVO do servidor — carregue dentro dos handlers.
//
// ATENÇÃO: estas tabelas são de OUTRO sistema e este módulo é SOMENTE LEITURA.
// Só SELECT. Nenhum INSERT/UPDATE/DELETE/ALTER pode entrar aqui.
//
// Duas fontes, porque o quadro está dividido:
//   dbo.COLABORADORES           — 468 efetivos, todos com CPF único
//   dbo.COLABORADORES_EXTERNOS  — 8 externos (estágio, PJ), SEM CPF
//
// Por isso a busca é em duas etapas: CPF primeiro (exato), nome depois (para os
// externos). O nome usa collation CI_AI — ignora maiúsculas e acentos — que é o
// melhor que dá sem uma chave de verdade.

import type { Role } from "@/lib/fluxo-types";

export interface PerfilColaborador {
  nome: string;
  funcao: string | null;
  setor: string | null;
  supervisor: string | null;
  coordenador: string | null;
  origem: "interno" | "externo";
}

/**
 * Quem tem coroa no Fluxo. Decisão de negócio, não derivável dos dados: há
 * coordenadores com centenas de pessoas abaixo que não são gerência da empresa.
 * Confirmado pelo usuário em 2026-08-27.
 */
const GERENTES = ["RODRIGO DLUGOSZ DA SILVA", "ALINE DLUGOSZ DA SILVA", "LEANDRO DLUGOSZ DA SILVA"];

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acentos
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * SETOR/AREA do banco → id de setor do Fluxo.
 *
 * As duas tabelas escrevem diferente: os efetivos usam `SETOR` ("TI"), os
 * externos usam `AREA` ("T.I", com ponto). Por isso a pontuação cai fora antes
 * da comparação — sem isso o mesmo setor viraria dois.
 */
export function setorParaId(bruto: string | null | undefined): string {
  const n = normalizar(bruto ?? "").replace(/[.\-_/]/g, "");
  if (!n) return "sem-setor";
  const mapa: Record<string, string> = {
    CAMPO: "campo",
    GESTAO: "gestao",
    "RECURSOS HUMANOS": "rh",
    RH: "rh",
    PCP: "pcp",
    ADMINISTRATIVO: "administrativo",
    FINANCEIRO: "financeiro",
    QUALIDADE: "qualidade",
    SEGURANCA: "seguranca",
    APOIO: "apoio",
    COMPRAS: "compras",
    TI: "ti",
    MANUTENCAO: "manutencao",
    FROTAS: "frotas",
    CONTROLADORIA: "controladoria",
    DHO: "dho",
    FACILITIES: "facilities",
    OPERACIONAL: "campo",
  };
  return mapa[n] ?? n.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Papel no Fluxo a partir da posição real na hierarquia.
 *
 * Lembrete: `role` no Fluxo define permissão E vira cargo exibido (com coroa em
 * Contatos). Por isso a gerência é lista explícita, e quem chefia alguém vira
 * supervisor — sem promover ninguém "só para dar acesso".
 */
export function papelPelaHierarquia(nome: string, chefiaAlguem: boolean): Role {
  const n = normalizar(nome);
  if (GERENTES.some((g) => normalizar(g) === n)) return "gerente";
  return chefiaAlguem ? "supervisor" : "adm";
}

/**
 * Chefe direto de alguém, para montar a corrente Coordenador → Supervisor → Pessoa.
 *
 * A regra existe porque na tabela muita gente é supervisora de si mesma — o
 * Eduardo, os três Dlugosz, o Toniel. Usar `SUPERVISOR` cru faria essas pessoas
 * apontarem para si, e o Contatos percorre ancestrais em laço: pai igual a si
 * mesmo trava a tela.
 *
 * Então: o supervisor, a menos que seja a própria pessoa — aí sobe para o
 * coordenador. Se o coordenador também for ela, não há chefe (é topo).
 */
export function chefeDireto(p: PerfilColaborador): string | null {
  const eu = normalizar(p.nome);
  const sup = p.supervisor?.trim();
  if (sup && normalizar(sup) !== eu) return sup;
  const coord = p.coordenador?.trim();
  if (coord && normalizar(coord) !== eu) return coord;
  return null;
}

/**
 * O setor de um externo: a `AREA` dele ou, vazia, o setor do supervisor.
 *
 * Quem cadastra o externo no organograma costuma preencher só o supervisor
 * ("pôr na equipe da Liliane") e deixar a `AREA` em branco. Sem este recuo, a
 * pessoa ficava "Sem setor" no Fluxo mesmo estando na equipe de alguém.
 * `ext` é o apelido da linha de `COLABORADORES_EXTERNOS`.
 */
export const SQL_SETOR_DO_EXTERNO = sqlSetorOuDoSupervisor("ext.AREA", "ext.SUPERVISOR");

/**
 * O mesmo recuo para o efetivo: há gente em `COLABORADORES` com `SETOR` vazio
 * (a Elisama, analista contábil do Paulo, 07/10/2026). `col` é o apelido.
 */
export const SQL_SETOR_DO_INTERNO = sqlSetorOuDoSupervisor("col.SETOR", "col.SUPERVISOR");

function sqlSetorOuDoSupervisor(setor: string, supervisor: string): string {
  return `COALESCE(NULLIF(LTRIM(RTRIM(${setor})), ''),
    (SELECT TOP 1 NULLIF(LTRIM(RTRIM(cs.SETOR)), '') FROM dbo.COLABORADORES cs
      WHERE cs.SITUACAO = '1'
        AND LTRIM(RTRIM(cs.NOME)) COLLATE Latin1_General_CI_AI
          = LTRIM(RTRIM(${supervisor})) COLLATE Latin1_General_CI_AI))`;
}

const COL_INTERNO = `
  SELECT TOP 1
    LTRIM(RTRIM(col.NOME)) AS nome, LTRIM(RTRIM(col.FUNCAO)) AS funcao,
    ${SQL_SETOR_DO_INTERNO} AS setor, LTRIM(RTRIM(col.SUPERVISOR)) AS supervisor,
    LTRIM(RTRIM(col.COORDENADOR)) AS coordenador
  FROM dbo.COLABORADORES col`;

const COL_EXTERNO = `
  SELECT TOP 1
    LTRIM(RTRIM(ext.NOME)) AS nome, LTRIM(RTRIM(ext.FUNCAO)) AS funcao,
    ${SQL_SETOR_DO_EXTERNO} AS setor, LTRIM(RTRIM(ext.SUPERVISOR)) AS supervisor,
    LTRIM(RTRIM(ext.COORDENADOR)) AS coordenador
  FROM dbo.COLABORADORES_EXTERNOS ext`;

/** Busca o perfil por CPF (efetivos) e, se não achar, por nome (externos). */
export async function buscarColaborador(
  cpf: string | null,
  nome: string,
): Promise<PerfilColaborador | null> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();

  const cpfLimpo = (cpf ?? "").replace(/\D+/g, "");
  if (cpfLimpo.length === 11) {
    const r = await pool
      .request()
      .input("cpf", sql.VarChar, cpfLimpo)
      .query(`${COL_INTERNO} WHERE REPLACE(REPLACE(col.CPF,'.',''),'-','') = @cpf AND col.SITUACAO = '1'`);
    const row = r.recordset[0];
    if (row) return { ...row, origem: "interno" as const };
  }

  // Externos não têm CPF; sobra o nome. CI_AI ignora caixa e acento.
  const r2 = await pool
    .request()
    .input("nome", sql.NVarChar, nome.trim())
    .query(
      `${COL_EXTERNO}
        WHERE LTRIM(RTRIM(ext.NOME)) COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI
          AND ext.ATIVO = 1`,
    );
  const row2 = r2.recordset[0];
  if (row2) return { ...row2, origem: "externo" as const };

  return null;
}

/** Esta pessoa é citada como supervisor ou coordenador de alguém? */
/**
 * O cargo é de chefia? SUPERVISOR, COORDENADOR ou GERENTE no começo da função.
 *
 * Existe porque há chefe sem ninguém cadastrado abaixo dele no organograma —
 * o João Paulo, supervisor de controladoria (08/10/2026) — e a regra só pela
 * hierarquia o deixava como "ADM (Colaborador)". O papel do Fluxo não vem da
 * IAM: trocar lá tiraria funções dele no apontamento.
 */
export function cargoDeChefia(funcao: string | null | undefined): boolean {
  return /^(SUPERVISOR|SUPERVISORA|COORDENADOR|COORDENADORA|GERENTE)/.test(normalizar(funcao ?? ""));
}

export async function chefiaAlguem(nome: string): Promise<boolean> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("nome", sql.NVarChar, nome.trim())
    .query(
      /* Os externos também: estagiário e PJ têm supervisor, e quem os chefia
         é chefe do mesmo jeito. */
      `SELECT TOP 1 1 AS ok FROM dbo.COLABORADORES
        WHERE (SUPERVISOR COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI
            OR COORDENADOR COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI)
          AND LTRIM(RTRIM(NOME)) COLLATE Latin1_General_CI_AI <> @nome COLLATE Latin1_General_CI_AI
       UNION ALL
       SELECT TOP 1 1 FROM dbo.COLABORADORES_EXTERNOS
        WHERE ATIVO = 1
          AND (SUPERVISOR COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI
            OR COORDENADOR COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI)
          AND LTRIM(RTRIM(NOME)) COLLATE Latin1_General_CI_AI <> @nome COLLATE Latin1_General_CI_AI`,
    );
  return r.recordset.length > 0;
}
