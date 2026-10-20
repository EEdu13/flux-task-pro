import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useMeuAvatar } from "@/lib/use-meu-avatar";
import { AVATAR_EM_BRANCO } from "@/lib/avatar-3d";
import {
  AtSign,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Flame,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { tituloDoAviso } from "@/lib/aviso";
import { formatDueBucket, formatRelative } from "@/lib/use-theme";
import { sectors, statusColor, statusLabels } from "@/lib/fluxo-types";
import { userScorePct, scoreTextClass, type PeriodoDoPlacar } from "@/lib/score";
import { ScoreBar } from "@/components/score-bar";
import { AneisDoPlacar, DiasDaSemana, MinhaCarga, Podio } from "@/components/painel-inicio";
import { RankingDeTempo, TempoTrabalhado } from "@/components/tempo-trabalhado";
import { SemanaDoTime } from "@/components/semana-do-time";
import { FaixaDoMuralNoInicio } from "@/components/mural/faixa-do-inicio";
import { UserAvatar } from "@/components/user-avatar";
import { BlocoEntrada } from "@/components/stagger";
import { concluidaHoje, noPackDeHoje } from "@/lib/pack";
import { openTaskContext } from "@/components/task-context-menu";
import { SeloDoProjeto } from "@/components/selo-do-projeto";
import { porPrazo } from "@/lib/prazo";
import { useOfensiva } from "@/lib/ofensiva";
import { comChapeuDeFesta, useAniversariosDeHoje } from "@/lib/festa-de-aniversario";
import { lerCompromissos } from "@/lib/compromissos-cliente";
import type { Compromisso } from "@/lib/compromisso";
import { BalaoDoBomDia, OfensivaSemanal, frasesDoBomDia } from "@/components/ofensiva-e-bom-dia";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SGL - CONECTA · Painel de desempenho" },
      {
        name: "description",
        content: "Visão executiva com foco de hoje, ranking e metas do time.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  const { currentUser, tasks, users, notifications, completions, openTask, updateTask } =
    useFluxo();
  const navigate = useNavigate();

  // ---- Meu pack (hoje) — ver `noPackDeHoje` -----------------------------
  const packTasks = useMemo(
    () => tasks.filter((t) => noPackDeHoje(t, currentUser.id)),
    [tasks, currentUser.id],
  );
  // Concluir aqui é concluir a tarefa, como no Pack diário.
  const concluirDoPack = (id: string) => updateTask(id, { status: "concluida" });
  const packTotal = packTasks.length;
  const packDoneCount = packTasks.filter((t) => concluidaHoje(t)).length;
  const packPct = packTotal === 0 ? 0 : Math.round((packDoneCount / packTotal) * 100);
  // A ofensiva do pack (19/10/2026): o passado vem do servidor 1x por dia, o hoje daqui.
  const ofensiva = useOfensiva(currentUser.id, { total: packTotal, feitas: packDoneCount });
  /* O humor do avatar, como a coruja do Duolingo: triste quando a ofensiva
     apagou, preocupado com o pack aberto a partir das 15h, feliz quando fechou. */
  const humor: "normal" | "feliz" | "preocupado" | "triste" = !ofensiva.carregado
    ? "normal"
    : ofensiva.estado === "perdida"
      ? "triste"
      : ofensiva.estado === "em-risco" && new Date().getHours() >= 15
        ? "preocupado"
        : ofensiva.estado === "acesa" && packTotal > 0
          ? "feliz"
          : "normal";

  /* O bom dia do avatar (19/10/2026): os compromissos de hoje vêm da mesma
     leitura com memória da agenda do dia (não é uma ida a mais ao banco), e os
     aniversariantes, do painel do mural (também com memória). */
  const hojeIso = new Date().toLocaleDateString("sv-SE");
  const [compromissosDeHoje, setCompromissosDeHoje] = useState<Compromisso[]>([]);
  const [aniversariantes, setAniversariantes] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    lerCompromissos(hojeIso, hojeIso, false)
      .then((r) => vivo && setCompromissosDeHoje(r.compromissos))
      .catch(() => {
        /* agenda fora do ar: o bom dia só não fala dela */
      });
    import("@/lib/mural-cliente")
      .then(({ carregarPainelDoMural }) => carregarPainelDoMural())
      .then(
        (p) =>
          vivo &&
          setAniversariantes(
            p.hoje
              .filter((a) => a.id !== currentUser.id)
              .map((a) => a.nome.split(" ")[0] ?? a.nome),
          ),
      )
      .catch(() => {
        /* mural inativo: sem aniversários no bom dia */
      });
    return () => {
      vivo = false;
    };
  }, [hojeIso, currentUser.id]);
  /* Quem conta como "time" nesta tela.
     O ranking e os packs listavam a empresa INTEIRA, então quem é da TI via
     gente do financeiro na disputa — e com traço no lugar do número, porque os
     dados dessas pessoas nem chegam ao navegador de quem não é gerente. Lista
     global com dados restritos é o pior dos dois: mostra quem você não deveria
     comparar e não mostra o número de ninguém.

     Para a gerência, time continua sendo todo mundo — é o mesmo alcance que ela
     já tem no servidor. Para o resto, time é o setor. */
  const pessoasDoTime = useMemo(
    () =>
      currentUser.role === "gerente" ? users : users.filter((u) => u.sector === currentUser.sector),
    [users, currentUser.role, currentUser.sector],
  );

  /* Packs do time. Sem corte, pelo mesmo motivo do ranking logo abaixo: numa
     equipe de seis, um "top 5" some com uma pessoa real e parece que ela não é
     do time. O `filter` continua — quem não montou pack não tem o que mostrar
     aqui, e isso é ausência de dado, não posição na lista. */
  const teamPack = useMemo(() => {
    return pessoasDoTime
      .map((u) => {
        const items = tasks.filter((t) => noPackDeHoje(t, u.id));
        return { user: u, total: items.length };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [pessoasDoTime, tasks]);

  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const openTasks = myTasks.filter((t) => t.status !== "concluida");
  // O foco é o que vence até o fim da semana; sem prazo não entra.
  const todayFocus = openTasks
    .filter((t) => {
      const b = formatDueBucket(t.dueDate);
      return b !== "depois" && b !== "sem_prazo";
    })
    .sort(porPrazo)
    .slice(0, 6);

  const doneToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return completions.filter(
      (c) => c.userId === currentUser.id && new Date(c.at).getTime() >= today.getTime(),
    );
  }, [completions, currentUser.id]);

  // Os três placares do topo: hoje, a semana e o mês.
  const meusPlacares = useMemo(
    () => ({
      dia: userScorePct(currentUser.id, tasks, completions, new Date(), "dia"),
      semana: userScorePct(currentUser.id, tasks, completions, new Date(), "semana"),
      mes: userScorePct(currentUser.id, tasks, completions, new Date(), "mes"),
    }),
    [currentUser.id, tasks, completions],
  );
  const atrasadas = openTasks.filter((t) => formatDueBucket(t.dueDate) === "atrasada").length;
  const vencemHoje = openTasks.filter((t) => formatDueBucket(t.dueDate) === "hoje").length;
  /* Uma frase que diz por onde começar — o que mais pesa primeiro. */
  const resumoDoDia =
    atrasadas > 0
      ? `${atrasadas} ${atrasadas === 1 ? "tarefa atrasada pede" : "tarefas atrasadas pedem"} atenção${vencemHoje > 0 ? ` e ${vencemHoje} ${vencemHoje === 1 ? "vence" : "vencem"} hoje` : ""}.`
      : vencemHoje > 0
        ? `Nada atrasado. ${vencemHoje} ${vencemHoje === 1 ? "tarefa vence" : "tarefas vencem"} hoje.`
        : openTasks.length > 0
          ? "Nada atrasado e nada vencendo hoje. Bom momento para adiantar a semana."
          : "Nenhuma tarefa aberta com você.";
  const hojeExtenso = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  /* O período do ranking (pedido do usuário, 13/10/2026: "só o mês fica ruim
     de ver"). Conta as tarefas com prazo no período — a mesma conta do placar.
     Lembrado neste computador. */
  const [periodoRanking, setPeriodoRanking] = useState<PeriodoDoPlacar>("mes");
  // Lido depois de montar: no servidor não há localStorage, e ler já no
  // estado inicial daria uma tela diferente da que o servidor mandou.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("fluxo:ranking-periodo");
      if (v === "dia" || v === "semana") setPeriodoRanking(v);
    } catch {
      /* sem armazenamento: fica o mês */
    }
  }, []);
  const escolherPeriodo = (p: PeriodoDoPlacar) => {
    setPeriodoRanking(p);
    try {
      window.localStorage.setItem("fluxo:ranking-periodo", p);
    } catch {
      /* sem armazenamento, vale só nesta tela */
    }
  };
  /* Chefia fora do ranking (pedido do usuário, 13/10/2026): o ranking é do
     time, e supervisor/gerente no meio dele expunha a nota do chefe para a
     equipe. Quem é chefia ganha o botão "Todos" para se ver na lista — o
     colaborador nunca vê o botão nem a chefia. */
  const ehChefia = currentUser.role !== "adm";
  const [rankingComChefia, setRankingComChefia] = useState(false);
  const pessoasDoRanking = useMemo(
    () =>
      ehChefia && rankingComChefia ? pessoasDoTime : pessoasDoTime.filter((u) => u.role === "adm"),
    [pessoasDoTime, ehChefia, rankingComChefia],
  );
  const userPct = useMemo(() => {
    const m = new Map<string, { pct: number; assigned: number }>();
    for (const u of pessoasDoRanking) {
      const s = userScorePct(u.id, tasks, completions, new Date(), periodoRanking);
      m.set(u.id, { pct: s.pct, assigned: s.assigned });
    }
    return m;
  }, [pessoasDoRanking, tasks, completions, periodoRanking]);
  /* O time INTEIRO, sem corte.
   *
   * Havia um `.slice(0, 5)` aqui, e ele produzia um efeito que não parecia um
   * corte: quem tem ZERO tarefas atribuídas vai para o fim da ordenação (as
   * três primeiras comparações abaixo), então a pessoa cortada era sempre a que
   * não tinha tarefa nenhuma. Numa equipe de seis, ela simplesmente não
   * aparecia na lista do próprio setor — e a leitura natural disso é "ela não
   * é do meu time", não "ela ficou em sexto".
   *
   * A seção se chama "Ranking do time", não "Top 5". Com o setor inteiro na
   * tela, quem não tem tarefa aparece com "—" no lugar do número, que é a
   * informação certa: não é nota baixa, é ausência de nota.
   *
   * A lista rola em vez de crescer sem limite — para a gerência, "time" é a
   * empresa toda.
   */
  const ranking = useMemo(
    () =>
      [...pessoasDoRanking].sort((a, b) => {
        const sa = userPct.get(a.id) ?? { pct: 0, assigned: 0 };
        const sb = userPct.get(b.id) ?? { pct: 0, assigned: 0 };
        if (sa.assigned === 0 && sb.assigned === 0) return 0;
        if (sa.assigned === 0) return 1;
        if (sb.assigned === 0) return -1;
        return sb.pct - sa.pct;
      }),
    [pessoasDoRanking, userPct],
  );

  const recentNotifs = notifications.filter((n) => n.userId === currentUser.id).slice(0, 5);

  return (
    <FluxoLayout title="Início">
      <div className="mx-auto w-full max-w-[2200px] space-y-6">
        {/* O topo: quem sou, o que pede atenção agora e os três placares
            (hoje, semana, mês) em anéis — repaginado em 13/10/2026. */}
        <BlocoEntrada indice={0}>
          <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-40 right-10 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
            <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,0.8fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)_auto_minmax(0,0.7fr)]">
              {/* O avatar à direita do "Olá", da data até o botão (16/10/2026):
                  ele dá um pulinho e acena. Sem avatar, um convite para montar. */}
              <div className="flex items-stretch gap-3">
                <div className="min-w-0 self-center">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    {hojeExtenso}
                  </div>
                  <h1 className="mt-1 whitespace-nowrap font-display text-3xl font-bold tracking-tight">
                    Olá, {currentUser.name.split(" ")[0]}
                  </h1>
                  {/* O avatar falando o resumo do dia, digitando (19/10/2026). */}
                  <BalaoDoBomDia
                    chaveDoDia={`fluxo:bomdia:${currentUser.id}:${hojeIso}`}
                    frases={frasesDoBomDia({
                      nome: currentUser.name.split(" ")[0] ?? currentUser.name,
                      packTotal,
                      packFeitas: packDoneCount,
                      atrasadas,
                      vencemHoje,
                      compromissos: compromissosDeHoje,
                      aniversariantes,
                      ofensiva,
                    })}
                  />
                  <span className="sr-only">{resumoDoDia}</span>
                </div>
                {/* Logo depois do nome, acenando para quem chega (16/10/2026). */}
                <AvatarDoInicio humor={humor} />
              </div>

              {/* Solto no meio do topo, sem cartão (pedido do usuário, 13/10/2026).
                  Em tela menor desce para baixo de tudo, na largura inteira. */}
              <div className="order-last lg:col-span-3 xl:order-none xl:col-span-1">
                {/* A ofensiva no lugar do "Seu ritmo" (pedido do usuário, 19/10/2026). */}
                <OfensivaSemanal
                  ofensiva={ofensiva}
                  faltamHoje={Math.max(0, packTotal - packDoneCount)}
                />
              </div>

              <div className="justify-self-center">
                <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Meu placar
                </div>
                <AneisDoPlacar
                  dia={meusPlacares.dia}
                  semana={meusPlacares.semana}
                  mes={meusPlacares.mes}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Numero
                  icon={CheckCircle2}
                  rotulo="Concluídas hoje"
                  valor={doneToday.length}
                  cor="var(--color-success)"
                />
                <Numero
                  icon={Clock}
                  rotulo="Em aberto"
                  valor={openTasks.length}
                  sub={`${todayFocus.length} em foco`}
                  cor="var(--color-primary)"
                />
                <Numero
                  icon={TrendingUp}
                  rotulo="Atrasadas"
                  valor={atrasadas}
                  cor={atrasadas > 0 ? "var(--color-destructive)" : "var(--color-muted-foreground)"}
                />
                <Numero
                  icon={Flame}
                  rotulo="Ofensiva"
                  valor={`${ofensiva.seguidos} d`}
                  sub="de pack fechado"
                  cor="oklch(0.6 0.2 330)"
                />
              </div>
            </div>
          </section>
        </BlocoEntrada>

        {/* Mural (14/10/2026): aniversário de hoje e comunicado não lido. Sem
            nada a mostrar, não ocupa espaço. */}
        <FaixaDoMuralNoInicio />

        <BlocoEntrada indice={1} className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <TempoTrabalhado
            eu={currentUser}
            tasks={tasks}
            time={pessoasDoTime.filter((u) => u.id !== currentUser.id)}
            ehChefia={ehChefia}
          />
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Minha carga</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              O que está aberto com você e quando vence, nos próximos 10 dias.
            </p>
            <MinhaCarga abertas={openTasks} />
          </section>
          <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-sm">
            <RankingDeTempo eu={currentUser} tasks={tasks} aoAbrir={openTask} />
            <div className="border-t border-border pt-4">
              <h2 className="text-sm font-semibold">Dias mais cheios</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                De segunda a domingo, onde as suas tarefas se concentram.
              </p>
              <DiasDaSemana tasks={tasks} userId={currentUser.id} />
            </div>
          </section>
        </BlocoEntrada>

        {/* Meu pack — foco especial */}
        <BlocoEntrada indice={2}>
          <section className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-card p-5 shadow-sm">
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="relative grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
                      <Flame className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold">Meu pack de hoje</h2>
                      <p className="text-[11px] text-muted-foreground">
                        Seus compromissos diários inegociáveis.
                      </p>
                    </div>
                  </div>
                  <Link
                    to="/minhas-tarefas"
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-500/20"
                  >
                    Abrir pack <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>

                <div className="mt-4 flex items-end gap-4">
                  <div className="text-4xl font-semibold tabular-nums tracking-tight text-amber-600">
                    {packDoneCount}
                    <span className="text-lg text-muted-foreground">/{packTotal}</span>
                  </div>
                  <div className="flex-1 pb-1.5">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Progresso do dia</span>
                      <span className="font-semibold text-amber-600">{packPct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all"
                        style={{ width: `${packPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <ul className="mt-4 space-y-1.5">
                  {packTasks.length === 0 && (
                    <li className="rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-4 text-center text-xs text-muted-foreground">
                      Você ainda não montou seu pack. Vá em{" "}
                      <Link
                        to="/minhas-tarefas"
                        className="font-semibold text-amber-600 hover:underline"
                      >
                        Minhas tarefas
                      </Link>{" "}
                      e marque a ★ nas obrigações do seu dia.
                    </li>
                  )}
                  {packTasks.slice(0, 5).map((t) => {
                    const done = concluidaHoje(t);
                    const sec = sectors.find((s) => s.id === t.sector);
                    return (
                      <li
                        key={t.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openTaskContext(t.id, e.clientX, e.clientY);
                        }}
                        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-amber-500/5"
                      >
                        <button
                          onClick={() => concluirDoPack(t.id)}
                          disabled={done}
                          aria-label={done ? "Concluída hoje" : "Concluir hoje"}
                          title={done ? "Concluída hoje" : "Concluir hoje"}
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition disabled:cursor-default ${
                            done
                              ? "border-amber-500 bg-amber-500 text-white"
                              : "border-amber-500/50 bg-transparent hover:border-amber-500"
                          }`}
                        >
                          {done && <CheckCircle2 className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => openTask(t.id)}
                          className={`flex-1 truncate text-left text-sm ${done ? "text-muted-foreground line-through" : "font-medium"}`}
                        >
                          <SeloDoProjeto projectId={t.projectId} />
                          {t.title}
                        </button>
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                            color: sec?.color,
                          }}
                        >
                          {sec?.name}
                        </span>
                      </li>
                    );
                  })}
                  {packTasks.length > 5 && (
                    <li className="pl-7 pt-1 text-[11px] text-muted-foreground">
                      +{packTasks.length - 5} no pack completo
                    </li>
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-card/70 p-4 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">Packs do time</h3>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Quem já definiu seus compromissos diários.
                </p>
                <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                  {teamPack.length === 0 && (
                    <li className="py-4 text-center text-xs text-muted-foreground">
                      Ninguém montou o pack ainda.
                    </li>
                  )}
                  {teamPack.map(({ user, total }) => (
                    <li key={user.id} className="flex items-center gap-2">
                      <UserAvatar
                        nome={user.name}
                        iniciais={user.avatar}
                        className="h-7 w-7 text-[10px]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{user.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {total} {total === 1 ? "item" : "itens"} no pack
                        </div>
                      </div>
                      <Flame className="h-3.5 w-3.5 text-amber-500" />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </BlocoEntrada>

        <BlocoEntrada indice={3} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Foco de hoje</h2>
                <p className="text-xs text-muted-foreground">
                  Tarefas vencendo em breve, priorizadas.
                </p>
              </div>
              <Link
                to="/minhas-tarefas"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver todas
              </Link>
            </div>
            <ul className="mt-4 divide-y divide-border">
              {todayFocus.length === 0 && (
                <li className="py-10 text-center text-sm text-muted-foreground">
                  Nada urgente. Aproveite pra planejar a semana.
                </li>
              )}
              {todayFocus.map((t) => {
                const bucket = formatDueBucket(t.dueDate);
                const sec = sectors.find((s) => s.id === t.sector);
                return (
                  <li
                    key={t.id}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openTaskContext(t.id, e.clientX, e.clientY);
                    }}
                  >
                    <button
                      onClick={() => openTask(t.id)}
                      className="flex w-full items-center gap-3 py-3 text-left hover:bg-secondary/40"
                    >
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          <SeloDoProjeto projectId={t.projectId} />
                          {t.title}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                            style={{
                              background: `color-mix(in oklab, ${sec?.color} 15%, transparent)`,
                              color: sec?.color,
                            }}
                          >
                            {sec?.name}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                            style={{
                              background: `color-mix(in oklab, ${statusColor[t.status]} 18%, transparent)`,
                              color: statusColor[t.status],
                            }}
                          >
                            {statusLabels[t.status]}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 font-semibold ${
                              bucket === "atrasada"
                                ? "bg-destructive/15 text-destructive"
                                : bucket === "hoje"
                                  ? "bg-warning/20 text-warning"
                                  : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {bucket === "atrasada"
                              ? "Atrasada"
                              : bucket === "hoje"
                                ? "Hoje"
                                : "Esta semana"}
                            {t.dueTime && ` · ${t.dueTime}`}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <SemanaDoTime />
        </BlocoEntrada>

        <BlocoEntrada indice={4} className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Ranking do time</h2>
              {ehChefia && (
                <button
                  type="button"
                  onClick={() => setRankingComChefia((v) => !v)}
                  aria-pressed={rankingComChefia}
                  title={
                    rankingComChefia
                      ? "Mostrando também supervisores e gerentes (só você vê)"
                      : "Incluir supervisores e gerentes — só você vê"
                  }
                  className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                    rankingComChefia
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Todos
                </button>
              )}
              <div
                className={`${ehChefia ? "" : "ml-auto "}inline-flex rounded-md border border-border p-0.5 text-[11px] font-medium`}
              >
                {(
                  [
                    ["dia", "Hoje"],
                    ["semana", "Semana"],
                    ["mes", "Mês"],
                  ] as const
                ).map(([v, rotulo]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => escolherPeriodo(v)}
                    className={`rounded px-2 py-0.5 transition ${
                      periodoRanking === v
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
            <Podio pessoas={ranking} placar={userPct} />
            <ul className="mt-1 max-h-96 divide-y divide-border overflow-y-auto">
              {ranking.map((u, i) => {
                const s = userPct.get(u.id) ?? { pct: 0, assigned: 0 };
                return (
                  <li key={u.id} className="flex items-center gap-3 py-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                      style={
                        i === 0
                          ? { background: "oklch(0.78 0.15 75)", color: "oklch(0.25 0.05 60)" }
                          : { background: "oklch(0.95 0.005 260)", color: "oklch(0.5 0.02 260)" }
                      }
                    >
                      {i + 1}
                    </span>
                    <UserAvatar nome={u.name} iniciais={u.avatar} className="h-8 w-8 text-[11px]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="mt-1">
                        <ScoreBar pct={s.pct} assigned={s.assigned} showLabel={false} size="sm" />
                      </div>
                    </div>
                    <div
                      className={`text-right text-sm font-semibold tabular-nums ${scoreTextClass(s.pct, s.assigned)}`}
                    >
                      {s.assigned === 0 ? "—" : `${Math.round(s.pct)}%`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Últimos avisos</h2>
              </div>
              <Link to="/inbox" className="text-xs font-medium text-primary hover:underline">
                Abrir inbox
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {recentNotifs.length === 0 && (
                <li className="py-8 text-center text-xs text-muted-foreground">Sem avisos.</li>
              )}
              {recentNotifs.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (n.taskId) openTask(n.taskId);
                      else if (n.type === "projeto")
                        void navigate({
                          to: "/projetos",
                          search: n.projectId ? { projeto: n.projectId } : {},
                        });
                    }}
                    className="flex w-full gap-3 py-3 text-left hover:bg-secondary/40"
                  >
                    <AtSign className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{tituloDoAviso(n, users)}</div>
                      <div className="truncate text-xs text-muted-foreground">{n.desc}</div>
                      <div className="text-[10px] text-muted-foreground/70">
                        {formatRelative(n.at)}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </BlocoEntrada>
      </div>
    </FluxoLayout>
  );
}

function Numero({
  icon: Icon,
  rotulo,
  valor,
  sub,
  cor,
}: {
  icon: typeof Trophy;
  rotulo: string;
  valor: string | number;
  sub?: string;
  cor: string;
}) {
  // Mais compacto (16/10/2026): abriu espaço para o avatar no topo.
  return (
    <div className="rounded-lg border border-border bg-background/60 px-2.5 py-2 backdrop-blur">
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Icon className="h-3 w-3" style={{ color: cor }} />
        <span className="truncate">{rotulo}</span>
      </div>
      <div
        className="font-display text-xl font-bold leading-tight tabular-nums tracking-tight"
        style={{ color: cor }}
      >
        {valor}
      </div>
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* O 3D só no navegador e só quando chega a vez: three.js é pesado e o Início
   abre primeiro sem ele. */
const AvatarAcenandoPreguicoso = lazy(() =>
  import("@/components/avatar-acenando").then((m) => ({ default: m.AvatarAcenando })),
);

function AvatarDoInicio({
  humor = "normal",
}: {
  humor?: "normal" | "feliz" | "preocupado" | "triste";
}) {
  const { avatar, carregado } = useMeuAvatar();
  // No dia do aniversário, o boneco do Início acena de chapéu de festa (19/10/2026).
  const { currentUser } = useFluxo();
  useAniversariosDeHoje();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  const caixa = "relative -my-6 hidden min-h-[290px] w-[230px] shrink-0 sm:block";
  if (!montado || !carregado) return <div className={caixa} />;
  return (
    <div className={caixa}>
      <Suspense fallback={null}>
        {/* Quem ainda não montou o seu acena com o boneco em branco (17/10/2026). */}
        <AvatarAcenandoPreguicoso
          config={comChapeuDeFesta(currentUser.id, avatar ?? AVATAR_EM_BRANCO)}
          className="absolute inset-0"
          humor={humor}
        />
      </Suspense>
      {!avatar && (
        <Link
          to="/configuracoes"
          title="Monte o seu avatar em Configurações → Meu avatar"
          className="absolute bottom-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-md transition hover:brightness-110"
        >
          ✨ Monte o seu avatar
        </Link>
      )}
    </div>
  );
}
