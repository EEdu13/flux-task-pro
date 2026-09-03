import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Paperclip, X, FileText, UploadCloud, ShieldCheck, Timer, ClipboardPaste, Search, Check } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { type Status, type Priority, type Frequency } from "@/lib/fluxo-types";
import type { Attachment, ChecklistItem } from "@/lib/fluxo-types";
import { DIAS_SEMANA, ULTIMO_DIA_DO_MES, descreverRecorrencia } from "@/lib/recorrencia";
import { AnimatePresence, motion } from "framer-motion";
import { filesToAttachments, formatBytes, isImage, openAttachment } from "@/lib/attachments";
import { CampoData } from "@/components/campo-data";
import { isoParaData } from "@/lib/data-iso";
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

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function inDaysStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
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
const PRIORIDADES: { id: Priority; label: string; curto: string; cor: string }[] = [
  { id: "alta", label: "Alta", curto: "Alta", cor: "text-destructive border-destructive/50 bg-destructive/10" },
  { id: "media", label: "Média", curto: "Média", cor: "text-warning border-warning/50 bg-warning/10" },
  { id: "baixa", label: "Baixa", curto: "Baixa", cor: "text-primary border-primary/50 bg-primary/10" },
];

export function InlineTaskCreator({
  defaultStatus = "pendente",
  compact = false,
  defaultDueDate,
  defaultAssigneeId,
}: {
  defaultStatus?: Status;
  compact?: boolean;
  defaultDueDate?: string;
  defaultAssigneeId?: string;
}) {
  const { currentUser, visibleUsersForAssign, createTask, quickCreate, closeQuickCreate } = useFluxo();
  const assignees = visibleUsersForAssign();
  const [open, setOpen] = useState(true);
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
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
        row.recurring && row.frequency === "mensal" ? row.recurringMonthDay : null,
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
    if (confirmOpen || pasteOpen || discardOpen) return;
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

  const submitPasteModal = () => {
    const parsed = parseExcelPaste(pasteText, assignees);
    const n = applyParsedRows(parsed);
    if (n > 0) {
      toast.success(`${n} linha${n > 1 ? "s" : ""} importada${n > 1 ? "s" : ""}`);
      setPasteText("");
      setPasteOpen(false);
    }
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

  return (
    <div
      className={`relative rounded-lg border-2 bg-card text-foreground shadow-md transition ${
        cardDrag ? "border-primary ring-2 ring-primary/30" : "border-foreground/70"
      }`}
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
        {open && rows.some((r) => r.title.trim()) && (
          <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
            {rows.filter((r) => r.title.trim()).length} pronta{rows.filter((r) => r.title.trim()).length > 1 ? "s" : ""}
          </span>
        )}
      </button>

      {open && (
        <div>
          {dicaAberta && (
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
          {dicaExtrasAberta && (
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
          {/* Cabeçalho das colunas: sem ele os dois campos eram só caixas
              anônimas, e o placeholder some no instante em que se digita. */}
          <div className="flex items-center gap-2 px-4 pb-1 pt-3 sm:px-5">
            <span className="h-0 w-6 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-0 flex-[1_1_58%] text-[10px] font-bold uppercase tracking-wide text-foreground/85">
                Tarefa <span className="text-destructive">*</span>
              </div>
              <div className="min-w-0 flex-[1_1_42%] text-[10px] font-bold uppercase tracking-wide text-foreground/65">
                Descrição{" "}
                <span className="font-medium normal-case tracking-normal text-foreground/50">
                  (opcional)
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 px-2 pb-2 sm:px-3 sm:pb-3">
            {rows.map((row, idx) => (
              <div
                key={row.id}
                onDragEnter={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  setDragRowId(row.id);
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDragRowId(row.id);
                }}
                onDrop={async (e) => {
                  if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  dragDepth.current = 0;
                  setCardDrag(false);
                  setDragRowId(null);
                  await addFilesToRow(row.id, e.dataTransfer.files);
                }}
                className={`relative rounded-md border border-foreground/40 bg-background px-2 py-1.5 shadow-sm transition ${
                  dragRowId === row.id ? "border-primary bg-primary/5" : "hover:border-foreground/60"
                }`}
              >
                <div className="flex items-stretch gap-2">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {idx + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="relative min-w-0 flex-[1_1_58%]">
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
                        className="w-full rounded-md border border-foreground/30 bg-background px-2.5 py-1.5 text-sm font-semibold text-foreground outline-none placeholder:text-foreground/55 focus:border-primary focus:ring-1 focus:ring-primary/20"
                        onPaste={(e) => handleTitlePaste(row.id, e)}
                      />
                      {mention?.rowId === row.id && typeof document !== "undefined" &&
                        createPortal(
                          <div
                            className="fixed z-[200] overflow-hidden rounded-md border border-border bg-popover shadow-2xl"
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
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                                    {u.avatar || u.name.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span className="flex-1 truncate">{u.name}</span>
                                </button>
                              ));
                            })()}
                          </div>,
                          document.body,
                        )}
                </div>
                <div className="min-w-0 flex-[1_1_42%]">
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
                          }
                        }}
                        placeholder="Descrição (opcional) — detalhes, contexto…"
                        className="w-full rounded-md border border-foreground/30 bg-background px-2.5 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground/55 focus:border-primary focus:ring-1 focus:ring-primary/20"
                      />
                </div>
                  </div>
                </div>
                {row.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-8">
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
                        <span className="max-w-[160px] truncate">{a.name}</span>
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
                )}
                {/* Faixa de controles agrupada. Antes era uma fileira de seis
                    controles com a mesma borda e altura, sem nada dizendo que
                    tratavam de coisas diferentes (quando / quem / quanto tempo). */}
                <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 pl-8">
                  <div className="flex flex-col gap-1">
                    <span className={ROTULO}>Prazo</span>
                    <div className="flex items-center gap-1.5">
                      <div className="inline-flex h-6 items-center gap-0.5 rounded-md border border-foreground/30 bg-background p-0.5 text-[11px]">
                          {[
                            { label: "Hoje", get: todayStr },
                            { label: "Amanhã", get: tomorrowStr },
                            { label: "+7d", get: () => inDaysStr(7) },
                          ].map((opt) => {
                            const iso = opt.get();
                            const active = row.dueDate === iso;
                            return (
                              <button
                                type="button"
                                key={opt.label}
                                onClick={() => update(row.id, { dueDate: iso })}
                                className={`rounded px-1.5 py-0.5 font-semibold transition ${
                                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                      </div>
                      <CampoData
                          value={row.dueDate}
                          onChange={(v) => update(row.id, { dueDate: v })}
                          limpavel={false}
                          placeholder="Escolher"
                          title="Prazo da tarefa"
                          className="h-6 w-31 border-foreground/30 text-[11px] font-medium text-foreground"
                        />
                    </div>
                  </div>
                  {!compact && (
                    <div className="flex flex-col gap-1">
                      <span className={ROTULO}>Responsável</span>
                      <SeletorResponsavel
                        valor={row.assigneeId}
                        pessoas={assignees}
                        aoMudar={(id) => update(row.id, { assigneeId: id })}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <span className={ROTULO}>Prioridade</span>
                    <div className="inline-flex h-6 items-center gap-0.5 rounded-md border border-foreground/30 bg-background p-0.5 text-[11px]">
                      {PRIORIDADES.map((p) => {
                        const ativa = row.priority === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => update(row.id, { priority: p.id })}
                            aria-pressed={ativa}
                            className={`rounded px-1.5 py-0.5 font-semibold transition ${
                              ativa ? p.cor + " border" : "border border-transparent text-foreground/60 hover:bg-secondary"
                            }`}
                          >
                            {p.curto}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={ROTULO}>
                      Estimativa <span className="font-medium normal-case text-foreground/45">(opc.)</span>
                    </span>
                    <div className="flex h-6 items-center gap-1 rounded-md border border-foreground/30 bg-background px-1.5 text-[11px] focus-within:border-primary">
                        <Timer className="h-3 w-3 text-foreground/70" />
                        <input
                          value={row.estimateHM}
                          onChange={(e) => update(row.id, { estimateHM: e.target.value })}
                          placeholder="00:30"
                          inputMode="numeric"
                          className="w-12 bg-transparent font-mono text-foreground outline-none placeholder:text-foreground/55"
                          title="Tempo estimado — ex.: 00:30, 1:15, 45m, 1.5h"
                        />
                    </div>
                  </div>
                  {/* Checklist, recorrência e tags ficam atrás deste botão. Ele
                      mora ao lado da estimativa, e não no canto com as ações:
                      empurrado para a direita junto do anexar e da lixeira, era
                      lido como ação secundária e passava despercebido. */}
                  <button
                    type="button"
                    onClick={() => setLinhaAberta((a) => (a === row.id ? null : row.id))}
                    aria-expanded={linhaAberta === row.id}
                    className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold transition ${
                      resumoExtras(row)
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-dashed border-foreground/40 text-foreground/70 hover:border-primary hover:border-solid hover:text-primary"
                    }`}
                    title="Checklist, recorrência e tags"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                        linhaAberta === row.id ? "rotate-180" : ""
                      }`}
                    />
                    {resumoExtras(row) || "Checklist, repetição, tags"}
                  </button>
                  {/* Ações. "Comprovante" fica sempre escrito — o escudo sozinho
                      não conta o que faz. Anexar mantém só o ícone (clipe é
                      convenção universal) e a lixeira sai de perto dos outros
                      dois: era idêntica a eles, sendo a única irreversível. */}
                  <div className="ml-auto flex items-end gap-1.5">
                    <div className="flex flex-col gap-1">
                      <span className={ROTULO}>Opções</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => update(row.id, { requireProof: !row.requireProof })}
                          className={`inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold transition ${
                            row.requireProof
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "border-foreground/30 text-foreground/70 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-600"
                          }`}
                          title="Quem concluir a tarefa terá que anexar um comprovante"
                          aria-pressed={row.requireProof}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          <span className="whitespace-nowrap">Comprovante</span>
                        </button>
                        {/* Largura fixa, rótulo no title.
                            Com o rótulo abrindo no hover (max-w-0 → max-w-[120px])
                            o botão mudava de largura, a faixa refluía, ele saía
                            de baixo do cursor, o hover caía e recolhia — voltando
                            para baixo do cursor. Um laço que piscava sem parar. */}
                        <button
                          type="button"
                          onClick={() => openFilePicker(row.id)}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-foreground/30 text-foreground/70 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                          title="Anexar arquivo"
                          aria-label="Anexar arquivo"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <span className="mx-0.5 h-6 w-px shrink-0 bg-foreground/20" aria-hidden />
                    <button
                      type="button"
                      onClick={() => remove(row.id)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-destructive/40 text-destructive transition hover:border-destructive hover:bg-destructive/15"
                      title="Remover esta linha"
                      aria-label="Remover esta linha"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                {linhaAberta === row.id && (
                  <motion.div
                    key="extras"
                    // Altura animada com overflow escondido: sem isso o painel
                    // aparece de estalo e empurra as linhas de baixo num salto.
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { type: "spring", stiffness: 400, damping: 38, mass: 0.7 },
                      opacity: { duration: 0.15 },
                    }}
                    className="overflow-hidden"
                  >
                  <div className="mt-2 grid gap-3 rounded-md border border-border bg-secondary/30 p-3 pl-8 sm:grid-cols-3">
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
                            onChange={(e) =>
                              update(row.id, { frequency: e.target.value as Frequency })
                            }
                            className="h-6 w-full rounded-md border border-foreground/30 bg-background px-1 text-[11px] outline-none focus:border-primary"
                          >
                            <option value="diaria">Todo dia</option>
                            <option value="semanal">Toda semana</option>
                            <option value="mensal">Todo mês</option>
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
                          {row.frequency === "mensal" && (
                            <select
                              value={row.recurringMonthDay ?? ""}
                              onChange={(e) =>
                                update(row.id, {
                                  recurringMonthDay:
                                    e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              className="h-6 w-full rounded-md border border-foreground/30 bg-background px-1 text-[11px] outline-none focus:border-primary"
                            >
                              <option value="">Mesmo dia do prazo</option>
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                  Dia {d}
                                </option>
                              ))}
                              <option value={ULTIMO_DIA_DO_MES}>Último dia do mês</option>
                            </select>
                          )}
                          <p className="text-[10px] text-primary">
                            {descreverRecorrencia({
                              recurring: row.recurring,
                              frequency: row.frequency,
                              recurringWeekdays: row.recurringWeekdays,
                              recurringMonthDay: row.recurringMonthDay,
                            })}
                          </p>
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
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
            ))}
          </div>
          {cardDrag && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
              <div className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow">
                Solte para anexar {dragRowId ? "nesta linha" : "à última tarefa"}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-foreground/70 bg-secondary/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addRow()}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-foreground/50 bg-background px-3 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
              >
                <Plus className="h-4 w-4" /> Adicionar linha
              </button>
              <button
                type="button"
                onClick={() => setPasteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
                title="Cole aqui um bloco copiado do Excel / Google Sheets"
              >
                <ClipboardPaste className="h-4 w-4" /> Colar do Excel
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

      {pasteOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPasteOpen(false)}
        >
          <TravaScroll />
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ClipboardPaste className="h-4 w-4 text-primary" />
                  <h3 className="text-base font-semibold">Colar planilha de tarefas</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cole abaixo (Ctrl+V) linhas copiadas do Excel, Google Sheets ou qualquer texto.
                  Uma linha = uma tarefa. Colunas separadas por tabulação:
                </p>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-medium">
                  {["Título*", "Prazo (dd/mm/aaaa)", "Responsável (nome)", "Setor", "Tempo (hh:mm)"].map((c, i) => (
                    <span
                      key={c}
                      className={`rounded border px-1.5 py-0.5 ${
                        i === 0
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setPasteOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`Fazer conciliação bancária\t25/07/2026\tElisa\tFinanceiro\t00:45\nEnviar relatório mensal\t28/07/2026\tRicardo\tOperações\t01:30`}
              className="mt-3 h-52 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs outline-none focus:border-primary"
            />
            {pasteText.trim() && (
              <div className="mt-2 rounded-md border border-border bg-secondary/40 p-2 text-[11px] text-muted-foreground">
                Prévia: <strong>{parseExcelPaste(pasteText, assignees).length}</strong> linha(s) reconhecida(s).
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPasteOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={submitPasteModal}
                disabled={!pasteText.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
              >
                Importar linhas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}