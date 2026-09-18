import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Paperclip, X, FileText, UploadCloud, ShieldCheck, Search, Check, ListPlus } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { type Status, type Priority, type Frequency } from "@/lib/fluxo-types";
import type { Attachment, ChecklistItem } from "@/lib/fluxo-types";
import {
  DIAS_SEMANA,
  MESES,
  ULTIMO_DIA_DO_MES,
  ULTIMO_DIA_UTIL,
  descreverRecorrencia,
  primeiraDataDaRegra,
} from "@/lib/recorrencia";
import { filesToAttachments, formatBytes, isImage, openAttachment } from "@/lib/attachments";
import { CampoData } from "@/components/campo-data";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { parseHM } from "@/lib/time-log";
import { parseExcelPaste, type ParsedPasteRow } from "@/lib/excel-paste";
import { UserAvatar } from "@/components/user-avatar";
import { iniciaisDoNome } from "@/integrations/iam/types";
import { ATALHOS_GRADE } from "@/lib/grade-atalhos";
import { toast } from "sonner";
import { TravaScroll } from "@/components/trava-scroll";

/** Chave da dica de primeira vez (responsável × @). */
const DICA_KEY = "fluxo.grade.dica-mencao";

/** Chave da dica do expansor (checklist, repetição, tags). */
const DICA_EXTRAS_KEY = "fluxo.grade.dica-extras";

/**
 * Rótulo dos grupos da faixa de controles.
 * Em /45 sumia no tema escuro — o rótulo só serve se der para ler de relance.
 */
const ROTULO = "text-[10px] font-bold uppercase tracking-wide text-foreground/75";

/** "REGINALDO MARCOS GONCALVES JUNIOR" → "Reginaldo Junior". */
function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const cap = (p: string) => p[0]!.toUpperCase() + p.slice(1).toLowerCase();
  if (partes.length === 1) return cap(partes[0]!);
  return `${cap(partes[0]!)} ${cap(partes[partes.length - 1]!)}`;
}

/**
 * Responsável com foto e lista própria.
 *
 * O <select> nativo mostrava o nome cru em CAIXA ALTA e, ao abrir, entregava o
 * popup do sistema operacional — caixa cinza sem foto, destoando de todo o resto
 * do app. Aqui a lista é nossa: mesma linguagem do menu de menção logo acima
 * (portal, bg-popover, foto + nome), com busca quando o time é grande.
 */
function SeletorResponsavel({
  valor,
  pessoas,
  aoMudar,
}: {
  valor: string;
  pessoas: { id: string; name: string; jobTitle?: string }[];
  aoMudar: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const atual = pessoas.find((p) => p.id === valor);
  const nome = atual?.name ?? "";
  const comBusca = pessoas.length > 6;

  const alvo = busca.trim().toLowerCase();
  const filtradas = alvo ? pessoas.filter((p) => p.name.toLowerCase().includes(alvo)) : pessoas;

  const abrir = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const largura = Math.max(r.width, 260);
      const altura = Math.min(320, 56 + pessoas.length * 44);
      // Vira para cima quando não cabe abaixo — a grade fica no meio da tela e
      // as últimas linhas abririam para fora da janela.
      const paraCima = r.bottom + altura > window.innerHeight && r.top > altura;
      setPos({
        top: paraCima ? r.top - altura - 4 : r.bottom + 4,
        left: Math.min(r.left, window.innerWidth - largura - 8),
        width: largura,
      });
    }
    setBusca("");
    setAtivo(Math.max(0, pessoas.findIndex((p) => p.id === valor)));
    setAberto(true);
  };

  useEffect(() => {
    if (!aberto) return;
    const foraDaqui = (e: MouseEvent) => {
      const t = e.target as Node;
      if (painelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setAberto(false);
    };
    const fechar = () => setAberto(false);
    document.addEventListener("mousedown", foraDaqui);
    // O modal da grade rola; sem isto o painel ficaria flutuando fora do campo.
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", foraDaqui);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const escolher = (id: string) => {
    aoMudar(id);
    setAberto(false);
    btnRef.current?.focus();
  };

  const naTecla = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setAberto(false);
      btnRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((i) => Math.min(i + 1, filtradas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = filtradas[ativo];
      if (p) escolher(p.id);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={(e) => {
          if (!aberto && (e.key === "ArrowDown" || e.key === "Enter")) {
            e.preventDefault();
            abrir();
          }
        }}
        title={nome || "Escolher responsável"}
        aria-label="Responsável"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={`inline-flex h-6 items-center gap-1.5 rounded-md border bg-background py-0.5 pl-0.5 pr-1.5 text-[11px] font-medium text-foreground transition ${
          aberto ? "border-primary ring-1 ring-primary/20" : "border-foreground/30 hover:border-primary/60"
        }`}
      >
        <UserAvatar
          nome={nome}
          iniciais={nome ? iniciaisDoNome(nome) : "?"}
          className="h-5 w-5 text-[8px]"
        />
        <span className="max-w-[130px] truncate">{nome ? nomeCurto(nome) : "Escolher…"}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-foreground/60 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      {aberto && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={painelRef}
            role="listbox"
            onKeyDown={naTecla}
            className="fixed z-[200] flex max-h-80 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {comBusca && (
              <div className="border-b border-border p-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={busca}
                    onChange={(e) => {
                      setBusca(e.target.value);
                      setAtivo(0);
                    }}
                    placeholder="Buscar pessoa…"
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-1">
              {filtradas.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Ninguém encontrado.
                </div>
              )}
              {filtradas.map((p, i) => {
                const sel = p.id === valor;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onClick={() => escolher(p.id)}
                    onMouseEnter={() => setAtivo(i)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                      i === ativo ? "bg-secondary" : ""
                    }`}
                  >
                    <UserAvatar
                      nome={p.name}
                      iniciais={iniciaisDoNome(p.name)}
                      className="h-7 w-7 text-[10px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {nomeCurto(p.name)}
                      </span>
                      {p.jobTitle && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {p.jobTitle}
                        </span>
                      )}
                    </span>
                    {sel && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

interface DraftRow {
  id: string;
  title: string;
  description: string;
  dueDate: string; // yyyy-mm-dd
  assigneeId: string;
  sector: string;
  attachments: Attachment[];
  mentions: string[];
  requireProof: boolean;
  /** Estimated time as user-typed hh:mm string (empty = none) */
  estimateHM: string;
  /* Campos que a grade fixava em silêncio. Prioridade nascia sempre "media" e
     recorrência sempre desligada, sem a pessoa poder escolher — a grade era o
     único jeito de criar em massa e o único que não deixava definir isso. */
  priority: Priority;
  recurring: boolean;
  frequency: Frequency;
  recurringWeekdays: number[];
  recurringMonthDay: number | null;
  checklist: ChecklistItem[];
  tags: string;
}

const rid = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function todayStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function makeDraft(defaults: Partial<DraftRow>): DraftRow {
  return {
    id: rid(),
    title: "",
    description: "",
    dueDate: defaults.dueDate ?? todayStr(),
    assigneeId: defaults.assigneeId ?? "",
    sector: defaults.sector ?? "",
    attachments: [],
    mentions: [],
    requireProof: false,
    estimateHM: "",
    priority: defaults.priority ?? "media",
    recurring: false,
    frequency: "diaria",
    recurringWeekdays: [],
    recurringMonthDay: null,
    checklist: [],
    tags: "",
  };
}

/** Cor e rótulo de cada prioridade nos botões da faixa. */
const PRIORIDADES: { id: Priority; label: string; curto: string; cor: string; texto: string }[] = [
  { id: "alta", label: "Alta", curto: "Alta", cor: "text-destructive border-destructive/50 bg-destructive/10", texto: "text-destructive" },
  { id: "media", label: "Média", curto: "Média", cor: "text-warning border-warning/50 bg-warning/10", texto: "text-warning" },
  { id: "baixa", label: "Baixa", curto: "Baixa", cor: "text-primary border-primary/50 bg-primary/10", texto: "text-primary" },
];

/* Peças da tabela. A célula é o próprio campo, sem borda própria: quem
   desenha a grade é a tabela, e o foco aparece como um contorno por dentro da
   célula — o jeito de planilha de mostrar onde o cursor está. */
const TH =
  "border-b border-r border-foreground/25 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground/80 last:border-r-0";
const TD = "border-b border-r border-foreground/15 align-middle last:border-r-0";
const CELULA =
  "block h-9 w-full min-w-0 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-foreground/45 focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-primary";

export function InlineTaskCreator({
  defaultStatus = "pendente",
  compact = false,
  defaultDueDate,
  defaultAssigneeId,
  emPagina = false,
}: {
  defaultStatus?: Status;
  compact?: boolean;
  defaultDueDate?: string;
  defaultAssigneeId?: string;
  /** Na aba dedicada a grade é a própria página: não recolhe. */
  emPagina?: boolean;
}) {
  const { currentUser, visibleUsersForAssign, createTask, quickCreate, closeQuickCreate } = useFluxo();
  const assignees = visibleUsersForAssign();
  const [open, setOpen] = useState(true);
  /* Recolher a grade só faz sentido dentro do modal, onde ela divide espaço
     com o resto. Na aba dedicada, recolher deixaria a página vazia. */
  const aberto = emPagina || open;
  /* Só na aba: as duas dicas e os atalhos ficam atrás de "como funciona".
     Começa fechado e não grava preferência — abrir custa um clique, e não
     ter as faixas ali todo dia vale mais do que lembrar de quem dispensou. */
  const [comoFunciona, setComoFunciona] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>(() => [
    makeDraft({
      assigneeId: defaultAssigneeId ?? currentUser.id,
      sector: currentUser.sector,
      dueDate: defaultDueDate,
    }),
  ]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const descRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [cardDrag, setCardDrag] = useState(false);
  /** Uma linha por vez com o painel de extras aberto; senão a grade vira parede. */
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [novoPasso, setNovoPasso] = useState<Record<string, string>>({});
  // Dica de primeira vez: "responsável" e "@" associam pessoas à tarefa com
  // sentidos diferentes, e nada na tela contava isso. Some depois de dispensada.
  const [dicaAberta, setDicaAberta] = useState(false);
  useEffect(() => {
    try {
      setDicaAberta(localStorage.getItem(DICA_KEY) !== "1");
    } catch {
      setDicaAberta(true);
    }
  }, []);
  const dispensarDica = () => {
    setDicaAberta(false);
    try {
      localStorage.setItem(DICA_KEY, "1");
    } catch {
      /* sem localStorage a dica volta na próxima; aceitável */
    }
  };
  // Chave própria: quem já entendeu o @ não precisa reaprender o expansor, e
  // vice-versa. Dispensar uma não some com a outra.
  const [dicaExtrasAberta, setDicaExtrasAberta] = useState(false);
  useEffect(() => {
    try {
      setDicaExtrasAberta(localStorage.getItem(DICA_EXTRAS_KEY) !== "1");
    } catch {
      setDicaExtrasAberta(true);
    }
  }, []);
  const dispensarDicaExtras = () => {
    setDicaExtrasAberta(false);
    try {
      localStorage.setItem(DICA_EXTRAS_KEY, "1");
    } catch {
      /* idem */
    }
  };
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRowId = useRef<string | null>(null);
  const [mention, setMention] = useState<{
    rowId: string;
    query: string;
    startIndex: number;
    selectedIndex: number;
    rect: { top: number; left: number; width: number };
  } | null>(null);

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      inputRefs.current[id]?.focus();
    });
  };

  const parseMention = (title: string, cursor: number): { query: string; startIndex: number } | null => {
    const before = title.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at === -1) return null;
    if (before.slice(at + 1).includes(" ")) return null;
    if (at > 0 && /\w/.test(title[at - 1])) return null;
    return { query: title.slice(at + 1, cursor), startIndex: at };
  };

  const applyMention = (rowId: string, userId: string, userName: string) => {
    if (!mention) return;
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== rowId) return r;
        const before = r.title.slice(0, mention.startIndex);
        const after = r.title.slice(mention.startIndex + mention.query.length + 1);
        const newTitle = `${before}@${userName} ${after}`;
        const mentions = r.mentions.includes(userId) ? r.mentions : [...r.mentions, userId];
        return { ...r, title: newTitle, mentions };
      }),
    );
    setMention(null);
    focusRow(rowId);
  };

  const addRow = (afterId?: string) => {
    // Herda o responsável/setor/prazo da linha de origem, para que delegar
    // várias tarefas para a mesma pessoa não jogue as seguintes de volta pra mim.
    const source = afterId ? rows.find((r) => r.id === afterId) : rows[rows.length - 1];
    const draft = makeDraft({
      assigneeId: source?.assigneeId || defaultAssigneeId || currentUser.id,
      sector: source?.sector || currentUser.sector,
      dueDate: source?.dueDate,
    });
    setRows((rs) => {
      if (!afterId) return [...rs, draft];
      const idx = rs.findIndex((r) => r.id === afterId);
      const copy = [...rs];
      copy.splice(idx + 1, 0, draft);
      return copy;
    });
    focusRow(draft.id);
    return draft.id;
  };

  const commitRow = (row: DraftRow): boolean => {
    if (!row.title.trim()) return false;
    // isoParaData e não new Date(iso): "2026-08-31" sozinho é lido como
    // meia-noite UTC, que no Brasil (UTC−3) cai às 21h do dia 30 — o
    // setHours abaixo então marcava o prazo para 30/08 23:59, um dia antes
    // do que a pessoa escolheu.
    const due = isoParaData(row.dueDate) ?? isoParaData(todayStr()) ?? new Date();
    due.setHours(23, 59, 0, 0);
    const est = parseHM(row.estimateHM);
    createTask({
      title: row.title.trim(),
      description: row.description.trim() || undefined,
      sector: row.sector || currentUser.sector,
      createdBy: currentUser.id,
      assigneeId: row.assigneeId || currentUser.id,
      mentions: row.mentions,
      frequency: row.frequency,
      status: defaultStatus,
      score: 10,
      dueDate: due.toISOString(),
      recurring: row.recurring,
      // Só o campo da frequência escolhida: trocar de semanal para mensal não
      // pode deixar dias da semana órfãos decidindo a série.
      recurringWeekdays:
        row.recurring && row.frequency === "semanal" ? row.recurringWeekdays : null,
      recurringMonthDay:
        row.recurring && (row.frequency === "mensal" || row.frequency === "anual")
          ? row.recurringMonthDay
          : null,
      priority: row.priority,
      tags: row.tags.split(",").map((t) => t.trim()).filter(Boolean),
      checklist: row.checklist.length ? row.checklist : undefined,
      attachments: row.attachments.length ? row.attachments : undefined,
      requireProof: row.requireProof || undefined,
      estimatedMinutes: est && est > 0 ? est : undefined,
    });
    return true;
  };

  const jumpNext = (rowId: string) => {
    const idx = rows.findIndex((r) => r.id === rowId);
    const current = rows[idx];
    if (!current || !current.title.trim()) {
      // não cria linha em branco; foca a próxima existente se houver
      const nxt = rows[idx + 1];
      if (nxt) focusRow(nxt.id);
      return;
    }
    const nxt = rows[idx + 1];
    if (nxt) {
      focusRow(nxt.id);
    } else {
      addRow(rowId);
    }
  };

  const validRows = rows.filter((r) => r.title.trim());

  /* `sticky` no <tr> não funciona com border-collapse: quem gruda é cada <th>,
     e por isso o fundo e a linha de baixo precisam ir neles também — a borda
     da célula não é repintada enquanto ela está colada. O 4rem é a altura do
     cabeçalho da aba (h-16), que fica logo acima. */
  const cabecalhoGrudento = emPagina
    ? "[&>th]:sticky [&>th]:top-[calc(var(--topo)+4rem)] [&>th]:z-10 [&>th]:bg-secondary [&>th]:shadow-[inset_0_-1px_0_var(--border)]"
    : "";

  /** Quantas linhas já têm título — o mesmo selo nos dois cabeçalhos. */
  const seloProntas =
    validRows.length > 0 ? (
      <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
        {validRows.length} pronta{validRows.length > 1 ? "s" : ""}
      </span>
    ) : null;

  const requestSubmitAll = () => {
    if (validRows.length === 0) {
      toast.error("Preencha ao menos um título");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmSubmitAll = () => {
    const valid = rows.filter((r) => r.title.trim());
    valid.forEach(commitRow);
    toast.success(
      `${valid.length} tarefa${valid.length > 1 ? "s" : ""} criada${valid.length > 1 ? "s" : ""}`,
    );
    setRows([makeDraft({ assigneeId: defaultAssigneeId ?? currentUser.id, sector: currentUser.sector })]);
    setConfirmOpen(false);
  };

  const remove = (id: string) => {
    setRows((rs) => (rs.length === 1 ? [makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector })] : rs.filter((r) => r.id !== id)));
  };

  const handleEscape = () => {
    if (!quickCreate.open) return;
    if (confirmOpen || discardOpen) return;
    if (mention) {
      setMention(null);
      return;
    }
    const hasContent = rows.some((r) => r.title.trim() || r.description.trim() || r.attachments.length > 0);
    if (hasContent) {
      setDiscardOpen(true);
    } else {
      closeQuickCreate();
    }
  };

  useEffect(() => {
    if (!quickCreate.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      handleEscape();
    };
    window.addEventListener("keydown", onKey, true);
    const onCustom = () => handleEscape();
    window.addEventListener("fluxo:quickcreate-esc", onCustom as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("fluxo:quickcreate-esc", onCustom as EventListener);
    };
  });

  const saveAndClose = () => {
    const valid = rows.filter((r) => r.title.trim());
    if (valid.length === 0) {
      setDiscardOpen(false);
      closeQuickCreate();
      return;
    }
    valid.forEach(commitRow);
    toast.success(
      `${valid.length} tarefa${valid.length > 1 ? "s" : ""} criada${valid.length > 1 ? "s" : ""}`,
    );
    setDiscardOpen(false);
    closeQuickCreate();
  };

  const discardAndClose = () => {
    setDiscardOpen(false);
    closeQuickCreate();
  };

  const update = (id: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const adicionarPasso = (rowId: string) => {
    const texto = (novoPasso[rowId] ?? "").trim();
    if (!texto) return;
    setRows((rs) =>
      rs.map((r) =>
        r.id === rowId
          ? {
              ...r,
              checklist: [
                ...r.checklist,
                { id: `${rowId}-c${r.checklist.length}-${Date.now().toString(36)}`, text: texto, done: false },
              ],
            }
          : r,
      ),
    );
    setNovoPasso((n) => ({ ...n, [rowId]: "" }));
  };

  /**
   * Resumo do que está preenchido atrás do expansor.
   * Sem isso, uma linha com checklist e recorrência definidos fica visualmente
   * idêntica a uma linha vazia depois de fechado o painel.
   */
  const resumoExtras = (r: DraftRow): string => {
    const partes: string[] = [];
    if (r.checklist.length > 0) partes.push(`${r.checklist.length} passo${r.checklist.length > 1 ? "s" : ""}`);
    if (r.recurring) partes.push("repete");
    const tags = r.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) partes.push(`${tags.length} tag${tags.length > 1 ? "s" : ""}`);
    return partes.join(" · ");
  };

  const applyParsedRows = (parsed: ParsedPasteRow[], anchorRowId?: string) => {
    if (parsed.length === 0) {
      toast.error("Nada para importar — cole ao menos uma linha com título");
      return 0;
    }
    setRows((rs) => {
      const idx = anchorRowId ? rs.findIndex((r) => r.id === anchorRowId) : -1;
      const drafts: DraftRow[] = parsed.map((p) =>
        makeDraft({
          assigneeId: p.assigneeId ?? defaultAssigneeId ?? currentUser.id,
          sector: p.sector ?? currentUser.sector,
          dueDate: p.dueDate ?? defaultDueDate ?? todayStr(),
        }),
      );
      // fill titles / estimates
      parsed.forEach((p, i) => {
        drafts[i].title = p.title;
        if (p.estimateHM) drafts[i].estimateHM = p.estimateHM;
      });
      // Replace anchor row if it's still empty, otherwise insert after it
      if (idx >= 0) {
        const anchor = rs[idx];
        const copy = [...rs];
        if (!anchor.title.trim() && drafts.length > 0) {
          copy.splice(idx, 1, ...drafts);
        } else {
          copy.splice(idx + 1, 0, ...drafts);
        }
        return copy;
      }
      // no anchor: replace trailing empty row if exists
      const last = rs[rs.length - 1];
      if (last && !last.title.trim()) {
        return [...rs.slice(0, -1), ...drafts, makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector })];
      }
      return [...rs, ...drafts];
    });
    return parsed.length;
  };

  const handleTitlePaste = (rowId: string, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    if (!text.includes("\n") && !text.includes("\t")) return; // normal paste
    e.preventDefault();
    const parsed = parseExcelPaste(text, assignees);
    const n = applyParsedRows(parsed, rowId);
    if (n > 0) toast.success(`${n} linha${n > 1 ? "s" : ""} importada${n > 1 ? "s" : ""} da planilha`);
  };

  const addFilesToRow = async (rowId: string, files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const { ok, rejected } = await filesToAttachments(list, currentUser.id);
    if (rejected.length) {
      toast.error(`Ignorado(s): ${rejected.join(", ")}`);
    }
    if (!ok.length) return;
    setRows((rs) =>
      rs.map((r) => (r.id === rowId ? { ...r, attachments: [...r.attachments, ...ok] } : r)),
    );
    toast.success(`${ok.length} anexo${ok.length > 1 ? "s" : ""} adicionado${ok.length > 1 ? "s" : ""}`);
  };

  const handleCardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setCardDrag(false);
    setDragRowId(null);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    // pick the last row with a title, otherwise the last row (or a new one)
    let target = [...rows].reverse().find((r) => r.title.trim());
    if (!target) target = rows[rows.length - 1];
    if (!target) {
      const draft = makeDraft({ assigneeId: currentUser.id, sector: currentUser.sector });
      setRows((rs) => [...rs, draft]);
      target = draft;
    }
    await addFilesToRow(target.id, files);
  };

  const removeAttachment = (rowId: string, attId: string) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === rowId ? { ...r, attachments: r.attachments.filter((a) => a.id !== attId) } : r,
      ),
    );

  const openFilePicker = (rowId: string) => {
    pendingFileRowId.current = rowId;
    fileInputRef.current?.click();
  };

  /* As peças de cada linha moram aqui, fora do JSX principal, porque a mesma
     peça aparece na célula e no painel de extras que abre embaixo. São funções
     que devolvem JSX, e não componentes: um componente declarado dentro deste
     seria um tipo novo a cada render, e o React remontaria o campo — o cursor
     sairia do título a cada letra digitada. */

  const mesDoPrazo = (row: DraftRow) => (isoParaData(row.dueDate) ?? new Date()).getMonth();
  const diaDoPrazo = (row: DraftRow) => (isoParaData(row.dueDate) ?? new Date()).getDate();

  /** O prazo da primeira tarefa passa a seguir a regra de dia/mês escolhida. */
  const prazoPelaRegra = (frequencia: Frequency, dia: number | null, mes: number, row: DraftRow) =>
    frequencia === "mensal" || frequencia === "anual"
      ? dataParaIso(primeiraDataDaRegra(frequencia, dia ?? diaDoPrazo(row), mes))
      : row.dueDate;

  const campoTitulo = (row: DraftRow, idx: number, className: string) => (
    <>
      <input
        ref={(el) => {
          inputRefs.current[row.id] = el;
        }}
        value={row.title}
        onChange={(e) => {
          update(row.id, { title: e.target.value });
          const cursor = e.currentTarget.selectionStart ?? e.target.value.length;
          const m = parseMention(e.target.value, cursor);
          if (m) {
            const r = e.currentTarget.getBoundingClientRect();
            setMention({
              rowId: row.id,
              query: m.query,
              startIndex: m.startIndex,
              selectedIndex: 0,
              rect: { top: r.bottom, left: r.left, width: Math.max(r.width, 224) },
            });
          } else {
            setMention((cur) => (cur?.rowId === row.id ? null : cur));
          }
        }}
        onKeyDown={(e) => {
          const mentionOpen = mention?.rowId === row.id;
          const matches = mentionOpen
            ? assignees.filter((u) =>
                u.name.toLowerCase().includes(mention!.query.toLowerCase()),
              )
            : [];

          if (e.key === "Enter") {
            e.preventDefault();
            if (mentionOpen && matches.length > 0) {
              const u = matches[mention!.selectedIndex] ?? matches[0];
              applyMention(row.id, u.id, u.name);
            } else {
              jumpNext(row.id);
            }
          } else if (e.key === "Tab" && !e.shiftKey) {
            if (mentionOpen && matches.length > 0) {
              e.preventDefault();
              const u = matches[mention!.selectedIndex] ?? matches[0];
              applyMention(row.id, u.id, u.name);
            } else {
              const el = descRefs.current[row.id];
              if (el) {
                e.preventDefault();
                el.focus();
              }
            }
          } else if (e.key === "Backspace" && row.title === "" && rows.length > 1) {
            e.preventDefault();
            remove(row.id);
            const prev = rows[idx - 1];
            if (prev) focusRow(prev.id);
          } else if (e.key === "ArrowDown") {
            if (mentionOpen && matches.length > 0) {
              e.preventDefault();
              setMention((m) =>
                m ? { ...m, selectedIndex: Math.min(m.selectedIndex + 1, matches.length - 1) } : m,
              );
            } else {
              const nxt = rows[idx + 1];
              if (nxt) {
                e.preventDefault();
                focusRow(nxt.id);
              }
            }
          } else if (e.key === "ArrowUp") {
            if (mentionOpen && matches.length > 0) {
              e.preventDefault();
              setMention((m) =>
                m ? { ...m, selectedIndex: Math.max(m.selectedIndex - 1, 0) } : m,
              );
            } else {
              const prv = rows[idx - 1];
              if (prv) {
                e.preventDefault();
                focusRow(prv.id);
              }
            }
          } else if (e.key === "Escape") {
            if (mentionOpen) {
              e.preventDefault();
              setMention(null);
            }
          }
        }}
        placeholder="Ex: Fazer conciliação bancária de julho"
        className={className}
        onPaste={(e) => handleTitlePaste(row.id, e)}
      />
      {mention?.rowId === row.id && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-200 overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
            style={{ top: mention.rect.top + 4, left: mention.rect.left, width: mention.rect.width }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {(() => {
              const matches = assignees.filter((u) =>
                u.name.toLowerCase().includes(mention.query.toLowerCase()),
              );
              if (matches.length === 0) {
                return (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Nenhum usuário encontrado
                  </div>
                );
              }
              return matches.slice(0, 8).map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => applyMention(row.id, u.id, u.name)}
                  onMouseEnter={() =>
                    setMention((m) => (m ? { ...m, selectedIndex: i } : m))
                  }
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary ${
                    i === mention.selectedIndex ? "bg-secondary" : ""
                  }`}
                >
                  <UserAvatar
                    nome={u.name}
                    iniciais={u.avatar}
                    className="h-6 w-6 shrink-0 text-[10px]"
                  />
                  <span className="flex-1 truncate">{u.name}</span>
                </button>
              ));
            })()}
          </div>,
          document.body,
        )}
    </>
  );

  const campoDescricao = (row: DraftRow, idx: number, className: string) => (
    <input
      ref={(el) => {
        descRefs.current[row.id] = el;
      }}
      value={row.description}
      onChange={(e) => update(row.id, { description: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          jumpNext(row.id);
        } else if (e.key === "Tab" && e.shiftKey) {
          const el = inputRefs.current[row.id];
          if (el) {
            e.preventDefault();
            el.focus();
          }
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          // Sobe e desce na mesma coluna, como numa planilha.
          const vizinha = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
          const el = vizinha ? descRefs.current[vizinha.id] : null;
          if (el) {
            e.preventDefault();
            el.focus();
          }
        }
      }}
      placeholder="Descrição (opcional) — detalhes, contexto…"
      className={className}
    />
  );

  const anexosDaLinha = (row: DraftRow, className: string) =>
    row.attachments.length === 0 ? null : (
      <div className={className}>
        {row.attachments.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/70 py-0.5 pl-0.5 pr-1.5 text-[11px]"
            title={`${a.name} · ${formatBytes(a.size)}`}
          >
            {/* Miniatura clicável — abre no visualizador do sistema.
                Mesmo gesto do painel da tarefa (attachment-list),
                só que no tamanho que cabe na faixa da grade. */}
            <button
              type="button"
              onClick={() => openAttachment(a)}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-border/60 bg-background transition-colors hover:border-primary"
              title={isImage(a.type) ? `Ver ${a.name}` : `Abrir ${a.name}`}
              aria-label={isImage(a.type) ? `Ver ${a.name}` : `Abrir ${a.name}`}
            >
              {isImage(a.type) ? (
                <img
                  src={a.dataUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <FileText className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
            <span className="max-w-40 truncate">{a.name}</span>
            <button
              type="button"
              onClick={() => removeAttachment(row.id, a.id)}
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    );

  const botaoExtras = (row: DraftRow, className = "") => (
    <button
      type="button"
      onClick={() => setLinhaAberta((a) => (a === row.id ? null : row.id))}
      aria-expanded={linhaAberta === row.id}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold transition ${
        resumoExtras(row)
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-dashed border-foreground/40 text-foreground/70 hover:border-primary hover:border-solid hover:text-primary"
      } ${className}`}
      title="Checklist, recorrência e tags"
    >
      <ChevronDown
        className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
          linhaAberta === row.id ? "rotate-180" : ""
        }`}
      />
      <span className="truncate">{resumoExtras(row) || "Checklist, repetição, tags"}</span>
    </button>
  );

  const botaoComprovante = (row: DraftRow, soIcone: boolean) => (
    <button
      type="button"
      onClick={() => update(row.id, { requireProof: !row.requireProof })}
      className={`inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md border text-[10px] font-semibold transition ${
        soIcone ? "w-6" : "px-1.5"
      } ${
        row.requireProof
          ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
          : "border-foreground/30 text-foreground/70 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600"
      }`}
      title="Quem concluir a tarefa terá que anexar um comprovante"
      aria-label="Exigir comprovante"
      aria-pressed={row.requireProof}
    >
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
      {!soIcone && <span className="whitespace-nowrap">Comprovante</span>}
    </button>
  );

  /* Largura fixa, rótulo no title.
     Com o rótulo abrindo no hover (max-w-0 → max-w-[120px]) o botão mudava de
     largura, a faixa refluía, ele saía de baixo do cursor, o hover caía e
     recolhia — voltando para baixo do cursor. Um laço que piscava sem parar. */
  const botaoAnexar = (row: DraftRow) => (
    <button
      type="button"
      onClick={() => openFilePicker(row.id)}
      className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/30 text-foreground/70 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
      title="Anexar arquivo"
      aria-label="Anexar arquivo"
    >
      <Paperclip className="h-3.5 w-3.5" />
    </button>
  );

  const botaoRemover = (row: DraftRow) => (
    <button
      type="button"
      onClick={() => remove(row.id)}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-destructive/40 text-destructive transition hover:border-destructive hover:bg-destructive/15"
      title="Remover esta linha"
      aria-label="Remover esta linha"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );

  const SELECT_PEQUENO =
    "h-6 w-full min-w-0 rounded-md border border-foreground/30 bg-background px-1 text-[11px] outline-none focus:border-primary";

  const painelExtras = (row: DraftRow, className: string) => (
    <div className={`grid gap-3 rounded-md border border-border bg-secondary/30 p-3 sm:grid-cols-3 ${className}`}>
      <div>
        <span className={ROTULO}>
          Checklist{" "}
          <span className="font-medium normal-case text-foreground/45">(opcional)</span>
        </span>
        <div className="mt-1.5 flex gap-1">
          <input
            value={novoPasso[row.id] ?? ""}
            onChange={(e) =>
              setNovoPasso((n) => ({ ...n, [row.id]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                adicionarPasso(row.id);
              }
            }}
            placeholder="Um passo e Enter…"
            className="h-6 min-w-0 flex-1 rounded-md border border-foreground/30 bg-background px-1.5 text-[11px] outline-none placeholder:text-foreground/50 focus:border-primary"
          />
          <button
            type="button"
            onClick={() => adicionarPasso(row.id)}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/30 text-foreground/70 transition hover:border-primary hover:text-primary"
            aria-label="Adicionar passo"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {row.checklist.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {row.checklist.map((c, i) => (
              <li
                key={c.id}
                className="group flex items-center gap-1.5 text-[11px] text-foreground/80"
              >
                <span className="w-3 shrink-0 text-right text-foreground/45">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{c.text}</span>
                <button
                  type="button"
                  onClick={() =>
                    update(row.id, {
                      checklist: row.checklist.filter((x) => x.id !== c.id),
                    })
                  }
                  className="shrink-0 text-foreground/40 opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                  aria-label={`Remover ${c.text}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <span className={ROTULO}>
          Recorrência{" "}
          <span className="font-medium normal-case text-foreground/45">(opcional)</span>
        </span>
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-foreground/85">
          <input
            type="checkbox"
            checked={row.recurring}
            onChange={(e) => update(row.id, { recurring: e.target.checked })}
          />
          Repete ao concluir
        </label>
        {row.recurring && (
          <div className="mt-1.5 space-y-1.5">
            <select
              value={row.frequency}
              onChange={(e) => {
                const frequency = e.target.value as Frequency;
                // Com um dia já escolhido, o prazo volta a seguir a regra na nova frequência.
                update(row.id, {
                  frequency,
                  dueDate:
                    row.recurringMonthDay === null
                      ? row.dueDate
                      : prazoPelaRegra(frequency, row.recurringMonthDay, mesDoPrazo(row), row),
                });
              }}
              className={SELECT_PEQUENO}
            >
              <option value="diaria">Todo dia</option>
              <option value="semanal">Toda semana</option>
              <option value="mensal">Todo mês</option>
              <option value="anual">Todo ano</option>
            </select>
            {row.frequency === "semanal" && (
              <div className="flex flex-wrap gap-0.5">
                {DIAS_SEMANA.map((nome, dia) => {
                  const on = row.recurringWeekdays.includes(dia);
                  return (
                    <button
                      key={nome}
                      type="button"
                      onClick={() =>
                        update(row.id, {
                          recurringWeekdays: on
                            ? row.recurringWeekdays.filter((d) => d !== dia)
                            : [...row.recurringWeekdays, dia].sort((a, b) => a - b),
                        })
                      }
                      aria-pressed={on}
                      className={`h-6 w-7 rounded border text-[10px] font-semibold transition ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-foreground/30 text-foreground/60 hover:border-primary/50"
                      }`}
                    >
                      {nome}
                    </button>
                  );
                })}
              </div>
            )}
            {(row.frequency === "mensal" || row.frequency === "anual") && (
              <div className="flex gap-1.5">
                {row.frequency === "anual" && (
                  <select
                    value={mesDoPrazo(row)}
                    onChange={(e) =>
                      update(row.id, {
                        dueDate: prazoPelaRegra("anual", row.recurringMonthDay, Number(e.target.value), row),
                      })
                    }
                    className={SELECT_PEQUENO}
                    aria-label="Mês"
                  >
                    {MESES.map((nome, i) => (
                      <option key={nome} value={i}>
                        {nome[0]!.toUpperCase() + nome.slice(1)}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={row.recurringMonthDay ?? ""}
                  onChange={(e) => {
                    const dia = e.target.value === "" ? null : Number(e.target.value);
                    update(row.id, {
                      recurringMonthDay: dia,
                      dueDate:
                        dia === null
                          ? row.dueDate
                          : prazoPelaRegra(row.frequency, dia, mesDoPrazo(row), row),
                    });
                  }}
                  className={SELECT_PEQUENO}
                  aria-label="Dia"
                >
                  <option value="">Mesmo dia do prazo</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Dia {d}
                    </option>
                  ))}
                  <option value={ULTIMO_DIA_DO_MES}>Último dia do mês</option>
                  <option value={ULTIMO_DIA_UTIL}>Último dia útil do mês</option>
                </select>
              </div>
            )}
            <p className="text-[10px] text-primary">
              {descreverRecorrencia({
                recurring: row.recurring,
                frequency: row.frequency,
                recurringWeekdays: row.recurringWeekdays,
                recurringMonthDay: row.recurringMonthDay,
                dueDate: row.dueDate,
              })}
            </p>
            {(row.frequency === "mensal" || row.frequency === "anual") && (
              <p className="text-[10px] text-foreground/60">
                Primeira com prazo em{" "}
                <strong className="font-semibold text-foreground/85">
                  {(isoParaData(row.dueDate) ?? new Date()).toLocaleDateString("pt-BR")}
                </strong>
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <span className={ROTULO}>
          Tags <span className="font-medium normal-case text-foreground/45">(opcional)</span>
        </span>
        <input
          value={row.tags}
          onChange={(e) => update(row.id, { tags: e.target.value })}
          placeholder="financeiro, urgente"
          className="mt-1.5 h-6 w-full rounded-md border border-foreground/30 bg-background px-1.5 text-[11px] outline-none placeholder:text-foreground/50 focus:border-primary"
        />
        <p className="mt-1 text-[10px] text-foreground/50">Separe por vírgula.</p>
      </div>
    </div>
  );

  /** Arrastar arquivo para cima de uma linha anexa nela. */
  const soltarNaLinha = (row: DraftRow) => ({
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      setDragRowId(row.id);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragRowId(row.id);
    },
    onDrop: async (e: React.DragEvent) => {
      if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setCardDrag(false);
      setDragRowId(null);
      await addFilesToRow(row.id, e.dataTransfer.files);
    },
  });

  return (
    <div
      className={
        emPagina
          ? /* Na aba a grade É a página: sem cartão, sem borda grossa, sem
               sombra. A moldura de 2px existia para descolar do fundo escuro
               do modal; aqui ela só desenharia uma caixa em volta de nada.
               `fluxo-grade-pagina` publica o --topo que os dois `sticky`
               (cabeçalho e títulos das colunas) leem. */
            `fluxo-grade-pagina relative text-foreground ${
              cardDrag ? "rounded-lg ring-2 ring-primary/40" : ""
            }`
          : `relative rounded-lg border-2 bg-card text-foreground shadow-md transition ${
              cardDrag ? "border-primary ring-2 ring-primary/30" : "border-foreground/70"
            }`
      }
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setCardDrag(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) {
          setCardDrag(false);
          setDragRowId(null);
        }
      }}
      onDrop={handleCardDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={async (e) => {
          const rowId = pendingFileRowId.current;
          pendingFileRowId.current = null;
          if (rowId && e.target.files) await addFilesToRow(rowId, e.target.files);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      {/* Cabeçalho. No modal ele é o botão que recolhe a grade.
          Na aba é o único cabeçalho da tela — a rota não desenha outro — e
          gruda no topo levando junto o botão de criar: com vinte linhas
          preenchidas, ninguém deveria ter que rolar até o fim para salvar. */}
      {emPagina ? (
        <div className="sticky top-(--topo) z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ListPlus className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight tracking-tight">
                Criar tarefa
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="hidden sm:inline">Uma linha por tarefa</span>
                <span className="hidden sm:inline" aria-hidden>
                  ·
                </span>
                {/* As duas dicas e os atalhos moram aqui dentro. Fixas, elas
                    custavam uns 100px de altura todo dia para quem já sabe. */}
                <button
                  type="button"
                  onClick={() => setComoFunciona((v) => !v)}
                  aria-expanded={comoFunciona}
                  className="inline-flex items-center gap-0.5 rounded font-medium text-foreground/70 transition hover:text-foreground"
                >
                  como funciona
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${comoFunciona ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            </div>
          </div>
          {/* Os atalhos ficam à vista, e não atrás do "como funciona": eles
              valem justamente enquanto a pessoa digita, e aqui acompanham a
              rolagem. As explicações é que podem ficar guardadas — quem já
              sabe o que é responsável × @ não precisa reler todo dia. */}
          <div className="hidden min-w-0 items-center gap-3 text-[11px] text-muted-foreground xl:flex">
            {ATALHOS_GRADE.map((a) => (
              <span key={a.tecla} className="inline-flex items-center gap-1 whitespace-nowrap">
                <kbd className="rounded border border-border bg-secondary px-1 font-mono text-foreground">
                  {a.tecla}
                </kbd>
                {a.acao}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {seloProntas}
            <button
              type="button"
              onClick={() => addRow()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Linha</span>
            </button>
            <button
              type="button"
              onClick={requestSubmitAll}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
            >
              <Sparkles className="h-4 w-4" />
              Criar{" "}
              {validRows.length > 0
                ? `${validRows.length} tarefa${validRows.length > 1 ? "s" : ""}`
                : "tarefas"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 border-b-2 border-foreground/70 bg-secondary/50 px-4 py-3 text-left hover:bg-secondary"
          title={open ? "Clique para recolher" : "Clique para expandir"}
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-foreground/40 bg-background text-foreground">
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-base font-bold text-foreground">Planilha de tarefas</span>
            <span className="ml-1 hidden text-[11px] font-medium text-foreground/60 sm:inline">
              (clique para {open ? "recolher" : "expandir"})
            </span>
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
              <UploadCloud className="h-3 w-3" /> arraste arquivos aqui
            </span>
          </div>
          {open && seloProntas}
        </button>
      )}

      {aberto && (
        <div>
          {emPagina && comoFunciona && (
            <div className="mt-3 grid gap-x-6 gap-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-xs leading-relaxed text-foreground/90 lg:grid-cols-2">
              <p>
                O <strong className="font-semibold text-foreground">responsável</strong> é quem
                executa a tarefa. Para que outra pessoa apenas{" "}
                <strong className="font-semibold text-foreground">acompanhe</strong>, escreva{" "}
                <kbd className="rounded border border-border bg-background px-1 font-mono">@</kbd>{" "}
                seguido do nome dela no título.
              </p>
              <p>
                Cada linha guarda{" "}
                <strong className="font-semibold text-foreground">checklist</strong>,{" "}
                <strong className="font-semibold text-foreground">repetição</strong> e{" "}
                <strong className="font-semibold text-foreground">tags</strong> na coluna Extras.
                Fechado, o botão mostra o que você já preencheu.
              </p>
              {/* Os atalhos moram no cabeçalho, sempre à vista — mas lá eles
                  só aparecem a partir de `xl`. Abaixo disso o cabeçalho não
                  tem largura para eles, e some-los de vez seria perder a
                  informação; então reaparecem aqui, e só aqui. */}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-foreground/75 lg:col-span-2 xl:hidden">
                {ATALHOS_GRADE.map((a) => (
                  <span key={a.tecla} className="inline-flex items-center gap-1">
                    <kbd className="rounded border border-border bg-background px-1 font-mono text-foreground">
                      {a.tecla}
                    </kbd>
                    {a.acao}
                  </span>
                ))}
              </p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-foreground/75 lg:col-span-2">
                <span className="inline-flex items-center gap-1 text-primary">
                  <UploadCloud className="h-3 w-3" /> arraste arquivos sobre uma linha para anexar
                </span>
                <span>
                  Cada linha vira uma tarefa só quando tem título — as vazias são ignoradas.
                </span>
              </p>
            </div>
          )}
          {!emPagina && dicaAberta && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs leading-relaxed text-foreground/90 sm:mx-3">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="flex-1">
                O <strong className="font-semibold text-foreground">responsável</strong> é quem
                executa a tarefa. Para que outra pessoa apenas{" "}
                <strong className="font-semibold text-foreground">acompanhe</strong>, escreva{" "}
                <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono">@</kbd>{" "}
                seguido do nome dela no título.
              </p>
              <button
                type="button"
                onClick={dispensarDica}
                className="shrink-0 rounded p-0.5 text-foreground/50 transition hover:bg-foreground/10 hover:text-foreground"
                title="Não mostrar de novo"
                aria-label="Dispensar dica"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!emPagina && dicaExtrasAberta && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs leading-relaxed text-foreground/90 sm:mx-3">
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="flex-1">
                Cada linha guarda <strong className="font-semibold text-foreground">checklist</strong>,{" "}
                <strong className="font-semibold text-foreground">repetição</strong> e{" "}
                <strong className="font-semibold text-foreground">tags</strong> no botão ao lado da
                estimativa. Fechado, ele mostra o que você já preencheu.
              </p>
              <button
                type="button"
                onClick={dispensarDicaExtras}
                className="shrink-0 rounded p-0.5 text-foreground/50 transition hover:bg-foreground/10 hover:text-foreground"
                title="Não mostrar de novo"
                aria-label="Dispensar dica"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {/* Uma linha por tarefa, uma coluna por campo, como numa planilha.
              Serve para preencher muita tarefa parecida de uma vez — os campos
              ficam alinhados e dá para descer coluna abaixo com as setas.
              Checklist, recorrência e tags ficam atrás do botão da coluna
              "Extras", que abre uma linha inteira embaixo. */}
          <div className={emPagina ? "pt-3" : "px-2 pb-2 pt-3 sm:px-3 sm:pb-3"}>
              <div
                className={
                  emPagina
                    ? /* Sem `overflow-x-auto` aqui: um contêiner que rola é um
                         contêiner de recorte, e dentro dele o `sticky` da linha
                         de títulos gruda no topo da CAIXA, não no da tela — ou
                         seja, nunca. A tabela cabe na largura da aba (medida:
                         1288px de 1288 numa tela de 1366), e abaixo do mínimo
                         quem rola é a página. */
                      "min-w-0 rounded-md border border-border bg-background"
                    : "overflow-x-auto rounded-md border border-foreground/40 bg-background"
                }
              >
                {/* Largura em porcentagem no título e na descrição, com piso em
                    `min-w-*`: numa tela larga a sobra vai para os dois campos de
                    texto, em vez de ser repartida com Prazo e Prioridade, que
                    não ficam melhores maiores. */}
                <table className="w-full min-w-260 border-collapse text-xs">
                  <thead>
                    {/* Gruda logo abaixo do cabeçalho da aba (h-16). Com muitas
                        linhas, o nome da coluna é o que diz o que você está
                        preenchendo — some ele e a planilha vira campo anônimo. */}
                    <tr className={`bg-secondary text-left ${cabecalhoGrudento}`}>
                      <th className={`${TH} w-9 text-center`}>#</th>
                      <th className={`${TH} w-[30%] min-w-56`}>
                        Tarefa <span className="text-destructive">*</span>
                      </th>
                      <th className={`${TH} w-[24%] min-w-44`}>
                        Descrição{" "}
                        <span className="font-medium normal-case tracking-normal text-foreground/50">
                          (opcional)
                        </span>
                      </th>
                      <th className={`${TH} w-34`}>Prazo</th>
                      {!compact && <th className={`${TH} w-44`}>Responsável</th>}
                      <th className={`${TH} w-24`}>Prioridade</th>
                      <th className={`${TH} w-22`}>Estimativa</th>
                      <th className={`${TH} w-40`}>Extras</th>
                      <th className={`${TH} w-26 text-center`}>Opções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <Fragment key={row.id}>
                        <tr
                          {...soltarNaLinha(row)}
                          className={`transition-colors ${
                            dragRowId === row.id ? "bg-primary/10" : "hover:bg-secondary/40"
                          }`}
                        >
                          <td className={`${TD} text-center font-mono text-[11px] font-bold text-primary`}>
                            {idx + 1}
                          </td>
                          <td className={`${TD} relative p-0 align-top`}>
                            {campoTitulo(row, idx, `${CELULA} font-semibold`)}
                            {anexosDaLinha(row, "flex flex-wrap gap-1 px-2 pb-1.5")}
                          </td>
                          <td className={`${TD} p-0 align-top`}>
                            {campoDescricao(row, idx, CELULA)}
                          </td>
                          <td className={`${TD} px-1`}>
                            <CampoData
                              value={row.dueDate}
                              onChange={(v) => update(row.id, { dueDate: v })}
                              limpavel={false}
                              placeholder="Escolher"
                              title="Prazo da tarefa"
                              className="h-7 w-full border-transparent bg-transparent text-[11px] font-medium text-foreground hover:border-foreground/30"
                            />
                          </td>
                          {!compact && (
                            <td className={`${TD} px-1`}>
                              <SeletorResponsavel
                                valor={row.assigneeId}
                                pessoas={assignees}
                                aoMudar={(id) => update(row.id, { assigneeId: id })}
                              />
                            </td>
                          )}
                          <td className={`${TD} p-0`}>
                            <select
                              value={row.priority}
                              onChange={(e) => update(row.id, { priority: e.target.value as Priority })}
                              aria-label="Prioridade"
                              className={`${CELULA} cursor-pointer font-semibold ${
                                PRIORIDADES.find((p) => p.id === row.priority)?.texto ?? ""
                              }`}
                            >
                              {/* Fundo e cor explícitos na opção: a célula é
                                  transparente para a grade aparecer, e a lista
                                  nativa herdava esse fundo como branco — com o
                                  texto claro do tema escuro por cima, as opções
                                  sumiam. */}
                              {PRIORIDADES.map((p) => (
                                <option
                                  key={p.id}
                                  value={p.id}
                                  className="bg-popover font-medium text-popover-foreground"
                                >
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className={`${TD} p-0`}>
                            <input
                              value={row.estimateHM}
                              onChange={(e) => update(row.id, { estimateHM: e.target.value })}
                              placeholder="00:30"
                              inputMode="numeric"
                              aria-label="Estimativa"
                              className={`${CELULA} font-mono`}
                              title="Tempo estimado — ex.: 00:30, 1:15, 45m, 1.5h"
                            />
                          </td>
                          <td className={`${TD} px-1`}>{botaoExtras(row, "w-full max-w-full")}</td>
                          <td className={`${TD} px-1`}>
                            <div className="flex items-center justify-center gap-1">
                              {botaoComprovante(row, true)}
                              {botaoAnexar(row)}
                              {botaoRemover(row)}
                            </div>
                          </td>
                        </tr>
                        {linhaAberta === row.id && (
                          <tr>
                            <td colSpan={compact ? 8 : 9} className="border-b border-foreground/20 bg-secondary/20 p-2">
                              {painelExtras(row, "")}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          {cardDrag && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
              <div className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow">
                Solte para anexar {dragRowId ? "nesta linha" : "à última tarefa"}
              </div>
            </div>
          )}
          {/* Rodapé. Na aba ele fica magro: o botão de criar e os atalhos já
              subiram para o cabeçalho grudento e para o "como funciona", e
              repetir os dois aqui só empurraria a grade para cima. Sobra o
              "adicionar linha", que é onde a mão está depois da última. */}
          {emPagina ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
              <button
                type="button"
                onClick={() => addRow()}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" /> Adicionar linha
              </button>
              <span className="text-[10px] text-muted-foreground">
                <span className="text-destructive">*</span> obrigatório
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-foreground/70 bg-secondary/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => addRow()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-foreground/50 bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
                >
                  <Plus className="h-4 w-4" /> Adicionar linha
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-foreground/80">
                <span className="text-[10px] text-foreground/60">
                  <span className="text-destructive">*</span> obrigatório
                </span>
                <span className="hidden md:inline">
                  {ATALHOS_GRADE.map((a, i) => (
                    <span key={a.tecla}>
                      {i > 0 && " · "}
                      <kbd className="rounded border border-foreground/40 bg-background px-1 font-mono text-foreground">
                        {a.tecla}
                      </kbd>{" "}
                      {a.acao}
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  onClick={requestSubmitAll}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
                >
                  <Sparkles className="h-4 w-4" />
                  Criar {validRows.length > 0 ? `${validRows.length} tarefa${validRows.length > 1 ? "s" : ""}` : "tarefas"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <TravaScroll />
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Criar todas as tarefas?</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Você vai criar <strong>{validRows.length}</strong> tarefa{validRows.length > 1 ? "s" : ""} de uma vez. Confira antes de confirmar:
            </p>
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-md border border-border bg-secondary/40 p-2 text-xs">
              {validRows.map((r, i) => (
                <li key={r.id} className="flex items-center gap-2 border-b border-border/40 py-1 last:border-0">
                  <span className="text-[10px] text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1 truncate font-medium">{r.title}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(r.dueDate + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSubmitAll}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
              >
                Criar {validRows.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {discardOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4">
          <TravaScroll />
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Sair sem criar?</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Você tem <strong>{validRows.length}</strong> tarefa{validRows.length > 1 ? "s" : ""} preenchida{validRows.length > 1 ? "s" : ""}. O que deseja fazer?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDiscardOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Continuar editando
              </button>
              <button
                onClick={discardAndClose}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"
              >
                Descartar
              </button>
              <button
                onClick={saveAndClose}
                disabled={validRows.length === 0}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                Salvar {validRows.length > 0 ? validRows.length : ""}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}