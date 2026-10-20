import {
  CanvasTexture,
  ClampToEdgeWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from "three";
import { sementeNum } from "@/components/rv/cabelo-rng";

/*
 * Texturas do cabelo e dos chapéus, pintadas em canvas UMA vez e
 * compartilhadas por todos os avatares (cache de módulo, sem dispose): são
 * todas em cinza, porque a cor vem do shader (uniform), não da textura —
 * assim 10 avatares de cores diferentes usam a mesma imagem.
 *
 * Convenção (flipY = false): u = atravessado (repete), v = ao longo do fio
 * (v = 0 na raiz; passado de 1 repete a última linha, que só tem fios retos).
 * Só são criadas no primeiro uso e recebendo o `gl` (nada de canvas no topo
 * do módulo: o app também roda no servidor).
 */

const L = 256;
const A = 256;

/** Linhas do topo da textura sem fios (cinza liso): elástico, miolo do coque, miçanga. */
export const V_LISO = 0.006;
/** Onde começam a casca e as mechas (logo abaixo da faixa lisa). */
export const V_INICIO = 0.03;
/** Centro da faixa de brilho (em v). */
export const V_BRILHO = 0.3;

let anisotropia: number | null = null;

/**
 * Decidida uma vez só, na primeira textura: no SwiftShader (software, a sala
 * de quem não tem GPU) a filtragem anisotrópica custa caro e não aparece;
 * com GPU, até 4. Não muda depois do upload.
 */
function anisotropiaDe(gl: WebGLRenderer): number {
  if (anisotropia !== null) return anisotropia;
  let nome = "";
  try {
    const ctx = gl.getContext();
    nome = String(ctx.getParameter(ctx.RENDERER) ?? "");
    if (!/swiftshader/i.test(nome)) {
      const ext = ctx.getExtension("WEBGL_debug_renderer_info");
      if (ext) nome += " " + String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
    }
  } catch (e) {
    // Sem como saber o renderizador: fica no seguro (1) e avisa.
    console.warn("[cabelo] não deu para ler o renderizador WebGL", e);
    nome = "swiftshader";
  }
  anisotropia = /swiftshader/i.test(nome)
    ? 1
    : Math.max(1, Math.min(4, gl.capabilities.getMaxAnisotropy()));
  return anisotropia;
}

function tela(l = L, a = A): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = l;
  c.height = a;
  const g = c.getContext("2d");
  return g ? { c, g } : null;
}

function cinza(l: number, a = 1): string {
  const v = Math.round(Math.max(0, Math.min(1, l)) * 255);
  return `rgba(${v},${v},${v},${a})`;
}

function finalizar(c: HTMLCanvasElement, gl: WebGLRenderer, repeteV = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  t.wrapS = RepeatWrapping;
  t.wrapT = repeteV ? RepeatWrapping : ClampToEdgeWrapping;
  t.anisotropy = anisotropiaDe(gl);
  return t;
}

/** Um fio levemente ondulado de y0 a y1, desenhado 3× para emendar na borda (repete em u). */
function fio(
  g: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  larg: number,
  r: () => number,
  l = L,
) {
  const o1 = (r() - 0.5) * 5;
  const o2 = (r() - 0.5) * 5;
  const o3 = (r() - 0.5) * 3;
  for (const dx of [-l, 0, l]) {
    g.beginPath();
    g.lineWidth = larg;
    g.moveTo(x + dx, y0);
    g.bezierCurveTo(
      x + dx + o1,
      y0 + (y1 - y0) * 0.33,
      x + dx + o2,
      y0 + (y1 - y0) * 0.66,
      x + dx + o3,
      y1,
    );
    g.stroke();
  }
}

/**
 * Os fios: base, listras, fios claros/escuros, falhas, raiz escura e faixa
 * lisa. Contraste BAIXO de propósito: no loiro, fio escuro forte vira listra
 * de madeira/papelão; o desenho tem de ler como cabelo de longe (±3–5%) e o
 * brilho fica por conta do material.
 */
function pintarFios(g: CanvasRenderingContext2D, anel: boolean) {
  const r = sementeNum(1234);
  g.lineCap = "round";
  g.fillStyle = cinza(0.86);
  g.fillRect(0, 0, L, A);
  // Listras finas (a cada 5–8 px) e largas: o "penteado" que se lê de longe.
  for (let x = 0; x < L;) {
    const w = 5 + Math.floor(r() * 4);
    g.fillStyle = cinza(r() < 0.5 ? 1 : 0, 0.03 + r() * 0.03);
    g.fillRect(x, 0, Math.max(1, Math.floor(w / 2)), A);
    x += w;
  }
  for (let x = 0; x < L;) {
    const w = 18 + Math.floor(r() * 22);
    g.fillStyle = cinza(r() < 0.5 ? 1 : 0, 0.05);
    g.fillRect(x, 0, Math.floor(w * 0.6), A);
    x += w;
  }
  // Fios claros e escuros, compridos (chegam à última linha → ClampToEdge vira fio reto):
  // os escuros com alfa ≤ 0,25 e luminância ≥ 0,65.
  for (let i = 0; i < 150; i++) {
    const x = r() * L;
    const claro = r() < 0.55;
    g.strokeStyle = claro
      ? cinza(0.93 + r() * 0.07, 0.22 + r() * 0.26)
      : cinza(0.65 + r() * 0.1, 0.12 + r() * 0.13);
    fio(g, x, r() < 0.75 ? 0 : r() * A * 0.6, A, 0.8 + r() * 1.8, r);
  }
  // Falhas (separação entre fios): poucas e suaves.
  for (let i = 0; i < 20; i++) {
    g.strokeStyle = cinza(0.55, 0.12 + r() * 0.14);
    fio(g, r() * L, r() * A * 0.3, A, 0.6 + r() * 0.6, r);
  }
  // Ao longo do fio: raiz um pouco mais escura, cheio no meio (v 0,35), levemente mais escuro
  // na ponta.
  const ao = g.createLinearGradient(0, 0, 0, A);
  ao.addColorStop(0, cinza(0, 0.26));
  ao.addColorStop(0.35, cinza(0, 0));
  ao.addColorStop(1, cinza(0, 0.08));
  g.fillStyle = ao;
  g.fillRect(0, 0, L, A);
  if (anel) {
    // O anel de brilho pintado dos cabelos anime (catálogos 53/54): +20–25% numa faixa larga
    // em v 0,24–0,36, com a borda serrilhada de fios de comprimentos diferentes.
    const yc = A * 0.3;
    const faixaAnel = g.createLinearGradient(0, yc - A * 0.06, 0, yc + A * 0.06);
    faixaAnel.addColorStop(0, cinza(1, 0));
    faixaAnel.addColorStop(0.5, cinza(1, 0.22));
    faixaAnel.addColorStop(1, cinza(1, 0));
    g.fillStyle = faixaAnel;
    g.fillRect(0, yc - A * 0.06, L, A * 0.12);
    for (let i = 0; i < 170; i++) {
      const x = r() * L;
      const y0 = A * (0.23 + r() * 0.04);
      const y1 = A * (0.33 + r() * 0.05);
      g.strokeStyle = cinza(1, 0.25 + r() * 0.25);
      fio(g, x, y0, y1, 1 + r() * 2.2, r);
    }
  }
  // Faixa lisa reservada (elástico, miolo, miçanga): cinza uniforme.
  g.fillStyle = cinza(0.62);
  g.fillRect(0, 0, L, Math.ceil(A * V_LISO * 2));
}

const cache = new Map<string, CanvasTexture>();

function criar(
  chave: string,
  gl: WebGLRenderer,
  pintar: (g: CanvasRenderingContext2D, l: number, a: number) => void,
  l = L,
  a = A,
  repeteV = false,
): CanvasTexture | null {
  const pronta = cache.get(chave);
  if (pronta) return pronta;
  const t = tela(l, a);
  if (!t) return null;
  pintar(t.g, l, a);
  const tx = finalizar(t.c, gl, repeteV);
  cache.set(chave, tx);
  return tx;
}

/** Luminância dos fios (compartilhada; NÃO dar dispose por avatar). */
export function texturaFios(gl: WebGLRenderer): CanvasTexture | null {
  return criar("fios", gl, (g) => pintarFios(g, false));
}

/** Os mesmos fios com o anel de brilho pintado (anime/emo/espetado). */
export function texturaFiosAnel(gl: WebGLRenderer): CanvasTexture | null {
  return criar("fiosAnel", gl, (g) => pintarFios(g, true));
}

/** Máscara do anel de brilho (emissiveMap da qualidade média). Preto = sem brilho. */
export function texturaBrilho(gl: WebGLRenderer): CanvasTexture | null {
  return criar("brilho", gl, (g) => {
    const r = sementeNum(98765);
    g.lineCap = "round";
    g.fillStyle = "#000";
    g.fillRect(0, 0, L, A);
    const yc = V_BRILHO * A;
    const meia = 0.05 * A;
    const fundo = g.createLinearGradient(0, yc - meia, 0, yc + meia);
    fundo.addColorStop(0, cinza(1, 0));
    fundo.addColorStop(0.5, cinza(1, 0.22));
    fundo.addColorStop(1, cinza(1, 0));
    g.fillStyle = fundo;
    g.fillRect(0, yc - meia, L, meia * 2);
    // Riscos de comprimentos diferentes: a borda serrilhada do anel (estilo Roblox).
    for (let i = 0; i < 120; i++) {
      const x = r() * L;
      const y0 = yc - meia * (0.3 + r() * 0.9);
      const y1 = yc + meia * (0.2 + r() * 0.9);
      const grad = g.createLinearGradient(0, y0, 0, y1);
      const a = 0.35 + r() * 0.65;
      grad.addColorStop(0, cinza(1, 0));
      grad.addColorStop(0.3 + r() * 0.3, cinza(1, a));
      grad.addColorStop(1, cinza(1, 0));
      g.strokeStyle = grad;
      fio(g, x, y0, y1, 0.8 + r() * 2.2, r);
    }
    // Fios fracos no comprimento todo: no cabelo escuro, é o que mostra o desenho dos fios.
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = cinza(1, 0.08 + r() * 0.14);
      fio(g, r() * L, r() * A * 0.4, A, 0.8 + r() * 1.4, r);
    }
  });
}

/** Cachinhos (black power, cacheados): molinhas em grade hexagonal de 18 px, vale escuro. */
export function texturaCachos(gl: WebGLRenderer): CanvasTexture | null {
  return criar(
    "cachos",
    gl,
    (g) => {
      const r = sementeNum(4242);
      g.fillStyle = cinza(0.5);
      g.fillRect(0, 0, L, A);
      g.lineCap = "round";
      const passo = 18;
      for (let lin = 0; lin * passo * 0.866 < A + passo; lin++) {
        for (let col = 0; col * passo < L + passo; col++) {
          const x = col * passo + (lin % 2 ? passo / 2 : 0) + (r() - 0.5) * 4;
          const y = lin * passo * 0.866 + (r() - 0.5) * 4;
          const raio = 5 + r() * 3;
          const a0 = r() * Math.PI * 2;
          for (const dx of [-L, 0, L])
            for (const dy of [-A, 0, A]) {
              // A molinha: espiral clara sobre o vale escuro.
              g.fillStyle = cinza(0.25, 0.5);
              g.beginPath();
              g.arc(x + dx, y + dy, raio + 2, 0, Math.PI * 2);
              g.fill();
              for (let k = 0; k < 3; k++) {
                g.strokeStyle = cinza(0.75 + 0.2 * (k / 2), 0.7);
                g.lineWidth = 1.6;
                g.beginPath();
                g.arc(x + dx, y + dy, raio * (1 - k * 0.28), a0 + k, a0 + k + Math.PI * 1.4);
                g.stroke();
              }
            }
        }
      }
    },
    L,
    A,
    true,
  );
}

/** Pontinhos de cabelo rente / barba por fazer (raspado, degradê, borda da barba). */
export function texturaRente(gl: WebGLRenderer): CanvasTexture | null {
  return criar(
    "rente",
    gl,
    (g) => {
      const r = sementeNum(777);
      g.fillStyle = cinza(0.7);
      g.fillRect(0, 0, L, A);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = r() < 0.6 ? cinza(0.35, 0.5 + r() * 0.4) : cinza(0.95, 0.4);
        const x = r() * L;
        const y = r() * A;
        g.fillRect(x, y, 1 + r() * 1.5, 2 + r() * 2.5);
      }
    },
    L,
    A,
    true,
  );
}

export type TexturaDeChapeu = "chapeu" | "bone" | "gorro" | "capacete";

/** Feltro/palha (chapeu), sarja (bone), ribana (gorro), plástico com nervura (capacete). 256×128. */
export function texturaChapeu(tipo: TexturaDeChapeu, gl: WebGLRenderer): CanvasTexture | null {
  return criar(
    `chapeu-${tipo}`,
    gl,
    (g, l, a) => {
      const r = sementeNum(31 + tipo.length);
      g.fillStyle = cinza(tipo === "chapeu" ? 0.97 : 0.9);
      g.fillRect(0, 0, l, a);
      if (tipo === "chapeu") {
        // Feltro/palha: trama fina horizontal + fibrinhas soltas + manchas largas suaves.
        for (let y = 0; y < a; y += 3) {
          g.fillStyle = cinza(y % 6 ? 1 : 0.82, 0.25);
          g.fillRect(0, y, l, 1);
        }
        for (let i = 0; i < 500; i++) {
          g.strokeStyle = r() < 0.5 ? cinza(1, 0.3) : cinza(0.75, 0.18);
          g.lineWidth = 0.8;
          const x = r() * l;
          const y = r() * a;
          const c = 3 + r() * 6;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + c, y + (r() - 0.5) * 2);
          g.stroke();
        }
        for (let i = 0; i < 18; i++) {
          g.fillStyle = cinza(r() < 0.5 ? 1 : 0.7, 0.06);
          g.beginPath();
          g.ellipse(r() * l, r() * a, 20 + r() * 30, 8 + r() * 12, 0, 0, Math.PI * 2);
          g.fill();
        }
      } else if (tipo === "bone") {
        for (let i = -a; i < l; i += 4) {
          g.strokeStyle = cinza(0.75, 0.35);
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(i, a);
          g.lineTo(i + a, 0);
          g.stroke();
        }
      } else if (tipo === "gorro") {
        for (let x = 0; x < l; x += 8) {
          g.fillStyle = cinza(0.62, 0.8);
          g.fillRect(x, 0, 3, a);
        }
      } else {
        g.fillStyle = cinza(1, 0.25);
        g.fillRect(0, a * 0.2, l, a * 0.1);
      }
    },
    L,
    128,
    true,
  );
}
