import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TravaScroll } from "@/components/trava-scroll";
import { UserAvatar } from "@/components/user-avatar";
import { confirmar } from "@/components/confirm-dialog";
import { useFluxo } from "@/lib/fluxo-store";
import { ehChefeDe } from "@/lib/permissoes";
import { avisarQueCompromissosMudaram } from "@/lib/compromissos-cliente";
import { dataParaIso } from "@/lib/data-iso";
import { nomeCurto } from "@/lib/nome-curto";
import { DEPARTMENT_ROOMS, rotuloDaSala } from "@/lib/rooms";
import { sectors, type User } from "@/lib/fluxo-types";
import type { ReservaDeSala } from "@/lib/reservas-sala.functions";
import {
  faixaDeHorario,
  horaCurta,
  nomeComparavel,
  type Compromisso,
  type ConflitoDeAgenda,
} from "@/lib/compromisso";
import {
  cancelarCompromisso,
  salvarCompromisso,
  verificarConflitosDeAgenda,
} from "@/lib/compromissos.functions";

/* "Travar agenda" (pedido do usuário, 14/10/2026): o diálogo que trava o
 * horário de uma ou mais pessoas, e o cartão de detalhe do compromisso.
 *
 * Quem pode ser escolhido: QUALQUER pessoa do CONECTA (pedido do usuário,
 * 14/10/2026: "preciso também que possa travar a agenda de qualquer pessoa").
 * A régua do "Delegar" saiu daqui. Com centenas de nomes, a lista vem com a
 * minha equipe primeiro (eu, quem está abaixo de mim no organograma e quem é
 * do meu setor), filtro por setor e busca por nome. O servidor só confere se
 * a pessoa existe (`salvarCompromisso`).
 *
 * Conflito não impede: aparece em amarelo ("Fulano já tem 'X' das 14:00 às
 * 15:00") e a gravação segue, como no Outlook.
 */

/** Mensagem do servidor quando a migração ainda não rodou — ver `compromissos.server.ts`. */
const INATIVA = "A agenda travada ainda não foi ativada.";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmDe = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const instanteDe = (dia: string, hora: string) => new Date(`${dia}T${hora}:00`);

/** Quantas linhas a lista de pessoas desenha de uma vez — o resto pede busca. */
const PESSOAS_NA_LISTA = 80;

/**
 * Todo mundo, com a minha equipe na frente: eu, quem está abaixo de mim no
 * organograma e quem é do meu setor; depois o resto, por nome.
 */
function pessoasEmOrdem(eu: User, users: User[]): { lista: User[]; daEquipe: Set<string> } {
  const daEquipe = new Set(
    users
      .filter(
        (u) =>
          u.id === eu.id ||
          ehChefeDe(eu, users, u.id) ||
          ehChefeDe(u, users, eu.id) ||
          (!!eu.sector && u.sector === eu.sector),
      )
      .map((u) => u.id),
  );
  const porNome = (a: User, b: User) => a.name.localeCompare(b.name, "pt-BR");
  const euMesmo = users.find((u) => u.id === eu.id);
  const equipe = users.filter((u) => u.id !== eu.id && daEquipe.has(u.id)).sort(porNome);
  const resto = users.filter((u) => !daEquipe.has(u.id)).sort(porNome);
  return { lista: [...(euMesmo ? [euMesmo] : []), ...equipe, ...resto], daEquipe };
}

export interface PedidoDeTravar {
  inicio: Date;
  fim: Date;
  /** Na edição, o compromisso que está sendo mudado. */
  compromisso?: Compromisso;
}

export function TravarAgendaDialog({
  pedido,
  ativa,
  reservasConhecidas,
  aoFechar,
}: {
  pedido: PedidoDeTravar | null;
  /** `false` = a migração não rodou; `null` = ainda não se sabe. */
  ativa: boolean | null;
  /** As reservas de sala já carregadas pelo calendário, para avisar choque. */
  reservasConhecidas?: (iso: string) => ReservaDeSala[] | undefined;
  aoFechar: () => void;
}) {
  if (!pedido) return null;
  return (
    <FormularioDeTravar
      // Um pedido novo recomeça o formulário do zero.
      key={`${pedido.compromisso?.id ?? "novo"}-${pedido.inicio.getTime()}-${pedido.fim.getTime()}`}
      pedido={pedido}
      ativa={ativa}
      reservasConhecidas={reservasConhecidas}
      aoFechar={aoFechar}
    />
  );
}

function FormularioDeTravar({
  pedido,
  ativa,
  reservasConhecidas,
  aoFechar,
}: {
  pedido: PedidoDeTravar;
  ativa: boolean | null;
  reservasConhecidas?: (iso: string) => ReservaDeSala[] | undefined;
  aoFechar: () => void;
}) {
  const { users, currentUser } = useFluxo();
  const editando = pedido.compromisso;
  const { lista: candidatos, daEquipe } = useMemo(
    () => pessoasEmOrdem(currentUser, users),
    [currentUser, users],
  );
  /* "equipe", "todos" ou o id de um setor. */
  const [setorFiltro, setSetorFiltro] = useState<string>("todos");
  const setoresComGente = useMemo(() => {
    const presentes = new Set(users.map((u) => u.sector));
    return sectors.filter((s) => presentes.has(s.id));
  }, [users]);

  const [assunto, setAssunto] = useState(editando?.assunto ?? "");
  const [dia, setDia] = useState(dataParaIso(pedido.inicio));
  const [horaInicio, setHoraInicio] = useState(hhmmDe(pedido.inicio));
  const [horaFim, setHoraFim] = useState(hhmmDe(pedido.fim));
  const [local, setLocal] = useState(editando?.local ?? "");
  const [sala, setSala] = useState(editando?.sala ?? "");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [pessoas, setPessoas] = useState<string[]>(() => {
    if (editando) return editando.participantes;
    return [];
  });
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(ativa === false ? INATIVA : null);
  const [conflitos, setConflitos] = useState<ConflitoDeAgenda[]>([]);

  const inicio = HORA.test(horaInicio) ? instanteDe(dia, horaInicio) : null;
  /* Fim antes do início no mesmo dia = vira o dia (ex.: 23:00–00:30). */
  const fim = (() => {
    if (!inicio || !HORA.test(horaFim)) return null;
    const f = instanteDe(dia, horaFim);
    if (f.getTime() <= inicio.getTime()) f.setDate(f.getDate() + 1);
    return f;
  })();
  const inicioIso = inicio && !Number.isNaN(inicio.getTime()) ? inicio.toISOString() : null;
  const fimIso = fim && !Number.isNaN(fim.getTime()) ? fim.toISOString() : null;
  const chavePessoas = pessoas.join(",");

  /* Conflitos com outros compromissos, relidos quando horário ou pessoas
     mudam — com uma pausa, para não ir ao servidor a cada tecla. */
  useEffect(() => {
    if (ativa === false || !inicioIso || !fimIso || pessoas.length === 0) {
      setConflitos([]);
      return;
    }
    let vivo = true;
    const id = window.setTimeout(() => {
      verificarConflitosDeAgenda({
        data: { inicio: inicioIso, fim: fimIso, pessoas, ignorar: editando?.id },
      })
        .then((r) => vivo && setConflitos(r.conflitos))
        .catch(() => vivo && setConflitos([]));
    }, 400);
    return () => {
      vivo = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioIso, fimIso, chavePessoas, ativa, editando?.id]);

  /* Reserva de sala física em nome da pessoa, no mesmo horário — com o que o
     calendário já tem na mão; o Agendador guarda nome, não id. */
  const choquesDeSala = useMemo(() => {
    if (!inicio || !fim) return [];
    const reservas = reservasConhecidas?.(dia) ?? [];
    const out: { pessoa: User; r: ReservaDeSala }[] = [];
    for (const id of pessoas) {
      const u = users.find((x) => x.id === id);
      if (!u) continue;
      for (const r of reservas) {
        if (nomeComparavel(r.para_nome || r.responsavel) !== nomeComparavel(u.name)) continue;
        const ri = instanteDe(r.data, r.inicio).getTime();
        const rf = instanteDe(r.data, r.fim).getTime();
        if (ri < fim.getTime() && rf > inicio.getTime()) out.push({ pessoa: u, r });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioIso, fimIso, chavePessoas, dia, reservasConhecidas, users]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const filtrados = useMemo(() => {
    const q = nomeComparavel(busca);
    return candidatos.filter(
      (u) =>
        (setorFiltro === "todos" ||
          (setorFiltro === "equipe" ? daEquipe.has(u.id) : u.sector === setorFiltro)) &&
        (!q || nomeComparavel(u.name).includes(q)),
    );
  }, [busca, candidatos, setorFiltro, daEquipe]);

  const alternar = (id: string) =>
    setPessoas((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const nomeDe = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u ? (id === currentUser.id ? "Você" : nomeCurto(u.name)) : `#${id}`;
  };

  const salvar = async () => {
    setErro(null);
    if (ativa === false) return setErro(INATIVA);
    if (!assunto.trim()) return setErro("Escreva o assunto.");
    if (!inicioIso || !fimIso) return setErro("Confira o horário de início e de fim.");
    if (pessoas.length === 0) return setErro("Escolha pelo menos uma pessoa.");
    setSalvando(true);
    try {
      await salvarCompromisso({
        data: {
          id: editando?.id ?? null,
          assunto: assunto.trim(),
          descricao: descricao.trim() || null,
          local: local.trim() || null,
          sala: sala || null,
          inicio: inicioIso,
          fim: fimIso,
          participantes: pessoas.map(Number),
        },
      });
      toast.success(editando ? "Agenda atualizada" : "Agenda travada");
      avisarQueCompromissosMudaram();
      aoFechar();
    } catch (e) {
      setErro((e as Error)?.message || "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const campo =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20";

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        data-sobre-a-agenda
        role="dialog"
        aria-modal="true"
        aria-labelledby="travar-agenda-titulo"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-4 w-4" />
          </span>
          <h2 id="travar-agenda-titulo" className="font-display text-base font-semibold">
            {editando ? "Editar agenda travada" : "Travar agenda"}
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="ml-auto rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {(ativa === false || erro === INATIVA) && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>{INATIVA} Fale com a TI para liberar.</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Assunto *
            </span>
            <input
              autoFocus
              value={assunto}
              maxLength={160}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Ex.: Reunião de alinhamento"
              className={campo}
            />
          </label>

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Dia</span>
              <input
                type="date"
                value={dia}
                onChange={(e) => e.target.value && setDia(e.target.value)}
                className={campo}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Início</span>
              <input
                type="time"
                step={300}
                value={horaInicio}
                onChange={(e) => {
                  const novo = e.target.value;
                  /* Mudar o início leva o fim junto, mantendo a duração. */
                  if (HORA.test(novo) && inicio && fim) {
                    const dur = fim.getTime() - inicio.getTime();
                    setHoraFim(hhmmDe(new Date(instanteDe(dia, novo).getTime() + dur)));
                  }
                  setHoraInicio(novo);
                }}
                className={`${campo} w-28 tabular-nums`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Fim</span>
              <input
                type="time"
                step={300}
                value={horaFim}
                onChange={(e) => setHoraFim(e.target.value)}
                className={`${campo} w-28 tabular-nums`}
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <MapPin className="h-3 w-3" /> Local (opcional)
              </span>
              <input
                value={local}
                maxLength={120}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="Ex.: Sala Maior, Fazenda 820"
                className={campo}
              />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <Video className="h-3 w-3" /> Sala do CONECTA (opcional)
              </span>
              <select value={sala} onChange={(e) => setSala(e.target.value)} className={campo}>
                <option value="">Nenhuma</option>
                {DEPARTMENT_ROOMS.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
                {sala && !DEPARTMENT_ROOMS.some((r) => r.name === sala) && (
                  <option value={sala}>{rotuloDaSala(sala)}</option>
                )}
              </select>
            </label>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Pessoas * <span className="font-normal">({pessoas.length})</span>
              </span>
            </div>
            {pessoas.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {pessoas.map((id) => {
                  const u = users.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => alternar(id)}
                      title="Tirar"
                      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-0.5 pr-2 text-xs transition hover:bg-primary/20"
                    >
                      {u && (
                        <UserAvatar
                          nome={u.name}
                          iniciais={u.avatar}
                          className="h-5 w-5 text-[8px]"
                        />
                      )}
                      {nomeDe(id)}
                      <X className="h-3 w-3 opacity-60" />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar qualquer pessoa"
                  className={`${campo} pl-8`}
                />
              </div>
              <select
                value={setorFiltro}
                onChange={(e) => setSetorFiltro(e.target.value)}
                aria-label="Filtrar por setor"
                className={`${campo} w-40`}
              >
                <option value="todos">Todos os setores</option>
                <option value="equipe">Minha equipe</option>
                {setoresComGente.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <ul className="mt-1.5 max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filtrados.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">
                  Ninguém encontrado.
                </li>
              )}
              {filtrados.slice(0, PESSOAS_NA_LISTA).map((u, i, lista) => {
                const marcado = pessoas.includes(u.id);
                /* O rótulo de cada parte: a minha equipe vem primeiro. */
                const parte =
                  i === 0 || daEquipe.has(lista[i - 1]!.id) !== daEquipe.has(u.id)
                    ? daEquipe.has(u.id)
                      ? "Sua equipe"
                      : "Demais pessoas"
                    : null;
                return (
                  <li key={u.id}>
                    {parte && setorFiltro === "todos" && (
                      <div className="bg-secondary/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {parte}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => alternar(u.id)}
                      className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition hover:bg-secondary/60 ${
                        marcado ? "bg-primary/5" : ""
                      }`}
                    >
                      <UserAvatar
                        nome={u.name}
                        iniciais={u.avatar}
                        className="h-6 w-6 text-[9px]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {nomeCurto(u.name)}
                        {u.id === currentUser.id && (
                          <span className="ml-1 text-xs text-muted-foreground">(você)</span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {u.jobTitle}
                      </span>
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${
                          marcado
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        }`}
                      >
                        {marcado && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtrados.length > PESSOAS_NA_LISTA && (
                <li className="px-3 py-2 text-center text-[11px] text-muted-foreground">
                  +{filtrados.length - PESSOAS_NA_LISTA} pessoas — busque pelo nome ou filtre o
                  setor
                </li>
              )}
            </ul>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Descrição (opcional)
            </span>
            <textarea
              value={descricao}
              maxLength={1000}
              rows={2}
              onChange={(e) => setDescricao(e.target.value)}
              className={`${campo} resize-y`}
            />
          </label>

          {(conflitos.length > 0 || choquesDeSala.length > 0) && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Choque de horário — dá para
                salvar mesmo assim
              </div>
              {conflitos.map((c) => (
                <div key={`${c.pessoaId}-${c.compromissoId}`}>
                  {nomeDe(c.pessoaId)} já tem {c.assunto ? `“${c.assunto}”` : "um compromisso"} das{" "}
                  {horaCurta(c.inicio)} às {horaCurta(c.fim)}
                </div>
              ))}
              {choquesDeSala.map(({ pessoa, r }) => (
                <div key={`${pessoa.id}-sala-${r.id}`}>
                  {nomeDe(pessoa.id)} tem reserva da {r.sala} das {r.inicio} às {r.fim} ({r.motivo})
                </div>
              ))}
            </div>
          )}

          {erro && erro !== INATIVA && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || ativa === false}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {salvando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {editando ? "Salvar alterações" : "Travar agenda"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** O cartão do compromisso: o que é, quando, quem criou, quem está. */
export function DetalheDoCompromisso({
  compromisso,
  aoFechar,
  aoEditar,
}: {
  compromisso: Compromisso | null;
  aoFechar: () => void;
  aoEditar: (c: Compromisso) => void;
}) {
  const { users, currentUser } = useFluxo();
  const navigate = useNavigate();
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    if (!compromisso) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        aoFechar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [compromisso, aoFechar]);

  if (!compromisso) return null;
  const c = compromisso;
  const criador = users.find((u) => u.id === c.criadoPor);
  const souCriador = c.criadoPor === currentUser.id;
  const dia = new Date(c.inicio).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  const cancelar = async () => {
    const ok = await confirmar({
      titulo: "Cancelar esta agenda?",
      descricao: "O horário volta a ficar livre e as pessoas são avisadas do cancelamento.",
      confirmar: "Cancelar agenda",
      cancelar: "Voltar",
      perigo: true,
    });
    if (!ok) return;
    setCancelando(true);
    try {
      await cancelarCompromisso({ data: { id: c.id } });
      toast.success("Agenda cancelada");
      avisarQueCompromissosMudaram();
      aoFechar();
    } catch (e) {
      toast.error((e as Error)?.message || "Não foi possível cancelar.");
    } finally {
      setCancelando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <TravaScroll />
      <div
        data-sobre-a-agenda
        role="dialog"
        aria-modal="true"
        aria-labelledby="compromisso-titulo"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <Lock className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="compromisso-titulo"
              className="font-display text-base font-semibold leading-snug"
            >
              {c.assunto}
            </h2>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs capitalize text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {dia} · {faixaDeHorario(c)}
            </div>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {(c.local || c.sala) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {c.local && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {c.local}
                </span>
              )}
              {c.sala && (
                <span className="inline-flex items-center gap-1">
                  <Video className="h-3.5 w-3.5 text-muted-foreground" /> {rotuloDaSala(c.sala)}
                </span>
              )}
            </div>
          )}
          {c.descricao && (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{c.descricao}</p>
          )}

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Criada por
            </div>
            <div className="flex items-center gap-2 text-xs">
              {criador && (
                <UserAvatar
                  nome={criador.name}
                  iniciais={criador.avatar}
                  className="h-6 w-6 text-[9px]"
                />
              )}
              {souCriador ? "Você" : criador ? nomeCurto(criador.name) : "—"}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Agenda travada de ({c.participantes.length})
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {c.participantes.map((id) => {
                const u = users.find((x) => x.id === id);
                return (
                  <li key={id} className="flex items-center gap-2 text-xs">
                    {u ? (
                      <UserAvatar
                        nome={u.name}
                        iniciais={u.avatar}
                        className="h-6 w-6 text-[9px]"
                      />
                    ) : (
                      <span className="h-6 w-6 rounded-full bg-muted" />
                    )}
                    <span className="truncate">
                      {id === currentUser.id ? "Você" : u ? nomeCurto(u.name) : `#${id}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
          {souCriador && (
            <button
              type="button"
              onClick={() => void cancelar()}
              disabled={cancelando}
              className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
            >
              {cancelando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Cancelar agenda
            </button>
          )}
          {c.sala && (
            <button
              type="button"
              onClick={() => {
                aoFechar();
                navigate({ to: "/salas/$roomName", params: { roomName: c.sala! } });
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
            >
              <Video className="h-3.5 w-3.5" /> Entrar na sala
            </button>
          )}
          {souCriador && (
            <button
              type="button"
              onClick={() => aoEditar(c)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
          )}
          {!souCriador && (
            <button
              type="button"
              onClick={aoFechar}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
