import { createServerFn } from "@tanstack/react-start";
import { ESTADOS, paraEstado, type EstadoDoChat } from "@/lib/estado-do-chat";
import {
  CHAVE_STATUS_PERSONALIZADO,
  paraStatus,
  statusVigente,
  type StatusPersonalizado,
} from "@/lib/status-personalizado";

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

/**
 * A lista de conversas de uma pessoa fica guardada no servidor (ver
 * `cache-compartilhado.server`) até ela ou o outro lado mandar, ler, anexar ou
 * limpar — quem grava chama `conversaMudou`, que descarta a lista das pontas
 * — e, de qualquer jeito, por no máximo `VALIDADE_DA_LISTA_MS`. Cada aba a
 * pede a cada 3 s, uma consulta por pessoa, e quase sempre a resposta era a
 * mesma da vez anterior: com 15 s fixos ela ainda somava 180 mil consultas
 * por semana (03/11/2026). Como toda gravação já descarta a lista na hora, a
 * validade só cobre gravação por fora do app, e pode ser longa.
 */
const VALIDADE_DA_LISTA_MS = 60_000;

/** A lista de quem está online, igual para todo mundo — ver `presenceList`. */
const CHAVE_PRESENCA = "presenca:lista";

/* -------------------- Mensagens -------------------- */

export const chatSend = createServerFn({ method: "POST" })
  .validator((input: { toUserId: string; body?: string; comAnexo?: boolean }) => {
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
  })
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
    // A conversa mudou nas duas pontas: as telas releem e as listas guardadas já não valem.
    const { conversaMudou, pararDigitando } = await import("@/lib/sinal-das-conversas.server");
    conversaMudou(eu, data.toUserId);
    pararDigitando(eu);
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

/** O que a conversa aberta recebe a cada pergunta. */
export type RespostaDaConversa = {
  /** Devolver na próxima pergunta: igual ao atual, a resposta vem sem `messages`. */
  versao: string;
  peerDigitando: boolean;
  /** Ausente = nada mudou desde `versao` que a tela mandou; ela mantém o que tem. */
  messages?: ReturnType<typeof paraMensagem>[];
};

export const chatConversation = createServerFn({ method: "POST" })
  .validator((input: { peerId: string; versao?: string }) => ({
    peerId: pessoaAlvo(input?.peerId),
    versao: typeof input?.versao === "string" ? input.versao.slice(0, 40) : undefined,
  }))
  .handler(async ({ data }): Promise<RespostaDaConversa> => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    /* O "está digitando" vem junto, na mesma pergunta: precisa da mesma
       frequência das mensagens para fazer sentido, e um segundo relógio era o
       que não podia existir (os intervalos estão calibrados para a latência
       Brasil↔EUA). Agora vem da memória, sem custo de banco — ver
       `sinal-das-conversas.server`.

       O número é lido ANTES do banco: se alguém gravar durante a leitura, o
       número sobe depois deste, e a próxima pergunta relê. Ao contrário, a
       tela ficaria com o número novo e a lista velha. */
    const { versaoDaConversa, precisaReler, estaDigitando } =
      await import("@/lib/sinal-das-conversas.server");
    const versao = versaoDaConversa(eu, data.peerId);
    const peerDigitando = estaDigitando(data.peerId, eu);
    if (!precisaReler(eu, data.peerId, data.versao)) return { versao, peerDigitando };

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
        `-- O que eu limpei some para mim; ver chatLimparConversa.
         DECLARE @limpa DATETIMEOFFSET = ISNULL(
           (SELECT cl.limpa_em FROM gestor.conversas_limpas cl WHERE cl.pessoa_id=@me AND cl.outro_id=@peer),
           '19000101');
         SELECT TOP 200 m.id,
                m.de_pessoa_id   AS from_user_id,
                m.para_pessoa_id AS to_user_id,
                m.corpo          AS body,
                m.em             AS created_at,
                m.lida_em        AS read_at,
                a.id             AS anexo_id,
                a.nome           AS att_name,
                a.tipo_mime      AS att_type
           -- Os dois sentidos como duas buscas exatas no IX_msg_conversa
           -- (de, para, em), em vez de um OR que lia o índice inteiro: era a
           -- 2ª consulta mais pesada do banco em 14/10/2026 (conversa aberta
           -- relida a cada 1,5 s).
           FROM (
             SELECT TOP 200 id, de_pessoa_id, para_pessoa_id, corpo, em, lida_em
               FROM gestor.mensagens
              WHERE de_pessoa_id=@me AND para_pessoa_id=@peer AND em > @limpa
              ORDER BY em DESC
             UNION ALL
             SELECT TOP 200 id, de_pessoa_id, para_pessoa_id, corpo, em, lida_em
               FROM gestor.mensagens
              WHERE de_pessoa_id=@peer AND para_pessoa_id=@me AND em > @limpa
              ORDER BY em DESC
           ) m
           OUTER APPLY (
             SELECT TOP 1 x.id, x.nome, x.tipo_mime
               FROM gestor.anexos x
              WHERE x.dono_tipo = 'mensagem' AND x.dono_id = m.id
              ORDER BY x.enviado_em
           ) a
          ORDER BY m.em DESC;`,
      );
    // devolve em ordem cronológica
    return {
      versao,
      peerDigitando,
      messages: (res.recordset as LinhaMensagem[]).reverse().map(paraMensagem),
    };
  });

function paraMensagem(m: LinhaMensagem) {
  return {
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
  };
}

/**
 * Limpa a conversa com alguém — PARA MIM, como o "Limpar conversa" do
 * WhatsApp (pedido do usuário, 08/10/2026). Nada é apagado: grava-se a hora
 * da limpeza, e eu passo a ver só o que veio depois. A outra pessoa continua
 * com o histórico dela; apagar de verdade tiraria dela o registro sem aviso.
 */
export const chatLimparConversa = createServerFn({ method: "POST" })
  .validator((input: { peerId: string }) => ({ peerId: pessoaAlvo(input?.peerId) }))
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
        `IF EXISTS (SELECT 1 FROM gestor.conversas_limpas WHERE pessoa_id=@me AND outro_id=@peer)
           UPDATE gestor.conversas_limpas SET limpa_em=SYSDATETIMEOFFSET()
            WHERE pessoa_id=@me AND outro_id=@peer;
         ELSE
           INSERT INTO gestor.conversas_limpas (pessoa_id, outro_id) VALUES (@me, @peer);`,
      );
    // Só a minha lista: o outro lado continua vendo tudo.
    const { conversaMudou } = await import("@/lib/sinal-das-conversas.server");
    conversaMudou(eu, data.peerId, eu);
    return { ok: true };
  });

/** Última mensagem por contato + não lidas — para a lista estilo WhatsApp. */
export const chatThreads = createServerFn({ method: "POST" }).handler(async () => {
  const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
  const eu = await pessoaDaSessao();

  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  const { chaveDasConversas } = await import("@/lib/sinal-das-conversas.server");
  return compartilhado(chaveDasConversas(eu), VALIDADE_DA_LISTA_MS, () => conversasDe(eu));
});

async function conversasDe(eu: number) {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  /* Primeiro com quem eu falo, depois a última mensagem de cada conversa —
     buscas exatas nos índices (de, para, em), uma por pessoa.
     A versão anterior pegava TODAS as minhas mensagens com um OR e numerava
     por conversa para ficar com a primeira: varria a tabela inteira e, para
     quem conversa muito, eram 15 mil leituras por vez, contra ~300 agora
     (03/11/2026, mesmo resultado conferido nas 34 pessoas com mensagem). */
  const res = await pool
    .request()
    .input("me", sql.Int, eu)
    .query(
      `WITH peers AS (
         SELECT para_pessoa_id AS peer FROM gestor.mensagens WHERE de_pessoa_id=@me
         UNION
         SELECT de_pessoa_id FROM gestor.mensagens WHERE para_pessoa_id=@me
       )
       SELECT p.peer,
              u.corpo        AS body,
              u.em           AS created_at,
              u.de_pessoa_id AS from_user_id,
              -- A lista de conversas mostra "📎 anexo" quando a última mensagem
              -- é um arquivo. Só o tipo basta; o conteúdo fica para quando a
              -- conversa abrir.
              (SELECT TOP 1 x.tipo_mime FROM gestor.anexos x
                 WHERE x.dono_tipo='mensagem' AND x.dono_id=u.id) AS att_type,
              (SELECT COUNT(*) FROM gestor.mensagens m
                 WHERE m.para_pessoa_id=@me AND m.de_pessoa_id=p.peer AND m.lida_em IS NULL
                   AND m.em > l.limpa) AS unread
         FROM peers p
         -- Conversa limpa: só o que veio depois — ver chatLimparConversa.
        CROSS APPLY (SELECT ISNULL((SELECT cl.limpa_em FROM gestor.conversas_limpas cl
                                     WHERE cl.pessoa_id=@me AND cl.outro_id=p.peer),
                                   '19000101') AS limpa) l
        -- A última dos dois sentidos. Conversa toda limpa não tem linha aqui
        -- e some da lista, como antes.
        CROSS APPLY (SELECT TOP 1 z.* FROM (
                       SELECT TOP 1 id, corpo, em, de_pessoa_id FROM gestor.mensagens
                        WHERE de_pessoa_id=@me AND para_pessoa_id=p.peer AND em > l.limpa
                        ORDER BY em DESC
                       UNION ALL
                       SELECT TOP 1 id, corpo, em, de_pessoa_id FROM gestor.mensagens
                        WHERE de_pessoa_id=p.peer AND para_pessoa_id=@me AND em > l.limpa
                        ORDER BY em DESC) z
                      ORDER BY z.em DESC) u
        ORDER BY u.em DESC`,
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
}

export const chatMarkRead = createServerFn({ method: "POST" })
  .validator((input: { peerId: string }) => ({ peerId: pessoaAlvo(input?.peerId) }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("me", sql.Int, eu)
      .input("peer", sql.Int, data.peerId)
      .query(
        `UPDATE gestor.mensagens SET lida_em=SYSDATETIMEOFFSET()
          WHERE para_pessoa_id=@me AND de_pessoa_id=@peer AND lida_em IS NULL`,
      );
    /* As não lidas de quem leu mudaram, e o ✓✓ de quem mandou também: as duas
       pontas releem. Só se algo foi de fato marcado — marcar de novo o que já
       estava lido não muda nada, e descartar as listas à toa era refazer a
       consulta delas. */
    if ((r.rowsAffected[0] ?? 0) > 0) {
      const { conversaMudou } = await import("@/lib/sinal-das-conversas.server");
      conversaMudou(eu, data.peerId);
    }
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

/**
 * "Estou escrevendo para fulano agora."
 *
 * Fica na memória do servidor, não no banco (03/11/2026) — ver
 * `sinal-das-conversas.server`. As colunas `digitando_para`/`digitando_em` de
 * `gestor.presenca` ficaram sem uso.
 *
 * Não há "parei de digitar": a marca envelhece sozinha em 6 segundos, e
 * mandar a mensagem a apaga na hora. Um aviso explícito de parada seria mais
 * uma requisição para dizer o que o relógio já diz — e ela se perderia
 * justamente no caso que importa, o de fechar a janela no meio da frase.
 */
export const chatDigitando = createServerFn({ method: "POST" })
  .validator((input: { peerId: string }) => ({ peerId: pessoaAlvo(input?.peerId) }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();
    if (eu === data.peerId) return { ok: true };

    const { marcarDigitando } = await import("@/lib/sinal-das-conversas.server");
    marcarDigitando(eu, data.peerId);
    return { ok: true };
  });

/* Igual para todo mundo, então uma consulta serve a todos por 2 s (ver
   `cache-compartilhado.server`). Cada aba pede a cada 10 s, e a batida de quem
   está online é de 20 s em 20 s: 2 s a mais de atraso não mudam quem aparece. */
export const presenceList = createServerFn({ method: "POST" }).handler(async () => {
  // Só quem está logado: a lista traz quem está online e o status de cada um
  // ("🤒 Atestado", "🏖️ De férias") — não é coisa para fora da empresa.
  const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
  await pessoaDaSessao();
  const { compartilhado } = await import("@/lib/cache-compartilhado.server");
  return compartilhado(CHAVE_PRESENCA, 2_000, listaDePresenca);
});

/* O status personalizado (19/10/2026) vem na MESMA consulta: um LEFT JOIN em
   `gestor.preferencias` pela chave primária (pessoa_id, chave) — barato, e
   sem sondagem nova para o banco compartilhado. O vencido sai aqui mesmo
   (com a lista guardada por 2 s, o atraso não se nota); o cliente confere de
   novo na hora de desenhar, porque a resposta fica 10 s na tela. */
async function listaDePresenca() {
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  const res = await pool.request().query(
    `SELECT p.pessoa_id AS user_id, p.visto_em AS last_seen, p.estado, pr.valor AS status
       FROM gestor.presenca p
       LEFT JOIN gestor.preferencias pr
         ON pr.pessoa_id = p.pessoa_id AND pr.chave = N'${CHAVE_STATUS_PERSONALIZADO}'`,
  );
  const agora = Date.now();
  return {
    presence: (
      res.recordset as {
        user_id: number;
        last_seen: Date;
        estado: string | null;
        status: string | null;
      }[]
    ).map((p) => ({
      user_id: String(p.user_id),
      last_seen: iso(p.last_seen) as string,
      estado: paraEstado(p.estado),
      status: statusVigente(paraStatus(p.status), agora),
    })),
  };
}

/* -------------------- Status escolhido (disponível/ocupado/ausente) -------------------- */

/**
 * Troca o status de quem está logado.
 *
 * Mora na mesma linha da presença, e não numa tabela à parte, porque só faz
 * sentido junto dela: status de quem está offline não aparece para ninguém. O
 * `IF EXISTS ... ELSE INSERT` é o mesmo do heartbeat — trocar o status antes do
 * primeiro heartbeat não pode se perder.
 */
export const definirEstado = createServerFn({ method: "POST" })
  .validator((input: { estado: string }) => {
    if (!(ESTADOS as readonly string[]).includes(input?.estado)) throw new Error("Status inválido");
    return { estado: input.estado as EstadoDoChat };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("pessoa", sql.Int, eu)
      .input("estado", sql.NVarChar(12), data.estado)
      .query(
        `IF EXISTS (SELECT 1 FROM gestor.presenca WHERE pessoa_id=@pessoa)
           UPDATE gestor.presenca SET estado=@estado WHERE pessoa_id=@pessoa;
         ELSE
           INSERT INTO gestor.presenca (pessoa_id, estado) VALUES (@pessoa, @estado);`,
      );
    // O status novo aparece para os outros na próxima sondagem, sem esperar a lista guardada vencer.
    const { esquecer } = await import("@/lib/cache-compartilhado.server");
    esquecer(CHAVE_PRESENCA);
    return { estado: data.estado };
  });

/* -------------------- Status personalizado (emoji + texto + até quando) -------------------- */

/**
 * Define ou limpa o status personalizado de quem está logado (19/10/2026).
 *
 * Grava em `gestor.preferencias`, chave `status_personalizado` — sem coluna
 * nova na presença, porque o schema do banco compartilhado não muda por isto.
 * `status: null` limpa (apaga a linha). Função própria, e não
 * `salvarPreferencia`, por dois motivos: aquela não sabe apagar, e esta
 * precisa descartar a lista de presença guardada para o status aparecer aos
 * outros na próxima sondagem.
 *
 * Garante a linha da presença, como `definirEstado`: o status chega aos outros
 * pelo JOIN a partir dela.
 */
export const definirStatusPersonalizado = createServerFn({ method: "POST" })
  .validator((input: { status: StatusPersonalizado | null }) => {
    if (input?.status === null) return { status: null };
    const status = paraStatus(input?.status);
    if (!status) throw new Error("Status inválido");
    if (status.ate && Date.parse(status.ate) <= Date.now())
      throw new Error("Esse horário já passou");
    return { status };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const req = pool
      .request()
      .input("pessoa", sql.Int, eu)
      .input("chave", sql.NVarChar(60), CHAVE_STATUS_PERSONALIZADO);
    if (data.status === null) {
      await req.query(`DELETE FROM gestor.preferencias WHERE pessoa_id=@pessoa AND chave=@chave`);
    } else {
      await req.input("valor", sql.NVarChar(400), JSON.stringify(data.status)).query(
        `IF EXISTS (SELECT 1 FROM gestor.preferencias WHERE pessoa_id=@pessoa AND chave=@chave)
           UPDATE gestor.preferencias SET valor=@valor, atualizada_em=SYSDATETIMEOFFSET()
            WHERE pessoa_id=@pessoa AND chave=@chave;
         ELSE
           INSERT INTO gestor.preferencias (pessoa_id, chave, valor) VALUES (@pessoa, @chave, @valor);
         IF NOT EXISTS (SELECT 1 FROM gestor.presenca WHERE pessoa_id=@pessoa)
           INSERT INTO gestor.presenca (pessoa_id) VALUES (@pessoa);`,
      );
    }
    const { esquecer } = await import("@/lib/cache-compartilhado.server");
    esquecer(CHAVE_PRESENCA);
    return { status: data.status };
  });
