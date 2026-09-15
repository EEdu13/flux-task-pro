import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import type { TextStreamHandler, TrackPublication } from "livekit-client";
import { toast } from "sonner";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { criarSegmentador, gravacaoSuportada, type TrechoDeFala } from "@/lib/segmentador-de-fala";
import { atualizarAtaDaReuniao, transcreverVoz } from "@/lib/voz.functions";
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
 *   3. De tempos em tempos o Claude recebe as falas novas e devolve a ata
 *      inteira atualizada (`atualizarAtaDaReuniao`).
 *
 * Uma ata por sala, escrita por UMA pessoa: quem clicou em Ata é o "dono".
 * Só o computador dele ouve e chama as IAs — com cinco pessoas abrindo a ata,
 * seriam cinco transcrições da mesma fala e cinco contas. Os outros recebem as
 * falas e a ata pelo canal de dados do LiveKit e acompanham ao vivo. Se o dono
 * sai da reunião, outra pessoa continua de onde parou.
 *
 * O botão da Ata acende para todo mundo enquanto alguém escreve: quem está na
 * sala precisa saber que a fala está sendo transcrita.
 */

const TOPICO = "fluxo-ata";
/** O dono repete o estado de tempos em tempos: quem perdeu uma mensagem se acerta. */
const SINAL_MS = 15_000;
/** Sem sinal por este tempo, o dono caiu sem avisar. */
const DONO_SUMIU_MS = 50_000;
/** A primeira versão sai cedo, para a pessoa ver que funciona; as seguintes juntam mais fala. */
const PRIMEIRA_ESCRITA = { caracteres: 250, esperaMs: 12_000 };
const ESCRITA = { caracteres: 900, esperaMs: 30_000 };
/** Depois de um erro da IA (sem crédito, fora do ar), espera antes de tentar de novo. */
const PAUSA_APOS_ERRO_MS = 45_000;

export type FaseDaAta = "ouvindo" | "pausada" | "encerrada";

export interface EstadoDaAta {
  dono: { identity: string; nome: string };
  fase: FaseDaAta;
  escrevendo: boolean;
  /** Quando este dono começou — desempata dois donos ao mesmo tempo. */
  desde: number;
  salva: boolean;
}

type Mensagem =
  | { k: "estado"; estado: EstadoDaAta }
  | { k: "fala"; fala: FalaDaReuniao }
  | { k: "ata"; ata: AtaAoVivo }
  | { k: "pedir" }
  | { k: "tudo"; estado: EstadoDaAta; falas: FalaDaReuniao[]; ata: AtaAoVivo };

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
    texto: f.texto.slice(0, 1500),
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
  };
}

/** Insere mantendo a ordem de quando cada frase começou a ser dita. */
function comFala(lista: FalaDaReuniao[], fala: FalaDaReuniao): FalaDaReuniao[] {
  if (lista.some((f) => f.id === fala.id)) return lista;
  const nova = [...lista, fala];
  nova.sort((a, b) => a.at - b.at);
  return nova.slice(-600);
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
  const pausaAposErroRef = useRef(0);
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
    participantesRef.current.set(identity, { nome: nome || identity, curto: nomeCurto(nome || identity) });
  };

  const sessaoConhecidaRef = useRef("");
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
        if (souDonoAtivo && chegou.fase !== "encerrada") {
          /* Dois donos ao mesmo tempo (entraram juntos com a ata automática):
             fica quem começou antes. O outro para de ouvir e passa a acompanhar. */
          const euFico =
            atual.desde < chegou.desde || (atual.desde === chegou.desde && euId < chegou.dono.identity);
          if (euFico) {
            enviar({ k: "estado", estado: atual }, [de]);
            return;
          }
          pararCapturaRef.current?.();
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
    room.on(RoomEvent.ParticipantConnected, lembrarTodos);
    room.on(RoomEvent.ParticipantDisconnected, aoSair);
    return () => {
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
      } else if (atual.fase !== "encerrada" && Date.now() - ultimoSinalRef.current > DONO_SUMIU_MS) {
        setDonoSaiu(true);
        trocarEstado({ ...atual, fase: "encerrada", escrevendo: false });
      }
    }, SINAL_MS);
    return () => window.clearInterval(id);
  }, [enviar, localParticipant]);

  /* ---------------- Ouvir ---------------- */

  const transcreverRef = useRef<(t: TrechoDeFala, quem: string) => Promise<void>>(async () => {});
  transcreverRef.current = async (t, quem) => {
    transcrevendoRef.current++;
    setTranscrevendo(transcrevendoRef.current);
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
      const fala: FalaDaReuniao = {
        id: `${t.inicio.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        at: t.inicio,
        hora: horaDe(t.inicio),
        quem,
        texto: r.texto,
      };
      trocarFalas((lista) => comFala(lista, fala));
      if (pendentesRef.current.length === 0) pendenteDesdeRef.current = Date.now();
      pendentesRef.current.push(fala);
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
        // Reunião tem mais pausa de pensamento no meio da frase do que ditado.
        pausaQueCortaMs: 1000,
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

  const escreverRef = useRef<() => Promise<boolean>>(async () => true);
  escreverRef.current = () => {
    if (escrevendoRef.current) return escrevendoRef.current;
    const lote = pendentesRef.current.splice(0).sort((a, b) => a.at - b.at);
    const chat = chatRef.current.filter((l) => l.at > chatJaEscritoRef.current);
    if (!lote.length && !chat.length) return Promise.resolve(true);

    const trabalho = (async () => {
      publicar({ escrevendo: true });
      try {
        const doLote = new Set(lote.map((f) => f.id));
        const anteriores = falasRef.current.filter((f) => !doLote.has(f.id)).slice(-20);
        const linha = (f: FalaDaReuniao) => ({ hora: f.hora, quem: f.quem, texto: f.texto });
        const r = await atualizarAtaDaReuniao({
          data: {
            titulo: opcoesRef.current.titulo,
            data: new Date().toLocaleDateString("pt-BR"),
            participantes: participantesDaAta(),
            ata: ataRef.current,
            anteriores: anteriores.map(linha),
            novas: lote.map(linha),
            chat: chat.map((l) => ({ hora: horaDe(l.at), quem: nomeCurto(l.from), texto: l.text })),
          },
        });
        if (!vivoRef.current) return false;
        if (chat.length) chatJaEscritoRef.current = Math.max(...chat.map((l) => l.at));
        trocarAta(r.ata);
        enviar({ k: "ata", ata: r.ata });
        setErro(null);
        return true;
      } catch (e) {
        // A fala não se perde: volta para a fila e entra na próxima tentativa.
        pendentesRef.current.unshift(...lote);
        pendenteDesdeRef.current = Date.now();
        pausaAposErroRef.current = Date.now() + PAUSA_APOS_ERRO_MS;
        if (vivoRef.current) {
          const msg = mensagemDe(e);
          setErro(msg);
          avisar(msg);
        }
        return false;
      } finally {
        escrevendoRef.current = null;
        if (vivoRef.current) publicar({ escrevendo: false });
      }
    })();
    escrevendoRef.current = trabalho;
    return trabalho;
  };

  /* A ata é reescrita quando junta fala suficiente ou quando a fala mais antiga
     esperou demais — o que vier primeiro. Escrever a cada frase custaria uma
     chamada ao Claude por frase e deixaria a ata tremendo na tela. */
  useEffect(() => {
    if (!souDono) return;
    const id = window.setInterval(() => {
      if (escrevendoRef.current || Date.now() < pausaAposErroRef.current) return;
      const pendentes = pendentesRef.current;
      if (!pendentes.length) return;
      const regra = ataTemConteudo(ataRef.current) ? ESCRITA : PRIMEIRA_ESCRITA;
      const caracteres = pendentes.reduce((s, f) => s + f.texto.length, 0);
      if (
        caracteres >= regra.caracteres ||
        Date.now() - pendenteDesdeRef.current >= regra.esperaMs
      ) {
        void escreverRef.current();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [souDono]);

  /* ---------------- Ações ---------------- */

  const iniciar = useCallback(
    (automatico = false) => {
      const atual = estadoRef.current;
      const outroEscrevendo =
        !!atual && atual.dono.identity !== localParticipant.identity && atual.fase !== "encerrada";
      if (outroEscrevendo) return;
      // Ata já salva: começar de novo é uma ata nova, em branco.
      if (atual?.salva) {
        trocarFalas(() => []);
        trocarAta(ATA_VAZIA);
        pendentesRef.current = [];
      }
      /* Assumindo a ata de quem saiu, o chat até aqui já foi escrito por ele —
         mandar de novo ao Claude repetiria itens. */
      if (atual) chatJaEscritoRef.current = Date.now();
      const novo: EstadoDaAta = {
        dono: { identity: localParticipant.identity, nome: nomeCurto(localParticipant.name || "Eu") },
        fase: "ouvindo",
        escrevendo: false,
        desde: Date.now(),
        salva: false,
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

  useEffect(() => {
    donoSaiuRef.current = donoSaiu;
    if (!donoSaiu || !opcoesRef.current.autoIniciar) return;
    // Espera um pouco, sorteado: se dois assumirem juntos, o desempate resolve.
    const id = window.setTimeout(() => iniciar(true), 1500 + Math.random() * 2500);
    return () => window.clearTimeout(id);
  }, [donoSaiu, iniciar]);

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
   * Para de ouvir, escreve o que faltou e salva em Atas & Planos.
   * Devolve false só quando a IA falhou e ainda havia fala sem escrever.
   */
  const finalizarESalvar = async (): Promise<boolean> => {
    let atual = estadoRef.current;
    if (atual && atual.dono.identity !== localParticipant.identity) return true;
    if (!atual) {
      // Reunião sem ata aberta, só com chat: a ata sai do chat.
      atual = {
        dono: { identity: localParticipant.identity, nome: nomeCurto(localParticipant.name || "Eu") },
        fase: "encerrada",
        escrevendo: false,
        desde: Date.now(),
        salva: false,
      };
      trocarEstado(atual);
    }
    if (atual.salva) return true;

    publicar({ fase: "encerrada" });
    pararCapturaRef.current?.();
    // O último trecho de cada microfone ainda vai para a transcrição.
    await esperar(600);
    const limite = Date.now() + 15_000;
    while (transcrevendoRef.current > 0 && Date.now() < limite) await esperar(200);
    if (escrevendoRef.current) await escrevendoRef.current;
    pausaAposErroRef.current = 0;
    const escreveu = await escreverRef.current();
    if (!escreveu && pendentesRef.current.length) return false;

    const final = ataRef.current;
    if (!ataTemConteudo(final)) {
      publicar({ salva: true });
      toast.info("Nada do que foi dito virou ata.", {
        description: "Sem assunto, decisão ou pendência para registrar.",
      });
      return true;
    }

    const titulo = opcoesRef.current.titulo;
    const pessoas = [...participantesRef.current.entries()];
    saveMinute({
      roomName: opcoesRef.current.roomName,
      roomLabel: titulo,
      participantIds: Array.from(
        new Set(
          pessoas
            .map(([identity]) => identity.split("-")[0] ?? "")
            .filter((id) => users.some((u) => u.id === id)),
        ),
      ),
      participantNames: pessoas.map(([, p]) => p.nome),
      markdown: ataParaMarkdown(final, { titulo, participantes: participantesDaAta() }),
      topics: topicosDaAta(final).map((t) => ({ ...t, id: crypto.randomUUID() })),
    });
    publicar({ salva: true });
    toast.success("Ata salva em Atas & Planos");
    return true;
  };

  return {
    estado,
    souDono,
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
    temConteudoNaoSalvo,
    markdown: () =>
      ataParaMarkdown(ataRef.current, {
        titulo: opcoesRef.current.titulo,
        participantes: participantesDaAta(),
      }),
  };
}

export type AtaDaReuniao = ReturnType<typeof useAtaDaReuniao>;
