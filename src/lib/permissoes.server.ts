/*
 * Quem pode o quê — a fechadura do servidor.
 *
 * A tela sempre escondeu os botões de quem não podia, e o servidor não
 * conferia nada: qualquer pessoa logada regravava qualquer tarefa pelo id
 * (título e pontos inclusive), apagava anexo, projeto e modelo de pack de
 * qualquer um e definia a meta de qualquer setor. Esconder botão é conforto;
 * a regra de verdade mora aqui, e as telas seguem a mesma (ver `permissoes.ts`).
 *
 * Três papéis contam, do mesmo jeito em todo lugar:
 *   - a gerência pode tudo;
 *   - o dono pode o que é seu (na tarefa, quem a criou);
 *   - o supervisor pode o que é da equipe dele — é o chefe direto de quem
 *     criou ou de quem é responsável. Decisão do usuário, 30/09/2026: o
 *     supervisor precisa mexer inclusive nas tarefas dos subordinados, para
 *     incluir algo em que ele pensou.
 *
 * "Chefe direto" é o nome gravado em `perfis.supervisor_nome`, vindo de
 * `dbo.COLABORADORES` a cada login — o mesmo dado com que a tela monta a
 * equipe. É por nome porque é o que existe; sem acento e sem caixa, para o
 * "JOÃO" do RH casar com o "João" da IAM.
 *
 * Arquivo `.server.ts`: só o servidor importa. O SQL daqui é montado com
 * trechos fixos deste arquivo, nunca com valor vindo de fora — os ids entram
 * sempre como parâmetro.
 */

/** Declara @gerente, @papel_eu, @setor_eu e @nome_eu a partir de @eu. */
export const SQL_QUEM_SOU = `
  DECLARE @gerente BIT = 0, @papel_eu NVARCHAR(40) = N'adm',
          @setor_eu NVARCHAR(400) = NULL, @nome_eu NVARCHAR(400) = NULL;
  SELECT @papel_eu = COALESCE(papel, N'adm'), @setor_eu = setor, @nome_eu = nome
    FROM gestor.perfis WHERE pessoa_id = @eu;
  SET @gerente = CASE WHEN @papel_eu = N'gerente' THEN 1 ELSE 0 END;`;

/** @eu é o chefe direto de uma destas pessoas (expressões SQL que dão o id). */
export function sqlChefeDe(...pessoas: string[]): string {
  return `(@nome_eu IS NOT NULL AND EXISTS (
    SELECT 1 FROM gestor.perfis sub
     WHERE sub.pessoa_id IN (${pessoas.join(", ")})
       AND LTRIM(RTRIM(sub.supervisor_nome)) COLLATE Latin1_General_CI_AI
         = LTRIM(RTRIM(@nome_eu)) COLLATE Latin1_General_CI_AI))`;
}

/**
 * Mexe no conteúdo da tarefa `t` — título, descrição, pontos e "exigir
 * comprovante" — e a exclui: quem criou, o chefe de quem criou ou de quem é
 * responsável, e a gerência.
 */
export const SQL_CONTEUDO_DA_TAREFA = `(@gerente = 1 OR t.criado_por = @eu
  OR ${sqlChefeDe("t.criado_por", "t.responsavel_id")})`;

/**
 * Vê a tarefa `t` e mexe no dia a dia dela (situação, prazo, responsável,
 * checklist, comentário). A regra da listagem — gerência, o próprio setor,
 * quem criou e quem é responsável —, mais quem foi mencionado e a chefia.
 */
export const SQL_VE_A_TAREFA = `(${SQL_CONTEUDO_DA_TAREFA} OR t.responsavel_id = @eu
  OR (@setor_eu IS NOT NULL AND t.setor = @setor_eu)
  OR EXISTS (SELECT 1 FROM gestor.mencoes m WHERE m.tarefa_id = t.id AND m.pessoa_id = @eu))`;

/** Mexe no projeto `p` (nome, situação, foto…) e o apaga: dono, chefe do dono, gerência. */
export const SQL_CONTEUDO_DO_PROJETO = `(@gerente = 1 OR p.dono_id = @eu OR ${sqlChefeDe("p.dono_id")})`;

const bit = (condicao: string) => `CASE WHEN ${condicao} THEN 1 ELSE 0 END`;

async function consultar<T>(
  eu: number,
  parametros: Record<string, { tipo: "guid" | "int" | "texto"; valor: unknown }>,
  corpo: string,
): Promise<T | undefined> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const req = pool.request().input("eu", sql.Int, eu);
  for (const [nome, p] of Object.entries(parametros)) {
    const tipo =
      p.tipo === "guid" ? sql.UniqueIdentifier : p.tipo === "int" ? sql.Int : sql.NVarChar(400);
    req.input(nome, tipo, p.valor);
  }
  const r = await req.query(`${SQL_QUEM_SOU}\n${corpo}`);
  return r.recordset[0] as T | undefined;
}

export type PermissaoNaTarefa = {
  /** A tarefa existe (arquivada ou não). */
  existe: boolean;
  /** Ver e mexer no dia a dia. */
  ver: boolean;
  /** Título, descrição, pontos, "exigir comprovante" — e excluir. */
  conteudo: boolean;
};

export async function permissaoNaTarefa(eu: number, tarefaId: string): Promise<PermissaoNaTarefa> {
  const l = await consultar<{ ver: number; conteudo: number }>(
    eu,
    { t: { tipo: "guid", valor: tarefaId } },
    `SELECT ${bit(SQL_VE_A_TAREFA)} AS ver, ${bit(SQL_CONTEUDO_DA_TAREFA)} AS conteudo
       FROM gestor.tarefas t WHERE t.id = @t;`,
  );
  return { existe: !!l, ver: !!l?.ver, conteudo: !!l?.conteudo };
}

/**
 * Anexo: quem enviou pode tudo com ele. Fora isso, vale o dono do anexo —
 * a tarefa (direto ou pelo comentário), a conversa ou o projeto.
 *
 * O anexo de projeto é legível por todo mundo logado porque o projeto é: a
 * lista de projetos não tem recorte, e a foto dele aparece no selo das
 * subtarefas de quem nem é membro.
 */
export async function permissaoNoAnexo(
  eu: number,
  anexoId: string,
): Promise<{ existe: boolean; ver: boolean; remover: boolean }> {
  const tarefaDoAnexo = (condicao: string) => `ISNULL((
      SELECT ${bit(condicao)} FROM gestor.tarefas t
       WHERE t.id = CASE WHEN a.dono_tipo = 'tarefa' THEN a.dono_id
                         ELSE (SELECT c.tarefa_id FROM gestor.comentarios c WHERE c.id = a.dono_id) END), 0)`;
  const l = await consultar<{ ver: number; remover: number }>(
    eu,
    { a: { tipo: "guid", valor: anexoId } },
    `SELECT
       CASE WHEN a.enviado_por = @eu THEN 1
            WHEN a.dono_tipo IN ('tarefa', 'comentario') THEN ${tarefaDoAnexo(SQL_VE_A_TAREFA)}
            WHEN a.dono_tipo = 'mensagem' THEN ISNULL((
              SELECT ${bit("m.de_pessoa_id = @eu OR m.para_pessoa_id = @eu")}
                FROM gestor.mensagens m WHERE m.id = a.dono_id), 0)
            WHEN a.dono_tipo = 'projeto' THEN 1
            ELSE 0 END AS ver,
       CASE WHEN a.enviado_por = @eu THEN 1
            WHEN a.dono_tipo IN ('tarefa', 'comentario') THEN ${tarefaDoAnexo(SQL_CONTEUDO_DA_TAREFA)}
            WHEN a.dono_tipo = 'projeto' THEN ISNULL((
              SELECT ${bit(SQL_CONTEUDO_DO_PROJETO)}
                FROM gestor.projetos p WHERE p.id = a.dono_id), 0)
            ELSE 0 END AS remover
       FROM gestor.anexos a WHERE a.id = @a;`,
  );
  return { existe: !!l, ver: !!l?.ver, remover: !!l?.remover };
}

/**
 * Enxerga o dono de anexos — a tarefa, o comentário, a conversa ou o projeto.
 * Vale para listar os anexos de alguma coisa e para anexar nela.
 */
export async function podeVerDonoDeAnexo(eu: number, tipo: string, id: string): Promise<boolean> {
  const l = await consultar<{ pode: number }>(
    eu,
    { tipo: { tipo: "texto", valor: tipo }, dono: { tipo: "guid", valor: id } },
    `SELECT CASE
       WHEN @tipo = N'tarefa' THEN ISNULL((
         SELECT ${bit(SQL_VE_A_TAREFA)} FROM gestor.tarefas t WHERE t.id = @dono), 0)
       WHEN @tipo = N'comentario' THEN ISNULL((
         SELECT ${bit(SQL_VE_A_TAREFA)} FROM gestor.comentarios c
           JOIN gestor.tarefas t ON t.id = c.tarefa_id WHERE c.id = @dono), 0)
       WHEN @tipo = N'mensagem' THEN ISNULL((
         SELECT ${bit("m.de_pessoa_id = @eu OR m.para_pessoa_id = @eu")}
           FROM gestor.mensagens m WHERE m.id = @dono), 0)
       WHEN @tipo = N'projeto' THEN 1
       ELSE 0 END AS pode;`,
  );
  return !!l?.pode;
}

/** Projeto: o conteúdo é do dono, do chefe dele e da gerência; os membros cuidam da lista de membros. */
export async function permissaoNoProjeto(
  eu: number,
  projetoId: string,
): Promise<{ existe: boolean; conteudo: boolean; membro: boolean }> {
  const l = await consultar<{ conteudo: number; membro: number }>(
    eu,
    { p: { tipo: "guid", valor: projetoId } },
    `SELECT ${bit(SQL_CONTEUDO_DO_PROJETO)} AS conteudo,
            ${bit("EXISTS (SELECT 1 FROM gestor.projeto_membros pm WHERE pm.projeto_id = p.id AND pm.pessoa_id = @eu)")} AS membro
       FROM gestor.projetos p WHERE p.id = @p;`,
  );
  return { existe: !!l, conteudo: !!l?.conteudo, membro: !!l?.membro };
}

/** Modelo de pack: quem criou, o chefe de quem criou e a gerência. */
export async function podeMexerNoModeloDePack(
  eu: number,
  modeloId: string,
): Promise<{ existe: boolean; pode: boolean }> {
  const l = await consultar<{ pode: number }>(
    eu,
    { m: { tipo: "guid", valor: modeloId } },
    `SELECT ${bit(`@gerente = 1 OR mp.criado_por = @eu OR ${sqlChefeDe("mp.criado_por")}`)} AS pode
       FROM gestor.modelos_de_pack mp WHERE mp.id = @m;`,
  );
  return { existe: !!l, pode: !!l?.pode };
}

/**
 * Meta: a gerência define qualquer uma. O supervisor define a da equipe — a
 * dele e a de quem responde a ele — e a do próprio setor. É a regra que a tela
 * de metas já aplicava; faltava valer aqui.
 */
export async function podeDefinirMeta(
  eu: number,
  escopo: string,
  escopoId: string,
): Promise<boolean> {
  const l = await consultar<{ pode: number }>(
    eu,
    { escopo: { tipo: "texto", valor: escopo }, escopo_id: { tipo: "texto", valor: escopoId } },
    `SELECT ${bit(`@gerente = 1
       OR (@escopo = N'user' AND (${sqlChefeDe("TRY_CONVERT(INT, @escopo_id)")}
            OR (TRY_CONVERT(INT, @escopo_id) = @eu AND @papel_eu = N'supervisor')))
       OR (@escopo = N'sector' AND @papel_eu = N'supervisor' AND @escopo_id = @setor_eu)`)} AS pode;`,
  );
  return !!l?.pode;
}
