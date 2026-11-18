import { createServerFn } from "@tanstack/react-start";
import { comSessaoSemEntrada } from "@/integrations/iam/funcao-com-sessao";

/**
 * O Gantt no servidor (18/11/2026).
 *
 * Por ora uma pergunta só: quais tarefas de projeto a pessoa pode arrastar. A tela usa a
 * resposta para travar a barra e dizer o motivo; a gravação continua passando pelo
 * `salvarTarefa`, que confere de novo (ver `tarefasQuePodeReplanejar`).
 */

/** Os ids (em minúsculas) das tarefas de projeto que eu posso replanejar. */
export const tarefasQuePossoReplanejar = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu): Promise<string[]> => {
    const { tarefasQuePodeReplanejar } = await import("@/lib/permissoes.server");
    return tarefasQuePodeReplanejar(eu);
  }),
);
