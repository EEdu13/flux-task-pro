import type { PackTemplate, Project, Task, User } from "@/lib/fluxo-types";

/*
 * As regras de `permissoes.server.ts`, do lado da tela: servem para não
 * oferecer botão que o servidor vai recusar. A fechadura continua lá.
 *
 * A gerência pode tudo; o dono, o que é seu; o supervisor, o que é da equipe —
 * inclusive as tarefas dos subordinados (decisão do usuário, 30/09/2026). O
 * chefe é o `supervisorId`, que a store resolve pelo nome do chefe gravado no
 * perfil, o mesmo dado que o servidor compara.
 */

/** `eu` é o chefe direto de alguma destas pessoas. */
export function ehChefeDe(eu: User, users: User[], ...pessoas: (string | undefined)[]): boolean {
  return pessoas.some((id) => !!id && users.find((u) => u.id === id)?.supervisorId === eu.id);
}

/** Título, descrição, pontos e "exigir comprovante" da tarefa — e excluí-la. */
export function podeMexerNoConteudo(
  t: Pick<Task, "createdBy" | "assigneeId">,
  eu: User,
  users: User[],
): boolean {
  return (
    eu.role === "gerente" ||
    t.createdBy === eu.id ||
    ehChefeDe(eu, users, t.createdBy, t.assigneeId)
  );
}

/** Nome, situação, dono e foto do projeto — e apagá-lo. */
export function podeEditarProjeto(p: Pick<Project, "ownerId">, eu: User, users: User[]): boolean {
  return eu.role === "gerente" || p.ownerId === eu.id || ehChefeDe(eu, users, p.ownerId);
}

/** O modelo de pack: quem criou, o chefe dessa pessoa ou a gerência. */
export function podeEditarModeloDePack(
  m: Pick<PackTemplate, "createdBy">,
  eu: User,
  users: User[],
): boolean {
  return eu.role === "gerente" || m.createdBy === eu.id || ehChefeDe(eu, users, m.createdBy);
}
