import assert from "node:assert/strict";
import test from "node:test";
import {
  barraDaTarefa,
  entraNaVisaoGeral,
  idDaLinhaDoProjeto,
  montarGanttDoProjeto,
  montarGanttGeral,
  projetoDaLinha,
  replanejamento,
  situacaoNoGantt,
  type ProjetoParaGantt,
  type TarefaParaGantt,
} from "../src/components/gantt/montar-gantt.ts";

/* Datas em hora local, como o Gantt faz: o teste vale em qualquer fuso. */
const dia = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m);
const AGORA = dia(17, 12).getTime();
const nunca = () => false;

function tarefa(p: Partial<TarefaParaGantt> & { id: string }): TarefaParaGantt {
  return {
    title: p.id,
    status: "pendente",
    dueDate: dia(20, 23, 59).toISOString(),
    createdAt: dia(10, 9).toISOString(),
    assigneeId: "1",
    ...p,
  };
}

test("barra vai do dia em que foi criada até o fim do dia do prazo", () => {
  const b = barraDaTarefa(tarefa({ id: "a" }), AGORA);
  assert.deepEqual(b, { start: dia(10), end: dia(21) });
});

test("o início, quando existe, manda no começo da barra", () => {
  const b = barraDaTarefa(tarefa({ id: "a", startDate: dia(15, 8).toISOString() }), AGORA);
  assert.deepEqual(b, { start: dia(15), end: dia(21) });
});

test("início depois do prazo: a barra ocupa só o dia do prazo", () => {
  const b = barraDaTarefa(tarefa({ id: "a", startDate: dia(25).toISOString() }), AGORA);
  assert.deepEqual(b, { start: dia(20), end: dia(21) });
});

test("criada depois do prazo (prazo no passado): só o dia do prazo", () => {
  const b = barraDaTarefa(
    tarefa({
      id: "a",
      createdAt: dia(22, 10).toISOString(),
      dueDate: dia(20, 23, 59).toISOString(),
    }),
    AGORA,
  );
  assert.deepEqual(b, { start: dia(20), end: dia(21) });
});

test("início no mesmo dia do prazo: barra de um dia", () => {
  const b = barraDaTarefa(
    tarefa({ id: "a", startDate: dia(20, 7).toISOString(), dueDate: dia(20, 9).toISOString() }),
    AGORA,
  );
  assert.deepEqual(b, { start: dia(20), end: dia(21) });
});

test("sem prazo: barra escondida em hoje", () => {
  const t = tarefa({ id: "a", dueDate: null });
  assert.deepEqual(barraDaTarefa(t, AGORA), { start: dia(17), end: dia(18) });
  assert.equal(situacaoNoGantt(t, AGORA, nunca), "semprazo");
});

test("situação: atrasada ganha de pendente e andamento, mas não de concluída", () => {
  const sempre = () => true;
  assert.equal(situacaoNoGantt(tarefa({ id: "a" }), AGORA, nunca), "pendente");
  assert.equal(
    situacaoNoGantt(tarefa({ id: "a", status: "andamento" }), AGORA, nunca),
    "andamento",
  );
  assert.equal(situacaoNoGantt(tarefa({ id: "a" }), AGORA, sempre), "atrasada");
  assert.equal(
    situacaoNoGantt(tarefa({ id: "a", status: "andamento" }), AGORA, sempre),
    "atrasada",
  );
  assert.equal(
    situacaoNoGantt(tarefa({ id: "a", status: "concluida" }), AGORA, sempre),
    "concluida",
  );
});

test("a regra de atraso recebe a tarefa e o agora", () => {
  const vistos: [string, number][] = [];
  situacaoNoGantt(tarefa({ id: "x" }), AGORA, (t, agora) => {
    vistos.push([t.id, agora]);
    return false;
  });
  assert.deepEqual(vistos, [["x", AGORA]]);
});

test("montagem: ordem pela barra, sem prazo no fim, eixo com hoje e folga", () => {
  const m = montarGanttDoProjeto(
    [
      tarefa({ id: "sem", dueDate: null }),
      tarefa({
        id: "tarde",
        startDate: dia(18).toISOString(),
        dueDate: dia(30, 23, 59).toISOString(),
      }),
      tarefa({
        id: "cedo",
        startDate: dia(5).toISOString(),
        dueDate: dia(8, 23, 59).toISOString(),
      }),
    ],
    AGORA,
    nunca,
  );
  assert.deepEqual(
    m.tasks.map((t) => t.id),
    ["cedo", "tarde", "sem"],
  );
  assert.equal(m.semPrazo, 1);
  assert.deepEqual(m.inicio, dia(2)); // 05/11 menos 3 dias
  assert.deepEqual(m.fim, new Date(2026, 11, 8)); // fim exclusivo 01/12 mais 7 dias
  const sem = m.tasks.find((t) => t.id === "sem")!;
  assert.equal(sem.prazo, null);
  assert.equal(sem.type, "semprazo");
});

test("montagem: projeto todo no passado ainda inclui hoje no eixo", () => {
  const m = montarGanttDoProjeto(
    [
      tarefa({
        id: "velha",
        startDate: dia(1).toISOString(),
        dueDate: dia(3, 23, 59).toISOString(),
      }),
    ],
    AGORA,
    nunca,
  );
  assert.deepEqual(m.inicio, new Date(2026, 9, 29)); // 01/11 menos 3 dias
  assert.deepEqual(m.fim, dia(25)); // hoje (17) + 1 dia, mais 7
});

test("montagem vazia: eixo em volta de hoje", () => {
  const m = montarGanttDoProjeto([], AGORA, nunca);
  assert.deepEqual(m.tasks, []);
  assert.deepEqual(m.inicio, dia(14));
  assert.deepEqual(m.fim, dia(25));
});

/* ------------------------------ Visão geral ------------------------------ */

const projeto = (id: string, p: Partial<ProjetoParaGantt> = {}): ProjetoParaGantt => ({
  id,
  name: id,
  ownerId: "9",
  ...p,
});

test("visão geral: concluídas só dos últimos 30 dias; abertas sempre", () => {
  const ha = (n: number) => new Date(AGORA - n * 86_400_000).toISOString();
  assert.equal(entraNaVisaoGeral(tarefa({ id: "a", dueDate: ha(400) }), AGORA), true);
  assert.equal(
    entraNaVisaoGeral(tarefa({ id: "b", status: "concluida", completedAt: ha(10) }), AGORA),
    true,
  );
  assert.equal(
    entraNaVisaoGeral(tarefa({ id: "c", status: "concluida", completedAt: ha(31) }), AGORA),
    false,
  );
  // sem data de conclusão, vale o prazo
  assert.equal(
    entraNaVisaoGeral(tarefa({ id: "d", status: "concluida", dueDate: ha(5) }), AGORA),
    true,
  );
  assert.equal(
    entraNaVisaoGeral(tarefa({ id: "e", status: "concluida", dueDate: ha(60) }), AGORA),
    false,
  );
  assert.equal(
    entraNaVisaoGeral(tarefa({ id: "f", status: "concluida", dueDate: null }), AGORA),
    false,
  );
});

test("visão geral: cada projeto com as suas tarefas embaixo; barra do projeto cobre as delas", () => {
  const m = montarGanttGeral(
    [projeto("P1", { color: "red" }), projeto("p2")],
    [
      tarefa({
        id: "a",
        projectId: "P1",
        startDate: dia(12).toISOString(),
        dueDate: dia(15, 23, 59).toISOString(),
      }),
      tarefa({
        id: "b",
        projectId: "p1",
        startDate: dia(14).toISOString(),
        dueDate: dia(25, 23, 59).toISOString(),
      }),
      tarefa({
        id: "c",
        projectId: "P2",
        startDate: dia(5).toISOString(),
        dueDate: dia(6, 23, 59).toISOString(),
      }),
      tarefa({ id: "solta", startDate: dia(1).toISOString() }), // sem projeto: fica fora
      tarefa({ id: "outro", projectId: "P3" }), // projeto que a pessoa não vê: fica fora
    ],
    AGORA,
    nunca,
    new Set(["P1"]),
  );
  assert.deepEqual(
    m.tasks.map((t) => t.id),
    ["projeto:p2", "c", "projeto:P1", "a", "b"],
  );
  const p1 = m.tasks.find((t) => t.id === "projeto:P1")!;
  assert.deepEqual([p1.start, p1.end], [dia(12), dia(26)]);
  assert.equal(p1.type, "projeto");
  assert.equal(p1.open, true);
  assert.equal(p1.cor, "red");
  assert.equal(p1.ehProjeto, true);
  assert.equal(p1.responsavelId, "9");
  assert.equal(m.tasks.find((t) => t.id === "projeto:p2")!.open, false);
  assert.equal(m.tasks.find((t) => t.id === "a")!.parent, "projeto:P1");
});

test("visão geral: projeto sem tarefa com prazo fica no fim, com a barra escondida", () => {
  const m = montarGanttGeral(
    [projeto("Zeta"), projeto("Alfa"), projeto("Com barra")],
    [
      tarefa({ id: "s", projectId: "Zeta", dueDate: null }),
      tarefa({ id: "x", projectId: "Com barra" }),
    ],
    AGORA,
    nunca,
    new Set(),
  );
  assert.deepEqual(
    m.tasks.filter((t) => t.ehProjeto).map((t) => [t.text, t.type]),
    [
      ["Com barra", "projeto"],
      ["Alfa", "projetovazio"],
      ["Zeta", "projetovazio"],
    ],
  );
  const zeta = m.tasks.find((t) => t.id === "projeto:Zeta")!;
  assert.deepEqual([zeta.start, zeta.end], [dia(17), dia(18)]);
  assert.equal(m.semPrazo, 1);
});

test("visão geral: concluída antiga não entra nem estica a barra do projeto", () => {
  const m = montarGanttGeral(
    [projeto("P")],
    [
      tarefa({
        id: "nova",
        projectId: "P",
        startDate: dia(15).toISOString(),
        dueDate: dia(19, 23, 59).toISOString(),
      }),
      tarefa({
        id: "velha",
        projectId: "P",
        status: "concluida",
        startDate: new Date(2026, 5, 1).toISOString(),
        dueDate: new Date(2026, 5, 5, 23, 59).toISOString(),
        completedAt: new Date(2026, 5, 5, 10).toISOString(),
      }),
    ],
    AGORA,
    nunca,
    new Set(),
  );
  assert.deepEqual(
    m.tasks.map((t) => t.id),
    ["projeto:P", "nova"],
  );
  assert.deepEqual(m.tasks[0]!.start, dia(15));
  assert.deepEqual(m.inicio, dia(12)); // 15/11 menos 3 dias
});

test("id da linha do projeto vai e volta; tarefa não é projeto", () => {
  assert.equal(projetoDaLinha(idDaLinhaDoProjeto("abc-123")), "abc-123");
  assert.equal(projetoDaLinha("abc-123"), null);
  assert.equal(projetoDaLinha(42), null);
});

/* ---------------------------- Arrastar a barra ---------------------------- */

const barra = (ini: number, fimExclusivo: number) => ({ start: dia(ini), end: dia(fimExclusivo) });

test("arrastar a barra inteira muda início e prazo juntos", () => {
  // barra 10–20 (fim exclusivo 21) movida 3 dias para a frente
  assert.deepEqual(replanejamento(barra(10, 21), barra(13, 24), {}), {
    startDate: dia(13).toISOString(),
    dueDate: dia(23, 23, 59).toISOString(),
  });
});

test("puxar a ponta da direita muda só o prazo", () => {
  assert.deepEqual(replanejamento(barra(10, 21), barra(10, 26), {}), {
    dueDate: dia(25, 23, 59).toISOString(),
  });
});

test("puxar a ponta da esquerda muda só o início", () => {
  assert.deepEqual(replanejamento(barra(10, 21), barra(7, 21), {}), {
    startDate: dia(7).toISOString(),
  });
});

test("o prazo guarda o horário escolhido; sem horário, 23:59", () => {
  assert.deepEqual(replanejamento(barra(10, 21), barra(10, 22), { dueTime: "08:40" }), {
    dueDate: dia(21, 8, 40).toISOString(),
  });
  assert.deepEqual(replanejamento(barra(10, 21), barra(10, 22), { dueTime: "lixo" }), {
    dueDate: dia(21, 23, 59).toISOString(),
  });
});

test("arraste no meio do dia (escala semana/mês) encaixa no dia mais próximo", () => {
  const depois = { start: dia(13, 14), end: dia(24, 14) }; // 14h: arredonda para o dia seguinte
  assert.deepEqual(replanejamento(barra(10, 21), depois, {}), {
    startDate: dia(14).toISOString(),
    dueDate: dia(24, 23, 59).toISOString(),
  });
  const quase = { start: dia(10, 9), end: dia(21, 9) }; // 9h: fica no mesmo dia, nada muda
  assert.equal(replanejamento(barra(10, 21), quase, {}), null);
});

test("soltar no mesmo lugar não muda nada", () => {
  assert.equal(replanejamento(barra(10, 21), barra(10, 21), {}), null);
});

test("início puxado para depois do prazo fica no dia do prazo", () => {
  assert.deepEqual(replanejamento(barra(10, 21), barra(25, 21), {}), {
    startDate: dia(20).toISOString(),
  });
});
