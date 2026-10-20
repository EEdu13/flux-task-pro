import { createFileRoute } from "@tanstack/react-router";

/**
 * O relatório de presença de uma reunião como PLANILHA do Excel (.xlsx — era
 * CSV até 13/10/2026; "CSV ninguém usa mais", pediu o usuário). Exige sessão,
 * e só sai para quem abriu a reunião ou para a gerência (a mesma regra de
 * `montarRelatorio`).
 *
 * Duas abas: "Presença" (a tabela, com filtro no cabeçalho) e "Reunião" (os
 * dados da reunião). As datas vão como texto já no horário de Brasília: o
 * servidor roda em UTC, e uma data "de verdade" sairia 3 horas adiantada.
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
        const { gerarXlsx, TIPO_XLSX } = await import("@/lib/planilha-xlsx");
        const arquivo = gerarXlsx([
          {
            nome: "Presença",
            linhas: [
              ["Nome", "Tipo", "Entrou", "Saiu", "Tempo na reunião", "Minutos", "Entradas"],
              ...rel.linhas.map((l) => [
                l.nome,
                l.convidado ? "Convidado" : "Colaborador",
                fmt(l.primeiraEntrada),
                l.presenteAgora ? "ainda na sala" : fmt(l.ultimaSaida),
                duracao(l.segundos),
                Math.round(l.segundos / 60),
                l.entradas,
              ]),
            ],
          },
          {
            nome: "Reunião",
            linhas: [
              ["Relatório de presença", r.titulo],
              ["Sala", r.sala],
              ["Aberta por", r.criador],
              ["Início", fmt(r.inicio)],
              [r.aberta ? "Em andamento até" : "Fim", fmt(r.fim)],
              [
                "Duração",
                duracao(
                  Math.max(0, (new Date(r.fim).getTime() - new Date(r.inicio).getTime()) / 1000),
                ),
              ],
              ["Participantes", rel.linhas.length],
            ],
          },
        ]);
        const dia = new Date(r.inicio)
          .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
          .replace(/\//g, "-");
        const nome = `presenca-${r.sala}-${dia}.xlsx`;
        return new Response(arquivo as BodyInit, {
          headers: {
            "content-type": TIPO_XLSX,
            "content-disposition": `attachment; filename="${nome}"`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
