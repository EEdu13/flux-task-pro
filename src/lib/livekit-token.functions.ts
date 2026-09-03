import { createServerFn } from "@tanstack/react-start";

type RoomCallStatus = "ringing" | "accepted" | "declined" | "missed";

/* ---------- Tradução das situações ----------

   O banco fala português, como todo o schema `gestor`. O app fala inglês, e
   `RoomCallStatus` atravessa dezenas de componentes. Traduzir na fronteira, em
   um lugar só, sai mais barato que renomear o tipo por toda a interface — e
   deixa a coluna legível para quem abrir o banco sem conhecer o código.

   Os `Record` completos, e não um `if`, para o TypeScript reclamar se alguém
   acrescentar uma situação e esquecer do outro lado. */
const SITUACAO_NO_BANCO: Record<RoomCallStatus, string> = {
  ringing: "tocando",
  accepted: "aceita",
  declined: "recusada",
  missed: "perdida",
};
const SITUACAO_NO_APP: Record<string, RoomCallStatus> = {
  tocando: "ringing",
  aceita: "accepted",
  recusada: "declined",
  perdida: "missed",
};

/** Situação de pedido de entrada: o app usa pending/approved/denied. */
const PEDIDO_NO_BANCO = { pending: "esperando", approved: "aceito", denied: "recusado" } as const;
const PEDIDO_NO_APP: Record<string, "pending" | "approved" | "denied"> = {
  esperando: "pending",
  aceito: "approved",
  recusado: "denied",
};

/**
 * Uma linha de `gestor.chamadas` na forma que a interface espera.
 *
 * Duas diferenças entre banco e app, as duas invisíveis se ficarem soltas:
 * a situação está em português, e as pessoas são `INT` — enquanto `User.id` é
 * string em toda a interface. Um `===` entre 467 e "467" é falso, e nada
 * avisaria: a chamada simplesmente não tocaria.
 */
type LinhaChamada = {
  id: string;
  room_name: string;
  room_label: string;
  status: string;
  created_at: Date;
};
type LinhaRecebida = LinhaChamada & { caller_user_id: number; target_user_id: number };
type LinhaEnviada = LinhaChamada & { target_user_id: number; handled_at: Date | null };

/* O driver devolve `Date`; a interface tipa esses campos como string e faz
   `new Date(...)` neles. Antes isso passava porque o `recordset` era `any` e o
   TypeScript não comparava nada — a conversão acontecia por acidente, na
   serialização da resposta. Convertendo aqui, ela deixa de depender de como o
   framework serializa e passa a ser ISO 8601 explícito. */
const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : String(d);

/** Chamada recebida (ou recém-criada): as duas pontas viram texto. */
function recebidaParaApp(c: LinhaRecebida) {
  return {
    ...c,
    caller_user_id: String(c.caller_user_id),
    target_user_id: String(c.target_user_id),
    status: SITUACAO_NO_APP[c.status] ?? c.status,
    created_at: iso(c.created_at) as string,
  };
}

/** Atualização de chamada feita: só o destino vem na consulta. */
function enviadaParaApp(c: LinhaEnviada) {
  return {
    ...c,
    target_user_id: String(c.target_user_id),
    status: SITUACAO_NO_APP[c.status] ?? c.status,
    created_at: iso(c.created_at) as string,
    handled_at: iso(c.handled_at),
  };
}

const sanitizeUserId = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Usuário inválido");
  const id = value.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

/**
 * Id de outra pessoa como número.
 *
 * As tabelas do `gestor` guardam pessoa em `INT`. Quem vem do cliente ainda
 * chega como texto (o `User.id` do app é string), então a conversão acontece
 * aqui, com a recusa explícita — e não com um `Number()` que viraria `NaN`
 * silencioso dentro da consulta.
 */
const pessoaAlvo = (value: unknown): number => {
  const n = Number(sanitizeUserId(value));
  if (!Number.isInteger(n) || n <= 0) throw new Error("Usuário inválido");
  return n;
};

const sanitizeRoomName = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Sala inválida");
  const roomName = value.trim().slice(0, 64);
  if (!roomName || !/^[a-zA-Z0-9_-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
  return roomName;
};

const sanitizeRoomLabel = (value: unknown, fallback: string) => {
  const label = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return label || fallback;
};

export const getLiveKitToken = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; identity: string; name: string }) => {
    if (!input || typeof input.roomName !== "string" || typeof input.identity !== "string") {
      throw new Error("Parâmetros inválidos");
    }
    const roomName = input.roomName.trim().slice(0, 64);
    const identity = input.identity.trim().slice(0, 64);
    const name = (input.name ?? identity).trim().slice(0, 64);
    if (!roomName || !identity) throw new Error("Sala e identidade são obrigatórios");
    if (!/^[a-zA-Z0-9_-]+$/.test(roomName)) throw new Error("Nome de sala inválido");
    // `userId` saiu daqui — era a chave da sala privada, escolhida por quem
    // pedia o token. `identity` e `name` continuam vindo do cliente: eles são
    // só rótulo dentro da videochamada, não decidem entrada.
    return { roomName, identity, name };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit não configurado no servidor");
    }
    // Impõe privacidade em CADA emissão de token: quem pede precisa ser membro.
    //
    // A checagem já existia; o que faltava era a identidade ser confiável. Ela
    // conferia `data.userId`, que vinha no corpo da requisição — bastava mandar
    // o id de um membro para receber o token de uma sala privada.
    {
      const { getPool, isRoomMember, getRoomIsPrivate } = await import("@/integrations/db.server");
      const pool = await getPool();
      const isPrivate = await getRoomIsPrivate(pool, data.roomName);
      if (isPrivate) {
        const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
        // A sessão só é exigida quando a sala é privada. Sala aberta continua
        // funcionando para quem ainda não passou pela IAM — o convidado que
        // entra por link, por exemplo.
        const eu = await pessoaDaSessao();
        const member = await isRoomMember(pool, data.roomName, eu);
        if (!member) throw new Error("Sala privada: peça para entrar antes.");
      }
    }
    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity: data.identity,
      name: data.name,
      ttl: 60 * 60 * 4, // 4 horas
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { token, url, roomName: data.roomName };
  });

export const listRoomsPresence = createServerFn({ method: "POST" })
  .inputValidator((input: { rooms: string[] }) => {
    if (!input || !Array.isArray(input.rooms)) throw new Error("rooms inválido");
    const rooms = input.rooms
      .filter((r) => typeof r === "string" && /^[a-zA-Z0-9_-]+$/.test(r))
      .slice(0, 30);
    return { rooms };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("LiveKit não configurado no servidor");
    }
    const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    const presence: Record<string, { identity: string; name: string }[]> = {};
    await Promise.all(
      data.rooms.map(async (room) => {
        try {
          const parts = await svc.listParticipants(room);
          presence[room] = parts.map((p) => ({
            identity: p.identity,
            name: p.name || p.identity,
          }));
        } catch {
          presence[room] = [];
        }
      }),
    );
    return { presence };
  });

export const listSectorRooms = createServerFn({ method: "POST" })
  .inputValidator((input: { sectors: string[] }) => {
    if (!input || !Array.isArray(input.sectors)) throw new Error("sectors inválido");
    const sectors = input.sectors
      .filter((s) => typeof s === "string" && /^[a-zA-Z0-9_-]+$/.test(s))
      .slice(0, 30);
    return { sectors };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("LiveKit não configurado no servidor");
    }
    const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
    let liveRooms: string[] = [];
    try {
      const rooms = await svc.listRooms();
      liveRooms = rooms.map((r) => r.name);
    } catch {
      liveRooms = [];
    }

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();

    const bySector: Record<
      string,
      {
        name: string;
        isPrivate: boolean;
        participants: { identity: string; name: string }[];
        activeSpeakers: string[];
      }[]
    > = {};

    await Promise.all(
      data.sectors.map(async (sector) => {
        const matches = new Set<string>([sector]);
        const re = new RegExp(`^${sector}(?:-([2-9]|[1-9][0-9]))?$`);
        for (const r of liveRooms) if (re.test(r)) matches.add(r);
        const names = Array.from(matches).sort((a, b) =>
          a.localeCompare(b, "pt-BR", { numeric: true }),
        );

        // Busca room_state das salas do setor (IN dinâmico e parametrizado).
        const req = pool.request();
        const placeholders = names.map((n, i) => {
          req.input(`n${i}`, sql.NVarChar, n);
          return `@n${i}`;
        });
        const states =
          placeholders.length > 0
            ? (
                await req.query(
                  `SELECT sala AS room_name, privada AS is_private, locutores AS active_speakers,
                          locutores_em AS speakers_updated_at
                     FROM gestor.salas WHERE sala IN (${placeholders.join(",")})`,
                )
              ).recordset
            : [];

        const privacyMap = new Map<string, boolean>(
          states.map((s: { room_name: string; is_private: boolean }) => [s.room_name, !!s.is_private]),
        );
        const now = Date.now();
        const speakersMap = new Map<string, string[]>();
        for (const s of states as {
          room_name: string;
          active_speakers: string | null;
          speakers_updated_at: Date | null;
        }[]) {
          const ts = s.speakers_updated_at ? new Date(s.speakers_updated_at).getTime() : 0;
          if (ts && now - ts < 5000 && s.active_speakers) {
            try {
              const arr = JSON.parse(s.active_speakers);
              if (Array.isArray(arr)) {
                speakersMap.set(
                  s.room_name,
                  arr.filter((x): x is string => typeof x === "string"),
                );
              }
            } catch {
              /* ignore json inválido */
            }
          }
        }

        const withParts = await Promise.all(
          names.map(async (name) => {
            try {
              const parts = await svc.listParticipants(name);
              return {
                name,
                isPrivate: privacyMap.get(name) ?? false,
                participants: parts.map((p) => ({
                  identity: p.identity,
                  name: p.name || p.identity,
                })),
                activeSpeakers: speakersMap.get(name) ?? [],
              };
            } catch {
              return {
                name,
                isPrivate: privacyMap.get(name) ?? false,
                participants: [],
                activeSpeakers: speakersMap.get(name) ?? [],
              };
            }
          }),
        );
        bySector[sector] = withParts;
      }),
    );
    return { bySector };
  });

export const createRoomCall = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { targetUserId: string; roomName: string; roomLabel: string }) => {
      // `callerUserId` saiu: era quem aparecia chamando, escolhido por quem
      // chamava. Dava para tocar o telefone de alguém no nome de outra pessoa.
      const targetUserId = pessoaAlvo(input?.targetUserId);
      const roomName = sanitizeRoomName(input?.roomName);
      const roomLabel = sanitizeRoomLabel(input?.roomLabel, roomName);
      return { targetUserId, roomName, roomLabel };
    },
  )
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();
    if (eu === data.targetUserId) throw new Error("Você não pode chamar você mesmo");

    const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
    const pool = await getPool();
    await expireStaleCalls(pool);

    const res = await pool
      .request()
      .input("de", sql.Int, eu)
      .input("para", sql.Int, data.targetUserId)
      .input("sala", sql.NVarChar, data.roomName)
      .input("rotulo", sql.NVarChar, data.roomLabel)
      .query(
        // Os apelidos no SELECT devolvem os nomes que a interface já espera —
        // é o que evita renomear campo em uma dúzia de componentes.
        `INSERT INTO gestor.chamadas (de_pessoa_id, para_pessoa_id, sala, sala_rotulo)
         OUTPUT INSERTED.id,
                INSERTED.de_pessoa_id   AS caller_user_id,
                INSERTED.para_pessoa_id AS target_user_id,
                INSERTED.sala           AS room_name,
                INSERTED.sala_rotulo    AS room_label,
                INSERTED.situacao       AS status,
                INSERTED.em             AS created_at
         VALUES (@de, @para, @sala, @rotulo)`,
      );
    const call = res.recordset[0];
    if (!call) throw new Error("Não foi possível chamar essa pessoa agora");
    // Duas traduções na saída: a situação volta para o termo do app, e os ids
    // voltam para texto — `User.id` é string em toda a interface, e comparar
    // número com texto falharia em silêncio num `===`.
    return { call: recebidaParaApp(call) };
  });

export const listIncomingRoomCalls = createServerFn({ method: "POST" }).handler(async () => {
  // `userId` saiu: ele escolhia de quem eram as chamadas recebidas. Dava para
  // ver quem está ligando para quem, em tempo real.
  const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
  const eu = await pessoaDaSessao();

  const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
  const pool = await getPool();
  await expireStaleCalls(pool);

  const res = await pool
    .request()
    .input("uid", sql.Int, eu)
    .query(
      `SELECT TOP 3 id,
              de_pessoa_id   AS caller_user_id,
              para_pessoa_id AS target_user_id,
              sala           AS room_name,
              sala_rotulo    AS room_label,
              situacao       AS status,
              em             AS created_at
         FROM gestor.chamadas
        WHERE para_pessoa_id=@uid AND situacao='tocando'
          AND em >= DATEADD(second, -45, SYSDATETIMEOFFSET())
        ORDER BY em DESC`,
    );
  return { calls: (res.recordset ?? []).map(recebidaParaApp) };
});

export const updateRoomCallStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { callId: string; status: RoomCallStatus }) => {
    if (!input || typeof input.callId !== "string") throw new Error("Chamada inválida");
    const callId = input.callId.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(callId)
    ) {
      throw new Error("Chamada inválida");
    }
    const allowed: RoomCallStatus[] = ["accepted", "declined", "missed"];
    if (!allowed.includes(input.status)) throw new Error("Status inválido");
    // `userId` saiu: ele dizia quem estava atendendo. Dava para recusar a
    // chamada que tocava no telefone de outra pessoa.
    return { callId, status: input.status };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    // O `target_user_id=@uid` no WHERE continua sendo a trava — agora com um
    // @uid que o cliente não escolhe.
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.callId)
      .input("uid", sql.Int, eu)
      .input("situacao", sql.NVarChar, SITUACAO_NO_BANCO[data.status])
      .query(
        `UPDATE gestor.chamadas
           SET situacao=@situacao, respondida_em=SYSDATETIMEOFFSET()
         WHERE id=@id AND para_pessoa_id=@uid AND situacao='tocando'`,
      );
    return { ok: true };
  });

export const listOutgoingRoomCallUpdates = createServerFn({ method: "POST" })
  .inputValidator((input: { sinceIso?: string }) => {
    // `userId` saiu: ele escolhia de quem eram as chamadas feitas.
    const sinceIso =
      typeof input?.sinceIso === "string" && !Number.isNaN(Date.parse(input.sinceIso))
        ? input.sinceIso
        : new Date(Date.now() - 120_000).toISOString();
    return { sinceIso };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql, expireStaleCalls } = await import("@/integrations/db.server");
    const pool = await getPool();
    await expireStaleCalls(pool);

    const res = await pool
      .request()
      .input("uid", sql.Int, eu)
      .input("since", sql.DateTimeOffset, new Date(data.sinceIso))
      .query(
        `SELECT TOP 10 id,
                para_pessoa_id AS target_user_id,
                sala           AS room_name,
                sala_rotulo    AS room_label,
                situacao       AS status,
                respondida_em  AS handled_at,
                em             AS created_at
           FROM gestor.chamadas
          WHERE de_pessoa_id=@uid AND situacao IN ('recusada','perdida')
            AND respondida_em >= @since
          ORDER BY respondida_em DESC`,
      );
    return { calls: (res.recordset ?? []).map(enviadaParaApp) };
  });

export const purgeAllRooms = createServerFn({ method: "POST" }).handler(async () => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) throw new Error("LiveKit não configurado");
  const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const rooms = await svc.listRooms();
  const names = rooms.map((r) => r.name);
  await Promise.all(
    names.map(async (n) => {
      try {
        await svc.deleteRoom(n);
      } catch {
        /* ignore */
      }
    }),
  );
  const { getPool } = await import("@/integrations/db.server");
  const pool = await getPool();
  await pool.request().query(`DELETE FROM gestor.sala_pedidos_de_entrada`);
  await pool.request().query(`DELETE FROM gestor.sala_participantes`);
  await pool
    .request()
    .query(`UPDATE gestor.salas SET privada=0, atualizada_em=SYSDATETIMEOFFSET()`);
  return { deleted: names };
});

// ================= Room privacy / membership / knocks =================

function isDiretoriaRoom(roomName: string): boolean {
  return roomName === "diretoria" || roomName.startsWith("diretoria-");
}

export const getRoomAccess = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
  }))
  .handler(async ({ data }) => {
    // `userId` saiu: esta função responde "posso entrar?" E, quando a sala
    // privada está vazia, ADMITE quem perguntou. Com o id vindo do cliente, era
    // possível admitir outra pessoa — ou a si mesmo em nome dela.
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, isRoomMember, getRoomIsPrivate, setRoomStatePrivacy, upsertMember } =
      await import("@/integrations/db.server");
    const pool = await getPool();
    const forcePrivate = isDiretoriaRoom(data.roomName);
    let isPrivateState = await getRoomIsPrivate(pool, data.roomName);
    const member = await isRoomMember(pool, data.roomName, eu);

    // Salas de diretoria são sempre privadas e precisam de linha em room_state.
    if (forcePrivate && !isPrivateState) {
      await setRoomStatePrivacy(pool, data.roomName, true, eu);
      isPrivateState = true;
    }
    const isPrivate = forcePrivate || !!isPrivateState;

    // Sala privada e vazia: admite o primeiro a chegar como membro.
    if (isPrivate && !member) {
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const wsUrl = process.env.LIVEKIT_URL;
      let empty = true;
      if (apiKey && apiSecret && wsUrl) {
        try {
          const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          try {
            const parts = await svc.listParticipants(data.roomName);
            empty = !parts || parts.length === 0;
          } catch {
            empty = true;
          }
        } catch {
          empty = true;
        }
      }
      if (empty) {
        await upsertMember(pool, data.roomName, eu, eu);
        return { isPrivate, isMember: true, canJoin: true, pin: null, hasPin: false };
      }
    }
    return {
      isPrivate,
      isMember: member,
      canJoin: !isPrivate || member,
      pin: null,
      hasPin: false,
    };
  });

export const setRoomPrivacy = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; isPrivate: boolean }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    isPrivate: !!input?.isPrivate,
  }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, setRoomStatePrivacy, upsertMember, isRoomMember, getRoomIsPrivate } =
      await import("@/integrations/db.server");
    const pool = await getPool();

    /* Quem já é privada só muda por quem está dentro.
       Repare o `else` mais abaixo: reabrir a sala APAGA a lista de membros
       inteira. Sem esta trava, qualquer pessoa esvaziava a lista de uma sala
       privada alheia — e na chamada seguinte entrava, porque sala sem membros
       admite o primeiro que chega. Sala aberta continua livre para fechar:
       quem fecha é o primeiro a entrar, e vira membro no mesmo ato. */
    const jaEraPrivada = isDiretoriaRoom(data.roomName) || !!(await getRoomIsPrivate(pool, data.roomName));
    if (jaEraPrivada && !(await isRoomMember(pool, data.roomName, eu))) {
      throw new Error("Só quem participa da sala pode mudar a privacidade dela.");
    }

    const isPrivate = isDiretoriaRoom(data.roomName) || data.isPrivate;
    await setRoomStatePrivacy(pool, data.roomName, isPrivate, eu);
    if (isPrivate) {
      // Mantém quem já está conectado como membro (não expulsa ninguém).
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const wsUrl = process.env.LIVEKIT_URL;
      const memberIds = new Set<number>([eu]);
      if (apiKey && apiSecret && wsUrl) {
        try {
          const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
          const { RoomServiceClient } = await import("livekit-server-sdk");
          const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
          const parts = await svc.listParticipants(data.roomName);
          for (const p of parts) {
            // A identidade do LiveKit é "<id>-<sufixo>"; o pedaço da frente é
            // a pessoa. Agora precisa ser número, então quem não converter
            // (um convidado por link, por exemplo) simplesmente não entra na
            // lista de membros — que é o comportamento certo.
            const n = Number((p.identity || "").split("-")[0]);
            if (Number.isInteger(n) && n > 0) memberIds.add(n);
          }
        } catch {
          /* ignore */
        }
      }
      for (const uid of memberIds) {
        await upsertMember(pool, data.roomName, uid, eu);
      }
    } else {
      // Sala reaberta: limpa pedidos e lista de membros.
      const { sql } = await import("@/integrations/db.server");
      await pool
        .request()
        .input("room", sql.NVarChar, data.roomName)
        .query(`DELETE FROM gestor.sala_pedidos_de_entrada WHERE sala=@room`);
      await pool
        .request()
        .input("room", sql.NVarChar, data.roomName)
        .query(`DELETE FROM gestor.sala_participantes WHERE sala=@room`);
    }
    return { ok: true, pin: null };
  });

export const inviteToRoom = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; targetUserId: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    targetUserId: pessoaAlvo(input?.targetUserId),
  }))
  .handler(async ({ data }) => {
    /* Esta era a porta principal, e ela anulava todo o resto.
       A linha antiga inscrevia o PRÓPRIO convidador como membro, sem checar
       nada, com o id que ele mesmo mandava:

           upsertMember(pool, roomName, inviterUserId, inviterUserId)

       Ou seja: qualquer pessoa se colocava na sala privada da diretoria e, na
       chamada seguinte, o `getLiveKitToken` a deixava entrar — legitimamente,
       porque a essa altura ela era membro de verdade. Fechar só o token não
       resolveria nada enquanto isto existisse. */
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, upsertMember, isRoomMember, getRoomIsPrivate } = await import(
      "@/integrations/db.server"
    );
    const pool = await getPool();

    // Convite é um direito de quem está dentro. Em sala aberta a lista de
    // membros não decide entrada, então não há o que proteger.
    const privada = isDiretoriaRoom(data.roomName) || !!(await getRoomIsPrivate(pool, data.roomName));
    if (privada && !(await isRoomMember(pool, data.roomName, eu))) {
      throw new Error("Só quem participa da sala pode convidar alguém.");
    }

    await upsertMember(pool, data.roomName, eu, eu);
    await upsertMember(pool, data.roomName, data.targetUserId, eu);
    return { ok: true };
  });

export const knockRoom = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; userName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    // `userId` saiu: dava para bater na porta em nome de outra pessoa, e o
    // nome que aparece para quem aprova vinha do mesmo lugar.
    userName:
      typeof input?.userName === "string" && input.userName.trim()
        ? input.userName.trim().slice(0, 80)
        : "",
  }))
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql, isRoomMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    if (await isRoomMember(pool, data.roomName, eu)) {
      return { status: "approved" as const, knockId: null };
    }
    // Reaproveita pedido pendente/aprovado se existir.
    const existing = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("uid", sql.Int, eu)
      .query(
        `SELECT TOP 1 id, situacao AS status FROM gestor.sala_pedidos_de_entrada
          WHERE sala=@room AND pessoa_id=@uid AND situacao IN ('esperando','aceito')
          ORDER BY em DESC`,
      );
    const ex = existing.recordset[0] as { id: string; status: "pending" | "approved" } | undefined;
    if (ex) return { status: ex.status, knockId: ex.id };

    const inserted = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("uid", sql.Int, eu)
      .input("name", sql.NVarChar, data.userName || String(eu))
      .query(
        `INSERT INTO gestor.sala_pedidos_de_entrada (sala, pessoa_id, pessoa_nome)
         OUTPUT INSERTED.id VALUES (@room, @uid, @name)`,
      );
    return { status: "pending" as const, knockId: inserted.recordset[0].id as string };
  });

export const getKnockStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { knockId: string }) => {
    const id = typeof input?.knockId === "string" ? input.knockId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pedido inválido");
    return { knockId: id };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.knockId)
      .query(`SELECT situacao AS status FROM gestor.sala_pedidos_de_entrada WHERE id=@id`);
    const status = (r.recordset[0]?.status ?? "unknown") as
      | "pending"
      | "approved"
      | "denied"
      | "unknown";
    return { status };
  });

export const listRoomKnocks = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string }) => ({
    roomName: sanitizeRoomName(input?.roomName),
  }))
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .query(
        `SELECT id,
                pessoa_id   AS requester_user_id,
                pessoa_nome AS requester_name,
                situacao    AS status,
                em          AS created_at
           FROM gestor.sala_pedidos_de_entrada
          WHERE sala=@room AND situacao='esperando'
          ORDER BY em ASC`,
      );
    return {
      knocks: (r.recordset ?? []).map(
        (k: {
          id: string;
          requester_user_id: number;
          requester_name: string;
          status: string;
          created_at: Date;
        }) => ({
          ...k,
          // A interface compara ids como texto (User.id é string no app).
          requester_user_id: String(k.requester_user_id),
          status: PEDIDO_NO_APP[k.status] ?? k.status,
          created_at: iso(k.created_at) as string,
        }),
      ),
    };
  });

export const resolveKnock = createServerFn({ method: "POST" })
  .inputValidator((input: { knockId: string; approve: boolean }) => {
    const id = typeof input?.knockId === "string" ? input.knockId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Pedido inválido");
    // `resolverUserId` saiu: era quem assinava a aprovação.
    return { knockId: id, approve: !!input?.approve };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, sql, upsertMember, isRoomMember } = await import("@/integrations/db.server");
    const pool = await getPool();
    const kr = await pool
      .request()
      .input("id", sql.UniqueIdentifier, data.knockId)
      .query(
        `SELECT id, sala AS room_name, pessoa_id AS requester_user_id, situacao AS status
           FROM gestor.sala_pedidos_de_entrada WHERE id=@id`,
      );
    const knock = kr.recordset[0] as
      | { id: string; room_name: string; requester_user_id: number; status: string }
      | undefined;
    if (!knock || knock.status !== "esperando") return { ok: false };

    /* Aprovar um pedido é o outro caminho para virar membro — e antes não havia
       checagem nenhuma de quem aprovava. Quem batesse na porta podia aprovar o
       próprio pedido: bastava mandar o `knockId` que acabou de receber. */
    if (!(await isRoomMember(pool, knock.room_name, eu))) {
      throw new Error("Só quem participa da sala pode responder a um pedido.");
    }

    await pool
      .request()
      .input("id", sql.UniqueIdentifier, knock.id)
      .input("situacao", sql.NVarChar, data.approve ? PEDIDO_NO_BANCO.approved : PEDIDO_NO_BANCO.denied)
      .input("por", sql.Int, eu)
      .query(
        `UPDATE gestor.sala_pedidos_de_entrada
           SET situacao=@situacao, respondido_por=@por, respondido_em=SYSDATETIMEOFFSET()
         WHERE id=@id`,
      );
    if (data.approve) {
      await upsertMember(pool, knock.room_name, knock.requester_user_id, eu);
    }
    return { ok: true };
  });

// Publica quem está falando para aparecer no card da sala.
export const updateActiveSpeakers = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; speakers: string[] }) => {
    const roomName = sanitizeRoomName(input?.roomName);
    const speakers = Array.isArray(input?.speakers)
      ? input.speakers
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return { roomName, speakers };
  })
  .handler(async ({ data }) => {
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("room", sql.NVarChar, data.roomName)
      .input("spk", sql.NVarChar(sql.MAX), JSON.stringify(data.speakers))
      .query(
        `IF EXISTS (SELECT 1 FROM gestor.salas WHERE sala=@room)
           UPDATE gestor.salas SET locutores=@spk, locutores_em=SYSDATETIMEOFFSET() WHERE sala=@room;
         ELSE
           INSERT INTO gestor.salas (sala, locutores, locutores_em) VALUES (@room, @spk, SYSDATETIMEOFFSET());`,
      );
    return { ok: true };
  });

// =============== External guest invites ===============
// Tokens curtos assinados com LIVEKIT_API_SECRET — sem linha no banco.

function base64UrlEncode(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const s = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signGuestToken(payload: { r: string; e: number }, secret: string) {
  const enc = new TextEncoder();
  const body = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body) as BufferSource);
  return `${body}.${base64UrlEncode(sig)}`;
}

async function verifyGuestToken(token: string, secret: string): Promise<{ r: string; e: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(sig) as BufferSource,
    enc.encode(body) as BufferSource,
  );
  if (!ok) return null;
  try {
    const dec = new TextDecoder().decode(base64UrlDecode(body));
    const parsed = JSON.parse(dec) as { r: string; e: number };
    if (typeof parsed?.r !== "string" || typeof parsed?.e !== "number") return null;
    if (parsed.e < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const createGuestInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; hours?: number }) => ({
    roomName: sanitizeRoomName(input?.roomName),
    hours: Math.max(1, Math.min(72, Math.floor(input?.hours ?? 24))),
  }))
  .handler(async ({ data }) => {
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!secret) throw new Error("LiveKit não configurado no servidor");

    /* Este é o mais perigoso dos convites: ele devolve um token que dá entrada
       a QUALQUER pessoa com o link, sem login, por até 72 horas. E a linha de
       baixo inscrevia o convidador como membro — o mesmo furo do inviteToRoom,
       mas com um link compartilhável no fim. */
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    const { getPool, upsertMember, isRoomMember, getRoomIsPrivate } = await import(
      "@/integrations/db.server"
    );
    const pool = await getPool();

    const privada = isDiretoriaRoom(data.roomName) || !!(await getRoomIsPrivate(pool, data.roomName));
    if (privada && !(await isRoomMember(pool, data.roomName, eu))) {
      throw new Error("Só quem participa da sala pode gerar convite de visitante.");
    }

    await upsertMember(pool, data.roomName, eu, eu);
    const exp = Math.floor(Date.now() / 1000) + data.hours * 3600;
    const token = await signGuestToken({ r: data.roomName, e: exp }, secret);
    return { token, expiresAt: exp };
  });

export const getGuestLiveKitToken = createServerFn({ method: "POST" })
  .inputValidator((input: { roomName: string; guestToken: string; name: string }) => {
    const roomName = sanitizeRoomName(input?.roomName);
    const guestToken =
      typeof input?.guestToken === "string" ? input.guestToken.trim().slice(0, 512) : "";
    if (!guestToken || !/^[A-Za-z0-9_\-.]+$/.test(guestToken)) {
      throw new Error("Convite inválido");
    }
    const name = (typeof input?.name === "string" ? input.name : "").trim().slice(0, 60);
    if (name.length < 2) throw new Error("Digite seu nome");
    return { roomName, guestToken, name };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) throw new Error("LiveKit não configurado no servidor");
    const verified = await verifyGuestToken(data.guestToken, apiSecret);
    if (!verified || verified.r !== data.roomName) {
      throw new Error("Convite expirado ou inválido");
    }
    const { AccessToken } = await import("livekit-server-sdk");
    const identity = `guest-${Math.random().toString(36).slice(2, 10)}`;
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: `${data.name} (convidado)`,
      ttl: 60 * 60 * 4,
    });
    at.addGrant({
      room: data.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    return { token, url, identity };
  });
