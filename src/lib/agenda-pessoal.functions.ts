import { createServerFn } from "@tanstack/react-start";
import { comSessao, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* A parte PRIVADA da agenda do dia: anotações e lembretes.
 *
 * Mesma regra do bloco de notas (`notas.functions.ts`): cada pessoa lê e
 * escreve só as suas, e quem decide de quem são é a sessão — nenhuma função
 * aqui recebe pessoa de fora, então não há como pedir as de outra pessoa.
 *
 * Tabelas criadas em 29/09/2026, com o ok do usuário:
 *   gestor.anotacoes_do_dia  (pessoa_id, dia) → texto
 *   gestor.lembretes         id, pessoa_id, quando, texto, avisado_em
 *
 * O lembrete não tem relógio próprio. Quem o entrega é a leitura da sineta
 * (`listarNotificacoes`), que o app já faz ao voltar para a janela e a cada
 * minuto: ela passa os vencidos para `gestor.notificacoes` antes de listar, e
 * dali o som e a notificação do Windows seguem o caminho de qualquer aviso.
 * Nenhuma sondagem nova — ver a nota sobre os intervalos de chamada.
 */

export type AnotacaoDoDia = { dia: string; texto: string; atualizadaEm: string };
export type Lembrete = { id: string; quando: string; texto: string; avisadoEm: string | null };

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const data = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!ISO_DATA.test(s)) throw new Error("Data inválida (use AAAA-MM-DD)");
  return s;
};
const guid = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error("Lembrete inválido");
  return s;
};

/** Teto do período pedido de uma vez. A agenda pede blocos de 28 dias; o
 *  calendário, a grade do mês (42). Mais que isso é engano, não uso. */
const DIAS_MAX = 62;

/**
 * Anotações e lembretes de um período, de uma vez.
 *
 * Um período e não um dia: a agenda troca de dia com as setas, e uma ida ao
 * servidor por dia seria um atraso por tecla. Com o bloco inteiro na mão, a
 * troca de dia não sai da máquina.
 *
 * O dia do lembrete é o de BRASÍLIA: o período vira instante com
 * `AT TIME ZONE`, como no resto do app — sem isso, um lembrete às 22h cairia no
 * dia seguinte, que é o que ele já é em UTC.
 */
export const listarAgendaPessoal = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { de: string; ate: string }) => {
      const de = data(e?.de);
      const ate = data(e?.ate);
      if (ate < de) throw new Error("Período invertido");
      const dias = (Date.parse(ate) - Date.parse(de)) / 86_400_000;
      if (dias > DIAS_MAX) throw new Error(`Período máximo de ${DIAS_MAX} dias`);
      return { de, ate };
    }),
  )
  .handler(
    comSessao(
      async (
        eu,
        d: { de: string; ate: string },
      ): Promise<{ anotacoes: AnotacaoDoDia[]; lembretes: Lembrete[] }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const r = await pool
          .request()
          .input("eu", sql.Int, eu)
          .input("de", sql.Date, d.de)
          .input("ate", sql.Date, d.ate)
          .query(
            `SELECT CONVERT(CHAR(10), dia, 23) AS dia, texto, atualizada_em
               FROM gestor.anotacoes_do_dia
              WHERE pessoa_id=@eu AND dia BETWEEN @de AND @ate;

             SELECT id, quando, texto, avisado_em
               FROM gestor.lembretes
              WHERE pessoa_id=@eu
                AND quando >= CAST(@de AS DATETIME2) AT TIME ZONE N'E. South America Standard Time'
                AND quando <  CAST(DATEADD(DAY, 1, @ate) AS DATETIME2) AT TIME ZONE N'E. South America Standard Time'
              ORDER BY quando;`,
          );
        const [notas, lembretes] = r.recordsets as unknown as [
          { dia: string; texto: string; atualizada_em: Date }[],
          { id: string; quando: Date; texto: string; avisado_em: Date | null }[],
        ];
        return {
          anotacoes: notas.map((n) => ({
            dia: n.dia,
            texto: n.texto,
            atualizadaEm: n.atualizada_em.toISOString(),
          })),
          lembretes: lembretes.map((l) => ({
            id: l.id,
            quando: l.quando.toISOString(),
            texto: l.texto,
            avisadoEm: l.avisado_em ? l.avisado_em.toISOString() : null,
          })),
        };
      },
    ),
  );

/**
 * Grava a anotação do dia. Texto vazio apaga.
 *
 * A tela salva a cada pausa de digitação, então duas gravações do mesmo dia
 * podem se cruzar no caminho; o `IF EXISTS` sozinho deixaria as duas tentarem
 * inserir. A segunda esbarra na chave primária, e isso quer dizer "a linha
 * existe" — ela então só atualiza. Mesmo raciocínio de `meuPerfil`.
 */
export const salvarAnotacao = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { dia: string; texto: string }) => ({
      dia: data(e?.dia),
      texto: typeof e?.texto === "string" ? e.texto.slice(0, 20_000) : "",
    })),
  )
  .handler(
    comSessao(
      async (eu, d: { dia: string; texto: string }): Promise<{ atualizadaEm: string | null }> => {
        const { getPool, sql } = await import("@/integrations/db.server");
        const pool = await getPool();
        const req = () =>
          pool
            .request()
            .input("eu", sql.Int, eu)
            .input("dia", sql.Date, d.dia)
            .input("texto", sql.NVarChar(sql.MAX), d.texto);

        if (!d.texto.trim()) {
          await req().query(`DELETE FROM gestor.anotacoes_do_dia WHERE pessoa_id=@eu AND dia=@dia`);
          return { atualizadaEm: null };
        }

        const atualizar = `UPDATE gestor.anotacoes_do_dia
                            SET texto=@texto, atualizada_em=SYSDATETIMEOFFSET()
                          WHERE pessoa_id=@eu AND dia=@dia;`;
        try {
          await req().query(
            `IF EXISTS (SELECT 1 FROM gestor.anotacoes_do_dia WHERE pessoa_id=@eu AND dia=@dia)
             ${atualizar}
           ELSE
             INSERT INTO gestor.anotacoes_do_dia (pessoa_id, dia, texto) VALUES (@eu, @dia, @texto);`,
          );
        } catch (e) {
          const n = (e as { number?: number })?.number;
          if (n !== 2627 && n !== 2601) throw e;
          await req().query(atualizar);
        }
        return { atualizadaEm: new Date().toISOString() };
      },
    ),
  );

/**
 * Cria um lembrete para quem está na sessão.
 *
 * Horário que já passou é recusado aqui também, e não só na tela: aceito, ele
 * seria entregue na próxima leitura da sineta, como se tivesse vencido agora.
 * A folga de um minuto cobre o relógio da máquina um pouco atrás do servidor.
 */
export const criarLembrete = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { quando: string; texto: string }) => {
      const quando = new Date(typeof e?.quando === "string" ? e.quando : NaN);
      if (Number.isNaN(quando.getTime())) throw new Error("Horário inválido");
      const texto = typeof e?.texto === "string" ? e.texto.trim().slice(0, 300) : "";
      if (!texto) throw new Error("Escreva do que é o lembrete");
      return { quando: quando.toISOString(), texto };
    }),
  )
  .handler(
    comSessao(async (eu, d: { quando: string; texto: string }): Promise<{ lembrete: Lembrete }> => {
      if (Date.parse(d.quando) < Date.now() - 60_000) throw new Error("Esse horário já passou");
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("eu", sql.Int, eu)
        .input("quando", sql.DateTimeOffset, new Date(d.quando))
        .input("texto", sql.NVarChar(300), d.texto)
        .query(
          `INSERT INTO gestor.lembretes (pessoa_id, quando, texto)
           OUTPUT inserted.id, inserted.quando, inserted.texto
           VALUES (@eu, @quando, @texto)`,
        );
      const l = r.recordset[0] as { id: string; quando: Date; texto: string };
      return {
        lembrete: { id: l.id, quando: l.quando.toISOString(), texto: l.texto, avisadoEm: null },
      };
    }),
  );

/** Apaga um lembrete. O `pessoa_id=@eu` é a fechadura: o id sozinho não prova de quem é. */
export const apagarLembrete = createServerFn({ method: "POST" })
  .validator(semIdentidade((e: { id: string }) => ({ id: guid(e?.id) })))
  .handler(
    comSessao(async (eu, d: { id: string }): Promise<{ ok: boolean }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("eu", sql.Int, eu)
        .query(`DELETE FROM gestor.lembretes WHERE id=@id AND pessoa_id=@eu`);
      return { ok: (r.rowsAffected[0] ?? 0) > 0 };
    }),
  );
