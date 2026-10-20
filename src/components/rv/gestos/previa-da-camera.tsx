/*
 * previa-da-camera.tsx — a janelinha 192×108 com a câmera ESPELHADA e o esqueleto por cima.
 *
 * Por que existe: o reconhecimento só funciona com ombros e espaço acima da cabeça no quadro.
 * Ver o esqueleto verde é o jeito mais rápido de a pessoa se ajustar ("afaste-se um pouco").
 * Desenha a no máximo 15 qps num <canvas> próprio — o <video> da câmera fica invisível e nunca
 * é publicado na sala.
 * Quando abrir (1ª vez sozinha por 5 s, depois só se quiser) fica em use-previa-da-camera.ts.
 */
import { useEffect, useRef, type RefObject } from "react";
import { RotateCcw, X } from "lucide-react";
import { LIGACOES_DO_ESQUELETO } from "@/lib/rv-gestos-heuristica";
import type { EstadoGestos } from "./use-gestos";
import { TEXTO_DO_ESTADO } from "./use-gestos";

const LARGURA = 192;
const ALTURA = 108;
const QPS_DO_DESENHO = 15;
const VERDE = "#22c55e";
const VISIBILIDADE_MIN = 0.5;

export function PreviaDaCamera({
  video,
  pontos,
  estado,
  delegate,
  qps,
  aoRecalibrar,
  aoFechar,
  dica,
}: {
  video: HTMLVideoElement | null;
  pontos: RefObject<number[][] | null>;
  estado: EstadoGestos;
  delegate: "GPU" | "CPU" | null;
  qps: number;
  aoRecalibrar: () => void;
  aoFechar: () => void;
  dica?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let id = 0;
    let ultimo = 0;
    const desenhar = (agora: number) => {
      id = requestAnimationFrame(desenhar);
      if (agora - ultimo < 1000 / QPS_DO_DESENHO - 2) return;
      ultimo = agora;
      ctx.save();
      // Espelho: a pessoa se vê como num espelho (a mão direita dela aparece à direita).
      ctx.setTransform(-1, 0, 0, 1, LARGURA, 0);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, LARGURA, ALTURA);
      if (video && video.readyState >= 2 && video.videoWidth) {
        // "cover": preenche os 16:9 da prévia sem distorcer câmeras 4:3.
        const ev = Math.max(LARGURA / video.videoWidth, ALTURA / video.videoHeight);
        const w = video.videoWidth * ev;
        const h = video.videoHeight * ev;
        const ox = (LARGURA - w) / 2;
        const oy = (ALTURA - h) / 2;
        ctx.drawImage(video, ox, oy, w, h);
        const p = pontos.current;
        if (p && p.length >= 25) {
          ctx.strokeStyle = VERDE;
          ctx.fillStyle = VERDE;
          ctx.lineWidth = 2;
          const xy = (i: number) => [ox + p[i][0] * w, oy + p[i][1] * h] as const;
          for (const [a, b] of LIGACOES_DO_ESQUELETO) {
            if (p[a][2] < VISIBILIDADE_MIN || p[b][2] < VISIBILIDADE_MIN) continue;
            const [x1, y1] = xy(a);
            const [x2, y2] = xy(b);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          for (let i = 0; i < 25; i++) {
            if (p[i][2] < VISIBILIDADE_MIN) continue;
            const [x, y] = xy(i);
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    };
    id = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(id);
  }, [video, pontos]);

  const selo =
    estado === "ativo"
      ? `${delegate ?? "?"} · ${qps} qps`
      : estado === "carregando" || estado === "aquecendo" || estado === "pedindo"
        ? "carregando…"
        : TEXTO_DO_ESTADO[estado];

  return (
    <div
      className="pointer-events-auto relative overflow-hidden rounded-xl border border-white/20 bg-black/80 shadow-xl"
      style={{ width: LARGURA }}
    >
      <canvas
        ref={canvasRef}
        width={LARGURA}
        height={ALTURA}
        className="block"
        aria-label="Prévia da câmera (só para gestos, não transmitida)"
      />
      <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {selo}
      </span>
      <button
        type="button"
        onClick={aoFechar}
        className="absolute right-1 top-1 grid h-6 w-6 cursor-pointer place-items-center rounded-full bg-black/65 text-white hover:bg-black/85"
        aria-label="Fechar prévia"
        title="Fechar prévia"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {(estado === "carregando" || estado === "aquecendo" || estado === "pedindo") && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 text-center text-[11px] font-medium text-white/90">
          {TEXTO_DO_ESTADO[estado]}
        </div>
      )}
      {dica && (
        <div className="bg-[#f59e0b] px-2 py-1 text-[11px] font-semibold leading-tight text-black">
          {dica}
        </div>
      )}
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <span
          className="truncate text-[10px] text-white/70"
          title="Câmera só para gestos, não transmitida"
        >
          📷 local
        </span>
        <button
          type="button"
          onClick={aoRecalibrar}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-white/15"
          title="Olhe para a tela e clique: vira o 'olhando para a frente' do avatar"
        >
          <RotateCcw className="h-3 w-3" />
          Recalibrar cabeça
        </button>
      </div>
    </div>
  );
}
