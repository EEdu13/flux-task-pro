import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* Recompensas (06/11/2026) — TESTE do Eduardo, para mostrar ao gestor dele.
 *
 * Quanto cada pessoa do TI ganharia no mês, com teto de R$ 300, a partir das
 * tarefas e do pack que concluiu no CONECTA. NINGUÉM além do dono vê: as
 * funções recusam qualquer outra sessão, a aba e o botão só aparecem para ele,
 * e bonificar não grava histórico nem aviso — os participantes não podem saber.
 *
 * Regras combinadas com o Eduardo:
 *   - Pack: R$ 6 por dia útil, dividido pelos itens do pack daquele dia.
 *     Item concluído no prazo ganha a sua parte; atrasado não ganha nada.
 *   - Tarefa criada pelo Eduardo: R$ 15 (projeto/módulo, título com "N/M"),
 *     R$ 8 (operacional, o padrão) ou R$ 3 (rápida) — ele ajusta no botão.
 *     No prazo 100%, atrasada 50%.
 *   - Tarefa criada por eles (ou por outra pessoa): R$ 0, a não ser que o
 *     Eduardo BONIFIQUE (R$ 2, 5 ou 10). No prazo 100%, atrasada 50%.
 *   - Conta o que foi CONCLUÍDO dentro do mês. Teto de R$ 300; o que passa
 *     aparece como "acima do teto" e não acumula.
 *
 * O valor escolhido mora em `gestor.recompensa_valores` (uma linha por
 * tarefa). Sem linha vale o padrão; linha com 0 é "não conta".
 */

/** Quem enxerga e mexe. Só ele. */
const DONO = Number(process.env.RECOMPENSAS_DONO_ID ?? 465);
/** Quem participa do teste: Lucas, Milena, Reginaldo e Igor. */
const PARTICIPANTES = [290, 537, 467, 195];
export const TETO = 300;
export const PACK_POR_DIA = 6;
export const VALORES_DO_DONO = [3, 8, 15] as const;
export const VALORES_DE_BONUS = [2, 5, 10] as const;

const ehModulo = (titulo: string) => /\b\d+\s*\/\s*\d+\b/.test(titulo);

/** O padrão de uma tarefa sem valor escolhido. */
function valorPadrao(criadoPor: number, titulo: string): number {
  if (criadoPor !== DONO) return 0;
  return ehModulo(titulo) ? 15 : 8;
}

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : null;

function exigirDono(eu: number) {
  if (eu !== DONO) throw new Error("Não encontrado.");
}

/* ———————————————————————— quem vê ———————————————————————— */

export const souDonoDasRecompensas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ ok: boolean }> => ({ ok: eu === DONO })),
);

/* ———————————————————— valor de uma tarefa ———————————————————— */

export type ValorDaTarefa = {
  participa: boolean;
  doDono: boolean;
  padrao: number;
  escolhido: number | null;
  valor: number;
  opcoes: number[];
};

export const valorDaTarefa = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { tarefaId: string }) => {
      const id = guid(e?.tarefaId);
      if (!id) throw new Error("Tarefa inválida");
      return { tarefaId: id };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string }): Promise<ValorDaTarefa | null> => {
      if (eu !== DONO) return null;
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.tarefaId)
        .query(
          `SELECT t.titulo, t.criado_por, t.responsavel_id, t.no_pack, v.valor
             FROM gestor.tarefas t
             LEFT JOIN gestor.recompensa_valores v ON v.tarefa_id = t.id
            WHERE t.id = @id`,
        );
      const l = r.recordset[0] as
        | { titulo: string; criado_por: number; responsavel_id: number; no_pack: boolean; valor: number | null }
        | undefined;
      if (!l || l.no_pack || !PARTICIPANTES.includes(l.responsavel_id)) {
        return { participa: false, doDono: false, padrao: 0, escolhido: null, valor: 0, opcoes: [] };
      }
      const doDono = l.criado_por === DONO;
      const padrao = valorPadrao(l.criado_por, l.titulo);
      const escolhido = l.valor === null ? null : Number(l.valor);
      return {
        participa: true,
        doDono,
        padrao,
        escolhido,
        valor: escolhido ?? padrao,
        opcoes: doDono ? [...VALORES_DO_DONO] : [...VALORES_DE_BONUS],
      };
    }),
  );

/**
 * Escolhe o valor de uma tarefa. `valor: null` apaga a escolha (volta ao
 * padrão — para tarefa deles, o padrão é 0, ou seja, "tirar a bonificação").
 * Sem histórico, sem aviso: é o que mantém o teste invisível.
 */
export const definirValorDaTarefa = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { tarefaId: string; valor: number | null }) => {
      const id = guid(e?.tarefaId);
      if (!id) throw new Error("Tarefa inválida");
      const valor =
        e?.valor === null || e?.valor === undefined ? null : Math.round(Number(e.valor) * 100) / 100;
      if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > TETO)) {
        throw new Error("Valor inválido");
      }
      return { tarefaId: id, valor };
    }),
  )
  .handler(
    comSessao(async (eu, d: { tarefaId: string; valor: number | null }) => {
      exigirDono(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      if (d.valor === null) {
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, d.tarefaId)
          .query(`DELETE FROM gestor.recompensa_valores WHERE tarefa_id = @id`);
      } else {
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, d.tarefaId)
          .input("v", sql.Decimal(9, 2), d.valor)
          .input("eu", sql.Int, eu)
          .query(
            `MERGE gestor.recompensa_valores AS alvo
             USING (SELECT @id AS tarefa_id) AS f ON alvo.tarefa_id = f.tarefa_id
             WHEN MATCHED THEN UPDATE SET valor = @v, definido_por = @eu, definido_em = SYSDATETIMEOFFSET()
             WHEN NOT MATCHED THEN INSERT (tarefa_id, valor, definido_por) VALUES (@id, @v, @eu);`,
          );
      }
      return { ok: true };
    }),
  );

/* ———————————————————————— o painel ———————————————————————— */

export type LinhaDoExtrato = {
  tarefaId: string;
  titulo: string;
  origem: "pack" | "tarefa" | "bonus";
  concluidaEm: string;
  noPrazo: boolean;
  base: number;
  ganho: number;
  escolhido: number | null;
  padrao: number;
  opcoes: number[];
};

export type PessoaNoPainel = {
  id: string;
  nome: string;
  /** Desligado pelo dono: não contabiliza (o "ganharia" segue visível). */
  ativo: boolean;
  pack: number;
  packPossivel: number;
  tarefas: number;
  bonus: number;
  perdidoAtraso: number;
  bruto: number;
  pago: number;
  acimaDoTeto: number;
  emAberto: number;
  extrato: LinhaDoExtrato[];
  aguardando: LinhaDoExtrato[];
};

export type PainelDeRecompensas = {
  mes: string;
  teto: number;
  packPorDia: number;
  diasUteis: number;
  diasUteisAteHoje: number;
  pessoas: PessoaNoPainel[];
};

const FUSO = "E. South America Standard Time";

export const painelDeRecompensas = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { mes?: string }) => {
      const mes = typeof e?.mes === "string" && /^\d{4}-\d{2}$/.test(e.mes) ? e.mes : null;
      return { mes };
    }),
  )
  .handler(
    comSessao(async (eu, d: { mes: string | null }): Promise<PainelDeRecompensas> => {
      exigirDono(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      // O mês em Brasília. Sem mês, o atual.
      const agoraBr = new Date(Date.now() - 3 * 3600_000);
      const mes = d.mes ?? agoraBr.toISOString().slice(0, 7);
      const [ano, m] = mes.split("-").map(Number);
      const ini = `${mes}-01T00:00:00-03:00`;
      const prox = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
      const fim = `${prox}-01T00:00:00-03:00`;
      const ids = PARTICIPANTES.join(",");

      const r = await pool
        .request()
        .input("ini", sql.NVarChar, ini)
        .input("fim", sql.NVarChar, fim)
        .query(
          `DECLARE @i DATETIMEOFFSET(3) = CAST(@ini AS DATETIMEOFFSET(3)),
                   @f DATETIMEOFFSET(3) = CAST(@fim AS DATETIMEOFFSET(3));

           -- 1) o que foi concluído no mês
           SELECT c.pessoa_id, c.tarefa_id, c.no_prazo, c.em,
                  t.titulo, t.no_pack, t.criado_por,
                  CONVERT(CHAR(10), CAST(t.prazo AT TIME ZONE N'${FUSO}' AS DATE), 23) AS dia_prazo,
                  v.valor
             FROM gestor.conclusoes c
             JOIN gestor.tarefas t ON t.id = c.tarefa_id
             LEFT JOIN gestor.recompensa_valores v ON v.tarefa_id = t.id
            WHERE c.pessoa_id IN (${ids}) AND c.em >= @i AND c.em < @f;

           -- 2) quantos itens de pack cada pessoa tinha em cada dia do mês
           SELECT t.responsavel_id AS pessoa_id,
                  CONVERT(CHAR(10), CAST(t.prazo AT TIME ZONE N'${FUSO}' AS DATE), 23) AS dia,
                  COUNT(*) AS n
             FROM gestor.tarefas t
            WHERE t.no_pack = 1 AND t.responsavel_id IN (${ids})
              AND t.prazo >= @i AND t.prazo < @f
              AND (t.arquivada_em IS NULL OR t.concluida_em IS NOT NULL)
            GROUP BY t.responsavel_id, CAST(t.prazo AT TIME ZONE N'${FUSO}' AS DATE);

           -- 3) o que ainda está aberto valendo dinheiro (fora do pack)
           SELECT t.responsavel_id AS pessoa_id, t.titulo, t.criado_por, v.valor
             FROM gestor.tarefas t
             LEFT JOIN gestor.recompensa_valores v ON v.tarefa_id = t.id
            WHERE t.no_pack = 0 AND t.responsavel_id IN (${ids})
              AND t.concluida_em IS NULL AND t.arquivada_em IS NULL
              AND t.criada_em <= SYSDATETIMEOFFSET();

           -- 4) nomes
           SELECT pessoa_id, nome FROM gestor.perfis WHERE pessoa_id IN (${ids});

           -- 5) quem o dono desligou (sem linha = ligado)
           SELECT pessoa_id, ativo FROM gestor.recompensa_participantes WHERE pessoa_id IN (${ids});`,
        );

      const [concl, packDia, abertas, nomes, chaves] = r.recordsets as unknown as [
        {
          pessoa_id: number;
          tarefa_id: string;
          no_prazo: boolean;
          em: Date;
          titulo: string;
          no_pack: boolean;
          criado_por: number;
          dia_prazo: string | null;
          valor: number | null;
        }[],
        { pessoa_id: number; dia: string; n: number }[],
        { pessoa_id: number; titulo: string; criado_por: number; valor: number | null }[],
        { pessoa_id: number; nome: string }[],
        { pessoa_id: number; ativo: boolean }[],
      ];

      // dias úteis do mês (seg a sex) e quantos já passaram (incluindo hoje)
      const hojeIso = agoraBr.toISOString().slice(0, 10);
      let diasUteis = 0;
      let diasUteisAteHoje = 0;
      for (let dia = 1; dia <= 31; dia++) {
        const dt = new Date(Date.UTC(ano, m - 1, dia));
        if (dt.getUTCMonth() !== m - 1) break;
        const sem = dt.getUTCDay();
        if (sem === 0 || sem === 6) continue;
        diasUteis++;
        if (dt.toISOString().slice(0, 10) <= hojeIso) diasUteisAteHoje++;
      }

      const itensNoDia = new Map<string, number>();
      for (const l of packDia) itensNoDia.set(`${l.pessoa_id}|${l.dia}`, l.n);

      const pessoas: PessoaNoPainel[] = PARTICIPANTES.map((pid) => {
        const extrato: LinhaDoExtrato[] = [];
        const aguardando: LinhaDoExtrato[] = [];
        let pack = 0;
        let tarefas = 0;
        let bonus = 0;
        let perdidoAtraso = 0;

        for (const c of concl.filter((x) => x.pessoa_id === pid)) {
          const escolhido = c.valor === null ? null : Number(c.valor);
          if (c.no_pack) {
            const n = itensNoDia.get(`${pid}|${c.dia_prazo}`) || 1;
            const base = PACK_POR_DIA / n;
            const ganho = c.no_prazo ? base : 0;
            pack += ganho;
            if (!c.no_prazo) perdidoAtraso += base;
            extrato.push({
              tarefaId: c.tarefa_id,
              titulo: c.titulo,
              origem: "pack",
              concluidaEm: c.em.toISOString(),
              noPrazo: !!c.no_prazo,
              base,
              ganho,
              escolhido: null,
              padrao: base,
              opcoes: [],
            });
            continue;
          }
          const doDono = c.criado_por === DONO;
          const padrao = valorPadrao(c.criado_por, c.titulo);
          const base = escolhido ?? padrao;
          const ganho = c.no_prazo ? base : base / 2;
          const linha: LinhaDoExtrato = {
            tarefaId: c.tarefa_id,
            titulo: c.titulo,
            origem: doDono ? "tarefa" : "bonus",
            concluidaEm: c.em.toISOString(),
            noPrazo: !!c.no_prazo,
            base,
            ganho,
            escolhido,
            padrao,
            opcoes: doDono ? [...VALORES_DO_DONO] : [...VALORES_DE_BONUS],
          };
          if (!doDono && escolhido === null) {
            aguardando.push(linha);
            continue;
          }
          if (doDono) tarefas += ganho;
          else bonus += ganho;
          if (!c.no_prazo) perdidoAtraso += base - ganho;
          extrato.push(linha);
        }

        let emAberto = 0;
        for (const a of abertas.filter((x) => x.pessoa_id === pid)) {
          emAberto += a.valor === null ? valorPadrao(a.criado_por, a.titulo) : Number(a.valor);
        }

        const ativo = chaves.find((x) => x.pessoa_id === pid)?.ativo ?? true;
        const bruto = pack + tarefas + bonus;
        const pago = ativo ? Math.min(TETO, bruto) : 0;
        extrato.sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));
        aguardando.sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm));
        const red = (v: number) => Math.round(v * 100) / 100;
        return {
          id: String(pid),
          nome: nomes.find((n) => n.pessoa_id === pid)?.nome ?? `#${pid}`,
          ativo,
          pack: red(pack),
          packPossivel: red(diasUteis * PACK_POR_DIA),
          tarefas: red(tarefas),
          bonus: red(bonus),
          perdidoAtraso: red(perdidoAtraso),
          bruto: red(bruto),
          pago: red(pago),
          acimaDoTeto: ativo ? red(Math.max(0, bruto - TETO)) : 0,
          emAberto: red(emAberto),
          extrato,
          aguardando,
        };
      });

      return { mes, teto: TETO, packPorDia: PACK_POR_DIA, diasUteis, diasUteisAteHoje, pessoas };
    }),
  );

/* ——————————————— ligar / desligar um participante ——————————————— */

/**
 * Liga ou desliga a bonificação de uma pessoa (06/11/2026: "o Igor ainda não
 * pode ganhar; desligo e, quando ele começar a receber, ligo de novo").
 * Desligado, o painel mostra quanto ela ganharia, mas paga R$ 0.
 */
export const ligarParticipante = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((e: { quem: string; ativo: boolean }) => {
      const quem = Number(e?.quem);
      if (!PARTICIPANTES.includes(quem)) throw new Error("Pessoa fora do teste");
      return { quem, ativo: e?.ativo !== false };
    }),
  )
  .handler(
    comSessao(async (eu, d: { quem: number; ativo: boolean }) => {
      exigirDono(eu);
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("p", sql.Int, d.quem)
        .input("a", sql.Bit, d.ativo ? 1 : 0)
        .input("eu", sql.Int, eu)
        .query(
          `MERGE gestor.recompensa_participantes AS alvo
           USING (SELECT @p AS pessoa_id) AS f ON alvo.pessoa_id = f.pessoa_id
           WHEN MATCHED THEN UPDATE SET ativo = @a, alterado_por = @eu, alterado_em = SYSDATETIMEOFFSET()
           WHEN NOT MATCHED THEN INSERT (pessoa_id, ativo, alterado_por) VALUES (@p, @a, @eu);`,
        );
      return { ok: true };
    }),
  );
