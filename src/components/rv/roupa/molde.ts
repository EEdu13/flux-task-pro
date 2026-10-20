import type { Matrix4 } from "three";
import type { Qualidade } from "@/components/rv/contexto-avatar";
import {
  FACES,
  bordaCurva,
  raioEfetivo,
  tamanhoDaFace,
  type Face,
  type RetUV,
} from "./caixa-roupa";

/**
 * O MOLDE (atlas) de uma peça: como o template 585×559 de Shirt/Pants do
 * Roblox, cada face de cada bloco ganha um retângulo numa única textura.
 * Aqui o molde é calculado (empacotamento em prateleiras) a partir das
 * medidas do corpo, então serve para os 4 tipos de corpo sem desenhar à mão.
 */

/** Um bloco vestido: tronco, manga, perna, cós, bolso, aba, anel de punho… */
export type ParteMolde = {
  nome: string;
  tam: [number, number, number];
  raio: number;
  /** Onde o bloco fica no avatar (origem no chão), já resolvido pela pose. */
  matriz: Matrix4;
  /** Faces que nunca aparecem (base do tronco, topo da perna): ganham só 4×4 px. */
  ocultas?: readonly Face[];
  /** Faces que nem viram triângulo (sempre enterradas noutra peça). */
  semFaces?: readonly Face[];
  /** Peças pares: −1 = lado direito do boneco (x<0), 1 = esquerdo. */
  lado?: 1 | -1;
  /** Repassado ao criarCaixaRoupa (saia, punho afunilado). */
  afunilar?: number;
  /**
   * Usa UM retângulo livre em todas as faces, em vez de faces próprias no
   * atlas: tiras finas (faixa refletiva, alça) que só mostram uma cor/padrão.
   */
  livre?: string;
  /** Segmentos da curva; sem isto, sai do raio (curva fina não precisa de 4). */
  segCurva?: number;
};

/** Um pedaço livre do atlas (capuz em toro, gola, gravata…), em metros. */
export type RetanguloLivre = { nome: string; w: number; h: number };

export type RetPx = { x: number; y: number; w: number; h: number };

export type FaceNoMolde = {
  px: RetPx;
  uv: RetUV;
  /** Tamanho desdobrado (m). */
  w: number;
  h: number;
  oculta: boolean;
};

export type Molde = {
  largura: number;
  altura: number;
  pxPorMetro: number;
  margem: number;
  partes: Record<string, { def: ParteMolde; faces: Record<Face, FaceNoMolde> }>;
  livres: Record<string, FaceNoMolde>;
};

type Item = { chave: string; w: number; h: number; wm: number; hm: number; oculta: boolean };

function empacotar(itens: Item[], largura: number, margem: number): Map<string, RetPx> | null {
  const ord = [...itens].sort((a, b) => b.h - a.h || b.w - a.w);
  const out = new Map<string, RetPx>();
  let x = 0;
  let y = 0;
  let alturaDaFila = 0;
  for (const it of ord) {
    const W = it.w + 2 * margem;
    const H = it.h + 2 * margem;
    if (W > largura) return null;
    if (x + W > largura) {
      x = 0;
      y += alturaDaFila;
      alturaDaFila = 0;
    }
    out.set(it.chave, { x: x + margem, y: y + margem, w: it.w, h: it.h });
    x += W;
    alturaDaFila = Math.max(alturaDaFila, H);
  }
  out.set("__altura", { x: 0, y: 0, w: 0, h: y + alturaDaFila });
  return out;
}

export type OpcoesMolde = {
  /** Densidade desejada: 512 no provador, 256 na sala. Cai sozinha se não couber em `maxLado`. */
  pxPorMetro: number;
  maxLado?: number;
  /** Sangria em volta de cada face (px), contra vazamento entre faces no mipmap. */
  margem?: number;
};

/**
 * Monta o molde: escolhe o MENOR atlas (largura 256…maxLado, altura em
 * múltiplos de 64) onde todas as faces cabem na densidade pedida.
 */
export function montarMolde(
  partes: readonly ParteMolde[],
  livres: readonly RetanguloLivre[],
  o: OpcoesMolde,
): Molde {
  const maxLado = o.maxLado ?? 2048;
  const margem = o.margem ?? 6;
  for (let px = o.pxPorMetro; px > 16; px *= 0.92) {
    const itens: Item[] = [];
    for (const p of partes) {
      if (p.livre) continue;
      for (const f of FACES) {
        const [wm, hm] = tamanhoDaFace(p.tam[0], p.tam[1], p.tam[2], p.raio, f);
        const oculta = !!(p.ocultas?.includes(f) || p.semFaces?.includes(f));
        itens.push({
          chave: `${p.nome}:${f}`,
          wm,
          hm,
          oculta,
          w: oculta ? 4 : Math.max(4, Math.ceil(wm * px)),
          h: oculta ? 4 : Math.max(4, Math.ceil(hm * px)),
        });
      }
    }
    for (const l of livres) {
      itens.push({
        chave: `livre:${l.nome}`,
        wm: l.w,
        hm: l.h,
        oculta: false,
        w: Math.max(4, Math.ceil(l.w * px)),
        h: Math.max(4, Math.ceil(l.h * px)),
      });
    }
    let melhor: { largura: number; altura: number; pos: Map<string, RetPx> } | null = null;
    for (let largura = 256; largura <= maxLado; largura *= 2) {
      const pos = empacotar(itens, largura, margem);
      if (!pos) continue;
      const altura = Math.max(64, Math.ceil(pos.get("__altura")!.h / 64) * 64);
      if (altura > maxLado || altura > largura * 2) continue;
      if (!melhor || largura * altura < melhor.largura * melhor.altura) {
        melhor = { largura, altura, pos };
      }
    }
    if (!melhor) continue;
    const { largura, altura, pos } = melhor;
    const porChave = new Map(itens.map((i) => [i.chave, i]));

    const naFace = (chave: string): FaceNoMolde => {
      const it = porChave.get(chave)!;
      const r = pos.get(chave)!;
      const topo = r.y / altura;
      const base = (r.y + r.h) / altura;
      return {
        px: r,
        w: it.wm,
        h: it.hm,
        oculta: it.oculta,
        // Canvas: y para baixo. A CanvasTexture (flipY) faz o three ler v para cima.
        uv: { u0: r.x / largura, u1: (r.x + r.w) / largura, v0: 1 - base, v1: 1 - topo },
      };
    };
    const molde: Molde = { largura, altura, pxPorMetro: px, margem, partes: {}, livres: {} };
    for (const p of partes) {
      if (p.livre) continue;
      const faces = {} as Record<Face, FaceNoMolde>;
      for (const f of FACES) faces[f] = naFace(`${p.nome}:${f}`);
      molde.partes[p.nome] = { def: p, faces };
    }
    for (const l of livres) molde.livres[l.nome] = naFace(`livre:${l.nome}`);
    return molde;
  }
  throw new Error("molde: as partes não cabem no atlas");
}

/** O que o pintor recebe para desenhar UMA face (unidades em metros, y para baixo). */
export type CtxFace = {
  g: CanvasRenderingContext2D;
  parte: string;
  face: Face;
  /** Tamanho desdobrado da face (m). */
  w: number;
  h: number;
  /** Largura da meia curva em cada borda (m): o essencial fica dentro de [borda, w−borda]. */
  borda: number;
  /** Pixels por metro (espessuras mínimas e o grão do tecido). */
  px: number;
  /** Onde esta face começa na volta do bloco (frente→+x→costas→−x): padrão contínuo. */
  faixa: number;
  lado: 1 | -1;
  /** Para um retângulo livre, o nome dele (e parte = "livre"). */
  livre?: string;
  /** "media" (a sala): sem pesponto nem micro-padrão, linhas de pelo menos 2 px. */
  qualidade: Qualidade;
  /** true quando pinta a máscara das faixas refletivas (preto = nada, branco = brilha). */
  mascara: boolean;
};

export type Pintor = (f: CtxFace) => void;

export type OpcoesPintura = {
  qualidade: Qualidade;
  /** 1 = o atlas; 0,25 = a máscara pequena do brilho (mesmo UV, menos pixels). */
  escala?: number;
  mascara?: boolean;
};

/** Pinta o molde inteiro num canvas: cada face com recorte + margem de sangria. */
export function pintarMolde(molde: Molde, pintar: Pintor, o: OpcoesPintura): HTMLCanvasElement {
  const k = o.escala ?? 1;
  const c = document.createElement("canvas");
  c.width = Math.max(4, Math.round(molde.largura * k));
  c.height = Math.max(4, Math.round(molde.altura * k));
  const g = c.getContext("2d")!;
  if (o.mascara) {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, c.width, c.height);
  }
  const um = (
    F: FaceNoMolde,
    ctx: Omit<CtxFace, "g" | "w" | "h" | "px" | "qualidade" | "mascara">,
  ) => {
    const r = F.px;
    g.save();
    g.beginPath();
    const mg = molde.margem;
    g.rect((r.x - mg) * k, (r.y - mg) * k, (r.w + 2 * mg) * k, (r.h + 2 * mg) * k);
    g.clip();
    // O clip NÃO limpa o caminho: sem este beginPath, um fill() sem caminho
    // novo pintaria a face inteira (era o painel escuro do EPI).
    g.beginPath();
    // 1 unidade = 1 metro; origem no canto superior esquerdo da face (sem a margem).
    g.setTransform((r.w * k) / F.w, 0, 0, (r.h * k) / F.h, r.x * k, r.y * k);
    g.lineCap = "round";
    g.lineJoin = "round";
    pintar({
      ...ctx,
      g,
      w: F.w,
      h: F.h,
      px: (r.w * k) / F.w,
      qualidade: o.qualidade,
      mascara: !!o.mascara,
    });
    g.restore();
  };
  for (const [nome, P] of Object.entries(molde.partes)) {
    const [w, h, d] = P.def.tam;
    const borda = bordaCurva(raioEfetivo(w, h, d, P.def.raio));
    const larg = (f: Face) => P.faces[f].w;
    const faixa: Record<Face, number> = {
      pz: 0,
      px: larg("pz"),
      nz: larg("pz") + larg("px"),
      nx: larg("pz") + larg("px") + larg("nz"),
      py: 0,
      ny: 0,
    };
    for (const f of FACES) {
      const F = P.faces[f];
      // Face oculta: só 4×4 px, pintados depois com o próprio tecido (abaixo).
      if (F.oculta) continue;
      um(F, { parte: nome, face: f, borda, faixa: faixa[f], lado: P.def.lado ?? 1 });
    }
  }
  for (const [nome, F] of Object.entries(molde.livres)) {
    um(F, { parte: "livre", livre: nome, face: "pz", borda: 0, faixa: 0, lado: 1 });
  }
  if (!o.mascara) {
    pintarOcultas(c, molde, k);
    dilatarBordas(c, molde, k);
  }
  return c;
}

/** Quanto a face oculta escurece em relação ao tecido da própria parte. */
const SOMBRA_OCULTA = 0.32;

/**
 * Faces "ocultas" (4×4 px) ganham a cor MÉDIA do tecido da própria parte,
 * escurecida: o topo de um anel de punho/barra (6 mm mais largo que o
 * membro) e a boca da perna aparecem nas quinas e sentado — com o quadrado
 * #26262a fixo viravam triângulos pretos. A cor vem do atlas já pintado
 * (drawImage reduzido de uma face visível), então serve para qualquer tecido.
 */
function pintarOcultas(c: HTMLCanvasElement, molde: Molde, k: number): void {
  const g = c.getContext("2d")!;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  const M = molde.margem * k;
  for (const P of Object.values(molde.partes)) {
    const fonte = (["px", "pz", "nx", "nz", "py", "ny"] as const)
      .map((f) => P.faces[f])
      .find((F) => !F.oculta);
    for (const f of FACES) {
      const F = P.faces[f];
      // Sem triângulo (semFaces) não precisa de cor.
      if (!F.oculta || P.def.semFaces?.includes(f)) continue;
      const x = F.px.x * k - M;
      const y = F.px.y * k - M;
      const w = F.px.w * k + 2 * M;
      const h = F.px.h * k + 2 * M;
      if (fonte) {
        // o miolo da face visível (longe das bordas, que têm contorno escuro)
        const s = fonte.px;
        g.drawImage(
          c,
          (s.x + s.w * 0.2) * k,
          (s.y + s.h * 0.25) * k,
          s.w * 0.6 * k,
          s.h * 0.5 * k,
          x,
          y,
          w,
          h,
        );
        g.fillStyle = `rgba(0,0,0,${SOMBRA_OCULTA})`;
      } else {
        g.fillStyle = "#26262a";
      }
      g.fillRect(x, y, w, h);
    }
  }
  g.restore();
}

/**
 * Repete o pixel da borda de cada face até preencher a margem de sangria.
 * Sem isto, o mipmap de longe (a sala) puxa a cor da margem, que pode ter
 * um traço cortado ao meio, e aparecem riscas claras nas quinas.
 */
export function dilatarBordas(c: HTMLCanvasElement, molde: Molde, k = 1): void {
  const g = c.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  const M = Math.max(1, Math.round(molde.margem * k));
  const faces: FaceNoMolde[] = [];
  for (const P of Object.values(molde.partes)) {
    for (const f of FACES) if (!P.faces[f].oculta) faces.push(P.faces[f]);
  }
  faces.push(...Object.values(molde.livres));
  for (const F of faces) {
    const x = Math.round(F.px.x * k);
    const y = Math.round(F.px.y * k);
    const w = Math.max(1, Math.round(F.px.w * k));
    const h = Math.max(1, Math.round(F.px.h * k));
    g.drawImage(c, x, y, w, 1, x, y - M, w, M);
    g.drawImage(c, x, y + h - 1, w, 1, x, y + h, w, M);
    g.drawImage(c, x, y - M, 1, h + 2 * M, x - M, y - M, M, h + 2 * M);
    g.drawImage(c, x + w - 1, y - M, 1, h + 2 * M, x + w, y - M, M, h + 2 * M);
  }
}
