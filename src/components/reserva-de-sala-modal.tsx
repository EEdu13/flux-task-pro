import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { TravaScroll } from "@/components/trava-scroll";
import { useFluxo } from "@/lib/fluxo-store";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { nomeCurto } from "@/lib/nome-curto";
import {
  listarAgendaDeSalas,
  listarSalasDeReuniao,
  reservarSalaDeReuniao,
  type ReservaDeSala,
  type SalaDeReuniao,
} from "@/lib/reservas-sala.functions";

/* Reserva das SALAS FÍSICAS de reunião — Sala Maior e Sala Menor.
 *
 * Não confundir com `/salas`, que são as salas de voz e vídeo do LiveKit. São
 * coisas diferentes com o mesmo nome em português, e por isso tudo aqui fala em
 * "reserva de sala", nunca só em "sala".
 *
 * É um modal, e não uma página, porque reservar sala interrompe outra coisa: a
 * pessoa está numa tarefa, combina uma reunião e volta para onde estava. Uma
 * rota tiraria ela do lugar e pediria o caminho de volta.
 *
 * Quem guarda a reserva é o Agendador; aqui só existe a tela. A grade da
 * esquerda não é enfeite: é ela que impede escolher um horário que vai bater
 * conflito na hora de gravar — sem ela, o choque só apareceria depois de
 * tentar, e o Agendador é a única autoridade sobre isso.
 */

const EVENTO = "fluxo:reserva-sala-open";

/** Abre o modal de onde for — o raio, a paleta de comandos, o calendário. */
export function abrirReservaDeSala(dia?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { dia } }));
}

/* ----------------------------- Horas e minutos ----------------------------- */

/** "14:30" → 870. A grade inteira raciocina em minutos desde a meia-noite. */
const emMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const emHora = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Passo da grade e altura de cada passo. 30 min é a menor reunião que se marca. */
const PASSO = 30;
const ALTURA_PASSO = 28;

/** Expediente. Só o padrão: uma reserva fora dele alarga a janela (ver `janela`). */
const EXPEDIENTE = { de: 7 * 60, ate: 19 * 60 };

/* -------------------------------- Erros -------------------------------- */

interface FalhaDoAgendador {
  motivo?: string;
  codigo?: string;
  message?: string;
  conflito?: { inicio: string; fim: string; responsavel: string };
}

/**
 * O `AgendadorError` atravessa o server function com as próprias propriedades
 * intactas — o seroval copia todas ao serializar —, mas NÃO como instância da
 * classe: `instanceof` daria falso, e a classe mora num `.server.ts` que o
 * cliente não pode nem importar. Por isso a leitura é pela forma do objeto.
 *
 * E é pelo `motivo`, nunca pelo texto: a mensagem nasce do Flask do outro lado
 * e pode ser reescrita lá sem ninguém avisar aqui.
 */
function lerFalha(e: unknown): FalhaDoAgendador {
  return (e ?? {}) as FalhaDoAgendador;
}

function mensagemDaFalha(e: unknown): string {
  const f = lerFalha(e);
  switch (f.motivo) {
    case "conflito":
      return f.conflito
        ? `Já reservada das ${f.conflito.inicio} às ${f.conflito.fim} por ${nomeCurto(f.conflito.responsavel)}.`
        : "Alguém pegou a sala nesse horário.";
    case "sem_acesso":
      return "Seu usuário não tem acesso ao Agendador. Fale com a TI — não dá para resolver por aqui.";
    case "credenciais":
      return "Sua sessão expirou. Entre novamente.";
    case "indisponivel":
      return "O Agendador não respondeu. Tente de novo em instantes.";
    case "invalido":
      /* O único caso em que a mensagem de lá serve: ela diz QUAL campo foi
         recusado, e isso o `motivo` sozinho não conta. */
      return f.message || "Data, horário ou sala recusados.";
    default:
      return f.message || "Não foi possível falar com o Agendador.";
  }
}

/* ------------------------------ Casca do modal ------------------------------ */

/**
 * Montado uma vez pelo `FluxoLayout`; quem abre é o evento.
 *
 * Portal para o `body` porque o raio das ações rápidas mora dentro de um
 * contêiner animado com `transform`, e `fixed` dentro de um elemento
 * transformado passa a ser relativo a ele — o modal abriria preso no canto.
 */
export function ReservaDeSalaModal() {
  const [dia, setDia] = useState<string | null>(null);

  useEffect(() => {
    const aoAbrir = (e: Event) => {
      const pedido = (e as CustomEvent<{ dia?: string }>).detail?.dia;
      setDia(pedido ?? dataParaIso(new Date()));
    };
    window.addEventListener(EVENTO, aoAbrir);
    return () => window.removeEventListener(EVENTO, aoAbrir);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {dia !== null && (
        <ReservaAberta key="reserva-sala" diaInicial={dia} aoFechar={() => setDia(null)} />
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------ O modal aberto ------------------------------ */

/** Montado só enquanto aberto: fechar desmonta, e desmontar zera o formulário
 *  e garante que a agenda seja relida na próxima abertura, em vez de mostrar o
 *  que estava na tela da última vez. */
function ReservaAberta({ diaInicial, aoFechar }: { diaInicial: string; aoFechar: () => void }) {
  const { users, currentUser } = useFluxo();

  const [dia, setDia] = useState(diaInicial);
  const [salas, setSalas] = useState<SalaDeReuniao[]>([]);
  const [reservas, setReservas] = useState<ReservaDeSala[]>([]);
  const [carregandoSalas, setCarregandoSalas] = useState(true);
  const [carregandoAgenda, setCarregandoAgenda] = useState(false);
  const [falhaGeral, setFalhaGeral] = useState<string | null>(null);

  const [salaId, setSalaId] = useState<number | null>(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [paraQuem, setParaQuem] = useState("");
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [buscaPessoa, setBuscaPessoa] = useState("");
  const [enviando, setEnviando] = useState(false);

  /* Esc fecha — menos enquanto grava, que é quando fechar deixaria a pessoa
     sem saber se a reserva entrou ou não. */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || enviando) return;
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [enviando, aoFechar]);

  useEffect(() => {
    let vivo = true;
    listarSalasDeReuniao()
      .then((r) => {
        if (!vivo) return;
        setSalas(r.salas);
        setSalaId((atual) => atual ?? r.salas[0]?.id ?? null);
      })
      .catch((e) => vivo && setFalhaGeral(mensagemDaFalha(e)))
      .finally(() => {
        if (vivo) setCarregandoSalas(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const recarregarAgenda = useCallback(async () => {
    setCarregandoAgenda(true);
    try {
      const r = await listarAgendaDeSalas({ data: { data: dia } });
      setReservas(r.reservas);
      setFalhaGeral(null);
    } catch (e) {
      setReservas([]);
      setFalhaGeral(mensagemDaFalha(e));
    } finally {
      setCarregandoAgenda(false);
    }
  }, [dia]);

  useEffect(() => {
    void recarregarAgenda();
  }, [recarregarAgenda]);

  /* A janela do dia começa no expediente e ESTICA para caber o que já existe.
     Uma reserva às 6h não pode ficar escondida acima da grade: quem não a vê
     escolhe por cima dela e só descobre no conflito. */
  const janela = useMemo(() => {
    let de = EXPEDIENTE.de;
    let ate = EXPEDIENTE.ate;
    for (const r of reservas) {
      de = Math.min(de, Math.floor(emMinutos(r.inicio) / PASSO) * PASSO);
      ate = Math.max(ate, Math.ceil(emMinutos(r.fim) / PASSO) * PASSO);
    }
    return { de, ate };
  }, [reservas]);

  const marcas = useMemo(() => {
    const out: number[] = [];
    for (let m = janela.de; m < janela.ate; m += PASSO) out.push(m);
    return out;
  }, [janela]);

  const ocupado = useCallback(
    (sid: number, de: number, ate: number) =>
      reservas.some((r) => r.sala_id === sid && emMinutos(r.inicio) < ate && de < emMinutos(r.fim)),
    [reservas],
  );

  /* Clicar na grade é o caminho principal de escolher horário — os campos de
     hora existem para ajuste fino, não para descobrir o que está livre.

     Clicar num slot depois do início ESTENDE a seleção, e a extensão é
     recusada se ela fosse atravessar uma reserva. É isso que torna impossível
     montar pela grade um horário que o Agendador vai recusar. */
  const clicarSlot = (sid: number, minuto: number) => {
    if (ocupado(sid, minuto, minuto + PASSO)) return;
    const estendendo = sid === salaId && inicio && fim && minuto >= emMinutos(inicio);
    if (!estendendo) {
      setSalaId(sid);
      setInicio(emHora(minuto));
      setFim(emHora(minuto + PASSO));
      return;
    }
    const novoFim = minuto + PASSO;
    if (ocupado(sid, emMinutos(inicio), novoFim)) return;
    setFim(emHora(novoFim));
  };

  const escolhaCompleta =
    salaId !== null && !!inicio && !!fim && emMinutos(inicio) < emMinutos(fim);

  /* O choque também é recalculado a partir dos campos de hora, e não só da
     grade: dá para digitar 14:00–15:00 em cima de uma reserva existente. */
  const choque = useMemo(() => {
    if (!escolhaCompleta || salaId === null) return undefined;
    return reservas.find(
      (r) =>
        r.sala_id === salaId &&
        emMinutos(r.inicio) < emMinutos(fim) &&
        emMinutos(inicio) < emMinutos(r.fim),
    );
  }, [escolhaCompleta, salaId, reservas, inicio, fim]);

  const noPassado = useMemo(() => {
    if (!escolhaCompleta) return false;
    const quando = isoParaData(dia);
    if (!quando) return false;
    quando.setMinutes(emMinutos(inicio));
    return quando.getTime() < Date.now();
  }, [escolhaCompleta, dia, inicio]);

  const outros = useMemo(
    () => users.filter((u) => u.id !== currentUser.id),
    [users, currentUser.id],
  );

  const convidaveis = useMemo(() => {
    const q = buscaPessoa.trim().toLowerCase();
    return q ? outros.filter((u) => u.name.toLowerCase().includes(q)) : outros;
  }, [outros, buscaPessoa]);

  const alternarParticipante = (id: string) =>
    setParticipantes((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  const andarDias = (passos: number) => {
    const d = isoParaData(dia) ?? new Date();
    d.setDate(d.getDate() + passos);
    setDia(dataParaIso(d));
  };

  const impedimento = !escolhaCompleta
    ? "Escolha um horário na grade ao lado."
    : choque
      ? `Esse horário bate com "${choque.motivo}", das ${choque.inicio} às ${choque.fim}.`
      : noPassado
        ? "Esse horário já passou."
        : !motivo.trim()
          ? "Escreva o motivo da reunião."
          : null;

  const enviar = async () => {
    if (impedimento || salaId === null || enviando) return;
    setEnviando(true);
    try {
      const alvo = paraQuem ? outros.find((u) => u.id === paraQuem) : undefined;
      /* Os DOIS campos de "para quem": o Agendador prefere o id (e daí tira o
         telefone, que é como o WhatsApp de confirmação chega), mas cai no nome
         quando a pessoa ainda não tem cadastro lá — mandando só o id, ela
         sumiria da reserva em silêncio. */
      const idDoAlvo = alvo ? Number(alvo.id) : Number.NaN;
      const r = await reservarSalaDeReuniao({
        data: {
          data: dia,
          inicio,
          fim,
          salaId,
          motivo: motivo.trim(),
          participantesIam: participantes.map(Number).filter((n) => Number.isInteger(n) && n > 0),
          paraIamId: Number.isInteger(idDoAlvo) ? idDoAlvo : null,
          paraNome: alvo?.name ?? "",
        },
      });

      toast.success(`${r.reserva.sala} reservada`, {
        description: `${diaPorExtenso(dia)} · ${inicio} às ${fim}`,
      });

      if (r.participantesIgnorados.length > 0) {
        /* Silêncio aqui seria o pior desfecho: a pessoa sai achando que
           convidou alguém que nunca vai ser avisado. */
        const nomes = r.participantesIgnorados
          .map((id) => users.find((u) => u.id === String(id))?.name)
          .filter(Boolean)
          .map((n) => nomeCurto(n as string));
        toast.warning("Alguns convidados ficaram de fora", {
          description: `${nomes.join(", ") || "Sem cadastro no Agendador"} — avise por outro caminho.`,
        });
      }

      setMotivo("");
      setParticipantes([]);
      setParaQuem("");
      /* O horário sai junto, e não é detalhe: mantido, ele vira um choque com a
         reserva que ACABOU de ser criada, e o painel passa a avisar a pessoa
         contra ela mesma — "esse horário bate com Revisão do orçamento". */
      setInicio("");
      setFim("");
      await recarregarAgenda();
    } catch (e) {
      const f = lerFalha(e);
      toast.error("Não foi possível reservar", { description: mensagemDaFalha(e) });
      /* Conflito quer dizer que a agenda desta tela está velha: alguém pegou a
         sala enquanto o formulário estava aberto. Reler é o que faz o bloco
         novo aparecer na grade, em vez de deixar a pessoa tentando de novo no
         mesmo horário. */
      if (f.motivo === "conflito") await recarregarAgenda();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Reservar sala de reunião"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-180 flex items-start justify-center overflow-y-auto px-3 pb-8"
      /* O respiro do topo sai da própria `--titlebar-h`: a barra de título do
         app é `fixed` com z acima deste modal, e sem isso o cartão desliza por
         baixo dela. */
      style={{ paddingTop: "calc(var(--titlebar-h) + 1.5rem)" }}
    >
      <TravaScroll />
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={aoFechar} />

      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
        className="relative z-10 w-full max-w-[1100px] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        {/* Cabeçalho: o que é, que dia, e o botão de sair */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
          <DoorOpen className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Reservar sala de reunião</div>
            {/* `first-letter:uppercase`, e não `capitalize`: em português só a
                primeira letra sobe. O `capitalize` escrevia "Sexta-Feira, 18 De
                Setembro De 2026". */}
            <div className="truncate text-[11px] text-muted-foreground first-letter:uppercase">
              {diaPorExtenso(dia)}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {carregandoAgenda && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
            <button
              onClick={() => andarDias(-1)}
              aria-label="Dia anterior"
              className="rounded-md border border-border p-1.5 transition hover:bg-secondary"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <label className="relative">
              <CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="date"
                value={dia}
                onChange={(e) => e.target.value && setDia(e.target.value)}
                className="input rounded-md border border-border bg-background py-1 pl-7 pr-1.5 text-xs outline-none"
              />
            </label>
            <button
              onClick={() => setDia(dataParaIso(new Date()))}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-medium transition hover:bg-secondary"
            >
              Hoje
            </button>
            <button
              onClick={() => andarDias(1)}
              aria-label="Próximo dia"
              className="rounded-md border border-border p-1.5 transition hover:bg-secondary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={aoFechar}
              aria-label="Fechar"
              className="ml-1 rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {falhaGeral && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {falhaGeral}
          </div>
        )}

        <div className="flex flex-col lg:flex-row">
          {/* Agenda do dia */}
          <div className="min-w-0 flex-1 border-border lg:border-r">
            {carregandoSalas ? (
              <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando as salas…
              </div>
            ) : salas.length === 0 ? (
              <div className="py-24 text-center text-sm text-muted-foreground">
                Nenhuma sala disponível no Agendador.
              </div>
            ) : (
              /* A grade rola dentro do cartão: o dia inteiro passa de 700px, e
                 deixar o modal crescer até lá empurraria o formulário para
                 fora da tela. */
              <div className="flex max-h-[min(62vh,620px)] overflow-auto p-4">
                {/* Régua das horas */}
                <div className="sticky left-0 z-10 w-12 shrink-0 bg-card pt-7">
                  {marcas.map((m) => (
                    <div
                      key={m}
                      style={{ height: ALTURA_PASSO }}
                      className="relative text-right text-[10px] tabular-nums text-muted-foreground"
                    >
                      {m % 60 === 0 && (
                        <span className="absolute -top-1.5 right-2">{emHora(m)}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex min-w-0 flex-1 gap-3">
                  {salas.map((sala) => (
                    <ColunaDaSala
                      key={sala.id}
                      sala={sala}
                      marcas={marcas}
                      janela={janela}
                      reservas={reservas.filter((r) => r.sala_id === sala.id)}
                      selecionada={salaId === sala.id && escolhaCompleta}
                      inicio={inicio}
                      fim={fim}
                      ocupado={ocupado}
                      aoClicar={(minuto) => clicarSlot(sala.id, minuto)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Formulário */}
          <aside className="w-full shrink-0 space-y-3 p-4 lg:w-[340px]">
            <div>
              <Rotulo>Sala</Rotulo>
              <select
                value={salaId ?? ""}
                onChange={(e) => setSalaId(Number(e.target.value) || null)}
                disabled={salas.length === 0}
                className="input mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
              >
                {salas.length === 0 && <option value="">—</option>}
                {salas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Rotulo>Início</Rotulo>
                <input
                  type="time"
                  step={60 * PASSO}
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                  className="input mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
                />
              </div>
              <div>
                <Rotulo>Término</Rotulo>
                <input
                  type="time"
                  step={60 * PASSO}
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                  className="input mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
                />
              </div>
            </div>

            <div>
              <Rotulo>Motivo</Rotulo>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value.slice(0, 255))}
                placeholder="Ex: alinhamento do projeto SGL"
                className="input mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
              />
            </div>

            <div>
              <Rotulo>Para quem</Rotulo>
              <select
                value={paraQuem}
                onChange={(e) => setParaQuem(e.target.value)}
                className="input mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
              >
                <option value="">Para mim</option>
                {outros.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nomeCurto(u.name)} · {u.jobTitle}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Rotulo>
                  <Users className="mr-1 inline h-3 w-3" />
                  Participantes
                </Rotulo>
                {participantes.length > 0 && (
                  <button
                    onClick={() => setParticipantes([])}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    limpar ({participantes.length})
                  </button>
                )}
              </div>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={buscaPessoa}
                  onChange={(e) => setBuscaPessoa(e.target.value)}
                  placeholder="Procurar pessoa"
                  className="input w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none"
                />
              </div>
              <ul className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
                {convidaveis.map((u) => {
                  const marcado = participantes.includes(u.id);
                  return (
                    <li key={u.id}>
                      <button
                        onClick={() => alternarParticipante(u.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition ${
                          marcado ? "bg-primary/10 text-foreground" : "hover:bg-secondary"
                        }`}
                      >
                        <UserAvatar
                          nome={u.name}
                          iniciais={u.avatar || u.name.slice(0, 1)}
                          className="h-6 w-6 text-[9px]"
                        />
                        <span className="min-w-0 flex-1 truncate">{nomeCurto(u.name)}</span>
                        <span
                          className={`h-3.5 w-3.5 shrink-0 rounded-[4px] border-2 transition-[background-color,border-color] ${
                            marcado ? "border-primary bg-primary" : "border-border"
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
                {convidaveis.length === 0 && (
                  <li className="px-1.5 py-3 text-center text-[11px] text-muted-foreground">
                    Ninguém com esse nome.
                  </li>
                )}
              </ul>
            </div>

            {impedimento && (
              <p className="rounded-md bg-secondary px-2.5 py-2 text-[11px] text-muted-foreground">
                {impedimento}
              </p>
            )}

            <button
              onClick={() => void enviar()}
              disabled={!!impedimento || enviando}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DoorOpen className="h-4 w-4" />
              )}
              {enviando ? "Reservando…" : "Reservar"}
            </button>
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------ Peças da tela ------------------------------ */

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function diaPorExtenso(iso: string) {
  const d = isoParaData(iso);
  if (!d) return iso;
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Uma coluna da grade: os slots livres no fundo, as reservas por cima.
 *
 * Os dois em camadas, e não numa lista só, porque uma reserva pode começar e
 * terminar fora do passo de 30 min (o Agendador aceita 14:10, por exemplo) —
 * posicionada de forma absoluta, ela cobre exatamente o que ocupa, enquanto os
 * botões de fundo continuam sendo uma grade regular e clicável.
 */
function ColunaDaSala({
  sala,
  marcas,
  janela,
  reservas,
  selecionada,
  inicio,
  fim,
  ocupado,
  aoClicar,
}: {
  sala: SalaDeReuniao;
  marcas: number[];
  janela: { de: number; ate: number };
  reservas: ReservaDeSala[];
  selecionada: boolean;
  inicio: string;
  fim: string;
  ocupado: (sid: number, de: number, ate: number) => boolean;
  aoClicar: (minuto: number) => void;
}) {
  const topo = (min: number) => ((min - janela.de) / PASSO) * ALTURA_PASSO;

  return (
    <div className="flex min-w-[170px] flex-1 flex-col">
      <div className="mb-1 flex h-6 items-center gap-1.5 text-xs font-semibold">
        <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate">{sala.nome}</span>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-background">
        {marcas.map((m) => {
          const livre = !ocupado(sala.id, m, m + PASSO);
          return (
            <button
              key={m}
              type="button"
              disabled={!livre}
              onClick={() => aoClicar(m)}
              style={{ height: ALTURA_PASSO }}
              title={livre ? `Reservar a partir de ${emHora(m)}` : undefined}
              className={`block w-full border-b transition-colors last:border-b-0 ${
                m % 60 === 0 ? "border-border" : "border-border/40"
              } ${livre ? "hover:bg-primary/10" : "cursor-not-allowed"}`}
            />
          );
        })}

        {reservas.map((r) => {
          const de = Math.max(emMinutos(r.inicio), janela.de);
          const ate = Math.min(emMinutos(r.fim), janela.ate);
          return (
            <div
              key={r.id}
              style={{ top: topo(de), height: Math.max(ALTURA_PASSO / 2, topo(ate) - topo(de)) }}
              title={`${r.inicio}–${r.fim} · ${r.motivo} · ${r.responsavel}`}
              className="absolute inset-x-1 overflow-hidden rounded-md border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[10px] leading-tight"
            >
              <div className="truncate font-semibold text-foreground">{r.motivo}</div>
              <div className="truncate text-muted-foreground">
                {r.inicio}–{r.fim} · {nomeCurto(r.para_nome || r.responsavel)}
              </div>
            </div>
          );
        })}

        {selecionada && (
          <div
            style={{
              top: topo(emMinutos(inicio)),
              height: Math.max(ALTURA_PASSO, topo(emMinutos(fim)) - topo(emMinutos(inicio))),
            }}
            className="pointer-events-none absolute inset-x-1 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/20 text-[10px] font-bold text-primary"
          >
            {inicio}–{fim}
          </div>
        )}
      </div>
    </div>
  );
}
