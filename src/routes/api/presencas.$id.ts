import { createFileRoute } from "@tanstack/react-router";

/**
 * O relatório de presença de uma reunião como PLANILHA (CSV), para abrir no
 * Excel. Exige sessão, e só sai para quem abriu a reunião ou para a gerência
 * (a mesma regra de `montarRelatorio`).
 *
 * Formato do Excel em português: separador ";", data dd/mm/aaaa e o BOM no
 * começo — sem ele o Excel lê os acentos errado.
 */
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const duracao = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
};
const cel = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export const Route = createFileRoute("/api/presencas/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = String(params.id ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("inválido", { status: 400 });
        let eu: number;
        try {
          const { pessoaDaSessao } = await import("@/integrations/iam/identidade.server");
          eu = await pessoaDaSessao();
        } catch {
          return new Response("não autorizado", { status: 401 });
        }
        const { montarRelatorio } = await import("@/lib/presenca-reuniao.server");
        const rel = await montarRelatorio(eu, id);
        if (!rel) return new Response("não encontrado", { status: 404 });

        const r = rel.reuniao;
        const linhas = [
          [cel("Relatório de presença"), cel(r.titulo)].join(";"),
          [cel("Sala"), cel(r.sala)].join(";"),
          [cel("Aberta por"), cel(r.criador)].join(";"),
          [cel("Início"), cel(fmt(r.inicio))].join(";"),
          [cel(r.aberta ? "Em andamento até" : "Fim"), cel(fmt(r.fim))].join(";"),
          [cel("Participantes"), cel(rel.linhas.length)].join(";"),
          "",
          ["Nome", "Tipo", "Entrou", "Saiu", "Tempo na reunião", "Entradas"].map(cel).join(";"),
          ...rel.linhas.map((l) =>
            [
              cel(l.nome),
              cel(l.convidado ? "Convidado" : "Colaborador"),
              cel(fmt(l.primeiraEntrada)),
              cel(l.presenteAgora ? "ainda na sala" : fmt(l.ultimaSaida)),
              cel(duracao(l.segundos)),
              cel(l.entradas),
            ].join(";"),
          ),
        ];
        const dia = new Date(r.inicio)
          .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
          .replace(/\//g, "-");
        const nome = `presenca-${r.sala}-${dia}.csv`;
        return new Response(String.fromCharCode(0xfeff) + linhas.join("\r\n"), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${nome}"`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
