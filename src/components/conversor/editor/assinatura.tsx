import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, X } from "lucide-react";
import { BOTAO_CONTORNO, BOTAO_DISCRETO, BOTAO_PRINCIPAL } from "../visual";

/*
 * Desenhar a assinatura (05/11/2026): com o mouse ou o dedo, num quadro, e ela entra
 * na página como uma imagem de fundo transparente, para pôr onde quiser.
 */

const LARGURA = 520;
const ALTURA = 200;
const CORES = ["#111827", "#1d4ed8"] as const;

/** O desenho recortado ao que tem tinta, com fundo transparente. `null` se está em branco. */
function recortar(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const { width, height } = canvas;
  const dados = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (dados[(y * width + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return Promise.resolve(null);
  const saida = document.createElement("canvas");
  saida.width = x1 - x0 + 1;
  saida.height = y1 - y0 + 1;
  saida.getContext("2d")?.drawImage(canvas, -x0, -y0);
  return new Promise((resolve) => saida.toBlob((b) => resolve(b), "image/png"));
}

export function QuadroDeAssinatura({
  aoUsar,
  aoFechar,
}: {
  aoUsar: (arquivo: File) => void;
  aoFechar: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cor, setCor] = useState<string>(CORES[0]);
  const [temTinta, setTemTinta] = useState(false);
  const ultimo = useRef<[number, number] | null>(null);
  const densidade = Math.min(window.devicePixelRatio || 1, 2) * 2;

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = LARGURA * densidade;
    c.height = ALTURA * densidade;
  }, [densidade]);

  /* No documento, e não no quadro: desenhar no canvas tira o foco dos botões, e o Esc
     cairia na página, longe do quadro. */
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aoFechar]);

  const ponto = (e: ReactPointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.current!.width,
      ((e.clientY - r.top) / r.height) * canvas.current!.height,
    ];
  };

  const riscar = (de: [number, number], ate: [number, number]) => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2.4 * densidade;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(de[0], de[1]);
    ctx.lineTo(ate[0], ate[1]);
    ctx.stroke();
  };

  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/60"
      data-quadro-assinatura
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        role="dialog"
        aria-label="Desenhar a assinatura"
        className="w-[min(94vw,36rem)] rounded-[1.75rem] border border-white/15 bg-zinc-900 p-5 text-white shadow-[0_30px_90px_rgb(0_0_0/0.6)]"
      >
        <div className="mb-3 flex items-center gap-3">
          <h3 className="flex-1 text-lg font-bold">Assinatura</h3>
          <button
            type="button"
            autoFocus
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-full p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-3 text-sm text-white/60">
          Desenhe com o mouse. Ela entra na página com o fundo transparente.
        </p>
        <canvas
          ref={canvas}
          aria-label="Quadro para desenhar a assinatura"
          className="block aspect-[52/20] w-full cursor-crosshair touch-none rounded-2xl bg-white"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            ultimo.current = ponto(e);
            riscar(ultimo.current, ultimo.current);
            setTemTinta(true);
          }}
          onPointerMove={(e) => {
            if (!ultimo.current) return;
            const p = ponto(e);
            riscar(ultimo.current, p);
            ultimo.current = p;
          }}
          onPointerUp={() => {
            ultimo.current = null;
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCor(c)}
              aria-label={c === CORES[0] ? "Tinta preta" : "Tinta azul"}
              aria-pressed={cor === c}
              className={`h-7 w-7 rounded-full border-2 transition ${
                cor === c ? "border-[var(--acento)]" : "border-white/25"
              }`}
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            className={BOTAO_DISCRETO}
            onClick={() => {
              const c = canvas.current;
              c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
              setTemTinta(false);
            }}
          >
            <Eraser className="h-4 w-4" /> Limpar
          </button>
          <span className="flex-1" />
          <button type="button" className={BOTAO_CONTORNO} onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className={BOTAO_PRINCIPAL}
            disabled={!temTinta}
            onClick={() => {
              const c = canvas.current;
              if (!c) return;
              void recortar(c).then((b) => {
                if (b) aoUsar(new File([b], "assinatura.png", { type: "image/png" }));
              });
            }}
          >
            Usar assinatura
          </button>
        </div>
      </div>
    </div>
  );
}
