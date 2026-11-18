import assert from "node:assert/strict";
import test from "node:test";
import {
  barraDaTarefa,
  montarGanttDoProjeto,
  situacaoNoGantt,
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
