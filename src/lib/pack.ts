import type { Task } from "./fluxo-types";

/* O pack do dia.

   A marca de "feito hoje" morava no localStorage: um conjunto de ids por
   pessoa e por dia, separado da situação da tarefa. Três defeitos saíam daí.
   O que aparecia na tela: a tarefa concluída no quadro continuava sem marca no
   pack ("0/1 feitos"), e marcar no pack não concluía nada no banco. O segundo:
   o id da tarefa criada na sessão mudava de caixa na sincronização (ver
   `novoId`), e a marca feita antes deixava de casar — o item "desmarcava"
   sozinho. O terceiro: outro computador não sabia de nada.

   Agora "feito hoje" é o que o banco diz: a tarefa está concluída e o clique
   que a concluiu (`concluida_em`, aqui `completedAt`) foi hoje. Marcar no pack
   conclui a tarefa de verdade — com pontos, Timeline e desfazer, como em
   qualquer outro lugar —, e o servidor não conclui duas vezes o que já está
   concluído. */

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Concluída, e concluída hoje — no fuso de quem vê. */
export function concluidaHoje(
  t: Pick<Task, "status" | "completedAt">,
  agora: Date = new Date(),
): boolean {
  if (t.status !== "concluida" || !t.completedAt) return false;
  const quando = new Date(t.completedAt);
  return !Number.isNaN(quando.getTime()) && mesmoDia(quando, agora);
}

/**
 * Está no pack de hoje desta pessoa: o que falta fazer, e o que ela concluiu
 * hoje — que fica riscado até a virada do dia. O que foi concluído antes de
 * hoje fica de fora: era do pack de outro dia.
 */
export function noPackDeHoje(t: Task, pessoaId: string, agora: Date = new Date()): boolean {
  if (!t.inPack || t.assigneeId !== pessoaId) return false;
  return t.status !== "concluida" || concluidaHoje(t, agora);
}
