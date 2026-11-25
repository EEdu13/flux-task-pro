import { useEffect, useState } from "react";
import { Copy, ListChecks, Loader2, Repeat, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { useEscFecha } from "@/hooks/use-esc-fecha";
import { TravaScroll } from "@/components/trava-scroll";
import { CampoData } from "@/components/campo-data";
import { SeloDoProjeto } from "@/components/selo-do-projeto";
import { EditorDeRecorrencia, type ValorDeRecorrencia } from "@/components/editor-de-recorrencia";
import { useFluxo } from "@/lib/fluxo-store";
import { useProjetoDaTarefa } from "@/lib/projeto-da-tarefa";
import { ETIQUETA_DE_PROJETO, normalizarEtiqueta } from "@/lib/etiquetas-do-projeto";
import { dataParaIso } from "@/lib/data-iso";
import { HORARIO_VALIDO } from "@/lib/prazo";
import { descreverRecorrencia } from "@/lib/recorrencia";
import { formatHM, parseHM } from "@/lib/time-log";
import type { Task } from "@/lib/fluxo-types";

/*
 * "Clonar tarefa" (25/11/2026): refazer uma tarefa que já existe — o mesmo
 * trabalho, outra data — sem digitar tudo de novo. A janela vem preenchida com
 * a original e pede o que quase sempre muda (o prazo, que é obrigatório), deixa
 * revisar título, responsável e descrição, e pergunta sobre o que a original
 * tiver de específico: checklist, projeto, estimativa e recorrência.
 *
 * O clone é uma tarefa nova comum: nasce em "A fazer" e se edita como qualquer
 * outra. Substituiu o "Duplicar", que criava a cópia na hora com "(cópia)" no
 * título e perdia justamente esses quatro.
 *
 * Mora uma vez só na raiz (`PortaDoClonarTarefa`, em GlobaisDoApp) e é chamada
 * por evento — do botão no cartão, do botão direito e da Minha visão.
 */

const EVENTO_ABRIR = "fluxo:clonar-tarefa";

/** Abre a janela de clonar a tarefa, de qualquer lugar do app. */
export function abrirClonarTarefa(tarefa: Task): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Task>(EVENTO_ABRIR, { detail: tarefa }));
}

/** Montada uma vez, na raiz: escuta `abrirClonarTarefa` e mostra a janela. */
export function PortaDoClonarTarefa() {
  const [tarefa, setTarefa] = useState<Task | null>(null);
  useEffect(() => {
    const abrir = (e: Event) => setTarefa((e as CustomEvent<Task>).detail ?? null);
    window.addEventListener(EVENTO_ABRIR, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR, abrir);
  }, []);
  if (!tarefa) return null;
  return <ClonarTarefaDialog key={tarefa.id} tarefa={tarefa} aoFechar={() => setTarefa(null)} />;
}

/** "yyyy-MM-dd" de hoje + `dias`. */
function diaDaqui(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return dataParaIso(d);
}

/** Quantos dias até a próxima segunda — sempre para a frente, nunca hoje. */
function diasAteSegunda(): number {
  const dow = new Date().getDay();
  return (8 - dow) % 7 || 7;
}

const ATALHOS_DE_PRAZO = [
  { rotulo: "Hoje", dia: () => diaDaqui(0) },
  { rotulo: "Amanhã", dia: () => diaDaqui(1) },
  { rotulo: "Próxima segunda", dia: () => diaDaqui(diasAteSegunda()) },
];

/** A estimativa como o campo "Tempo estimado" da janela da tarefa mostra: "1:30". */
const paraHM = (min?: number) =>
  min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` : "";

/**
 * A regra da original, com o "repetir até" vencido já limpo: copiado como
 * estava, o clone nasceria com a série encerrada antes da primeira repetição.
 */
function recorrenciaDaOriginal(t: Task): { valor: ValorDeRecorrencia; ateVencido: boolean } {
  const ate = t.recurringUntil ? new Date(t.recurringUntil) : null;
  const ateVencido = !!ate && ate.getTime() < Date.now();
  return {
    ateVencido,
    valor: {
      recurring: t.recurring,
      frequency: t.frequency,
      recurringWeekdays: t.recurringWeekdays ?? [],
      recurringMonthDay: t.recurringMonthDay ?? null,
      recurringUntil: ate && !ateVencido ? dataParaIso(ate) : "",
    },
  };
}

function ClonarTarefaDialog({ tarefa, aoFechar }: { tarefa: Task; aoFechar: () => void }) {
  useEscFecha(true, aoFechar);
  const { createTask, openTask, currentUser, visibleUsersForAssign } = useFluxo();
  const pessoas = visibleUsersForAssign();
  const projeto = useProjetoDaTarefa(tarefa.projectId);

  const [titulo, setTitulo] = useState(tarefa.title);
  const [descricao, setDescricao] = useState(tarefa.description ?? "");
  const [responsavel, setResponsavel] = useState(tarefa.assigneeId);
  /* O prazo começa vazio de propósito: o da original quase sempre já passou, e
     herdá-lo calado faria o clone nascer atrasado. É a única coisa que a
     janela exige. A hora, ao contrário, costuma se repetir — vem preenchida. */
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState(
    tarefa.dueTime && HORARIO_VALIDO.test(tarefa.dueTime) ? tarefa.dueTime : "",
  );

  /* O checklist só vem na listagem como resumo (`checklistResumo`); os itens
     chegam quando alguém abre a tarefa (`satellitesLoaded`). Se ninguém abriu,
     busca aqui — `null` é "buscando", e o botão espera. */
  const precisaBuscar = !tarefa.satellitesLoaded && (tarefa.checklistResumo?.total ?? 0) > 0;
  const [itens, setItens] = useState<string[] | null>(
    precisaBuscar ? null : tarefa.checklist.map((i) => i.text),
  );
  const [falhouChecklist, setFalhouChecklist] = useState(false);
  useEffect(() => {
    if (!precisaBuscar) return;
    let vivo = true;
    void (async () => {
      try {
        const { carregarSatelites } = await import("@/lib/tarefa-satelites.functions");
        const s = await carregarSatelites({ data: { tarefaId: tarefa.id } });
        if (vivo) setItens(s.checklist.map((i) => i.text));
      } catch (e) {
        console.warn("[fluxo] checklist da original não veio:", (e as Error)?.message);
        if (vivo) {
          setFalhouChecklist(true);
          setItens([]);
        }
      }
    })();
    return () => {
      vivo = false;
    };
  }, [precisaBuscar, tarefa.id]);

  const temChecklist = precisaBuscar || tarefa.checklist.length > 0;
  const [levarChecklist, setLevarChecklist] = useState(true);
  const [manterProjeto, setManterProjeto] = useState(true);
  const [levarEstimativa, setLevarEstimativa] = useState(true);
  const [estimativa, setEstimativa] = useState(() => paraHM(tarefa.estimatedMinutes));
  const [{ valor: recInicial, ateVencido }] = useState(() => recorrenciaDaOriginal(tarefa));
  const [rec, setRec] = useState<ValorDeRecorrencia>(recInicial);
  const [criando, setCriando] = useState(false);

  const horaValida = HORARIO_VALIDO.test(hora) ? hora : "";
  const minutosEstimados = levarEstimativa ? parseHM(estimativa) : null;
  const estimativaInvalida = levarEstimativa && !!estimativa.trim() && minutosEstimados === null;
  const pode =
    titulo.trim().length > 0 && !!dia && itens !== null && !estimativaInvalida && !criando;

  /* Sem o projeto, saem junto as etiquetas que ele põe ("projeto" e o nome
     dele): ficariam dizendo que a tarefa é de um projeto que ela não tem. */
  const etiquetasDoProjeto = projeto
    ? new Set([ETIQUETA_DE_PROJETO, normalizarEtiqueta(projeto.name).toLowerCase()])
    : null;
  const tirarDoProjeto = !!tarefa.projectId && !manterProjeto;
  const etiquetas =
    tirarDoProjeto && etiquetasDoProjeto
      ? tarefa.tags.filter((e) => !etiquetasDoProjeto.has(e.replace(/^#+/, "").toLowerCase()))
      : tarefa.tags;

  const clonar = () => {
    if (!pode) return;
    setCriando(true);
    const repete = tarefa.recurring && rec.recurring;
    const id = createTask(
      {
        /* Campo a campo, nunca `...tarefa`: `availableFrom` e
           `previousOccurrenceId` fariam o servidor tratar o clone como
           ocorrência da série da original (que nasce depois, ou é descartada
           como repetida), e o resto — id, conclusão, pack, início no Gantt,
           anexos — é da original. */
        title: titulo.trim(),
        description: descricao.trim(),
        sector: tarefa.sector,
        // Quem clona é quem cria: o servidor também grava assim, pela sessão.
        createdBy: currentUser.id,
        assigneeId: responsavel,
        mentions: [...tarefa.mentions],
        frequency: repete ? rec.frequency : tarefa.frequency,
        status: "pendente",
        score: tarefa.score,
        // Sem horário, vence no fim do dia (23:59) — a regra da janela da tarefa.
        dueDate: new Date(`${dia}T${horaValida || "23:59"}:00`).toISOString(),
        dueTime: horaValida || null,
        recurring: repete,
        recurringUntil:
          repete && rec.recurringUntil
            ? new Date(`${rec.recurringUntil}T23:59:59`).toISOString()
            : null,
        // Só o que vale para a frequência escolhida, como na janela da tarefa.
        recurringWeekdays: repete && rec.frequency === "semanal" ? rec.recurringWeekdays : null,
        recurringMonthDay:
          repete && (rec.frequency === "mensal" || rec.frequency === "anual")
            ? rec.recurringMonthDay
            : null,
        priority: tarefa.priority,
        tags: [...etiquetas],
        requireProof: tarefa.requireProof,
        estimatedMinutes: minutosEstimados && minutosEstimados > 0 ? minutosEstimados : undefined,
        projectId: tirarDoProjeto ? undefined : tarefa.projectId,
        // Tudo desmarcado: é trabalho novo. O id é descartável — o servidor regrava a lista.
        checklist:
          levarChecklist && itens
            ? itens.map((text) => ({ id: crypto.randomUUID(), text, done: false }))
            : [],
      },
      { origem: `criou esta tarefa clonando "${tarefa.title}"`.slice(0, 500) },
    );
    toast.success("Tarefa clonada", {
      description: "Está em A fazer.",
      action: { label: "Editar", onClick: () => openTask(id) },
    });
    aoFechar();
  };

  /* O que vai junto sem perguntar — dito, para ninguém estranhar a menção
     avisada ou a etiqueta que apareceu. */
  const vaiJunto = ["setor", "prioridade"];
  if (etiquetas.length) vaiJunto.push("etiquetas");
  if (tarefa.mentions.length) {
    const n = tarefa.mentions.length;
    vaiJunto.push(
      n === 1 ? "1 menção (a pessoa é avisada)" : `${n} menções (as pessoas são avisadas)`,
    );
  }
  if (tarefa.requireProof) vaiJunto.push("exigência de comprovante");

  return (
    <div
      className="fixed inset-0 z-420 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Clonar tarefa"
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Copy className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Clonar tarefa</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              Uma tarefa nova em “A fazer”, com tudo de “{tarefa.title}”. Confira o que muda.
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {/* O prazo primeiro: é o que sempre muda, e o único obrigatório. */}
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Novo prazo
            </span>
            <div className="flex gap-2">
              <CampoData
                value={dia}
                onChange={setDia}
                formato="longo"
                placeholder="Escolha a data"
                aria-label="Data do novo prazo"
                className="min-w-0 flex-1 px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                aria-label="Horário do prazo"
                title="Horário (opcional). Sem ele, vence no fim do dia."
                className="input w-28 shrink-0 font-mono"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {ATALHOS_DE_PRAZO.map((a) => {
                const valor = a.dia();
                return (
                  <button
                    key={a.rotulo}
                    type="button"
                    onClick={() => setDia(valor)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                      dia === valor
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    {a.rotulo}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="clonar-titulo"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Título
            </label>
            <input
              id="clonar-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="input w-full"
            />
          </div>

          <div>
            <label
              htmlFor="clonar-responsavel"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Responsável
            </label>
            <select
              id="clonar-responsavel"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className="input w-full"
            >
              {pessoas.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.id === currentUser.id ? "(eu)" : ""}
                </option>
              ))}
            </select>
            {responsavel !== currentUser.id && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                A pessoa recebe o aviso de tarefa nova.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="clonar-descricao"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Descrição
            </label>
            <textarea
              id="clonar-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  clonar();
                }
              }}
              rows={4}
              placeholder="Sem descrição"
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* O que a original tem de específico: cada linha só aparece se ela
              tiver, e a pessoa decide se leva. */}
          {(temChecklist || tarefa.projectId || tarefa.estimatedMinutes || tarefa.recurring) && (
            <div className="space-y-3">
              <span className="block text-xs font-medium text-muted-foreground">
                Da original — escolha o que levar
              </span>

              {temChecklist && (
                <div className="rounded-md border border-border bg-secondary/40 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={levarChecklist}
                      onChange={(e) => setLevarChecklist(e.target.checked)}
                      disabled={itens === null || (falhouChecklist && !itens?.length)}
                    />
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    Levar o checklist
                    {itens !== null && itens.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        ({itens.length} {itens.length === 1 ? "item" : "itens"}, todos desmarcados)
                      </span>
                    )}
                  </label>
                  {itens === null ? (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Buscando o checklist…
                    </p>
                  ) : falhouChecklist ? (
                    <p className="mt-2 text-[11px] text-destructive">
                      Não deu para trazer o checklist. O clone sai sem ele — dá para montar depois,
                      no Editar.
                    </p>
                  ) : (
                    levarChecklist && (
                      <ul className="mt-2 space-y-0.5 pl-6 text-[12px] text-muted-foreground">
                        {itens.slice(0, 5).map((texto, i) => (
                          <li key={i} className="truncate">
                            ☐ {texto}
                          </li>
                        ))}
                        {itens.length > 5 && <li>+ {itens.length - 5} itens</li>}
                      </ul>
                    )
                  )}
                </div>
              )}

              {tarefa.projectId && (
                <div className="rounded-md border border-border bg-secondary/40 p-3">
                  <label className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={manterProjeto}
                      onChange={(e) => setManterProjeto(e.target.checked)}
                    />
                    Manter no projeto
                    <SeloDoProjeto projectId={tarefa.projectId} className="min-w-0" />
                  </label>
                </div>
              )}

              {!!tarefa.estimatedMinutes && (
                <div className="rounded-md border border-border bg-secondary/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={levarEstimativa}
                        onChange={(e) => setLevarEstimativa(e.target.checked)}
                      />
                      <Timer className="h-4 w-4 text-muted-foreground" />
                      Levar a estimativa
                    </label>
                    <input
                      value={estimativa}
                      onChange={(e) => setEstimativa(e.target.value)}
                      disabled={!levarEstimativa}
                      placeholder="Ex.: 00:30, 1:15, 45m"
                      aria-label="Tempo estimado (hh:mm)"
                      className="input w-28 py-1 font-mono text-xs disabled:opacity-60"
                    />
                    {levarEstimativa && minutosEstimados !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        = {formatHM(minutosEstimados * 60)}
                      </span>
                    )}
                    {estimativaInvalida && (
                      <span className="text-[11px] text-destructive">Formato não reconhecido.</span>
                    )}
                  </div>
                </div>
              )}

              {tarefa.recurring && (
                <div className="space-y-2">
                  <p className="flex items-start gap-1.5 rounded-md bg-sky-500/[0.07] px-2.5 py-1.5 text-[11px] text-sky-700 dark:text-sky-300">
                    <Repeat className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span>
                      A original repete (
                      {descreverRecorrencia({
                        ...recInicial,
                        dueDate: tarefa.dueDate ?? undefined,
                      }).toLowerCase()}
                      ). O clone vai repetir igual — ajuste abaixo ou remova a recorrência.
                      {ateVencido && " O “repetir até” dela já passou, então veio sem limite."}
                    </span>
                  </p>
                  <EditorDeRecorrencia
                    valor={rec}
                    prazo={dia}
                    aoMudar={(p) => setRec((r) => ({ ...r, ...p }))}
                    aoMudarPrazo={setDia}
                    comFrequencia
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-0.5 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Vai junto:</span> {vaiJunto.join(", ")}.
            </p>
            <p>
              <span className="font-medium text-foreground">Fica só na original:</span> comentários,
              anexos, histórico, tempo registrado e reações.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <span className="text-[11px] text-muted-foreground">
            {!titulo.trim()
              ? "Dê um título."
              : !dia
                ? "Escolha o novo prazo."
                : itens === null
                  ? "Buscando o checklist…"
                  : estimativaInvalida
                    ? "Confira a estimativa."
                    : "Nasce em “A fazer”."}
          </span>
          <button
            type="button"
            onClick={clonar}
            disabled={!pode}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Clonar tarefa
          </button>
        </div>
      </div>
    </div>
  );
}
