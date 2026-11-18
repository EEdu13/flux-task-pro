import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";
import type { DependenciaDoGantt } from "@/lib/gantt.server";

/**
 * O Gantt no servidor (Módulos 4 e 5, 18/11/2026).
 *
 * - quem pode arrastar cada tarefa de projeto (a tela trava a barra e diz o motivo; a
 *   gravação continua passando pelo `salvarTarefa`, que confere de novo);
 * - as dependências que a pessoa vê, e ligar e desligar uma (ver `gantt.server.ts`).
 */

export interface DadosDoGantt {
  /** Ids (minúsculos) das tarefas de projeto que eu posso replanejar. */
  podeReplanejar: string[];
  dependencias: DependenciaDoGantt[];
}

export const dadosDoGantt = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<DadosDoGantt> => {
    const [{ tarefasQuePodeReplanejar }, { dependenciasVisiveis }] = await Promise.all([
      import("@/lib/permissoes.server"),
      import("@/lib/gantt.server"),
    ]);
    const [podeReplanejar, dependencias] = await Promise.all([
      tarefasQuePodeReplanejar(eu),
      dependenciasVisiveis(eu),
    ]);
    return { podeReplanejar, dependencias };
  }),
);

const guid = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;

const parDeTarefas = semIdentidade((e: { tarefaId: string; dependeDeId: string }) => {
  const tarefaId = guid(e?.tarefaId);
  const dependeDeId = guid(e?.dependeDeId);
  if (!tarefaId || !dependeDeId) throw new Error("Tarefa inválida");
  return { tarefaId, dependeDeId };
});

/** `tarefaId` passa a esperar `dependeDeId` terminar. */
export const ligarDependencia = createServerFn({ method: "POST" })
  .validator(parDeTarefas)
  .handler(
    comSessao(async (eu, d: { tarefaId: string; dependeDeId: string }) => {
      const s = await import("@/lib/gantt.server");
      return s.ligarDependencia(eu, d.tarefaId, d.dependeDeId);
    }),
  );

/** `tarefaId` deixa de esperar `dependeDeId`. */
export const desligarDependencia = createServerFn({ method: "POST" })
  .validator(parDeTarefas)
  .handler(
    comSessao(async (eu, d: { tarefaId: string; dependeDeId: string }) => {
      const s = await import("@/lib/gantt.server");
      return s.desligarDependencia(eu, d.tarefaId, d.dependeDeId);
    }),
  );
