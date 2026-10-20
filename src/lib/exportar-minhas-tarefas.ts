import { baixarXlsx, type Celula } from "@/lib/planilha-xlsx";
import {
  freqLabels,
  priorityLabels,
  sectors,
  statusLabels,
  type Frequency,
  type Priority,
  type Status,
} from "@/lib/fluxo-types";

/**
 * "Exportar para Excel" de Minhas tarefas (19/10/2026: "exportar minhas
 * tarefas completo, pra ver todas que ele fez no Excel, até as concluídas").
 *
 * Busca no servidor TODAS as tarefas de que a pessoa é responsável — inclusive
 * as concluídas e as arquivadas, que o quadro não mostra — e baixa uma
 * planilha .xlsx com duas abas: "Tarefas" (uma linha por tarefa, tudo o que
 * se sabe dela) e "Resumo" (os totais). Devolve quantas tarefas saíram.
 */
export async function exportarMinhasTarefasXlsx(nomeDaPessoa: string): Promise<number> {
  const { exportarMinhasTarefas } = await import("@/lib/tarefas.functions");
  const { tarefas } = await exportarMinhasTarefas();

  const data = (iso: string | null) => (iso ? new Date(iso) : null);
  // "2026-10-17" é um DIA: meio-dia local evita escorregar para o dia anterior.
  const dia = (s: string | null) => (s ? new Date(`${s}T12:00:00`) : null);
  const setor = (id: string | null) => sectors.find((s) => s.id === id)?.name ?? id ?? "";
  const minutos = (seg: number) => Math.round(seg / 60);

  const linhas: Celula[][] = [
    [
      "Título",
      "Situação",
      "Prioridade",
      "Projeto",
      "Setor",
      "Criada por",
      "Criada em",
      "Prazo",
      "Horário",
      "Concluída em",
      "Data real de conclusão",
      "Arquivada em",
      "Repete",
      "Frequência",
      "No pack",
      "Pontos",
      "Tempo estimado (min)",
      "Tempo trabalhado (min)",
      "Checklist",
      "Etiquetas",
      "Descrição",
    ],
    ...tarefas.map((t) => [
      t.titulo,
      statusLabels[t.situacao as Status] ?? t.situacao,
      priorityLabels[t.prioridade as Priority] ?? t.prioridade,
      t.projeto ?? "",
      setor(t.setor),
      t.criador ?? "",
      data(t.criadaEm),
      data(t.prazo),
      t.horario ?? "",
      data(t.concluidaEm),
      dia(t.dataReal),
      data(t.arquivadaEm),
      t.recorrente ? "Sim" : "Não",
      t.recorrente ? (freqLabels[t.frequencia as Frequency] ?? t.frequencia) : "",
      t.noPack ? "Sim" : "Não",
      t.pontos,
      t.minutosEstimados ?? null,
      t.segundosTrabalhados ? minutos(t.segundosTrabalhados) : null,
      t.passos ? `${t.passosFeitos}/${t.passos}` : "",
      t.etiquetas ?? "",
      t.descricao ?? "",
    ]),
  ];

  const conta = (s: string) => tarefas.filter((t) => t.situacao === s).length;
  const segundos = tarefas.reduce((n, t) => n + t.segundosTrabalhados, 0);
  const resumo: Celula[][] = [
    ["Minhas tarefas", nomeDaPessoa],
    ["Exportado em", new Date()],
    ["Total de tarefas", tarefas.length],
    ["Concluídas", conta("concluida")],
    ["Em andamento", conta("andamento")],
    ["A fazer", conta("pendente")],
    ["Arquivadas", tarefas.filter((t) => t.arquivadaEm).length],
    ["Horas trabalhadas (cronômetro)", Math.round((segundos / 3600) * 10) / 10],
  ];

  const hoje = new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
  baixarXlsx(`minhas-tarefas-${hoje}`, [
    { nome: "Tarefas", linhas },
    { nome: "Resumo", linhas: resumo },
  ]);
  return tarefas.length;
}
