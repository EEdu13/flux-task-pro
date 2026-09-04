// Registro de acesso. EXCLUSIVO do servidor — carregue dentro dos handlers:
// const { registrarAcesso } = await import("@/lib/acesso.server");
//
// Vive separado de `acesso.functions.ts` por um motivo mecânico, não estético.
// Aquele arquivo é importado pela tela de Configurações, ou seja, VAI para o
// bundle do cliente; e o que está aqui não é uma server function — é função
// comum, que o plugin do TanStack não tem como esvaziar. Junto dos outros, o
// corpo desta função viajaria inteiro para o navegador, arrastando `getRequest`
// e o driver do SQL Server atrás. O próprio build recusa, e com razão.

/**
 * Registra uma tentativa de login e, quando bem-sucedida, atualiza (ou cria) o
 * dispositivo conhecido.
 *
 * Chamada de dentro de `iamLogin`, no mesmo pedido, porque marcar o
 * dispositivo escreve um cookie — e cookie só pode ser escrito enquanto a
 * resposta ainda está sendo montada. Uma tarefa solta em segundo plano
 * chegaria tarde demais: a resposta já teria saído sem o cookie.
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
