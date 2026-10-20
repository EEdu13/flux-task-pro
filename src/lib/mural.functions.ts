import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";
import { emojiValido } from "@/lib/reacoes.functions";

/* Mural — o feed de notícias da empresa (pedido do usuário, 14/10/2026):
 * "colocar um feed de notícias depois do Início, permitir publicarem notícias,
 * aniversariantes da semana/do mês… divertido mas sem atrapalhar a essência
 * do sistema".
 *
 * O que cada um pode:
 *   - qualquer pessoa logada publica texto (com até 4 fotos), comenta e reage;
 *   - comunicado oficial: só a gerência e o RH (setor "rh") publicam; só a
 *     gerência fixa no topo; avisa todo mundo na sineta; tem "Li e estou
 *     ciente", e o autor (e a gerência) vê quem leu e quem falta;
 *   - o autor edita e exclui o que é seu; a gerência exclui qualquer coisa.
 *     Excluir é marcar `excluido_em` — nada some do banco.
 *   - post comum NUNCA avisa ninguém, a não ser a pessoa marcada com @.
 *
 * Fases 2 e 3 (14/10/2026): tipos de post (do campo, evento, enquete, elogio,
 * conquista automática), filtros no feed, @ em comentário, editar fotos. As
 * conquistas nascem num lote diário (`mural-lote.server.ts`); votar, "vou
 * participar", tirar foto e a escolha de aparecer nas conquistas estão em
 * `mural-interacoes.functions.ts`.
 *
 * Cuidado com o banco (o Azure compartilhado já bateu no teto de DTU):
 *   - o feed vem de 20 em 20, por chave (criado_em, id), numa ida só ao banco
 *     com todos os pedaços (fotos, reações, 2 últimos comentários, leituras);
 *   - a primeira página é igual para todo mundo, então fica guardada por 15 s
 *     para todos (`compartilhado`) e é esquecida a cada gravação;
 *   - aniversários e tempo de casa saem do banco uma vez por dia por servidor.
 *
 * Tabelas: db/migracoes/2026-10-14-mural.sql. Enquanto a migração não roda,
 * as leituras respondem `ativo: false` e as gravações dão "O mural ainda não
 * foi ativado." — a tela mostra isso em vez de quebrar.
 */

/* -------------------- Tipos que atravessam a rede -------------------- */

export type FotoDoPost = {
  id: string;
  nome: string;
  tipoMime: string;
  tamanho: number;
  url: string;
};
export type ComentarioDoMural = { id: string; autorId: string; texto: string; em: string };
export type ReacaoDoMural = { userId: string; emoji: string };

/**
 * O tipo do post (fases 2 e 3, 14/10/2026). "comunicado" anda junto com a
 * flag `comunicado` da fase 1; "conquista" é sempre automática (autor 0).
 */
export type TipoDePost =
  "geral" | "campo" | "comunicado" | "evento" | "conquista" | "elogio" | "enquete";

/** Os filtros do feed — as fichas no topo do Mural. */
export type FiltroDoMural =
  "tudo" | "comunicado" | "campo" | "evento" | "enquete" | "conquista" | "elogio";

/** O selo de uma conquista automática (o desenho do cartão muda por ele). */
export type SeloDaConquista =
  "pack" | "setor" | "recorde" | "primeira" | "tempo_casa" | "boas_vindas" | "aniversario";

export type OpcaoDaEnquete = { ordem: number; texto: string; votos: number };
export type EnqueteDoPost = {
  opcoes: OpcaoDaEnquete[];
  total: number;
  /** Até quando aceita voto (ISO), se tiver data. */
  fim: string | null;
  /** O autor encerrou, ou a data passou. */
  fechada: boolean;
  /** A opção que QUEM PERGUNTA escolheu (os votos dos outros não saem daqui). */
  meuVoto: number | null;
};
export type EventoDoPost = {
  inicio: string;
  local: string | null;
  /** Quem marcou "Vou participar". */
  participantes: string[];
};

export type PostDoMural = {
  id: string;
  /** "0" nas publicações automáticas (o sistema). */
  autorId: string;
  texto: string;
  comunicado: boolean;
  titulo: string | null;
  fixado: boolean;
  criadoEm: string;
  editadoEm: string | null;
  fotos: FotoDoPost[];
  reacoes: ReacaoDoMural[];
  /** Os 2 comentários mais recentes, em ordem cronológica. */
  comentarios: ComentarioDoMural[];
  totalComentarios: number;
  /** Quem marcou "Li e estou ciente" (só em comunicado). */
  leitores: string[];
  tipo: TipoDePost;
  automatico: boolean;
  selo: SeloDaConquista | null;
  /** Quem o post celebra: os agradecidos de um elogio, o dono da conquista. */
  homenageados: string[];
  /** A tarefa citada num elogio. */
  tarefa: { id: string; titulo: string } | null;
  evento: EventoDoPost | null;
  enquete: EnqueteDoPost | null;
};

export type CursorDoMural = { em: string; id: string };

export type EventoNoPainel = {
  id: string;
  titulo: string;
  inicio: string;
  local: string | null;
  participantes: number;
};

export type PaginaDoMural =
  | {
      ativo: true;
      posts: PostDoMural[];
      /** Comunicados fixados — só na primeira página. */
      fixados: PostDoMural[];
      proximo: CursorDoMural | null;
      /** Quantas pessoas ativas recebem um comunicado (o "M" do "lido por N de M"). */
      destinatarios: number;
      souGerente: boolean;
      possoComunicar: boolean;
    }
  | { ativo: false; souGerente: boolean; possoComunicar: boolean };

export type PessoaNoPainel = { id: string; nome: string };
export type AniversarianteNoPainel = PessoaNoPainel & { dia: number; mes: number };
export type PainelDoMural = {
  /** As tabelas do mural existem (a migração já rodou). */
  ativo: boolean;
  hoje: AniversarianteNoPainel[];
  /** Os próximos 7 dias, sem hoje. */
  semana: AniversarianteNoPainel[];
  /** O resto do mês (inclusive os que já passaram). */
  mes: AniversarianteNoPainel[];
  tempoDeCasa: (PessoaNoPainel & { anos: number; dia: number; jaFez: boolean })[];
  boasVindas: (PessoaNoPainel & { desde: string })[];
  /**
   * O aniversário de quem pergunta: o do RH, ou o que a pessoa escolheu
   * (`origem: "manual"`). null = não há data em lugar nenhum.
   */
  meu: { dia: number; mes: number; mostrar: boolean; origem: "rh" | "manual" } | null;
  /** A data do cadastro do RH, mesmo quando a pessoa escolheu outra. */
  meuRH: { dia: number; mes: number } | null;
  /** Os eventos dos próximos 30 dias (fase 3, 14/10/2026). */
  eventos: EventoNoPainel[];
};

export type LeiturasDoComunicado = {
  lidos: { id: string; nome: string; em: string }[];
  faltam: { id: string; nome: string }[];
};

/* -------------------- Validação -------------------- */

const POR_PAGINA = 20;
const MAX_TEXTO = 4000;
const MAX_COMENTARIO = 1000;
const MAX_MENCOES = 10;
const DIA_MS = 86_400_000;

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const exigirGuid = (v: unknown, oque: string): string => {
  const g = guid(v);
  if (!g) throw new Error(`${oque} inválido`);
  return g;
};
/** Texto do post: tira espaço das pontas e linhas em branco em excesso. */
const limparTexto = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .replace(/\r\n?/g, "\n")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim()
        .slice(0, max)
    : "";

/* -------------------- Quem sou (papel e setor) -------------------- */

/** Gerente e RH, guardado 5 min por pessoa — ver `quemSouNoMural` em mural.server. */
async function quemSouNoMural(eu: number): Promise<{ gerente: boolean; comunica: boolean }> {
  const { quemSouNoMural: perguntar } = await import("@/lib/mural.server");
  return perguntar(eu);
}

const FILTROS: readonly FiltroDoMural[] = [
  "tudo",
  "comunicado",
  "campo",
  "evento",
  "enquete",
  "conquista",
  "elogio",
];
const filtroValido = (v: unknown): FiltroDoMural =>
  typeof v === "string" && (FILTROS as readonly string[]).includes(v)
    ? (v as FiltroDoMural)
    : "tudo";

const TIPOS: readonly TipoDePost[] = [
  "geral",
  "campo",
  "comunicado",
  "evento",
  "conquista",
  "elogio",
  "enquete",
];
const SELOS: readonly SeloDaConquista[] = [
  "pack",
  "setor",
  "recorde",
  "primeira",
  "tempo_casa",
  "boas_vindas",
  "aniversario",
];

/** Lista de ids de pessoa vinda da tela: inteiros positivos, sem repetir. */
const idsDePessoas = (v: unknown, max: number): number[] =>
  Array.isArray(v)
    ? [...new Set(v.map((m) => Number(m)).filter((n) => Number.isInteger(n) && n > 0))].slice(
        0,
        max,
      )
    : [];

/* -------------------- Feed -------------------- */

type LinhaPost = {
  id: string;
  autor_id: number;
  texto: string;
  comunicado: boolean;
  titulo: string | null;
  fixado_em: Date | null;
  criado_em: Date;
  editado_em: Date | null;
  fixo: boolean;
  ordem: number;
  n_coment: number;
  tipo: string;
  automatico: boolean;
  selo: string | null;
  tarefa_id: string | null;
  tarefa_titulo: string | null;
  evento_inicio: Date | null;
  evento_local: string | null;
  enquete_fim: Date | null;
  enquete_fechada_em: Date | null;
};

/**
 * Uma página do feed, numa ida só ao banco. A tabela `@pg` guarda os ids da
 * página (21: o 21º só diz se há próxima); o resto é buscado por ela, cada
 * pedaço numa busca por índice — nada de uma consulta por post.
 *
 * Com filtro (fase 2/3, 14/10/2026), a página sai do índice por tipo
 * (IX_mural_posts_tipo); os comunicados fixados só vêm em "tudo" e em
 * "comunicado". O voto de cada um na enquete NÃO sai daqui: esta página é a
 * mesma para todo mundo (fica guardada) — ver `comMeusVotos`.
 */
async function buscarPagina(cursor: { em: Date; id: string } | null, filtro: FiltroDoMural) {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const req = pool.request();
  if (cursor) {
    req.input("em", sql.DateTimeOffset(3), cursor.em);
    req.input("id", sql.UniqueIdentifier, cursor.id);
  }
  if (filtro !== "tudo") req.input("tipo", sql.NVarChar(12), filtro);
  const comFixados = !cursor && (filtro === "tudo" || filtro === "comunicado");
  const r = await req.query(
    `SET NOCOUNT ON;
     DECLARE @pg TABLE (id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY, ordem INT NOT NULL, fixo BIT NOT NULL);
     INSERT INTO @pg (id, ordem, fixo)
     SELECT TOP (${POR_PAGINA + 1}) p.id, ROW_NUMBER() OVER (ORDER BY p.criado_em DESC, p.id DESC), 0
       FROM gestor.mural_posts p
      WHERE p.excluido_em IS NULL AND p.fixado_em IS NULL
        ${filtro !== "tudo" ? "AND p.tipo = @tipo" : ""}
        ${cursor ? "AND (p.criado_em < @em OR (p.criado_em = @em AND p.id < @id))" : ""}
      ORDER BY p.criado_em DESC, p.id DESC;
     ${
       comFixados
         ? `INSERT INTO @pg (id, ordem, fixo)
            SELECT TOP (5) p.id, ROW_NUMBER() OVER (ORDER BY p.fixado_em DESC), 1
              FROM gestor.mural_posts p
             WHERE p.fixado_em IS NOT NULL AND p.excluido_em IS NULL
             ORDER BY p.fixado_em DESC;`
         : ""
     }

     SELECT p.id, p.autor_id, p.texto, p.comunicado, p.titulo, p.fixado_em, p.criado_em,
            p.editado_em, pg.fixo, pg.ordem, p.tipo, p.automatico, p.selo, p.tarefa_id,
            t.titulo AS tarefa_titulo, p.evento_inicio, p.evento_local, p.enquete_fim,
            p.enquete_fechada_em,
            (SELECT COUNT(*) FROM gestor.mural_comentarios c
              WHERE c.post_id = p.id AND c.excluido_em IS NULL) AS n_coment
       FROM @pg pg JOIN gestor.mural_posts p ON p.id = pg.id
       LEFT JOIN gestor.tarefas t ON t.id = p.tarefa_id
      ORDER BY pg.fixo DESC, pg.ordem;

     SELECT a.id, a.dono_id, a.nome, a.tamanho, a.tipo_mime
       FROM @pg pg JOIN gestor.anexos a ON a.dono_tipo = N'mural' AND a.dono_id = pg.id
      ORDER BY a.enviado_em;

     SELECT r.post_id, r.pessoa_id, r.emoji
       FROM @pg pg JOIN gestor.mural_reacoes r ON r.post_id = pg.id
      ORDER BY r.em;

     SELECT pg.id AS post_id, c.id, c.autor_id, c.texto, c.criado_em
       FROM @pg pg
      CROSS APPLY (SELECT TOP 2 mc.id, mc.autor_id, mc.texto, mc.criado_em
                     FROM gestor.mural_comentarios mc
                    WHERE mc.post_id = pg.id AND mc.excluido_em IS NULL
                    ORDER BY mc.criado_em DESC) c;

     SELECT l.post_id, l.pessoa_id
       FROM @pg pg
       JOIN gestor.mural_posts p ON p.id = pg.id AND p.comunicado = 1
       JOIN gestor.mural_leituras l ON l.post_id = pg.id;

     SELECT h.post_id, h.pessoa_id
       FROM @pg pg JOIN gestor.mural_homenageados h ON h.post_id = pg.id;

     SELECT o.post_id, o.ordem, o.texto,
            (SELECT COUNT(*) FROM gestor.mural_enquete_votos v
              WHERE v.post_id = o.post_id AND v.ordem = o.ordem) AS votos
       FROM @pg pg JOIN gestor.mural_enquete_opcoes o ON o.post_id = pg.id
      ORDER BY o.post_id, o.ordem;

     SELECT e.post_id, e.pessoa_id
       FROM @pg pg JOIN gestor.mural_evento_presencas e ON e.post_id = pg.id
      ORDER BY e.em;`,
  );
  const sets = r.recordsets as unknown as Record<string, unknown>[][];
  const linhas = (sets[0] ?? []) as unknown as LinhaPost[];
  const chave = (v: unknown) => String(v).toUpperCase();
  /** Agrupa um conjunto de linhas pelo post. */
  function porPost<L extends { post_id: string }, V>(conjunto: number, valor: (l: L) => V) {
    const m = new Map<string, V[]>();
    for (const l of (sets[conjunto] ?? []) as unknown as L[]) {
      const k = chave(l.post_id);
      const lista = m.get(k) ?? [];
      lista.push(valor(l));
      m.set(k, lista);
    }
    return m;
  }

  const fotos = new Map<string, FotoDoPost[]>();
  for (const a of (sets[1] ?? []) as {
    id: string;
    dono_id: string;
    nome: string;
    tamanho: number;
    tipo_mime: string;
  }[]) {
    const k = chave(a.dono_id);
    const lista = fotos.get(k) ?? [];
    lista.push({
      id: a.id,
      nome: a.nome,
      tipoMime: a.tipo_mime,
      tamanho: Number(a.tamanho),
      url: `/api/anexo/${a.id}`,
    });
    fotos.set(k, lista);
  }
  const reacoes = porPost(2, (x: { post_id: string; pessoa_id: number; emoji: string }) => ({
    userId: String(x.pessoa_id),
    emoji: x.emoji,
  }));
  const comentarios = new Map<string, ComentarioDoMural[]>();
  for (const c of (sets[3] ?? []) as {
    post_id: string;
    id: string;
    autor_id: number;
    texto: string;
    criado_em: Date;
  }[]) {
    const k = chave(c.post_id);
    const lista = comentarios.get(k) ?? [];
    // Vieram do mais novo para o mais velho; na tela a conversa lê de cima para baixo.
    lista.unshift({
      id: c.id,
      autorId: String(c.autor_id),
      texto: c.texto,
      em: c.criado_em.toISOString(),
    });
    comentarios.set(k, lista);
  }
  const leitores = porPost(4, (l: { post_id: string; pessoa_id: number }) => String(l.pessoa_id));
  const homenageados = porPost(5, (l: { post_id: string; pessoa_id: number }) =>
    String(l.pessoa_id),
  );
  const opcoes = porPost(
    6,
    (l: { post_id: string; ordem: number; texto: string; votos: number }) => ({
      ordem: Number(l.ordem),
      texto: l.texto,
      votos: Number(l.votos),
    }),
  );
  const participantes = porPost(7, (l: { post_id: string; pessoa_id: number }) =>
    String(l.pessoa_id),
  );

  const agora = Date.now();
  const paraPost = (l: LinhaPost): PostDoMural => {
    const k = chave(l.id);
    const tipo = (TIPOS as readonly string[]).includes(l.tipo) ? (l.tipo as TipoDePost) : "geral";
    const ops = opcoes.get(k) ?? [];
    return {
      id: l.id,
      autorId: String(l.autor_id),
      texto: l.texto,
      comunicado: !!l.comunicado,
      titulo: l.titulo,
      fixado: !!l.fixado_em,
      criadoEm: l.criado_em.toISOString(),
      editadoEm: l.editado_em ? l.editado_em.toISOString() : null,
      fotos: fotos.get(k) ?? [],
      reacoes: reacoes.get(k) ?? [],
      comentarios: comentarios.get(k) ?? [],
      totalComentarios: Number(l.n_coment ?? 0),
      leitores: leitores.get(k) ?? [],
      tipo,
      automatico: !!l.automatico,
      selo:
        l.selo && (SELOS as readonly string[]).includes(l.selo)
          ? (l.selo as SeloDaConquista)
          : null,
      homenageados: homenageados.get(k) ?? [],
      tarefa: l.tarefa_id && l.tarefa_titulo ? { id: l.tarefa_id, titulo: l.tarefa_titulo } : null,
      evento:
        tipo === "evento" && l.evento_inicio
          ? {
              inicio: l.evento_inicio.toISOString(),
              local: l.evento_local,
              participantes: participantes.get(k) ?? [],
            }
          : null,
      enquete:
        tipo === "enquete"
          ? {
              opcoes: ops,
              total: ops.reduce((s, o) => s + o.votos, 0),
              fim: l.enquete_fim ? l.enquete_fim.toISOString() : null,
              fechada:
                !!l.enquete_fechada_em || (!!l.enquete_fim && l.enquete_fim.getTime() <= agora),
              meuVoto: null,
            }
          : null,
    };
  };

  const doFeed = linhas.filter((l) => !l.fixo);
  const temMais = doFeed.length > POR_PAGINA;
  const posts = doFeed.slice(0, POR_PAGINA).map(paraPost);
  const ultimo = posts.at(-1);
  return {
    posts,
    fixados: linhas.filter((l) => l.fixo).map(paraPost),
    proximo: temMais && ultimo ? { em: ultimo.criadoEm, id: ultimo.id } : null,
  };
}

/**
 * O voto de QUEM PERGUNTA nas enquetes da página — uma busca pela chave
 * (post_id, pessoa_id), só quando a página tem enquete. Devolve posts novos:
 * a página guardada é de todo mundo e não pode ser alterada.
 */
async function comMeusVotos(eu: number, posts: PostDoMural[]): Promise<PostDoMural[]> {
  const enquetes = posts.filter((p) => p.enquete).map((p) => p.id);
  if (!enquetes.length) return posts;
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, eu)
    .input("ids", sql.NVarChar(sql.MAX), JSON.stringify(enquetes))
    .query(
      `SELECT v.post_id, v.ordem
         FROM OPENJSON(@ids) j
         JOIN gestor.mural_enquete_votos v
           ON v.post_id = TRY_CAST(j.value AS UNIQUEIDENTIFIER) AND v.pessoa_id = @eu`,
    );
  const meus = new Map(
    (r.recordset as { post_id: string; ordem: number }[]).map((l) => [
      String(l.post_id).toUpperCase(),
      Number(l.ordem),
    ]),
  );
  return posts.map((p) =>
    p.enquete
      ? { ...p, enquete: { ...p.enquete, meuVoto: meus.get(p.id.toUpperCase()) ?? null } }
      : p,
  );
}

/**
 * O feed: sem cursor, a primeira página (com os comunicados fixados); com
 * cursor, as 20 seguintes. `filtro` escolhe um tipo (fase 2/3).
 *
 * É também aqui que o lote diário das conquistas acorda (ver
 * `mural-lote.server.ts`): a primeira leitura depois das 06:00 o dispara, sem
 * esperar por ele.
 */
export const feedDoMural = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (entrada: { antes?: CursorDoMural | null; filtro?: FiltroDoMural } | undefined) => {
        const filtro = filtroValido(entrada?.filtro);
        const a = entrada?.antes;
        if (!a) return { antes: null, filtro };
        const em = typeof a.em === "string" ? new Date(a.em) : null;
        if (!em || Number.isNaN(em.getTime())) throw new Error("Página inválida");
        return { antes: { em: em.toISOString(), id: exigirGuid(a.id, "Página") }, filtro };
      },
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        dados: { antes: CursorDoMural | null; filtro: FiltroDoMural },
      ): Promise<PaginaDoMural> => {
        const { compartilhado } = await import("@/lib/cache-compartilhado.server");
        const { chaveDoFeed, ehMuralInativo, idsAtivos } = await import("@/lib/mural.server");
        const { garantirLoteDoDia } = await import("@/lib/mural-lote.server");
        garantirLoteDoDia();
        const papel = await quemSouNoMural(eu);
        const quem = { souGerente: papel.gerente, possoComunicar: papel.comunica };
        try {
          const pagina = dados.antes
            ? await buscarPagina({ em: new Date(dados.antes.em), id: dados.antes.id }, dados.filtro)
            : await compartilhado(chaveDoFeed(dados.filtro), 15_000, () =>
                buscarPagina(null, dados.filtro),
              );
          const [posts, fixados] = await Promise.all([
            comMeusVotos(eu, pagina.posts),
            comMeusVotos(eu, pagina.fixados),
          ]);
          const destinatarios = (await idsAtivos()).length;
          return { ativo: true, ...pagina, posts, fixados, destinatarios, ...quem };
        } catch (e) {
          if (ehMuralInativo(e)) return { ativo: false, ...quem };
          throw e;
        }
      },
    ),
  );

/** Todos os comentários de um post ("ver mais"), em ordem cronológica. */
export const comentariosDoPost = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { postId: string }) => ({ postId: exigirGuid(e?.postId, "Post") })))
  .handler(
    comSessao(async (_eu, d: { postId: string }): Promise<{ comentarios: ComentarioDoMural[] }> => {
      const { noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("p", sql.UniqueIdentifier, d.postId)
          .query(
            `SELECT TOP 200 c.id, c.autor_id, c.texto, c.criado_em
               FROM gestor.mural_comentarios c
              WHERE c.post_id = @p AND c.excluido_em IS NULL
              ORDER BY c.criado_em DESC`,
          ),
      );
      return {
        comentarios: (
          r.recordset as { id: string; autor_id: number; texto: string; criado_em: Date }[]
        )
          .map((c) => ({
            id: c.id,
            autorId: String(c.autor_id),
            texto: c.texto,
            em: c.criado_em.toISOString(),
          }))
          .reverse(),
      };
    }),
  );

/* -------------------- Publicar, editar, excluir, fixar -------------------- */

/** O que a tela manda para publicar (fases 1 a 3). */
export type EntradaDoPost = {
  texto: string;
  /** Sem tipo é "geral" (ou "comunicado", com `comunicado: true`, como na fase 1). */
  tipo?: Exclude<TipoDePost, "conquista">;
  comunicado?: boolean;
  titulo?: string;
  mencoes?: string[];
  comFotos?: boolean;
  evento?: { inicio: string; local?: string | null };
  enquete?: { opcoes: string[]; fim?: string | null };
  elogio?: { pessoas: string[]; tarefaId?: string | null };
};

type PostValidado = {
  tipo: Exclude<TipoDePost, "conquista">;
  texto: string;
  titulo: string;
  mencoes: number[];
  eventoInicio: string | null;
  eventoLocal: string | null;
  opcoes: string[];
  enqueteFim: string | null;
  homenageados: number[];
  tarefaId: string | null;
};

const MAX_OPCOES = 6;
const MAX_HOMENAGEADOS = 10;
const linhaUnica = (v: unknown, max: number) => limparTexto(v, max).replace(/\s*\n\s*/g, " ");

/** Data vinda da tela, dentro de uma janela em relação a agora. */
function dataNaJanela(v: unknown, deMs: number, ateMs: number, oque: string): string {
  const d = typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new Error(`${oque}: data inválida.`);
  const agora = Date.now();
  if (d.getTime() < agora + deMs || d.getTime() > agora + ateMs)
    throw new Error(`${oque}: data fora do intervalo.`);
  return d.toISOString();
}

function validarPost(e: EntradaDoPost): PostValidado {
  const tipos = ["geral", "campo", "comunicado", "evento", "elogio", "enquete"] as const;
  const tipo = e?.comunicado
    ? "comunicado"
    : tipos.includes(e?.tipo as (typeof tipos)[number])
      ? (e.tipo as PostValidado["tipo"])
      : "geral";
  const texto = limparTexto(e?.texto, MAX_TEXTO);
  const titulo = tipo === "comunicado" || tipo === "evento" ? linhaUnica(e?.titulo, 160) : "";
  const v: PostValidado = {
    tipo,
    texto,
    titulo,
    mencoes: idsDePessoas(e?.mencoes, MAX_MENCOES),
    eventoInicio: null,
    eventoLocal: null,
    opcoes: [],
    enqueteFim: null,
    homenageados: [],
    tarefaId: null,
  };
  switch (tipo) {
    case "comunicado":
      if (titulo.length < 3) throw new Error("Dê um título ao comunicado.");
      if (!texto && !e?.comFotos) throw new Error("Escreva o comunicado.");
      break;
    case "evento":
      if (titulo.length < 3) throw new Error("Dê um nome ao evento.");
      v.eventoInicio = dataNaJanela(e?.evento?.inicio, -DIA_MS, 366 * DIA_MS, "Evento");
      v.eventoLocal = linhaUnica(e?.evento?.local, 160) || null;
      break;
    case "enquete": {
      if (texto.length < 3) throw new Error("Escreva a pergunta da enquete.");
      const vistas = new Set<string>();
      for (const bruta of Array.isArray(e?.enquete?.opcoes) ? e.enquete.opcoes : []) {
        const o = linhaUnica(bruta, 120);
        const k = o.toLocaleLowerCase("pt-BR");
        if (o && !vistas.has(k)) {
          vistas.add(k);
          v.opcoes.push(o);
        }
      }
      if (v.opcoes.length < 2) throw new Error("A enquete precisa de pelo menos 2 opções.");
      if (v.opcoes.length > MAX_OPCOES) throw new Error(`No máximo ${MAX_OPCOES} opções.`);
      if (e?.enquete?.fim)
        v.enqueteFim = dataNaJanela(e.enquete.fim, 5 * 60_000, 90 * DIA_MS, "Fim da enquete");
      break;
    }
    case "elogio":
      v.homenageados = idsDePessoas(e?.elogio?.pessoas, MAX_HOMENAGEADOS);
      if (!v.homenageados.length) throw new Error("Escolha quem você quer agradecer.");
      v.tarefaId = e?.elogio?.tarefaId ? exigirGuid(e.elogio.tarefaId, "Tarefa") : null;
      break;
    case "campo":
      if (!e?.comFotos) throw new Error("Um post do campo precisa de pelo menos uma foto.");
      break;
    default:
      if (!texto && !e?.comFotos) throw new Error("Escreva alguma coisa (ou escolha uma foto).");
  }
  return v;
}

/**
 * Publica um post — de qualquer tipo que a tela cria: geral, do campo,
 * comunicado, evento, enquete ou elogio (fases 1 a 3, 14/10/2026). As fotos
 * sobem DEPOIS, pela porta de sempre (`enviarAnexo` com dono 'mural' e o id
 * devolvido aqui) — é a mesma infraestrutura dos anexos de tarefa e do chat.
 *
 * Quem é avisado (tipo 'mural' na sineta, salvo o comunicado):
 *   - comunicado: todo mundo ativo;
 *   - elogio: as pessoas agradecidas ("te agradeceu no mural");
 *   - qualquer post: quem foi marcado com @ (e não foi avisado acima).
 */
export const publicarNoMural = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: EntradaDoPost) => validarPost(e)))
  .handler(
    comSessao(async (eu, d: PostValidado): Promise<{ id: string }> => {
      const { esquecerFeed, idsAtivos, noMural } = await import("@/lib/mural.server");
      const comunicado = d.tipo === "comunicado";
      if (comunicado && !(await quemSouNoMural(eu)).comunica) {
        throw new Error("Só a gerência e o RH publicam comunicados.");
      }
      const ativos = await idsAtivos();
      const conjuntoAtivo = new Set(ativos);
      // Comunicado vai para todo mundo ativo; post comum, só para quem foi marcado.
      const avisarTodos = comunicado ? ativos.filter((id) => id !== eu) : [];
      const homenageados = d.homenageados.filter((id) => id !== eu && conjuntoAtivo.has(id));
      if (d.tipo === "elogio" && !homenageados.length) {
        throw new Error("Escolha quem você quer agradecer (alguém além de você).");
      }
      const jaAvisados = new Set([...avisarTodos, ...homenageados]);
      const marcados = d.mencoes.filter(
        (id) => id !== eu && conjuntoAtivo.has(id) && !jaAvisados.has(id),
      );

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("eu", sql.Int, eu)
          .input("texto", sql.NVarChar(MAX_TEXTO), d.texto)
          .input("comunicado", sql.Bit, comunicado ? 1 : 0)
          .input("titulo", sql.NVarChar(160), d.titulo || null)
          .input("tipo", sql.NVarChar(12), d.tipo)
          .input("tarefa", sql.UniqueIdentifier, d.tarefaId)
          .input(
            "ev_inicio",
            sql.DateTimeOffset(3),
            d.eventoInicio ? new Date(d.eventoInicio) : null,
          )
          .input("ev_local", sql.NVarChar(160), d.eventoLocal)
          .input("enq_fim", sql.DateTimeOffset(3), d.enqueteFim ? new Date(d.enqueteFim) : null)
          .input("opcoes", sql.NVarChar(sql.MAX), JSON.stringify(d.opcoes))
          .input("homenageados", sql.NVarChar(sql.MAX), JSON.stringify(homenageados))
          .input("todos", sql.NVarChar(sql.MAX), JSON.stringify(avisarTodos))
          .input("marcados", sql.NVarChar(sql.MAX), JSON.stringify(marcados))
          .input("trecho", sql.NVarChar(400), (d.titulo || d.texto).slice(0, 400) || null)
          .query(
            `SET XACT_ABORT ON;
             BEGIN TRAN;
             -- Freio de spam: no máximo 10 posts em 10 minutos por pessoa.
             IF (SELECT COUNT(*) FROM gestor.mural_posts
                  WHERE autor_id = @eu AND criado_em > DATEADD(MINUTE, -10, SYSDATETIMEOFFSET())) >= 10
             BEGIN
               ROLLBACK;
               SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS id, N'spam' AS erro;
               RETURN;
             END
             -- O elogio "pela entrega de X": X tem de ser tarefa de quem é agradecido.
             IF @tarefa IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM gestor.tarefas t
                   WHERE t.id = @tarefa
                     AND (t.responsavel_id IN (SELECT CAST(h.value AS INT) FROM OPENJSON(@homenageados) h)
                       OR t.criado_por IN (SELECT CAST(h.value AS INT) FROM OPENJSON(@homenageados) h)))
             BEGIN
               ROLLBACK;
               SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS id, N'tarefa' AS erro;
               RETURN;
             END
             DECLARE @novo TABLE (id UNIQUEIDENTIFIER);
             INSERT INTO gestor.mural_posts
               (autor_id, texto, comunicado, titulo, tipo, tarefa_id, evento_inicio, evento_local, enquete_fim)
             OUTPUT inserted.id INTO @novo
             VALUES (@eu, @texto, @comunicado, @titulo, @tipo, @tarefa, @ev_inicio, @ev_local, @enq_fim);
             DECLARE @id UNIQUEIDENTIFIER = (SELECT TOP 1 id FROM @novo);

             INSERT INTO gestor.mural_enquete_opcoes (post_id, ordem, texto)
             SELECT @id, CAST(j.[key] AS INT) + 1, j.value FROM OPENJSON(@opcoes) j;

             INSERT INTO gestor.mural_homenageados (post_id, pessoa_id)
             SELECT @id, CAST(j.value AS INT) FROM OPENJSON(@homenageados) j;

             INSERT INTO gestor.notificacoes (destinatario_id, de_pessoa_id, tipo, titulo, descricao)
             SELECT CAST(j.value AS INT), @eu, 'comunicado', N'publicou um comunicado', @trecho
               FROM OPENJSON(@todos) j;

             INSERT INTO gestor.notificacoes (destinatario_id, de_pessoa_id, tipo, titulo, descricao)
             SELECT CAST(j.value AS INT), @eu, 'mural', N'te agradeceu no mural',
                    COALESCE(LEFT(NULLIF(@texto, N''), 400),
                             (SELECT LEFT(N'Pela entrega de "' + t.titulo + N'"', 400)
                                FROM gestor.tarefas t WHERE t.id = @tarefa))
               FROM OPENJSON(@homenageados) j;

             INSERT INTO gestor.notificacoes (destinatario_id, de_pessoa_id, tipo, titulo, descricao)
             SELECT CAST(j.value AS INT), @eu, 'mural', N'te marcou no mural', @trecho
               FROM OPENJSON(@marcados) j;
             COMMIT;
             SELECT @id AS id, CAST(NULL AS NVARCHAR(10)) AS erro;`,
          ),
      );
      const l = r.recordset[0] as { id: string | null; erro: string | null } | undefined;
      if (l?.erro === "tarefa") throw new Error("Essa tarefa não é de quem você está agradecendo.");
      if (!l?.id) throw new Error("Muitas publicações em pouco tempo. Espere uns minutos.");
      await esquecerFeed();
      return { id: l.id };
    }),
  );

/**
 * Edita o texto (e o título, no comunicado e no evento; a data e o local, no
 * evento). Só o autor. As fotos entram e saem por fora: `enviarAnexo` e
 * `removerFotoDoPost`.
 */
export const editarPostDoMural = createServerFn({ method: "POST" })
  .validator(
    semIdentidade(
      (e: {
        id: string;
        texto: string;
        titulo?: string;
        evento?: { inicio: string; local?: string | null } | null;
      }) => ({
        id: exigirGuid(e?.id, "Post"),
        texto: limparTexto(e?.texto, MAX_TEXTO),
        titulo: linhaUnica(e?.titulo, 160),
        eventoInicio: e?.evento
          ? dataNaJanela(e.evento.inicio, -DIA_MS, 366 * DIA_MS, "Evento")
          : null,
        eventoLocal: e?.evento ? linhaUnica(e.evento.local, 160) || null : null,
      }),
    ),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: {
          id: string;
          texto: string;
          titulo: string;
          eventoInicio: string | null;
          eventoLocal: string | null;
        },
      ) => {
        const { esquecerFeed, noMural } = await import("@/lib/mural.server");
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await noMural(() =>
          pool
            .request()
            .input("id", sql.UniqueIdentifier, d.id)
            .input("eu", sql.Int, eu)
            .input("texto", sql.NVarChar(MAX_TEXTO), d.texto)
            .input("titulo", sql.NVarChar(160), d.titulo.length >= 3 ? d.titulo : null)
            .input(
              "ev_inicio",
              sql.DateTimeOffset(3),
              d.eventoInicio ? new Date(d.eventoInicio) : null,
            )
            .input("ev_local", sql.NVarChar(160), d.eventoLocal)
            .input("com_evento", sql.Bit, d.eventoInicio ? 1 : 0)
            .query(
              `UPDATE gestor.mural_posts
                  SET texto = @texto,
                      titulo = CASE WHEN tipo IN (N'comunicado', N'evento')
                                    THEN COALESCE(@titulo, titulo) ELSE titulo END,
                      evento_inicio = CASE WHEN tipo = N'evento' AND @com_evento = 1
                                           THEN @ev_inicio ELSE evento_inicio END,
                      evento_local = CASE WHEN tipo = N'evento' AND @com_evento = 1
                                          THEN @ev_local ELSE evento_local END,
                      editado_em = SYSDATETIMEOFFSET()
                WHERE id = @id AND autor_id = @eu AND excluido_em IS NULL AND automatico = 0
                  -- Enquete não muda a pergunta depois de ter voto.
                  AND NOT (tipo = N'enquete' AND texto <> @texto
                           AND EXISTS (SELECT 1 FROM gestor.mural_enquete_votos v WHERE v.post_id = @id))
                  -- Post sem texto só se tiver foto (ou for evento/elogio, que têm o resto).
                  AND (LEN(@texto) > 0 OR tipo IN (N'evento', N'elogio')
                       OR EXISTS (SELECT 1 FROM gestor.anexos a
                                   WHERE a.dono_tipo = N'mural' AND a.dono_id = @id))`,
            ),
        );
        if ((r.rowsAffected[0] ?? 0) === 0) throw new Error("Não foi possível editar este post.");
        await esquecerFeed();
        return { ok: true };
      },
    ),
  );

/** Exclui (marca `excluido_em`): o autor ou a gerência. */
export const excluirPostDoMural = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { id: string }) => ({ id: exigirGuid(e?.id, "Post") })))
  .handler(
    comSessao(async (eu, d: { id: string }) => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { gerente } = await quemSouNoMural(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("eu", sql.Int, eu)
          .input("gerente", sql.Bit, gerente ? 1 : 0)
          .query(
            `UPDATE gestor.mural_posts
                SET excluido_em = SYSDATETIMEOFFSET(), excluido_por = @eu, fixado_em = NULL
              WHERE id = @id AND excluido_em IS NULL AND (autor_id = @eu OR @gerente = 1)`,
          ),
      );
      if ((r.rowsAffected[0] ?? 0) === 0) throw new Error("Você não pode excluir este post.");
      await esquecerFeed();
      return { ok: true };
    }),
  );

/** Fixa ou desafixa um comunicado no topo. Só a gerência. */
export const fixarComunicado = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { id: string; fixar: boolean }) => ({
      id: exigirGuid(e?.id, "Post"),
      fixar: !!e?.fixar,
    })),
  )
  .handler(
    comSessao(async (eu, d: { id: string; fixar: boolean }) => {
      if (!(await quemSouNoMural(eu)).gerente) throw new Error("Só a gerência fixa comunicados.");
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("eu", sql.Int, eu)
          .input("fixar", sql.Bit, d.fixar ? 1 : 0)
          .query(
            `UPDATE gestor.mural_posts
                SET fixado_em = CASE WHEN @fixar = 1 THEN SYSDATETIMEOFFSET() ELSE NULL END,
                    fixado_por = CASE WHEN @fixar = 1 THEN @eu ELSE NULL END
              WHERE id = @id AND comunicado = 1 AND excluido_em IS NULL`,
          ),
      );
      if ((r.rowsAffected[0] ?? 0) === 0) throw new Error("Só comunicados podem ser fixados.");
      await esquecerFeed();
      return { ok: true };
    }),
  );

/* -------------------- Reações, comentários, "ciente" -------------------- */

/** Uma reação por pessoa por post: o mesmo emoji tira, outro troca. Não avisa ninguém. */
export const reagirNoPost = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { postId: string; emoji: string | null }) => {
      const postId = exigirGuid(e?.postId, "Post");
      const emoji = e?.emoji === null ? null : emojiValido(e?.emoji);
      if (e?.emoji !== null && !emoji) throw new Error("Reação inválida");
      return { postId, emoji };
    }),
  )
  .handler(
    comSessao(async (eu, d: { postId: string; emoji: string | null }) => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const req = pool
        .request()
        .input("p", sql.UniqueIdentifier, d.postId)
        .input("eu", sql.Int, eu)
        .input("emoji", sql.NVarChar(16), d.emoji);
      await noMural(() =>
        d.emoji
          ? req.query(
              `IF EXISTS (SELECT 1 FROM gestor.mural_posts WHERE id = @p AND excluido_em IS NULL)
               BEGIN
                 UPDATE gestor.mural_reacoes SET emoji = @emoji, em = SYSDATETIMEOFFSET()
                  WHERE post_id = @p AND pessoa_id = @eu;
                 IF @@ROWCOUNT = 0
                   INSERT INTO gestor.mural_reacoes (post_id, pessoa_id, emoji) VALUES (@p, @eu, @emoji);
               END`,
            )
          : req.query(`DELETE FROM gestor.mural_reacoes WHERE post_id = @p AND pessoa_id = @eu`),
      );
      await esquecerFeed();
      return { ok: true };
    }),
  );

/**
 * Comenta num post. Quem foi marcado com @ no comentário recebe um aviso
 * 'mural' (fase 2, 14/10/2026) — e só ele: comentar não avisa o autor.
 */
export const comentarNoPost = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { postId: string; texto: string; mencoes?: string[] }) => {
      const texto = limparTexto(e?.texto, MAX_COMENTARIO);
      if (!texto) throw new Error("Comentário vazio");
      return {
        postId: exigirGuid(e?.postId, "Post"),
        texto,
        mencoes: idsDePessoas(e?.mencoes, MAX_MENCOES),
      };
    }),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { postId: string; texto: string; mencoes: number[] },
      ): Promise<ComentarioDoMural> => {
        const { esquecerFeed, idsAtivos, noMural } = await import("@/lib/mural.server");
        const ativos = new Set(d.mencoes.length ? await idsAtivos() : []);
        const marcados = d.mencoes.filter((id) => id !== eu && ativos.has(id));
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await noMural(() =>
          pool
            .request()
            .input("p", sql.UniqueIdentifier, d.postId)
            .input("eu", sql.Int, eu)
            .input("texto", sql.NVarChar(MAX_COMENTARIO), d.texto)
            .input("marcados", sql.NVarChar(sql.MAX), JSON.stringify(marcados))
            .input("trecho", sql.NVarChar(400), d.texto.slice(0, 400))
            .query(
              `SET NOCOUNT ON;
               DECLARE @novo TABLE (id UNIQUEIDENTIFIER, criado_em DATETIMEOFFSET(3));
               INSERT INTO gestor.mural_comentarios (post_id, autor_id, texto)
               OUTPUT inserted.id, inserted.criado_em INTO @novo
               SELECT @p, @eu, @texto
                WHERE EXISTS (SELECT 1 FROM gestor.mural_posts WHERE id = @p AND excluido_em IS NULL)
                  -- Freio: 20 comentários por minuto por pessoa.
                  AND (SELECT COUNT(*) FROM gestor.mural_comentarios
                        WHERE autor_id = @eu AND criado_em > DATEADD(MINUTE, -1, SYSDATETIMEOFFSET())) < 20;
               IF EXISTS (SELECT 1 FROM @novo)
                 INSERT INTO gestor.notificacoes (destinatario_id, de_pessoa_id, tipo, titulo, descricao)
                 SELECT CAST(j.value AS INT), @eu, 'mural', N'te marcou num comentário do mural', @trecho
                   FROM OPENJSON(@marcados) j;
               SELECT id, criado_em FROM @novo;`,
            ),
        );
        const l = r.recordset[0] as { id: string; criado_em: Date } | undefined;
        if (!l) throw new Error("Não foi possível comentar agora.");
        await esquecerFeed();
        return { id: l.id, autorId: String(eu), texto: d.texto, em: l.criado_em.toISOString() };
      },
    ),
  );

/** Exclui um comentário: quem escreveu ou a gerência. */
export const excluirComentarioDoMural = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { id: string }) => ({ id: exigirGuid(e?.id, "Comentário") })))
  .handler(
    comSessao(async (eu, d: { id: string }) => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { gerente } = await quemSouNoMural(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("id", sql.UniqueIdentifier, d.id)
          .input("eu", sql.Int, eu)
          .input("gerente", sql.Bit, gerente ? 1 : 0)
          .query(
            `UPDATE gestor.mural_comentarios SET excluido_em = SYSDATETIMEOFFSET()
              WHERE id = @id AND excluido_em IS NULL AND (autor_id = @eu OR @gerente = 1)`,
          ),
      );
      if ((r.rowsAffected[0] ?? 0) === 0) throw new Error("Você não pode excluir este comentário.");
      await esquecerFeed();
      return { ok: true };
    }),
  );

/** "Li e estou ciente" num comunicado. Marcar duas vezes não faz nada. */
export const marcarCiente = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { postId: string }) => ({ postId: exigirGuid(e?.postId, "Post") })))
  .handler(
    comSessao(async (eu, d: { postId: string }) => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await noMural(() =>
        pool
          .request()
          .input("p", sql.UniqueIdentifier, d.postId)
          .input("eu", sql.Int, eu)
          .query(
            `INSERT INTO gestor.mural_leituras (post_id, pessoa_id)
             SELECT @p, @eu
              WHERE EXISTS (SELECT 1 FROM gestor.mural_posts
                             WHERE id = @p AND comunicado = 1 AND excluido_em IS NULL)
                AND NOT EXISTS (SELECT 1 FROM gestor.mural_leituras WHERE post_id = @p AND pessoa_id = @eu);
             -- O aviso da sineta sobre este comunicado já cumpriu o papel.
             UPDATE gestor.notificacoes SET lida = 1
              WHERE destinatario_id = @eu AND tipo = 'comunicado' AND lida = 0
                AND descricao = (SELECT LEFT(titulo, 400) FROM gestor.mural_posts WHERE id = @p);`,
          ),
      );
      await esquecerFeed();
      return { ok: true };
    }),
  );

/** Quem leu e quem falta num comunicado — para o autor e a gerência. */
export const leiturasDoComunicado = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { postId: string }) => ({ postId: exigirGuid(e?.postId, "Post") })))
  .handler(
    comSessao(async (eu, d: { postId: string }): Promise<LeiturasDoComunicado> => {
      const { noMural, pessoasDoMural } = await import("@/lib/mural.server");
      const { gerente } = await quemSouNoMural(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("p", sql.UniqueIdentifier, d.postId)
          .input("eu", sql.Int, eu)
          .input("gerente", sql.Bit, gerente ? 1 : 0)
          .query(
            `SELECT autor_id FROM gestor.mural_posts
              WHERE id = @p AND comunicado = 1 AND (autor_id = @eu OR @gerente = 1);
             SELECT l.pessoa_id, l.lido_em FROM gestor.mural_leituras l
              WHERE l.post_id = @p
                AND EXISTS (SELECT 1 FROM gestor.mural_posts mp
                             WHERE mp.id = @p AND mp.comunicado = 1 AND (mp.autor_id = @eu OR @gerente = 1))
              ORDER BY l.lido_em;`,
          ),
      );
      const sets = r.recordsets as unknown as Record<string, unknown>[][];
      const cab = sets[0]?.[0] as { autor_id: number } | undefined;
      if (!cab) throw new Error("Só quem publicou (ou a gerência) vê as leituras.");
      const pessoas = await pessoasDoMural();
      const nomePorId = new Map(pessoas.map((p) => [p.id, p.nome]));
      const lidos = ((sets[1] ?? []) as { pessoa_id: number; lido_em: Date }[]).map((l) => ({
        id: String(l.pessoa_id),
        nome: nomePorId.get(l.pessoa_id) ?? "—",
        em: l.lido_em.toISOString(),
      }));
      const leram = new Set(lidos.map((l) => Number(l.id)));
      const faltam = pessoas
        .filter((p) => p.ativa && p.id !== cab.autor_id && !leram.has(p.id))
        .map((p) => ({ id: String(p.id), nome: p.nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return { lidos, faltam };
    }),
  );

/* -------------------- Aniversários, tempo de casa, boas-vindas -------------------- */

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
/** 29/02 vira 28/02 nos anos comuns — ninguém fica sem aniversário. */
const diaEfetivo = (ano: number, dia: number, mes: number) =>
  mes === 2 && dia === 29 && !bissexto(ano) ? 28 : dia;

/**
 * Os eventos das próximas 4 semanas (os que começaram há menos de 3 h ainda
 * contam). Igual para todo mundo: sai da memória compartilhada por 10 min,
 * esquecida a cada gravação no mural (`esquecerFeed`).
 */
async function proximosEventos(): Promise<EventoNoPainel[]> {
  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  const { CHAVE_EVENTOS } = await import("@/lib/mural.server");
  return compartilhado(CHAVE_EVENTOS, 10 * 60_000, async () => {
    const { getPool } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool.request().query(
      `SELECT TOP 8 p.id, p.titulo, p.evento_inicio, p.evento_local,
              (SELECT COUNT(*) FROM gestor.mural_evento_presencas e WHERE e.post_id = p.id) AS n
         FROM gestor.mural_posts p
        WHERE p.tipo = N'evento' AND p.excluido_em IS NULL
          AND p.evento_inicio >= DATEADD(HOUR, -3, SYSDATETIMEOFFSET())
          AND p.evento_inicio < DATEADD(DAY, 30, SYSDATETIMEOFFSET())
        ORDER BY p.evento_inicio`,
    );
    return (
      r.recordset as {
        id: string;
        titulo: string;
        evento_inicio: Date;
        evento_local: string | null;
        n: number;
      }[]
    ).map((l) => ({
      id: l.id,
      titulo: l.titulo,
      inicio: l.evento_inicio.toISOString(),
      local: l.evento_local,
      participantes: Number(l.n),
    }));
  });
}

/** O painel lateral do mural: aniversariantes, tempo de casa, boas-vindas, eventos. */
export const painelDoMural = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<PainelDoMural> => {
    const { aniversariosProximos, diaNoBrasil, ehMuralInativo, pessoasDoMural } =
      await import("@/lib/mural.server");
    const { garantirLoteDoDia } = await import("@/lib/mural-lote.server");
    garantirLoteDoDia();
    const pessoas = (await pessoasDoMural()).filter((p) => p.ativa);
    const porId = new Map(pessoas.map((p) => [p.id, p]));
    const hoje = diaNoBrasil();

    let ativo = true;
    let aniversarios: Awaited<ReturnType<typeof aniversariosProximos>> = [];
    let meu: PainelDoMural["meu"] = null;
    const meuRH = porId.get(eu)?.nascimento ?? null;
    let eventos: EventoNoPainel[] = [];
    try {
      aniversarios = await aniversariosProximos();
      eventos = await proximosEventos();
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("eu", sql.Int, eu)
        .query(`SELECT dia, mes, mostrar FROM gestor.aniversarios WHERE pessoa_id = @eu`);
      const l = r.recordset[0] as { dia: number; mes: number; mostrar: boolean } | undefined;
      meu = l
        ? { dia: l.dia, mes: l.mes, mostrar: !!l.mostrar, origem: "manual" }
        : meuRH
          ? { ...meuRH, mostrar: true, origem: "rh" }
          : null;
    } catch (e) {
      // Sem a migração, o tempo de casa (que vem do RH) aparece do mesmo jeito.
      if (!ehMuralInativo(e)) throw e;
      ativo = false;
    }

    // Os próximos 7 dias, na data de Brasília.
    const proximos = Array.from({ length: 7 }, (_, i) =>
      diaNoBrasil(new Date(Date.now() + (i + 1) * 86_400_000)),
    );
    const hojeL: AniversarianteNoPainel[] = [];
    const semana: (AniversarianteNoPainel & { ordem: number })[] = [];
    const mes: AniversarianteNoPainel[] = [];
    for (const a of aniversarios) {
      const p = porId.get(a.pessoaId);
      if (!p) continue;
      const item = { id: String(p.id), nome: p.nome, dia: a.dia, mes: a.mes };
      if (a.mes === hoje.mes && diaEfetivo(hoje.ano, a.dia, a.mes) === hoje.dia) {
        hojeL.push(item);
        continue;
      }
      const i = proximos.findIndex(
        (d) => d.mes === a.mes && diaEfetivo(d.ano, a.dia, a.mes) === d.dia,
      );
      if (i >= 0) {
        semana.push({ ...item, ordem: i });
        continue;
      }
      if (a.mes === hoje.mes) mes.push(item);
    }
    const porNome = (a: { nome: string }, b: { nome: string }) =>
      a.nome.localeCompare(b.nome, "pt-BR");

    const tempoDeCasa: PainelDoMural["tempoDeCasa"] = [];
    const boasVindas: PainelDoMural["boasVindas"] = [];
    const hojeUTC = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);
    for (const p of pessoas) {
      if (!p.admissao) continue;
      const [ano, m, d] = p.admissao.split("-").map(Number);
      const diasDeCasa = Math.round((hojeUTC - Date.UTC(ano, m - 1, d)) / 86_400_000);
      if (diasDeCasa >= 0 && diasDeCasa <= 30) {
        boasVindas.push({ id: String(p.id), nome: p.nome, desde: p.admissao });
      }
      if (m === hoje.mes && ano < hoje.ano) {
        tempoDeCasa.push({
          id: String(p.id),
          nome: p.nome,
          anos: hoje.ano - ano,
          dia: d,
          jaFez: d <= hoje.dia,
        });
      }
    }

    return {
      ativo,
      hoje: hojeL.sort(porNome),
      semana: semana
        .sort((a, b) => a.ordem - b.ordem || porNome(a, b))
        .map((x) => ({ id: x.id, nome: x.nome, dia: x.dia, mes: x.mes })),
      mes: mes.sort((a, b) => a.dia - b.dia || porNome(a, b)),
      tempoDeCasa: tempoDeCasa.sort((a, b) => a.dia - b.dia || porNome(a, b)),
      boasVindas: boasVindas.sort((a, b) => b.desde.localeCompare(a.desde) || porNome(a, b)),
      meu,
      meuRH,
      eventos,
    };
  }),
);

/**
 * Os aniversariantes de hoje — só os nomes, para o chapeuzinho de festa no
 * avatar. A tela pede uma vez por sessão; aqui sai da memória do servidor.
 */
export const aniversariantesDeHoje = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (): Promise<{ dia: string; ids: string[]; nomes: string[] }> => {
    const { aniversariosProximos, diaNoBrasil, ehMuralInativo, pessoasDoMural } =
      await import("@/lib/mural.server");
    const hoje = diaNoBrasil();
    let aniversarios: Awaited<ReturnType<typeof aniversariosProximos>>;
    try {
      aniversarios = await aniversariosProximos();
    } catch (e) {
      if (ehMuralInativo(e)) return { dia: hoje.iso, ids: [], nomes: [] };
      throw e;
    }
    const porId = new Map((await pessoasDoMural()).filter((p) => p.ativa).map((p) => [p.id, p]));
    const deHoje = aniversarios
      .filter((a) => a.mes === hoje.mes && diaEfetivo(hoje.ano, a.dia, a.mes) === hoje.dia)
      .map((a) => porId.get(a.pessoaId))
      .filter((p): p is NonNullable<typeof p> => !!p);
    return {
      dia: hoje.iso,
      ids: deHoje.map((p) => String(p.id)),
      nomes: deHoje.map((p) => p.nome),
    };
  }),
);

/**
 * Grava (ou apaga) o aniversário de quem está logado. Só dia e mês — o ano
 * não é perguntado, de propósito (privacidade).
 */
export const salvarMeuAniversario = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { dia?: number; mes?: number; mostrar?: boolean; apagar?: boolean }) => {
      if (e?.apagar) return { apagar: true as const, dia: 0, mes: 0, mostrar: false };
      const dia = Number(e?.dia);
      const mes = Number(e?.mes);
      if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new Error("Mês inválido");
      const maximo = mes === 2 ? 29 : [4, 6, 9, 11].includes(mes) ? 30 : 31;
      if (!Number.isInteger(dia) || dia < 1 || dia > maximo) throw new Error("Dia inválido");
      return { apagar: false as const, dia, mes, mostrar: e?.mostrar !== false };
    }),
  )
  .handler(
    comSessao(async (eu, d: { apagar: boolean; dia: number; mes: number; mostrar: boolean }) => {
      const { esquecerAniversarios, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const req = pool
        .request()
        .input("eu", sql.Int, eu)
        .input("dia", sql.TinyInt, d.dia)
        .input("mes", sql.TinyInt, d.mes)
        .input("mostrar", sql.Bit, d.mostrar ? 1 : 0);
      await noMural(() =>
        d.apagar
          ? req.query(`DELETE FROM gestor.aniversarios WHERE pessoa_id = @eu`)
          : req.query(
              `UPDATE gestor.aniversarios
                  SET dia = @dia, mes = @mes, mostrar = @mostrar, atualizado_em = SYSDATETIMEOFFSET()
                WHERE pessoa_id = @eu;
               IF @@ROWCOUNT = 0
                 INSERT INTO gestor.aniversarios (pessoa_id, dia, mes, mostrar)
                 VALUES (@eu, @dia, @mes, @mostrar);`,
            ),
      );
      await esquecerAniversarios();
      return { ok: true };
    }),
  );
