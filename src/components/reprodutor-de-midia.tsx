import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatarDuracao } from "@/lib/gravacao-de-midia";

/**
 * Players do recado de voz e da gravação de tela (19/10/2026).
 *
 * O `<audio controls>` do navegador é largo, cinza e diferente em cada
 * navegador — num balão de chat ele não cabe. O de áudio aqui é o do WhatsApp:
 * play/pausa, uma ondinha que vai enchendo, o tempo e a velocidade (1x, 1,5x,
 * 2x). O de vídeo usa os controles do próprio navegador, que para vídeo são
 * bons (tela cheia, volume) — só corrige a duração (ver abaixo).
 */

/**
 * O arquivo gravado pelo `MediaRecorder` do Chrome sai SEM a duração no
 * cabeçalho: o navegador diz `Infinity` e a barra de progresso não anda.
 * O conserto conhecido é pedir para pular para um tempo absurdo — o navegador
 * vai até o fim do arquivo, descobre a duração real e avisa por
 * `durationchange`. Aí volta para o começo.
 */
function corrigirDuracao(el: HTMLMediaElement, aoDescobrir: (d: number) => void) {
  if (Number.isFinite(el.duration) && el.duration > 0) {
    aoDescobrir(el.duration);
    return;
  }
  const quandoMudar = () => {
    if (!Number.isFinite(el.duration)) return;
    el.removeEventListener("durationchange", quandoMudar);
    el.currentTime = 0;
    aoDescobrir(el.duration);
  };
  el.addEventListener("durationchange", quandoMudar);
  try {
    el.currentTime = 1e101;
  } catch {
    el.removeEventListener("durationchange", quandoMudar);
  }
}

/* Um áudio por vez no app inteiro, como no WhatsApp: dar play num recado pausa
   o que estava tocando. */
let tocandoAgora: HTMLMediaElement | null = null;
function assumirOSom(el: HTMLMediaElement) {
  if (tocandoAgora && tocandoAgora !== el) tocandoAgora.pause();
  tocandoAgora = el;
}

const VELOCIDADES = [1, 1.5, 2] as const;
const rotuloDaVelocidade = (v: number) => `${String(v).replace(".", ",")}x`;

/**
 * Ondinha "desenhada" a partir do endereço — sempre a mesma para o mesmo
 * recado. Calcular a onda de verdade exigiria baixar e decodificar o áudio
 * inteiro só para enfeitar; a falsa cumpre o papel de mostrar o progresso.
 */
function ondaFixa(semente: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) h = Math.imul(h ^ semente.charCodeAt(i), 16777619);
  const barras: number[] = [];
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    // Mais baixa nas pontas, como fala de verdade.
    const envelope = Math.sin(((i + 0.5) / n) * Math.PI) * 0.5 + 0.5;
    barras.push(0.2 + r * 0.8 * envelope);
  }
  return barras;
}

export function ReprodutorDeAudio({
  src,
  semente,
  variante = "padrao",
  mini = false,
  className = "",
}: {
  src: string;
  /** O que fixa o desenho da ondinha. Na falta, o próprio endereço. */
  semente?: string;
  /** `primario`: dentro de um balão `bg-primary` (as minhas mensagens). */
  variante?: "padrao" | "primario";
  /** Uma pilulazinha numa linha só (o cartão da tarefa). */
  mini?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [atual, setAtual] = useState(0);
  const [velocidade, setVelocidade] = useState<number>(1);
  const [erro, setErro] = useState(false);
  const barras = useMemo(() => ondaFixa(semente ?? src, mini ? 16 : 32), [semente, src, mini]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const aoCarregar = () => corrigirDuracao(el, setDuracao);
    const aoTempo = () => setAtual(el.currentTime);
    const aoTocar = () => setTocando(true);
    const aoPausar = () => setTocando(false);
    const aoAcabar = () => {
      setTocando(false);
      setAtual(0);
    };
    const aoErro = () => setErro(true);
    el.addEventListener("loadedmetadata", aoCarregar);
    el.addEventListener("timeupdate", aoTempo);
    el.addEventListener("play", aoTocar);
    el.addEventListener("pause", aoPausar);
    el.addEventListener("ended", aoAcabar);
    el.addEventListener("error", aoErro);
    return () => {
      el.removeEventListener("loadedmetadata", aoCarregar);
      el.removeEventListener("timeupdate", aoTempo);
      el.removeEventListener("play", aoTocar);
      el.removeEventListener("pause", aoPausar);
      el.removeEventListener("ended", aoAcabar);
      el.removeEventListener("error", aoErro);
      if (tocandoAgora === el) tocandoAgora = null;
    };
  }, [src]);

  const alternar = () => {
    const el = ref.current;
    if (!el) return;
    // Falhou antes (ex.: o trecho da ata ainda não estava salvo): tenta de novo.
    if (erro) {
      setErro(false);
      el.load();
    }
    if (el.paused) {
      assumirOSom(el);
      el.playbackRate = velocidade;
      void el.play().catch(() => setErro(true));
    } else {
      el.pause();
    }
  };

  const trocarVelocidade = () => {
    const i = VELOCIDADES.indexOf(velocidade as (typeof VELOCIDADES)[number]);
    const nova = VELOCIDADES[(i + 1) % VELOCIDADES.length]!;
    setVelocidade(nova);
    if (ref.current) ref.current.playbackRate = nova;
  };

  const pular = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !duracao) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const fracao = Math.min(1, Math.max(0, (e.clientX - caixa.left) / caixa.width));
    el.currentTime = fracao * duracao;
    setAtual(el.currentTime);
  };

  const progresso = duracao ? Math.min(1, atual / duracao) : 0;
  const primario = variante === "primario";
  const corCheia = primario ? "bg-primary-foreground" : "bg-primary";
  const corVazia = primario ? "bg-primary-foreground/35" : "bg-muted-foreground/35";

  if (mini) {
    return (
      <div
        className={`inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-0.5 pl-0.5 pr-2 ${className}`}
      >
        <audio ref={ref} src={src} preload="metadata" className="hidden" />
        <button
          type="button"
          onClick={alternar}
          title={
            erro ? "Não foi possível tocar este áudio" : tocando ? "Pausar" : "Ouvir recado de voz"
          }
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
        >
          {tocando ? <Pause className="h-3 w-3" /> : <Play className="ml-px h-3 w-3" />}
        </button>
        <div
          className="flex h-4 w-16 cursor-pointer items-center gap-[2px]"
          onClick={pular}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duracao)}
          aria-valuenow={Math.round(atual)}
        >
          {barras.map((b, i) => (
            <span
              key={i}
              className={`flex-1 rounded-full ${(i + 0.5) / barras.length <= progresso ? corCheia : corVazia}`}
              style={{ height: `${Math.round(b * 100)}%` }}
            />
          ))}
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {erro ? "—" : formatarDuracao(tocando || atual > 0 ? atual : duracao)}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex min-w-[210px] items-center gap-2 ${className}`}>
      <audio ref={ref} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={alternar}
        title={erro ? "Não foi possível tocar este áudio" : tocando ? "Pausar" : "Ouvir"}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${
          primario
            ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30"
            : "bg-primary text-primary-foreground hover:brightness-110"
        }`}
      >
        {tocando ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className="flex h-6 cursor-pointer items-center gap-[2px]"
          onClick={pular}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duracao)}
          aria-valuenow={Math.round(atual)}
        >
          {barras.map((b, i) => (
            <span
              key={i}
              className={`w-[3px] flex-1 rounded-full ${(i + 0.5) / barras.length <= progresso ? corCheia : corVazia}`}
              style={{ height: `${Math.round(b * 100)}%` }}
            />
          ))}
        </div>
        <div
          className={`mt-0.5 text-[10px] tabular-nums ${primario ? "text-primary-foreground/75" : "text-muted-foreground"}`}
        >
          {erro ? "áudio indisponível" : formatarDuracao(tocando || atual > 0 ? atual : duracao)}
        </div>
      </div>
      <button
        type="button"
        onClick={trocarVelocidade}
        title="Velocidade"
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
          primario
            ? "bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30"
            : "bg-secondary text-foreground hover:bg-secondary/70"
        }`}
      >
        {rotuloDaVelocidade(velocidade)}
      </button>
    </div>
  );
}

export function ReprodutorDeVideo({ src, className = "" }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* No vídeo a duração é corrigida só no primeiro play, e não ao carregar:
       pular para o fim obriga o navegador a ler o arquivo até lá, e uma lista
       de comentários com cinco vídeos baixaria todos eles só por aparecer. */
    let corrigida = false;
    const aoTocar = () => {
      assumirOSom(el);
      if (!corrigida) {
        corrigida = true;
        corrigirDuracao(el, () => {});
      }
    };
    const aoErro = () => setErro(true);
    el.addEventListener("play", aoTocar);
    el.addEventListener("error", aoErro);
    return () => {
      el.removeEventListener("play", aoTocar);
      el.removeEventListener("error", aoErro);
      if (tocandoAgora === el) tocandoAgora = null;
    };
  }, [src]);

  if (erro) {
    return (
      <div
        className={`grid aspect-video w-full place-items-center rounded-lg bg-black/80 text-xs text-white/70 ${className}`}
      >
        Não foi possível tocar este vídeo.
      </div>
    );
  }
  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      playsInline
      className={`aspect-video w-full rounded-lg bg-black ${className}`}
    />
  );
}

export function ehAudio(tipo: string | null | undefined): boolean {
  return !!tipo && tipo.startsWith("audio/");
}

export function ehVideo(tipo: string | null | undefined): boolean {
  return !!tipo && tipo.startsWith("video/");
}
