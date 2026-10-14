import { baixarXlsx, type Celula } from "@/lib/planilha-xlsx";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Maximize2, Minimize2, Presentation } from "lucide-react";
import { toast } from "sonner";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { UserAvatar } from "@/components/user-avatar";
import { rotuloDaFrequencia, sectors, type Task, type User } from "@/lib/fluxo-types";
import { carregarTempoDoServidor, formatHM } from "@/lib/time-log";
import { desktopSetFullscreen, isTauri } from "@/lib/desktop";
import { TravaScroll } from "@/components/trava-scroll";
import { rotuloDoPrazo } from "@/lib/prazo";
import {
  PERIODOS,
  contar,
  fatiasDoPeriodo,
  janelaAnterior,
  mapaDeConclusoes,
  montarAlertas,
  periodRange,
  periodoLabel,
  placarPorFatia,
  placarPorSetor,
  pontuarPessoa,
  prazoNoPeriodo,
  progressoDasMetas,
  scoreTask,
  somar,
  tarefasPorPessoa,
  type Contagem,
  type Periodo,
  type TaskScore,
} from "@/components/metas/calculo";
import { Cartao, Distribuicao, GraficoEvolucao, MapaDeCalor } from "@/components/metas/graficos";
import { nomeDoSetor, porScore } from "@/components/metas/formato";
import {
  CartaoDoScore,
  FiltroDeColaboradores,
  ListaDeAlertas,
  ProgressoDeMetas,
  ScorePorSetor,
} from "@/components/metas/paineis";
import { Podio, Ranking } from "@/components/metas/ranking";

export const Route = createFileRoute("/metas")({
  head: () => ({
    meta: [
      { title: "Painel gestor · Metas & Score · SGL - CONECTA" },
      { name: "description", content: "Painel apresentativo do gestor: resultados individuais e do time com filtro por colaborador e exportação em PDF." },
    ],
  }),
  component: MetasPage,
});

/* Reforma de 13/10/2026: a aba virou um painel de score e metas de verdade —
   anel do score com a tendência, evolução dia a dia contra a linha da meta,
   pódio, ranking com minilinha, distribuição completa (com as pendentes),
   alertas acionáveis, score por setor, mapa de calor pessoa × dia e o
   progresso das metas cadastradas. As contas e os gráficos moram em
   `src/components/metas/`; tudo é calculado aqui no navegador, em cima do que o
   `useFluxo` já carregou — nenhuma consulta nova ao banco (teto de DTU). A
   regra do score não mudou: ver `calculo.ts`. */

function MetasPage() {
  const { tasks, users, completions, currentUser, metas } = useFluxo();
  const [period, setPeriod] = useState<Periodo>("diaria");
  /* O personalizado nasce no mês corrente: do dia 1 até hoje. Nascer vazio
     obrigaria a preencher dois campos antes de ver qualquer coisa. */
  const [customDe, setCustomDe] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [customAte, setCustomAte] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [porPessoaNoGrafico, setPorPessoaNoGrafico] = useState(false);
  const isManager = currentUser.role === "gerente" || currentUser.role === "supervisor";
  const containerRef = useRef<HTMLDivElement>(null);
  const [presenting, setPresenting] = useState(false);

  const visibleUsers = useMemo(() => {
    if (currentUser.role === "gerente") return users;
    if (currentUser.role === "supervisor")
      return users.filter((u) => u.id === currentUser.id || u.supervisorId === currentUser.id);
    return users.filter((u) => u.id === currentUser.id);
  }, [users, currentUser]);

  // Filtro do time — começa com todo mundo visível; painel e PDF respeitam.
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(
    () => new Set(visibleUsers.map((u) => u.id)),
  );
  useEffect(() => {
    // Se o time visível muda (ex.: troca de papel), a seleção recomeça.
    setSelectedTeam(new Set(visibleUsers.map((u) => u.id)));
  }, [visibleUsers]);
  const filteredUsers = useMemo(
    () => visibleUsers.filter((u) => selectedTeam.has(u.id)),
    [visibleUsers, selectedTeam],
  );

  /* ————— Modo apresentação —————
     No app nativo NÃO usamos requestFullscreen(): quem manda no tamanho é a
     janela do Tauri, e o WebView ficava desencontrado dela — sobrava uma faixa
     preta no rodapé (o ::backdrop do elemento em tela cheia aparecendo).
     Pedimos tela cheia à janela e controlamos o estado por conta própria.
     No navegador a API do navegador continua sendo a certa. */
  const nativo = isTauri();

  // Só o navegador emite fullscreenchange; no Tauri o estado é nosso.
  useEffect(() => {
    if (nativo) return;
    const onChange = () => setPresenting(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [nativo]);

  // Esconde a barra de título e devolve os 34px que ela reserva no body.
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.toggle("fluxo-apresentando", presenting);
    return () => raiz.classList.remove("fluxo-apresentando");
  }, [presenting]);

  /**
   * O modo apresentação é CSS e vale por si só; a tela cheia do sistema é um
   * bônus. Por isso o estado é trocado ANTES e independe dela: se a tela cheia
   * falhar (permissão do Tauri, navegador que nega o gesto), a pessoa ainda
   * apresenta — só com a barra de tarefas à mostra.
   */
  const togglePresent = async () => {
    const alvo = !presenting;
    setPresenting(alvo);
    if (nativo) {
      await desktopSetFullscreen(alvo);
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (alvo) await containerRef.current?.requestFullscreen();
    } catch {
      /* segue apresentando sem tela cheia */
    }
  };

  // Esc sai da apresentação mesmo quando a tela cheia não pegou.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPresenting(false);
      if (nativo) void desktopSetFullscreen(false);
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, nativo]);

  // Sair da rota com a janela em tela cheia deixaria o app preso assim.
  useEffect(() => {
    return () => {
      if (isTauri()) void desktopSetFullscreen(false);
    };
  }, []);

  /* ————— Contas (todas no navegador) ————— */

  const range = useMemo(
    () => periodRange(period, new Date(), { de: customDe, ate: customAte }),
    [period, customDe, customAte],
  );
  const rangeAnterior = useMemo(() => janelaAnterior(period, range), [period, range]);
  const { fatias, descricao: descricaoDasFatias } = useMemo(
    () => fatiasDoPeriodo(period, range),
    [period, range],
  );

  const conclusoes = useMemo(() => mapaDeConclusoes(completions), [completions]);
  const tarefasDe = useMemo(
    () => tarefasPorPessoa(tasks, new Set(filteredUsers.map((u) => u.id))),
    [tasks, filteredUsers],
  );

  const scores = useMemo(
    () => filteredUsers.map((u) => pontuarPessoa(u, tarefasDe.get(u.id) ?? [], range, conclusoes)),
    [filteredUsers, tarefasDe, range, conclusoes],
  );
  const ranked = useMemo(() => [...scores].sort(porScore), [scores]);
  const time = useMemo(() => somar(scores.map((s) => contar(s.breakdown))), [scores]);
  const timeAnterior = useMemo(
    () =>
      somar(
        filteredUsers.map((u) =>
          contar(pontuarPessoa(u, tarefasDe.get(u.id) ?? [], rangeAnterior, conclusoes).breakdown),
        ),
      ),
    [filteredUsers, tarefasDe, rangeAnterior, conclusoes],
  );

  const series = useMemo(() => {
    const m = new Map<string, Contagem[]>();
    for (const u of filteredUsers)
      m.set(u.id, placarPorFatia(tarefasDe.get(u.id) ?? [], fatias, conclusoes));
    return m;
  }, [filteredUsers, tarefasDe, fatias, conclusoes]);
  const serieDoTime = useMemo(
    () => fatias.map((_, i) => somar([...series.values()].map((s) => s[i]))),
    [fatias, series],
  );

  const alertas = useMemo(() => montarAlertas(ranked, range), [ranked, range]);
  const setores = useMemo(() => placarPorSetor(scores), [scores]);
  const mostrarSetores = currentUser.role === "gerente" && setores.length > 1;
  const progressoMetas = useMemo(
    () => progressoDasMetas(metas, filteredUsers, users, completions, nomeDoSetor),
    [metas, filteredUsers, users, completions],
  );

  // Linha por pessoa só cabe com poucas pessoas: são 5 cores de gráfico no tema.
  const podeSepararPessoas = filteredUsers.length >= 2 && filteredUsers.length <= 5;
  const linhasPorPessoa = useMemo(
    () =>
      podeSepararPessoas && porPessoaNoGrafico
        ? ranked.map((s) => ({ user: s.user, serie: series.get(s.user.id) ?? [] }))
        : undefined,
    [podeSepararPessoas, porPessoaNoGrafico, ranked, series],
  );
  const linhasDoMapa = useMemo(
    () => ranked.map((s) => ({ user: s.user, serie: series.get(s.user.id) ?? [] })),
    [ranked, series],
  );

  /** Abre o detalhamento da pessoa no ranking e rola até ela. */
  const abrirPessoa = useCallback((id: string) => {
    setOpenUserId(id);
    requestAnimationFrame(() =>
      document
        .getElementById(`metas-pessoa-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const tituloDoScore =
    filteredUsers.length === 1
      ? filteredUsers[0].id === currentUser.id
        ? "Seu score"
        : `Score de ${filteredUsers[0].name.split(" ")[0]}`
      : "Score do time";
  const rotuloAnterior =
    period === "diaria"
      ? rangeAnterior.start.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "2-digit",
        })
      : period === "semanal"
        ? "a semana anterior"
        : period === "mensal"
          ? rangeAnterior.label
          : `${rangeAnterior.label}`;

  return (
    <FluxoLayout title="Metas & Score">
      {/* Apresentando, o painel vira uma sobreposição que cobre a tela inteira
          e rola por dentro. O inset vai no style, não como classe `inset-0`:
          existe uma regra global (html.tauri-app .fixed.inset-0) que empurra
          34px para baixo da barra de título — aqui a barra está escondida, e
          esse empurrão abriria justamente a faixa vazia no rodapé.
          z-410: acima do menu e dos modais da página, abaixo do diálogo de
          tarefa (420), do foco (440) e do confirm (500). */}
      <div
        ref={containerRef}
        style={presenting ? { inset: 0 } : undefined}
        className={`space-y-4 ${
          presenting
            ? "fixed z-410 max-w-none overflow-auto bg-background p-6 text-[1.05rem] lg:p-10"
            : "mx-auto w-full max-w-[2200px]"
        }`}
      >
        {presenting && <TravaScroll />}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Presentation className="h-3 w-3" /> Painel do gestor
            </span>
            <h1
              className={`mt-1 font-display font-bold tracking-tight ${presenting ? "text-4xl lg:text-5xl" : "text-2xl"}`}
            >
              Metas & Score
            </h1>
            <p className="text-sm text-muted-foreground">
              {presenting
                ? `${range.label} · ${
                    filteredUsers.length === visibleUsers.length
                      ? "time todo"
                      : `${filteredUsers.length} ${filteredUsers.length === 1 ? "pessoa" : "pessoas"}`
                  }`
                : isManager
                  ? "Score do time contra a meta de 100%: 1 ponto por tarefa no prazo, ½ com atraso, 0 em aberto."
                  : "Seu score contra a meta de 100%: 1 ponto por tarefa no prazo, ½ com atraso, 0 em aberto."}
            </p>
          </div>
          {/* Abas e "Apresentar" ficam presos numa linha só; as datas do
              personalizado descem numa segunda linha própria, para o canto
              superior direito não pular de lugar ao trocar de aba. */}
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex overflow-hidden rounded-lg border border-border bg-card text-sm shadow-sm">
                {PERIODOS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPeriod(p.id)}
                    aria-pressed={period === p.id}
                    className={`px-3 py-1.5 font-medium transition ${period === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                  >
                    {p.rotulo}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={togglePresent}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20"
                title={presenting ? "Sair da apresentação (Esc)" : "Modo apresentação"}
              >
                {presenting ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                {presenting ? "Sair" : "Apresentar"}
              </button>
            </div>

            {/* A altura abre o espaço sem solavanco; o deslocamento traz os
                campos pela direita, de onde a aba foi clicada. */}
            <AnimatePresence initial={false}>
              {period === "personalizado" && (
                <motion.div
                  key="filtro-datas"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <motion.div
                    initial={{ x: 24 }}
                    animate={{ x: 0 }}
                    exit={{ x: 24 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-sm"
                  >
                    <input
                      type="date"
                      value={customDe}
                      max={customAte}
                      onChange={(e) => setCustomDe(e.target.value)}
                      aria-label="Início do período"
                      className="bg-transparent px-1 text-sm outline-none"
                    />
                    <span className="text-muted-foreground">até</span>
                    <input
                      type="date"
                      value={customAte}
                      min={customDe}
                      onChange={(e) => setCustomAte(e.target.value)}
                      aria-label="Fim do período"
                      className="bg-transparent px-1 text-sm outline-none"
                    />
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Filtro compacto. Some na apresentação: a lista suspensa abre fora do
            elemento em tela cheia e ficaria invisível — e na TV ninguém filtra. */}
        {isManager && visibleUsers.length > 1 && !presenting && (
          <div className="flex flex-wrap items-center gap-2">
            <FiltroDeColaboradores
              pessoas={visibleUsers}
              selecionados={selectedTeam}
              aoMudar={setSelectedTeam}
              euId={currentUser.id}
            />
            <span className="text-xs capitalize text-muted-foreground">
              {periodoLabel(period)} · {range.label}
            </span>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CartaoDoScore
              titulo={tituloDoScore}
              contagem={time}
              anterior={timeAnterior}
              rotuloAnterior={rotuloAnterior}
              rotuloDoPeriodo={range.label}
              grande={presenting}
            />
          </div>
          <Cartao
            titulo="Distribuição das tarefas"
            subtitulo="Os quatro estados somam o total do período"
          >
            <Distribuicao contagem={time} grande={presenting} />
          </Cartao>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Cartao
            className="lg:col-span-2"
            titulo="Evolução do score"
            subtitulo={`${descricaoDasFatias} · a linha tracejada é a meta (100%)`}
            acoes={
              podeSepararPessoas ? (
                <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
                  {[
                    { v: false, r: "Time" },
                    { v: true, r: "Por pessoa" },
                  ].map((o) => (
                    <button
                      key={o.r}
                      type="button"
                      onClick={() => setPorPessoaNoGrafico(o.v)}
                      aria-pressed={porPessoaNoGrafico === o.v}
                      className={`px-2 py-1 font-medium ${porPessoaNoGrafico === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
                    >
                      {o.r}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
          >
            <GraficoEvolucao
              fatias={fatias}
              serieDoTime={serieDoTime}
              porPessoa={linhasPorPessoa}
              altura={presenting ? 340 : 250}
            />
          </Cartao>
          <Cartao
            titulo="Precisa de atenção"
            subtitulo="O que pede ação neste período, do mais urgente ao informativo"
          >
            <ListaDeAlertas alertas={alertas} aoAbrir={abrirPessoa} />
          </Cartao>
        </div>

        <Cartao
          titulo="Ranking do período"
          subtitulo="Clique em alguém para ver as tarefas. Com atraso vale ½ ponto; pendente e perdida, 0."
          acoes={
            <span className="text-xs text-muted-foreground">
              {scores.length} {scores.length === 1 ? "colaborador" : "colaboradores"}
            </span>
          }
        >
          {ranked.filter((r) => r.assigned > 0).length >= 2 && (
            <div className="mb-5 pt-4">
              <Podio ranking={ranked} aoAbrir={abrirPessoa} />
            </div>
          )}
          <Ranking
            scores={scores}
            series={series}
            fatias={fatias}
            aberto={openUserId}
            aoAlternar={(id) => setOpenUserId((atual) => (atual === id ? null : id))}
            rotuloDoPeriodo={range.label}
            grande={presenting}
          />
        </Cartao>

        <div className="grid gap-4 lg:grid-cols-3">
          <Cartao
            className="lg:col-span-2"
            titulo="Mapa de calor"
            subtitulo={`Score de cada pessoa em cada ${descricaoDasFatias === "por semana" ? "semana" : "dia"} (${descricaoDasFatias}). Passe o mouse para ver o detalhe.`}
          >
            <MapaDeCalor
              linhas={linhasDoMapa}
              fatias={fatias}
              aoAbrir={abrirPessoa}
              grande={presenting}
            />
          </Cartao>
          <div className="flex min-w-0 flex-col gap-4">
            {mostrarSetores && (
              <Cartao titulo="Score por setor" subtitulo={range.label}>
                <ScorePorSetor setores={setores} />
              </Cartao>
            )}
            <Cartao
              titulo="Metas cadastradas"
              subtitulo="Cada meta se mede na própria janela (dia, semana ou mês corrente)"
            >
              <ProgressoDeMetas itens={progressoMetas} />
            </Cartao>
          </div>
        </div>

        {isManager && !presenting && (
          <ExportarPeriodo
            key={filteredUsers.map((u) => u.id).join(",")}
            users={filteredUsers}
            tasks={tasks}
            completions={completions}
            range={range}
          />
        )}
      </div>
    </FluxoLayout>
  );
}

/**
 * Exporta o período que está na tela.
 *
 * Chamava-se `ExportMonthly` e o nome era honesto: as três saídas — CSV, PDF e
 * o resumo — chamavam `periodRange("mensal")` por conta própria e ignoravam a
 * aba escolhida. Passava batido enquanto só existiam Diário e Mensal; com a aba
 * Personalizado ficou indefensável escolher um intervalo, clicar em exportar e
 * receber o mês inteiro. Agora o intervalo desce por `range`, o mesmo que os
 * cartões da tela usam — uma fonte só para o que está à vista e o que sai no
 * arquivo.
 */
function ExportarPeriodo({
  users,
  tasks,
  completions,
  range,
}: {
  users: User[];
  tasks: Task[];
  completions: { taskId: string; at: string }[];
  range: { start: Date; end: Date; label: string };
}) {
  const [busy, setBusy] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(users.map((u) => u.id)));

  /**
   * Adianta o download do jsPDF assim que esta seção aparece na tela.
   *
   * O ponto de colocar isto AQUI, e não no topo do arquivo: este componente só
   * é montado quando `isManager` é verdadeiro (metas.tsx:458). Quem é
   * colaborador nunca vê o botão de exportar e continua sem baixar os 390 KB.
   * Um import estático devolveria esse peso para todo mundo, que era
   * exatamente o problema que a rota tinha.
   *
   * Nada é aguardado: a tela já está pronta, isto corre atrás em silêncio. Se
   * a pessoa clicar antes de terminar, o `await import()` do `exportPdf`
   * espera esta mesma requisição em vez de abrir outra — `import()` é
   * idempotente, o módulo entra no registro do navegador e a segunda chamada
   * resolve dali.
   *
   * O `.catch` vazio existe só para a falha não virar uma promessa rejeitada
   * sem dono no console. O erro que importa é o do clique, e aquele avisa.
   */
  useEffect(() => {
    void Promise.all([import("jspdf"), import("jspdf-autotable")]).catch(() => {});
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selected.size === users.length && users.length > 0;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));
  const selectedUsers = () => users.filter((u) => selected.has(u.id));

  const buildUserData = (list: User[]) => {
    return list.map((u) => {
      /* A lista de frequências saiu daqui: ela deixava a tarefa SEMANAL de fora
         do PDF sem dizer nada. Um relatório que omite uma parte do trabalho em
         silêncio é pior que um relatório que não existe. O que define o que
         entra é o prazo cair no período. */
      const uTasks = tasks.filter(
        (t) =>
          t.assigneeId === u.id && prazoNoPeriodo(t, range),
      );
      const breakdown: TaskScore[] = uTasks.map((t) => {
        const c = completions.find((x) => x.taskId === t.id);
        return scoreTask(t, c?.at ?? null);
      });
      const points = breakdown.reduce((s, b) => s + b.points, 0);
      const pct = uTasks.length ? (points / uTasks.length) * 100 : 0;
      const onTime = breakdown.filter((b) => b.state === "on-time").length;
      const late = breakdown.filter((b) => b.state === "late").length;
      return { user: u, assigned: uTasks.length, points, pct, breakdown, onTime, late };
    });
  };

  const tierFor = (pct: number, assigned: number): string => {
    if (assigned === 0) return "Sem tarefas no período";
    if (pct >= 100) return "Excelência";
    if (pct >= 90) return "Superação";
    if (pct >= 80) return "Meta atingida";
    if (pct >= 50) return "Abaixo da meta";
    return "Crítico";
  };

  const exportXlsx = async () => {
    const list = selectedUsers();
    if (list.length === 0) return;
    setBusy(true);
    /* O tempo trabalhado vem do banco. Antes saía do `localStorage` desta
       máquina, então a coluna "Trabalhado" da planilha vinha zerada para todo mundo
       menos quem exportou — e zerada é indistinguível de "não cronometrou". */
    let logs: Record<string, { totals: Record<string, number> }> = {};
    try {
      logs = await carregarTempoDoServidor();
    } catch (e) {
      console.warn("[fluxo] tempo não carregou para a planilha:", (e as Error)?.message);
    }
    const rows: Celula[][] = [];
    rows.push(
      [
        "Colaborador",
        "Setor",
        "Frequência",
        "Tarefa",
        "Prazo",
        "Status",
        "Estimado (min)",
        "Trabalhado (min)",
        "Trabalhado (hh:mm)",
        "Desvio (min)",
      ],
    );
    for (const u of list) {
      // Mesma correção do PDF: semanal não pode sumir da planilha em silêncio.
      const uTasks = tasks.filter(
        (t) =>
          t.assigneeId === u.id && prazoNoPeriodo(t, range),
      );
      const breakdown: TaskScore[] = [];
      const userTotals = logs[u.id]?.totals ?? {};
      let sumWorkedSec = 0;
      let sumEstMin = 0;
      for (const t of uTasks) {
        const c = completions.find((x) => x.taskId === t.id);
        const b = scoreTask(t, c?.at ?? null);
        breakdown.push(b);
        const workedSec = userTotals[t.id] ?? 0;
        const workedMin = Math.round(workedSec / 60);
        const est = t.estimatedMinutes ?? 0;
        sumWorkedSec += workedSec;
        sumEstMin += est;
        rows.push(
          [
            u.name,
            u.sector,
            // Chave, como as outras colunas; a pontual não é "diaria".
            t.recurring ? t.frequency : "sem_recorrencia",
            t.title,
            rotuloDoPrazo(t),
            b.state,
            est || null,
            workedMin || null,
            workedSec ? formatHM(workedSec) : null,
            est ? workedMin - est : null,
          ],
        );
      }
      const pts = breakdown.reduce((s, b) => s + b.points, 0);
      const pct = uTasks.length ? (pts / uTasks.length) * 100 : 0;
      rows.push(
        [
          `>> TOTAL ${u.name}`,
          null,
          null,
          null,
          null,
          `${pct.toFixed(0)}%`,
          sumEstMin || null,
          Math.round(sumWorkedSec / 60) || null,
          sumWorkedSec ? formatHM(sumWorkedSec) : null,
          sumEstMin ? Math.round(sumWorkedSec / 60) - sumEstMin : null,
        ],
      );
    }
    baixarXlsx(`fluxo-score-${range.label.replace(/\s+/g, "-").toLowerCase()}`, [
      { nome: "Score", linhas: rows },
    ]);
    setBusy(false);
  };

  const exportPdf = async () => {
    const list = selectedUsers();
    if (list.length === 0) return;
    setBusyPdf(true);
    try {
      /**
       * Na prática isto resolve na hora: o `useEffect` lá em cima já mandou
       * buscar as duas quando a seção apareceu, e `import()` devolve o módulo
       * já registrado sem ir à rede de novo.
       *
       * O `await` continua aqui porque é ele que cobre os dois casos em que o
       * adiantamento não deu conta — clique rápido demais, com o download
       * ainda em curso, ou download que falhou. Nos dois, esperar esta
       * chamada é o comportamento certo.
       */
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const data = buildUserData(list);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 48;

      const primary: [number, number, number] = [37, 99, 235];
      const dark: [number, number, number] = [17, 24, 39];
      const muted: [number, number, number] = [107, 114, 128];
      const success: [number, number, number] = [22, 163, 74];
      const danger: [number, number, number] = [220, 38, 38];

      const drawHeader = (subtitle: string) => {
        doc.setFillColor(...primary);
        doc.rect(0, 0, pageW, 90, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("SGL - CONECTA", margin, 42);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text("Relatório de Produtividade", margin, 60);
        doc.setFontSize(9);
        doc.text(subtitle, margin, 76);
        doc.setTextColor(...dark);
      };

      const drawFooter = () => {
        const pages = doc.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i);
          doc.setDrawColor(230);
          doc.line(margin, pageH - 42, pageW - margin, pageH - 42);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(
            `SGL - CONECTA · Documento gerado em ${new Date().toLocaleString("pt-BR")}`,
            margin,
            pageH - 26,
          );
          doc.text(`Página ${i} de ${pages}`, pageW - margin, pageH - 26, { align: "right" });
        }
      };

      // ============ COVER ============
      drawHeader(`Competência: ${range.label}`);

      const teamAssigned = data.reduce((s, r) => s + r.assigned, 0);
      const teamPoints = data.reduce((s, r) => s + r.points, 0);
      const teamPct = teamAssigned ? (teamPoints / teamAssigned) * 100 : 0;
      const onTimeTotal = data.reduce(
        (s, r) => s + r.breakdown.filter((b) => b.state === "on-time").length,
        0,
      );

      let y = 130;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...dark);
      doc.text("Resumo executivo do período", margin, y);
      y += 8;
      doc.setDrawColor(...primary);
      doc.setLineWidth(2);
      doc.line(margin, y, margin + 60, y);
      y += 24;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...muted);
      const introLines = doc.splitTextToSize(
        "Este relatório consolida o desempenho no período com base nas tarefas atribuídas e concluídas. Concluir no prazo conta como tarefa cheia, concluir em atraso conta pela metade, e não concluir não conta. O score é a razão entre tarefas cumpridas e tarefas atribuídas.",
        pageW - margin * 2,
      );
      doc.text(introLines, margin, y);
      y += introLines.length * 13 + 14;

      // KPI cards
      const kpis = [
        { label: "Score do time", value: `${teamPct.toFixed(0)}%`, accent: teamPct >= 100 ? success : teamAssigned ? danger : muted },
        { label: "Tarefas atribuídas", value: String(teamAssigned), accent: dark },
        { label: "Concluídas", value: `${data.reduce((s, r) => s + r.onTime + r.late, 0)}/${teamAssigned}`, accent: primary },
        { label: "No prazo", value: `${onTimeTotal}/${teamAssigned}`, accent: success },
      ];
      const cardW = (pageW - margin * 2 - 12 * 3) / 4;
      kpis.forEach((k, i) => {
        const x = margin + i * (cardW + 12);
        doc.setDrawColor(230);
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(x, y, cardW, 68, 6, 6, "FD");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...muted);
        doc.text(k.label.toUpperCase(), x + 12, y + 18);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(...(k.accent as [number, number, number]));
        doc.text(k.value, x + 12, y + 44);
      });
      y += 90;

      // Ranking table
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [["#", "Colaborador", "Setor", "Atribuídas", "Concluídas", "Score", "Classificação"]],
        body: [...data]
          .sort((a, b) => b.pct - a.pct)
          .map((r, i) => {
            return [
              String(i + 1),
              r.user.name,
              sectors.find((s) => s.id === r.user.sector)?.name ?? r.user.sector,
              String(r.assigned),
              String(r.onTime + r.late),
              `${r.pct.toFixed(0)}%`,
              tierFor(r.pct, r.assigned),
            ];
          }),
        styles: { font: "helvetica", fontSize: 9, cellPadding: 6, textColor: dark },
        headStyles: { fillColor: primary, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        columnStyles: {
          0: { cellWidth: 26, halign: "center" },
          3: { halign: "center" },
          4: { halign: "center" },
          5: { halign: "center", fontStyle: "bold" },
          6: { halign: "right", fontStyle: "bold", textColor: dark },
        },
      });

      // ============ PER-USER PAGES ============
      const sorted = [...data].sort((a, b) => b.pct - a.pct);
      for (const row of sorted) {
        doc.addPage();
        drawHeader(`Competência: ${range.label}`);
        const tier = tierFor(row.pct, row.assigned);
        let yy = 130;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(...dark);
        doc.text(row.user.name, margin, yy);
        yy += 20;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...muted);
        doc.text(
          `${row.user.jobTitle} · ${sectors.find((s) => s.id === row.user.sector)?.name ?? row.user.sector}`,
          margin,
          yy,
        );
        yy += 24;

        // Score highlight box
        const boxColor: [number, number, number] =
          row.assigned === 0 ? muted : row.pct >= 100 ? success : danger;
        doc.setFillColor(...boxColor);
        doc.roundedRect(margin, yy, pageW - margin * 2, 76, 8, 8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text("SCORE DO MÊS", margin + 20, yy + 22);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(32);
        doc.text(`${row.pct.toFixed(0)}%`, margin + 20, yy + 56);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(tier, pageW - margin - 20, yy + 30, { align: "right" });
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text(
          `${row.onTime + row.late} / ${row.assigned} tarefas`,
          pageW - margin - 20,
          yy + 58,
          { align: "right" },
        );
        doc.setTextColor(...dark);
        yy += 96;

        // Stats row
        const onTime = row.breakdown.filter((x) => x.state === "on-time").length;
        const late = row.breakdown.filter((x) => x.state === "late").length;
        const pending = row.breakdown.filter((x) => x.state === "pending").length;
        const missed = row.breakdown.filter((x) => x.state === "missed").length;
        const stats = [
          { l: "No prazo", v: onTime, c: success },
          { l: "Em atraso", v: late, c: [217, 119, 6] as [number, number, number] },
          { l: "Pendentes", v: pending, c: muted },
          { l: "Perdidas", v: missed, c: danger },
        ];
        const sw = (pageW - margin * 2 - 12 * 3) / 4;
        stats.forEach((s, i) => {
          const x = margin + i * (sw + 12);
          doc.setDrawColor(230);
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(x, yy, sw, 56, 6, 6, "FD");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(...muted);
          doc.text(s.l.toUpperCase(), x + 10, yy + 16);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(18);
          doc.setTextColor(...s.c);
          doc.text(String(s.v), x + 10, yy + 40);
        });
        yy += 76;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(...dark);
        doc.text("Detalhamento das tarefas", margin, yy);
        yy += 10;

        const stateLabel: Record<TaskScore["state"], string> = {
          "on-time": "No prazo",
          late: "Em atraso",
          pending: "Pendente",
          missed: "Perdida",
        };

        autoTable(doc, {
          startY: yy,
          margin: { left: margin, right: margin },
          head: [["Tarefa", "Frequência", "Prazo", "Status"]],
          body:
            row.breakdown.length === 0
              ? [[{ content: "Nenhuma tarefa atribuída no período.", colSpan: 4, styles: { halign: "center", textColor: muted } }]]
              : row.breakdown.map((x) => [
                  x.task.title,
                  rotuloDaFrequencia(x.task),
                  rotuloDoPrazo(x.task),
                  stateLabel[x.state],
                ]),
          styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: dark },
          headStyles: { fillColor: [243, 244, 246], textColor: dark, fontStyle: "bold" },
          columnStyles: {
            1: { cellWidth: 60, halign: "center" },
            2: { cellWidth: 70, halign: "center" },
            3: { cellWidth: 70, halign: "center" },
          },
        });

        // Signature block
        const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 40;
        if (finalY < pageH - 120) {
          doc.setDrawColor(200);
          doc.line(margin, finalY, margin + 200, finalY);
          doc.line(pageW - margin - 200, finalY, pageW - margin, finalY);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(...muted);
          doc.text("Colaborador(a)", margin, finalY + 14);
          doc.text("Gestor responsável", pageW - margin - 200, finalY + 14);
        }
      }

      drawFooter();
      const stamp = range.label.replace(/\s+/g, "-").toLowerCase();
      const filename =
        list.length === 1
          ? `fluxo-score-${list[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}.pdf`
          : `fluxo-score-${stamp}.pdf`;
      doc.save(filename);
    } catch (e) {
      // Passou a existir uma ida à rede que antes não existia: sem internet, ou
      // com o arquivo trocado por um deploy no meio da sessão, o import falha.
      // Antes qualquer erro aqui morria calado e o botão só voltava ao normal.
      console.error("[metas] falha ao gerar o PDF:", e);
      toast.error("Não foi possível gerar o PDF. Verifique a conexão e tente de novo.");
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <section className="rounded-lg border border-dashed border-border bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          {/* "mensal" saiu do título (13/10/2026): exporta o período da tela. */}
          <h2 className="text-sm font-semibold">Relatório do período · {range.label}</h2>
          <p className="text-xs text-muted-foreground">
            Selecione um ou mais colaboradores e gere um <strong>PDF profissional</strong> com capa, ranking e uma
            página de detalhamento por pessoa. Também disponível como planilha do Excel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void exportPdf()}
            disabled={busyPdf || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            {busyPdf ? "Gerando..." : `Exportar PDF (${selected.size})`}
          </button>
          <button
            onClick={exportXlsx}
            disabled={busy || selected.size === 0}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Excel
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-3 py-2 text-xs">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 accent-primary"
            />
            Selecionar todos
          </label>
          <span className="text-muted-foreground">
            {selected.size} de {users.length} selecionado{selected.size === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="grid gap-0 sm:grid-cols-2">
          {users.map((u) => {
            const sector = sectors.find((s) => s.id === u.sector);
            const checked = selected.has(u.id);
            return (
              <li key={u.id} className="border-b border-border last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-secondary/40">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(u.id)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <UserAvatar
                    nome={u.name}
                    iniciais={u.avatar}
                    className="h-7 w-7 text-[10px] text-white"
                    style={{ background: sector?.color ?? "oklch(0.52 0.22 275)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {u.jobTitle} · {sector?.name ?? u.sector}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

