import { createServerFn } from "@tanstack/react-start";
import { comSessao, comSessaoSemEntrada, semIdentidade } from "@/integrations/iam/funcao-com-sessao";

/* As atas — bloco F, o último campo que ainda vivia só no navegador.
 *
 * Uma ata é o registro do que foi dito numa reunião: quem estava, o que ficou
 * decidido, o que virou tarefa. É o tipo de coisa que alguém procura meses
 * depois — e é justamente o que menos podia estar guardado numa máquina só.
 *
 * O caso pior era concreto: a ata nasce no computador de quem clicou em
 * "gerar", com a lista de participantes dentro. Todo mundo que estava na
 * reunião aparecia na ata, e ninguém além de quem gerou conseguia abri-la.
 *
 * Quem vê continua sendo quem esteve lá — a regra não mudou, mudou o lugar
 * onde ela é aplicada. Não há papel de gerente aqui: reunião não é relatório
 * de setor, e um chefe que não foi convidado não passa a ter direito à ata
 * porque o dado saiu do navegador.
 */

export type TopicoDaAta = {
  id: string;
  text: string;
  kind: "decisao" | "proximo" | "atencao";
  taskId?: string;
};

export type AtaDoBanco = {
  id: string;
  roomName: string;
  roomLabel: string;
  createdAt: string;
  createdBy: string;
  participantIds: string[];
  participantNames: string[];
  markdown: string;
  topics: TopicoDaAta[];
};

const TIPOS = ["decisao", "proximo", "atencao"] as const;

const texto = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
const pessoaOuNulo = (v: unknown): number | null => {
  const n = Number(typeof v === "string" || typeof v === "number" ? v : NaN);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * As atas das reuniões em que esta pessoa esteve, mais as que ela gerou.
 *
 * As três consultas são separadas de propósito, e não uma junção só: uma ata
 * com oito participantes e doze tópicos viraria noventa e seis linhas
 * repetindo o markdown inteiro em cada uma. O markdown é o campo grande.
 */
export const listarAtas = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<{ atas: AtaDoBanco[] }> => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    const r = await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(
        `SELECT id, sala, titulo_da_sala, markdown, criada_por, criada_em
           FROM gestor.atas a
          WHERE a.criada_por = @eu
             OR EXISTS (SELECT 1 FROM gestor.ata_participantes p
                         WHERE p.ata_id = a.id AND p.pessoa_id = @eu)
          ORDER BY a.criada_em DESC`,
      );

    type LinhaAta = {
      id: string;
      sala: string;
      titulo_da_sala: string | null;
      markdown: string;
      criada_por: number;
      criada_em: Date;
    };
    const linhas = r.recordset as LinhaAta[];
    if (linhas.length === 0) return { atas: [] };

    /* Uma consulta para os participantes de TODAS as atas visíveis, e outra
       para os tópicos. Duas idas ao banco no total, em vez de duas por ata — a
       tela abre com a lista inteira, e uma consulta por item é o que transforma
       trinta atas em sessenta viagens.

       As duas repetem o filtro de visibilidade em vez de receber a lista de ids
       da consulta anterior. Sai mais legível e, principalmente, não monta SQL
       concatenando valor nenhum: a regra é a mesma nos três lugares, e o único
       valor que entra continua sendo @eu. */
    const visiveis = `a.criada_por = @eu
                      OR EXISTS (SELECT 1 FROM gestor.ata_participantes q
                                  WHERE q.ata_id = a.id AND q.pessoa_id = @eu)`;
    const [ps, ts] = await Promise.all([
      pool
        .request()
        .input("eu", sql.Int, eu)
        .query(
          `SELECT p.ata_id, p.nome, p.pessoa_id
             FROM gestor.ata_participantes p
             JOIN gestor.atas a ON a.id = p.ata_id
            WHERE ${visiveis}`,
        ),
      pool
        .request()
        .input("eu", sql.Int, eu)
        .query(
          `SELECT t.id, t.ata_id, t.texto, t.tipo, t.tarefa_id
             FROM gestor.topicos_da_ata t
             JOIN gestor.atas a ON a.id = t.ata_id
            WHERE ${visiveis}
            ORDER BY t.ordem`,
        ),
    ]);

    const participantes = new Map<string, { nome: string; pessoa_id: number | null }[]>();
    for (const p of ps.recordset as { ata_id: string; nome: string; pessoa_id: number | null }[]) {
      const chave = p.ata_id.toLowerCase();
      participantes.set(chave, [...(participantes.get(chave) ?? []), p]);
    }

    const topicos = new Map<string, TopicoDaAta[]>();
    for (const t of ts.recordset as {
      id: string;
      ata_id: string;
      texto: string;
      tipo: string;
      tarefa_id: string | null;
    }[]) {
      const chave = t.ata_id.toLowerCase();
      topicos.set(chave, [
        ...(topicos.get(chave) ?? []),
        {
          id: t.id,
          text: t.texto,
          kind: (TIPOS as readonly string[]).includes(t.tipo)
            ? (t.tipo as TopicoDaAta["kind"])
            : "proximo",
          taskId: t.tarefa_id ?? undefined,
        },
      ]);
    }

    return {
      atas: linhas.map((l) => {
        const meus = participantes.get(l.id.toLowerCase()) ?? [];
        return {
          id: l.id,
          roomName: l.sala,
          roomLabel: l.titulo_da_sala ?? l.sala,
          createdAt: l.criada_em.toISOString(),
          createdBy: String(l.criada_por),
          /* Os dois arrays que a tela espera saem da mesma tabela: os nomes são
             todas as linhas, os ids são as linhas que casaram com uma pessoa.
             Guardar assim é o que preserva o par — dois arrays soltos perderiam
             qual id pertence a qual nome. */
          participantNames: meus.map((p) => p.nome),
          participantIds: meus
            .filter((p) => p.pessoa_id !== null)
            .map((p) => String(p.pessoa_id)),
          markdown: l.markdown,
          topics: topicos.get(l.id.toLowerCase()) ?? [],
        };
      }),
    };
  }),
);

type EntradaAta = {
  id: string;
  sala: string;
  tituloDaSala: string | null;
  markdown: string;
  participantes: { nome: string; pessoaId: number | null }[];
  topicos: { id: string; texto: string; tipo: string }[];
};

/**
 * Grava a ata inteira — cabeçalho, participantes e tópicos — de uma vez.
 *
 * A ata é escrita uma única vez, no fim da reunião, e depois só é lida. Não há
 * caminho de edição, então não há o problema de regravar por cima do que outra
 * pessoa escreveu. Isso permite a gravação em bloco, que aqui é a mais simples.
 *
 * O id vem do cliente porque a tela precisa dele imediatamente, para mostrar a
 * ata recém-gerada sem esperar a resposta. É um UUID, e o `WHERE NOT EXISTS`
 * abaixo torna a chamada repetida inofensiva.
 */
export const salvarAta = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade(
      (e: {
        id: string;
        roomName: string;
        roomLabel?: string;
        markdown: string;
        participantes?: { nome: string; pessoaId?: string | number | null }[];
        topicos?: { id: string; text: string; kind: string }[];
      }): EntradaAta => {
        const id = guid(e?.id);
        if (!id) throw new Error("Ata inválida");
        const sala = texto(e?.roomName, 80);
        if (!sala) throw new Error("Ata sem sala");

        /* Nomes repetidos viram um só: `nome` faz parte da chave primária de
           `ata_participantes`, e duas linhas com o mesmo nome derrubariam a
           gravação inteira. O LiveKit devolve repetido quando alguém entra na
           reunião de dois aparelhos. */
        const vistos = new Set<string>();
        const participantes: EntradaAta["participantes"] = [];
        for (const p of Array.isArray(e?.participantes) ? e.participantes : []) {
          const nome = texto(p?.nome, 160);
          if (!nome || vistos.has(nome)) continue;
          vistos.add(nome);
          participantes.push({ nome, pessoaId: pessoaOuNulo(p?.pessoaId) });
        }

        return {
          id,
          sala,
          tituloDaSala: texto(e?.roomLabel, 120) || null,
          markdown: texto(e?.markdown, 1_000_000),
          participantes,
          topicos: (Array.isArray(e?.topicos) ? e.topicos : [])
            .map((t) => ({
              id: guid(t?.id) ?? "",
              texto: texto(t?.text, 600),
              tipo: (TIPOS as readonly string[]).includes(t?.kind) ? t.kind : "proximo",
            }))
            .filter((t) => t.id && t.texto),
        };
      },
    ),
  )
  .handler(
    comSessao(async (eu, d: EntradaAta): Promise<{ id: string }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();

      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("sala", sql.NVarChar, d.sala)
        .input("titulo", sql.NVarChar, d.tituloDaSala)
        .input("markdown", sql.NVarChar(sql.MAX), d.markdown)
        .input("por", sql.Int, eu)
        .query(
          `INSERT INTO gestor.atas (id, sala, titulo_da_sala, markdown, criada_por)
           SELECT @id, @sala, @titulo, @markdown, @por
            WHERE NOT EXISTS (SELECT 1 FROM gestor.atas WHERE id=@id);
           SELECT @@ROWCOUNT AS gravou;`,
        );

      // Já existia: a tela chamou duas vezes. Não regrava nem duplica os filhos.
      if ((r.recordset[0] as { gravou: number }).gravou === 0) return { id: d.id };

      for (const p of d.participantes) {
        await pool
          .request()
          .input("ata", sql.UniqueIdentifier, d.id)
          .input("nome", sql.NVarChar, p.nome)
          .input("pessoa", sql.Int, p.pessoaId)
          .query(
            `INSERT INTO gestor.ata_participantes (ata_id, nome, pessoa_id)
             VALUES (@ata, @nome, @pessoa)`,
          );
      }

      for (const [ordem, t] of d.topicos.entries()) {
        await pool
          .request()
          .input("id", sql.UniqueIdentifier, t.id)
          .input("ata", sql.UniqueIdentifier, d.id)
          .input("texto", sql.NVarChar, t.texto)
          .input("tipo", sql.NVarChar, t.tipo)
          .input("ordem", sql.Int, ordem)
          .query(
            `INSERT INTO gestor.topicos_da_ata (id, ata_id, texto, tipo, ordem)
             VALUES (@id, @ata, @texto, @tipo, @ordem)`,
          );
      }

      return { id: d.id };
    }),
  );

/**
 * Liga um tópico à tarefa que ele gerou.
 *
 * É o que faz a ata mostrar "3 de 12 tópicos viraram tarefa" e o que impede o
 * mesmo tópico de virar duas tarefas. O `tarefa_id IS NULL` é essa trava, e ela
 * mora aqui e não na tela: dois cliques rápidos no mesmo botão, ou a mesma ata
 * aberta em duas máquinas, chegariam os dois ao servidor.
 */
export const ligarTopicoATarefa = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { topicoId: string; tarefaId: string }) => {
      const topicoId = guid(e?.topicoId);
      const tarefaId = guid(e?.tarefaId);
      if (!topicoId || !tarefaId) throw new Error("Tópico ou tarefa inválidos");
      return { topicoId, tarefaId };
    }),
  )
  .handler(
    comSessao(async (eu, d: { topicoId: string; tarefaId: string }): Promise<{ ok: boolean }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("t", sql.UniqueIdentifier, d.topicoId)
        .input("tarefa", sql.UniqueIdentifier, d.tarefaId)
        .input("eu", sql.Int, eu)
        .query(
          /* A fechadura é a mesma da leitura: só quem enxerga a ata liga um
             tópico dela. Sem isto, quem descobrisse o id de um tópico penduraria
             uma tarefa numa reunião de que não participou. */
          `UPDATE t SET t.tarefa_id = @tarefa
             FROM gestor.topicos_da_ata t
             JOIN gestor.atas a ON a.id = t.ata_id
            WHERE t.id = @t
              AND t.tarefa_id IS NULL
              AND (a.criada_por = @eu
                   OR EXISTS (SELECT 1 FROM gestor.ata_participantes p
                               WHERE p.ata_id = a.id AND p.pessoa_id = @eu))`,
        );
      return { ok: (r.rowsAffected[0] ?? 0) > 0 };
    }),
  );

/**
 * Apaga a ata.
 *
 * Aqui apagar continua existindo, ao contrário da tarefa. A diferença é o que
 * fica pendurado: uma tarefa concluída sustenta a pontuação de um mês inteiro,
 * e apagá-la reescreveria o passado. Uma ata não sustenta nada — os tópicos
 * saem por cascata, e as tarefas que nasceram deles ficam, porque a chave
 * estrangeira de `topicos_da_ata` para `tarefas` é sem cascata e aponta para o
 * outro lado.
 *
 * Só quem gerou apaga. Estar na reunião dá direito de ler, não de destruir o
 * registro dela para todo mundo.
 */
export const apagarAta = createServerFn({ method: "POST" })
  .inputValidator(
    semIdentidade((e: { id: string }) => {
      const id = guid(e?.id);
      if (!id) throw new Error("Ata inválida");
      return { id };
    }),
  )
  .handler(
    comSessao(async (eu, d: { id: string }): Promise<{ ok: boolean }> => {
      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.UniqueIdentifier, d.id)
        .input("eu", sql.Int, eu)
        .query(`DELETE FROM gestor.atas WHERE id=@id AND criada_por=@eu`);
      return { ok: (r.rowsAffected[0] ?? 0) > 0 };
    }),
  );
