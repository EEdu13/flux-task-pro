import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";

/* Bloco 1 da saída do navegador: perfis e preferências.
 *
 * É o menor dos seis de propósito. Pouco dado, nenhuma dependência, e serve
 * para acertar de uma vez o formato que os outros cinco vão copiar:
 * identidade pela sessão, escrita idempotente, leitura em uma consulta só.
 *
 * O que é da IAM e o que é do Fluxo:
 *   cargo, hierarquia            ->  IAM, a cada login
 *   pontuação, sequência, avatar ->  aqui, e sobrevive ao relogin
 *   nome, setor                  ->  cópia, reescrita a cada login
 *
 * Sobre a cópia de `nome`, que este comentário antes desaconselhava: o receio
 * era criar uma segunda verdade que envelhece. Ele continua válido para dado
 * que muda sem passar por aqui — mas a alternativa custava mais. Sem nome
 * gravado, o Fluxo não tinha como montar a lista de PESSOAS: cada navegador
 * conhecia só quem tinha logado nele, e ninguém aparecia no Contatos de
 * ninguém. O nome vem da IAM e é reescrito em todo login, então a janela em
 * que ele pode estar velho é o intervalo entre dois acessos da mesma pessoa.
 */

/** Só o que o app grava; o resto da pessoa continua vindo da IAM. */
export type PerfilDoFluxo = {
  pontuacao: number;
  sequencia: number;
  avatar: string | null;
  contatoConfirmado: boolean;
};

/**
 * Grava setor, papel e chefe no perfil.
 *
 * Chamada de dentro do login, no servidor, com o que `buscarColaborador`
 * respondeu — ou seja, com o que está em `dbo.COLABORADORES` e
 * `dbo.COLABORADORES_EXTERNOS`. NÃO é uma server function, e isso é
 * deliberado: se fosse, o navegador poderia chamá-la e se declarar gerente.
 *
 * É por isso que ela vive aqui e não é exportada como rota. A única forma de
 * escrever estes três campos é passando pela IAM.
 */
export async function registrarPerfilFuncional(
  pessoaId: number,
  dados: {
    nome: string | null;
    email: string | null;
    telefone: string | null;
    setorId: string | null;
    papel: string | null;
    supervisorNome: string | null;
  },
): Promise<void> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  await pool
    .request()
    .input("pessoa", sql.Int, pessoaId)
    .input("nome", sql.NVarChar, dados.nome)
    .input("email", sql.NVarChar, dados.email)
    .input("telefone", sql.VarChar, dados.telefone)
    .input("setor", sql.NVarChar, dados.setorId)
    .input("papel", sql.NVarChar, dados.papel)
    .input("chefe", sql.NVarChar, dados.supervisorNome)
    .query(
      `INSERT INTO gestor.perfis (pessoa_id)
       SELECT @pessoa
        WHERE NOT EXISTS (SELECT 1 FROM gestor.perfis WHERE pessoa_id=@pessoa);

       UPDATE gestor.perfis
          SET nome            = COALESCE(@nome, nome),
              email           = COALESCE(@email, email),
              telefone        = COALESCE(@telefone, telefone),
              setor           = COALESCE(@setor, setor),
              papel           = COALESCE(@papel, papel),
              supervisor_nome = COALESCE(@chefe, supervisor_nome),
              atualizado_em   = SYSDATETIMEOFFSET()
        WHERE pessoa_id=@pessoa;`,
    );
}

/**
 * Quem é quem, para decidir visibilidade.
 *
 * Uso interno do servidor — nunca vai para o cliente. `listarTarefas` chama
 * isto para saber se filtra por pessoa ou por setor.
 */
export async function papelEsetor(
  pessoaId: number,
): Promise<{ papel: string; setor: string | null }> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("pessoa", sql.Int, pessoaId)
    .query(`SELECT papel, setor FROM gestor.perfis WHERE pessoa_id=@pessoa`);
  const l = r.recordset[0] as { papel: string | null; setor: string | null } | undefined;
  // Sem papel registrado, cai na regra mais restrita. Quem nunca passou por um
  // login que resolveu o perfil funcional vê só o que é dela.
  return { papel: l?.papel ?? "adm", setor: l?.setor ?? null };
}

/**
 * Traz o perfil de quem está logado, criando a linha na primeira vez.
 *
 * Sobre a corrida, e por que o `IF NOT EXISTS` sozinho não resolve: duas
 * execuções simultâneas passam as duas pelo teste antes de qualquer uma
 * inserir, e a segunda esbarra na chave primária. Isso não depende de abas —
 * o app roda numa janela só, no Tauri. Acontece com dois componentes montando
 * ao mesmo tempo, ou com o login disparando enquanto uma sondagem já rodou.
 *
 * A saída aqui não é travar a tabela, é aceitar a colisão: quem chega depois
 * recebe o erro 2627 da chave primária, e isso significa que a linha existe —
 * que é exatamente o que queríamos. O `SELECT` seguinte devolve a mesma coisa
 * para os dois. Um lock custaria mais do que o problema.
 */
export const meuPerfil = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<PerfilDoFluxo> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    try {
      await pool
        .request()
        .input("pessoa", sql.Int, eu)
        .query(
          `INSERT INTO gestor.perfis (pessoa_id)
           SELECT @pessoa
            WHERE NOT EXISTS (SELECT 1 FROM gestor.perfis WHERE pessoa_id=@pessoa)`,
        );
    } catch (e) {
      // 2627 = violação de chave primária, 2601 = índice único. Os dois querem
      // dizer "alguém criou primeiro", que aqui é sucesso. Qualquer outro erro
      // segue subindo.
      const n = (e as { number?: number })?.number;
      if (n !== 2627 && n !== 2601) throw e;
    }

    const r = await pool
      .request()
      .input("pessoa", sql.Int, eu)
      .query(
        `SELECT pontuacao, sequencia, avatar, contato_confirmado
           FROM gestor.perfis WHERE pessoa_id=@pessoa`,
      );
    const linha = r.recordset[0] as {
      pontuacao: number;
      sequencia: number;
      avatar: string | null;
      contato_confirmado: boolean;
    };
    return {
      pontuacao: linha.pontuacao,
      sequencia: linha.sequencia,
      avatar: linha.avatar,
      contatoConfirmado: !!linha.contato_confirmado,
    };
  }),
);

export type PessoaDoQuadro = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  funcao: string | null;
  setor: string | null;
  papel: string | null;
  supervisorNome: string | null;
  pontuacao: number;
  sequencia: number;
  avatar: string | null;
};

/**
 * O quadro de pessoas — quem existe no Fluxo, para todo mundo.
 *
 * Até esta função, a lista de pessoas era estado local do navegador: cada
 * máquina conhecia só quem tinha logado nela. O efeito era o Contatos vazio de
 * um lado e do outro, e — pior — o seletor de responsável de uma tarefa nova
 * mostrando só a própria pessoa, o que impedia delegar qualquer coisa.
 *
 * Quem entra: quem já logou pelo menos uma vez E tem nome gravado. O filtro de
 * nome não é decorativo — as linhas criadas antes desta mudança têm `nome`
 * nulo, e um contato sem nome não é contato, é uma linha quebrada na tela.
 * Elas entram sozinhas no próximo login de cada uma.
 *
 * Não há recorte por papel aqui, de propósito. Contatos é lista telefônica: a
 * empresa inteira se enxerga. Quem manda tarefa para quem continua decidido
 * por `visibleUsersForAssign`, e o que cada um LÊ continua decidido no
 * servidor, tarefa a tarefa, por `listarTarefas`.
 *
 * O cargo vem por fora, de `dbo.COLABORADORES` — não é copiado para `perfis`
 * porque muda no RH sem passar por aqui. `OUTER APPLY ... TOP 1` e não JOIN:
 * nome não é chave única naquela tabela, e um JOIN com dois homônimos
 * duplicaria a pessoa na lista.
 */
export const listarPessoas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (): Promise<{ pessoas: PessoaDoQuadro[] }> => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT p.pessoa_id, p.nome, p.email, p.telefone, p.setor, p.papel,
              p.supervisor_nome, p.pontuacao, p.sequencia, p.avatar, c.funcao
         FROM gestor.perfis p
        OUTER APPLY (
          SELECT TOP 1 LTRIM(RTRIM(FUNCAO)) AS funcao
            FROM dbo.COLABORADORES
           WHERE LTRIM(RTRIM(NOME)) COLLATE Latin1_General_CI_AI
                 = p.nome COLLATE Latin1_General_CI_AI
        ) c
        WHERE p.nome IS NOT NULL
        ORDER BY p.nome`,
    );
    return {
      pessoas: (
        r.recordset as {
          pessoa_id: number;
          nome: string;
          email: string | null;
          telefone: string | null;
          setor: string | null;
          papel: string | null;
          supervisor_nome: string | null;
          pontuacao: number;
          sequencia: number;
          avatar: string | null;
          funcao: string | null;
        }[]
      ).map((p) => ({
        id: String(p.pessoa_id),
        nome: p.nome,
        email: p.email,
        telefone: p.telefone,
        funcao: p.funcao,
        setor: p.setor,
        papel: p.papel,
        supervisorNome: p.supervisor_nome,
        pontuacao: p.pontuacao,
        sequencia: p.sequencia,
        avatar: p.avatar,
      })),
    };
  }),
);

/**
 * Grava o que mudou no perfil.
 *
 * `COALESCE(@x, coluna)` deixa o chamador mandar só o campo que mexeu, sem
 * precisar reenviar os outros — e sem risco de zerar a pontuação de alguém por
 * ter esquecido um campo no objeto.
 */
export const salvarMeuPerfil = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (entrada: {
        pontuacao?: number;
        sequencia?: number;
        avatar?: string | null;
        contatoConfirmado?: boolean;
      }) => {
        const inteiro = (v: unknown) =>
          typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;
        return {
          pontuacao: inteiro(entrada?.pontuacao),
          sequencia: inteiro(entrada?.sequencia),
          avatar:
            typeof entrada?.avatar === "string"
              ? entrada.avatar.trim().slice(0, 200) || null
              : null,
          // `undefined` significa "não mexe"; `false` significa "desmarca". Por
          // isso a comparação explícita em vez de um truthy.
          contatoConfirmado:
            typeof entrada?.contatoConfirmado === "boolean" ? entrada.contatoConfirmado : null,
        };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        dados: {
          pontuacao: number | null;
          sequencia: number | null;
          avatar: string | null;
          contatoConfirmado: boolean | null;
        },
      ) => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        await pool
          .request()
          .input("pessoa", sql.Int, eu)
          .input("pontuacao", sql.Int, dados.pontuacao)
          .input("sequencia", sql.Int, dados.sequencia)
          .input("avatar", sql.NVarChar, dados.avatar)
          .input("contato", sql.Bit, dados.contatoConfirmado)
          .query(
            // Mesma ideia do `meuPerfil`: cria se faltar, sem travar a tabela.
            // Aqui a colisão é inofensiva mesmo sem `try` — se as duas execuções
            // inserirem, uma falha e o `UPDATE` da outra já deixou o valor certo.
            `INSERT INTO gestor.perfis (pessoa_id)
             SELECT @pessoa
              WHERE NOT EXISTS (SELECT 1 FROM gestor.perfis WHERE pessoa_id=@pessoa);

             UPDATE gestor.perfis
                SET pontuacao          = COALESCE(@pontuacao, pontuacao),
                    sequencia          = COALESCE(@sequencia, sequencia),
                    avatar             = COALESCE(@avatar, avatar),
                    contato_confirmado = COALESCE(@contato, contato_confirmado),
                    atualizado_em      = SYSDATETIMEOFFSET()
              WHERE pessoa_id=@pessoa;`,
          );
        return { ok: true };
      },
    ),
  );

/* -------------------- Preferências -------------------- */

/**
 * Chaves aceitas.
 *
 * A tabela é (pessoa, chave, valor) — cabe qualquer coisa. Uma lista fechada
 * evita que ela vire depósito: sem isso, a primeira pressa grava um JSON de
 * 400 caracteres aqui e ninguém mais sabe o que a tabela guarda.
 *
 * Note quem NÃO está aqui: menu recolhido e lista de salas aberta continuam no
 * navegador. São preferências de tela, por máquina — quem usa um monitor grande
 * no escritório e um notebook em casa quer os dois diferentes.
 */
const CHAVES = ["tema", "paleta"] as const;
type Chave = (typeof CHAVES)[number];
const chaveValida = (v: unknown): v is Chave =>
  typeof v === "string" && (CHAVES as readonly string[]).includes(v);

export const minhasPreferencias = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<Record<string, string>> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("pessoa", sql.Int, eu)
      .query(`SELECT chave, valor FROM gestor.preferencias WHERE pessoa_id=@pessoa`);
    const saida: Record<string, string> = {};
    for (const l of r.recordset as { chave: string; valor: string }[]) saida[l.chave] = l.valor;
    return saida;
  }),
);

export const salvarPreferencia = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((entrada: { chave: string; valor: string }) => {
      if (!chaveValida(entrada?.chave)) throw new Error("Preferência desconhecida");
      const valor = typeof entrada?.valor === "string" ? entrada.valor.trim().slice(0, 400) : "";
      if (!valor) throw new Error("Preferência sem valor");
      return { chave: entrada.chave, valor };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { chave: Chave; valor: string }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      // A chave primária é (pessoa_id, chave), então isto é o upsert natural.
      await pool
        .request()
        .input("pessoa", sql.Int, eu)
        .input("chave", sql.NVarChar, dados.chave)
        .input("valor", sql.NVarChar, dados.valor)
        .query(
          `IF EXISTS (SELECT 1 FROM gestor.preferencias WHERE pessoa_id=@pessoa AND chave=@chave)
             UPDATE gestor.preferencias
                SET valor=@valor, atualizada_em=SYSDATETIMEOFFSET()
              WHERE pessoa_id=@pessoa AND chave=@chave;
           ELSE
             INSERT INTO gestor.preferencias (pessoa_id, chave, valor)
             VALUES (@pessoa, @chave, @valor);`,
        );
      return { ok: true };
    }),
  );
