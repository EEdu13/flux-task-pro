import type { CtxFace } from "./molde";

/**
 * Estampas novas do peito (16/10/2026: "crie pelo menos mais 10, bem criativo,
 * baseado em Roblox"). Desenho VETORIAL direto na face da peça (nada de
 * textura intermediária): sai nítido na alta (512 px/m) e na sala (256 px/m).
 *
 * Regras para ler pequeno (a estampa tem ~19 cm, ~50 px na sala):
 * formas grandes, contorno escuro grosso (lê em qualquer cor de roupa) e no
 * máximo 3–4 cores. Cada uma desenha num quadrado de 256 unidades.
 */

/** Os valores novos que este arquivo sabe desenhar (o catálogo fica em `avatar-catalogo/cima.ts`). */
export const ESTAMPAS_NOVAS = [
  "larsil",
  "pinheiro",
  "eucalipto",
  "folha",
  "trator",
  "sol",
  "raioNeon",
  "caveira",
  "controle",
  "pizza",
  "derretendo",
  "onda",
  "planeta",
  "agro",
  "sgl",
] as const;
export type EstampaNova = (typeof ESTAMPAS_NOVAS)[number];

const NOVAS: ReadonlySet<string> = new Set(ESTAMPAS_NOVAS);

/** Contorno das figuras: quase preto, igual em todas (o "traço" de adesivo do Roblox). */
const TRACO = "#1b1b22";

type G = CanvasRenderingContext2D;

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Caminho fechado de pontos. */
function pol(g: G, pts: readonly (readonly [number, number])[]) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

/** Preenche e contorna o caminho atual (contorno POR FORA: traço antes do fill). */
function adesivo(g: G, cor: string, traco = 14) {
  g.strokeStyle = TRACO;
  g.lineWidth = traco;
  g.stroke();
  g.fillStyle = cor;
  g.fill();
}

function circulo(g: G, x: number, y: number, r: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

/** Texto em bloco com contorno grosso (AGRO, SGL). */
function letreiro(g: G, texto: string, y: number, tam: number, cor: string, traco: string) {
  g.font = `900 ${tam}px "Arial Black", Impact, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // aperta o texto para caber em 236 unidades
  const larg = g.measureText(texto).width;
  const k = Math.min(1, 236 / Math.max(1, larg));
  g.save();
  g.translate(128, y);
  g.scale(k, 1);
  g.lineJoin = "round";
  g.strokeStyle = traco;
  g.lineWidth = tam * 0.2;
  g.strokeText(texto, 0, 0);
  g.fillStyle = cor;
  g.fillText(texto, 0, 0);
  g.restore();
}

/* ———————————————————— as figuras (quadrado de 256) ———————————————————— */

function larsil(g: G) {
  // selo redondo verde com a árvore branca (copa de três bolas) e o chão
  circulo(g, 128, 128, 112);
  adesivo(g, "#15803d", 12);
  g.strokeStyle = "#bbf7d0";
  g.lineWidth = 7;
  circulo(g, 128, 128, 94);
  g.stroke();
  g.fillStyle = "#f8fafc";
  // tronco
  pol(g, [
    [116, 200],
    [140, 200],
    [134, 140],
    [122, 140],
  ]);
  g.fill();
  for (const [x, y, r] of [
    [128, 82, 36],
    [96, 112, 30],
    [160, 112, 30],
    [128, 122, 30],
  ] as const) {
    circulo(g, x, y, r);
    g.fill();
  }
  // galhinhos verdes por dentro da copa
  g.strokeStyle = "#15803d";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(128, 150);
  g.lineTo(128, 96);
  g.moveTo(128, 124);
  g.lineTo(104, 108);
  g.moveTo(128, 116);
  g.lineTo(152, 102);
  g.stroke();
  // o chão
  g.fillStyle = "#f8fafc";
  g.beginPath();
  g.roundRect(70, 198, 116, 12, 6);
  g.fill();
}

function pinheiro(g: G) {
  // três andares de copa com neve na ponta, tronco marrom
  pol(g, [
    [114, 206],
    [142, 206],
    [142, 244],
    [114, 244],
  ]);
  adesivo(g, "#7c4a26", 12);
  const andares: [number, number, number][] = [
    [128, 150, 112],
    [128, 96, 84],
    [128, 46, 58],
  ];
  for (const [x, topo, meia] of andares) {
    const h = meia * 1.05;
    pol(g, [
      [x, topo - 34],
      [x + meia, topo + h - 30],
      [x - meia, topo + h - 30],
    ]);
    adesivo(g, "#166534", 12);
  }
  // neve no topo e nas bordas
  g.fillStyle = "#f8fafc";
  pol(g, [
    [128, 12],
    [146, 38],
    [136, 34],
    [128, 42],
    [120, 34],
    [110, 38],
  ]);
  g.fill();
  g.fillStyle = "#4ade80";
  for (const [x, y] of [
    [104, 100],
    [150, 150],
    [96, 196],
    [168, 214],
  ] as const) {
    circulo(g, x, y, 6);
    g.fill();
  }
}

function eucalipto(g: G) {
  // tronco alto e liso com manchas de casca, folhas compridas azuladas
  g.save();
  g.lineCap = "round";
  g.strokeStyle = TRACO;
  g.lineWidth = 36;
  g.beginPath();
  g.moveTo(128, 246);
  g.quadraticCurveTo(122, 160, 132, 70);
  g.stroke();
  g.strokeStyle = "#e7dcc8";
  g.lineWidth = 22;
  g.stroke();
  g.strokeStyle = "#b9a17f";
  g.lineWidth = 8;
  for (const y of [210, 170, 128]) {
    g.beginPath();
    g.moveTo(122, y);
    g.lineTo(130, y - 14);
    g.stroke();
  }
  // galhos
  g.strokeStyle = TRACO;
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(128, 120);
  g.lineTo(84, 84);
  g.moveTo(130, 100);
  g.lineTo(176, 70);
  g.stroke();
  g.restore();
  // folhas em lança, penduradas
  const folha = (x: number, y: number, a: number, cor: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(14, 28, 0, 62);
    g.quadraticCurveTo(-14, 28, 0, 0);
    g.closePath();
    adesivo(g, cor, 8);
    g.restore();
  };
  const cores = ["#5f9e8f", "#7fb8a4", "#4d8577"];
  let i = 0;
  for (const [x, y] of [
    [84, 84],
    [176, 70],
    [132, 64],
  ] as const) {
    for (const a of [-1.1, -0.5, 0.1, 0.7, 1.3]) folha(x, y, a, cores[i++ % 3]!);
  }
}

function folha(g: G) {
  g.save();
  g.translate(128, 132);
  g.rotate(-0.6);
  g.beginPath();
  g.moveTo(0, -112);
  g.bezierCurveTo(82, -70, 74, 60, 0, 104);
  g.bezierCurveTo(-74, 60, -82, -70, 0, -112);
  g.closePath();
  adesivo(g, "#22c55e", 14);
  // metade de sombra (folha dobrada na nervura)
  g.save();
  g.clip();
  g.fillStyle = "#16a34a";
  g.fillRect(0, -120, 100, 240);
  g.restore();
  g.strokeStyle = "#dcfce7";
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, -90);
  g.lineTo(0, 120);
  for (const y of [-50, -10, 30, 66]) {
    g.moveTo(0, y + 18);
    g.lineTo(-40 + Math.abs(y) * 0.1, y - 10);
    g.moveTo(0, y + 18);
    g.lineTo(40 - Math.abs(y) * 0.1, y - 10);
  }
  g.stroke();
  g.restore();
}

function trator(g: G) {
  // de lado: cabine, capô, roda traseira grande, dianteira pequena, escapamento
  g.lineJoin = "round";
  // escapamento
  pol(g, [
    [150, 56],
    [162, 56],
    [162, 120],
    [150, 120],
  ]);
  adesivo(g, "#374151", 10);
  // capô
  pol(g, [
    [120, 116],
    [232, 116],
    [238, 176],
    [120, 176],
  ]);
  adesivo(g, "#16a34a", 12);
  // cabine
  pol(g, [
    [30, 50],
    [118, 50],
    [124, 176],
    [24, 176],
  ]);
  adesivo(g, "#16a34a", 12);
  // vidro
  g.fillStyle = "#bae6fd";
  pol(g, [
    [44, 64],
    [104, 64],
    [108, 120],
    [40, 120],
  ]);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.7)";
  pol(g, [
    [52, 70],
    [66, 70],
    [52, 110],
  ]);
  g.fill();
  // grade do capô (amarela)
  g.fillStyle = "#facc15";
  g.fillRect(212, 126, 18, 40);
  // rodas
  const roda = (x: number, y: number, r: number) => {
    circulo(g, x, y, r);
    adesivo(g, "#1f2937", 12);
    circulo(g, x, y, r * 0.5);
    g.fillStyle = "#facc15";
    g.fill();
    g.strokeStyle = TRACO;
    g.lineWidth = 6;
    g.stroke();
    // cravos do pneu
    g.fillStyle = "#4b5563";
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      g.save();
      g.translate(x + Math.cos(a) * r * 0.82, y + Math.sin(a) * r * 0.82);
      g.rotate(a);
      g.fillRect(-4, -8, 8, 16);
      g.restore();
    }
  };
  roda(70, 186, 60);
  roda(200, 204, 38);
}

function sol(g: G) {
  // pôr do sol retrô (synthwave): disco com faixas, sobre o horizonte
  g.save();
  circulo(g, 128, 128, 108);
  g.strokeStyle = TRACO;
  g.lineWidth = 14;
  g.stroke();
  g.clip();
  const gr = g.createLinearGradient(0, 20, 0, 236);
  gr.addColorStop(0, "#fde047");
  gr.addColorStop(0.5, "#fb923c");
  gr.addColorStop(1, "#db2777");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  // as faixas cortadas (cada vez mais grossas para baixo)
  g.fillStyle = "#3b0764";
  let y = 132;
  for (let i = 0; i < 6; i++) {
    const h = 6 + i * 3.5;
    g.fillRect(0, y, 256, h);
    y += h + 14 - i;
  }
  g.restore();
}

function raioNeon(g: G) {
  const pts: [number, number][] = [
    [150, 14],
    [64, 142],
    [118, 142],
    [96, 244],
    [196, 102],
    [140, 102],
    [176, 14],
  ];
  g.lineJoin = "round";
  // halo neon: traços largos translúcidos, depois o tubo
  for (const [w, a] of [
    [44, 0.18],
    [30, 0.3],
    [20, 0.55],
  ] as const) {
    pol(g, pts);
    g.strokeStyle = `rgba(232,121,249,${a})`;
    g.lineWidth = w;
    g.stroke();
  }
  pol(g, pts);
  g.fillStyle = "#1e1b4b";
  g.fill();
  g.strokeStyle = "#f0abfc";
  g.lineWidth = 12;
  g.stroke();
  pol(g, pts);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 4;
  g.stroke();
  // faísca ciano
  g.strokeStyle = "#67e8f9";
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath();
  for (const [x0, y0, x1, y1] of [
    [204, 40, 230, 22],
    [212, 70, 244, 66],
    [40, 196, 18, 214],
  ] as const) {
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  g.stroke();
}

function caveira(g: G) {
  // caveirinha fofa: crânio redondo, olhos grandes com brilho, lacinho rosa
  g.beginPath();
  g.ellipse(128, 112, 92, 84, 0, 0, Math.PI * 2);
  g.roundRect(78, 150, 100, 66, 22);
  adesivo(g, "#f8fafc", 14);
  g.fillStyle = "#f8fafc";
  g.beginPath();
  g.ellipse(128, 112, 92, 84, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = TRACO;
  for (const x of [92, 164]) {
    g.beginPath();
    g.ellipse(x, 116, 26, 30, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ffffff";
  for (const x of [84, 156]) {
    circulo(g, x, 106, 9);
    g.fill();
  }
  // nariz de coração
  g.fillStyle = TRACO;
  g.beginPath();
  g.moveTo(128, 168);
  g.lineTo(116, 152);
  g.arc(122, 150, 7, Math.PI, 0);
  g.arc(134, 150, 7, Math.PI, 0);
  g.closePath();
  g.fill();
  // dentes
  g.strokeStyle = TRACO;
  g.lineWidth = 7;
  g.beginPath();
  for (const x of [106, 128, 150]) {
    g.moveTo(x, 186);
    g.lineTo(x, 210);
  }
  g.stroke();
  // laço
  g.save();
  g.translate(190, 46);
  g.rotate(0.35);
  for (const s of [-1, 1]) {
    pol(g, [
      [0, 0],
      [s * 40, -24],
      [s * 40, 24],
    ]);
    adesivo(g, "#ec4899", 10);
  }
  circulo(g, 0, 0, 11);
  adesivo(g, "#f472b6", 8);
  g.restore();
}

function controle(g: G) {
  // gamepad: corpo arredondado com as duas pegas
  g.beginPath();
  g.moveTo(52, 80);
  g.lineTo(204, 80);
  g.bezierCurveTo(250, 80, 256, 206, 222, 206);
  g.bezierCurveTo(196, 206, 186, 170, 160, 170);
  g.lineTo(96, 170);
  g.bezierCurveTo(70, 170, 60, 206, 34, 206);
  g.bezierCurveTo(0, 206, 6, 80, 52, 80);
  g.closePath();
  adesivo(g, "#4c1d95", 14);
  // brilho
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.beginPath();
  g.roundRect(40, 92, 176, 16, 8);
  g.fill();
  // direcional
  g.fillStyle = "#f8fafc";
  g.fillRect(48, 124, 48, 16);
  g.fillRect(64, 108, 16, 48);
  // botões
  for (const [x, y, c] of [
    [186, 110, "#facc15"],
    [208, 132, "#ef4444"],
    [164, 132, "#3b82f6"],
    [186, 154, "#22c55e"],
  ] as const) {
    circulo(g, x, y, 11);
    adesivo(g, c, 5);
  }
  g.fillStyle = "#c4b5fd";
  g.beginPath();
  g.roundRect(110, 122, 14, 8, 4);
  g.roundRect(132, 122, 14, 8, 4);
  g.fill();
}

function pizza(g: G) {
  // fatia de ponta para baixo, borda de massa em cima, queijo pingando dos lados
  const fatia: [number, number][] = [
    [28, 52],
    [228, 52],
    [128, 246],
  ];
  // os pingos ficam ATRÁS da fatia: só a ponta que sai da borda aparece
  for (const [x, y, comp] of [
    [56, 104, 70],
    [188, 132, 54],
  ] as const) {
    g.beginPath();
    g.moveTo(x - 13, y);
    g.lineTo(x - 13, y + comp);
    g.arc(x, y + comp, 13, Math.PI, 0, true);
    g.lineTo(x + 13, y);
    g.closePath();
    adesivo(g, "#fde68a", 12);
  }
  pol(g, fatia);
  adesivo(g, "#fbbf24", 14);
  g.save();
  pol(g, fatia);
  g.clip();
  g.fillStyle = "#fde68a";
  g.beginPath();
  g.moveTo(44, 60);
  g.lineTo(212, 60);
  g.lineTo(128, 226);
  g.closePath();
  g.fill();
  g.restore();
  // borda
  g.beginPath();
  g.roundRect(18, 30, 220, 34, 17);
  adesivo(g, "#b45309", 12);
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.fillRect(34, 38, 188, 6);
  // pepperoni
  for (const [x, y, r] of [
    [94, 96, 20],
    [160, 92, 18],
    [126, 150, 17],
    [120, 204, 11],
  ] as const) {
    circulo(g, x, y, r);
    adesivo(g, "#dc2626", 6);
    g.fillStyle = "#991b1b";
    circulo(g, x - r * 0.3, y + r * 0.2, r * 0.22);
    g.fill();
  }
}

function derretendo(g: G) {
  // smile derretendo: o rosto vira poça na metade de baixo e pinga
  g.beginPath();
  g.arc(128, 116, 92, Math.PI, 0);
  g.lineTo(220, 152);
  for (const [x, comp] of [
    [192, 62],
    [148, 34],
    [106, 80],
    [62, 46],
  ] as const) {
    g.lineTo(x + 14, 152);
    g.lineTo(x + 14, 152 + comp);
    g.arc(x, 152 + comp, 14, 0, Math.PI);
    g.lineTo(x - 14, 152);
  }
  g.lineTo(36, 152);
  g.closePath();
  adesivo(g, "#facc15", 14);
  // olhos em X e boca torta
  g.strokeStyle = TRACO;
  g.lineWidth = 12;
  g.lineCap = "round";
  g.beginPath();
  for (const cx of [92, 164]) {
    g.moveTo(cx - 14, 76);
    g.lineTo(cx + 14, 104);
    g.moveTo(cx + 14, 76);
    g.lineTo(cx - 14, 104);
  }
  g.moveTo(84, 138);
  g.quadraticCurveTo(128, 164, 176, 130);
  g.stroke();
  g.fillStyle = "#fef08a";
  g.beginPath();
  g.ellipse(84, 52, 18, 9, -0.5, 0, Math.PI * 2);
  g.fill();
}

function onda(g: G) {
  // a grande onda num círculo: céu claro, onda azul com espuma em garras
  circulo(g, 128, 128, 112);
  g.strokeStyle = TRACO;
  g.lineWidth = 14;
  g.stroke();
  g.save();
  g.clip();
  g.fillStyle = "#fef3c7";
  g.fillRect(0, 0, 256, 256);
  // sol
  g.fillStyle = "#f87171";
  circulo(g, 186, 66, 22);
  g.fill();
  // corpo da onda
  g.beginPath();
  g.moveTo(-10, 256);
  g.lineTo(-10, 150);
  g.bezierCurveTo(20, 60, 140, 30, 176, 100);
  g.bezierCurveTo(150, 80, 118, 96, 128, 130);
  g.bezierCurveTo(140, 168, 200, 160, 266, 176);
  g.lineTo(266, 256);
  g.closePath();
  g.fillStyle = "#1d4ed8";
  g.fill();
  g.strokeStyle = TRACO;
  g.lineWidth = 8;
  g.stroke();
  // faixa clara dentro da onda
  g.strokeStyle = "#60a5fa";
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(10, 220);
  g.bezierCurveTo(30, 120, 110, 80, 150, 100);
  g.stroke();
  // espuma em garras na crista
  g.fillStyle = "#f8fafc";
  for (const [x, y] of [
    [176, 100],
    [160, 88],
    [140, 84],
  ] as const) {
    circulo(g, x, y, 10);
    g.fill();
  }
  g.strokeStyle = "#f8fafc";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(0, 214);
  g.quadraticCurveTo(128, 196, 256, 220);
  g.stroke();
  g.restore();
}

function planeta(g: G) {
  // estrelinhas
  g.fillStyle = "#fde047";
  for (const [x, y, r] of [
    [30, 40, 7],
    [222, 210, 8],
    [214, 36, 5],
    [40, 214, 5],
  ] as const) {
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rr = k % 2 ? r * 0.4 : r * 1.6;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  }
  // anel de trás
  g.save();
  g.translate(128, 132);
  g.rotate(-0.35);
  g.strokeStyle = TRACO;
  g.lineWidth = 26;
  g.beginPath();
  g.ellipse(0, 0, 120, 34, 0, Math.PI, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#f472b6";
  g.lineWidth = 14;
  g.stroke();
  g.restore();
  // o planeta
  circulo(g, 128, 132, 70);
  adesivo(g, "#8b5cf6", 14);
  g.save();
  circulo(g, 128, 132, 70);
  g.clip();
  g.fillStyle = "#a78bfa";
  g.fillRect(40, 100, 180, 18);
  g.fillStyle = "#6d28d9";
  g.fillRect(40, 146, 180, 14);
  g.fillStyle = "rgba(255,255,255,0.3)";
  circulo(g, 100, 104, 18);
  g.fill();
  g.restore();
  // anel da frente
  g.save();
  g.translate(128, 132);
  g.rotate(-0.35);
  g.strokeStyle = TRACO;
  g.lineWidth = 26;
  g.beginPath();
  g.ellipse(0, 0, 120, 34, 0, 0, Math.PI);
  g.stroke();
  g.strokeStyle = "#f472b6";
  g.lineWidth = 14;
  g.stroke();
  g.restore();
}

function agro(g: G, contraste: string, fundo: string) {
  // AGRO em bloco + ramo de trigo em cima
  const espiga = (x: number, a: number) => {
    g.save();
    g.translate(x, 92);
    g.rotate(a);
    g.strokeStyle = TRACO;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -70);
    g.stroke();
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        g.save();
        g.translate(0, -18 - k * 14);
        g.rotate(s * 0.5);
        g.beginPath();
        g.ellipse(s * 8, 0, 9, 5, 0, 0, Math.PI * 2);
        adesivo(g, "#eab308", 4);
        g.restore();
      }
    }
    g.restore();
  };
  espiga(100, -0.3);
  espiga(128, 0);
  espiga(156, 0.3);
  letreiro(g, "AGRO", 160, 96, contraste, fundo);
  g.fillStyle = contraste;
  g.beginPath();
  g.roundRect(40, 212, 176, 10, 5);
  g.fill();
}

function sgl(g: G) {
  // selo arredondado azul com SGL branco e uma folha verde
  g.beginPath();
  g.roundRect(14, 56, 228, 144, 40);
  adesivo(g, "#1d4ed8", 14);
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.roundRect(28, 68, 200, 24, 12);
  g.fill();
  letreiro(g, "SGL", 132, 104, "#f8fafc", "#0b1f5c");
  g.save();
  g.translate(214, 66);
  g.rotate(0.6);
  g.beginPath();
  g.moveTo(0, -30);
  g.quadraticCurveTo(26, 0, 0, 30);
  g.quadraticCurveTo(-26, 0, 0, -30);
  adesivo(g, "#22c55e", 8);
  g.restore();
}

/**
 * Desenha uma estampa NOVA centrada em (cx, cy), num quadrado de `lado` m.
 * Devolve `false` quando o valor não é deste arquivo (aí `estampas.ts` segue).
 */
export function desenharEstampaNova(
  f: CtxFace,
  e: string,
  corDaRoupa: string,
  cx: number,
  cy: number,
  lado: number,
): boolean {
  if (!NOVAS.has(e)) return false;
  const { g } = f;
  const clara = lum(corDaRoupa) > 0.6;
  const contraste = clara ? "#1f2937" : "#f8fafc";
  const fundo = clara ? "#f8fafc" : "#111827";
  g.save();
  g.translate(cx - lado / 2, cy - lado / 2);
  g.scale(lado / 256, lado / 256);
  g.lineCap = "round";
  g.lineJoin = "round";
  // tinta de silk: leve transparência para o pano "aparecer" por baixo
  g.globalAlpha = 0.96;
  switch (e as EstampaNova) {
    case "larsil":
      larsil(g);
      break;
    case "pinheiro":
      pinheiro(g);
      break;
    case "eucalipto":
      eucalipto(g);
      break;
    case "folha":
      folha(g);
      break;
    case "trator":
      trator(g);
      break;
    case "sol":
      sol(g);
      break;
    case "raioNeon":
      raioNeon(g);
      break;
    case "caveira":
      caveira(g);
      break;
    case "controle":
      controle(g);
      break;
    case "pizza":
      pizza(g);
      break;
    case "derretendo":
      derretendo(g);
      break;
    case "onda":
      onda(g);
      break;
    case "planeta":
      planeta(g);
      break;
    case "agro":
      agro(g, contraste, fundo);
      break;
    case "sgl":
      sgl(g);
      break;
  }
  g.restore();
  return true;
}
