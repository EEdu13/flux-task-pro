/*
 * Lado do servidor da presença nas reuniões — ver `presenca-reuniao.functions.ts`.
 * Arquivo `.server.ts`: só o servidor importa (banco e LiveKit).
 */
import type { LinhaDePresenca, RelatorioDePresenca } from "@/lib/presenca-reuniao.functions";

/** Sem sinal por mais que isto, a pessoa saiu (ou a reunião acabou). */
export const JANELA_MIN = 3;

export type Participante = {
  identidade: string;
  pessoa_id: number | null;
  nome: string;
  convidado: boolean;
};

export async function participantesNoLiveKit(sala: string): Promise<Participante[]> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) throw new Error("LiveKit não configurado no servidor");
  const httpUrl = wsUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const svc = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  const lista = await svc.listParticipants(sala);
  return lista.map((p) => {
    // Quem entra logado tem identidade "<id>-<nome>" (ver getLiveKitToken).
    const m = /^(\d+)-/.exec(p.identity);
    return {
      identidade: p.identity.slice(0, 120),
      pessoa_id: m ? Number(m[1]) : null,
      nome: (p.name || p.identity).slice(0, 160),
      convidado: !m,
    };
  });
}

/** O relatório de uma reunião — para quem a abriu e para a gerência. */
export async function montarRelatorio(
  eu: number,
  reuniaoId: string,
): Promise<RelatorioDePresenca | null> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, eu)
    .input("id", sql.UniqueIdentifier, reuniaoId)
    .query(
      `DECLARE @gerente BIT = CASE WHEN EXISTS (SELECT 1 FROM gestor.perfis WHERE pessoa_id=@eu AND papel=N'gerente') THEN 1 ELSE 0 END;
       DECLARE @limite DATETIMEOFFSET(3) = DATEADD(minute, -${JANELA_MIN}, SYSDATETIMEOFFSET());
       SELECT r.id, r.sala, r.titulo_da_sala, r.inicio, r.ultimo_sinal,
              CASE WHEN r.ultimo_sinal >= @limite THEN 1 ELSE 0 END AS aberta,
              (SELECT nome FROM gestor.perfis WHERE pessoa_id = r.criada_por) AS criador
         FROM gestor.reunioes r
        WHERE r.id = @id AND (r.criada_por = @eu OR @gerente = 1);
       SELECT rp.identidade, rp.nome, rp.convidado, rp.entrou_em, rp.ultimo_sinal,
              CASE WHEN rp.ultimo_sinal >= @limite THEN 1 ELSE 0 END AS agora
         FROM gestor.reuniao_presencas rp
         JOIN gestor.reunioes r ON r.id = rp.reuniao_id
        WHERE rp.reuniao_id = @id AND (r.criada_por = @eu OR @gerente = 1)
        ORDER BY rp.entrou_em;`,
    );
  const sets = r.recordsets as unknown as Record<string, unknown>[][];
  const cab = sets[0]?.[0];
  if (!cab) return null;
  const trechos = sets[1] ?? [];
  const porPessoa = new Map<string, LinhaDePresenca>();
  for (const t of trechos) {
    const id = String(t.identidade);
    const ini = t.entrou_em as Date;
    const fim = t.ultimo_sinal as Date;
    const seg = Math.max(0, Math.round((fim.getTime() - ini.getTime()) / 1000));
    const atual = porPessoa.get(id);
    if (!atual) {
      porPessoa.set(id, {
        identidade: id,
        nome: String(t.nome),
        convidado: !!t.convidado,
        primeiraEntrada: ini.toISOString(),
        ultimaSaida: fim.toISOString(),
        segundos: seg,
        entradas: 1,
        presenteAgora: !!t.agora,
      });
    } else {
      atual.segundos += seg;
      atual.entradas += 1;
      if (fim.toISOString() > atual.ultimaSaida) atual.ultimaSaida = fim.toISOString();
      atual.presenteAgora = atual.presenteAgora || !!t.agora;
    }
  }
  const total = await pool
    .request()
    .input("id", sql.UniqueIdentifier, reuniaoId)
    .query(
      `SELECT COUNT(DISTINCT identidade) AS n FROM gestor.reuniao_presencas WHERE reuniao_id=@id`,
    );
  return {
    reuniao: {
      id: String(cab.id),
      sala: String(cab.sala),
      titulo: String(cab.titulo_da_sala ?? cab.sala),
      inicio: (cab.inicio as Date).toISOString(),
      fim: (cab.ultimo_sinal as Date).toISOString(),
      aberta: !!cab.aberta,
      participantes: Number((total.recordset[0] as { n: number }).n),
      criador: String(cab.criador ?? ""),
    },
    linhas: [...porPessoa.values()].sort((a, b) =>
      a.primeiraEntrada.localeCompare(b.primeiraEntrada),
    ),
  };
}
