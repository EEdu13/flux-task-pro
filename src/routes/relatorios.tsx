import { baixarXlsx } from "@/lib/planilha-xlsx";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Hourglass,
  Inbox,
  Lightbulb,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import {
  PERIODOS,
  avaliarEntregas,
  dentro,
  duracao,
  gerarAchados,
  idadeEmDias,
  janelaDoPeriodo,
  mapaDeCalor,
  resumirEntregas,
  sessoesDoEscopo,
  somaSegundos,
  variacao,
  baldesDaJanela,
  type Achado,
  type Periodo,
  type Variacao,
} from "@/components/relatorios/analise";
import { Indicador, TituloDeBloco } from "@/components/relatorios/pecas";
import { SecaoEntregas } from "@/components/relatorios/secao-entregas";
import { SecaoTempo } from "@/components/relatorios/secao-tempo";
import { TabelaDoTime } from "@/components/relatorios/tabela-do-time";
import { useFluxo } from "@/lib/fluxo-store";
import { priorityLabels, sectors, statusLabels, type Task, type User } from "@/lib/fluxo-types";
import { nomeCurto } from "@/lib/nome-curto";
import { tarefaVencida } from "@/lib/prazo";
import {
  linhasDeResumo,
  linhasDeSessoes,
  carregarTempoDoServidor,
  type SessionRow,
  type SummaryRow,
  type Persisted,
} from "@/lib/time-log";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios · SGL - CONECTA" },
      {
        name: "description",
        content: "Análise de entregas, prazos e tempo trabalhado por pessoa, equipe e setor.",
      },
    ],
  }),
  component: Relatorios,
});

/**
 * Relatórios — reconstruída em 13/10/2026 (pedido do usuário: "aba relatórios
 * tá horrível … coloque coisas úteis ali de tempo, tarefas e tal, que
 * realmente seja uma análise").
 *
 * Dois seletores mandam na tela inteira: o PERÍODO (7 dias, 30 dias, mês
 * atual, 90 dias — com comparação contra o período anterior do mesmo tamanho)
 * e o ESCOPO (eu, uma pessoa, minha equipe, um setor). O escopo respeita quem
 * pode ver quem: gerente vê todos, supervisor vê a si e a quem responde a ele,
 * ADM só a si.
 *
 * Custo no banco: nenhum além do que já existia. Tarefas e conclusões (90
 * dias) já estão na memória do app; as sessões do cronômetro são buscadas UMA
 * vez por visita (`listarSessoesDeTempo`) e tudo o mais é conta no cliente —
 * o teto de DTU do Azure já foi atingido uma vez.
 *
 * O bug do "Tempo total registrado 0m" ao lado de "Tarefas com tempo 2": as
 * sessões existiam, mas somavam menos de um minuto e `formatHM` corta os
 * segundos. Agora toda duração passa por `duracao`, que mostra segundos
 * quando é o caso.
 */

const ESCOPO_TIME = "time";

function Relatorios() {
  const { tasks, users, completions, projects, currentUser } = useFluxo();

  /* ------------------------------------------------------------ quem vejo */
  const visibleUsers = useMemo(() => {
    if (currentUser.role === "gerente") return users;
    if (currentUser.role === "supervisor")
      return users.filter((u) => u.id === currentUser.id || u.supervisorId === currentUser.id);
    return users.filter((u) => u.id === currentUser.id);
  }, [users, currentUser]);

  const escopoPadrao = visibleUsers.length > 1 ? ESCOPO_TIME : `p:${currentUser.id}`;
  const [escopo, setEscopo] = useState<string>(escopoPadrao);
  useEffect(() => {
    setEscopo(escopoPadrao);
    // Só ao trocar de usuário: mudar a lista de pessoas não deve desfazer a escolha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  const [periodo, setPeriodo] = useState<Periodo>("30d");

  const setoresVisiveis = useMemo(() => {
    const ids = new Set(visibleUsers.map((u) => u.sector));
    return sectors.filter((s) => ids.has(s.id));
  }, [visibleUsers]);

  const pessoasEscopo = useMemo<User[]>(() => {
    if (escopo === ESCOPO_TIME) return visibleUsers;
    if (escopo.startsWith("s:")) return visibleUsers.filter((u) => u.sector === escopo.slice(2));
    const id = escopo.slice(2);
    const u = visibleUsers.find((x) => x.id === id);
    return u ? [u] : visibleUsers.filter((x) => x.id === currentUser.id);
  }, [escopo, visibleUsers, currentUser.id]);

  const escopoIds = useMemo(() => new Set(pessoasEscopo.map((u) => u.id)), [pessoasEscopo]);
  const multi = pessoasEscopo.length > 1;

  const rotuloEscopo =
    escopo === ESCOPO_TIME
      ? currentUser.role === "gerente"
        ? "todos os colaboradores"
        : "sua equipe"
      : escopo.startsWith("s:")
        ? `o setor ${sectors.find((s) => s.id === escopo.slice(2))?.name ?? ""}`
        : pessoasEscopo[0]?.id === currentUser.id
          ? "você"
          : nomeCurto(pessoasEscopo[0]?.name ?? "");

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const nomeDe = useCallback(
    (id: string) => {
      const u = userById.get(id);
      return u ? nomeCurto(u.name) : "—";
    },
    [userById],
  );
  const tarefaPorId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projetoPorId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  /* ---------------------------------------------------- sessões do servidor
     Uma busca ao abrir a tela. O cronômetro avisa ("fluxo:timer-updated")
     quando uma sessão termina — duas vezes, uma ao gravar no navegador e outra
     quando o servidor confirma —, então a nova busca espera o aviso assentar
     em vez de consultar o banco duas vezes seguidas. */
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    const aoAvisar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => setRecarga((v) => v + 1), 3000);
    };
    window.addEventListener("fluxo:timer-updated", aoAvisar);
    return () => {
      clearTimeout(espera);
      window.removeEventListener("fluxo:timer-updated", aoAvisar);
    };
  }, []);

  const [logs, setLogs] = useState<Record<string, Persisted>>({});
  const [carregandoTempo, setCarregandoTempo] = useState(true);
  const [erroTempo, setErroTempo] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const dados = await carregarTempoDoServidor();
        if (vivo) {
          setLogs(dados);
          setErroTempo(null);
        }
      } catch (e) {
        console.warn("[fluxo] tempo não carregou:", (e as Error)?.message);
        if (vivo) setErroTempo((e as Error)?.message || "erro desconhecido");
      } finally {
        if (vivo) setCarregandoTempo(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recarga]);

  /* ------------------------------------------------------------- janelas */
  const janela = useMemo(() => janelaDoPeriodo(periodo), [periodo]);
  const { baldes, granularidade } = useMemo(() => baldesDaJanela(janela), [janela]);

  /* ------------------------------------------------------------- sessões */
  const sessoesEscopo = useMemo(() => sessoesDoEscopo(logs, escopoIds), [logs, escopoIds]);
  const sessoesJanela = useMemo(
    () => sessoesEscopo.filter((s) => dentro(s.startedAt, janela)),
    [sessoesEscopo, janela],
  );
  const sessoesAnt = useMemo(
    () =>
      janela.anterior ? sessoesEscopo.filter((s) => dentro(s.startedAt, janela.anterior!)) : null,
    [sessoesEscopo, janela],
  );

  /* ------------------------------------------------------------ entregas */
  const entregasEscopo = useMemo(
    () =>
      avaliarEntregas(
        completions.filter((c) => escopoIds.has(c.userId)),
        tarefaPorId,
      ),
    [completions, escopoIds, tarefaPorId],
  );
  const entregasJanela = useMemo(
    () => entregasEscopo.filter((e) => dentro(e.at, janela)),
    [entregasEscopo, janela],
  );
  const entregasAnt = useMemo(
    () => (janela.anterior ? entregasEscopo.filter((e) => dentro(e.at, janela.anterior!)) : null),
    [entregasEscopo, janela],
  );
  const resumo = useMemo(() => resumirEntregas(entregasJanela), [entregasJanela]);
  const resumoAnt = useMemo(
    () => (entregasAnt ? resumirEntregas(entregasAnt) : null),
    [entregasAnt],
  );

  /* -------------------------------------------------------------- tarefas */
  /* Tarefa pertence a quem vai fazer: contar também as que a pessoa criou
     para outro inflaria a carga com trabalho que não é dela. */
  const tarefasEscopo = useMemo(
    () => tasks.filter((t) => escopoIds.has(t.assigneeId)),
    [tasks, escopoIds],
  );
  const abertas = useMemo(
    () => tarefasEscopo.filter((t) => t.status !== "concluida"),
    [tarefasEscopo],
  );
  const vencidas = useMemo(() => abertas.filter((t) => tarefaVencida(t)), [abertas]);

  /* ---------------------------------------------------------------- tempo */
  const segPorTarefa = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessoesEscopo) m.set(s.taskId, (m.get(s.taskId) ?? 0) + s.seconds);
    return m;
  }, [sessoesEscopo]);

  /** Tempo médio das tarefas concluídas no período que tiveram cronômetro (todo o tempo delas). */
  const tempoPorConcluida = useCallback(
    (es: { taskId: string }[]) => {
      const ids = [...new Set(es.map((e) => e.taskId))];
      const comTempo = ids.map((id) => segPorTarefa.get(id) ?? 0).filter((v) => v > 0);
      return {
        media: comTempo.length ? comTempo.reduce((a, b) => a + b, 0) / comTempo.length : null,
        comTempo: comTempo.length,
        total: ids.length,
      };
    },
    [segPorTarefa],
  );
  const medioAtual = useMemo(
    () => tempoPorConcluida(entregasJanela),
    [tempoPorConcluida, entregasJanela],
  );
  const medioAnt = useMemo(
    () => (entregasAnt ? tempoPorConcluida(entregasAnt) : null),
    [tempoPorConcluida, entregasAnt],
  );

  const totalTempo = somaSegundos(sessoesJanela);
  const totalTempoAnt = sessoesAnt ? somaSegundos(sessoesAnt) : null;
  const tarefasComTempo = new Set(sessoesJanela.map((s) => s.taskId)).size;

  /* -------------------------------------------------------------- achados */
  const achados = useMemo<Achado[]>(() => {
    const porTarefa = new Map<string, number>();
    for (const s of sessoesJanela)
      porTarefa.set(s.taskId, (porTarefa.get(s.taskId) ?? 0) + s.seconds);
    const tempoPorTarefa = [...porTarefa.entries()]
      .map(([id, seg]) => ({
        titulo: tarefaPorId.get(id)?.title ?? "tarefa arquivada",
        segundos: seg,
      }))
      .sort((a, b) => b.segundos - a.segundos);

    const porPessoa = new Map<string, number>();
    for (const t of vencidas) porPessoa.set(t.assigneeId, (porPessoa.get(t.assigneeId) ?? 0) + 1);
    const atrasadasPorPessoa = multi
      ? [...porPessoa.entries()]
          .map(([id, n]) => ({ nome: nomeDe(id), n }))
          .sort((a, b) => b.n - a.n)
      : [];

    let maisAntiga: { titulo: string; dias: number } | null = null;
    for (const t of abertas) {
      const dias = idadeEmDias(t);
      if (!maisAntiga || dias > maisAntiga.dias) maisAntiga = { titulo: t.title, dias };
    }

    const backlogInicio = tarefasEscopo.filter((t: Task) => {
      const criada = new Date(t.createdAt).getTime();
      if (criada >= janela.inicio) return false;
      const fim = t.completedAt ? new Date(t.completedAt).getTime() : null;
      return t.status !== "concluida" || (fim != null && fim >= janela.inicio);
    }).length;

    return gerarAchados({
      janela,
      entregas: resumo,
      entregasAnteriores: resumoAnt,
      listaEntregas: entregasJanela,
      criadasNoPeriodo: tarefasEscopo.filter((t) => dentro(new Date(t.createdAt).getTime(), janela))
        .length,
      backlogInicio,
      backlogAgora: abertas.length,
      tempoPorTarefa,
      calor: mapaDeCalor(sessoesJanela),
      atrasadasPorPessoa,
      maisAntiga,
    });
  }, [
    sessoesJanela,
    tarefaPorId,
    vencidas,
    multi,
    nomeDe,
    abertas,
    tarefasEscopo,
    janela,
    resumo,
    resumoAnt,
    entregasJanela,
  ]);

  /* -------------------------------------------------------------- exports
     Seguem o escopo E o período escolhidos — o arquivo é o que a tela mostra. */
  const sufixo = `${escopo.replace(":", "-")}-${periodo}-${new Date().toISOString().slice(0, 10)}`;

  const exportarSessoes = () => {
    const rows: SessionRow[] = [...sessoesJanela]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s) => {
        const t = tarefaPorId.get(s.taskId);
        const u = userById.get(s.userId);
        return {
          userName: u?.name ?? "—",
          userSector: u?.sector,
          taskId: s.taskId,
          taskTitle: t?.title ?? "(tarefa arquivada)",
          status: t ? statusLabels[t.status] : "",
          priority: t ? priorityLabels[t.priority] : "",
          estimatedMinutes: t?.estimatedMinutes,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          seconds: s.seconds,
        };
      });
    baixarXlsx(`fluxo-sessoes-${sufixo}`, [{ nome: "Sessões", linhas: linhasDeSessoes(rows) }]);
  };

  const exportarResumo = () => {
    const agg = new Map<
      string,
      {
        userId: string;
        taskId: string;
        seconds: number;
        sessions: number;
        firstAt: number;
        lastAt: number;
      }
    >();
    for (const s of sessoesJanela) {
      const k = `${s.userId}|${s.taskId}`;
      const cur = agg.get(k);
      if (!cur) {
        agg.set(k, {
          userId: s.userId,
          taskId: s.taskId,
          seconds: s.seconds,
          sessions: 1,
          firstAt: s.startedAt,
          lastAt: s.endedAt,
        });
      } else {
        cur.seconds += s.seconds;
        cur.sessions += 1;
        cur.firstAt = Math.min(cur.firstAt, s.startedAt);
        cur.lastAt = Math.max(cur.lastAt, s.endedAt);
      }
    }
    const rows: SummaryRow[] = [...agg.values()]
      .sort((a, b) => b.seconds - a.seconds)
      .map((r) => {
        const t = tarefaPorId.get(r.taskId);
        const u = userById.get(r.userId);
        return {
          userName: u?.name ?? "—",
          userSector: u?.sector,
          taskTitle: t?.title ?? "(tarefa arquivada)",
          status: t ? statusLabels[t.status] : "",
          priority: t ? priorityLabels[t.priority] : "",
          estimatedMinutes: t?.estimatedMinutes,
          totalSeconds: r.seconds,
          sessions: r.sessions,
          firstAt: r.firstAt,
          lastAt: r.lastAt,
        };
      });
    baixarXlsx(`fluxo-tempo-por-tarefa-${sufixo}`, [
      { nome: "Tempo por tarefa", linhas: linhasDeResumo(rows) },
    ]);
  };

  /* ------------------------------------------------------------- rótulos */
  const fmtDia = (ms: number) =>
    new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const comparacao = janela.anterior
    ? `Variações contra ${fmtDia(janela.anterior.inicio)}–${fmtDia(janela.anterior.fim - 1)}.`
    : "Sem comparação: o histórico guarda só 90 dias.";

  const tempoMedioVar: Variacao | null = (() => {
    const v = variacao(medioAtual.media, medioAnt?.media ?? null, "pct");
    // Mais tempo por tarefa não é bom nem ruim por si — só informa.
    return v ? { ...v, tom: "neutro" } : null;
  })();

  return (
    <FluxoLayout title="Relatórios">
      <div className="mx-auto w-full max-w-[2200px] space-y-5">
        {/* ------------------------------------------------ cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Entregas, prazos e tempo de <b className="text-foreground">{rotuloEscopo}</b>{" "}
              {janela.frase}. <span className="hidden sm:inline">{comparacao}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Período"
              className="flex rounded-lg border border-border bg-card p-0.5 shadow-sm"
            >
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={periodo === p.id}
                  onClick={() => setPeriodo(p.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    periodo === p.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
            {visibleUsers.length > 1 && (
              <select
                value={escopo}
                onChange={(e) => setEscopo(e.target.value)}
                aria-label="De quem"
                className="h-8 max-w-[240px] rounded-lg border border-border bg-card px-2 text-xs shadow-sm"
              >
                <option value={ESCOPO_TIME}>
                  {currentUser.role === "gerente" ? "Todos" : "Minha equipe"} ({visibleUsers.length}
                  )
                </option>
                {setoresVisiveis.length > 1 && (
                  <optgroup label="Setor">
                    {setoresVisiveis.map((s) => (
                      <option key={s.id} value={`s:${s.id}`}>
                        {s.name} ({visibleUsers.filter((u) => u.sector === s.id).length})
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Pessoa">
                  <option value={`p:${currentUser.id}`}>
                    {nomeCurto(currentUser.name)} (você)
                  </option>
                  {visibleUsers
                    .filter((u) => u.id !== currentUser.id)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((u) => (
                      <option key={u.id} value={`p:${u.id}`}>
                        {nomeCurto(u.name)}
                      </option>
                    ))}
                </optgroup>
              </select>
            )}
            <button
              type="button"
              onClick={exportarResumo}
              disabled={sessoesJanela.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium shadow-sm hover:bg-accent disabled:opacity-50"
              title="Planilha (Excel) do tempo consolidado por pessoa e tarefa, no escopo e período escolhidos"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Resumo
            </button>
            <button
              type="button"
              onClick={exportarSessoes}
              disabled={sessoesJanela.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              title="Planilha (Excel) de cada sessão, com início, fim e duração, no escopo e período escolhidos"
            >
              <Download className="h-3.5 w-3.5" /> Sessões
            </button>
          </div>
        </div>

        {/* ------------------------------------------------ achados */}
        {achados.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {achados.map((a) => (
              <CartaoAchado key={a.titulo} achado={a} />
            ))}
          </div>
        )}

        {/* ------------------------------------------------ indicadores */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <Indicador
            icone={CheckCircle2}
            rotulo="Concluídas"
            valor={String(resumo.total)}
            variacao={variacao(resumo.total, resumoAnt?.total ?? null, "pct")}
            detalhe={resumoAnt ? `${resumoAnt.total} no período anterior` : undefined}
          />
          <Indicador
            icone={Target}
            rotulo="No prazo"
            valor={resumo.pctNoPrazo == null ? "—" : `${Math.round(resumo.pctNoPrazo)}%`}
            variacao={variacao(resumo.pctNoPrazo, resumoAnt?.pctNoPrazo ?? null, "pp")}
            detalhe={
              resumo.total
                ? `${resumo.noPrazo} de ${resumo.total} no dia útil do prazo`
                : "Sem entregas"
            }
          />
          <Indicador
            icone={AlarmClock}
            rotulo="Atraso médio"
            valor={
              resumo.atrasoMedio == null
                ? "—"
                : `${resumo.atrasoMedio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d.u.`
            }
            variacao={variacao(resumo.atrasoMedio, resumoAnt?.atrasoMedio ?? null, "abs", false)}
            detalhe={
              resumo.atrasadas
                ? `Dias úteis, nas ${resumo.atrasadas} entregas atrasadas`
                : "Nenhuma entrega atrasada"
            }
          />
          <Indicador
            icone={Timer}
            rotulo="Tempo registrado"
            valor={carregandoTempo ? "…" : duracao(totalTempo)}
            variacao={carregandoTempo ? null : variacao(totalTempo, totalTempoAnt, "pct")}
            detalhe={
              carregandoTempo
                ? "Buscando sessões…"
                : `${sessoesJanela.length} ${sessoesJanela.length === 1 ? "sessão" : "sessões"} em ${tarefasComTempo} ${tarefasComTempo === 1 ? "tarefa" : "tarefas"}`
            }
          />
          <Indicador
            icone={Hourglass}
            rotulo="Tempo por concluída"
            valor={medioAtual.media == null ? "—" : duracao(medioAtual.media)}
            variacao={tempoMedioVar}
            detalhe={
              medioAtual.total
                ? `${medioAtual.comTempo} de ${medioAtual.total} concluídas tinham cronômetro`
                : "Sem entregas no período"
            }
          />
          <Indicador
            icone={Inbox}
            rotulo="Abertas agora"
            valor={String(abertas.length)}
            detalhe={
              vencidas.length ? (
                <span className="font-medium text-destructive">
                  {vencidas.length} {vencidas.length === 1 ? "vencida" : "vencidas"}
                </span>
              ) : (
                "Nenhuma vencida"
              )
            }
          />
        </div>

        {/* ------------------------------------------------ entregas */}
        <TituloDeBloco
          titulo="Entregas"
          descricao="Ritmo de conclusão, prazo e o que está acumulando."
        />
        <SecaoEntregas
          entregas={entregasJanela}
          baldes={baldes}
          granularidade={granularidade}
          tarefasEscopo={tarefasEscopo}
          multi={multi}
          nomeDe={nomeDe}
        />

        {/* ------------------------------------------------ tempo */}
        <TituloDeBloco
          titulo="Tempo"
          descricao="Do cronômetro (▶) das tarefas, de qualquer computador."
        />
        <SecaoTempo
          sessoes={sessoesJanela}
          baldes={baldes}
          granularidade={granularidade}
          multi={multi}
          nomeDe={nomeDe}
          tarefaPorId={tarefaPorId}
          projetoPorId={projetoPorId}
          carregando={carregandoTempo}
          erro={erroTempo}
        />

        {/* ------------------------------------------------ time */}
        {multi && (
          <>
            <TituloDeBloco
              titulo="Equipe"
              descricao={`${pessoasEscopo.length} pessoas no escopo.`}
            />
            <TabelaDoTime
              pessoas={pessoasEscopo}
              entregas={entregasJanela}
              tarefasEscopo={tarefasEscopo}
              sessoes={sessoesJanela}
              baldes={baldes}
              tasks={tasks}
              completions={completions}
              aoEscolher={(id) => {
                setEscopo(`p:${id}`);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </div>
    </FluxoLayout>
  );
}

const estiloDoAchado = {
  bom: { icone: TrendingUp, cor: "var(--color-success)" },
  ruim: { icone: TrendingDown, cor: "var(--color-destructive)" },
  neutro: { icone: Lightbulb, cor: "var(--color-primary)" },
} as const;

function CartaoAchado({ achado }: { achado: Achado }) {
  const { icone: Icone, cor } = estiloDoAchado[achado.tom];
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `color-mix(in oklab, ${cor} 15%, transparent)`, color: cor }}
      >
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-snug">{achado.titulo}</div>
        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {achado.detalhe}
        </div>
      </div>
    </div>
  );
}
