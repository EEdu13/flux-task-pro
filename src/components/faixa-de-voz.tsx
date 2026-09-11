import { useEffect, useRef, type RefObject } from "react";
import larsilSimbolo from "@/assets/bolabranca.png";
import type { LeituraDoMicrofone } from "@/lib/use-microfone";

/**
 * A faixa de voz da Tarefa por voz: a logo da Larsil no centro, com o anel de
 * plasma em volta, e a voz se espalhando dela para os dois lados — ondas e
 * barras de espectro que vão até as bordas, na largura da caixa de cima.
 *
 * Era um orbe redondo ao lado da caixa. Virou faixa embaixo dela para a caixa
 * poder crescer: com vários pedidos ditados de uma vez, os cartões das tarefas
 * são o que precisa de espaço, e o efeito de voz acompanha na largura em vez
 * de disputar a tela com eles.
 *
 * Canvas e não SVG/CSS porque cada quadro redesenha ~100 barras, três ondas de
 * centenas de pontos e dezenas de partículas — em DOM seriam centenas de
 * elementos mudando 60 vezes por segundo.
 *
 * A cor vem de `--sidebar-primary`, a mesma que brilha na logo da barra lateral.
 * Ela é o destaque feito para fundo escuro em TODAS as paletas, então a faixa
 * acompanha a paleta de cada pessoa sem cor própria por tema.
 */

export type FaseDaVoz = "ouvindo" | "processando" | "pausado";

type RGB = [number, number, number];

/** Altura padrão da faixa. A largura é a do contêiner, medida ao vivo. */
export const ALTURA_DA_FAIXA = 196;

/**
 * O núcleo em volta da logo. Ele não estica com a largura, mas encolhe com a
 * altura: numa tela baixa a faixa perde altura para a caixa de cima, e o anel
 * precisa continuar cabendo nela.
 */
const raiosDoNucleo = (altura: number) => {
  const e = altura / ALTURA_DA_FAIXA;
  return { logo: 50 * e, onda: 64 * e, hud: 82 * e };
};

/** Distância entre as barras do espectro. */
const PASSO_BARRA = 9;

const rgba = (c: RGB, a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/**
 * Qualquer cor CSS em RGB, deixando o próprio canvas interpretar.
 *
 * O token vem como `oklch(...)`, e converter oklch à mão é uma página de
 * matemática. O canvas já sabe: pinta um pixel e devolve os bytes. Se ele não
 * entender a cor, `fillStyle` fica com o valor anterior — é assim que se sabe
 * que precisa usar a reserva.
 */
function corParaRgb(cor: string, reserva: RGB): RGB {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx || !cor) return reserva;
  ctx.fillStyle = "#010203";
  ctx.fillStyle = cor;
  if (ctx.fillStyle === "#010203") return reserva;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? reserva[0], d[1] ?? reserva[1], d[2] ?? reserva[2]];
}

/** Gira o matiz mantendo saturação e luz — as cores vizinhas das ondas. */
function girarMatiz([r, g, b]: RGB, graus: number): RGB {
  const R_ = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R_, G, B),
    min = Math.min(R_, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [r, g, b]; // cinza: não há matiz para girar
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R_ ? ((G - B) / d) % 6 : max === G ? (B - R_) / d + 2 : (R_ - G) / d + 4;
  h = (h * 60 + graus + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

const misturar = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Ruído suave de -1 a 1: soma de senos com frequências que não se alinham. */
const ruido = (x: number) =>
  (Math.sin(x * 1.7) + Math.sin(x * 2.9 + 1.3) * 0.6 + Math.sin(x * 4.3 + 2.1) * 0.35) / 1.95;

/**
 * Envelope de uma voz falando, para quando não há microfone.
 * Sílabas a uns 5 por segundo, dentro de frases que sobem e descem — é o
 * ritmo que faz parecer fala e não um metrônomo.
 */
function falaSimulada(t: number): number {
  const silaba = Math.max(0, Math.sin(t * 11.5 + Math.sin(t * 2.3) * 2.2)) ** 1.6;
  const frase = 0.55 + 0.45 * Math.sin(t * 0.9 + 1.1);
  const tremor = 0.5 + 0.5 * ruido(t * 7.3);
  return Math.min(1, 0.16 + silaba * 0.62 * frase + tremor * 0.12);
}

/** Respiração em silêncio: nunca parado, para não parecer travado. */
const repouso = (t: number) => 0.035 + 0.025 * (0.5 + 0.5 * Math.sin(t * 1.4));

interface Particula {
  /** Distância do núcleo até a borda, de 0 a 1. */
  d: number;
  lado: 1 | -1;
  vel: number;
  y: number;
  tam: number;
  fase: number;
}

const novaParticula = (espalhar: boolean): Particula => ({
  d: espalhar ? Math.random() : 0,
  lado: Math.random() < 0.5 ? -1 : 1,
  vel: 0.04 + Math.random() * 0.1,
  y: (Math.random() - 0.5) * 64,
  tam: 0.6 + Math.random() * 1.3,
  fase: Math.random() * 10,
});

export function FaixaDeVoz({
  fase,
  falando,
  leituraRef,
  altura = ALTURA_DA_FAIXA,
}: {
  fase: FaseDaVoz;
  /**
   * O roteiro de demonstração está "falando". Sem microfone, é o que anima a
   * faixa como voz; com microfone, soma-se a ele num peso menor, para ela não
   * ficar parada enquanto o texto de demonstração aparece.
   */
  falando: boolean;
  leituraRef: RefObject<LeituraDoMicrofone>;
  /** Altura em px. Menor em tela baixa, para sobrar espaço para as tarefas. */
  altura?: number;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const auraRef = useRef<HTMLDivElement>(null);

  /* Fase e fala entram por ref: o laço de desenho lê o valor atual a cada
     quadro, e colocá-las nas dependências do efeito recriaria o laço inteiro
     (e sortearia as partículas de novo) a cada troca de fase. */
  const faseRef = useRef(fase);
  const falandoRef = useRef(falando);
  useEffect(() => {
    faseRef.current = fase;
  }, [fase]);
  useEffect(() => {
    falandoRef.current = falando;
  }, [falando]);

  useEffect(() => {
    const caixa = caixaRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!caixa || !canvas || !ctx) return;

    const ALTURA = altura;
    const R = raiosDoNucleo(altura);
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    /* A largura acompanha o contêiner ao vivo — é a largura da caixa de cima,
       e ela muda com a janela. O canvas precisa do número em pixels, então um
       ResizeObserver refaz a superfície quando a caixa muda de tamanho. */
    let W = 0;
    const medir = () => {
      W = Math.max(320, Math.round(caixa.clientWidth));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(ALTURA * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${ALTURA}px`;
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caixa);

    const cor = corParaRgb(
      getComputedStyle(canvas).getPropertyValue("--sidebar-primary").trim(),
      [110, 200, 255],
    );
    const corB = girarMatiz(cor, 38);
    const corC = girarMatiz(cor, -38);
    const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Um lado de cada vez, até 160 barras: sobra para uma tela bem larga.
    const barrasE = new Float32Array(160);
    const barrasD = new Float32Array(160);
    const particulas = Array.from({ length: 48 }, () => novaParticula(true));

    let nivel = 0;
    let rotacao = 0;
    let ultimo = performance.now();
    let quadro = 0;

    const desenhar = (agora: number) => {
      quadro = requestAnimationFrame(desenhar);
      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;
      const t = agora / 1000;
      const f = faseRef.current;
      const leitura = leituraRef.current;

      /* ---- 1. Quanto de voz há agora ---- */
      let mic = 0;
      const an = leitura?.analisador ?? null;
      if (leitura && an && leitura.onda.length > 0) {
        an.getByteTimeDomainData(leitura.onda);
        let soma = 0;
        for (let i = 0; i < leitura.onda.length; i++) {
          const x = ((leitura.onda[i] ?? 128) - 128) / 128;
          soma += x * x;
        }
        // RMS de voz normal fica em 0,05–0,2; o ganho leva isso para a faixa útil.
        mic = Math.min(1, Math.sqrt(soma / leitura.onda.length) * 5);
        an.getByteFrequencyData(leitura.espectro);
      }
      const sim = falandoRef.current ? falaSimulada(t) : repouso(t);
      let alvo = Math.max(mic, sim * (an ? 0.55 : 1));
      if (f === "processando") alvo = Math.max(mic * 0.5, 0.14 + 0.07 * Math.sin(t * 3.4));
      if (f === "pausado") alvo = 0.015;
      // Sobe rápido e desce devagar: é o que faz o brilho "acompanhar" a voz
      // em vez de piscar junto com cada oscilação.
      nivel += (alvo - nivel) * (alvo > nivel ? 0.32 : 0.07);

      const vel = f === "processando" ? 1.9 : f === "pausado" ? 0.08 : 0.35 + nivel * 0.9;
      rotacao += dt * vel * (calmo ? 0.2 : 1);
      const apagado = f === "pausado" ? 0.4 : 1;

      const H = ALTURA;
      const cx = W / 2;
      const cy = H / 2;
      const meia = W / 2;
      const inicioBarras = R.hud + 16;
      const nBarras = Math.max(
        8,
        Math.min(160, Math.floor((meia - inicioBarras - 8) / PASSO_BARRA)),
      );

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";

      /* ---- 2. Brilhos de fundo: o redondo do núcleo e o horizontal ---- */
      const halo = ctx.createRadialGradient(cx, cy, R.logo * 0.6, cx, cy, H / 2);
      halo.addColorStop(0, rgba(cor, (0.3 + nivel * 0.35) * apagado));
      halo.addColorStop(0.5, rgba(cor, (0.08 + nivel * 0.14) * apagado));
      halo.addColorStop(1, rgba(cor, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(cx - H / 2, 0, H, H);

      // Elipse esticada na largura: o brilho "deitado" por onde a voz corre.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(meia / (H * 0.5), 1);
      const deitado = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 0.5);
      deitado.addColorStop(0, rgba(cor, (0.13 + nivel * 0.22) * apagado));
      deitado.addColorStop(0.5, rgba(cor, (0.04 + nivel * 0.08) * apagado));
      deitado.addColorStop(1, rgba(cor, 0));
      ctx.fillStyle = deitado;
      ctx.fillRect(-H * 0.5, -H * 0.5, H, H);
      ctx.restore();

      /* ---- 3. Horizonte e régua ---- */
      const linha = ctx.createLinearGradient(0, 0, W, 0);
      linha.addColorStop(0, rgba(cor, 0));
      linha.addColorStop(0.5, rgba(cor, 0.5 * apagado));
      linha.addColorStop(1, rgba(cor, 0));
      ctx.strokeStyle = linha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(W, cy);
      ctx.stroke();

      const baseRegua = cy + H * 0.4;
      for (let k = -Math.floor(meia / 24); k <= Math.floor(meia / 24); k++) {
        const x = cx + k * 24;
        const dist = Math.abs(x - cx) / meia;
        if (Math.abs(x - cx) < R.hud + 8) continue;
        const longo = k % 5 === 0;
        ctx.strokeStyle = rgba(cor, (1 - dist) * (longo ? 0.45 : 0.18) * apagado);
        ctx.beginPath();
        ctx.moveTo(x, baseRegua);
        ctx.lineTo(x, baseRegua + (longo ? 6 : 3));
        ctx.stroke();
      }

      /* ---- 4. Espectro espelhado ----
         Com microfone, as faixas de verdade — as graves, onde mora a voz, ficam
         perto da logo. Sem microfone, ruído moldado pelo nível. O maior dos
         dois vence, então a demonstração nunca apaga uma voz real. */
      const esp = leitura?.espectro;
      for (const [lado, barras] of [
        [-1, barrasE],
        [1, barrasD],
      ] as const) {
        for (let i = 0; i < nBarras; i++) {
          const dist = i / nBarras;
          let v = 0;
          if (an && esp && esp.length > 0) {
            const bin = Math.floor(2 + Math.pow(dist, 1.4) * 100);
            v = Math.min(1, ((esp[bin] ?? 0) / 255) * 1.3) * Math.pow(1 - dist, 0.6);
          }
          const s =
            nivel *
            (0.3 + 0.7 * (0.5 + 0.5 * ruido(i * 0.33 + t * 2.4 + lado * 3.1))) *
            Math.pow(1 - dist, 1.1);
          const alvoBarra = f === "pausado" ? 0 : Math.max(v * (f === "processando" ? 0.4 : 1), s);
          barras[i] = (barras[i] ?? 0) + (alvoBarra - (barras[i] ?? 0)) * 0.22;
        }
      }
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      for (const [lado, barras] of [
        [-1, barrasE],
        [1, barrasD],
      ] as const) {
        for (let i = 0; i < nBarras; i++) {
          const dist = i / nBarras;
          const b = barras[i] ?? 0;
          const x = cx + lado * (inicioBarras + i * PASSO_BARRA);
          const h = 2 + b * H * 0.62;
          ctx.strokeStyle = rgba(
            misturar(cor, corB, dist),
            (0.16 + b * 0.7) * Math.pow(1 - dist, 0.7) * apagado,
          );
          ctx.beginPath();
          ctx.moveTo(x, cy - h / 2);
          ctx.lineTo(x, cy + h / 2);
          ctx.stroke();
        }
      }

      /* ---- 5. Ondas saindo da logo ----
         A fase anda com a distância ao CENTRO, não com o x: as ondas nascem na
         logo e correm para as duas bordas, como som saindo de uma fonte. O
         envelope as apaga antes da borda, então a faixa nunca termina num
         corte seco. Brilho em duas passadas (grossa e fraca, fina e forte) no
         lugar de `shadowBlur`, que numa faixa desta largura custaria caro. */
      ctx.globalCompositeOperation = "lighter";
      const amp = 3 + nivel * H * 0.34;
      const camadas: [RGB, number][] = [
        [cor, 0],
        [corB, 2.1],
        [corC, 4.2],
      ];
      for (const [c, ph] of camadas) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const u = (x - cx) / meia;
          const env = Math.exp(-u * u * 3.2) * (1 - Math.abs(u) ** 6);
          const d = Math.abs(x - cx);
          const w =
            Math.sin(d * 0.011 - t * 1.7 + ph) * 0.55 +
            Math.sin(d * 0.026 - t * 2.3 + ph * 1.4) * 0.3 +
            Math.sin(d * 0.052 - t * 3.3 + ph * 0.6) * 0.15;
          const y = cy + amp * env * w;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        /* O traço também se apaga nas pontas, e não só a amplitude. Nas
           bordas as três ondas ficam retas e caem EXATAMENTE uma sobre a outra;
           com `lighter`, três cores fortes somadas no mesmo pixel viram branco
           — era uma linha branca dura de ponta a ponta da faixa. */
        const ponta = (a: number) => {
          const g = ctx.createLinearGradient(0, 0, W, 0);
          g.addColorStop(0, rgba(c, 0));
          g.addColorStop(0.2, rgba(c, a * 0.22));
          g.addColorStop(0.5, rgba(c, a));
          g.addColorStop(0.8, rgba(c, a * 0.22));
          g.addColorStop(1, rgba(c, 0));
          return g;
        };
        ctx.strokeStyle = ponta(0.13 * apagado);
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.strokeStyle = ponta(0.85 * apagado);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // Organizando: pulsos de luz correndo do centro para as bordas, como a
      // fala sendo lida e distribuída.
      if (f === "processando") {
        for (const deslocado of [0, 0.5]) {
          const p = (t * 0.7 + deslocado) % 1;
          for (const lado of [-1, 1]) {
            const x = cx + lado * (R.hud + p * (meia - R.hud));
            const g = ctx.createRadialGradient(x, cy, 0, x, cy, 26);
            g.addColorStop(0, rgba(cor, 0.55 * (1 - p)));
            g.addColorStop(1, rgba(cor, 0));
            ctx.fillStyle = g;
            ctx.fillRect(x - 26, cy - 26, 52, 52);
          }
        }
      }

      /* ---- 6. Partículas saindo do núcleo ---- */
      for (const p of particulas) {
        p.d += p.vel * dt * (f === "processando" ? 2.5 : 0.6 + nivel * 1.6) * (calmo ? 0.2 : 1);
        if (p.d > 1) Object.assign(p, novaParticula(false));
        const x = cx + p.lado * (R.hud + p.d * (meia - R.hud));
        const y = cy + p.y * (0.4 + nivel) + Math.sin(t * 1.3 + p.fase) * 4;
        const alfa = (0.5 + 0.5 * Math.sin(t * 2 + p.fase * 3)) * (1 - p.d) * 0.7 * apagado;
        ctx.fillStyle = rgba(cor, alfa);
        ctx.beginPath();
        ctx.arc(x, y, p.tam, 0, Math.PI * 2);
        ctx.fill();
      }

      /* ---- 7. O núcleo: disco escuro, HUD e plasma em volta da logo ---- */
      ctx.globalCompositeOperation = "source-over";
      // Sem o disco, o branco da logo se perde no brilho — e as ondas passariam
      // por trás dela à vista.
      const disco = ctx.createRadialGradient(cx, cy, 0, cx, cy, R.logo + 16);
      disco.addColorStop(0, "rgba(0,0,0,0.7)");
      disco.addColorStop(0.75, "rgba(0,0,0,0.5)");
      disco.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disco;
      ctx.beginPath();
      ctx.arc(cx, cy, R.logo + 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotacao * 0.25);
      ctx.setLineDash([1.5, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(cor, 0.35 * apagado);
      ctx.beginPath();
      ctx.arc(0, 0, R.hud, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotacao * 0.6);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(cor, 0.75 * apagado);
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 7, 0, 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 7, Math.PI, Math.PI + 0.45);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(corB, 0.5 * apagado);
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 11, Math.PI * 0.5, Math.PI * 0.5 + 0.6);
      ctx.stroke();
      ctx.restore();

      // Organizando: um feixe varre o anel, como um radar lendo o que ouviu.
      if (f === "processando" && typeof ctx.createConicGradient === "function") {
        const g = ctx.createConicGradient(rotacao * 1.3, cx, cy);
        g.addColorStop(0, rgba(cor, 0));
        g.addColorStop(0.16, rgba(cor, 0.3));
        g.addColorStop(0.161, rgba(cor, 0));
        g.addColorStop(1, rgba(cor, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R.hud, 0, Math.PI * 2);
        ctx.arc(cx, cy, R.onda + 8, 0, Math.PI * 2, true);
        ctx.fill();
      }

      /* Plasma: três contornos em cores vizinhas somados com `lighter` — onde
         se cruzam, clareiam, e é isso que dá a borda iridescente. Em silêncio é
         quase um círculo; falando alto, ele se desfaz. */
      ctx.globalCompositeOperation = "lighter";
      const ampNucleo = 2 + nivel * 16;
      for (const [c, ph] of camadas) {
        ctx.beginPath();
        for (let j = 0; j <= 96; j++) {
          const a = (j / 96) * Math.PI * 2;
          const w =
            Math.sin(a * 3 + t * 1.6 + ph) * 0.5 +
            Math.sin(a * 5 - t * 2.2 + ph * 1.3) * 0.32 +
            Math.sin(a * 8 + t * 3.1 + ph * 0.7) * 0.18;
          const r = R.onda + w * ampNucleo;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(c, (0.04 + nivel * 0.07) * apagado);
        ctx.fill();
        ctx.shadowColor = rgba(c, 0.9 * apagado);
        ctx.shadowBlur = 10 + nivel * 18;
        ctx.lineWidth = 1.5 + nivel * 1.3;
        ctx.strokeStyle = rgba(c, 0.8 * apagado);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";

      /* ---- 8. O que está fora do canvas: logo e aura ---- */
      const logo = logoRef.current;
      if (logo) {
        logo.style.transform = `translate(-50%, -50%) scale(${(1 + nivel * 0.06).toFixed(4)})`;
        logo.style.filter = `drop-shadow(0 0 ${(6 + nivel * 18).toFixed(1)}px ${rgba(cor, 0.55 + nivel * 0.4)})`;
        logo.style.opacity = f === "pausado" ? "0.55" : "1";
      }
      const aura = auraRef.current;
      if (aura) {
        aura.style.opacity = ((0.3 + nivel * 0.7) * apagado).toFixed(3);
        aura.style.transform = `scaleY(${(0.85 + nivel * 0.4).toFixed(4)})`;
      }
    };

    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
    };
  }, [leituraRef, altura]);

  const logo = Math.round(raiosDoNucleo(altura).logo * 2 * 0.92);

  return (
    <div ref={caixaRef} className="relative w-full" style={{ height: altura }}>
      {/* A aura passa das bordas do canvas de propósito: é o brilho que se
          espalha pela tela quando a voz sobe. Em CSS, com blur, não tem borda
          para cortar. */}
      <div
        ref={auraRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[4%] -inset-y-6 blur-2xl"
        style={{
          background:
            "radial-gradient(ellipse 50% 50% at 50% 50%, color-mix(in oklab, var(--sidebar-primary) 34%, transparent) 0%, transparent 72%)",
          opacity: 0.3,
        }}
      />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute left-0 top-0" />
      <img
        ref={logoRef}
        src={larsilSimbolo}
        alt="Larsil"
        draggable={false}
        className="pointer-events-none absolute left-1/2 top-1/2 select-none"
        style={{ width: logo, height: logo, transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
}
