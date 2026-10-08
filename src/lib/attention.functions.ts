import { createServerFn } from "@tanstack/react-start";

const sanitizeUserId = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Usuário inválido");
  const id = value.trim().slice(0, 80);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Usuário inválido");
  return id;
};

/** Id de outra pessoa como número — `gestor.avisos_de_tela` guarda `INT`. */
const pessoaAlvo = (v: unknown): number => {
  const n = Number(sanitizeUserId(v));
  if (!Number.isInteger(n) || n <= 0) throw new Error("Usuário inválido");
  return n;
};

/** Tipos de aviso que trafegam pela mesma tabela. */
export type TipoAviso = "cutucada" | "trator" | "emoji";

/* O emoji gigante (estilo MSN, 08/10/2026) viaja como cutucada com a
   mensagem "emoji:❤️". A tabela só aceita os tipos `cutucada` e `trator`
   (CK_gestor_aviso_tipo), e assim não foi preciso mexer nela — e quem estiver
   com o app antigo recebe uma cutucada comum, em vez de nada. */
export const PREFIXO_EMOJI = "emoji:";

/** A resposta compartilhada da sondagem de avisos — ver `listNudgesFn`. */
const CHAVE_RECENTES = "avisos-de-tela:recentes";

/**
 * Envia um aviso gravando no Azure SQL — cutucada ou trator.
 * O destinatário recebe por polling (mesma mecânica das chamadas, que é
 * a que funciona de forma confiável entre máquinas).
 *
 * Os dois compartilham tabela e sondagem de propósito: mudam só o tipo e a
 * mensagem. Duplicar a mecânica daria dois laços de polling para manter.
 */
export const sendNudgeFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      fromName: string;
      fromAvatar?: string;
      targetUserId: string;
      kind?: string;
      message?: string;
    }) => {
      // `fromUserId` saiu: era o remetente escolhido pelo cliente. Dava para
      // cutucar alguém, ou atravessar a tela dela com uma faixa, assinando com
      // o nome de outra pessoa.
      const targetUserId = pessoaAlvo(input?.targetUserId);
      const fromName =
        typeof input?.fromName === "string" && input.fromName.trim()
          ? input.fromName.trim().slice(0, 120)
          : "";
      const fromAvatar =
        typeof input?.fromAvatar === "string" ? input.fromAvatar.trim().slice(0, 20) : "";
      const pedido = input?.kind === "trator" ? "trator" : input?.kind === "emoji" ? "emoji" : "cutucada";
      const texto = typeof input?.message === "string" ? input.message.trim() : "";
      if (pedido === "emoji") {
        // Um emoji só, curto e pictográfico — não vira canal de texto livre.
        if (!texto || texto.length > 16 || !/\p{Extended_Pictographic}/u.test(texto))
          throw new Error("Emoji inválido");
        return { fromName, fromAvatar, targetUserId, kind: "cutucada" as const, message: `${PREFIXO_EMOJI}${texto}` };
      }
      const kind: "trator" | "cutucada" = pedido;
      // 200 é o limite da coluna; faixa maior que isso não caberia na tela também.
      const message = kind === "trator" ? texto.slice(0, 200) : "";
      if (kind === "trator" && !message) throw new Error("O trator precisa de uma mensagem");
      return { fromName, fromAvatar, targetUserId, kind, message };
    },
  )
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();
    if (eu === data.targetUserId) throw new Error("Você não pode se cutucar");

    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("de", sql.Int, eu)
      // O nome ainda vem do cliente porque é rótulo de exibição, não permissão.
      // O que identifica é o `from_user_id` ao lado, e esse é da sessão — então
      // um nome mentiroso fica desmentido pelo id na mesma linha.
      .input("name", sql.NVarChar, data.fromName || String(eu))
      .input("avatar", sql.NVarChar, data.fromAvatar || null)
      .input("para", sql.Int, data.targetUserId)
      .input("tipo", sql.NVarChar, data.kind)
      .input("msg", sql.NVarChar, data.message || null)
      .query(
        `INSERT INTO gestor.avisos_de_tela
           (de_pessoa_id, de_nome, de_avatar, para_pessoa_id, tipo, mensagem)
         VALUES (@de, @name, @avatar, @para, @tipo, @msg)`,
      );
    // A sondagem seguinte de quem recebe já lê o aviso novo, sem esperar a resposta guardada vencer.
    const { esquecer } = await import("@/lib/cache-compartilhado.server");
    esquecer(CHAVE_RECENTES);
    return { ok: true };
  });

/**
 * Busca avisos recebidos numa janela curta.
 *
 * A janela é calculada DENTRO do SQL, com `SYSUTCDATETIME()`. Antes o cliente
 * mandava um instante do relógio dele, e isso quebrava: o Azure SQL estava 2
 * minutos atrás da máquina, então todo aviso recém-gravado nascia "no passado"
 * em relação ao filtro e sumia sem erro nenhum. Comparar o relógio do banco com
 * ele mesmo elimina a diferença — quem cuida de não repetir é o cliente, que já
 * guarda os ids que viu.
 */
export const listNudgesFn = createServerFn({ method: "POST" })
  .validator((input: { janelaSegundos?: number }) => {
    // `userId` saiu: ele escolhia de quem eram os avisos lidos. Como a mensagem
    // do trator vai junto na resposta, dava para ler o que foi mandado para
    // qualquer pessoa.
    const bruto = Number(input?.janelaSegundos);
    const janelaSegundos = Number.isFinite(bruto) ? Math.min(300, Math.max(5, bruto)) : 60;
    return { janelaSegundos };
  })
  .handler(async ({ data }) => {
    const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
    const eu = await pessoaDaSessao();

    /* Os avisos dos últimos 5 minutos (a maior janela aceita) de TODO mundo,
       numa consulta só guardada por 1 s (ver `cache-compartilhado.server`);
       cada pessoa fica com os dela. Era uma consulta por pessoa por segundo, a
       sondagem mais frequente do app.

       A idade de cada aviso sai do SQL, medida pelo relógio do banco contra ele
       mesmo, como o comentário acima pede. Aqui só se soma o tempo que a
       resposta passou guardada, medido pelo relógio do servidor contra ele
       mesmo: nenhum dos dois relógios é comparado com o outro. */
    const { compartilhado } = await import("@/lib/cache-compartilhado.server");
    const busca = await compartilhado(CHAVE_RECENTES, 1_000, async () => {
      const { getPool } = await import("@/integrations/db.server");
      const pool = await getPool();
      const res = await pool.request().query(
        // Apelidos devolvem os nomes que o overlay já espera.
        `SELECT id,
                para_pessoa_id,
                de_pessoa_id AS from_user_id,
                de_nome      AS from_name,
                de_avatar    AS from_avatar,
                tipo         AS kind,
                mensagem     AS message,
                em           AS created_at,
                DATEDIFF_BIG(millisecond, em, SYSDATETIMEOFFSET()) AS idade_ms
           FROM gestor.avisos_de_tela
          WHERE em > DATEADD(second, -300, SYSDATETIMEOFFSET())
          ORDER BY em DESC`,
      );
      return {
        lidaEm: Date.now(),
        avisos: res.recordset as {
          id: string;
          para_pessoa_id: number;
          from_user_id: number;
          from_name: string;
          from_avatar: string | null;
          kind: string;
          message: string | null;
          created_at: Date;
          idade_ms: number | string;
        }[],
      };
    });
    const guardadaHa = Date.now() - busca.lidaEm;
    return {
      nudges: busca.avisos
        .filter(
          (n) =>
            n.para_pessoa_id === eu &&
            Number(n.idade_ms) + guardadaHa < data.janelaSegundos * 1000,
        )
        .slice(0, 5)
        .map(({ para_pessoa_id: _destinatario, idade_ms: _idade, ...n }) => ({
          ...n,
          // `User.id` é string no app; comparar 467 com "467" daria falso.
          from_user_id: String(n.from_user_id),
          created_at: n.created_at.toISOString(),
        })),
    };
  });
