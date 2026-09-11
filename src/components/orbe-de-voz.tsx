import { useEffect, useRef, type RefObject } from "react";
import larsilSimbolo from "@/assets/bolabranca.png";
import type { LeituraDoMicrofone } from "@/lib/use-microfone";

/**
 * O orbe da Tarefa por voz: a logo da Larsil no centro, e em volta dela um
 * anel de plasma, um espectro radial e os anéis de "HUD" — tudo respirando com
 * a voz.
 *
 * Canvas e não SVG/CSS porque cada quadro redesenha ~70 barras, três contornos
 * de 120 pontos e três dezenas de partículas. Em DOM isso seria centenas de
 * elementos mudando de atributo 60 vezes por segundo; no canvas é um desenho só.
 *
 * A cor vem de `--sidebar-primary`, a mesma que já brilha em volta da logo na
 * barra lateral. Ela é a cor de destaque feita para fundo escuro em TODAS as
 * paletas, então o orbe acompanha a paleta escolhida sem precisar de uma cor
 * própria por tema.
 */

export type FaseDoOrbe = "ouvindo" | "processando" | "pausado";

type RGB = [number, number, number];

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

/** Gira o matiz mantendo saturação e luz — as duas cores vizinhas do plasma. */
function girarMatiz([r, g, b]: RGB, graus: number): RGB {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [r, g, b]; // cinza: não há matiz para girar
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
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

export function OrbeDeVoz({
  fase,
  falando,
  leituraRef,
  tamanho,
}: {
  fase: FaseDoOrbe;
  /**
   * O roteiro de demonstração está "falando". Sem microfone, é o que anima o
   * orbe como voz; com microfone, soma-se a ele num peso menor, para o orbe
   * não ficar parado enquanto o texto de demonstração aparece.
   */
  falando: boolean;
  leituraRef: RefObject<LeituraDoMicrofone>;
  tamanho: number;
}) {
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
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(tamanho * dpr);
    canvas.height = Math.round(tamanho * dpr);

    const cor = corParaRgb(
      getComputedStyle(canvas).getPropertyValue("--sidebar-primary").trim(),
      [110, 200, 255],
    );
    const corB = girarMatiz(cor, 38);
    const corC = girarMatiz(cor, -38);
    const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const S = tamanho;
    const cx = S / 2;
    const cy = S / 2;
    // Raios em fração do tamanho: o mesmo desenho em 240px e em 340px.
    const R = { logo: S * 0.165, onda: S * 0.205, barras: S * 0.29, hud: S * 0.415 };

    const N_BARRAS = 36; // por lado — o espectro é espelhado no eixo vertical
    const barras = new Float32Array(N_BARRAS);
    const particulas = Array.from({ length: 34 }, () => ({
      angulo: Math.random() * Math.PI * 2,
      raio: R.onda + 18 + Math.random() * (S * 0.44 - R.onda - 18),
      vel: (0.05 + Math.random() * 0.18) * (Math.random() < 0.5 ? -1 : 1),
      tam: 0.6 + Math.random() * 1.4,
      fase: Math.random() * 10,
    }));

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

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.globalCompositeOperation = "source-over";

      /* ---- 2. Halo ----
         Termina em S/2 exato: um raio maior seria cortado pelas bordas do
         canvas e o brilho viraria um quadrado. O que passa disso é a aura em
         CSS, lá embaixo, que não tem borda. */
      const halo = ctx.createRadialGradient(cx, cy, R.logo * 0.6, cx, cy, S / 2);
      halo.addColorStop(0, rgba(cor, (0.3 + nivel * 0.35) * apagado));
      halo.addColorStop(0.4, rgba(cor, (0.08 + nivel * 0.16) * apagado));
      halo.addColorStop(1, rgba(cor, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, S, S);

      /* ---- 3. HUD: anel tracejado, arcos e régua ---- */
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
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(cor, 0.75 * apagado);
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 9, 0, 0.95);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 9, Math.PI, Math.PI + 0.45);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(corB, 0.5 * apagado);
      ctx.beginPath();
      ctx.arc(0, 0, R.hud + 14, Math.PI * 0.5, Math.PI * 0.5 + 0.6);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotacao * 0.1);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const forte = i % 9 === 0;
        const r1 = R.hud + 19;
        const r2 = r1 + (forte ? 6 : 3);
        ctx.strokeStyle = rgba(cor, (forte ? 0.55 : 0.16) * apagado);
        ctx.lineWidth = forte ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
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
        ctx.arc(cx, cy, R.barras - 4, 0, Math.PI * 2, true);
        ctx.fill();
      }

      /* ---- 4. Espectro radial ----
         Com microfone, as faixas do espectro de verdade — as mais baixas, onde
         mora a voz, ficam no alto do círculo. Sem microfone, ruído moldado pelo
         nível. O maior dos dois vence, então a demonstração nunca apaga uma voz
         real. */
      const esp = leitura?.espectro;
      for (let i = 0; i < N_BARRAS; i++) {
        let v = 0;
        if (an && esp && esp.length > 0) {
          const bin = Math.floor(2 + Math.pow(i / N_BARRAS, 1.5) * 80);
          v = Math.min(1, ((esp[bin] ?? 0) / 255) * 1.25);
        }
        const s =
          nivel *
          (0.35 + 0.65 * (0.5 + 0.5 * ruido(i * 0.55 + t * 2.6))) *
          (1 - i / (N_BARRAS * 1.35));
        const alvoBarra = f === "pausado" ? 0 : Math.max(v * (f === "processando" ? 0.4 : 1), s);
        barras[i] = (barras[i] ?? 0) + (alvoBarra - (barras[i] ?? 0)) * 0.22;
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineCap = "round";
      ctx.lineWidth = 2.2;
      for (let i = 0; i < N_BARRAS; i++) {
        const b = barras[i] ?? 0;
        const comp = 2.5 + b * S * 0.115;
        ctx.strokeStyle = rgba(misturar(cor, corB, i / N_BARRAS), (0.22 + b * 0.7) * apagado);
        const desvio = ((i + 0.5) / N_BARRAS) * Math.PI;
        for (const lado of [1, -1]) {
          const a = -Math.PI / 2 + lado * desvio;
          const co = Math.cos(a);
          const se = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(co * R.barras, se * R.barras);
          ctx.lineTo(co * (R.barras + comp), se * (R.barras + comp));
          ctx.stroke();
        }
      }
      ctx.restore();

      /* ---- 5. Disco escuro sob a logo ----
         Sem ele, o branco da logo se perde no próprio brilho do halo. */
      const disco = ctx.createRadialGradient(cx, cy, 0, cx, cy, R.logo + 12);
      disco.addColorStop(0, "rgba(0,0,0,0.6)");
      disco.addColorStop(0.75, "rgba(0,0,0,0.4)");
      disco.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disco;
      ctx.beginPath();
      ctx.arc(cx, cy, R.logo + 12, 0, Math.PI * 2);
      ctx.fill();

      /* ---- 6. Plasma ----
         Três contornos em cores vizinhas somados com `lighter`: onde se
         cruzam, clareiam, e é isso que dá a borda iridescente. A amplitude é o
         nível — em silêncio é quase um círculo, falando alto ele se desfaz. */
      ctx.globalCompositeOperation = "lighter";
      const amp = 2.5 + nivel * S * 0.075;
      const camadas: [RGB, number][] = [
        [cor, 0],
        [corB, 2.1],
        [corC, 4.2],
      ];
      for (const [c, ph] of camadas) {
        ctx.beginPath();
        for (let j = 0; j <= 120; j++) {
          const a = (j / 120) * Math.PI * 2;
          const w =
            Math.sin(a * 3 + t * 1.6 + ph) * 0.5 +
            Math.sin(a * 5 - t * 2.2 + ph * 1.3) * 0.32 +
            Math.sin(a * 8 + t * 3.1 + ph * 0.7) * 0.18;
          const r = R.onda + 4 + w * amp;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = rgba(c, (0.04 + nivel * 0.07) * apagado);
        ctx.fill();
        ctx.shadowColor = rgba(c, 0.9 * apagado);
        ctx.shadowBlur = 10 + nivel * 22;
        ctx.lineWidth = 1.5 + nivel * 1.5;
        ctx.strokeStyle = rgba(c, 0.8 * apagado);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      /* ---- 7. Partículas ---- */
      for (const p of particulas) {
        p.angulo += p.vel * dt * (f === "processando" ? 3 : 1) * (calmo ? 0.2 : 1);
        const r = p.raio + nivel * 14 + Math.sin(t * 0.8 + p.fase) * 3;
        ctx.fillStyle = rgba(
          cor,
          (0.15 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2 + p.fase * 3))) * apagado,
        );
        ctx.beginPath();
        ctx.arc(cx + Math.cos(p.angulo) * r, cy + Math.sin(p.angulo) * r, p.tam, 0, Math.PI * 2);
        ctx.fill();
      }
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
        aura.style.opacity = ((0.35 + nivel * 0.65) * apagado).toFixed(3);
        aura.style.transform = `scale(${(0.9 + nivel * 0.3).toFixed(4)})`;
      }
    };

    quadro = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(quadro);
  }, [tamanho, leituraRef]);

  const logo = Math.round(tamanho * 0.165 * 2 * 0.92);

  return (
    <div className="relative" style={{ width: tamanho, height: tamanho }}>
      {/* A aura passa das bordas do canvas de propósito: é o brilho que se
          espalha pela tela quando a voz sobe. Em CSS, com blur, não tem borda
          para cortar. */}
      <div
        ref={auraRef}
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[22%] rounded-full blur-2xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--sidebar-primary) 38%, transparent) 0%, transparent 62%)",
          opacity: 0.35,
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0"
        style={{ width: tamanho, height: tamanho }}
      />
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
