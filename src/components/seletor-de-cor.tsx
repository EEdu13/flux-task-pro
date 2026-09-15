import { useEffect, useRef, useState } from "react";
import { Check, Pipette, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Cor personalizada, do jeito do Paint: um quadro para escolher intensidade e
 * luz com o mouse, e a tonalidade numa faixa de arco-íris ao lado.
 *
 * Trabalha em HSV porque é o modelo em que "arrastar para a direita deixa mais
 * viva, para baixo deixa mais escura" é literal — é o que as pessoas conhecem
 * de qualquer editor de imagem. A cor sai em `#rrggbb`: cabe na coluna de 40
 * caracteres do projeto e qualquer CSS entende.
 */

type Hsv = { h: number; s: number; v: number };

function hsvParaHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}`;
}

function hexParaHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/**
 * Qualquer cor de CSS (inclusive as `oklch(...)` da paleta) → `#rrggbb`.
 * O canvas faz a conversão: é o próprio navegador resolvendo a cor.
 */
function corParaHex(cor: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(cor)) return cor.toLowerCase();
  if (typeof document === "undefined") return null;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#000";
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((x) => x!.toString(16).padStart(2, "0")).join("")}`;
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function SeletorDeCor({
  valor,
  aoMudar,
  personalizada,
}: {
  valor: string;
  aoMudar: (cor: string) => void;
  /** A cor atual veio daqui, e não da paleta — o botão aparece selecionado. */
  personalizada: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [hsv, setHsv] = useState<Hsv>({ h: 150, s: 0.7, v: 0.7 });
  const [textoHex, setTextoHex] = useState("");
  const quadroRef = useRef<HTMLDivElement>(null);

  // Abre na cor que já está escolhida, seja da paleta ou personalizada.
  useEffect(() => {
    if (!aberto) return;
    const hex = corParaHex(valor);
    const inicial = hex ? hexParaHsv(hex) : null;
    if (inicial) setHsv(inicial);
    setTextoHex(hex ?? "");
    // Só ao abrir: enquanto mexe, quem manda é o próprio seletor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const aplicar = (novo: Hsv) => {
    setHsv(novo);
    const hex = hsvParaHex(novo);
    setTextoHex(hex);
    aoMudar(hex);
  };

  const arrastarNoQuadro = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = quadroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    aplicar({ h: hsv.h, s: x, v: 1 - y });
  };

  const temContaGotas =
    typeof window !== "undefined" && "EyeDropper" in window;
  const usarContaGotas = async () => {
    try {
      const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
      const { sRGBHex } = await new Ctor().open();
      const novo = hexParaHsv(sRGBHex);
      if (novo) aplicar(novo);
    } catch {
      /* a pessoa apertou Esc */
    }
  };

  const atual = hsvParaHex(hsv);
  const faixa = (fundo: string) => ({ background: fundo });

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Cor personalizada"
          aria-label="Escolher uma cor personalizada"
          className={`relative flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition ${
            personalizada ? "ring-foreground" : "ring-transparent hover:scale-110"
          }`}
          style={{
            background: personalizada
              ? valor
              : "conic-gradient(from 90deg, #ff4d4d, #ffd84d, #6bff6b, #4dffff, #4d6bff, #ff4dff, #ff4d4d)",
          }}
        >
          {personalizada ? (
            <Check className="h-3.5 w-3.5 text-white drop-shadow" />
          ) : (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-card">
              <Plus className="h-3 w-3 text-foreground" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-450 w-64 space-y-3 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cor personalizada
        </div>

        {/* Quadro: para a direita mais viva, para baixo mais escura. */}
        <div
          ref={quadroRef}
          role="slider"
          aria-label="Intensidade e luz"
          aria-valuetext={`Intensidade ${Math.round(hsv.s * 100)}%, luz ${Math.round(hsv.v * 100)}%`}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            arrastarNoQuadro(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) arrastarNoQuadro(e);
          }}
          onKeyDown={(e) => {
            const passo = e.shiftKey ? 0.1 : 0.02;
            const mapa: Record<string, Partial<Hsv>> = {
              ArrowRight: { s: Math.min(1, hsv.s + passo) },
              ArrowLeft: { s: Math.max(0, hsv.s - passo) },
              ArrowUp: { v: Math.min(1, hsv.v + passo) },
              ArrowDown: { v: Math.max(0, hsv.v - passo) },
            };
            if (mapa[e.key]) {
              e.preventDefault();
              aplicar({ ...hsv, ...mapa[e.key] });
            }
          }}
          className="relative h-36 w-full cursor-crosshair touch-none overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvParaHex({ h: hsv.h, s: 1, v: 1 })})`,
          }}
        >
          <span
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: atual }}
          />
        </div>

        <Faixa
          rotulo="Tonalidade"
          valor={hsv.h}
          max={360}
          fundo={faixa(
            "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          )}
          aoMudar={(h) => aplicar({ ...hsv, h })}
        />
        <Faixa
          rotulo="Intensidade"
          valor={hsv.s * 100}
          max={100}
          fundo={faixa(
            `linear-gradient(to right, ${hsvParaHex({ ...hsv, s: 0 })}, ${hsvParaHex({ ...hsv, s: 1 })})`,
          )}
          aoMudar={(s) => aplicar({ ...hsv, s: s / 100 })}
        />
        <Faixa
          rotulo="Luz e sombra"
          valor={hsv.v * 100}
          max={100}
          fundo={faixa(`linear-gradient(to right, #000, ${hsvParaHex({ ...hsv, v: 1 })})`)}
          aoMudar={(v) => aplicar({ ...hsv, v: v / 100 })}
        />

        <div className="flex items-center gap-2">
          <span
            className="h-8 w-8 shrink-0 rounded-md border border-border"
            style={{ background: atual }}
            aria-hidden
          />
          <input
            value={textoHex}
            onChange={(e) => {
              const v = e.target.value;
              setTextoHex(v);
              const novo = hexParaHsv(v);
              if (novo) {
                setHsv(novo);
                aoMudar(`#${v.replace("#", "").toLowerCase()}`);
              }
            }}
            spellCheck={false}
            maxLength={7}
            aria-label="Código da cor"
            placeholder="#22c55e"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs uppercase outline-none focus:border-primary"
          />
          {temContaGotas && (
            <button
              type="button"
              onClick={usarContaGotas}
              title="Conta-gotas: pegar uma cor da tela"
              aria-label="Pegar uma cor da tela"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-primary hover:text-primary"
            >
              <Pipette className="h-4 w-4" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Faixa({
  rotulo,
  valor,
  max,
  fundo,
  aoMudar,
}: {
  rotulo: string;
  valor: number;
  max: number;
  fundo: React.CSSProperties;
  aoMudar: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        {rotulo}
        <span className="tabular-nums">
          {Math.round(valor)}
          {max === 360 ? "°" : "%"}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={valor}
        onChange={(e) => aoMudar(Number(e.target.value))}
        className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
        style={fundo}
      />
    </label>
  );
}
