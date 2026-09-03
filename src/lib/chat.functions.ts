import { createServerFn } from "@tanstack/react-start";

/* Conversa privada, agora em `gestor.mensagens`.

   Três diferenças em relação a `dbo.chat_messages`, que fica de pé mas sem uso:

   1. Pessoa é `INT`. O texto existia porque os ids do dado falso (`u1`, `u2`)
      não eram números — o banco agora recusa qualquer coisa que não seja o id
      numérico da IAM.
   2. Tempo é `DATETIMEOFFSET`, então carrega o fuso em vez de depender de quem
      lê saber que era UTC.
   3. Anexo saiu da linha. Ver o comentário em `chatSend`.

   Os apelidos no SELECT (`AS from_user_id` e companhia) devolvem os nomes que a
   interface já espera. É o que evita renomear campo em `chat-ui`, `chat-dock` e
   `chat-store` de uma vez só — a tradução mora aqui, na fronteira. */

/** Quem sou eu vem da sessão; quem é o outro vem do cliente e é validado aqui. */
const pessoaAlvo = (v: unknown): number => {
  if (typeof v !== "string" && typeof v !== "number") throw new Error("Usuário inválido");
  const n = Number(String(v).trim());
  if (!Number.isInteger(n) || n <= 0) throw new Error("Usuário inválido");
  return n;
};

/** O driver devolve `Date`; a interface tipa string e faz `new Date(...)`. */
const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : String(d);

/* -------------------- Mensagens -------------------- */

export const chatSend = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { toUserId: string; body?: string; comAnexo?: boolean }) => {
      // `fromUserId` saiu da entrada. Ele era o remetente escolhido pelo
      // cliente — ou seja, dava para mandar mensagem no nome de outra pessoa.
      const toUserId = pessoaAlvo(input?.toUserId);
      const body = typeof input?.body === "string" ? input.body.slice(0, 4000) : "";

      /* O arquivo não vem por aqui.

         A mensagem é gravada primeiro e devolve o id; só então o cliente sobe o
         anexo, apontando para esse id. A ordem é obrigatória e não é escolha de
         estilo: `gestor.anexos.dono_id` referencia a mensagem, e ela precisa
         existir antes de alguém poder apontar para ela.

         `comAnexo` só serve para permitir corpo vazio — mandar uma foto sem
         legenda é normal, mandar mensagem vazia sem nada não é. */
      const comAnexo = input?.comAnexo === true;
      if (!body.trim() && !comAnexo) throw new Error("Mensagem vazia");

      return { toUserId, body: body.trim(), comAnexo };
    },
  )
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();
    // A checagem mudou de lugar: no validador ela comparava dois valores do
    // cliente, o que não garantia nada. Aqui compara a sessão com o destino.
    // (O banco também barra, pelo CK_gestor_msg_pessoas — cinto e suspensório.)
    if (eu === data.toUserId) throw new Error("Não dá para conversar consigo mesmo");

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const res = await pool
      .request()
      .input("de", sql.Int, eu)
      .input("para", sql.Int, data.toUserId)
      .input("corpo", sql.NVarChar(sql.MAX), data.body)
      .query(
        `INSERT INTO gestor.mensagens (de_pessoa_id, para_pessoa_id, corpo)
         OUTPUT INSERTED.id, INSERTED.em AS created_at
         VALUES (@de, @para, @corpo)`,
      );
    const m = res.recordset[0] as { id: string; created_at: Date };
    return { message: { ...m, created_at: iso(m.created_at) as string } };
  });

type LinhaMensagem = {
  id: string;
  from_user_id: number;
  to_user_id: number;
  body: string | null;
  created_at: Date;
  read_at: Date | null;
  anexo_id: string | null;
  att_name: string | null;
  att_type: string | null;
};

export const chatConversation = createServerFn({ method: "POST" })
  .inputValidator((input: { peerId: string }) => ({ peerId: pessoaAlvo(input?.peerId) }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    // Como toda linha devolvida tem `@me` numa das duas pontas, e `@me` é
    // imposto pelo servidor, ninguém lê uma conversa da qual não participa.
    const res = await pool
      .request()
      .input("me", sql.Int, eu)
      .input("peer", sql.Int, data.peerId)
      .query(
        /* O `OUTER APPLY` traz o anexo junto, numa consulta só.
           `TOP 1` porque a tela mostra um por mensagem — a tabela aceita
           vários, mas o chat sempre mandou um de cada vez.

           Os apelidos `att_*` devolvem os nomes que a interface já lê. Foi de
           propósito: com `att_data` apontando para a rota do proxy, o
           `chat-ui` funciona sem uma linha de mudança, porque uma tag `<img>`
           não distingue `/api/anexo/x` de um data URL. */
        `SELECT TOP 200 m.id,
                m.de_pessoa_id   AS from_user_id,
                m.para_pessoa_id AS to_user_id,
                m.corpo          AS body,
                m.em             AS created_at,
                m.lida_em        AS read_at,
                a.id             AS anexo_id,
                a.nome           AS att_name,
                a.tipo_mime      AS att_type
           FROM gestor.mensagens m
           OUTER APPLY (
             SELECT TOP 1 x.id, x.nome, x.tipo_mime
               FROM gestor.anexos x
              WHERE x.dono_tipo = 'mensagem' AND x.dono_id = m.id
              ORDER BY x.enviado_em
           ) a
          WHERE (m.de_pessoa_id=@me AND m.para_pessoa_id=@peer)
             OR (m.de_pessoa_id=@peer AND m.para_pessoa_id=@me)
          ORDER BY m.em DESC`,
      );
    // devolve em ordem cronológica
    return {
      messages: (res.recordset as LinhaMensagem[]).reverse().map((m) => ({
        ...m,
        // A interface compara com `User.id`, que é string no app inteiro.
        from_user_id: String(m.from_user_id),
        to_user_id: String(m.to_user_id),
        created_at: iso(m.created_at) as string,
        read_at: iso(m.read_at),
        /* `att_data` deixou de carregar o arquivo e passou a carregar o
           endereço dele. É a premissa 2 do schema em uma linha: a mensagem
           guarda para onde ir, não o conteúdo.

           O endereço aponta para o nosso proxy, nunca para o Azure direto — a
           credencial do contêiner tem permissão de apagar tudo e vale até 2030,
           então ela não pode virar parte de um link que alguém encaminha. */
        att_data: m.anexo_id ? `/api/anexo/${m.anexo_id}` : null,
      })),
    };
  });

/** Última mensagem por contato + não lidas — para a lista estilo WhatsApp. */
export const chatThreads = createServerFn({ method: "POST" }).handler(async () => {
  const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
  const eu = await pessoaDaSessao();

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const res = await pool
    .request()
    .input("me", sql.Int, eu)
    .query(
      `WITH conv AS (
         SELECT
           CASE WHEN de_pessoa_id=@me THEN para_pessoa_id ELSE de_pessoa_id END AS peer,
           id, corpo, em, de_pessoa_id
         FROM gestor.mensagens
         WHERE de_pessoa_id=@me OR para_pessoa_id=@me
       ),
       ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY peer ORDER BY em DESC) rn FROM conv
       )
       SELECT r.peer,
              r.corpo        AS body,
              r.em           AS created_at,
              r.de_pessoa_id AS from_user_id,
              -- A lista de conversas mostra "📎 anexo" quando a última mensagem
              -- é um arquivo. Só o tipo basta; o conteúdo fica para quando a
              -- conversa abrir.
              (SELECT TOP 1 x.tipo_mime FROM gestor.anexos x
                 WHERE x.dono_tipo='mensagem' AND x.dono_id=r.id) AS att_type,
              (SELECT COUNT(*) FROM gestor.mensagens m
                 WHERE m.para_pessoa_id=@me AND m.de_pessoa_id=r.peer AND m.lida_em IS NULL) AS unread
       FROM ranked r WHERE r.rn=1
       ORDER BY r.em DESC`,
    );
  return {
    threads: (
      res.recordset as {
        peer: number;
        body: string | null;
        created_at: Date;
        from_user_id: number;
        att_type: string | null;
        unread: number;
      }[]
    ).map((t) => ({
      ...t,
      peer: String(t.peer),
      from_user_id: String(t.from_user_id),
      created_at: iso(t.created_at) as string,
    })),
  };
});

export const chatMarkRead = createServerFn({ method: "POST" })
  .inputValidator((input: { peerId: string }) => ({ peerId: pessoaAlvo(input?.peerId) }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("me", sql.Int, eu)
      .input("peer", sql.Int, data.peerId)
      .query(
        `UPDATE gestor.mensagens SET lida_em=SYSDATETIMEOFFSET()
          WHERE para_pessoa_id=@me AND de_pessoa_id=@peer AND lida_em IS NULL`,
      );
    return { ok: true };
  });

/* -------------------- Presença (online/offline) -------------------- */

export const presenceHeartbeat = createServerFn({ method: "POST" }).handler(async () => {
  const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
  const eu = await pessoaDaSessao();

  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  // Sem a identidade da sessão, dava para marcar outra pessoa como online
  // enquanto ela não está — e a lista de presença é o que decide para quem se
  // pode ligar.
  await pool
    .request()
    .input("pessoa", sql.Int, eu)
    .query(
      `IF EXISTS (SELECT 1 FROM gestor.presenca WHERE pessoa_id=@pessoa)
         UPDATE gestor.presenca SET visto_em=SYSDATETIMEOFFSET() WHERE pessoa_id=@pessoa;
       ELSE
         INSERT INTO gestor.presenca (pessoa_id) VALUES (@pessoa);`,
    );
  return { ok: true };
});

export const presenceList = createServerFn({ method: "POST" }).handler(async () => {
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  const res = await pool
    .request()
    .query(`SELECT pessoa_id AS user_id, visto_em AS last_seen FROM gestor.presenca`);
  return {
    presence: (res.recordset as { user_id: number; last_seen: Date }[]).map((p) => ({
      user_id: String(p.user_id),
      last_seen: iso(p.last_seen) as string,
    })),
  };
});
