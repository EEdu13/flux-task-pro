import assert from "node:assert/strict";
import test from "node:test";
import {
  FILTROS_VAZIOS,
  barraDaTarefa,
  conflitosDeDependencia,
  criariaCiclo,
  entraNaVisaoGeral,
  filtrarGantt,
  filtraTarefas,
  situacaoDoFiltro,
  idDaLinhaDoProjeto,
  ligacoesDoGantt,
  montarGanttDoProjeto,
  montarGanttGeral,
  pontasDaLigacao,
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

test("visão geral: concluída antiga não entra (período padrão) nem estica a barra do projeto", () => {
  const filtradas = filtrarGantt(
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
    [projeto("P")],
    FILTROS_VAZIOS,
    { agora: AGORA, atrasada: nunca, setorDe: () => undefined, regraDosTrintaDias: true },
  );
  const m = montarGanttGeral(filtradas.projetos, filtradas.tarefas, AGORA, nunca, new Set());
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

/* ------------------------------ Dependências ------------------------------ */

const item = (id: string, ini: number, fimExclusivo: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    text: id,
    type: "pendente",
    start: dia(ini),
    end: dia(fimExclusivo),
    responsavelId: "1",
    prazo: dia(fimExclusivo - 1, 23, 59).toISOString(),
    ...extra,
  }) as Parameters<typeof ligacoesDoGantt>[0][number];

test("setas: só entre tarefas do Gantt, com os ids das linhas, sem repetir", () => {
  const itens = [
    item("AAA", 1, 5),
    item("BBB", 5, 9),
    item("projeto:P", 1, 9, { ehProjeto: true }),
  ];
  const l = ligacoesDoGantt(itens, [
    { tarefaId: "bbb", dependeDeId: "aaa" }, // caixa diferente: casa
    { tarefaId: "BBB", dependeDeId: "AAA" }, // repetida
    { tarefaId: "ccc", dependeDeId: "aaa" }, // tarefa fora do Gantt
    { tarefaId: "bbb", dependeDeId: "projeto:P" }, // projeto não tem seta
  ]);
  assert.deepEqual(l, [{ id: "AAA>BBB", source: "AAA", target: "BBB", type: "e2s" }]);
  assert.deepEqual(pontasDaLigacao("AAA>BBB"), { tarefaId: "BBB", dependeDeId: "AAA" });
  assert.equal(pontasDaLigacao("lixo"), null);
});

test("conflito: começa antes de a outra terminar", () => {
  const itens = [
    item("A", 1, 6),
    item("B", 4, 9),
    item("C", 6, 9),
    item("S", 2, 3, { prazo: null }),
  ];
  const c = conflitosDeDependencia(itens, [
    { tarefaId: "B", dependeDeId: "A" }, // B começa dia 4, A termina no fim do dia 5: conflito
    { tarefaId: "C", dependeDeId: "A" }, // C começa dia 6, logo depois de A: certo
    { tarefaId: "S", dependeDeId: "A" }, // S sem prazo: sem barra, sem aviso
  ]);
  assert.deepEqual([...c], [["B", 'Começa antes de "A" terminar']]);
});

test("conflito com duas dependências junta os nomes", () => {
  const itens = [item("A", 1, 6), item("Z", 1, 7), item("B", 4, 9)];
  const c = conflitosDeDependencia(itens, [
    { tarefaId: "B", dependeDeId: "A" },
    { tarefaId: "B", dependeDeId: "Z" },
  ]);
  assert.equal(c.get("B"), 'Começa antes de "A" e "Z" terminar');
});

test("ciclo: ela mesma, direto e por outras; sem ciclo quando não fecha", () => {
  const deps = [
    { tarefaId: "B", dependeDeId: "A" }, // B espera A
    { tarefaId: "C", dependeDeId: "B" }, // C espera B
  ];
  assert.equal(criariaCiclo(deps, "A", "A"), true);
  assert.equal(criariaCiclo(deps, "A", "B"), true); // A esperar B, que já espera A
  assert.equal(criariaCiclo(deps, "a", "c"), true); // por outras, sem caixa
  assert.equal(criariaCiclo(deps, "D", "C"), false);
  assert.equal(criariaCiclo(deps, "C", "A"), false); // C esperar A também: não fecha nada
});

/* -------------------------------- Filtros -------------------------------- */

const SETORES: Record<string, string> = { "1": "ti", "2": "rh", "3": "ti" };
const ctx = (
  regraDosTrintaDias = true,
  atrasada: (t: TarefaParaGantt) => boolean = () => false,
) => ({
  agora: AGORA,
  atrasada,
  setorDe: (id: string) => SETORES[id],
  regraDosTrintaDias,
});
const BASE = [
  tarefa({
    id: "a",
    projectId: "P1",
    assigneeId: "1",
    startDate: dia(10).toISOString(),
    dueDate: dia(12, 23, 59).toISOString(),
  }),
  tarefa({
    id: "b",
    projectId: "P1",
    assigneeId: "2",
    status: "andamento",
    startDate: dia(14).toISOString(),
    dueDate: dia(20, 23, 59).toISOString(),
  }),
  tarefa({
    id: "c",
    projectId: "P2",
    assigneeId: "3",
    status: "concluida",
    dueDate: dia(15, 23, 59).toISOString(),
    completedAt: dia(15, 10).toISOString(),
  }),
  tarefa({ id: "s", projectId: "P2", assigneeId: "1", dueDate: null }),
  tarefa({
    id: "velha",
    projectId: "P2",
    assigneeId: "1",
    status: "concluida",
    startDate: new Date(2026, 5, 1).toISOString(),
    dueDate: new Date(2026, 5, 5, 23, 59).toISOString(),
    completedAt: new Date(2026, 5, 5, 10).toISOString(),
  }),
];
const PROJS = [projeto("P1"), projeto("P2"), projeto("Vazio")];
const ids = (r: { tarefas: TarefaParaGantt[] }) => r.tarefas.map((t) => t.id);
const com = (f: Partial<typeof FILTROS_VAZIOS>) => ({ ...FILTROS_VAZIOS, ...f });

test("filtro vazio: período padrão tira só a concluída antiga; todos os projetos ficam", () => {
  const r = filtrarGantt(BASE, PROJS, FILTROS_VAZIOS, ctx());
  assert.deepEqual(ids(r), ["a", "b", "c", "s"]);
  assert.deepEqual(
    r.projetos.map((p) => p.id),
    ["P1", "P2", "Vazio"],
  );
  assert.equal(filtraTarefas(FILTROS_VAZIOS), false);
});

test("num projeto, o padrão mostra tudo; e 'tudo' mostra a antiga na visão geral", () => {
  assert.deepEqual(ids(filtrarGantt(BASE, [], FILTROS_VAZIOS, ctx(false))), [
    "a",
    "b",
    "c",
    "s",
    "velha",
  ]);
  assert.deepEqual(ids(filtrarGantt(BASE, PROJS, com({ periodo: { tipo: "tudo" } }), ctx())), [
    "a",
    "b",
    "c",
    "s",
    "velha",
  ]);
});

test("setor é o do responsável; pessoa marcada vale mais que o setor", () => {
  assert.deepEqual(ids(filtrarGantt(BASE, PROJS, com({ setor: "ti" }), ctx())), ["a", "c", "s"]);
  assert.deepEqual(ids(filtrarGantt(BASE, PROJS, com({ setor: "ti", pessoas: ["2"] }), ctx())), [
    "b",
  ]);
});

test("situação: várias juntas, com 'atrasada' à parte", () => {
  const atrasaA = (t: TarefaParaGantt) => t.id === "a";
  assert.equal(situacaoDoFiltro(BASE[0]!, AGORA, atrasaA), "atrasada");
  assert.deepEqual(
    ids(filtrarGantt(BASE, PROJS, com({ situacoes: ["atrasada"] }), ctx(true, atrasaA))),
    ["a"],
  );
  assert.deepEqual(
    ids(
      filtrarGantt(BASE, PROJS, com({ situacoes: ["andamento", "concluida"] }), ctx(true, atrasaA)),
    ),
    ["b", "c"],
  );
});

test("período: entra quem tem barra passando pelo intervalo; sem prazo fica fora", () => {
  // a: 10–12, b: 14–20, c: criada 10, prazo 15
  const r = filtrarGantt(
    BASE,
    PROJS,
    com({ periodo: { tipo: "intervalo", de: "2026-11-13", ate: "2026-11-14" } }),
    ctx(),
  );
  assert.deepEqual(ids(r), ["b", "c"]);
  const soAte = filtrarGantt(
    BASE,
    PROJS,
    com({ periodo: { tipo: "intervalo", de: "", ate: "2026-11-11" } }),
    ctx(),
  );
  assert.deepEqual(ids(soAte), ["a", "c", "velha"]);
});

test("filtro que tira tarefas some com projeto vazio; filtro de projeto escolhe os projetos", () => {
  const r = filtrarGantt(BASE, PROJS, com({ pessoas: ["2"] }), ctx());
  assert.deepEqual(
    r.projetos.map((p) => p.id),
    ["P1"],
  );
  const p = filtrarGantt(BASE, PROJS, com({ projetos: ["p2"] }), ctx());
  assert.deepEqual(ids(p), ["c", "s"]);
  assert.deepEqual(
    p.projetos.map((x) => x.id),
    ["P2"],
  );
});
