import { createFileRoute } from "@tanstack/react-router";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { useMemo, useRef, useState } from "react";
import {
  Check,
  Clock,
  Flame,
  Search,
  Send,
  Sparkles,
  Trash2,
  Users,
  Layers,
  ArrowLeftRight,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { motion } from "framer-motion";

import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { ehChefeDe, podeEditarModeloDePack } from "@/lib/permissoes";
import { concluidaHoje, noPackDeHoje } from "@/lib/pack";
import { TaskTimerControls } from "@/components/task-timer-controls";
import type { PackTemplateScope, Task, User } from "@/lib/fluxo-types";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
import { CriadorDePack, RascunhoDePack } from "@/components/criador-de-pack";
import {
  PRIORIDADES_DO_PACK,
  chaveDoTitulo,
  novoItemDePack,
  tarefaDoItemDePack,
  type ItemDePack,
} from "@/lib/item-de-pack";
import { semAcento } from "@/lib/texto-busca";

export const Route = createFileRoute("/pack")({
  head: () => ({
    meta: [
      { title: "Pack diário · SGL - CONECTA" },
      {
        name: "description",
        content:
          "Monte o pack diário do time: crie o seu ou envie um pack pronto para supervisores, PCP e liderados.",
      },
    ],
  }),
  component: PackPage,
});

type Tab = "meu" | "equipe" | "outro" | "modelos";
type FiltroEquipe = "todos" | "pendentes" | "sem" | "feitos";

const primeiroNome = (u: Pick<User, "name"> | undefined) => u?.name.split(" ")[0] ?? "a pessoa";

/** Horário e prioridade do item, ao lado do título. Média sem horário não mostra nada. */
function DetalhesDoItem({ t }: { t: Task }) {
  const prio = PRIORIDADES_DO_PACK.find((p) => p.id === t.priority);
  return (
    <>
      {t.dueTime && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-muted-foreground">
          <Clock className="h-3 w-3" />
          {t.dueTime}
        </span>
      )}
      {prio && t.priority !== "media" && (
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0 text-[10px] font-semibold ${prio.cor}`}
        >
          {prio.label}
        </span>
      )}
    </>
  );
}

function PackPage() {
  const {
    createTask,
    updateTask,
    deleteTask,
    tasks,
    users,
    currentUser,
    packTemplates,
    createPackTemplate,
    deletePackTemplate,
    applyPackTemplate,
    transferPack,
  } = useFluxo();
  const [tab, setTab] = useState<Tab>("meu");
  /* O que está sendo montado para os outros mora aqui, e não na aba: trocar
     de aba para conferir o pack da equipe não pode jogar fora o rascunho. */
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [rascunho, setRascunho] = useState<ItemDePack[]>([]);

  // O pack de hoje e o que falta nele — ver `noPackDeHoje` e `concluidaHoje`.
  const myPack = useMemo(
    () => tasks.filter((t) => noPackDeHoje(t, currentUser.id)),
    [tasks, currentUser.id],
  );
  const pending = myPack.filter((t) => !concluidaHoje(t));

  /* A minha equipe: quem está abaixo de mim no organograma, em qualquer nível
     — a mesma regra do Delegar e da Equipe. A gerência pode abrir a empresa
     toda pelo filtro. Pedido do usuário, 09/10/2026: ver o pack do time. */
  const isGerente = currentUser.role === "gerente";
  const [empresaToda, setEmpresaToda] = useState(false);
  const equipe = useMemo(
    () =>
      users
        .filter((u) => u.id !== currentUser.id)
        .filter((u) => (isGerente && empresaToda) || ehChefeDe(currentUser, users, u.id))
        .sort((x, y) => x.name.localeCompare(y.name, "pt-BR")),
    [users, currentUser, isGerente, empresaToda],
  );
  const temEquipe = isGerente || users.some((u) => ehChefeDe(currentUser, users, u.id));

  /* Para quem dá para montar pack: a minha equipe (a gerência, todo mundo).
     Mandar trabalho para outra área continua possível pela própria tarefa. */
  const paraQuem = useMemo(
    () =>
      users
        .filter((u) => u.id !== currentUser.id)
        .filter((u) => isGerente || ehChefeDe(currentUser, users, u.id))
        .sort((x, y) => x.name.localeCompare(y.name, "pt-BR")),
    [users, currentUser, isGerente],
  );

  /** Itens da linha de criação entram direto no meu pack. */
  const adicionarAoMeuPack = (itens: ItemDePack[]) => {
    itens.forEach((i) => createTask(tarefaDoItemDePack(i, currentUser, currentUser)));
    toast.success(
      itens.length === 1
        ? `"${itens[0].titulo}" no seu pack`
        : `${itens.length} itens no seu pack de hoje`,
    );
  };

  /* Concluir no pack é concluir a tarefa. Desfazer é pelo aviso que a
     conclusão abre (o mesmo de qualquer outra tela), não por um segundo
     clique aqui: o item concluído hoje fica travado, riscado, até amanhã. */
  const concluir = (id: string) => updateTask(id, { status: "concluida" });

  /** Abre "Montar para alguém" já com a pessoa escolhida. */
  const montarPara = (id: string) => {
    setDestinatarios([id]);
    setTab("outro");
  };

  const abas = [
    {
      id: "meu" as const,
      label: `Meu pack (${myPack.length - pending.length}/${myPack.length})`,
      icon: Flame,
    },
    ...(temEquipe ? [{ id: "equipe" as const, label: "Pack da equipe", icon: Users }] : []),
    { id: "outro" as const, label: "Montar para alguém", icon: Send },
    { id: "modelos" as const, label: "Modelos & transferência", icon: Layers },
  ];

  return (
    <FluxoLayout title="Pack diário" breadcrumb="Rotinas">
      <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-6 py-2">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">Pack diário</h1>
              <p className="text-xs text-muted-foreground">
                Compromissos rápidos para o dia. Ideal para supervisores e PCP montarem a rotina do
                time em segundos.
              </p>
            </div>
          </div>

          <nav className="mt-2 flex gap-1 overflow-x-auto rounded-lg bg-secondary p-1 text-xs font-semibold">
            {abas.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`relative flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-2 transition ${
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {/* Pílula única que desliza entre as abas, em vez de piscar. */}
                  {active && (
                    <motion.span
                      layoutId="pack-aba-ativa"
                      className="absolute inset-0 rounded-md bg-card shadow-sm"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <t.icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </header>

        {tab === "meu" && (
          /* "Criar" e "Concluir" eram duas abas para a mesma lista: agora o dia
             fica à esquerda e a linha de criação, ao lado. */
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Meu pack de hoje</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Marque o que já foi feito. O que você concluir hoje fica riscado até amanhã.
                  </p>
                </div>
                {myPack.length > 0 && (
                  <Progresso feitos={myPack.length - pending.length} total={myPack.length} />
                )}
              </div>
              {myPack.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                  Nenhum item no seu pack de hoje. Escreva ao lado e aperte Enter.
                </div>
              ) : (
                <>
                  <ul className="mt-3 space-y-1">
                    {myPack.map((t) => {
                      const done = concluidaHoje(t);
                      return (
                        <li key={t.id}>
                          <div
                            className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                              done
                                ? "border-emerald-500/40 bg-emerald-500/10 text-muted-foreground"
                                : "border-border hover:bg-secondary"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => concluir(t.id)}
                              disabled={done}
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border disabled:cursor-default ${
                                done
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-border bg-background"
                              }`}
                              title={done ? "Concluída hoje" : "Concluir"}
                            >
                              {done && <Check className="h-3 w-3" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => concluir(t.id)}
                              disabled={done}
                              className={`min-w-0 flex-1 text-left disabled:cursor-default ${done ? "line-through" : ""}`}
                            >
                              {t.title}
                            </button>
                            {!done && <DetalhesDoItem t={t} />}
                            {done ? (
                              <span className="shrink-0 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                Concluída hoje
                              </span>
                            ) : (
                              <TaskTimerControls
                                taskId={t.id}
                                estimatedMinutes={t.estimatedMinutes}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {pending.length > 0 && (
                    <div className="mt-3 flex justify-end text-[11px]">
                      <button
                        onClick={() => {
                          pending.forEach((t) => concluir(t.id));
                          toast.success("Pack concluído — bom trabalho!");
                        }}
                        className="font-semibold text-primary hover:underline"
                      >
                        Marcar tudo como feito
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="h-fit rounded-xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-3.5 w-3.5" /> Acrescentar ao meu pack
              </h2>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                Como criar uma tarefa: escreva e aperte Enter. Vence hoje; com horário, nele.
              </p>
              <CriadorDePack
                autoFocus
                aoAdicionar={adicionarAoMeuPack}
                existentes={myPack.map((t) => t.title)}
              />
            </section>
          </div>
        )}

        {tab === "equipe" && (
          <PackDaEquipe
            equipe={equipe}
            tasks={tasks}
            isGerente={isGerente}
            empresaToda={empresaToda}
            setEmpresaToda={setEmpresaToda}
            montarPara={montarPara}
          />
        )}

        {tab === "outro" && (
          <MontarParaAlguem
            paraQuem={paraQuem}
            tasks={tasks}
            currentUser={currentUser}
            packTemplates={packTemplates}
            createTask={createTask}
            deleteTask={deleteTask}
            destinatarios={destinatarios}
            setDestinatarios={setDestinatarios}
            rascunho={rascunho}
            setRascunho={setRascunho}
          />
        )}

        {tab === "modelos" && (
          <ModelosSection
            users={users}
            currentUserId={currentUser.id}
            packTemplates={packTemplates}
            createPackTemplate={createPackTemplate}
            deletePackTemplate={deletePackTemplate}
            applyPackTemplate={applyPackTemplate}
            transferPack={transferPack}
            tasks={tasks}
          />
        )}
      </div>
    </FluxoLayout>
  );
}

type Fluxo = ReturnType<typeof useFluxo>;

/**
 * Montar o pack de outra pessoa — ou de várias de uma vez (pedido do usuário,
 * 13/10/2026: "o montar pack para alguém também tem que ser mais fácil").
 *
 * Três passos na mesma tela: quem recebe (busca com foto, mais de um), os
 * itens (a mesma linha de criação do meu pack, ou um modelo para começar) e
 * o envio. Ao lado, o que cada pessoa já tem hoje — o item repetido é
 * apontado no rascunho e não é enviado de novo.
 *
 * Cada item vira uma tarefa por pessoa, pelo `createTask` de sempre: nenhuma
 * consulta nova, tudo sai do que a store já tem.
 */
function MontarParaAlguem({
  paraQuem,
  tasks,
  currentUser,
  packTemplates,
  createTask,
  deleteTask,
  destinatarios,
  setDestinatarios,
  rascunho,
  setRascunho,
}: {
  paraQuem: User[];
  tasks: Task[];
  currentUser: User;
  packTemplates: Fluxo["packTemplates"];
  createTask: Fluxo["createTask"];
  deleteTask: Fluxo["deleteTask"];
  destinatarios: string[];
  setDestinatarios: (ids: string[]) => void;
  rascunho: ItemDePack[];
  setRascunho: (itens: ItemDePack[]) => void;
}) {
  const [busca, setBusca] = useState("");
  const [ultimoEnvio, setUltimoEnvio] = useState<{ para: string[]; titulos: Set<string> } | null>(
    null,
  );

  /* O desfazer roda segundos depois do envio: precisa da lista e do
     `deleteTask` de AGORA, não dos da renderização em que o envio saiu — as
     tarefas criadas ainda não estavam nela. */
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const deleteTaskRef = useRef(deleteTask);
  deleteTaskRef.current = deleteTask;

  /** O pack de hoje de cada pessoa, numa passada só pela lista. */
  const packPorPessoa = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.inPack || !noPackDeHoje(t, t.assigneeId)) continue;
      const l = m.get(t.assigneeId);
      if (l) l.push(t);
      else m.set(t.assigneeId, [t]);
    }
    return m;
  }, [tasks]);

  const porId = useMemo(() => new Map(paraQuem.map((u) => [u.id, u])), [paraQuem]);
  // Só quem ainda está na lista de quem eu posso montar — a regra de sempre.
  const selecionados = destinatarios.map((id) => porId.get(id)).filter((u): u is User => !!u);
  const selecionado = new Set(selecionados.map((u) => u.id));

  const termo = semAcento(busca);
  const visiveis = termo
    ? paraQuem.filter(
        (u) => semAcento(u.name).includes(termo) || semAcento(u.jobTitle ?? "").includes(termo),
      )
    : paraQuem;

  const alternar = (id: string) =>
    setDestinatarios(
      selecionado.has(id)
        ? selecionados.filter((u) => u.id !== id).map((u) => u.id)
        : [...selecionados.map((u) => u.id), id],
    );

  /** Quem já tem este título no pack de hoje. */
  const jaTem = (titulo: string) => {
    const chave = chaveDoTitulo(titulo);
    return selecionados.filter((u) =>
      (packPorPessoa.get(u.id) ?? []).some((t) => chaveDoTitulo(t.title) === chave),
    );
  };

  const titulosExistentes = selecionados.flatMap((u) =>
    (packPorPessoa.get(u.id) ?? []).map((t) => t.title),
  );

  const usarModelo = (templateId: string) => {
    const tpl = packTemplates.find((p) => p.id === templateId);
    if (!tpl) return;
    const noRascunho = new Set(rascunho.map((i) => chaveDoTitulo(i.titulo)));
    const novos = tpl.items
      .filter((it) => !noRascunho.has(chaveDoTitulo(it.title)))
      .map((it) =>
        novoItemDePack(it.title, {
          minutos: it.estimatedMinutes,
          etiquetasExtras: [`modelo:${tpl.name}`],
        }),
      );
    setRascunho([...rascunho, ...novos]);
    toast.success(
      novos.length
        ? `${novos.length} ${novos.length === 1 ? "item" : "itens"} do modelo "${tpl.name}"`
        : `Os itens de "${tpl.name}" já estão na lista`,
    );
  };

  // Quantas tarefas o envio cria: por pessoa, só o que ela ainda não tem.
  const envios = selecionados.map((u) => {
    const tem = new Set((packPorPessoa.get(u.id) ?? []).map((t) => chaveDoTitulo(t.title)));
    return {
      u,
      itens: rascunho.filter((i) => i.titulo.trim() && !tem.has(chaveDoTitulo(i.titulo))),
    };
  });
  const totalTarefas = envios.reduce((n, e) => n + e.itens.length, 0);
  const vazios = rascunho.some((i) => !i.titulo.trim());

  const rotuloEnviar =
    selecionados.length === 0
      ? "Escolha quem recebe"
      : selecionados.length === 1
        ? `Enviar pack para ${primeiroNome(selecionados[0])}`
        : `Enviar pack para ${selecionados.length} pessoas`;

  const enviar = async () => {
    if (selecionados.length === 0) {
      toast.error("Escolha pelo menos uma pessoa");
      return;
    }
    if (rascunho.length === 0) {
      toast.error("Acrescente pelo menos um item");
      return;
    }
    if (vazios) {
      toast.error("Há item sem título — escreva ou tire da lista");
      return;
    }
    if (totalTarefas === 0) {
      toast.error("Todos esses itens já estão no pack de hoje de quem vai receber");
      return;
    }
    // Para várias pessoas o envio se multiplica: vale uma confirmação.
    if (selecionados.length > 1) {
      const ok = await confirmar({
        titulo: `Enviar ${rascunho.length} ${rascunho.length === 1 ? "item" : "itens"} para ${selecionados.length} pessoas?`,
        descricao: `${selecionados.map((u) => u.name).join(", ")}. São ${totalTarefas} tarefas no total; o que alguém já tem hoje não é repetido.`,
        confirmar: "Enviar",
      });
      if (!ok) return;
    }

    const inicio = Date.now();
    const enviados = rascunho;
    const para = envios.filter((e) => e.itens.length > 0).map((e) => e.u.id);
    envios.forEach(({ u, itens }) =>
      itens.forEach((i) => createTask(tarefaDoItemDePack(i, u, currentUser))),
    );
    const titulos = new Set(enviados.map((i) => chaveDoTitulo(i.titulo)));
    setUltimoEnvio({ para, titulos });
    setRascunho([]);

    /* Desfazer: arquiva o que acabou de sair e devolve a lista ao rascunho.
       As tarefas são achadas pelo que as identifica — quem criou, para quem,
       o título e o instante —, porque o `createTask` não devolve o id. */
    const desfazer = () => {
      const alvos = tasksRef.current.filter(
        (t) =>
          t.inPack &&
          t.createdBy === currentUser.id &&
          para.includes(t.assigneeId) &&
          titulos.has(chaveDoTitulo(t.title)) &&
          t.status !== "concluida" &&
          Date.parse(t.createdAt) >= inicio - 2000,
      );
      alvos.forEach((t) => deleteTaskRef.current(t.id));
      // Um aviso de "excluída" por tarefa seria uma pilha: fica só o resumo.
      toast.dismiss();
      setRascunho(enviados);
      setUltimoEnvio(null);
      toast.success(
        `Envio desfeito — ${alvos.length} ${alvos.length === 1 ? "tarefa retirada" : "tarefas retiradas"}`,
      );
    };

    const quem = para.length === 1 ? primeiroNome(porId.get(para[0])) : `${para.length} pessoas`;
    const pulados = rascunho.length * selecionados.length - totalTarefas;
    toast.success(`Pack enviado para ${quem}`, {
      description: `${totalTarefas} ${totalTarefas === 1 ? "tarefa criada" : "tarefas criadas"}${
        pulados > 0 ? ` · ${pulados} já ${pulados === 1 ? "estava" : "estavam"} no pack` : ""
      }`,
      duration: 10000,
      action: { label: "Desfazer", onClick: desfazer },
    });
  };

  if (paraQuem.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card px-4 py-10 text-center text-xs text-muted-foreground">
        Ninguém responde a você no organograma — não há para quem montar pack.
      </section>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
      {/* 1. Quem recebe */}
      <section className="flex flex-col rounded-xl border border-border bg-card p-3 lg:max-h-[640px]">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Passo n={1} /> Quem recebe
          </h2>
          {selecionados.length > 0 && (
            <button
              onClick={() => setDestinatarios([])}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Limpar ({selecionados.length})
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 focus-within:border-primary">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pessoa ou cargo…"
            className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary"
              title="Limpar busca"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {termo && visiveis.length > 1 && (
          <button
            onClick={() =>
              setDestinatarios(
                Array.from(
                  new Set([...selecionados.map((u) => u.id), ...visiveis.map((u) => u.id)]),
                ),
              )
            }
            className="mt-1.5 self-start text-[11px] font-semibold text-primary hover:underline"
          >
            Marcar os {visiveis.length} encontrados
          </button>
        )}
        <ul className="mt-2 flex max-h-[360px] flex-col gap-0.5 overflow-y-auto lg:max-h-none lg:flex-1">
          {visiveis.length === 0 && (
            <li className="px-2 py-6 text-center text-[11px] text-muted-foreground">
              Ninguém com esse nome.
            </li>
          )}
          {visiveis.map((u) => {
            const ativo = selecionado.has(u.id);
            const pack = packPorPessoa.get(u.id) ?? [];
            return (
              <li key={u.id}>
                <button
                  onClick={() => alternar(u.id)}
                  aria-pressed={ativo}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                    ativo ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-secondary"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      ativo
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background"
                    }`}
                  >
                    {ativo && <Check className="h-3 w-3" />}
                  </span>
                  <UserAvatar
                    nome={u.name}
                    iniciais={u.avatar}
                    className="h-7 w-7 shrink-0 text-[10px]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{u.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {u.jobTitle}
                    </span>
                  </span>
                  {pack.length > 0 && (
                    <span
                      className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                      title={`${pack.length} no pack de hoje`}
                    >
                      {pack.length}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 2. Os itens e 3. o envio */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">
            <Passo n={2} /> O que vai no pack
          </h2>
          {selecionados.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {selecionados.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-1 pl-0.5 text-[11px]"
                >
                  <UserAvatar nome={u.name} iniciais={u.avatar} className="h-5 w-5 text-[8px]" />
                  {primeiroNome(u)}
                  <button
                    onClick={() => alternar(u.id)}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title={`Tirar ${u.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha ao lado uma ou mais pessoas. Dá para ir montando a lista antes.
            </p>
          )}
        </div>

        <CriadorDePack
          autoFocus
          aoAdicionar={(itens) => setRascunho([...rascunho, ...itens])}
          existentes={titulosExistentes}
          placeholder="Item do pack — Enter adiciona à lista"
        />

        {packTemplates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <select
              value=""
              onChange={(e) => e.target.value && usarModelo(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary"
              aria-label="Usar um modelo de pack"
            >
              <option value="">Usar modelo…</option>
              {packTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.items.length})
                </option>
              ))}
            </select>
            <span>acrescenta os itens do modelo à lista, para editar antes de enviar.</span>
          </div>
        )}

        {rascunho.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            A lista está vazia. Escreva um item acima e aperte Enter, cole uma lista ou use um
            modelo.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                {rascunho.length} {rascunho.length === 1 ? "item" : "itens"} na lista — clique para
                editar
              </span>
              <button
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: "Esvaziar a lista?",
                    descricao: "Os itens ainda não enviados saem da lista.",
                    confirmar: "Esvaziar",
                    perigo: true,
                  });
                  if (ok) setRascunho([]);
                }}
                className="font-medium hover:text-destructive"
              >
                Esvaziar
              </button>
            </div>
            <RascunhoDePack
              itens={rascunho}
              aoMudar={setRascunho}
              duplicados={(i) => jaTem(i.titulo).map(primeiroNome)}
            />
          </>
        )}

        <div className="sticky bottom-0 -mx-4 -mb-4 mt-auto flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <span className="text-[11px] text-muted-foreground">
            <Passo n={3} />{" "}
            {selecionados.length && rascunho.length
              ? `${totalTarefas} ${totalTarefas === 1 ? "tarefa" : "tarefas"} no pack de hoje, com aviso`
              : "Envie quando estiver pronto"}
          </span>
          <button
            onClick={() => void enviar()}
            disabled={selecionados.length === 0 || rascunho.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {rotuloEnviar}
          </button>
        </div>
      </section>

      {/* O que cada um já tem hoje, para não mandar repetido. */}
      <section className="h-fit rounded-xl border border-border bg-card p-3 lg:col-span-2 2xl:col-span-1">
        <h2 className="text-sm font-semibold">Já no pack de hoje</h2>
        {selecionados.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha alguém para ver o que essa pessoa já tem hoje.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
            {selecionados.map((u) => {
              const pack = packPorPessoa.get(u.id) ?? [];
              const feitos = pack.filter((t) => concluidaHoje(t)).length;
              return (
                <li key={u.id} className="rounded-lg border border-border bg-background p-2.5">
                  <div className="flex items-center gap-2">
                    <UserAvatar
                      nome={u.name}
                      iniciais={u.avatar}
                      className="h-7 w-7 shrink-0 text-[10px]"
                    />
                    <div className="min-w-0 flex-1 truncate text-xs font-semibold">{u.name}</div>
                    {pack.length > 0 ? (
                      <Progresso feitos={feitos} total={pack.length} />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Sem pack</span>
                    )}
                  </div>
                  {pack.length > 0 && (
                    <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                      {pack.map((t) => {
                        const done = concluidaHoje(t);
                        const novo =
                          !done &&
                          ultimoEnvio?.para.includes(u.id) &&
                          ultimoEnvio.titulos.has(chaveDoTitulo(t.title)) &&
                          t.createdBy === currentUser.id;
                        return (
                          <li
                            key={t.id}
                            className={`flex items-center gap-1.5 text-[11px] ${
                              novo
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            <span className="shrink-0">{done || novo ? "✓" : "•"}</span>
                            <span
                              className={`min-w-0 flex-1 truncate ${done ? "line-through" : ""}`}
                            >
                              {t.title}
                            </span>
                            {t.dueTime && <span className="shrink-0 text-[10px]">{t.dueTime}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** O número do passo, num círculo. */
function Passo({ n }: { n: number }) {
  return (
    <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
      {n}
    </span>
  );
}

/** "3/5" com uma barrinha — verde quando completa. */
function Progresso({ feitos, total }: { feitos: number; total: number }) {
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  const completo = total > 0 && feitos === total;
  return (
    <div className="flex shrink-0 items-center gap-2" title={`${pct}% concluído`}>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${completo ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`text-[11px] font-semibold ${
          completo ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
        }`}
      >
        {feitos}/{total}
      </span>
    </div>
  );
}

/**
 * O pack de hoje de cada pessoa da equipe: quanto já foi feito, o que falta e
 * quem está sem pack. Só leitura — concluir é com a própria pessoa; para
 * acrescentar itens, o botão leva à aba de montar já com ela escolhida.
 */
function PackDaEquipe({
  equipe,
  tasks,
  isGerente,
  empresaToda,
  setEmpresaToda,
  montarPara,
}: {
  equipe: ReturnType<typeof useFluxo>["users"];
  tasks: ReturnType<typeof useFluxo>["tasks"];
  isGerente: boolean;
  empresaToda: boolean;
  setEmpresaToda: (v: boolean) => void;
  montarPara: (id: string) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroEquipe>("todos");
  const [busca, setBusca] = useState("");

  const linhas = useMemo(
    () =>
      equipe.map((u) => {
        const pack = tasks.filter((t) => noPackDeHoje(t, u.id));
        const feitos = pack.filter((t) => concluidaHoje(t)).length;
        return { u, pack, feitos };
      }),
    [equipe, tasks],
  );
  type Linha = (typeof linhas)[number];
  const situacao = (l: Linha): FiltroEquipe =>
    l.pack.length === 0 ? "sem" : l.feitos < l.pack.length ? "pendentes" : "feitos";

  const conta: Record<FiltroEquipe, number> = {
    todos: linhas.length,
    pendentes: linhas.filter((l) => situacao(l) === "pendentes").length,
    sem: linhas.filter((l) => situacao(l) === "sem").length,
    feitos: linhas.filter((l) => situacao(l) === "feitos").length,
  };
  const totalItens = linhas.reduce((n, l) => n + l.pack.length, 0);
  const totalFeitos = linhas.reduce((n, l) => n + l.feitos, 0);

  const termo = busca.trim().toLowerCase();
  // Quem tem pendência primeiro, depois quem está sem pack, por último quem terminou.
  const ORDEM: Record<FiltroEquipe, number> = { pendentes: 0, sem: 1, feitos: 2, todos: 3 };
  const visiveis = linhas
    .filter(
      (l) =>
        !termo ||
        l.u.name.toLowerCase().includes(termo) ||
        (l.u.jobTitle ?? "").toLowerCase().includes(termo),
    )
    .filter((l) => filtro === "todos" || situacao(l) === filtro)
    .sort(
      (a, b) =>
        ORDEM[situacao(a)] - ORDEM[situacao(b)] || a.u.name.localeCompare(b.u.name, "pt-BR"),
    );

  const FILTROS: { id: FiltroEquipe; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "pendentes", label: "Com pendência" },
    { id: "sem", label: "Sem pack hoje" },
    { id: "feitos", label: "Concluíram" },
  ];

  return (
    <section className="flex flex-col gap-4">
      {/* Resumo do time */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Itens do time hoje
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <span className="text-2xl font-bold">
              {totalFeitos}
              <span className="text-base font-semibold text-muted-foreground">/{totalItens}</span>
            </span>
            {totalItens > 0 && <Progresso feitos={totalFeitos} total={totalItens} />}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Com pendência
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-500">{conta.pendentes}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sem pack hoje
          </div>
          <div className="mt-1 text-2xl font-bold text-muted-foreground">{conta.sem}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filtro === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/50"
            }`}
          >
            {f.label} ({conta[f.id]})
          </button>
        ))}
        {isGerente && (
          <button
            onClick={() => setEmpresaToda(!empresaToda)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              empresaToda
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
            title="A gerência pode ver o pack de todo mundo"
          >
            {empresaToda ? "Empresa toda" : "Só minha equipe"}
          </button>
        )}
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar pessoa…"
          className="ml-auto w-48 rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
        />
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
          {equipe.length === 0
            ? "Ninguém responde a você no organograma."
            : "Ninguém neste filtro."}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visiveis.map(({ u, pack, feitos }) => (
            <li key={u.id} className="flex flex-col rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <UserAvatar nome={u.name} iniciais={u.avatar} className="h-9 w-9 text-[11px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{u.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{u.jobTitle}</div>
                </div>
                {pack.length > 0 ? (
                  <Progresso feitos={feitos} total={pack.length} />
                ) : (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Sem pack
                  </span>
                )}
              </div>
              {pack.length > 0 && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {pack.map((t) => {
                    const done = concluidaHoje(t);
                    return (
                      <li key={t.id} className="flex items-center gap-2 text-[12px]">
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border"
                          }`}
                        >
                          {done && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span
                          className={`truncate ${done ? "text-muted-foreground line-through" : ""}`}
                        >
                          {t.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                onClick={() => montarPara(u.id)}
                className="mt-3 inline-flex items-center justify-center gap-1 self-start rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> {pack.length ? "Acrescentar itens" : "Montar pack"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// keep Trash2 tree-shaken from warning
void Trash2;

type ModelosProps = {
  users: ReturnType<typeof useFluxo>["users"];
  currentUserId: string;
  packTemplates: ReturnType<typeof useFluxo>["packTemplates"];
  createPackTemplate: ReturnType<typeof useFluxo>["createPackTemplate"];
  deletePackTemplate: ReturnType<typeof useFluxo>["deletePackTemplate"];
  applyPackTemplate: ReturnType<typeof useFluxo>["applyPackTemplate"];
  transferPack: ReturnType<typeof useFluxo>["transferPack"];
  tasks: ReturnType<typeof useFluxo>["tasks"];
};

function ModelosSection({
  users,
  currentUserId,
  packTemplates,
  createPackTemplate,
  deletePackTemplate,
  applyPackTemplate,
  transferPack,
  tasks,
}: ModelosProps) {
  const { currentUser } = useFluxo();
  const jobTitles = useMemo(
    () => Array.from(new Set(users.map((u) => u.jobTitle).filter(Boolean))),
    [users],
  );
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    scope: "cargo" as PackTemplateScope,
    targetJobTitle: jobTitles[0] ?? "",
    targetUserId: users[0]?.id ?? "",
    itemsText: "",
  });
  const [applyOpen, setApplyOpen] = useState<{ templateId: string } | null>(null);
  useEscFecha(!!applyOpen, () => setApplyOpen(null));
  const [applyTargetId, setApplyTargetId] = useState(currentUserId);
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");

  const submitDraft = () => {
    if (!draft.name.trim()) {
      toast.error("Dê um nome ao modelo (ex.: Supervisor de Operações)");
      return;
    }
    const items = draft.itemsText
      .split("\n")
      .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
      .filter(Boolean)
      .map((title, i) => ({ id: `it-${Date.now()}-${i}`, title }));
    if (items.length === 0) {
      toast.error("Coloque pelo menos uma tarefa no modelo (uma por linha)");
      return;
    }
    createPackTemplate({
      name: draft.name.trim(),
      scope: draft.scope,
      targetJobTitle: draft.scope === "cargo" ? draft.targetJobTitle : undefined,
      targetUserId: draft.scope === "pessoa" ? draft.targetUserId : undefined,
      items,
    });
    setDraft({
      name: "",
      scope: "cargo",
      targetJobTitle: jobTitles[0] ?? "",
      targetUserId: users[0]?.id ?? "",
      itemsText: "",
    });
    setCreating(false);
    toast.success(`Modelo "${draft.name.trim()}" criado`);
  };

  const doApply = () => {
    if (!applyOpen) return;
    const n = applyPackTemplate(applyOpen.templateId, applyTargetId);
    if (n > 0) {
      const target = users.find((u) => u.id === applyTargetId);
      toast.success(`Pack aplicado a ${target?.name.split(" ")[0] ?? "usuário"} — ${n} tarefas`);
    } else {
      toast.error("Modelo vazio ou usuário inválido");
    }
    setApplyOpen(null);
  };

  const doTransfer = () => {
    if (!transferFrom || !transferTo || transferFrom === transferTo) {
      toast.error("Escolha usuários diferentes");
      return;
    }
    const n = transferPack(transferFrom, transferTo);
    if (n > 0) {
      const from = users.find((u) => u.id === transferFrom);
      const to = users.find((u) => u.id === transferTo);
      toast.success(
        `${n} ${n === 1 ? "tarefa" : "tarefas"} do pack de ${from?.name.split(" ")[0]} → ${to?.name.split(" ")[0]}`,
      );
      setTransferFrom("");
      setTransferTo("");
    } else {
      toast.error("Sem itens de pack em aberto para transferir");
    }
  };

  const usersWithPack = users.filter((u) =>
    tasks.some((t) => t.assigneeId === u.id && t.inPack && t.status !== "concluida"),
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Layers className="h-3.5 w-3.5" /> Modelos de pack
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Salve rotinas de <b>cargo</b> (ex.: Supervisor, Analista) ou de <b>pessoa</b>. Ao
              contratar alguém novo, aplique o modelo — sem redigitar tudo.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Novo modelo
          </button>
        </div>

        {creating && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-background p-3">
            <div className="grid gap-2 md:grid-cols-2">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder='Nome (ex.: "Supervisor de Operações")'
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              <div className="flex gap-1 rounded-md bg-secondary p-1 text-[11px] font-semibold">
                {(["cargo", "pessoa"] as PackTemplateScope[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setDraft((d) => ({ ...d, scope: s }))}
                    className={`flex-1 rounded-md px-2 py-1 transition ${
                      draft.scope === s
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground"
                    }`}
                  >
                    {s === "cargo" ? "Para um cargo" : "Para uma pessoa"}
                  </button>
                ))}
              </div>
              {draft.scope === "cargo" ? (
                <select
                  value={draft.targetJobTitle}
                  onChange={(e) => setDraft((d) => ({ ...d, targetJobTitle: e.target.value }))}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary md:col-span-2"
                >
                  {jobTitles.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={draft.targetUserId}
                  onChange={(e) => setDraft((d) => ({ ...d, targetUserId: e.target.value }))}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary md:col-span-2"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.jobTitle}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              value={draft.itemsText}
              onChange={(e) => setDraft((d) => ({ ...d, itemsText: e.target.value }))}
              rows={7}
              placeholder={
                "Uma tarefa por linha. Ex:\nRevisar KPIs da noite\nAlinhar plano com PCP\nAprovar folhas de ponto\nAtualizar quadro de operações"
              }
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={submitDraft}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Salvar modelo
              </button>
            </div>
          </div>
        )}

        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {packTemplates.length === 0 && (
            <li className="col-span-full rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhum modelo ainda. Crie um para reaproveitar rotinas.
            </li>
          )}
          {packTemplates.map((tpl) => (
            <li key={tpl.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{tpl.name}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {tpl.scope === "cargo"
                      ? `Cargo: ${tpl.targetJobTitle}`
                      : `Pessoa: ${users.find((u) => u.id === tpl.targetUserId)?.name ?? "—"}`}
                    {" · "}
                    {tpl.items.length} {tpl.items.length === 1 ? "item" : "itens"}
                  </div>
                </div>
                {/* Quem criou, o supervisor dessa pessoa ou a gerência — a
                    regra do servidor (ver `permissoes.ts`). */}
                {podeEditarModeloDePack(tpl, currentUser, users) && (
                  <button
                    onClick={async () => {
                      const ok = await confirmar({
                        titulo: "Excluir este modelo?",
                        descricao: `"${tpl.name}" deixa de aparecer ao montar o pack. Os packs já criados a partir dele continuam intactos.`,
                        confirmar: "Excluir",
                        perigo: true,
                      });
                      if (!ok) return;
                      deletePackTemplate(tpl.id);
                      toast.success("Modelo excluído");
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Excluir modelo"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-0.5">
                {tpl.items.slice(0, 4).map((it) => (
                  <li key={it.id} className="truncate text-[11px] text-muted-foreground">
                    • {it.title}
                  </li>
                ))}
                {tpl.items.length > 4 && (
                  <li className="text-[10px] text-muted-foreground">
                    +{tpl.items.length - 4} outros
                  </li>
                )}
              </ul>
              <button
                onClick={() => {
                  setApplyOpen({ templateId: tpl.id });
                  setApplyTargetId(
                    tpl.scope === "pessoa" && tpl.targetUserId ? tpl.targetUserId : currentUserId,
                  );
                }}
                className="mt-2 w-full rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
              >
                Aplicar a alguém
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeftRight className="h-3.5 w-3.5" /> Transferir pack (férias, cobertura)
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Move todas as tarefas em aberto do pack de uma pessoa para outra. Ideal quando alguém
          entra de férias ou fica ausente.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr_auto]">
          <select
            value={transferFrom}
            onChange={(e) => setTransferFrom(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="">De: quem sai / cobre</option>
            {usersWithPack.map((u) => {
              const count = tasks.filter(
                (t) => t.assigneeId === u.id && t.inPack && t.status !== "concluida",
              ).length;
              return (
                <option key={u.id} value={u.id}>
                  {u.name} ({count})
                </option>
              );
            })}
          </select>
          <span className="grid place-items-center text-muted-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </span>
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            <option value="">Para: quem assume</option>
            {users
              .filter((u) => u.id !== transferFrom)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <button
            onClick={doTransfer}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110"
          >
            Transferir
          </button>
        </div>
      </section>

      {applyOpen && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setApplyOpen(null)}
        >
          <TravaScroll />
          <div
            className="w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Aplicar modelo</h3>
              <button
                onClick={() => setApplyOpen(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha para qual pessoa aplicar. Todos os itens entram no pack de hoje.
            </p>
            <select
              value={applyTargetId}
              onChange={(e) => setApplyTargetId(e.target.value)}
              className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.jobTitle}
                </option>
              ))}
            </select>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setApplyOpen(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={doApply}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
