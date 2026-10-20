import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, Track, type Room } from "livekit-client";
import { toast } from "sonner";
import { criarSegmentador, gravacaoSuportada, type TrechoDeFala } from "@/lib/segmentador-de-fala";
import { interpretarFraseDaSala, transcreverFalaDaSala } from "@/lib/rv-cards.functions";
import { LIMIAR_DE_PUBLICAR, type CardDaSala, type MensagemCard } from "../sala/tipos";
import { Despachante, dominadoPorRemoto, type AmostraDeFalante, type Pendente } from "./despacho";
import { ehConversaDeConexao, publicarCard, semelhanca } from "./protocolo";

/**
 * "Cards por IA": o que EU falo vira card no balão em cima do meu avatar, para
 * todos verem.
 *
 *   1. A trilha do microfone que o LiveKit já publica (nada de abrir o
 *      microfone de novo: seria outro aparelho, outra permissão e o mudo do
 *      LiveKit não valeria para ela) é cortada em frases pelo segmentador.
 *   2. Cada frase vai para a transcrição; conversa de chamada e eco de outra
 *      pessoa saem antes de gastar o Claude.
 *   3. As frases se juntam num pendente (`despacho.ts`) e saem para o Claude,
 *      no máximo uma a cada 8 s.
 *   4. Card que vale a pena vai para a sala pelo canal "rv-card"; o resto fica
 *      só na minha bandeja como "não publicado".
 *
 * Mudo é sagrado: ao fechar o microfone, a frase em andamento é jogada fora e
 * tudo o que estava em voo (transcrição, card) é descartado na volta. O
 * contrato é "no mudo, nada sai" — inclusive o que foi dito um segundo antes.
 *
 * Cada pessoa transcreve só a própria voz: com cinco pessoas na sala são cinco
 * computadores dividindo o trabalho, e o card já nasce com o autor certo.
 */

export type EstadoCards =
  "desligado" | "sem-suporte" | "mudo" | "ouvindo" | "pensando" | "pausado" | "erro";

export interface ItemDaBandeja {
  id: string;
  at: number;
  situacao: "pensando" | "publicado" | "nao-publicado" | "descartado" | "apagado";
  card?: CardDaSala;
  ouvido?: string;
}

type Transcrever = (a: {
  audio: string;
  mime: string;
  nomes: string[];
  falaMs: number;
}) => Promise<{ texto: string }>;
type Interpretar = (a: {
  frase: string;
  quem: string;
  participantes: string[];
  anterior?: string;
}) => Promise<{ card: CardDaSala }>;

export interface OpcoesCardsDeFala {
  room: Room | null;
  ligado: boolean;
  meuId: string;
  meuNome: string;
  /** Primeiros nomes de quem está na sala. */
  participantes: string[];
  /** `publishData` não devolve ao remetente: o eco local entra pelo mesmo redutor do integrador. */
  aoMensagemLocal: (m: MensagemCard) => void;
  /** Cards de OUTROS nos últimos 10 s: {autorId, at, ouvido} — anti-eco e contexto. */
  ouvidosRecentes: () => { autorId: string; at: number; ouvido: string }[];
  transcrever?: Transcrever;
  interpretar?: Interpretar;
}

export interface CardsDeFala {
  estado: EstadoCards;
  /** "aba em segundo plano", "limite por minuto", erro… */
  motivo: string | null;
  /** Os meus, mais novo primeiro (≤ 10). */
  bandeja: ItemDaBandeja[];
  /** Publica {k:"apagar"} + eco local. */
  apagar: (id: string) => void;
  tentarDeNovo: () => void;
  /** Contadores para diagnóstico e testes (não é estado de tela). */
  diagnostico: {
    ecoPorFalante: number;
    ecoPorTexto: number;
    conexao: number;
    descartadosPorMudo: number;
  };
}

const BANDEJA_MAX = 10;
const FALHAS_ATE_ERRO = 3;
const ABA_OCULTA_PAUSA_MS = 5_000;
const ANEL_DE_FALANTES_MS = 30_000;
const ANTERIOR_MS = 30_000;
const ECO = 0.6;

/* Erros que não adianta repetir: a tela vai para "erro" na primeira vez, e
   com a frase certa (sem chave pede reinício; sem crédito, não). */
const SEM_CHAVE = /sem chave de ia|não está configurada/i;
const SEM_CREDITO = /sem crédito|chave .* recusada/i;

const paraBase64 = (b: Blob) =>
  new Promise<string>((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(",")[1] ?? "");
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(b);
  });

const mensagemDe = (e: unknown) =>
  (e instanceof Error && e.message) || "Algo deu errado nos cards.";

/** A última frase dita na sala (minha ou de outro) antes do pendente, nos últimos 30 s — para "isso", "concordo". */
function anteriorA(
  p: Pendente,
  minhas: { at: number; texto: string }[],
  deOutros: { at: number; ouvido: string }[],
): string | undefined {
  const agora = Date.now();
  let melhor: { at: number; texto: string } | null = null;
  for (const f of minhas)
    if (f.at < p.at && agora - f.at < ANTERIOR_MS && (!melhor || f.at > melhor.at)) melhor = f;
  for (const r of deOutros)
    if (r.at < p.at && agora - r.at < ANTERIOR_MS && (!melhor || r.at > melhor.at))
      melhor = { at: r.at, texto: r.ouvido };
  return melhor?.texto.slice(0, 600);
}

const transcreverPadrao: Transcrever = (a) => transcreverFalaDaSala({ data: a });
const interpretarPadrao: Interpretar = (a) => interpretarFraseDaSala({ data: a });

export function useCardsDeFala(o: OpcoesCardsDeFala): CardsDeFala {
  const { room, ligado, meuId } = o;
  // Sempre a última versão das opções, para os laços longos não segurarem closure velha.
  const opcoes = useRef(o);
  opcoes.current = o;

  const [bandeja, setBandeja] = useState<ItemDaBandeja[]>([]);
  const [semMic, setSemMic] = useState(true);
  const [abaOculta, setAbaOculta] = useState(false);
  const [limite, setLimite] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  const despachante = useRef<Despachante | null>(null);
  if (!despachante.current || despachante.current.meuId !== meuId)
    despachante.current = new Despachante(meuId);
  const contexto = useRef<AudioContext | null>(null);
  const amostras = useRef<AmostraDeFalante[]>([]);
  const minhasFrases = useRef<{ at: number; texto: string }[]>([]);
  const falhas = useRef(0);
  const ultimoToast = useRef(0);
  const avisouPublicacao = useRef(false);
  const transcrevendo = useRef(0);
  const diagnostico = useRef({
    ecoPorFalante: 0,
    ecoPorTexto: 0,
    conexao: 0,
    descartadosPorMudo: 0,
  });
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const mexerNaBandeja = useCallback(
    (id: string, mudar: Partial<ItemDaBandeja>, criar?: ItemDaBandeja) => {
      if (!vivo.current) return;
      setBandeja((lista) => {
        const i = lista.findIndex((x) => x.id === id);
        if (i < 0) return criar ? [criar, ...lista].slice(0, BANDEJA_MAX) : lista;
        const nova = lista.slice();
        nova[i] = { ...nova[i]!, ...mudar };
        return nova;
      });
    },
    [],
  );

  const atualizarOcupado = useCallback(() => {
    const d = despachante.current!;
    if (vivo.current) setOcupado(d.emVoo || d.temPendente() || transcrevendo.current > 0);
  }, []);

  /** Uma falha da IA. Toast no máximo 1 por minuto; chave/crédito ou 3 seguidas param os cards. */
  const falhou = useCallback((e: unknown) => {
    const msg = mensagemDe(e);
    falhas.current++;
    const agora = Date.now();
    if (agora - ultimoToast.current > 60_000) {
      ultimoToast.current = agora;
      toast.error(msg);
    }
    if (SEM_CHAVE.test(msg) || SEM_CREDITO.test(msg) || falhas.current >= FALHAS_ATE_ERRO) {
      if (vivo.current)
        setErro(SEM_CHAVE.test(msg) ? "Servidor sem chave de IA — reinicie o servidor" : msg);
    }
  }, []);

  const publicar = useCallback((m: MensagemCard) => {
    const r = opcoes.current.room;
    if (r) {
      publicarCard(r, m).catch(() => {
        // Um aviso só: a rede caindo não pode virar uma chuva de toasts.
        if (avisouPublicacao.current) return;
        avisouPublicacao.current = true;
        toast.warning("Não consegui enviar o card para a sala. Confira a conexão.");
      });
    }
    opcoes.current.aoMensagemLocal(m);
  }, []);

  /* ---------- Despachar o pendente quando o ritmo deixa ---------- */
  const tentarDespachar = useCallback(() => {
    const d = despachante.current!;
    const agora = Date.now();
    const pausa = d.pausado(agora);
    if (vivo.current) setLimite(pausa);
    const p = d.despachar(agora);
    atualizarOcupado();
    if (!p) return;
    if (d.pausado(agora) && vivo.current) setLimite(d.pausado(agora));
    const { meuNome, participantes, interpretar = interpretarPadrao } = opcoes.current;
    void (async () => {
      try {
        const { card } = await interpretar({
          frase: p.texto,
          quem: meuNome,
          participantes,
          anterior: anteriorA(p, minhasFrases.current, opcoes.current.ouvidosRecentes()),
        });
        falhas.current = 0;
        if (!d.vale(p) || !opcoes.current.ligado) {
          diagnostico.current.descartadosPorMudo++;
          mexerNaBandeja(p.id, { situacao: "descartado" });
          return;
        }
        const ouvido = p.texto.slice(0, 300);
        if (card.tipo === "nada" || card.relevancia < LIMIAR_DE_PUBLICAR) {
          mexerNaBandeja(p.id, { situacao: "nao-publicado", card, ouvido });
          return;
        }
        publicar({ v: 1, k: "card", id: p.id, at: p.at, card, ouvido });
        mexerNaBandeja(p.id, { situacao: "publicado", card, ouvido });
      } catch (e) {
        mexerNaBandeja(p.id, { situacao: "descartado" });
        if (d.vale(p)) falhou(e);
      } finally {
        d.concluir();
        atualizarOcupado();
      }
    })();
  }, [atualizarOcupado, falhou, mexerNaBandeja, publicar]);

  /* ---------- Um trecho fechado no meu microfone ---------- */
  const processarTrecho = useCallback(
    async (t: TrechoDeFala, geracao: number) => {
      const d = despachante.current!;
      const { meuId: eu, participantes, transcrever = transcreverPadrao } = opcoes.current;
      if (geracao !== d.geracao) {
        diagnostico.current.descartadosPorMudo++;
        return;
      }
      if (dominadoPorRemoto(amostras.current, t.inicio, t.inicio + t.duracaoMs, eu)) {
        diagnostico.current.ecoPorFalante++;
        return;
      }
      transcrevendo.current++;
      atualizarOcupado();
      let texto = "";
      try {
        const audio = await paraBase64(t.audio);
        if (geracao !== d.geracao) {
          diagnostico.current.descartadosPorMudo++;
          return;
        }
        texto = (
          await transcrever({
            audio,
            mime: t.audio.type || "audio/webm",
            nomes: participantes,
            falaMs: Math.round(t.falaMs),
          })
        ).texto.trim();
        falhas.current = 0;
      } catch (e) {
        if (geracao === d.geracao) falhou(e);
        return;
      } finally {
        transcrevendo.current = Math.max(0, transcrevendo.current - 1);
        atualizarOcupado();
      }
      if (geracao !== d.geracao) {
        diagnostico.current.descartadosPorMudo++;
        return;
      }
      if (!texto) return;
      if (ehConversaDeConexao(texto)) {
        diagnostico.current.conexao++;
        return;
      }
      // Anti-eco, camada 2: a mesma frase já virou card de outra pessoa há pouco.
      if (opcoes.current.ouvidosRecentes().some((r) => semelhanca(r.ouvido, texto) >= ECO)) {
        diagnostico.current.ecoPorTexto++;
        return;
      }
      minhasFrases.current = [
        ...minhasFrases.current.filter((f) => Date.now() - f.at < ANTERIOR_MS),
        { at: t.inicio, texto },
      ];
      const r = d.juntar({ inicio: t.inicio, texto, falaMs: t.falaMs }, geracao);
      for (const fora of r.descartados) mexerNaBandeja(fora.id, { situacao: "descartado" });
      if (r.pendente && r.novo)
        mexerNaBandeja(
          r.pendente.id,
          {},
          { id: r.pendente.id, at: r.pendente.at, situacao: "pensando" },
        );
      tentarDespachar();
    },
    [atualizarOcupado, falhou, mexerNaBandeja, tentarDespachar],
  );

  /** Mudo, trilha trocada, pausa ou desligar: a geração sobe e o que estava na fila vira "descartado". */
  const virarGeracao = useCallback(() => {
    const fora = despachante.current!.novaGeracao();
    for (const p of fora) mexerNaBandeja(p.id, { situacao: "descartado" });
    diagnostico.current.descartadosPorMudo += fora.length;
    atualizarOcupado();
  }, [atualizarOcupado, mexerNaBandeja]);

  /* ---------- AudioContext: um só, criado no clique que ligou ---------- */
  useEffect(() => {
    if (!ligado) return;
    // O efeito roda logo depois do clique: a ativação do usuário ainda vale para o resume().
    const ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    contexto.current = ctx;
    return () => {
      contexto.current = null;
      void ctx.close().catch(() => {});
    };
  }, [ligado]);

  /* ---------- Avisar a sala que a IA está ouvindo (chip "IA") ---------- */
  useEffect(() => {
    if (!ligado || !room) return;
    publicar({ v: 1, k: "ouvindo", ligado: true });
    return () => publicar({ v: 1, k: "ouvindo", ligado: false });
  }, [ligado, room, publicar]);

  /* ---------- Quem é o falante agora, a cada 100 ms (anti-eco camada 1) ---------- */
  useEffect(() => {
    if (!ligado || !room) return;
    const id = window.setInterval(() => {
      const agora = Date.now();
      const anel = amostras.current;
      anel.push({ t: agora, id: room.activeSpeakers[0]?.identity ?? null });
      while (anel.length && agora - anel[0]!.t > ANEL_DE_FALANTES_MS) anel.shift();
    }, 100);
    return () => {
      window.clearInterval(id);
      amostras.current = [];
    };
  }, [ligado, room]);

  /* ---------- Aba em segundo plano por mais de 5 s: pausa ---------- */
  useEffect(() => {
    if (!ligado) return;
    let relogio: number | undefined;
    const aoMudar = () => {
      window.clearTimeout(relogio);
      if (document.hidden)
        relogio = window.setTimeout(() => setAbaOculta(true), ABA_OCULTA_PAUSA_MS);
      else setAbaOculta(false);
    };
    document.addEventListener("visibilitychange", aoMudar);
    aoMudar();
    return () => {
      window.clearTimeout(relogio);
      document.removeEventListener("visibilitychange", aoMudar);
      setAbaOculta(false);
    };
  }, [ligado]);

  /* ---------- Ritmo do despacho (e fim da pausa por minuto) ---------- */
  useEffect(() => {
    if (!ligado || erro || abaOculta) return;
    const id = window.setInterval(tentarDespachar, 500);
    return () => window.clearInterval(id);
  }, [ligado, erro, abaOculta, tentarDespachar]);

  /* ---------- Ouvir a trilha do LiveKit, respeitando o mudo ---------- */
  const parado = !!erro || abaOculta;
  useEffect(() => {
    if (!ligado || !room || parado || !gravacaoSuportada()) return;
    const ctx = contexto.current;
    if (!ctx) return;

    let ativo: { trilha: MediaStreamTrack; parar: () => void } | null = null;

    /** Para o corte JOGANDO FORA o trecho em curso — é a frase que a pessoa quis esconder. */
    const soltar = () => {
      if (!ativo) return;
      ativo.parar();
      ativo = null;
      virarGeracao();
    };

    /* Refeito a cada evento de trilha e a cada 2 s, como na Ata: mudo,
       desmudo, trilha publicada ou trocada por baixo (outro microfone). */
    const sincronizar = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const trilha = pub && !pub.isMuted ? pub.track?.mediaStreamTrack : undefined;
      if (!trilha || trilha.readyState !== "live" || !trilha.enabled) {
        soltar();
        setSemMic(true);
        return;
      }
      setSemMic(false);
      if (ativo?.trilha === trilha) return;
      soltar();
      const fluxo = new MediaStream([trilha]);
      const fonte = ctx.createMediaStreamSource(fluxo);
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 512;
      fonte.connect(analisador);
      // A geração vai junto do segmentador: trecho entregue depois do mudo chega velho e cai.
      const geracao = despachante.current!.geracao;
      const segmentador = criarSegmentador({
        fluxo,
        analisador,
        pausaQueCortaMs: 900,
        trechoMaximoMs: 12_000,
        aoTrecho: (t) => void processarTrecho(t, geracao),
      });
      ativo = {
        trilha,
        parar: () => {
          segmentador.parar(false);
          fonte.disconnect();
        },
      };
    };

    const eventos = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    eventos.forEach((ev) => room.on(ev, sincronizar));
    const relogio = window.setInterval(sincronizar, 2000);
    sincronizar();
    return () => {
      window.clearInterval(relogio);
      eventos.forEach((ev) => room.off(ev, sincronizar));
      soltar();
    };
  }, [ligado, room, parado, tentativa, processarTrecho, virarGeracao]);

  /* Desligar zera o erro e a pausa: ligar de novo é recomeçar. */
  useEffect(() => {
    if (ligado) return;
    virarGeracao();
    falhas.current = 0;
    setErro(null);
    setLimite(null);
  }, [ligado, virarGeracao]);

  const apagar = useCallback(
    (id: string) => {
      publicar({ v: 1, k: "apagar", id });
      mexerNaBandeja(id, { situacao: "apagado" });
    },
    [publicar, mexerNaBandeja],
  );

  const tentarDeNovo = useCallback(() => {
    falhas.current = 0;
    ultimoToast.current = 0;
    setErro(null);
    setTentativa((n) => n + 1);
  }, []);

  /* ---------- O estado da tela, em ordem de prioridade ---------- */
  let estado: EstadoCards;
  let motivo: string | null = null;
  if (!ligado) estado = "desligado";
  else if (!gravacaoSuportada()) {
    estado = "sem-suporte";
    motivo = "Este navegador não grava áudio";
  } else if (erro) {
    estado = "erro";
    motivo = erro;
  } else if (abaOculta) {
    estado = "pausado";
    motivo = "aba em segundo plano";
  } else if (semMic) estado = "mudo";
  else if (limite) {
    estado = "pausado";
    motivo = limite;
  } else if (ocupado) estado = "pensando";
  else estado = "ouvindo";

  return { estado, motivo, bandeja, apagar, tentarDeNovo, diagnostico: diagnostico.current };
}
