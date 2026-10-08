import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  NotebookPen,
  Plus,
  X,
  Construction,
  Maximize2,
  Minimize2,
  Scale,
  Siren,
  Square,
  Workflow,
} from "lucide-react";
import { CampoData } from "@/components/campo-data";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { forecastProject, type RiskLevel } from "@/lib/project-forecast";
import {
  priorityLabels,
  sectors,
  type CompletionEntry,
  type MeetingMinute,
  type MinuteTopic,
  type Project,
  type ProjectStatus,
  type Task,
  type User,
} from "@/lib/fluxo-types";
import { tarefaVencida } from "@/lib/prazo";
import { useFluxo } from "@/lib/fluxo-store";

/**
 * O FUP semanal — a "Reunião de Governança e Acompanhamento" da Priscila
 * (pedido de 07/10/2026), montado com o que o app já tem:
 *
 *   Status da semana   → o risco de cada projeto e o que concluiu no período
 *   Decisões           → tópicos "decisão" das atas do período
 *   Em construção      → projetos ativos e as próximas subtarefas deles
 *   Pontos de atenção  → tópicos "atenção" + subtarefas vencidas
 *   Pontos validados   → subtarefas concluídas no período
 *   Próximos 7 dias    → tópicos "próximo" + prazos da semana que vem
 *
 * O recorte é o setor do projeto ou projetos marcados à mão; o período começa
 * em "desde" (a última reunião), uma semana atrás por padrão. Nada é gravado:
 * a tela é uma leitura do que já está nas tarefas e nas atas.
 */

type Situacao = { rotulo: string; cor: string };

/** A bolinha de cada projeto, na linguagem do FUP impresso. */
function situacaoDo(project: Project, risco: RiskLevel): Situacao {
  if (project.status === "concluido" || risco === "concluido")
    return { rotulo: "Concluído", cor: "#2563eb" };
  if (project.status === "pausado") return { rotulo: "Pausado", cor: "#9ca3af" };
  if (risco === "atrasado") return { rotulo: "Atrasado", cor: "#dc2626" };
  if (risco === "parado") return { rotulo: "Parado", cor: "#ea580c" };
  if (risco === "atencao") return { rotulo: "Atenção", cor: "#ca8a04" };
  if (risco === "no_prazo") return { rotulo: "No prazo", cor: "#16a34a" };
  return { rotulo: "Em andamento", cor: "#eab308" };
}

const PESO_PRIORIDADE: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 };

const curta = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";

export function FupSemanal({
  projects,
  getTasks,
  completions,
  users,
  minutes,
  onOpenTask,
  onOpenProject,
}: {
  projects: Project[];
  getTasks: (projectId: string) => Task[];
  completions: CompletionEntry[];
  users: User[];
  minutes: MeetingMinute[];
  onOpenTask: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const hoje = new Date();
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return dataParaIso(d);
  });
  const [setor, setSetor] = useState<string>("todos");
  /** Projetos marcados à mão; vazio = todos os do setor. */
  const [marcados, setMarcados] = useState<string[]>([]);
  const [titulo, setTitulo] = useState("");
  const painelRef = useRef<HTMLDivElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  const {
    currentUser,
    saveMinute,
    addMinuteTopic,
    removeMinuteTopic,
    setMinuteMarkdown,
    minuteTopicToTask,
    updateProject,
  } = useFluxo();
  useEffect(() => {
    const aoMudar = () => setTelaCheia(document.fullscreenElement === painelRef.current);
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  const setoresComProjeto = useMemo(() => {
    const ids = new Set(projects.map((p) => p.sector).filter(Boolean));
    return sectors.filter((s) => ids.has(s.id));
  }, [projects]);

  const doSetor = useMemo(
    () =>
      projects.filter(
        (p) => p.status !== "concluido" && (setor === "todos" || p.sector === setor),
      ),
    [projects, setor],
  );
  const escolhidos = useMemo(
    () => (marcados.length ? doSetor.filter((p) => marcados.includes(p.id)) : doSetor),
    [doSetor, marcados],
  );

  const inicio = (isoParaData(desde) ?? hoje).getTime();
  const daquiA7 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 7, 23, 59).getTime();

  const dados = useMemo(() => {
    const status: {
      p: Project;
      sit: Situacao;
      concluidas: number;
      andamento: number;
      progresso: number;
    }[] = [];
    const construcao: { p: Project; proximas: Task[] }[] = [];
    const validados: { t: Task; p: Project }[] = [];
    const vencidas: { t: Task; p: Project }[] = [];
    const proximos: { t: Task; p: Project }[] = [];
    const pessoas = new Set<string>();
    const tarefasDoRecorte = new Set<string>();

    for (const p of escolhidos) {
      const tarefas = getTasks(p.id);
      const f = forecastProject(p, tarefas, completions, hoje);
      pessoas.add(p.ownerId);
      p.memberIds.forEach((m) => pessoas.add(m));
      let concluidas = 0;
      let andamento = 0;
      for (const t of tarefas) {
        tarefasDoRecorte.add(t.id);
        pessoas.add(t.assigneeId);
        const quando = t.completedAt ? new Date(t.completedAt).getTime() : null;
        if (t.status === "concluida" && quando !== null && quando >= inicio) {
          concluidas++;
          validados.push({ t, p });
        }
        if (t.status === "andamento") andamento++;
        if (t.status !== "concluida" && tarefaVencida(t, hoje.getTime())) vencidas.push({ t, p });
        else if (
          t.status !== "concluida" &&
          t.dueDate &&
          new Date(t.dueDate).getTime() <= daquiA7
        )
          proximos.push({ t, p });
      }
      status.push({ p, sit: situacaoDo(p, f.risk), concluidas, andamento, progresso: f.progressPct });
      if (p.status === "ativo") {
        const abertas = tarefas
          .filter((t) => t.status !== "concluida")
          .sort(
            (a, b) =>
              (PESO_PRIORIDADE[a.priority] ?? 9) - (PESO_PRIORIDADE[b.priority] ?? 9) ||
              (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"),
          );
        construcao.push({ p, proximas: abertas.slice(0, 3) });
      }
    }

    /* As atas do período que tocam o recorte: alguém do projeto estava na
       reunião, ou o tópico virou tarefa de um destes projetos. */
    const topicos: Record<MinuteTopic["kind"], { topico: MinuteTopic; ata: MeetingMinute }[]> = {
      decisao: [],
      atencao: [],
      proximo: [],
    };
    for (const ata of minutes) {
      if (new Date(ata.createdAt).getTime() < inicio) continue;
      const doRecorte = ata.participantIds.some((id) => pessoas.has(id));
      for (const tp of ata.topics) {
        if (doRecorte || (tp.taskId && tarefasDoRecorte.has(tp.taskId)))
          topicos[tp.kind].push({ topico: tp, ata });
      }
    }

    validados.sort((a, b) => (b.t.completedAt ?? "").localeCompare(a.t.completedAt ?? ""));
    proximos.sort((a, b) => (a.t.dueDate ?? "").localeCompare(b.t.dueDate ?? ""));
    return { status, construcao, validados, vencidas, proximos, topicos, pessoas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolhidos, getTasks, completions, minutes, inicio, daquiA7]);

  const nomeDoSetor = sectors.find((s) => s.id === setor)?.name;
  const tituloFinal = titulo.trim() || `FUP – ${nomeDoSetor ?? "Projetos"}`;
  const nome = (id: string) => users.find((u) => u.id === id)?.name.split(" ")[0] ?? "";

  /* A ata desta reunião: a do FUP deste recorte aberta hoje. O primeiro
     tópico escrito, ou a primeira anotação, cria a ata; os seguintes entram
     nela. Quem está nos projetos da pauta entra como participante — é o que
     dá a cada um o direito de ler a ata depois, em Atas & Planos. */
  const sala = `fup:${setor}`;
  const ataDeHoje = useMemo(() => {
    const hojeIso = dataParaIso(new Date());
    return (
      minutes
        .filter(
          (m) =>
            m.roomName === sala &&
            dataParaIso(new Date(m.createdAt)) === hojeIso &&
            (m.createdBy === currentUser.id || m.participantIds.includes(currentUser.id)),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }, [minutes, sala, currentUser.id]);

  const criarAta = (topicos: MinuteTopic[], markdown: string) => {
    const ids = [...new Set([currentUser.id, ...dados.pessoas])].filter((id) =>
      users.some((u) => u.id === id),
    );
    return saveMinute({
      roomName: sala,
      roomLabel: `${tituloFinal} · ${new Date().toLocaleDateString("pt-BR")}`,
      markdown,
      participantIds: ids,
      participantNames: ids.map((id) => users.find((u) => u.id === id)?.name ?? "").filter(Boolean),
      topics: topicos,
    });
  };

  const registrar = (kind: MinuteTopic["kind"], texto: string) => {
    if (!texto.trim()) return;
    if (ataDeHoje) addMinuteTopic(ataDeHoje.id, kind, texto);
    else criarAta([{ id: "", kind, text: texto.trim() }], "");
  };

  const [anotacoes, setAnotacoes] = useState<string | null>(null);
  const textoDaAta = anotacoes ?? ataDeHoje?.markdown ?? "";
  const salvarAnotacoes = () => {
    if (anotacoes === null || anotacoes === (ataDeHoje?.markdown ?? "")) return;
    if (ataDeHoje) setMinuteMarkdown(ataDeHoje.id, anotacoes);
    else if (anotacoes.trim()) criarAta([], anotacoes);
    setAnotacoes(null);
  };

  /** Um tópico de ata, com as ações: virar tarefa e apagar (só quem gerou a ata). */
  const acoesDoTopico = (topico: MinuteTopic, ata: MeetingMinute) => (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
      {topico.taskId ? (
        <button
          type="button"
          onClick={() => onOpenTask(topico.taskId!)}
          title="Abrir a tarefa"
          className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-semibold text-success hover:bg-secondary"
        >
          <Check className="h-3 w-3" /> tarefa
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            const id = minuteTopicToTask(ata.id, topico.id);
            if (id) onOpenTask(id);
          }}
          title="Transformar em tarefa"
          className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-semibold text-primary hover:bg-primary/10"
        >
          <ArrowRight className="h-3 w-3" /> tarefa
        </button>
      )}
      {ata.createdBy === currentUser.id && (
        <button
          type="button"
          onClick={() => removeMinuteTopic(ata.id, topico.id)}
          title="Apagar da ata"
          aria-label="Apagar da ata"
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );

  const alternarTelaCheia = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await painelRef.current?.requestFullscreen();
    } catch {
      /* sem tela cheia (Tauri antigo, permissão): o painel segue na página */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Recorte e período */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={tituloFinal}
          className="input w-56 py-1.5 text-sm"
          aria-label="Título da reunião"
        />
        <select
          value={setor}
          onChange={(e) => {
            setSetor(e.target.value);
            setMarcados([]);
          }}
          className="input w-auto py-1.5 text-sm"
          aria-label="Setor"
        >
          <option value="todos">Todos os setores</option>
          {setoresComProjeto.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" /> Desde a última reunião:
          <CampoData value={desde} onChange={(v) => v && setDesde(v)} limpavel={false} className="py-1 text-xs" />
        </span>
        <button
          type="button"
          onClick={alternarTelaCheia}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
        >
          {telaCheia ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {telaCheia ? "Sair da apresentação" : "Apresentar"}
        </button>
        {doSetor.length > 0 && (
          <div className="flex basis-full flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Projetos na pauta
            </span>
            {doSetor.map((p) => {
              const on = marcados.length === 0 || marcados.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setMarcados((m) => {
                      const base = m.length ? m : doSetor.map((x) => x.id);
                      const prox = base.includes(p.id) ? base.filter((x) => x !== p.id) : [...base, p.id];
                      return prox.length === doSetor.length ? [] : prox;
                    })
                  }
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground line-through opacity-60"
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* O painel — o que vai para a tela da reunião */}
      <div
        ref={painelRef}
        className="overflow-auto rounded-xl border-2 border-primary/70 bg-background p-3 [&:fullscreen]:p-6"
      >
        <div className="mb-3 flex items-center gap-4 rounded-lg bg-primary px-5 py-3 text-primary-foreground">
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-2xl font-semibold">{tituloFinal}</div>
            <div className="text-sm opacity-90">Reunião semanal de Governança e Acompanhamento</div>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-md bg-background px-3 py-2 text-lg font-semibold text-primary">
            <CalendarDays className="h-5 w-5" />
            {hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_1.6fr_1.1fr]">
          {/* Status da semana */}
          <Bloco titulo="Status da semana" icone={<Workflow className="h-4 w-4" />}>
            {dados.status.length === 0 && <Vazio>Nenhum projeto no recorte.</Vazio>}
            {dados.status.map(({ p, sit, concluidas, andamento, progresso }) => (
              <div key={p.id} className="group rounded-md px-1.5 py-1.5 hover:bg-secondary/60">
              <button
                type="button"
                onClick={() => onOpenProject(p.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-primary">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {progresso}% · {concluidas > 0 ? `+${concluidas} concluída${concluidas > 1 ? "s" : ""}` : "nada concluído"}
                    {andamento > 0 && ` · ${andamento} em andamento`}
                  </div>
                </div>
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-3.5 w-3.5 rounded-full shadow-inner" style={{ background: sit.cor }} />
                  {sit.rotulo}
                </span>
              </button>
              {/* Mexer no projeto sem sair da reunião: pausar o que parou de
                  vez, encerrar o que foi entregue. */}
              <select
                value={p.status}
                onChange={(e) => updateProject(p.id, { status: e.target.value as ProjectStatus })}
                aria-label={`Situação de ${p.name}`}
                className="mt-1 hidden rounded border border-border bg-background px-1 py-0.5 text-[10px] text-muted-foreground group-hover:block group-focus-within:block"
              >
                <option value="ativo">Em andamento</option>
                <option value="pausado">Pausado</option>
                <option value="concluido">Concluído</option>
              </select>
              </div>
            ))}
          </Bloco>

          {/* Decisões da semana */}
          <Bloco titulo="Decisões da semana" icone={<Scale className="h-4 w-4" />}>
            {dados.topicos.decisao.length === 0 && (
              <Vazio>Nenhuma decisão desde {curta(isoParaData(desde)?.toISOString())}. Escreva abaixo.</Vazio>
            )}
            {dados.topicos.decisao.map(({ topico, ata }, i) => (
              <div key={topico.id} className="group flex items-start gap-3 px-1.5 py-1.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-primary">{topico.text}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {ata.roomLabel} · {curta(ata.createdAt)}
                  </div>
                </div>
                {acoesDoTopico(topico, ata)}
              </div>
            ))}
            <Escrever placeholder="Escrever uma decisão…" aoEnviar={(t) => registrar("decisao", t)} />
          </Bloco>

          {/* Em construção */}
          <Bloco titulo="Em construção" icone={<Construction className="h-4 w-4" />}>
            {dados.construcao.length === 0 && <Vazio>Nenhum projeto ativo.</Vazio>}
            {dados.construcao.map(({ p, proximas }) => (
              <div key={p.id} className="px-1.5 py-1.5">
                <div className="text-sm font-semibold uppercase text-primary">{p.name}</div>
                {proximas.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">Sem subtarefa aberta.</div>
                ) : (
                  proximas.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="block w-full truncate text-left text-[12px] text-muted-foreground hover:text-foreground"
                      title={`${t.title} · ${priorityLabels[t.priority]}`}
                    >
                      {t.title}
                      {t.dueDate && <span className="opacity-70"> · {curta(t.dueDate)}</span>}
                    </button>
                  ))
                )}
              </div>
            ))}
          </Bloco>
        </div>

        {/* Faixa de baixo */}
        <div className="mt-3 grid gap-3 rounded-xl border-2 border-primary/40 p-3 md:grid-cols-3">
          <div>
            <Subtitulo icone={<Siren className="h-4 w-4" />} cor="text-orange-600">
              Pontos de atenção
            </Subtitulo>
            {dados.topicos.atencao.map(({ topico, ata }) => (
              <Linha key={topico.id} acoes={acoesDoTopico(topico, ata)}>
                {topico.text}
              </Linha>
            ))}
            {dados.vencidas.map(({ t, p }) => (
              <Linha key={t.id} onClick={() => onOpenTask(t.id)}>
                <span className="text-destructive">Vencida {curta(t.dueDate)}</span> · {t.title}{" "}
                <span className="opacity-60">({p.name})</span>
              </Linha>
            ))}
            {dados.topicos.atencao.length + dados.vencidas.length === 0 && (
              <Vazio>Nada pedindo atenção.</Vazio>
            )}
            <Escrever placeholder="Escrever um ponto de atenção…" aoEnviar={(t) => registrar("atencao", t)} />
          </div>
          <div className="md:border-x md:border-primary/30 md:px-3">
            <Subtitulo icone={<CheckCircle2 className="h-4 w-4" />}>Pontos validados</Subtitulo>
            {dados.validados.slice(0, 8).map(({ t, p }) => (
              <Linha key={t.id} onClick={() => onOpenTask(t.id)}>
                {t.title} <span className="opacity-60">· {nome(t.assigneeId)} · {p.name}</span>
              </Linha>
            ))}
            {dados.validados.length > 8 && (
              <div className="px-1 text-[11px] text-muted-foreground">+{dados.validados.length - 8} outras</div>
            )}
            {dados.validados.length === 0 && <Vazio>Nada concluído no período.</Vazio>}
          </div>
          <div>
            <Subtitulo icone={<CalendarDays className="h-4 w-4" />}>Próximos 7 dias</Subtitulo>
            {dados.topicos.proximo.map(({ topico, ata }) => (
              <Linha key={topico.id} marcador acoes={acoesDoTopico(topico, ata)}>
                {topico.text}
              </Linha>
            ))}
            {dados.proximos.map(({ t, p }) => (
              <Linha key={t.id} marcador onClick={() => onOpenTask(t.id)}>
                {t.title} <span className="opacity-60">· {curta(t.dueDate)} · {p.name}</span>
              </Linha>
            ))}
            {dados.topicos.proximo.length + dados.proximos.length === 0 && (
              <Vazio>Nada previsto para a semana.</Vazio>
            )}
            <Escrever placeholder="Escrever um próximo passo…" aoEnviar={(t) => registrar("proximo", t)} />
          </div>
        </div>

        {/* A ata escrita à mão: o que não é decisão, atenção nem próximo passo. */}
        <div className="mt-3 rounded-xl border border-primary/30 bg-card p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-primary">
            <NotebookPen className="h-4 w-4" /> Ata da reunião
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              {ataDeHoje
                ? `Gravada em Atas & Planos · ${ataDeHoje.topics.length} tópico${ataDeHoje.topics.length === 1 ? "" : "s"}`
                : "Nasce com o primeiro tópico ou anotação"}
            </span>
          </div>
          <textarea
            value={textoDaAta}
            onChange={(e) => setAnotacoes(e.target.value)}
            onBlur={salvarAnotacoes}
            rows={4}
            placeholder="Anotações livres da reunião — salvam ao sair do campo."
            className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>
  );
}

function Bloco({
  titulo,
  icone,
  children,
}: {
  titulo: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border-2 border-primary/50 bg-card">
      <h3 className="flex items-center gap-2 bg-primary px-3 py-2 text-sm font-semibold uppercase tracking-wide text-primary-foreground">
        {icone}
        {titulo}
      </h3>
      <div className="p-2">{children}</div>
    </section>
  );
}

function Subtitulo({
  icone,
  cor = "text-primary",
  children,
}: {
  icone: React.ReactNode;
  cor?: string;
  children: React.ReactNode;
}) {
  return (
    <h4 className={`mb-1 flex items-center justify-center gap-1.5 text-sm font-bold uppercase ${cor}`}>
      {icone}
      {children}
    </h4>
  );
}

function Linha({
  children,
  onClick,
  marcador = false,
  acoes,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  marcador?: boolean;
  acoes?: React.ReactNode;
}) {
  if (acoes) {
    return (
      <div className="group flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-[12px] text-foreground/90 hover:bg-secondary/60">
        {marcador && <Square className="mt-0.5 h-3 w-3 shrink-0" />}
        <span className="min-w-0">{children}</span>
        {acoes}
      </div>
    );
  }
  const conteudo = (
    <>
      {marcador && <Square className="mt-0.5 h-3 w-3 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </>
  );
  const classe = "flex w-full items-start gap-1.5 px-1 py-0.5 text-left text-[12px] text-foreground/90";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${classe} rounded hover:bg-secondary/60`}>
      {conteudo}
    </button>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-2 text-[11px] italic text-muted-foreground">{children}</p>;
}

/** Campo de uma linha que escreve um tópico na ata: Enter grava e limpa. */
function Escrever({ placeholder, aoEnviar }: { placeholder: string; aoEnviar: (texto: string) => void }) {
  const [texto, setTexto] = useState("");
  const enviar = () => {
    if (!texto.trim()) return;
    aoEnviar(texto);
    setTexto("");
  };
  return (
    <div className="mt-1 flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 focus-within:border-primary">
      <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            enviar();
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
