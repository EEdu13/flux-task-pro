import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";
import type { OpcaoDaEnquete } from "@/lib/mural.functions";

/*
 * Mural — fases 2 e 3 (14/10/2026): o que se faz DENTRO de um post já
 * publicado, fora o que a fase 1 já tinha (reagir, comentar, "ciente"):
 *   - votar numa enquete (um voto por pessoa — a chave da tabela garante;
 *     dá para trocar enquanto ela estiver aberta) e o autor encerrar;
 *   - "Vou participar" de um evento;
 *   - tirar uma foto do próprio post ao editá-lo;
 *   - e a escolha de cada um sobre aparecer nas conquistas automáticas.
 *
 * Cada gravação esquece a primeira página guardada do feed (`esquecerFeed`),
 * como na fase 1. Nada aqui consulta mais que uma chave primária.
 */

const exigirGuid = (v: unknown, oque: string): string => {
  if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
  throw new Error(`${oque} inválido`);
};

/* -------------------- Enquete -------------------- */

export type ResultadoDaEnquete = { opcoes: OpcaoDaEnquete[]; total: number; meuVoto: number };

/**
 * Vota (ou troca o voto) numa enquete aberta. Devolve a contagem nova, para a
 * tela mostrar o resultado na hora.
 */
export const votarNaEnquete = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { postId: string; ordem: number }) => {
      const ordem = Number(e?.ordem);
      if (!Number.isInteger(ordem) || ordem < 1 || ordem > 6) throw new Error("Opção inválida");
      return { postId: exigirGuid(e?.postId, "Enquete"), ordem };
    }),
  )
  .handler(
    comSessao(async (eu, d: { postId: string; ordem: number }): Promise<ResultadoDaEnquete> => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("p", sql.UniqueIdentifier, d.postId)
          .input("eu", sql.Int, eu)
          .input("o", sql.TinyInt, d.ordem)
          .query(
            `SET NOCOUNT ON;
             DECLARE @aberta BIT = CASE WHEN EXISTS (
               SELECT 1 FROM gestor.mural_posts p
                JOIN gestor.mural_enquete_opcoes o ON o.post_id = p.id AND o.ordem = @o
               WHERE p.id = @p AND p.tipo = N'enquete' AND p.excluido_em IS NULL
                 AND p.enquete_fechada_em IS NULL
                 AND (p.enquete_fim IS NULL OR p.enquete_fim > SYSDATETIMEOFFSET())
             ) THEN 1 ELSE 0 END;
             IF @aberta = 1
             BEGIN
               UPDATE gestor.mural_enquete_votos SET ordem = @o, em = SYSDATETIMEOFFSET()
                WHERE post_id = @p AND pessoa_id = @eu;
               IF @@ROWCOUNT = 0
                 INSERT INTO gestor.mural_enquete_votos (post_id, pessoa_id, ordem) VALUES (@p, @eu, @o);
             END
             SELECT @aberta AS aberta;
             SELECT o.ordem, o.texto,
                    (SELECT COUNT(*) FROM gestor.mural_enquete_votos v
                      WHERE v.post_id = o.post_id AND v.ordem = o.ordem) AS votos
               FROM gestor.mural_enquete_opcoes o
              WHERE o.post_id = @p
              ORDER BY o.ordem;`,
          ),
      );
      const sets = r.recordsets as unknown as Record<string, unknown>[][];
      if (!(sets[0]?.[0] as { aberta: boolean } | undefined)?.aberta) {
        throw new Error("Esta enquete já foi encerrada.");
      }
      const opcoes = ((sets[1] ?? []) as { ordem: number; texto: string; votos: number }[]).map(
        (o) => ({ ordem: Number(o.ordem), texto: o.texto, votos: Number(o.votos) }),
      );
      await esquecerFeed();
      return { opcoes, total: opcoes.reduce((s, o) => s + o.votos, 0), meuVoto: d.ordem };
    }),
  );

/** Encerra a enquete: o autor ou a gerência. Os votos ficam. */
export const encerrarEnquete = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { postId: string }) => ({ postId: exigirGuid(e?.postId, "Enquete") })),
  )
  .handler(
    comSessao(async (eu, d: { postId: string }) => {
      const { esquecerFeed, noMural, quemSouNoMural } = await import("@/lib/mural.server");
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
            `UPDATE gestor.mural_posts SET enquete_fechada_em = SYSDATETIMEOFFSET()
              WHERE id = @p AND tipo = N'enquete' AND excluido_em IS NULL
                AND enquete_fechada_em IS NULL AND (autor_id = @eu OR @gerente = 1)`,
          ),
      );
      if ((r.rowsAffected[0] ?? 0) === 0)
        throw new Error("Não foi possível encerrar esta enquete.");
      await esquecerFeed();
      return { ok: true };
    }),
  );

/* -------------------- Evento -------------------- */

/** "Vou participar" (ou desistir). Devolve quem vai, para a tela atualizar. */
export const participarDoEvento = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { postId: string; vou: boolean }) => ({
      postId: exigirGuid(e?.postId, "Evento"),
      vou: !!e?.vou,
    })),
  )
  .handler(
    comSessao(
      async (eu, d: { postId: string; vou: boolean }): Promise<{ participantes: string[] }> => {
        const { esquecerFeed, noMural } = await import("@/lib/mural.server");
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await noMural(() =>
          pool
            .request()
            .input("p", sql.UniqueIdentifier, d.postId)
            .input("eu", sql.Int, eu)
            .input("vou", sql.Bit, d.vou ? 1 : 0)
            .query(
              `SET NOCOUNT ON;
             IF @vou = 1
               INSERT INTO gestor.mural_evento_presencas (post_id, pessoa_id)
               SELECT @p, @eu
                WHERE EXISTS (SELECT 1 FROM gestor.mural_posts
                               WHERE id = @p AND tipo = N'evento' AND excluido_em IS NULL
                                 -- Evento que já passou não recebe presença nova.
                                 AND evento_inicio > DATEADD(HOUR, -12, SYSDATETIMEOFFSET()))
                  AND NOT EXISTS (SELECT 1 FROM gestor.mural_evento_presencas
                                   WHERE post_id = @p AND pessoa_id = @eu);
             ELSE
               DELETE FROM gestor.mural_evento_presencas WHERE post_id = @p AND pessoa_id = @eu;
             SELECT pessoa_id FROM gestor.mural_evento_presencas WHERE post_id = @p ORDER BY em;`,
            ),
        );
        await esquecerFeed();
        return {
          participantes: (r.recordset as { pessoa_id: number }[]).map((l) => String(l.pessoa_id)),
        };
      },
    ),
  );

/* -------------------- Fotos do post -------------------- */

/**
 * Tira uma foto do próprio post (editar o post, fase 2). Só o autor — a
 * gerência, se precisar, exclui o post inteiro. A linha sai antes do arquivo,
 * como em `removerAnexo`: o pior caso é um arquivo órfão no Blob.
 */
export const removerFotoDoPost = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { fotoId: string }) => ({ fotoId: exigirGuid(e?.fotoId, "Foto") })))
  .handler(
    comSessao(async (eu, d: { fotoId: string }) => {
      const { esquecerFeed, noMural } = await import("@/lib/mural.server");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await noMural(() =>
        pool
          .request()
          .input("id", sql.UniqueIdentifier, d.fotoId)
          .input("eu", sql.Int, eu)
          .query(
            `DELETE a
             OUTPUT DELETED.url
               FROM gestor.anexos a
               JOIN gestor.mural_posts p ON p.id = a.dono_id
              WHERE a.id = @id AND a.dono_tipo = N'mural'
                AND p.autor_id = @eu AND p.excluido_em IS NULL`,
          ),
      );
      const linha = r.recordset[0] as { url: string } | undefined;
      if (!linha) throw new Error("Você não pode tirar esta foto.");
      const { apagarDoBlob } = await import("@/integrations/blob.server");
      await apagarDoBlob(linha.url);
      await esquecerFeed();
      return { ok: true };
    }),
  );

/* -------------------- Conquistas automáticas: participar ou não -------------------- */

/*
 * Onde mora a escolha: gestor.preferencias, chave 'mural_conquistas', valor
 * '0' para "não quero aparecer". Sem linha = participa (o padrão).
 *
 * Por que lá e não numa coluna de gestor.aniversarios (decisão de 14/10/2026):
 *   - são coisas diferentes — quem não contou o aniversário também pode
 *     querer (ou não) aparecer nas conquistas, e lá a linha nem existiria;
 *   - o lote diário lê TODAS as recusas numa consulta só
 *     (WHERE chave = 'mural_conquistas'), uma vez por dia, numa tabela de
 *     poucas dezenas de linhas — nada a indexar;
 *   - não depende da migração do mural: a escolha funciona desde já.
 */
const CHAVE_PREFERENCIA = "mural_conquistas";

export const minhasConquistasNoMural = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ participar: boolean }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .input("chave", sql.NVarChar(60), CHAVE_PREFERENCIA)
      .query(`SELECT valor FROM gestor.preferencias WHERE pessoa_id = @eu AND chave = @chave`);
    const valor = (r.recordset[0] as { valor: string } | undefined)?.valor;
    return { participar: valor !== "0" };
  }),
);

export const salvarConquistasNoMural = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { participar: boolean }) => ({ participar: e?.participar !== false })),
  )
  .handler(
    comSessao(async (eu, d: { participar: boolean }) => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const req = pool
        .request()
        .input("eu", sql.Int, eu)
        .input("chave", sql.NVarChar(60), CHAVE_PREFERENCIA);
      await (d.participar
        ? req.query(`DELETE FROM gestor.preferencias WHERE pessoa_id = @eu AND chave = @chave`)
        : req.query(
            `IF EXISTS (SELECT 1 FROM gestor.preferencias WHERE pessoa_id = @eu AND chave = @chave)
               UPDATE gestor.preferencias SET valor = N'0', atualizada_em = SYSDATETIMEOFFSET()
                WHERE pessoa_id = @eu AND chave = @chave;
             ELSE
               INSERT INTO gestor.preferencias (pessoa_id, chave, valor) VALUES (@eu, @chave, N'0');`,
          ));
      return { ok: true };
    }),
  );
