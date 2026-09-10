// Tarefas vistas pelo bot: criar uma, e montar o dia de alguém.
// EXCLUSIVO do servidor — carregue dentro do handler.
//
// Por que não reaproveita `salvarTarefa` de `@/lib/tarefas.functions`: aquela é
// uma server function embrulhada em `semIdentidade`, que exige a sessão da IAM.
// No Telegram não existe sessão — existe o `from.id` autenticado pelo Telegram e
// o vínculo gravado. Mesma razão pela qual `conversa.server.ts` reescreve o
// filtro de permissão, e a dívida é a mesma: dois lugares para uma regra.
//
// O que NÃO se repete aqui, de propósito: recorrência, pack, checklist, pontos
// por conclusão. A tarefa nascida no Telegram é a mais simples que existe —
// título, descrição, prazo, responsável. O resto se ajusta na tela.

/* ------------------------- Fuso ------------------------- */

/**
 * Todo o sistema pensa em Brasília; o banco guarda UTC.
 *
 * `prazo` é DATETIMEOFFSET gravado em +00:00, e a convenção já praticada nos
 * dados é 23:59 de Brasília — que em UTC vira 02:59 do dia SEGUINTE. Isso não é
 * detalhe: `CAST(prazo AS date)` devolve o dia de amanhã para uma tarefa que
 * vence hoje, e foi exatamente o que fez as consultas do bot errarem o dia.
 *
 * Medido no cadastro atual, no mesmo instante: "vence hoje" dava 3 tarefas pelo
 * UTC e 12 pelo horário de Brasília. O relatório das 7h chegaria quase vazio.
 *
 * A conversão é feita NO BANCO, com `AT TIME ZONE`, e não subtraindo três horas
 * no JavaScript: o nome do fuso carrega as regras dele. O Brasil não tem mais
 * horário de verão desde 2019, mas se voltar a ter, é o banco que fica sabendo —
 * um `-3` escrito no código, não.
 */
const FUSO_BR = "E. South America Standard Time";

/** A data (sem hora) de uma coluna, lida em Brasília. */
export const dataBr = (coluna: string) => `CAST(${coluna} AT TIME ZONE '${FUSO_BR}' AS date)`;

/** Hoje, em Brasília. */
export const HOJE_BR = `CAST(SYSDATETIMEOFFSET() AT TIME ZONE '${FUSO_BR}' AS date)`;

/** Brasília é UTC-3 o ano inteiro desde 2019. Só usado para MONTAR um prazo. */
const OFFSET_BR_MS = 3 * 60 * 60 * 1000;

/** Para formatar. O `Intl` conhece as regras do fuso; o `-3` acima, não. */
const TZ_BR = "America/Sao_Paulo";

/**
 * A data do prazo como a pessoa a escreveu.
 *
 * O `timeZone` não é opcional: a Railway roda em UTC e o prazo é gravado às
 * 02:59Z do dia seguinte, então formatar sem fuso mostrava SEMPRE o dia
 * seguinte. Uma tarefa para 10/09 aparecia no bot como 11/09.
 */
export function diaBr(d: Date): string {
  return new Date(d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TZ_BR,
  });
}

/**
 * Dias de atraso, contados em dias de Brasília. Zero ou negativo = no prazo.
 *
 * Mesmo motivo de `diaBr`: contar com o relógio do processo dava um dia a menos
 * durante quase todo o expediente, porque o prazo já está no dia seguinte em
 * UTC. O sinal de "⚠️ N dias de atraso" simplesmente não aparecia.
 */
export function atrasoEmDiasBr(prazo: Date): number {
  const p = new Date(new Date(prazo).getTime() - OFFSET_BR_MS);
  const inicioDoPrazo = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate());
  const h = hojeEmBrasilia();
  return Math.round((Date.UTC(h.ano, h.mes, h.dia) - inicioDoPrazo) / 86_400_000);
}

/** Os campos de calendário de hoje em Brasília, lidos pelos getters UTC. */
export function hojeEmBrasilia(): { ano: number; mes: number; dia: number } {
  const d = new Date(Date.now() - OFFSET_BR_MS);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate() };
}

/**
 * 23:59 de Brasília do dia dado, em UTC.
 *
 * É a convenção que a tela já grava (02:59Z do dia seguinte). Prazo é um DIA,
 * não um instante: gravar meia-noite faria a tarefa vencer no começo do dia em
 * que ela deveria ser feita.
 */
export function fimDoDiaBr(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes, dia, 23, 59, 0) + OFFSET_BR_MS);
}

/**
 * Lê um prazo escrito por gente.
 *
 * Aceita o que as pessoas realmente digitam: "hoje", "amanhã", "20/09",
 * "20/09/2026", "20-09". Sem ano, assume o ano corrente — e se a data já passou
 * há mais de um mês, o ano que vem, porque "02/01" digitado em dezembro é
 * janeiro que vem, não janeiro que passou.
 *
 * Devolve `null` quando não entende, e quem chama pergunta de novo. Chutar uma
 * data aqui seria pior que perguntar: a pessoa só descobriria o engano quando a
 * tarefa vencesse no dia errado.
 */
export function lerPrazo(bruto: string): Date | null {
  // Escapes explícitos: "amanhã" e "amanha" têm que cair no mesmo lugar, e um
  // intervalo de combinantes escrito literal é ilegível e fácil de quebrar.
  const t = bruto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const hoje = hojeEmBrasilia();

  if (t === "hoje") return fimDoDiaBr(hoje.ano, hoje.mes, hoje.dia);
  if (t === "amanha") return fimDoDiaBr(hoje.ano, hoje.mes, hoje.dia + 1);
  if (t === "depois de amanha") return fimDoDiaBr(hoje.ano, hoje.mes, hoje.dia + 2);

  const m = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/.exec(t);
  if (!m) return null;

  const dia = Number(m[1]);
  const mes = Number(m[2]) - 1;
  if (dia < 1 || dia > 31 || mes < 0 || mes > 11) return null;

  let ano: number;
  if (m[3]) {
    const n = Number(m[3]);
    ano = n < 100 ? 2000 + n : n;
  } else {
    ano = hoje.ano;
    /* Um mês de tolerância para trás: "05/09" digitado em 10/09 é atraso
       recente, e a pessoa quis mesmo o dia 5. Mais que isso é virada de ano. */
    const tentativa = fimDoDiaBr(ano, mes, dia);
    const limite = fimDoDiaBr(hoje.ano, hoje.mes, hoje.dia - 31);
    if (tentativa < limite) ano += 1;
  }

  const d = fimDoDiaBr(ano, mes, dia);
  // `Date.UTC` acomoda 31/02 virando 03/03 em silêncio. Conferir o mês de volta
  // é o que transforma isso em "não entendi" em vez de um prazo inventado.
  const conferir = new Date(d.getTime() - OFFSET_BR_MS);
  if (conferir.getUTCMonth() !== mes || conferir.getUTCDate() !== dia) return null;
  return d;
}

/* ------------------------- Criação ------------------------- */

export interface NovaTarefa {
  titulo: string;
  descricao: string | null;
  prazo: Date;
  responsavelId: number;
  criadoPor: number;
}

/**
 * Grava a tarefa e devolve o id.
 *
 * Três coisas que acompanham a linha e não são enfeite:
 *
 * - `setor` sai do perfil do RESPONSÁVEL, não de quem criou. O setor é o que
 *   decide quem enxerga a tarefa (ver `filtroPorPapel`); pendurá-la no setor de
 *   quem pediu esconderia a tarefa do time de quem vai fazer.
 * - `pontos` é 10, que é o valor praticado em todas as 86 tarefas do banco,
 *   independente da prioridade. Zero (o padrão da coluna) faria a conclusão dela
 *   não valer nada no placar.
 * - `ordem` vai para o fim da fila da pessoa. Zero empataria com o topo e a
 *   tarefa nova apareceria no meio do quadro dela sem motivo.
 */
export async function criarTarefa(t: NovaTarefa): Promise<string> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();

  const perfil = await pool
    .request()
    .input("p", sql.Int, t.responsavelId)
    .query(`SELECT setor FROM gestor.perfis WHERE pessoa_id=@p`);
  const setor = (perfil.recordset[0] as { setor: string | null } | undefined)?.setor ?? "sem-setor";

  const r = await pool
    .request()
    .input("titulo", sql.NVarChar, t.titulo)
    .input("descricao", sql.NVarChar, t.descricao)
    .input("setor", sql.NVarChar, setor)
    .input("por", sql.Int, t.criadoPor)
    .input("responsavel", sql.Int, t.responsavelId)
    .input("prazo", sql.DateTimeOffset, t.prazo).query(`
      DECLARE @nova TABLE (id UNIQUEIDENTIFIER);

      INSERT INTO gestor.tarefas
        (titulo, descricao, setor, criado_por, responsavel_id, prazo, pontos, ordem)
      OUTPUT inserted.id INTO @nova
      SELECT @titulo, @descricao, @setor, @por, @responsavel, @prazo, 10,
             ISNULL((SELECT MAX(ordem) FROM gestor.tarefas
                      WHERE responsavel_id=@responsavel AND arquivada_em IS NULL), 0) + 1;

      /* Mesmo aviso que a tela cria ao delegar, e pelo mesmo motivo: a sineta do
         app não pode depender de por onde a tarefa entrou. Só quando o
         responsável não é quem criou — ninguém precisa ser avisado de si. */
      INSERT INTO gestor.notificacoes
        (destinatario_id, de_pessoa_id, tipo, titulo, descricao, tarefa_id)
      SELECT @responsavel, @por, 'atribuida', N'Nova tarefa', @titulo, n.id
        FROM @nova n
       WHERE @responsavel <> @por;

      SELECT id FROM @nova;`);

  return (r.recordset[0] as { id: string }).id;
}

/**
 * Quem esta pessoa pode transformar em responsável.
 *
 * O MESMO alcance de `pessoasDoMeuEscopo`, e de propósito: poder ver a agenda de
 * alguém e não poder lhe passar uma tarefa seria uma distinção que ninguém
 * consegue explicar. Inclui a própria pessoa, que é o caso mais comum.
 */
export async function possiveisResponsaveis(
  pessoaId: number,
): Promise<{ pessoa_id: number; nome: string }[]> {
  const { papelEsetor } = await import("@/lib/perfil.functions");
  const { papel, setor } = await papelEsetor(pessoaId);
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();

  const req = pool.request().input("eu", sql.Int, pessoaId);
  let onde = "nome IS NOT NULL";
  if (papel !== "gerente") {
    if (!setor) onde += " AND pessoa_id=@eu";
    else {
      req.input("setor", sql.NVarChar, setor);
      onde += " AND (setor=@setor OR pessoa_id=@eu)";
    }
  }
  const r = await req.query(
    `SELECT TOP 30 pessoa_id, nome FROM gestor.perfis WHERE ${onde} ORDER BY nome`,
  );
  return r.recordset as { pessoa_id: number; nome: string }[];
}

/* --------------------- Resumo do dia --------------------- */

export interface LinhaDoDia {
  id: string;
  titulo: string;
  prazo: Date;
  situacao: string;
  prioridade: string;
  /** Dias de atraso; 0 quando vence hoje. */
  atraso: number;
}

/**
 * O dia de uma pessoa: o que vence hoje e o que ficou para trás.
 *
 * O atraso é calculado NO BANCO, em dias de Brasília, para não depender do fuso
 * do processo — a Railway roda em UTC, e às 21h de Brasília já é o dia seguinte
 * lá. Um relatório que conta "1 dia de atraso" para quem está no prazo é pior
 * que não ter relatório.
 */
export async function tarefasDoDia(pessoaId: number): Promise<LinhaDoDia[]> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, pessoaId)
    .query(
      `SELECT TOP 30 id, titulo, prazo, situacao, prioridade,
              DATEDIFF(day, ${dataBr("prazo")}, ${HOJE_BR}) AS atraso
         FROM gestor.tarefas
        WHERE responsavel_id=@eu
          AND arquivada_em IS NULL
          AND situacao <> 'concluida'
          AND ${dataBr("prazo")} <= ${HOJE_BR}
        ORDER BY prazo, ordem`,
    );
  return r.recordset as LinhaDoDia[];
}

/** Todo mundo com Telegram vinculado — a lista que o relatório das 7h percorre. */
export async function pessoasComTelegram(): Promise<
  { pessoaId: number; chatId: number; nome: string }[]
> {
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool.request().query(
    `SELECT c.pessoa_id, c.chat_id, p.nome
       FROM gestor.telegram_contas c
       JOIN gestor.perfis p ON p.pessoa_id = c.pessoa_id
      WHERE p.nome IS NOT NULL`,
  );
  return (r.recordset as { pessoa_id: number; chat_id: string | number; nome: string }[]).map(
    (l) => ({ pessoaId: l.pessoa_id, chatId: Number(l.chat_id), nome: l.nome }),
  );
}
