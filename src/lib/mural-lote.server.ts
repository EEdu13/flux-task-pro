/*
 * O lote diário do Mural (fase 2, 14/10/2026): as publicações automáticas —
 * conquistas, tempo de casa e boas-vindas — nascem aqui, UMA vez por dia,
 * e não a cada tela aberta.
 *
 * Como roda (sem relógio nem laço novo):
 *   - a primeira leitura do feed (ou do painel) depois das 06:00 de Brasília
 *     chama `garantirLoteDoDia()`, que não espera nada — dispara e volta;
 *   - cada servidor tenta no máximo uma vez por dia (e de novo 10 min depois,
 *     se falhar); quem consegue inserir a linha do dia em gestor.mural_lotes
 *     é o único que roda. Linha sem `concluido_em` há mais de 15 min é lote
 *     que caiu no meio, e outro servidor pode retomar;
 *   - cada publicação tem uma `chave_auto` única (tipo + pessoa + período):
 *     rodar duas vezes não repete nada, e uma conquista excluída não volta.
 *
 * Só coisas boas, nunca nota baixa: ninguém aparece por ter ido mal. E quem
 * pediu para ficar de fora (Configurações → Perfil, preferência
 * 'mural_conquistas' = '0') não aparece em nenhuma publicação automática.
 *
 * O custo no banco: uma ida com cinco leituras pequenas (o pack dos últimos
 * 45 dias pelo índice IX_tarefas_pack_prazo, as tarefas de uma semana, as
 * conclusões agrupadas por dia), e uma ida para gravar tudo de uma vez.
 */

import type { DiaBR } from "@/lib/mural.server";

const DIA_MS = 86_400_000;
/** Brasília é UTC−3 o ano inteiro (sem horário de verão desde 2019). */
const BRASILIA_MS = 3 * 3600_000;
const FUSO_SQL = "N'E. South America Standard Time'";

/** Marcos da sequência de pack fechado, do maior para o menor. */
const MARCOS_DO_PACK = [20, 10, 5];
/** Janela olhada para trás nas sequências de pack (dias corridos). */
const JANELA_PACK_DIAS = 45;
/** Recorde pessoal: a partir de quantas tarefas num dia vale celebrar. */
const RECORDE_MINIMO = 5;
/** Semana do setor: com menos tarefas que isto, 100% não diz muito. */
const SETOR_MINIMO = 5;

let diaFeito = "";
let rodando = false;
let tentarDepoisDe = 0;

/** Hora atual em Brasília (0–23). */
const horaEmBrasilia = (agora: Date) => new Date(agora.getTime() - BRASILIA_MS).getUTCHours();

/**
 * Garante que o lote de hoje rodou (ou está rodando em algum servidor).
 * Não espera: o feed responde na hora, e as publicações novas aparecem na
 * próxima leitura.
 */
export function garantirLoteDoDia(): void {
  if (rodando || Date.now() < tentarDepoisDe) return;
  const agora = new Date();
  if (horaEmBrasilia(agora) < 6) return;
  void import("@/lib/mural.server").then(({ diaNoBrasil, ehMuralInativo }) => {
    const hoje = diaNoBrasil(agora);
    if (diaFeito === hoje.iso || rodando) return;
    rodando = true;
    rodarLote(hoje)
      .then((n) => {
        diaFeito = hoje.iso;
        if (n > 0) console.info(`[mural] lote de ${hoje.iso}: ${n} publicação(ões) automática(s).`);
      })
      .catch((e: unknown) => {
        // Sem a migração não há o que fazer; tenta de novo daqui a meia hora.
        if (ehMuralInativo(e)) {
          tentarDepoisDe = Date.now() + 30 * 60_000;
          return;
        }
        console.warn("[mural] lote diário falhou:", (e as Error)?.message);
        tentarDepoisDe = Date.now() + 10 * 60_000;
      })
      .finally(() => {
        rodando = false;
      });
  });
}

/* -------------------- Datas (meia-noite UTC = o dia de Brasília) -------------------- */

const diaUtc = (d: DiaBR) => Date.UTC(d.ano, d.mes - 1, d.dia);
const isoDe = (diaMs: number) => new Date(diaMs).toISOString().slice(0, 10);
/** O instante da meia-noite de Brasília daquele dia. */
const meiaNoiteBR = (diaMs: number) => new Date(diaMs + BRASILIA_MS);
const ddmm = (diaMs: number) => {
  const d = new Date(diaMs);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/* -------------------- O lote -------------------- */

type Publicacao = {
  chave: string;
  selo: "pack" | "setor" | "recorde" | "primeira" | "tempo_casa" | "boas_vindas";
  titulo: string;
  texto: string;
  pessoas: number[];
};

/** Pega a trava do dia. Devolve false se outro servidor já rodou (ou roda). */
async function pegarTrava(diaIso: string): Promise<boolean> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("dia", sql.Date, diaIso)
    .query(
      `SET NOCOUNT ON;
       DECLARE @peguei BIT = 0;
       BEGIN TRY
         INSERT INTO gestor.mural_lotes (dia) VALUES (@dia);
         SET @peguei = 1;
       END TRY
       BEGIN CATCH
         IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;
         UPDATE gestor.mural_lotes
            SET iniciado_em = SYSDATETIMEOFFSET(), tentativas = tentativas + 1
          WHERE dia = @dia AND concluido_em IS NULL
            AND iniciado_em < DATEADD(MINUTE, -15, SYSDATETIMEOFFSET());
         IF @@ROWCOUNT > 0 SET @peguei = 1;
       END CATCH
       SELECT @peguei AS peguei;`,
    );
  return !!(r.recordset[0] as { peguei: boolean } | undefined)?.peguei;
}

async function rodarLote(hoje: DiaBR): Promise<number> {
  if (!(await pegarTrava(hoje.iso))) return 0;
  const publicacoes = await calcularPublicacoes(hoje);
  return gravar(hoje.iso, publicacoes);
}

async function calcularPublicacoes(hoje: DiaBR): Promise<Publicacao[]> {
  const { pessoasDoMural } = await import("@/lib/mural.server");
  const { ehFeriadoNacional } = await import("@/lib/dias-uteis");
  const { nomeCurto } = await import("@/lib/nome-curto");
  const { sectors } = await import("@/lib/fluxo-types");

  const hojeMs = diaUtc(hoje);
  const semana = new Date(hojeMs).getUTCDay(); // 0 = domingo
  const segundaDestaSemana = hojeMs - ((semana + 6) % 7) * DIA_MS;
  const semanaIni = segundaDestaSemana - 7 * DIA_MS;

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("hoje", sql.DateTimeOffset(3), meiaNoiteBR(hojeMs))
    .input("desde_pack", sql.DateTimeOffset(3), meiaNoiteBR(hojeMs - JANELA_PACK_DIAS * DIA_MS))
    .input("semana_ini", sql.DateTimeOffset(3), meiaNoiteBR(semanaIni))
    .input("semana_fim", sql.DateTimeOffset(3), meiaNoiteBR(segundaDestaSemana))
    .input("desde_rec", sql.DateTimeOffset(3), meiaNoiteBR(hojeMs - 365 * DIA_MS))
    .input("desde_3", sql.DateTimeOffset(3), meiaNoiteBR(hojeMs - 3 * DIA_MS))
    .query(
      `SET NOCOUNT ON;
       -- 1) Quem pediu para ficar de fora das publicações automáticas.
       SELECT pessoa_id FROM gestor.preferencias
        WHERE chave = N'mural_conquistas' AND valor = N'0';

       -- 2) O pack de cada pessoa em cada dia (até ontem): quantas tarefas e
       --    quantas concluídas até o dia do prazo. Tarefa tirada do quadro sem
       --    ser concluída (arquivada) não conta.
       SELECT t.responsavel_id AS pessoa_id, d.dia, COUNT(*) AS total,
              SUM(CASE WHEN t.situacao = 'concluida'
                        AND COALESCE(t.data_real_de_conclusao,
                                     CAST(t.concluida_em AT TIME ZONE ${FUSO_SQL} AS DATE)) <= d.dia
                       THEN 1 ELSE 0 END) AS feitas
         FROM gestor.tarefas t
        CROSS APPLY (SELECT CAST(t.prazo AT TIME ZONE ${FUSO_SQL} AS DATE) AS dia) d
        WHERE t.no_pack = 1 AND t.prazo >= @desde_pack AND t.prazo < @hoje
          AND NOT (t.arquivada_em IS NOT NULL AND t.situacao <> 'concluida')
        GROUP BY t.responsavel_id, d.dia;

       -- 3) Os setores na semana passada (segunda a domingo).
       SELECT t.setor, COUNT(*) AS total,
              SUM(CASE WHEN t.situacao = 'concluida' AND t.concluida_em < @semana_fim
                       THEN 1 ELSE 0 END) AS feitas
         FROM gestor.tarefas t
        WHERE t.prazo >= @semana_ini AND t.prazo < @semana_fim
          AND NOT (t.arquivada_em IS NOT NULL AND t.situacao <> 'concluida')
          AND t.setor <> N'sem-setor'
        GROUP BY t.setor;

       -- 4) Conclusões por pessoa e dia, no último ano (recorde pessoal).
       SELECT c.pessoa_id, CAST(c.em AT TIME ZONE ${FUSO_SQL} AS DATE) AS dia, COUNT(*) AS n
         FROM gestor.conclusoes c
        WHERE c.em >= @desde_rec
        GROUP BY c.pessoa_id, CAST(c.em AT TIME ZONE ${FUSO_SQL} AS DATE);

       -- 5) Quem concluiu a primeira tarefa no CONECTA nos últimos 3 dias.
       SELECT c.pessoa_id
         FROM gestor.conclusoes c
        GROUP BY c.pessoa_id
       HAVING MIN(c.em) >= @desde_3;`,
    );
  const sets = r.recordsets as unknown as Record<string, unknown>[][];
  const foraDoMural = new Set(((sets[0] ?? []) as { pessoa_id: number }[]).map((l) => l.pessoa_id));
  const pessoas = (await pessoasDoMural()).filter((p) => p.ativa && !foraDoMural.has(p.id));
  const porId = new Map(pessoas.map((p) => [p.id, p]));
  const nome = (id: number) => nomeCurto(porId.get(id)?.nome ?? "");
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

  const saida: Publicacao[] = [];

  /* ---- Pack fechado N dias úteis seguidos ---- */
  const pack = new Map<string, { total: number; feitas: number }>();
  const comPack = new Set<number>();
  for (const l of (sets[1] ?? []) as {
    pessoa_id: number;
    dia: Date;
    total: number;
    feitas: number;
  }[]) {
    pack.set(`${l.pessoa_id}|${iso(l.dia)}`, { total: l.total, feitas: l.feitas });
    comPack.add(l.pessoa_id);
  }
  const ehDiaUtil = (ms: number) => {
    const d = new Date(ms);
    const sem = d.getUTCDay();
    return (
      sem !== 0 &&
      sem !== 6 &&
      !ehFeriadoNacional(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    );
  };
  const limite = hojeMs - JANELA_PACK_DIAS * DIA_MS;
  for (const id of comPack) {
    if (!porId.has(id)) continue;
    let seguidos = 0;
    let inicio = 0;
    let quebrou = false;
    for (let d = hojeMs - DIA_MS; d >= limite; d -= DIA_MS) {
      if (!ehDiaUtil(d)) continue;
      const dia = pack.get(`${id}|${isoDe(d)}`);
      // Dia útil sem pack (férias, folga): não conta nem quebra.
      if (!dia) continue;
      if (dia.total > 0 && dia.feitas >= dia.total) {
        seguidos += 1;
        inicio = d;
      } else {
        quebrou = true;
        break;
      }
    }
    // Sequência mais longa que a janela: o começo é desconhecido, e o marco
    // dela já foi publicado quando aconteceu — não publica de novo.
    if (!quebrou && seguidos > 0 && inicio - limite < 7 * DIA_MS) continue;
    const marco = MARCOS_DO_PACK.find((m) => seguidos >= m);
    if (!marco) continue;
    saida.push({
      chave: `pack:${id}:${marco}:${isoDe(inicio)}`,
      selo: "pack",
      titulo: `${marco} dias úteis seguidos de pack fechado 🔥`,
      texto: `${nome(id)} fechou o pack do dia em ${seguidos === marco ? "cada um dos últimos" : "todos os últimos"} ${seguidos} dias úteis. Que constância!`,
      pessoas: [id],
    });
  }

  /* ---- Setor com 100% na semana ---- */
  const nomeDoSetor = new Map(sectors.map((s) => [s.id, s.name]));
  for (const l of (sets[2] ?? []) as { setor: string; total: number; feitas: number }[]) {
    if (l.total < SETOR_MINIMO || l.feitas < l.total) continue;
    const rotulo = nomeDoSetor.get(l.setor) ?? l.setor;
    saida.push({
      chave: `setor:${l.setor}:${isoDe(semanaIni)}`,
      selo: "setor",
      titulo: `Time de ${rotulo} bateu 100% na semana 🏆`,
      texto: `Todas as ${l.total} tarefas da semana de ${ddmm(semanaIni)} a ${ddmm(segundaDestaSemana - DIA_MS)} foram concluídas. Parabéns, time!`,
      pessoas: [],
    });
  }

  /* ---- Recorde pessoal de tarefas num dia (dos últimos 3 dias) ---- */
  const diasPorPessoa = new Map<number, { dia: string; n: number }[]>();
  for (const l of (sets[3] ?? []) as { pessoa_id: number; dia: Date; n: number }[]) {
    const lista = diasPorPessoa.get(l.pessoa_id) ?? [];
    lista.push({ dia: iso(l.dia), n: l.n });
    diasPorPessoa.set(l.pessoa_id, lista);
  }
  const desde3 = isoDe(hojeMs - 3 * DIA_MS);
  const hojeIso = isoDe(hojeMs);
  for (const [id, dias] of diasPorPessoa) {
    if (!porId.has(id)) continue;
    dias.sort((a, b) => a.dia.localeCompare(b.dia));
    const primeiroDia = Date.parse(dias[0]?.dia ?? hojeIso);
    let maior = 0;
    for (const d of dias) {
      const recente = d.dia >= desde3 && d.dia < hojeIso;
      // Só vale como recorde com duas semanas de história para comparar.
      const comHistoria = Date.parse(d.dia) - primeiroDia >= 14 * DIA_MS;
      if (recente && comHistoria && d.n >= RECORDE_MINIMO && d.n > maior) {
        saida.push({
          chave: `recorde:${id}:${d.dia}`,
          selo: "recorde",
          titulo: `Recorde pessoal: ${d.n} tarefas concluídas num dia ⚡`,
          texto: `${nome(id)} concluiu ${d.n} tarefas em ${ddmm(Date.parse(d.dia))} — o melhor dia no CONECTA até agora.`,
          pessoas: [id],
        });
      }
      maior = Math.max(maior, d.n);
    }
  }

  /* ---- Primeira tarefa concluída no CONECTA ---- */
  for (const l of (sets[4] ?? []) as { pessoa_id: number }[]) {
    if (!porId.has(l.pessoa_id)) continue;
    saida.push({
      chave: `primeira:${l.pessoa_id}`,
      selo: "primeira",
      titulo: "Primeira tarefa concluída no CONECTA ✅",
      texto: `${nome(l.pessoa_id)} concluiu a primeira tarefa por aqui. Bem-vindo(a) ao ritmo!`,
      pessoas: [l.pessoa_id],
    });
  }

  /* ---- Tempo de casa (no dia) e boas-vindas (admissão na última semana) ---- */
  const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  for (const p of pessoas) {
    if (!p.admissao) continue;
    const [ano, mes, dia] = p.admissao.split("-").map(Number);
    const diaNoAno = mes === 2 && dia === 29 && !bissexto(hoje.ano) ? 28 : dia;
    if (mes === hoje.mes && diaNoAno === hoje.dia && ano < hoje.ano) {
      const anos = hoje.ano - ano;
      saida.push({
        chave: `casa:${p.id}:${hoje.ano}`,
        selo: "tempo_casa",
        titulo: `${anos} ${anos === 1 ? "ano" : "anos"} de Larsil 🎉`,
        texto: `${nomeCurto(p.nome)} completa hoje ${anos} ${anos === 1 ? "ano" : "anos"} de Larsil. Obrigado por fazer parte!`,
        pessoas: [p.id],
      });
    }
    const admissaoMs = Date.UTC(ano, mes - 1, dia);
    if (admissaoMs <= hojeMs && hojeMs - admissaoMs <= 7 * DIA_MS) {
      saida.push({
        chave: `boasvindas:${p.id}`,
        selo: "boas_vindas",
        titulo: `Boas-vindas, ${nomeCurto(p.nome)}! 👋`,
        texto: `${nomeCurto(p.nome)} chegou à Larsil em ${ddmm(admissaoMs)}. Deixe um oi nos comentários!`,
        pessoas: [p.id],
      });
    }
  }

  return saida;
}

/**
 * Grava tudo numa ida: o que já existe (pela `chave_auto`) fica de fora, e a
 * linha do dia ganha `concluido_em`. Devolve quantas publicações nasceram.
 */
async function gravar(diaIso: string, publicacoes: Publicacao[]): Promise<number> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const { AUTOR_SISTEMA, esquecerFeed } = await import("@/lib/mural.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("dia", sql.Date, diaIso)
    .input("autor", sql.Int, AUTOR_SISTEMA)
    .input("lista", sql.NVarChar(sql.MAX), JSON.stringify(publicacoes))
    .query(
      `SET NOCOUNT ON;
       SET XACT_ABORT ON;
       BEGIN TRAN;
       DECLARE @novos TABLE (id UNIQUEIDENTIFIER, chave NVARCHAR(80));
       INSERT INTO gestor.mural_posts (autor_id, texto, titulo, tipo, automatico, selo, chave_auto)
       OUTPUT inserted.id, inserted.chave_auto INTO @novos
       SELECT @autor, j.texto, j.titulo, N'conquista', 1, j.selo, j.chave
         FROM OPENJSON(@lista)
              WITH (chave NVARCHAR(80), selo NVARCHAR(16), titulo NVARCHAR(160), texto NVARCHAR(4000)) j
        WHERE NOT EXISTS (SELECT 1 FROM gestor.mural_posts p WHERE p.chave_auto = j.chave);

       INSERT INTO gestor.mural_homenageados (post_id, pessoa_id)
       SELECT DISTINCT n.id, CAST(pp.value AS INT)
         FROM @novos n
         JOIN OPENJSON(@lista) WITH (chave NVARCHAR(80), pessoas NVARCHAR(MAX) AS JSON) j
           ON j.chave = n.chave
        CROSS APPLY OPENJSON(j.pessoas) pp;

       UPDATE gestor.mural_lotes
          SET concluido_em = SYSDATETIMEOFFSET(), posts = (SELECT COUNT(*) FROM @novos)
        WHERE dia = @dia;
       COMMIT;
       SELECT COUNT(*) AS n FROM @novos;`,
    );
  const n = Number((r.recordset[0] as { n: number } | undefined)?.n ?? 0);
  if (n > 0) await esquecerFeed();
  return n;
}
