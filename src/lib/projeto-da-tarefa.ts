import type { CSSProperties } from "react";
import { useFluxo } from "@/lib/fluxo-store";
import type { Project } from "@/lib/fluxo-types";

/**
 * O projeto de uma tarefa.
 *
 * Procura em TODOS os projetos, não só nos visíveis: quem recebe a subtarefa
 * pode não participar do projeto (foi incluído e depois saiu), e o cartão ainda
 * deve dizer de onde a tarefa veio. O id é comparado sem caixa porque o banco
 * devolve o GUID em maiúsculas e o que nasce no navegador vem em minúsculas.
 */
export function useProjetoDaTarefa(projectId?: string): Project | undefined {
  const { projects } = useFluxo();
  if (!projectId) return undefined;
  const alvo = projectId.toLowerCase();
  return projects.find((p) => p.id.toLowerCase() === alvo);
}

/** A cor do projeto, com a do tema quando ele não tem uma. */
export const corDoProjeto = (p: Project) => p.color ?? "var(--color-primary)";

/**
 * O cartão inteiro na cor do projeto.
 *
 * Fundo e borda puxados para a cor, e não pintados com ela: o cartão continua
 * sendo um cartão do tema (texto legível no claro e no escuro), só que dá para
 * ver de longe quais tarefas do quadro são do mesmo projeto.
 */
export function estiloDoCartaoDoProjeto(p: Project | undefined): CSSProperties | undefined {
  if (!p) return undefined;
  const cor = corDoProjeto(p);
  return {
    background: `color-mix(in oklab, ${cor} 13%, var(--card))`,
    borderColor: `color-mix(in oklab, ${cor} 55%, var(--border))`,
  };
}
