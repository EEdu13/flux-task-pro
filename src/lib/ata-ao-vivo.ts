/**
 * A ata que o Claude escreve durante a reunião, e como ela vira o texto salvo.
 *
 * Sem imports de propósito: este arquivo é lido pela tela e pelo servidor
 * (`voz.server.ts`, que é carregado direto no Node pelos scripts de teste).
 */

/** Uma fala transcrita. `hora` já vem "HH:MM" no fuso de quem ouviu. */
export interface FalaDaReuniao {
  id: string;
  at: number;
  hora: string;
  quem: string;
  texto: string;
}

export interface PassoDaAta {
  acao: string;
  responsavel: string | null;
  prazo: string | null;
}

export interface AtaAoVivo {
  resumo: string;
  assuntos: { titulo: string; pontos: string[] }[];
  decisoes: string[];
  proximosPassos: PassoDaAta[];
  pontosDeAtencao: string[];
}

export const ATA_VAZIA: AtaAoVivo = {
  resumo: "",
  assuntos: [],
  decisoes: [],
  proximosPassos: [],
  pontosDeAtencao: [],
};

export const ataTemConteudo = (a: AtaAoVivo) =>
  !!a.resumo.trim() ||
  a.assuntos.length > 0 ||
  a.decisoes.length > 0 ||
  a.proximosPassos.length > 0 ||
  a.pontosDeAtencao.length > 0;

const txt = (v: unknown, teto: number) => (typeof v === "string" ? v.trim().slice(0, teto) : "");
const lista = (v: unknown, teto: number, itens = 60) =>
  Array.isArray(v)
    ? v
        .slice(0, itens)
        .map((x) => txt(x, teto))
        .filter(Boolean)
    : [];

/** Confere a forma de uma ata que veio de fora (outro participante, o cliente). */
export function ataDaEntrada(v: unknown): AtaAoVivo {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    resumo: txt(o.resumo, 2000),
    assuntos: (Array.isArray(o.assuntos) ? o.assuntos : []).slice(0, 40).flatMap((a) => {
      const titulo = txt((a as { titulo?: unknown })?.titulo, 200);
      return titulo ? [{ titulo, pontos: lista((a as { pontos?: unknown })?.pontos, 600, 30) }] : [];
    }),
    decisoes: lista(o.decisoes, 600),
    proximosPassos: (Array.isArray(o.proximosPassos) ? o.proximosPassos : [])
      .slice(0, 60)
      .flatMap((p) => {
        const r = (p ?? {}) as Record<string, unknown>;
        const acao = txt(r.acao, 400);
        return acao
          ? [{ acao, responsavel: txt(r.responsavel, 120) || null, prazo: txt(r.prazo, 80) || null }]
          : [];
      }),
    pontosDeAtencao: lista(o.pontosDeAtencao, 600),
  };
}

const marcadores = (itens: string[], vazio: string) =>
  itens.length ? itens.map((i) => `- ${i}`).join("\n") : vazio;

/**
 * O texto salvo em Atas & Planos.
 *
 * Os títulos das seções são os que a tela de atas e o `parseTopics` antigo
 * reconhecem — atas velhas e novas continuam lidas do mesmo jeito.
 */
export function ataParaMarkdown(
  a: AtaAoVivo,
  cabecalho: { titulo: string; participantes: string[] },
): string {
  const passos = a.proximosPassos.length
    ? a.proximosPassos
        .map((p) => {
          const quem = p.responsavel ? ` — ${p.responsavel}` : "";
          const quando = p.prazo ? ` (${p.prazo})` : "";
          return `- [ ] ${p.acao}${quem}${quando}`;
        })
        .join("\n")
    : "Nenhuma pendência registrada.";

  const assuntos = a.assuntos.length
    ? a.assuntos
        .map((s) => [`**${s.titulo}**`, ...s.pontos.map((p) => `- ${p}`)].join("\n"))
        .join("\n\n")
    : "Nenhum assunto registrado.";

  return [
    `## Ata — ${cabecalho.titulo}`,
    `**Participantes:** ${cabecalho.participantes.join(", ") || "não identificados"}`,
    "",
    "### Resumo executivo",
    a.resumo || "Sem resumo.",
    "",
    "### Assuntos discutidos",
    assuntos,
    "",
    "### Decisões tomadas",
    marcadores(a.decisoes, "Nenhuma decisão registrada."),
    "",
    "### Próximos passos / pendências",
    passos,
    "",
    "### Pontos de atenção",
    marcadores(a.pontosDeAtencao, "Nenhum ponto de atenção registrado."),
  ].join("\n");
}

/** O plano de ação da ata: cada item vira um tópico que pode virar tarefa. */
export function topicosDaAta(
  a: AtaAoVivo,
): { text: string; kind: "decisao" | "proximo" | "atencao" }[] {
  return [
    ...a.decisoes.map((text) => ({ text, kind: "decisao" as const })),
    ...a.proximosPassos.map((p) => ({
      text: [p.acao, p.responsavel && `— ${p.responsavel}`, p.prazo && `(${p.prazo})`]
        .filter(Boolean)
        .join(" "),
      kind: "proximo" as const,
    })),
    ...a.pontosDeAtencao.map((text) => ({ text, kind: "atencao" as const })),
  ];
}
