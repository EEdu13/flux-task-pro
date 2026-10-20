import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import type { TextStreamHandler, TrackPublication } from "livekit-client";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { criarSegmentador, gravacaoSuportada, type TrechoDeFala } from "@/lib/segmentador-de-fala";
import {
  redigirAtaFinalDaReuniao,
  transcreverBlocoDaReuniao,
  transcreverVoz,
} from "@/lib/voz.functions";
import { juntarEmWav } from "@/lib/blocos-de-fala";
import {
  ATA_VAZIA,
  ataDaEntrada,
  ataParaMarkdown,
  ataTemConteudo,
  topicosDaAta,
  type AtaAoVivo,
  type FalaDaReuniao,
} from "@/lib/ata-ao-vivo";

/**
 * A ata da reunião, escrita enquanto as pessoas conversam.
 *
 *   1. Cada microfone da sala — o seu e o de cada participante — é cortado em
 *      frases (`segmentador-de-fala.ts`). Cada pessoa tem o próprio corte, então
 *      toda fala já nasce com o nome de quem falou.
 *   2. A OpenAI transcreve cada frase (`transcreverVoz`, contexto "reuniao").
 *   3. Quando a reunião termina, a IA lê a transcrição INTEIRA de uma vez e
 *      escreve a ata (`redigirAtaFinalDaReuniao`: Claude Haiku, com o GPT de
 *      reserva). Durante a reunião não há IA escrevendo — só transcrevendo.
 *
 * Uma ata por sala, escrita por UMA pessoa: quem clicou em Ata é o "dono".
 * Só o computador dele ouve e chama as IAs — com cinco pessoas abrindo a ata,
 * seriam cinco transcrições da mesma fala e cinco contas. Os outros recebem as
 * falas e a ata pelo canal de dados do LiveKit e acompanham ao vivo.
 *
 * A ata é da SALA, não do dono (19/10/2026: reuniões inteiras se perderam
 * porque quem escrevia saiu no meio e a ata foi salva e fechada ali):
 *   - Dono que sai com gente na sala PASSA a ata (falas, ata, o que faltava
 *     escrever) para outra pessoa, que continua a mesma ata.
 *   - Dono que cai sem avisar: quem está na sala assume sozinho, numa ordem
 *     igual em todas as máquinas, com o que já tinha recebido.
 *   - O rascunho vai para Atas & Planos durante a reunião (`ataId`), então nem
 *     uma aba fechada perde a reunião.
 *   - No fim, uma redação final lê a transcrição inteira e escreve a ata que
 *     fica guardada, com a transcrição completa anexada.
 *
 * O botão da Ata acende para todo mundo enquanto alguém escreve: quem está na
 * sala precisa saber que a fala está sendo transcrita.
 */

const TOPICO = "fluxo-ata";
/** O dono repete o estado de tempos em tempos: quem perdeu uma mensagem se acerta. */
const SINAL_MS = 15_000;
/** Sem sinal por este tempo, o dono caiu sem avisar. */
const DONO_SUMIU_MS = 50_000;
/** O rascunho vai para o servidor no máximo uma vez por minuto (um UPDATE pequeno). */
const RASCUNHO_MS = 60_000;
/** Quanto quem sai espera a pessoa que vai continuar a ata responder. */
const PASSAR_ESPERA_MS = 4_000;
/** Na fila de quem assume a ata de um dono que caiu, o intervalo entre uma pessoa e a seguinte. */
const VEZ_NA_FILA_MS = 6_000;

export type FaseDaAta = "ouvindo" | "pausada" | "encerrada";

export interface EstadoDaAta {
  dono: { identity: string; nome: string };
  fase: FaseDaAta;
  escrevendo: boolean;
  /** Quando este dono começou — desempata dois donos ao mesmo tempo. */
  desde: number;
  salva: boolean;
  /** O id da ata em Atas & Planos: o rascunho e a versão final são a mesma linha. */
  ataId: string;
  /** Até onde (hora da fala) a ata já foi escrita: quem assume sabe o que falta. */
  escritaAte: number;
}

/**
 * Id estável de um tópico da ata (o mesmo texto dá sempre o mesmo id): o
 * rascunho salvo a cada minuto não apaga e recria os mesmos tópicos.
 */
function idDoTopico(ataId: string, tipo: string, texto: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const s = `${ataId}|${tipo}|${texto}`;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 16777619);
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 2246822507);
  }
  const h = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const x = h(a) + h(b) + h(a ^ b) + h(Math.imul(a, b));
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

/** Uma linha de legenda: o que acabou de ser dito, para quem está na reunião ver. */
export interface Legenda {
  id: string;
  quem: string;
  texto: string;
  at: number;
}

/* Os blocos de fala da ata (19/10/2026, "gravar e transcrever depois"): as
   frases de cada pessoa se juntam até ~40 s de fala, ou até ela parar de
   falar, e o bloco inteiro é transcrito de uma vez — com contexto, sem
   silêncio. A legenda continua frase a frase, na hora. */
const BLOCO_MAX_MS = 40_000;
const FIM_DE_TURNO_MS = 4_000;
const BLOCO_ESPERA_MAX_MS = 75_000;
/** Quanto tempo uma linha de legenda fica na tela. */
const LEGENDA_MS = 9_000;

type Mensagem =
  | { k: "estado"; estado: EstadoDaAta }
  | { k: "fala"; fala: FalaDaReuniao }
  | { k: "legenda"; legenda: Legenda }
  | { k: "ata"; ata: AtaAoVivo }
  | { k: "pedir" }
  | { k: "tudo"; estado: EstadoDaAta; falas: FalaDaReuniao[]; ata: AtaAoVivo }
  /** O dono vai sair e passa a ata para uma pessoa; ela responde "assumi". */
  | {
      k: "passar";
      estado: EstadoDaAta;
      falas: FalaDaReuniao[];
      ata: AtaAoVivo;
      pendentes: string[];
    }
  | { k: "assumi" }
  /** Quem deixou de escrever entrega as falas que só ele tinha ao dono de agora. */
  | { k: "juntar"; falas: FalaDaReuniao[] };

type LinhaDoChat = { at: number; from: string; text: string };

const horaDe = (ms: number) =>
  new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const paraBase64 = (b: Blob) =>
  new Promise<string>((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(",")[1] ?? "");
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(b);
  });

const mensagemDe = (e: unknown) =>
  (e instanceof Error && e.message) || "Algo deu errado. Tente de novo.";

const esperar = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function falaDaEntrada(v: unknown): FalaDaReuniao | null {
  const f = (v ?? {}) as Record<string, unknown>;
  if (typeof f.id !== "string" || typeof f.texto !== "string" || typeof f.at !== "number")
    return null;
  return {
    id: f.id.slice(0, 60),
    at: f.at,
    hora: typeof f.hora === "string" ? f.hora.slice(0, 5) : horaDe(f.at),
    quem: typeof f.quem === "string" ? f.quem.slice(0, 120) : "Alguém",
    texto: f.texto.slice(0, 4000),
    audio: typeof f.audio === "string" && /^[0-9a-f-]{36}$/i.test(f.audio) ? f.audio : undefined,
  };
}

function legendaDaEntrada(v: unknown): Legenda | null {
  const l = (v ?? {}) as Record<string, unknown>;
  if (typeof l.id !== "string" || typeof l.texto !== "string" || typeof l.at !== "number")
    return null;
  return {
    id: l.id.slice(0, 60),
    quem: typeof l.quem === "string" ? l.quem.slice(0, 120) : "Alguém",
    texto: l.texto.slice(0, 600),
    at: l.at,
  };
}

function estadoDaEntrada(v: unknown): EstadoDaAta | null {
  const e = (v ?? {}) as Record<string, unknown>;
  const dono = (e.dono ?? {}) as Record<string, unknown>;
  if (typeof dono.identity !== "string" || !dono.identity) return null;
  const fase = e.fase === "ouvindo" || e.fase === "pausada" ? e.fase : "encerrada";
  return {
    dono: { identity: dono.identity, nome: typeof dono.nome === "string" ? dono.nome : "" },
    fase,
    escrevendo: e.escrevendo === true,
    desde: typeof e.desde === "number" ? e.desde : 0,
    salva: e.salva === true,
    ataId: typeof e.ataId === "string" && /^[0-9a-f-]{36}$/i.test(e.ataId) ? e.ataId : "",
    escritaAte: typeof e.escritaAte === "number" ? e.escritaAte : 0,
  };
}

/** Insere mantendo a ordem de quando cada frase começou a ser dita. */
function comFala(lista: FalaDaReuniao[], fala: FalaDaReuniao): FalaDaReuniao[] {
  if (lista.some((f) => f.id === fala.id)) return lista;
  const nova = [...lista, fala];
  nova.sort((a, b) => a.at - b.at);
  // Reunião de 3 horas cabe com folga; é a transcrição que vai para a ata final.
  return nova.slice(-4000);
}

export function useAtaDaReuniao(o: {
  roomName: string;
  titulo: string;
  chat: LinhaDoChat[];
  autoIniciar: boolean;
  /** A ata começou sozinha (`autoIniciar`) ou por outra pessoa — a tela decide o que mostrar. */
  aoComecar?: (como: "automatico" | "por-outro", quem: string) => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { users, saveMinute } = useFluxo();

  const [estado, setEstado] = useState<EstadoDaAta | null>(null);
  const [falas, setFalas] = useState<FalaDaReuniao[]>([]);
  const [ata, setAta] = useState<AtaAoVivo>(ATA_VAZIA);
  const [transcrevendo, setTranscrevendo] = useState(0);
  const [falandoAgora, setFalandoAgora] = useState<string[]>([]);
  const [legendas, setLegendas] = useState<Legenda[]>([]);
  const mostrarLegenda = useCallback((l: Legenda) => {
    setLegendas((lista) =>
      [...lista.filter((x) => x.id !== l.id), { ...l, at: Date.now() }].slice(-3),
    );
  }, []);
  useEffect(() => {
    if (!legendas.length) return;
    const id = window.setTimeout(
      () => setLegendas((lista) => lista.filter((x) => Date.now() - x.at < LEGENDA_MS)),
      1000,
    );
    return () => window.clearTimeout(id);
  }, [legendas]);
  const [donoSaiu, setDonoSaiu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const eu = {
    identity: localParticipant.identity,
    nome: nomeCurto(localParticipant.name || localParticipant.identity || "Eu"),
  };
  const souDono = !!estado && estado.dono.identity === eu.identity;
  const capturando = souDono && estado?.fase === "ouvindo";

  /* Quem as funções assíncronas leem: a resposta da IA chega segundos depois,
     e o que vale é o estado de AGORA. */
  const estadoRef = useRef(estado);
  const falasRef = useRef(falas);
  const ataRef = useRef(ata);
  const transcrevendoRef = useRef(0);
  const pendentesRef = useRef<FalaDaReuniao[]>([]);
  const pendenteDesdeRef = useRef(0);
  const chatRef = useRef(o.chat);
  const chatJaEscritoRef = useRef(0);
  const escrevendoRef = useRef<Promise<boolean> | null>(null);
  const ultimoSinalRef = useRef(0);
  const pararCapturaRef = useRef<(() => void) | null>(null);
  const vivoRef = useRef(true);
  /** Todo mundo que passou pela reunião, e não só quem está nela no fim. */
  const participantesRef = useRef(new Map<string, { nome: string; curto: string }>());
  const opcoesRef = useRef(o);
  useEffect(() => {
    chatRef.current = o.chat;
    opcoesRef.current = o;
  });
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  const trocarEstado = (novo: EstadoDaAta | null) => {
    estadoRef.current = novo;
    setEstado(novo);
  };
  const trocarFalas = (f: (atual: FalaDaReuniao[]) => FalaDaReuniao[]) => {
    falasRef.current = f(falasRef.current);
    setFalas(falasRef.current);
  };
  const trocarAta = (nova: AtaAoVivo) => {
    ataRef.current = nova;
    setAta(nova);
  };

  /* O mesmo erro em cada frase (sem crédito, chave recusada) vira um aviso só. */
  const ultimoAviso = useRef({ msg: "", em: 0 });
  const avisar = (msg: string) => {
    if (msg === ultimoAviso.current.msg && Date.now() - ultimoAviso.current.em < 60_000) return;
    ultimoAviso.current = { msg, em: Date.now() };
    toast.error(`Ata da reunião: ${msg}`);
  };

  /* ---------------- Canal com a sala ---------------- */

  const enviar = useCallback(
    (msg: Mensagem, para?: string[]) => {
      if (!room || room.state !== "connected") return;
      void room.localParticipant
        .sendText(JSON.stringify(msg), { topic: TOPICO, destinationIdentities: para })
        .catch(() => {});
    },
    [room],
  );

  const publicar = (mudanca: Partial<EstadoDaAta>) => {
    const atual = estadoRef.current;
    if (!atual) return;
    const novo = { ...atual, ...mudanca };
    trocarEstado(novo);
    if (novo.dono.identity === localParticipant.identity) enviar({ k: "estado", estado: novo });
  };

  const lembrarParticipante = (identity: string, nome: string) => {
    if (!identity) return;
    participantesRef.current.set(identity, {
      nome: nome || identity,
      curto: nomeCurto(nome || identity),
    });
  };

  const sessaoConhecidaRef = useRef("");
  /** Quem sai espera a resposta de quem vai continuar (ver `passarAAta`). */
  const aoAssumirRef = useRef<((quem: string) => void) | null>(null);
  const receberRef = useRef<(msg: Mensagem, de: string) => void>(() => {});
  receberRef.current = (msg, de) => {
    const atual = estadoRef.current;
    const euId = localParticipant.identity;
    switch (msg.k) {
      case "estado":
      case "tudo": {
        const chegou = estadoDaEntrada(msg.estado);
        // Só o próprio dono fala pelo estado da ata.
        if (!chegou || chegou.dono.identity !== de) return;
        const souDonoAtivo = atual?.dono.identity === euId && atual.fase !== "encerrada";
        // Um dono antigo encerrando não derruba quem escreve agora.
        if (souDonoAtivo && chegou.fase === "encerrada") return;
        if (souDonoAtivo && chegou.fase !== "encerrada") {
          /* Dois donos ao mesmo tempo. Na MESMA ata (o dono caiu, alguém
             assumiu e ele voltou), fica quem assumiu — o mais recente —, senão
             quem voltou apagaria o que foi escrito na ausência dele. Em atas
             diferentes (entraram juntos com a ata automática), fica a que
             começou antes. Quem cede entrega as falas que só ele tinha. */
          const mesmaAta = !!atual.ataId && atual.ataId === chegou.ataId;
          const euFico = mesmaAta
            ? atual.desde > chegou.desde ||
              (atual.desde === chegou.desde && euId < chegou.dono.identity)
            : atual.desde < chegou.desde ||
              (atual.desde === chegou.desde && euId < chegou.dono.identity);
          if (euFico) {
            enviar({ k: "estado", estado: atual }, [de]);
            return;
          }
          pararCapturaRef.current?.();
          void descarregarTudo().then(() => {
            if (mesmaAta) enviar({ k: "juntar", falas: falasRef.current }, [de]);
          });
          pendentesRef.current = [];
        }
        const novoDono = atual?.dono.identity !== chegou.dono.identity;
        ultimoSinalRef.current = Date.now();
        setDonoSaiu(false);
        trocarEstado(chegou);
        /* Cada ata é identificada pelo dono + quando ele começou. Ata que eu
           ainda não conhecia (outra pessoa assumiu, ou o dono começou uma nova
           depois de salvar): o que tenho aqui não vale mais, e peço o conteúdo
           dela ao dono. */
        const sessao = `${chegou.dono.identity}:${chegou.desde}`;
        if (msg.k === "tudo") {
          sessaoConhecidaRef.current = sessao;
          const recebidas = (Array.isArray(msg.falas) ? msg.falas : [])
            .map(falaDaEntrada)
            .filter((f): f is FalaDaReuniao => !!f);
          trocarFalas(() => recebidas.reduce(comFala, [] as FalaDaReuniao[]));
          trocarAta(ataDaEntrada(msg.ata));
        } else if (sessaoConhecidaRef.current !== sessao) {
          sessaoConhecidaRef.current = sessao;
          enviar({ k: "pedir" }, [de]);
        }
        if (novoDono && chegou.fase === "ouvindo" && chegou.dono.identity !== euId) {
          opcoesRef.current.aoComecar?.("por-outro", chegou.dono.nome);
        }
        return;
      }
      case "legenda": {
        if (atual?.dono.identity !== de) return;
        const l = legendaDaEntrada(msg.legenda);
        if (l) mostrarLegenda(l);
        return;
      }
      case "fala": {
        if (atual?.dono.identity !== de) return;
        const fala = falaDaEntrada(msg.fala);
        if (fala) trocarFalas((lista) => comFala(lista, fala));
        return;
      }
      case "ata": {
        if (atual?.dono.identity !== de) return;
        trocarAta(ataDaEntrada(msg.ata));
        return;
      }
      case "pedir": {
        if (atual?.dono.identity !== euId) return;
        enviar({ k: "tudo", estado: atual, falas: falasRef.current, ata: ataRef.current }, [de]);
        return;
      }
      case "passar": {
        // Só quem escreve passa a ata adiante.
        if (!atual || atual.dono.identity !== de || atual.salva) return;
        const chegou = estadoDaEntrada(msg.estado);
        const recebidas = (Array.isArray(msg.falas) ? msg.falas : [])
          .map(falaDaEntrada)
          .filter((f): f is FalaDaReuniao => !!f);
        trocarFalas((lista) => recebidas.reduce(comFala, lista));
        trocarAta(ataDaEntrada(msg.ata));
        const faltava = new Set(Array.isArray(msg.pendentes) ? msg.pendentes : []);
        pendentesRef.current = falasRef.current.filter((f) => faltava.has(f.id));
        trocarEstado({ ...(chegou ?? atual), fase: "encerrada", escrevendo: false });
        enviar({ k: "assumi" }, [de]);
        iniciar(false, chegou?.fase === "pausada" ? "pausada" : "ouvindo");
        toast.info(`${atual.dono.nome} saiu da reunião. A ata continua com você.`, {
          id: "ata-passada",
          description: "Nada do que foi dito se perdeu. Ela é salva quando a reunião acabar.",
        });
        return;
      }
      case "assumi": {
        aoAssumirRef.current?.(de);
        return;
      }
      case "juntar": {
        // Só o dono de agora junta; as falas entram no lugar certo pela hora.
        if (atual?.dono.identity !== euId) return;
        const vindas = (Array.isArray(msg.falas) ? msg.falas : [])
          .map(falaDaEntrada)
          .filter((f): f is FalaDaReuniao => !!f);
        if (!vindas.length) return;
        trocarFalas((lista) => vindas.reduce(comFala, lista));
        for (const f of vindas) enviar({ k: "fala", fala: f });
        return;
      }
    }
  };

  useEffect(() => {
    if (!room) return;
    const aoReceber: TextStreamHandler = async (reader, info) => {
      try {
        const msg = JSON.parse(await reader.readAll()) as Mensagem;
        if (msg && typeof msg === "object" && "k" in msg) receberRef.current(msg, info.identity);
      } catch {
        /* mensagem torta não derruba a ata */
      }
    };
    try {
      room.registerTextStreamHandler(TOPICO, aoReceber);
    } catch {
      /* já registrado nesta sala */
    }
    return () => {
      try {
        room.unregisterTextStreamHandler(TOPICO);
      } catch {
        /* ignore */
      }
    };
  }, [room]);

  /* Quem chega pergunta se já tem ata. A pergunta espera a conexão: antes dela
     o envio não sai. */
  useEffect(() => {
    if (!room) return;
    let feito = false;
    const tentar = () => {
      if (feito || room.state !== "connected") return;
      feito = true;
      enviar({ k: "pedir" });
    };
    const id = window.setInterval(tentar, 1000);
    tentar();
    return () => window.clearInterval(id);
  }, [room, enviar]);

  /* Participantes: quem está e quem passou, e o dono que saiu. */
  useEffect(() => {
    if (!room) return;
    const lembrarTodos = () => {
      lembrarParticipante(localParticipant.identity, localParticipant.name || "");
      room.remoteParticipants.forEach((p) => lembrarParticipante(p.identity, p.name || ""));
    };
    lembrarTodos();
    const aoSair = (p: { identity: string }) => {
      const atual = estadoRef.current;
      if (atual && atual.dono.identity === p.identity && atual.fase !== "encerrada") {
        setDonoSaiu(true);
        trocarEstado({ ...atual, fase: "encerrada", escrevendo: false });
      }
    };
    /* Quem já estava na sala quando eu entrei não gera "entrou": sem o
       Connected e a revisão periódica, a ata saía com "participantes não
       identificados". */
    room.on(RoomEvent.Connected, lembrarTodos);
    room.on(RoomEvent.ParticipantConnected, lembrarTodos);
    room.on(RoomEvent.ParticipantDisconnected, aoSair);
    const revisao = window.setInterval(lembrarTodos, 10_000);
    return () => {
      window.clearInterval(revisao);
      room.off(RoomEvent.Connected, lembrarTodos);
      room.off(RoomEvent.ParticipantConnected, lembrarTodos);
      room.off(RoomEvent.ParticipantDisconnected, aoSair);
    };
  }, [room, localParticipant]);

  /* O sinal do dono, e a vigia de quem acompanha. */
  useEffect(() => {
    const id = window.setInterval(() => {
      const atual = estadoRef.current;
      if (!atual) return;
      if (atual.dono.identity === localParticipant.identity) {
        if (atual.fase !== "encerrada") enviar({ k: "estado", estado: atual });
      } else if (
        atual.fase !== "encerrada" &&
        Date.now() - ultimoSinalRef.current > DONO_SUMIU_MS
      ) {
        setDonoSaiu(true);
        trocarEstado({ ...atual, fase: "encerrada", escrevendo: false });
      }
    }, SINAL_MS);
    return () => window.clearInterval(id);
  }, [enviar, localParticipant]);

  /* ---------------- Ouvir ---------------- */

  /** As frases de cada pessoa esperando para virar um bloco da ata. */
  const blocosRef = useRef(
    new Map<
      string,
      { trechos: TrechoDeFala[]; duracaoMs: number; falaMs: number; ultimoFim: number }
    >(),
  );
  const blocosNoArRef = useRef(new Set<Promise<void>>());

  /** Transcreve o bloco de uma pessoa (e guarda o áudio dele no Blob). */
  const descarregarRef = useRef<(quem: string) => Promise<void>>(async () => {});
  descarregarRef.current = (quem) => {
    const b = blocosRef.current.get(quem);
    blocosRef.current.delete(quem);
    const ataId = estadoRef.current?.ataId;
    if (!b || !b.trechos.length || !ataId) return Promise.resolve();
    const trabalho = (async () => {
      transcrevendoRef.current++;
      setTranscrevendo(transcrevendoRef.current);
      try {
        const wav = await juntarEmWav(b.trechos.map((t) => t.audio));
        if (!wav) return;
        const inicio = b.trechos[0]!.inicio;
        const blocoId = crypto.randomUUID();
        const nomes = [...participantesRef.current.values()].map((p) => p.curto).slice(0, 60);
        // O fim do bloco anterior da mesma pessoa: o raciocínio costuma continuar.
        const anterior = falasRef.current
          .filter((f) => f.quem === quem && inicio - f.at < 300_000)
          .slice(-1)
          .map((f) => f.texto)
          .join(" ")
          .slice(-400);
        const r = await transcreverBlocoDaReuniao({
          data: { ataId, blocoId, audio: await paraBase64(wav), nomes, falaMs: b.falaMs, anterior },
        });
        if (!vivoRef.current || !r.texto) return;
        const fala: FalaDaReuniao = {
          id: blocoId,
          at: inicio,
          hora: horaDe(inicio),
          quem,
          texto: r.texto,
          audio: r.guardado ? blocoId : undefined,
        };
        trocarFalas((lista) => comFala(lista, fala));
        enviar({ k: "fala", fala });
        setErro(null);
      } catch (e) {
        if (!vivoRef.current) return;
        const msg = mensagemDe(e);
        setErro(msg);
        avisar(msg);
      } finally {
        transcrevendoRef.current = Math.max(0, transcrevendoRef.current - 1);
        if (vivoRef.current) setTranscrevendo(transcrevendoRef.current);
      }
    })();
    blocosNoArRef.current.add(trabalho);
    void trabalho.finally(() => blocosNoArRef.current.delete(trabalho));
    return trabalho;
  };

  /** Fecha todos os blocos abertos e espera a transcrição de cada um. */
  const descarregarTudo = async () => {
    for (const quem of [...blocosRef.current.keys()]) void descarregarRef.current(quem);
    await Promise.all([...blocosNoArRef.current]);
  };

  /* Um bloco fecha quando a pessoa para de falar por uns segundos, quando
     junta fala demais ou quando a primeira frase dele já esperou demais. */
  useEffect(() => {
    if (!souDono) return;
    const id = window.setInterval(() => {
      const agora = Date.now();
      for (const [quem, b] of blocosRef.current) {
        const primeira = b.trechos[0]?.inicio ?? agora;
        if (agora - b.ultimoFim >= FIM_DE_TURNO_MS || agora - primeira >= BLOCO_ESPERA_MAX_MS) {
          void descarregarRef.current(quem);
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [souDono]);

  const transcreverRef = useRef<(t: TrechoDeFala, quem: string) => Promise<void>>(async () => {});
  transcreverRef.current = async (t, quem) => {
    // 1) Para a ata: a frase entra no bloco da pessoa.
    const atual = blocosRef.current.get(quem);
    if (atual && atual.duracaoMs + t.duracaoMs > BLOCO_MAX_MS) void descarregarRef.current(quem);
    const b = blocosRef.current.get(quem) ?? { trechos: [], duracaoMs: 0, falaMs: 0, ultimoFim: 0 };
    b.trechos.push(t);
    b.duracaoMs += t.duracaoMs;
    b.falaMs += t.falaMs;
    b.ultimoFim = Date.now();
    blocosRef.current.set(quem, b);

    // 2) Para a legenda: a frase sozinha, na hora. Não vai para a ata.
    try {
      const nomes = [...participantesRef.current.values()].map((p) => p.curto).slice(0, 60);
      const r = await transcreverVoz({
        data: {
          audio: await paraBase64(t.audio),
          mime: t.audio.type,
          nomes,
          contexto: "reuniao",
          falaMs: t.falaMs,
        },
      });
      if (!vivoRef.current || !r.texto) return;
      const legenda: Legenda = {
        id: `${t.inicio.toString(36)}-${quem}`,
        quem,
        texto: r.texto,
        at: t.inicio,
      };
      mostrarLegenda(legenda);
      enviar({ k: "legenda", legenda });
    } catch {
      /* Legenda que falha não é avisada: a ata usa o bloco, não esta frase. */
    }
  };

  useEffect(() => {
    if (!capturando || !room || !gravacaoSuportada()) return;

    const contexto = new AudioContext();
    void contexto.resume().catch(() => {});
    const ativos = new Map<string, { trilha: MediaStreamTrack; parar: () => void }>();

    const marcarFalando = (nome: string, sim: boolean) =>
      setFalandoAgora((lista) =>
        sim ? (lista.includes(nome) ? lista : [...lista, nome]) : lista.filter((n) => n !== nome),
      );

    /* Liga um corte por microfone. Microfone fechado (mudo) não é ouvido: o
       corte dele para, e o que a pessoa disse antes de fechar ainda vai. */
    const ligar = (identity: string, nome: string, pub: TrackPublication | undefined) => {
      const trilha = pub && !pub.isMuted ? pub.track?.mediaStreamTrack : undefined;
      if (!trilha || trilha.readyState !== "live") return false;
      const atual = ativos.get(identity);
      if (atual?.trilha === trilha) return true;
      atual?.parar();
      const fluxo = new MediaStream([trilha]);
      const fonte = contexto.createMediaStreamSource(fluxo);
      const analisador = contexto.createAnalyser();
      analisador.fftSize = 512;
      fonte.connect(analisador);
      const quem = nomeCurto(nome || identity);
      const segmentador = criarSegmentador({
        fluxo,
        analisador,
        /* Reunião tem mais pausa de pensamento no meio da frase do que ditado.
           Trecho mais longo também transcreve melhor: o modelo ouve a frase
           inteira em vez de pedaços soltos. */
        pausaQueCortaMs: 1500,
        // 20 s e não mais: trecho longo dá mais espaço para o modelo "completar".
        trechoMaximoMs: 20_000,
        aoTrecho: (t) => void transcreverRef.current(t, quem),
        aoFalar: (sim) => marcarFalando(quem, sim),
      });
      ativos.set(identity, {
        trilha,
        parar: () => {
          segmentador.parar(true);
          fonte.disconnect();
          marcarFalando(quem, false);
        },
      });
      return true;
    };

    /* Refeito a cada 2 s e a cada evento de faixa: gente entra e sai, abre e
       fecha o microfone, troca de aparelho (a faixa muda por baixo). Conferir
       tudo de novo é mais simples e mais seguro do que acompanhar cada evento. */
    const sincronizar = () => {
      const vistos = new Set<string>();
      const eu = room.localParticipant;
      if (ligar(eu.identity, eu.name || "", eu.getTrackPublication(Track.Source.Microphone)))
        vistos.add(eu.identity);
      room.remoteParticipants.forEach((p) => {
        if (ligar(p.identity, p.name || "", p.getTrackPublication(Track.Source.Microphone)))
          vistos.add(p.identity);
      });
      for (const [identity, a] of ativos) {
        if (vistos.has(identity)) continue;
        a.parar();
        ativos.delete(identity);
      }
    };

    const pararTudo = () => {
      window.clearInterval(relogio);
      eventos.forEach((ev) => room.off(ev, sincronizar));
      ativos.forEach((a) => a.parar());
      ativos.clear();
      // Fecha depois: o último trecho de cada um ainda está sendo finalizado.
      window.setTimeout(() => void contexto.close().catch(() => {}), 1500);
    };

    const eventos = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    eventos.forEach((ev) => room.on(ev, sincronizar));
    const relogio = window.setInterval(sincronizar, 2000);
    sincronizar();

    let parado = false;
    pararCapturaRef.current = () => {
      if (parado) return;
      parado = true;
      pararTudo();
    };
    return () => {
      pararCapturaRef.current?.();
      pararCapturaRef.current = null;
      setFalandoAgora([]);
    };
  }, [capturando, room]);

  /* ---------------- Escrever ---------------- */

  const participantesDaAta = () => [...participantesRef.current.values()].map((p) => p.curto);

  /* Durante a reunião a IA não escreve nada (19/10/2026): ela só transcreve,
     e a ata sai no fim, numa leitura só da transcrição inteira — como fazem
     os gravadores de reunião. Reescrever a ata a cada meio minuto olhando
     pedaços da conversa interpretava errado e custava caro. O que roda aqui é
     o rascunho: a transcrição vai para Atas & Planos a cada minuto, para
     nada se perder se a aba fechar. */
  useEffect(() => {
    if (!souDono) return;
    const id = window.setInterval(() => void salvarRascunhoRef.current(false), 15_000);
    return () => window.clearInterval(id);
  }, [souDono]);

  /* ---------------- Rascunho em Atas & Planos ---------------- */

  /** Uma linha por pessoa: o nome do cadastro quando a identidade casa com alguém. */
  const participantesParaSalvar = () => {
    const vistos = new Map<string, string | null>();
    for (const [identity, p] of participantesRef.current) {
      const id = identity.split("-")[0] ?? "";
      const pessoa = users.find((u) => u.id === id);
      const nome = pessoa?.name ?? p.nome;
      if (!vistos.has(nome) || pessoa) vistos.set(nome, pessoa ? id : null);
    }
    return [...vistos].map(([nome, pessoaId]) => ({ nome, pessoaId }));
  };

  const ultimoRascunhoRef = useRef(0);
  const versaoDoRascunhoRef = useRef("");
  const salvarRascunhoRef = useRef<(forcar: boolean) => Promise<void>>(async () => {});
  salvarRascunhoRef.current = async (forcar) => {
    const atual = estadoRef.current;
    if (!atual || atual.dono.identity !== localParticipant.identity || atual.salva || !atual.ataId)
      return;
    if (!forcar && Date.now() - ultimoRascunhoRef.current < RASCUNHO_MS) return;
    if (!ataTemConteudo(ataRef.current) && falasRef.current.length === 0) return;
    // Nada novo desde o último rascunho: não regrava (é o banco compartilhado).
    const versao = `${participantesRef.current.size}:${falasRef.current.length}:${falasRef.current.at(-1)?.id ?? ""}:${JSON.stringify(ataRef.current).length}`;
    if (!forcar && versao === versaoDoRascunhoRef.current) return;
    versaoDoRascunhoRef.current = versao;
    ultimoRascunhoRef.current = Date.now();
    const titulo = opcoesRef.current.titulo;
    try {
      const api = await import("@/lib/atas.functions");
      await api.salvarAta({
        data: {
          id: atual.ataId,
          roomName: opcoesRef.current.roomName,
          roomLabel: titulo,
          markdown: ataParaMarkdown(ataRef.current, {
            titulo,
            participantes: participantesDaAta(),
            emAndamento: true,
            transcricao: falasRef.current,
          }),
          participantes: participantesParaSalvar(),
          topicos: topicosDaAta(ataRef.current).map((t) => ({
            id: idDoTopico(atual.ataId, t.kind, t.text),
            text: t.text,
            kind: t.kind,
          })),
        },
      });
    } catch (e) {
      // O próximo rascunho tenta de novo; a ata continua na memória e na sala.
      versaoDoRascunhoRef.current = "";
      console.warn("[ata] rascunho não gravou:", (e as Error)?.message);
    }
  };

  /**
   * Quem escreve vai sair e ainda tem gente na sala: passa a ata para outra
   * pessoa em vez de salvar e fechar. Devolve false quando ninguém pôde
   * assumir — aí quem chamou salva a ata como antes.
   */
  const passarAAta = async (): Promise<boolean> => {
    const atual = estadoRef.current;
    if (!room || !atual || atual.dono.identity !== localParticipant.identity) return false;
    if (atual.salva || atual.fase === "encerrada") return false;
    // Só quem tem login: convidado de fora não consegue chamar a transcrição.
    const candidatos = [...room.remoteParticipants.values()]
      .filter((p) => users.some((u) => u.id === (p.identity.split("-")[0] ?? "")))
      .sort((a, b) => a.identity.localeCompare(b.identity));
    if (!candidatos.length) return false;

    pararCapturaRef.current?.();
    // O último trecho de cada microfone ainda vai para a transcrição.
    await esperar(600);
    await descarregarTudo();
    const limite = Date.now() + 8_000;
    while (transcrevendoRef.current > 0 && Date.now() < limite) await esperar(200);
    if (escrevendoRef.current) await Promise.race([escrevendoRef.current, esperar(15_000)]);
    await salvarRascunhoRef.current(true);
    /* Daqui em diante eu não escrevo mais: sem isto, o aviso de quem assumiu
       cairia no desempate de "dois donos" e a ata voltaria para mim. Não vai
       para a sala — se ninguém assumir, quem chamou salva a ata. */
    trocarEstado({ ...(estadoRef.current ?? atual), fase: "encerrada", escrevendo: false });

    for (const c of candidatos.slice(0, 3)) {
      const aceitou = await new Promise<boolean>((resolver) => {
        const prazo = window.setTimeout(() => {
          aoAssumirRef.current = null;
          resolver(false);
        }, PASSAR_ESPERA_MS);
        aoAssumirRef.current = (quem) => {
          if (quem !== c.identity) return;
          window.clearTimeout(prazo);
          aoAssumirRef.current = null;
          resolver(true);
        };
        enviar(
          {
            k: "passar",
            estado: { ...(estadoRef.current ?? atual), fase: atual.fase },
            falas: falasRef.current,
            ata: ataRef.current,
            pendentes: pendentesRef.current.map((f) => f.id),
          },
          [c.identity],
        );
      });
      if (aceitou) {
        const nome = nomeCurto(c.name || c.identity);
        pendentesRef.current = [];
        trocarEstado({
          ...(estadoRef.current ?? atual),
          dono: { identity: c.identity, nome },
          escrevendo: false,
        });
        toast.success(`A ata continua com ${nome}`);
        return true;
      }
    }
    /* Ninguém assumiu: volta a ouvir como antes. Se a pessoa desistir de sair,
       a reunião continua sendo transcrita; se sair, quem chamou salva a ata. */
    trocarEstado({ ...(estadoRef.current ?? atual), fase: atual.fase, escrevendo: false });
    return false;
  };

  /* ---------------- Ações ---------------- */

  const iniciar = useCallback(
    (automatico = false, fase: FaseDaAta = "ouvindo") => {
      const atual = estadoRef.current;
      const outroEscrevendo =
        !!atual && atual.dono.identity !== localParticipant.identity && atual.fase !== "encerrada";
      if (outroEscrevendo) return;
      // Ata já salva: começar de novo é uma ata nova, em branco.
      if (atual?.salva) {
        trocarFalas(() => []);
        trocarAta(ATA_VAZIA);
        pendentesRef.current = [];
        ultimoRascunhoRef.current = 0;
      }
      const continua = !!atual && !atual.salva;
      /* Continuando a ata de quem saiu: o que ele não chegou a escrever entra
         na próxima escrita. */
      if (continua && !pendentesRef.current.length) {
        pendentesRef.current = falasRef.current.filter((f) => f.at > (atual.escritaAte || 0));
      }
      if (pendentesRef.current.length) pendenteDesdeRef.current = Date.now();
      /* Assumindo a ata de quem saiu, o chat até aqui já foi escrito por ele —
         mandar de novo ao Claude repetiria itens. */
      if (atual) chatJaEscritoRef.current = Date.now();
      const novo: EstadoDaAta = {
        dono: {
          identity: localParticipant.identity,
          nome: nomeCurto(localParticipant.name || "Eu"),
        },
        fase,
        escrevendo: false,
        desde: Date.now(),
        salva: false,
        ataId: continua && atual.ataId ? atual.ataId : crypto.randomUUID(),
        escritaAte: continua ? atual.escritaAte : 0,
      };
      sessaoConhecidaRef.current = `${novo.dono.identity}:${novo.desde}`;
      trocarEstado(novo);
      setDonoSaiu(false);
      setErro(null);
      enviar({ k: "estado", estado: novo });
      if (automatico) opcoesRef.current.aoComecar?.("automatico", novo.dono.nome);
    },
    [localParticipant, enviar],
  );

  const pausar = () => publicar({ fase: "pausada" });
  const retomar = () => publicar({ fase: "ouvindo" });

  const donoSaiuRef = useRef(donoSaiu);

  /* Ata automática: espera a sala responder se já existe ata antes de começar
     uma. Se o dono sair no meio, quem tem a opção ligada continua sozinho. */
  useEffect(() => {
    if (!o.autoIniciar || !room) return;
    let feito = false;
    const id = window.setInterval(() => {
      if (feito || room.state !== "connected") return;
      const atual = estadoRef.current;
      if (atual && !donoSaiuRef.current) {
        feito = true;
        return;
      }
      feito = true;
      iniciar(true);
    }, 5000);
    return () => window.clearInterval(id);
  }, [o.autoIniciar, room, iniciar]);

  /* O dono caiu sem passar a ata: a sala continua sozinha. Quem assume sai de
     uma fila igual em todas as máquinas (as identidades em ordem, só quem tem
     login); se a primeira pessoa não assumir em alguns segundos, a seguinte
     tenta. O que ela já tinha recebido pela sala — falas e ata — continua. */
  useEffect(() => {
    donoSaiuRef.current = donoSaiu;
    if (!donoSaiu || !room) return;
    const atual = estadoRef.current;
    if (!atual || atual.salva) return;
    const fila = [room.localParticipant, ...room.remoteParticipants.values()]
      .map((p) => p.identity)
      .filter(
        (id) => id !== atual.dono.identity && users.some((u) => u.id === (id.split("-")[0] ?? "")),
      )
      .sort();
    const vez = fila.indexOf(localParticipant.identity);
    if (vez < 0) return;
    const quemSaiu = atual.dono.nome;
    const id = window.setTimeout(
      () => {
        if (!donoSaiuRef.current) return;
        iniciar(false);
        toast.info(`${quemSaiu} saiu da reunião. A ata continua com você.`, {
          id: "ata-passada",
          description: "Nada do que foi dito se perdeu. Ela é salva quando a reunião acabar.",
        });
      },
      1200 + vez * VEZ_NA_FILA_MS,
    );
    return () => window.clearTimeout(id);
  }, [donoSaiu, iniciar, room, users, localParticipant]);

  const temConteudoNaoSalvo = () => {
    const atual = estadoRef.current;
    if (atual) {
      return (
        atual.dono.identity === localParticipant.identity &&
        !atual.salva &&
        (falasRef.current.length > 0 || ataTemConteudo(ataRef.current))
      );
    }
    return chatRef.current.length > 0;
  };

  /**
   * Para de ouvir, escreve a versão final e salva em Atas & Planos.
   *
   * A versão final lê a transcrição INTEIRA de uma vez (`redigirAtaFinal`).
   * Se ela falhar, vale a ata escrita durante a reunião, completada com o que
   * faltava — e a transcrição vai junto de qualquer jeito. Só devolve false
   * quando não sobrou nada para salvar e a IA falhou.
   */
  /* "Finalizar e salvar" no painel e "Salvar e sair" podem chegar juntos (a
     versão final leva um minuto): o segundo espera o primeiro, não refaz. */
  const finalizandoRef = useRef<Promise<boolean> | null>(null);
  const finalizarESalvar = (): Promise<boolean> => {
    if (finalizandoRef.current) return finalizandoRef.current;
    const trabalho = finalizarDeVerdade().finally(() => {
      finalizandoRef.current = null;
    });
    finalizandoRef.current = trabalho;
    return trabalho;
  };

  const finalizarDeVerdade = async (): Promise<boolean> => {
    let atual = estadoRef.current;
    if (atual && atual.dono.identity !== localParticipant.identity) return true;
    if (!atual) {
      // Reunião sem ata aberta, só com chat: a ata sai do chat.
      atual = {
        dono: {
          identity: localParticipant.identity,
          nome: nomeCurto(localParticipant.name || "Eu"),
        },
        fase: "encerrada",
        escrevendo: false,
        desde: Date.now(),
        salva: false,
        ataId: crypto.randomUUID(),
        escritaAte: 0,
      };
      trocarEstado(atual);
    }
    if (atual.salva) return true;
    const ataId = atual.ataId || crypto.randomUUID();

    publicar({ fase: "encerrada" });
    pararCapturaRef.current?.();
    if (room) {
      lembrarParticipante(localParticipant.identity, localParticipant.name || "");
      room.remoteParticipants.forEach((p) => lembrarParticipante(p.identity, p.name || ""));
    }
    // O último trecho de cada microfone ainda vai para a transcrição.
    await esperar(600);
    await descarregarTudo();
    const limite = Date.now() + 15_000;
    while (transcrevendoRef.current > 0 && Date.now() < limite) await esperar(200);
    if (escrevendoRef.current) await escrevendoRef.current;
    // Se a aba fechar durante a redação final, o rascunho com tudo já está salvo.
    await salvarRascunhoRef.current(true);

    const titulo = opcoesRef.current.titulo;
    const linha = (f: FalaDaReuniao) => ({ hora: f.hora, quem: f.quem, texto: f.texto });
    const chat = chatRef.current.map((l) => ({
      hora: horaDe(l.at),
      quem: nomeCurto(l.from),
      texto: l.text,
    }));

    let final: AtaAoVivo | null = null;
    if (falasRef.current.length || chat.length) {
      publicar({ escrevendo: true });
      const aviso = toast.loading("Escrevendo a versão final da ata…", {
        description: "Lendo a reunião inteira, do começo ao fim. Pode levar um minuto.",
      });
      try {
        const r = await redigirAtaFinalDaReuniao({
          data: {
            titulo,
            data: new Date().toLocaleDateString("pt-BR"),
            participantes: participantesDaAta(),
            rascunho: ataRef.current,
            falas: falasRef.current.map(linha),
            chat,
          },
        });
        final = r.ata;
        trocarAta(r.ata);
        enviar({ k: "ata", ata: r.ata });
      } catch (e) {
        console.warn("[ata] versão final falhou:", mensagemDe(e));
      } finally {
        toast.dismiss(aviso);
        if (vivoRef.current) publicar({ escrevendo: false });
      }
    }

    if (!final) {
      // As duas IAs falharam: a reunião não se perde, vai a transcrição inteira.
      final = ataRef.current;
      if (falasRef.current.length) {
        toast.warning("A ata não pôde ser escrita agora", {
          description: "A transcrição completa da reunião foi salva em Atas & Planos.",
        });
      }
    }

    if (!ataTemConteudo(final) && !falasRef.current.length && !ultimoRascunhoRef.current) {
      publicar({ salva: true });
      toast.info("Nada do que foi dito virou ata.", {
        description: "Sem assunto, decisão ou pendência para registrar.",
      });
      return true;
    }

    const pessoas = participantesParaSalvar();
    saveMinute({
      id: ataId,
      roomName: opcoesRef.current.roomName,
      roomLabel: titulo,
      participantIds: pessoas.flatMap((p) => (p.pessoaId ? [p.pessoaId] : [])),
      participantNames: pessoas.map((p) => p.nome),
      markdown: ataParaMarkdown(final, {
        titulo,
        participantes: participantesDaAta(),
        transcricao: falasRef.current,
      }),
      topics: topicosDaAta(final).map((t) => ({ ...t, id: idDoTopico(ataId, t.kind, t.text) })),
    });
    publicar({ salva: true });
    toast.success("Ata salva em Atas & Planos");
    return true;
  };

  return {
    estado,
    souDono,
    /** O que acabou de ser dito, para a legenda da reunião. */
    legendas,
    donoSaiu,
    falas,
    ata,
    /** Frases no ar para a transcrição. */
    transcrevendo,
    falandoAgora,
    erro,
    suportado: gravacaoSuportada(),
    iniciar,
    pausar,
    retomar,
    finalizarESalvar,
    passarAAta,
    temConteudoNaoSalvo,
    markdown: () =>
      ataParaMarkdown(ataRef.current, {
        titulo: opcoesRef.current.titulo,
        participantes: participantesDaAta(),
        transcricao: falasRef.current,
      }),
  };
}

export type AtaDaReuniao = ReturnType<typeof useAtaDaReuniao>;
