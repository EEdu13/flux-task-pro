/*
 * As texturas do escritório "de verdade" (18/10/2026, fotos do escritório:
 * divisória com rodapé alto de madeira em réguas, vidro com perfil preto,
 * porta de vidro com listras foscas, porcelanato cinza-claro, mesa de
 * madeira com pé de metalon preto).
 *
 * Todas desenhadas em canvas uma vez só e reaproveitadas por todas as salas
 * (o andar inteiro divide meia dúzia de texturas). Sem arquivos de imagem.
 */
import { CanvasTexture, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from "three";

const cache = new Map<string, CanvasTexture>();

function criar(chave: string, w: number, h: number, pintar: (g: CanvasRenderingContext2D) => void) {
  const pronta = cache.get(chave);
  if (pronta) return pronta;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  pintar(g);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(chave, t);
  return t;
}

/** Aleatório que se repete (a mesma madeira em toda visita). */
function semente(n: number) {
  let s = n;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Veios finos de madeira num retângulo. */
function veios(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: () => number,
) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < w / 3; i++) {
    const vx = x + r() * w;
    g.strokeStyle = `rgba(${r() < 0.5 ? "60,30,15" : "255,220,180"},${0.06 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    g.moveTo(vx, y);
    g.bezierCurveTo(
      vx + (r() - 0.5) * 6,
      y + h * 0.33,
      vx + (r() - 0.5) * 6,
      y + h * 0.66,
      vx + (r() - 0.5) * 4,
      y + h,
    );
    g.stroke();
  }
  g.restore();
}

/**
 * O painel de madeira da divisória: réguas verticais estreitas, cada coluna
 * em blocos de comprimentos diferentes, tons de castanho variando — como o
 * rodapé alto da foto. A textura cobre 1 m de largura × 1 m de altura.
 */
export function madeiraDoPainel() {
  return criar("painel", 512, 512, (g) => {
    const r = semente(7);
    const tons = ["#8a4f2e", "#9a5a35", "#7d4528", "#a3633c", "#8f5431", "#6f3d22", "#b06e45"];
    const colunas = 10;
    const cw = 512 / colunas;
    for (let c = 0; c < colunas; c++) {
      let y = -r() * 200;
      while (y < 512) {
        const alto = 120 + r() * 260;
        const tom = tons[Math.floor(r() * tons.length)]!;
        g.fillStyle = tom;
        g.fillRect(c * cw, y, cw, alto);
        veios(g, c * cw, y, cw, alto, r);
        // a junta entre os blocos
        g.fillStyle = "rgba(40,20,10,0.55)";
        g.fillRect(c * cw, y + alto - 1.5, cw, 1.5);
        y += alto;
      }
      g.fillStyle = "rgba(40,20,10,0.45)";
      g.fillRect(c * cw + cw - 1.5, 0, 1.5, 512);
    }
    // verniz: um brilho leve de cima
    const brilho = g.createLinearGradient(0, 0, 0, 512);
    brilho.addColorStop(0, "rgba(255,255,255,0.05)");
    brilho.addColorStop(1, "rgba(0,0,0,0.06)");
    g.fillStyle = brilho;
    g.fillRect(0, 0, 512, 512);
  });
}

/** Tampo de mesa: madeira clara, veio no comprimento. Cobre 1,2 m × 0,6 m. */
export function madeiraDaMesa() {
  return criar("mesa", 512, 256, (g) => {
    const r = semente(31);
    g.fillStyle = "#b8865a";
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {
      const y = r() * 256;
      g.strokeStyle = `rgba(${r() < 0.6 ? "90,50,25" : "240,200,150"},${0.05 + r() * 0.09})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(170, y + (r() - 0.5) * 8, 340, y + (r() - 0.5) * 8, 512, y + (r() - 0.5) * 6);
      g.stroke();
    }
  });
}

/** Porcelanato cinza-claro, placas de 80 cm com rejunte fino. A textura cobre 1,6 m. */
export function porcelanato() {
  return criar("piso", 512, 512, (g) => {
    const r = semente(11);
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        const tom = 214 + Math.floor(r() * 8);
        g.fillStyle = `rgb(${tom},${tom},${tom - 3})`;
        g.fillRect(i * 256, j * 256, 256, 256);
        for (let k = 0; k < 160; k++) {
          g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "120,120,120"},${0.04 + r() * 0.05})`;
          g.fillRect(i * 256 + r() * 256, j * 256 + r() * 256, 2 + r() * 10, 1 + r() * 3);
        }
      }
    g.fillStyle = "rgba(150,150,145,0.9)";
    g.fillRect(0, 0, 512, 2);
    g.fillRect(0, 255, 512, 2);
    g.fillRect(0, 0, 2, 512);
    g.fillRect(255, 0, 2, 512);
  });
}

/**
 * O vidro da porta: listras horizontais foscas (brancas, quase opacas) e
 * faixas transparentes entre elas — o adesivo jateado da foto. A textura
 * cobre a folha inteira (0,9 × 2,1 m).
 */
export function vidroListrado() {
  return criar("vidro-listrado", 128, 512, (g) => {
    g.clearRect(0, 0, 128, 512);
    g.fillStyle = "rgba(220,235,245,0.10)";
    g.fillRect(0, 0, 128, 512);
    // a faixa fosca larga na altura dos olhos e listras finas em cima e embaixo
    const faixas: [number, number][] = [
      [150, 16],
      [178, 16],
      [206, 70],
      [288, 16],
      [316, 16],
    ];
    for (const [y, h] of faixas) {
      g.fillStyle = "rgba(245,248,250,0.78)";
      g.fillRect(0, y, 128, h);
    }
  });
}

/** Carpete do refeitório e da gerência: trama miúda. Cobre 1 m. */
export function carpete(cor: string) {
  return criar(`carpete-${cor}`, 128, 128, (g) => {
    const r = semente(5);
    g.fillStyle = cor;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},${0.04 + r() * 0.05})`;
      g.fillRect(r() * 128, r() * 128, 1.5, 1.5);
    }
  });
}

/**
 * Um plano de `w` × `h` metros com o UV esticado para a textura (que cobre
 * `lado` m) se repetir no tamanho certo. Mexer no UV — e não no `repeat` de
 * uma cópia da textura — deixa TODAS as paredes usando a mesma textura na
 * placa de vídeo.
 */
export function planoComUV(w: number, h: number, lado: number, ladoV = lado) {
  const p = new PlaneGeometry(w, h);
  const uv = p.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / lado), uv.getY(i) * (h / ladoV));
  uv.needsUpdate = true;
  return p;
}

/**
 * Letras brancas sobre transparente (o nome da empresa na parede da
 * recepção). Texto livre: cada texto tem a sua textura no cache.
 */
export function letreiroDaParede(texto: string) {
  return criar(`letreiro-${texto}`, 1024, 256, (g) => {
    g.clearRect(0, 0, 1024, 256);
    g.fillStyle = "#ffffff";
    g.font = "800 150px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = 12;
    g.fillText(texto, 512, 135);
  });
}

/** A plaquinha preta da porta com o nome da sala em branco (textura, sem <Html>). */
export function textoDePlaca(texto: string) {
  return criar(`placa-${texto}`, 512, 160, (g) => {
    g.fillStyle = "#1c1c1e";
    g.fillRect(0, 0, 512, 160);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    let tamanho = 64;
    const t = texto.toUpperCase();
    do {
      g.font = `700 ${tamanho}px Inter, system-ui, sans-serif`;
      tamanho -= 4;
    } while (g.measureText(t).width > 470 && tamanho > 24);
    g.fillText(t, 256, 84);
  });
}
