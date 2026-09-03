import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Auditoria de login — a primeira vez que estas duas tabelas ganham código.
 *
 * Não veio de um pedido de tela: `registros_de_acesso` e
 * `dispositivos_conhecidos` existiam vazias desde a criação do schema, sem
 * nada as escrevendo nem lendo. O que segue é o mínimo que as torna úteis —
 * registrar quem entrou, de onde, e se o navegador já era conhecido — mais uma
 * leitura própria em Configurações, para a coisa não ficar só gravando no
 * escuro sem ninguém nunca ver o resultado.
 */

/**
 * Registra uma tentativa de login e, quando bem-sucedida, atualiza (ou cria) o
 * dispositivo conhecido.
 *
 * Não é rota — é chamada de dentro de `iamLogin`, no mesmo pedido, porque
 * marcar o dispositivo escreve um cookie, e cookie só pode ser escrito
 * enquanto a resposta ainda está sendo montada. Uma tarefa solta em segundo
 * plano chegaria tarde demais: a resposta já teria saído sem o cookie.
 *
 * Nunca lança. Falhar aqui não pode derrubar um login — é a mesma regra que já
 * vale para `registrarPerfilFuncional` e para o aviso de acesso da própria IAM.
 */
export async function registrarAcesso(
  pessoaId: number | null,
  sucesso: boolean,
  motivo?: string,
): Promise<void> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { ipDaRequisicao } = await import("@/lib/segredo.server");
    const { idDoDispositivo, definirDispositivo } = await import(
      "@/integrations/iam/session.server"
    );
    const request = getRequest();
    const ip = ipDaRequisicao(request);
    const agente = request.headers.get("user-agent")?.slice(0, 300) ?? null;

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    let dispositivoId: string | null = pessoaId ? idDoDispositivo(pessoaId) : null;

    if (sucesso && pessoaId) {
      if (dispositivoId) {
        const r = await pool
          .request()
          .input("id", sql.UniqueIdentifier, dispositivoId)
          .input("pessoa", sql.Int, pessoaId)
          .query(
            `UPDATE gestor.dispositivos_conhecidos SET ultimo_acesso=SYSDATETIMEOFFSET()
              WHERE id=@id AND pessoa_id=@pessoa`,
          );
        // O cookie apontava para uma linha que não é (mais) desta pessoa —
        // navegador reaproveitado, ou o teto de 20 do cookie já a descartou.
        if ((r.rowsAffected[0] ?? 0) === 0) dispositivoId = null;
      }
      if (!dispositivoId) {
        const r = await pool
          .request()
          .input("pessoa", sql.Int, pessoaId)
          .query(
            `INSERT INTO gestor.dispositivos_conhecidos (pessoa_id)
             OUTPUT INSERTED.id
             VALUES (@pessoa)`,
          );
        dispositivoId = (r.recordset[0] as { id: string }).id;
        definirDispositivo(pessoaId, dispositivoId);
      }
    }

    await pool
      .request()
      .input("pessoa", sql.Int, pessoaId)
      .input("ip", sql.NVarChar, ip)
      .input("dispositivo", sql.UniqueIdentifier, dispositivoId)
      .input("agente", sql.NVarChar, agente)
      .input("sucesso", sql.Bit, sucesso)
      .input("motivo", sql.NVarChar, motivo?.slice(0, 60) ?? null)
      .query(
        `INSERT INTO gestor.registros_de_acesso
           (pessoa_id, ip, dispositivo_id, agente, sucesso, motivo)
         VALUES (@pessoa, @ip, @dispositivo, @agente, @sucesso, @motivo)`,
      );
  } catch (e) {
    console.warn("[fluxo] acesso não registrou:", (e as Error)?.message);
  }
}

export type AcessoRegistrado = {
  em: string;
  ip: string | null;
  agente: string | null;
  sucesso: boolean;
  motivo: string | null;
};

/** As minhas últimas entradas — só as minhas. Ver a própria não é gerência. */
export const meusAcessos = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ acessos: AcessoRegistrado[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT TOP (20) em, ip, agente, sucesso, motivo
           FROM gestor.registros_de_acesso
          WHERE pessoa_id=@eu
          ORDER BY em DESC`,
      );
    return {
      acessos: (
        r.recordset as { em: Date; ip: string | null; agente: string | null; sucesso: boolean; motivo: string | null }[]
      ).map((a) => ({
        em: a.em.toISOString(),
        ip: a.ip,
        agente: a.agente,
        sucesso: !!a.sucesso,
        motivo: a.motivo,
      })),
    };
  }),
);

export type DispositivoConhecido = {
  id: string;
  apelido: string | null;
  primeiroAcesso: string;
  ultimoAcesso: string;
  confiavel: boolean;
  esteAparelho: boolean;
};

/** Os dispositivos que a pessoa já usou para entrar. */
export const meusDispositivos = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ dispositivos: DispositivoConhecido[] }> => {
    const { idDoDispositivo } = await import("@/integrations/iam/session.server");
    const esteId = idDoDispositivo(eu);

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT id, apelido, primeiro_acesso, ultimo_acesso, confiavel
           FROM gestor.dispositivos_conhecidos
          WHERE pessoa_id=@eu
          ORDER BY ultimo_acesso DESC`,
      );
    return {
      dispositivos: (
        r.recordset as {
          id: string;
          apelido: string | null;
          primeiro_acesso: Date;
          ultimo_acesso: Date;
          confiavel: boolean;
        }[]
      ).map((d) => ({
        id: d.id,
        apelido: d.apelido,
        primeiroAcesso: d.primeiro_acesso.toISOString(),
        ultimoAcesso: d.ultimo_acesso.toISOString(),
        confiavel: !!d.confiavel,
        esteAparelho: esteId !== null && d.id.toLowerCase() === esteId.toLowerCase(),
      })),
    };
  }),
);

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Dá um nome ao dispositivo — "Notebook do escritório" em vez de um id. */
export const renomearDispositivo = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string; apelido: string }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Dispositivo inválido");
      return { id, apelido: texto(e?.apelido, 80) || null };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string; apelido: string | null }): Promise<{ ok: boolean }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("eu", sql.Int, eu)
        .input("apelido", sql.NVarChar, d.apelido)
        .query(
          `UPDATE gestor.dispositivos_conhecidos SET apelido=@apelido
            WHERE id=@id AND pessoa_id=@eu`,
        );
      return { ok: (r.rowsAffected[0] ?? 0) > 0 };
    }),
  );
