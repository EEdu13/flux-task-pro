/*
 * use-gestos.ts — câmera + MediaPipe (no worker) + heurística → mão ao vivo, momentâneo e cabeça.
 *
 * Só detecção LOCAL: nada vai para a rede aqui (isso é o useGestoNaSala) e o vídeo NUNCA é
 * publicado — a câmera serve só para os gestos.
 *
 * Por que assim:
 *  - laço por requestVideoFrameCallback com UM quadro em voo por vez: nunca processa o mesmo
 *    quadro duas vezes e nunca empilha trabalho no worker quando a máquina é lenta;
 *  - alvo de 10 qps (a bancada mediu 7,9–10 qps de câmera) com degradação para 6 qps quando o
 *    detect passa de 60 ms em média por 2 s (notebook fraco, CPU) e volta abaixo de 35 ms/10 s;
 *  - setState só quando o resultado MUDA (mão, momentâneo) ou 1×/s (qps, ms): a sala e a página
 *    não re-renderizam a cada quadro. Os pontos crus vão num ref para a prévia desenhar.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { MaquinaDeGestos, maoAcimaDoPeito, type Ponto } from "@/lib/rv-gestos-heuristica";
import type { CabecaDoAvatar, GestoMomentaneo, LadoDaMao } from "../sala/tipos";
import type { DelegateMp, MensagemDoWorker, MensagemParaWorker } from "./tipos-mediapipe";
import { urlsDoMediapipe } from "./urls-mediapipe";
import { criarWorkerDeGestos } from "./worker-de-gestos";

export type EstadoGestos =
  | "desligado"
  | "pedindo"
  | "carregando"
  | "aquecendo"
  | "ativo"
  | "negado"
  | "ocupada"
  | "sem-camera"
  | "erro";

/** Texto curto de cada estado (tooltip do botão, prévia). */
export const TEXTO_DO_ESTADO: Record<EstadoGestos, string> = {
  desligado: "Gestos pela câmera desligados",
  pedindo: "Pedindo permissão da câmera…",
  carregando: "Baixando modelos (~25 MB, só na 1ª vez)…",
  aquecendo: "Preparando o reconhecimento…",
  ativo: "Gestos pela câmera ligados",
  negado: "Câmera bloqueada pelo navegador",
  ocupada: "Câmera em uso por outro programa",
  "sem-camera": "Nenhuma câmera encontrada",
  erro: "Não consegui carregar o reconhecimento de gestos (sem internet?)",
};

/** Estados que pedem este aviso (o integrador abre quando o estado entra num deles). */
export const ESTADOS_COM_AVISO_DE_CAMERA: readonly EstadoGestos[] = [
  "negado",
  "ocupada",
  "sem-camera",
];

export interface Gestos {
  estado: EstadoGestos;
  /** Já com estabilidade e a trava de 1 s da heurística. */
  maoAoVivo: LadoDaMao | null;
  /** Janela de 3 s. */
  momentaneo: GestoMomentaneo | null;
  /** Local (para o futuro avatar); não vai à rede. */
  cabeca: CabecaDoAvatar | null;
  delegate: DelegateMp | null;
  qps: number;
  msPorQuadro: number;
  erro: string | null;
  video: HTMLVideoElement | null;
  /** [x, y, visibilidade] dos 33 pontos do último quadro (normalizados), para a prévia. */
  ultimosPontos: RefObject<number[][] | null>;
  tentarDeNovo: () => void;
  recalibrar: () => void;
}

const RESTRICOES: MediaStreamConstraints = {
  video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 30 } },
  audio: false,
};
const QPS_ALVO = 10;
const QPS_DEGRADADO = 6;
/** Média de ms acima disto por 2 s → cai para 6 qps; abaixo de VOLTAR por 10 s → volta a 10. */
const MS_DEGRADAR = 60;
const MS_VOLTAR = 35;
const QUADROS_DE_AQUECIMENTO = 3;
const TENTATIVAS_SE_OCUPADA = 6;
const INTERVALO_SE_OCUPADA_MS = 10_000;
/** Sem "pronto" do worker neste tempo (CDN pendurada) = erro. */
const LIMITE_DE_CARGA_MS = 120_000;
/** O reconhecedor de mãos roda a 4 qps e fica ligado 1,5 s depois de a mão baixar do peito. */
const INTERVALO_MAOS_MS = 250;
const MAOS_LIGADAS_POR_MS = 1_500;
/** Falhas seguidas de quadro (worker vivo mas detect quebrando) até virar "erro". */
const FALHAS_ATE_ERRO = 30;
/** Limite de giro da cabeça do avatar (o contrato do Avatar3D pede ±0,6 yaw / ±0,35 pitch). */
const YAW_MAX = 0.6;
const PITCH_MAX = 0.35;

function limitar(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

type VideoComRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (agora: number) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export function useGestos(o: { ligado: boolean; falando: boolean }): Gestos {
  const { ligado } = o;
  const [estado, setEstado] = useState<EstadoGestos>("desligado");
  const [maoAoVivo, setMaoAoVivo] = useState<LadoDaMao | null>(null);
  const [momentaneo, setMomentaneo] = useState<GestoMomentaneo | null>(null);
  const [cabeca, setCabeca] = useState<CabecaDoAvatar | null>(null);
  const [delegate, setDelegate] = useState<DelegateMp | null>(null);
  const [qps, setQps] = useState(0);
  const [msPorQuadro, setMsPorQuadro] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const ultimosPontos = useRef<number[][] | null>(null);
  const falandoRef = useRef(o.falando);
  const maquinaRef = useRef<MaquinaDeGestos | null>(null);
  /** Novas tentativas automáticas com a câmera ocupada (zera no "Tentar de novo" manual). */
  const tentativasOcupadaRef = useRef(0);

  useEffect(() => {
    falandoRef.current = o.falando;
  }, [o.falando]);

  useEffect(() => {
    const zerarSaidas = () => {
      setMaoAoVivo(null);
      setMomentaneo(null);
      setCabeca(null);
      ultimosPontos.current = null;
    };
    if (!ligado) {
      setEstado("desligado");
      setErro(null);
      setDelegate(null);
      setQps(0);
      setMsPorQuadro(0);
      zerarSaidas();
      return;
    }

    let vivo = true;
    let stream: MediaStream | null = null;
    let worker: Worker | null = null;
    let el: VideoComRvfc | null = null;
    let idRvfc: number | null = null;
    let idTimer: ReturnType<typeof setTimeout> | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let fase: "carregando" | "aquecendo" | "ativo" = "carregando";
    let ocupado = false;
    let ultimoT = 0;
    let ultimoEnvio = Number.NEGATIVE_INFINITY;
    let alvoQps = QPS_ALVO;
    let degradouEm = 0;
    let quadrosOk = 0;
    let falhasSeguidas = 0;
    let ultimaPose: Ponto[] | null = null;
    let maosAte = Number.NEGATIVE_INFINITY;
    let ultimoComMao = Number.NEGATIVE_INFINITY;
    let ultimoCallback = performance.now();
    let usarTimer = false;
    const medidas: { t: number; ms: number }[] = [];
    const chegadas: number[] = [];
    let ultimoPainel = 0;
    let ultimaCabecaEnviada = 0;
    let saida: {
      mao: LadoDaMao | null;
      mom: GestoMomentaneo | null;
      cab: CabecaDoAvatar | null;
    } = { mao: null, mom: null, cab: null };
    maquinaRef.current = new MaquinaDeGestos();

    setErro(null);
    setDelegate(null);
    zerarSaidas();

    const falhar = (novo: EstadoGestos, mensagem: string | null) => {
      if (!vivo) return;
      vivo = false;
      encerrar();
      zerarSaidas();
      setEstado(novo);
      setErro(mensagem);
    };

    const agendarNovaTentativa = () => {
      if (tentativasOcupadaRef.current >= TENTATIVAS_SE_OCUPADA) return;
      timers.push(
        setTimeout(() => {
          tentativasOcupadaRef.current++;
          setTentativa((n) => n + 1);
        }, INTERVALO_SE_OCUPADA_MS),
      );
    };

    const encerrar = () => {
      if (idRvfc !== null && el?.cancelVideoFrameCallback) el.cancelVideoFrameCallback(idRvfc);
      idRvfc = null;
      if (idTimer !== null) clearTimeout(idTimer);
      idTimer = null;
      if (worker) {
        try {
          worker.postMessage({ tipo: "parar" } satisfies MensagemParaWorker);
        } catch {
          // worker já morto: o terminate abaixo resolve
        }
        worker.terminate();
        worker = null;
      }
      if (stream) {
        for (const tr of stream.getTracks()) {
          tr.onended = null;
          tr.stop();
        }
        stream = null;
      }
      if (el) {
        el.pause();
        el.srcObject = null;
        el.remove();
        el = null;
      }
      setVideo(null);
    };

    /* —————— laço de quadros —————— */

    const agendar = () => {
      if (!vivo || !el) return;
      if (!usarTimer && el.requestVideoFrameCallback) {
        if (idRvfc === null) idRvfc = el.requestVideoFrameCallback(aoQuadro);
      } else if (idTimer === null) {
        idTimer = setTimeout(() => {
          idTimer = null;
          aoQuadro(performance.now());
        }, 1000 / alvoQps);
      }
    };

    const aoQuadro = (agora: number) => {
      idRvfc = null;
      ultimoCallback = performance.now();
      if (!vivo || !el || !worker) return;
      const intervalo = 1000 / alvoQps;
      // Aba oculta: não manda quadro (o navegador nem entrega quadros direito em segundo plano).
      if (ocupado || document.hidden || agora - ultimoEnvio < intervalo - 8 || el.readyState < 2) {
        agendar();
        return;
      }
      ocupado = true;
      ultimoEnvio = agora;
      // O MediaPipe (modo VIDEO) exige tempo ESTRITAMENTE crescente.
      const t = agora > ultimoT ? agora : ultimoT + 1;
      ultimoT = t;
      if (maoAcimaDoPeito(ultimaPose, el.videoWidth / (el.videoHeight || 1)))
        maosAte = agora + MAOS_LIGADAS_POR_MS;
      // Mão já erguida (na fila) não está fazendo joinha nem coração: poupa o reconhecedor de
      // mãos (~100 ms por quadro em CPU) justo quando a pessoa espera ver a própria mão subir.
      const comMao =
        agora < maosAte &&
        agora - ultimoComMao >= INTERVALO_MAOS_MS &&
        maquinaRef.current?.estado.maoAoVivo == null;
      if (comMao) ultimoComMao = agora;
      const w = worker;
      createImageBitmap(el)
        .then((bmp) => {
          if (!vivo || worker !== w || !w) {
            bmp.close();
            ocupado = false;
            return;
          }
          const msg: MensagemParaWorker = { tipo: "quadro", bmp, t, comMao };
          w.postMessage(msg, [bmp]);
        })
        .catch(() => {
          // Vídeo sem quadro decodificável neste instante (troca de resolução): pula.
          ocupado = false;
        });
      agendar();
    };

    // Vigia: se o requestVideoFrameCallback parar de chegar (vídeo fora do DOM visível em
    // alguns navegadores), cai para um timer na mesma cadência.
    const vigia = setInterval(() => {
      if (!vivo || usarTimer || fase === "carregando" || document.hidden) return;
      if (performance.now() - ultimoCallback > 1500) {
        usarTimer = true;
        if (idRvfc !== null && el?.cancelVideoFrameCallback) el.cancelVideoFrameCallback(idRvfc);
        idRvfc = null;
        agendar();
      }
    }, 1000);

    /* —————— resultado do worker —————— */

    const aoResultado = (m: Extract<MensagemDoWorker, { tipo: "resultado" }>) => {
      ocupado = false;
      const agora = performance.now();
      if (m.falha) {
        if (++falhasSeguidas >= FALHAS_ATE_ERRO) {
          console.warn("[rv-gesto] o detect falhou em sequência:", m.falha);
          falhar("erro", TEXTO_DO_ESTADO.erro);
        }
        return;
      }
      falhasSeguidas = 0;
      quadrosOk++;
      if (fase === "aquecendo" && quadrosOk >= QUADROS_DE_AQUECIMENTO) {
        fase = "ativo";
        setEstado("ativo");
      }

      // Desempenho: média de ms e qps entregue; degrada/recupera a cadência.
      // Mede o detect do CORPO: é ele que escala com a cadência (o reconhecedor de mãos roda a
      // 4 qps fixos e só com a mão no alto) — degradar o corpo por causa das mãos não ajudaria.
      medidas.push({ t: agora, ms: m.msPose ?? m.ms });
      chegadas.push(agora);
      while (medidas.length && agora - medidas[0].t > 10_000) medidas.shift();
      while (chegadas.length && agora - chegadas[0] > 1_000) chegadas.shift();
      const media = (janela: number) => {
        const v = medidas.filter((x) => agora - x.t <= janela);
        return v.length ? v.reduce((s, x) => s + x.ms, 0) / v.length : 0;
      };
      if (
        fase === "ativo" &&
        alvoQps === QPS_ALVO &&
        quadrosOk > 20 &&
        media(2_000) > MS_DEGRADAR
      ) {
        alvoQps = QPS_DEGRADADO;
        degradouEm = agora;
      } else if (
        alvoQps === QPS_DEGRADADO &&
        agora - degradouEm >= 10_000 &&
        media(10_000) < MS_VOLTAR
      ) {
        alvoQps = QPS_ALVO;
      }
      if (agora - ultimoPainel >= 1_000) {
        ultimoPainel = agora;
        setQps(chegadas.length);
        setMsPorQuadro(Math.round(media(2_000)));
      }

      ultimaPose = m.pose;
      ultimosPontos.current = m.pose ? m.pose.map((p) => [p.x, p.y, p.visibility ?? 1]) : null;
      if (document.hidden || !el) return;
      const maquina = maquinaRef.current;
      if (!maquina) return;
      maquina.alimentar({
        t: m.t,
        aspecto: el.videoWidth / (el.videoHeight || 1) || 16 / 9,
        pose: m.pose,
        maos: m.maos,
        ignorarMovimentoAmplo: falandoRef.current,
      });
      if (fase !== "ativo") return;
      const e = maquina.estado;
      if (e.maoAoVivo !== saida.mao) {
        saida = { ...saida, mao: e.maoAoVivo };
        setMaoAoVivo(e.maoAoVivo);
      }
      if (e.momentaneo !== saida.mom) {
        saida = { ...saida, mom: e.momentaneo };
        setMomentaneo(e.momentaneo);
      }
      // Cabeça: no máximo 5×/s e só se mexeu de verdade (≈ 1°) — é enfeite do avatar.
      const cab = e.cabeca
        ? { yaw: limitar(e.cabeca.yaw, YAW_MAX), pitch: limitar(e.cabeca.pitch, PITCH_MAX) }
        : null;
      const mudou =
        (cab === null) !== (saida.cab === null) ||
        (cab &&
          saida.cab &&
          (Math.abs(cab.yaw - saida.cab.yaw) > 0.02 ||
            Math.abs(cab.pitch - saida.cab.pitch) > 0.02));
      if (mudou && agora - ultimaCabecaEnviada >= 200) {
        ultimaCabecaEnviada = agora;
        saida = { ...saida, cab };
        setCabeca(cab);
      }
    };

    /* —————— aba oculta —————— */

    const aoMudarVisibilidade = () => {
      if (document.hidden) {
        // O gesto AO VIVO some na hora; a mão travada (useGestoNaSala) é intenção e fica.
        saida = { mao: null, mom: null, cab: null };
        setMaoAoVivo(null);
        setMomentaneo(null);
        setCabeca(null);
      } else {
        // Ao voltar a pessoa pode ter mudado de lugar: máquina nova (recalibra a cabeça).
        maquinaRef.current = new MaquinaDeGestos();
        ultimoCallback = performance.now();
        agendar();
      }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    /* —————— partida —————— */

    const abrirCamera = async (): Promise<MediaStream | null> => {
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) {
        falhar("sem-camera", "Este navegador não dá acesso à câmera.");
        return null;
      }
      try {
        return await md.getUserMedia(RESTRICOES);
      } catch (e1) {
        let e: unknown = e1;
        let nome = (e as DOMException | null)?.name ?? "";
        // Câmera que não atende 640×360/15 qps: tenta sem restrição nenhuma.
        if (nome === "NotFoundError" || nome === "OverconstrainedError") {
          try {
            return await md.getUserMedia({ video: true, audio: false });
          } catch (e2) {
            e = e2;
            nome = (e2 as DOMException | null)?.name ?? "";
            if (nome === "NotFoundError" || nome === "OverconstrainedError") {
              falhar("sem-camera", "Nenhuma câmera encontrada.");
              return null;
            }
          }
        }
        if (nome === "NotAllowedError" || nome === "SecurityError") {
          falhar("negado", "A câmera foi bloqueada para esta página.");
        } else if (nome === "NotReadableError" || nome === "AbortError") {
          falhar("ocupada", "Câmera em uso por outro programa (Teams, Zoom…).");
          agendarNovaTentativa();
        } else {
          console.warn("[rv-gesto] getUserMedia:", e);
          falhar("erro", `Não consegui abrir a câmera (${nome || "erro desconhecido"}).`);
        }
        return null;
      }
    };

    void (async () => {
      setEstado("pedindo");
      const s = await abrirCamera();
      if (!s) return;
      if (!vivo) {
        for (const tr of s.getTracks()) tr.stop();
        return;
      }
      stream = s;
      tentativasOcupadaRef.current = 0;
      const trilha = s.getVideoTracks()[0];
      if (trilha) {
        trilha.onended = () => {
          // Outro programa tomou a câmera ou o dispositivo saiu: "ocupada" e nova tentativa.
          falhar("ocupada", "A câmera parou (outro programa pode ter tomado).");
          agendarNovaTentativa();
        };
      }

      // Vídeo invisível no DOM: dentro do documento o requestVideoFrameCallback é confiável.
      const v = document.createElement("video") as VideoComRvfc;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.setAttribute("aria-hidden", "true");
      v.style.cssText =
        "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
      v.srcObject = s;
      document.body.appendChild(v);
      el = v;
      try {
        await v.play();
      } catch (e) {
        console.warn("[rv-gesto] vídeo da câmera não tocou:", e);
      }
      if (!vivo) return;
      setVideo(v);

      setEstado("carregando");
      fase = "carregando";
      let w: Worker;
      try {
        w = criarWorkerDeGestos();
      } catch (e) {
        console.warn("[rv-gesto] worker:", e);
        falhar("erro", TEXTO_DO_ESTADO.erro);
        return;
      }
      worker = w;
      w.onerror = (ev) => {
        console.warn("[rv-gesto] worker caiu:", ev.message);
        falhar("erro", TEXTO_DO_ESTADO.erro);
      };
      w.onmessage = (ev: MessageEvent<MensagemDoWorker>) => {
        if (!vivo) return;
        const m = ev.data;
        if (m.tipo === "pronto") {
          setDelegate(m.delegate);
          // Segundo "pronto" = o worker trocou GPU lenta por CPU no meio do laço: só o selo muda.
          if (fase !== "carregando") return;
          fase = "aquecendo";
          setEstado("aquecendo");
          ultimoCallback = performance.now();
          agendar();
        } else if (m.tipo === "resultado") {
          aoResultado(m);
        } else if (m.tipo === "erro") {
          console.warn("[rv-gesto] MediaPipe não carregou:", m.mensagem);
          falhar("erro", TEXTO_DO_ESTADO.erro);
        } else if (m.tipo === "aviso") {
          console.warn("[rv-gesto]", m.mensagem);
        }
      };
      timers.push(
        setTimeout(() => {
          if (vivo && fase === "carregando") falhar("erro", TEXTO_DO_ESTADO.erro);
        }, LIMITE_DE_CARGA_MS),
      );
      w.postMessage({ tipo: "iniciar", urls: urlsDoMediapipe() } satisfies MensagemParaWorker);
    })();

    return () => {
      vivo = false;
      clearInterval(vigia);
      for (const tm of timers) clearTimeout(tm);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      encerrar();
      maquinaRef.current = null;
    };
  }, [ligado, tentativa]);

  const tentarDeNovo = useCallback(() => {
    tentativasOcupadaRef.current = 0;
    setTentativa((n) => n + 1);
  }, []);

  const recalibrar = useCallback(() => {
    maquinaRef.current?.recalibrarCabeca();
  }, []);

  return {
    estado,
    maoAoVivo,
    momentaneo,
    cabeca,
    delegate,
    qps,
    msPorQuadro,
    erro,
    video,
    ultimosPontos,
    tentarDeNovo,
    recalibrar,
  };
}
