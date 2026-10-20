import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import type { Medidas } from "@/components/rv/medidas";
import type { PoseAvatar, Qualidade } from "@/components/rv/contexto-avatar";
import {
  CabecaSDF,
  Campo,
  CorpoCabelo,
  Malha,
  clamp01,
  construirCasca,
  lerp,
  sstep,
  type CtxCabelo,
  type MascaraCasca,
  type Obra,
  type TipoAba,
} from "@/components/rv/cabelo-casca";
import { baixoDaAba } from "@/components/rv/cabelo-chapeu";
import { crescerCamada, testaPadrao } from "@/components/rv/cabelo-guia";
import { amostrar, fita, tufo } from "@/components/rv/cabelo-fita";
import { ESTILOS, type EstiloCabelo } from "@/components/rv/cabelo-estilos";
import { semente } from "@/components/rv/cabelo-rng";
import { V_INICIO } from "@/components/rv/cabelo-texturas";

/*
 * Monta a geometria do cabelo (uma BufferGeometry por penteado × corpo ×
 * pose × qualidade × chapéu × modo de mechas — SEM cor: a cor é uniform do
 * material) e guarda num cache com contagem de referências: 10 avatares de
 * cabelo igual na sala dividem a mesma malha, e trocar a cor não regenera.
 */

/**
 * Véu de sombra da franja (só na alta): a borda de baixo REAL da franja,
 * medida na geometria, coluna a coluna (x crescente). O véu fica colado
 * nela — nunca uma faixa reta solta no meio da testa.
 */
export type VeuFranja = { xs: number[]; ys: number[] };
export type GeoCabelo = {
  geometria: BufferGeometry;
  usaCachos: boolean;
  usaBrilho: boolean;
  triangulos: number;
  veu: VeuFranja | null;
  /**
   * Enfeites coloridos (elástico das tranças, flor): uma malha por cor. `cor` "" = a cor de
   * destaque da roupa; "cor1|cor2" = cores fixas.
   */
  enfeites?: { geometria: BufferGeometry; cor: string }[];
  /** Tempo de geração (ms), para a bancada. */
  ms: number;
};

/** Chapéus que cobrem o alto e onde cortam o cabelo (valor·t/0,46 abaixo do topo). */
type ChapeuNovo = "chapeuPescador" | "bandana" | "faixa" | "presilhas";
export type TipoChapeu = AvatarConfig["chapeu"] | ChapeuNovo;
export const CORTE_DO_CHAPEU: Partial<Record<TipoChapeu, number>> = {
  bone: 0.06,
  boneTras: 0.06,
  gorro: 0.085,
  chapeuPescador: 0.07,
  chapeu: 0.04,
  capacete: 0.04,
  cartola: 0.04,
  // os chapéus novos que cobrem o alto (16/10/2026; o bucket já estava acima)
  chapeuPalha: 0.04,
  chapeuCowboy: 0.04,
  sombrero: 0.04,
  boneTrucker: 0.06,
  capaceteFlorestal: 0.085,
  gorroPompom: 0.09,
  bandana: 0.075,
  boina: 0.05,
  chapeuChef: 0.06,
  boneHelice: 0.06,
};

const COM_CAPUZ = new Set<string>(["moletom", "moletomZiper"]);
const NA_FRENTE = new Set<string>(["mochila", "cracha", "colar"]);
/**
 * Os chapéus justos novos (16/10/2026): o cabelo que renasce no corte sai deitado por baixo
 * da borda (aba "rente"), sem espetar para fora acima dela.
 */
const RENTES = new Set<string>([
  "boneTrucker",
  "capaceteFlorestal",
  "gorroPompom",
  "bandana",
  "boina",
  "chapeuChef",
  "boneHelice",
]);
/** Chapéus de aba larga em volta do corte: o cabelo que sai por baixo fica sob a aba. */
const COM_ABA = new Set<string>([
  "chapeu",
  "cartola",
  "capacete",
  // (16/10/2026) as abas novas: ver `ABAS_NOVAS`
  "chapeuPalha",
  "chapeuCowboy",
  "sombrero",
  "chapeuPescador",
]);

/** O contexto da malha a partir da config (com config null: sentado, sem capuz nem acessórios). */
export function ctxDoCabelo(
  cfg: AvatarConfig | null,
  m: Medidas,
  pose: PoseAvatar,
  qualidade: Qualidade,
): CtxCabelo {
  const t = m.cabeca;
  const topoTroncoY = -(0.03 + t / 2);
  const corte = cfg ? CORTE_DO_CHAPEU[cfg.chapeu as TipoChapeu] : undefined;
  // Encosto da cadeira da sala (sala-3d.tsx: caixa em z −0,27, y 0,85, giro −0,12):
  // face da frente z ≈ −0,24 − 0,12·(y − 0,85) em coordenadas do mundo.
  const cabecaYMundo = 0.52 + m.troncoH + 0.03 + t / 2;
  return {
    t,
    d: t * 0.92,
    troncoW: m.troncoW,
    troncoD: m.troncoD,
    bracoW: m.bracoW,
    troncoH: m.troncoH,
    topoTroncoY,
    ombroY: topoTroncoY - 0.06,
    corteChapeu: corte === undefined ? null : t / 2 - (corte * t) / 0.46,
    aba:
      cfg && COM_ABA.has(cfg.chapeu)
        ? (cfg.chapeu as TipoAba)
        : cfg && RENTES.has(cfg.chapeu)
          ? "rente"
          : null,
    capuz: !!cfg && COM_CAPUZ.has(cfg.roupa),
    acessorioFrente: !!cfg && NA_FRENTE.has(cfg.acessorio),
    mochila: !!cfg && cfg.acessorio === "mochila" && pose === "em-pe",
    pose,
    qualidade,
    zEncosto: pose === "sentado" ? (y: number) => -0.24 - 0.12 * (y + cabecaYMundo - 0.85) : null,
    mechas: cfg?.mechas ?? "nenhuma",
    barba3D: cfg?.barba === "lenhador",
  };
}

/** Chave da geometria: tudo o que muda a malha, nada de cor. */
export function chaveDoCtx(estilo: string, c: CtxCabelo): string {
  const n = (v: number) => v.toFixed(3);
  return [
    estilo,
    n(c.t),
    n(c.troncoW),
    n(c.troncoD),
    n(c.bracoW),
    n(c.troncoH),
    c.corteChapeu === null ? "-" : n(c.corteChapeu),
    c.aba ?? "-",
    c.capuz ? 1 : 0,
    c.acessorioFrente ? 1 : 0,
    c.mochila ? 1 : 0,
    c.pose,
    c.qualidade,
    c.mechas,
    c.barba3D ? 1 : 0,
  ].join("|");
}

export function chaveDoCabelo(
  cfg: AvatarConfig,
  m: Medidas,
  pose: PoseAvatar,
  q: Qualidade,
): string {
  return chaveDoCtx(cfg.cabelo, ctxDoCabelo(cfg, m, pose, q));
}

/* ————————————————— Malha → BufferGeometry ————————————————— */

const _a = new Vector3();
const _b = new Vector3();
const _n = new Vector3();

function paraGeometria(x: Malha, c: CtxCabelo): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(x.pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(x.cor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(x.uv, 2));
  g.setIndex(x.idx);
  g.computeVertexNormals();
  const nrm = g.getAttribute("normal");
  for (const [i, j] of x.costura) {
    _a.fromBufferAttribute(nrm, i);
    _b.fromBufferAttribute(nrm, j);
    _a.add(_b).normalize();
    nrm.setXYZ(i, _a.x, _a.y, _a.z);
    nrm.setXYZ(j, _a.x, _a.y, _a.z);
  }
  // Normal zero (vértice de ponta, quad degenerado) vira NaN → ponto preto no SwiftShader:
  // usa a normal de reserva ("para fora") do vértice.
  const tan = x.tan.slice();
  const peso: number[] = [];
  // Peso do pescoço flexível (C2.4): a transição da spec (do queixo − 1 cm até topo − 8 cm)
  // deixava o cabelo logo acima do ombro girando quase inteiro com a cabeça — no corpo forte
  // ele entrava nas costas ao girar. Abaixo do queixo a cabeça não varre o cabelo (gira em
  // torno do próprio eixo, por cima dele): ali ele já fica com o corpo em 7 cm.
  const y0 = -c.t / 2 + 0.02;
  const y1 = -c.t / 2 - 0.05;
  for (let i = 0; i < nrm.count; i++) {
    _n.fromBufferAttribute(nrm, i);
    if (!(_n.lengthSq() > 1e-12)) {
      _n.set(x.ref[i * 3]!, x.ref[i * 3 + 1]!, x.ref[i * 3 + 2]!);
      if (_n.lengthSq() < 1e-12) _n.set(0, 1, 0);
      _n.normalize();
      nrm.setXYZ(i, _n.x, _n.y, _n.z);
    }
    // tangente ⟂ normal (Gram-Schmidt): a anisotropia lê o quadro TBN
    _a.set(tan[i * 4]!, tan[i * 4 + 1]!, tan[i * 4 + 2]!);
    _a.addScaledVector(_n, -_a.dot(_n));
    if (_a.lengthSq() < 1e-10) {
      _a.set(1, 0, 0).addScaledVector(_n, -_n.x);
      if (_a.lengthSq() < 1e-6) _a.set(0, 0, 1).addScaledVector(_n, -_n.z);
    }
    _a.normalize();
    tan[i * 4] = _a.x;
    tan[i * 4 + 1] = _a.y;
    tan[i * 4 + 2] = _a.z;
    // pescoço flexível: 0 ao lado da cabeça (gira junto), 1 no tronco (fica com o corpo)
    peso.push(sstep(y0, y1, x.pos[i * 3 + 1]!));
  }
  g.setAttribute("tangent", new Float32BufferAttribute(tan, 4));
  g.setAttribute("peso", new Float32BufferAttribute(peso, 1));
  g.computeBoundingSphere();
  return g;
}

/* ————————————————— Montagem ————————————————— */

function novaObra(estilo: string, c: CtxCabelo, inflar: number): Obra {
  return {
    ctx: c,
    cab: new CabecaSDF(c.t),
    corpo: new CorpoCabelo(c),
    env: null,
    aba: c.aba && c.corteChapeu !== null ? baixoDaAba(c.aba, c.t, c.corteChapeu) : null,
    t: c.t,
    d: c.d,
    corte: c.corteChapeu,
    r: semente(estilo),
    corridas: new Map(),
    alta: c.qualidade === "alta",
    inflar,
    nFita: 0,
  };
}

const _o = new Vector3();
const _d = new Vector3();

/** Máscara de mecha da casca (C2.7). */
function mascaraDaCasca(modo: CtxCabelo["mechas"]): MascaraCasca {
  switch (modo) {
    case "frente":
      // a faixa dos dois lados da risca, na frente (ref. 58)
      return (u, _psi, o, campo) => {
        if (campo.f.tipo !== "risca") return 0;
        campo.raio(u, 1, _o, _d);
        const hx = Math.abs(_d.x) / Math.max(1e-6, Math.hypot(_d.x, _d.z));
        return sstep(campo.zF - 0.035, campo.zF - 0.015, o.z) * sstep(0.8, 0.93, hx);
      };
    case "luzes":
      return (u) => {
        const f = (u * 9 + 0.37) % 1;
        return 0.75 * sstep(0, 0.03, f) * (1 - sstep(0.17, 0.2, f));
      };
    case "raiz":
      return () => 1;
    default:
      return () => 0;
  }
}

/**
 * A borda de baixo da franja, medida nos vértices das mechas que ficam na
 * frente da testa: o mínimo de y em colunas de 1,5 cm, alisado. Colunas sem
 * cabelo abaixo da linha do cabelo ficam de fora (ali não há franja, nem véu).
 */
function bordaDaFranja(x: Malha, k: Obra, linha: number): VeuFranja | null {
  const meia = k.t * 0.44;
  const nb = Math.round((2 * meia) / 0.015);
  const ys = new Array<number>(nb).fill(Infinity);
  const zMin = k.d / 2 - 0.002;
  const yMin = testaPadrao(k.t) - 0.06;
  for (let i = x.iniMechas; i < x.n; i++) {
    const px = x.pos[i * 3]!;
    const py = x.pos[i * 3 + 1]!;
    const pz = x.pos[i * 3 + 2]!;
    if (pz < zMin || Math.abs(px) >= meia || py < yMin || py > linha + 0.03) continue;
    const b = Math.min(nb - 1, Math.floor(((px + meia) / (2 * meia)) * nb));
    if (py < ys[b]!) ys[b] = py;
  }
  // só onde a franja desce de verdade (abaixo da linha do cabelo)
  const ok = ys.map((y) => y < linha - 0.004);
  if (ok.filter(Boolean).length < 3) return null;
  const xs: number[] = [];
  const out: number[] = [];
  for (let b = 0; b < nb; b++) {
    if (!ok[b]) continue;
    // alisa com as vizinhas (a ponta fina de um tufo não vira dente no véu)
    let s = 0;
    let w = 0;
    for (let q = -1; q <= 1; q++) {
      const j = b + q;
      if (j < 0 || j >= nb || !ok[j]) continue;
      const pw = q === 0 ? 2 : 1;
      s += ys[j]! * pw;
      w += pw;
    }
    xs.push(-meia + ((b + 0.5) / nb) * 2 * meia);
    out.push(s / w);
  }
  return { xs, ys: out };
}

/**
 * O penteado inteiro numa geometria. `soCasca` = só a casca (barata, síncrona):
 * é o que aparece na sala enquanto a malha completa espera a vez na fila.
 */
export function montarCabelo(
  estilo: EstiloCabelo,
  c: CtxCabelo,
  soCasca = false,
): GeoCabelo | null {
  const fab = ESTILOS[estilo];
  if (!fab) return null;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const k0 = novaObra(estilo, c, 1);
  const e = fab(k0);
  const k = novaObra(estilo, c, e.inflar ?? 1);
  const campo = new Campo(k, e.fluxo);
  const x = new Malha();
  // luzes da frente que fazem parte do penteado: a faixa dos lados da risca soma ao modo
  const mModo = mascaraDaCasca(c.mechas);
  const mFrente = mascaraDaCasca("frente");
  const mCasca: MascaraCasca = e.luzesNaFrente
    ? (u, psi, o, campo) => Math.max(mModo(u, psi, o, campo), mFrente(u, psi, o, campo))
    : mModo;
  construirCasca(k, e.casca, campo, x, mCasca, k.alta ? 64 : 32, k.alta ? 14 : 8);
  if (!soCasca) {
    e.camadas.forEach((cam, gi) => {
      k.r = semente(`${estilo}:${gi}`);
      crescerCamada(k, e.casca, campo, cam, x, c.mechas);
    });
    k.r = semente(`${estilo}:extras`);
    e.extras?.(x, k, c.mechas);
  }
  const veu =
    !soCasca && k.alta && e.franja && c.corteChapeu === null
      ? bordaDaFranja(x, k, e.casca.linha.frente)
      : null;
  // rede de segurança do corpo e da aba, vértice a vértice (milímetros: as guias já desviam)
  const v = new Vector3();
  const malhasEnfeite = [...(k.enfeites?.entries() ?? [])].filter(([, m]) => m.n > 0);
  for (const mm of [x, ...malhasEnfeite.map(([, m]) => m)])
    for (let i = 0; i < mm.n; i++) {
      v.fromArray(mm.pos, i * 3);
      k.corpo.expulsar(v, 0.004);
      if (k.aba) {
        const yAba = k.aba(v.x, v.z);
        if (yAba !== null && v.y > yAba - 0.003) v.y = yAba - 0.003;
      }
      mm.pos[i * 3] = v.x;
      mm.pos[i * 3 + 1] = v.y;
      mm.pos[i * 3 + 2] = v.z;
    }
  const geometria = paraGeometria(x, c);
  const enfeites = malhasEnfeite.map(([cor, m]) => ({ geometria: paraGeometria(m, c), cor }));
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    geometria,
    usaCachos: e.textura === "cachos",
    usaBrilho: !!e.anel,
    triangulos: x.idx.length / 3,
    veu,
    enfeites,
    ms: t1 - t0,
  };
}

/* ————————————————— Barba lenhador 3D ————————————————— */

/**
 * A barba de lenhador em volume (C3.3): uma casca sobre o maxilar e o queixo
 * (offset do SDF da cabeça) que desce abaixo do queixo em bico, com a boca
 * vazada e a borda "de papel" (some no adesivo, que já tem a barba pintada
 * por baixo), mais tufos curtos no queixo e no bigode. A borda de cima fica
 * na bochecha, bem abaixo do olho (a piscadinha não encosta), e os cantos de
 * cima e a lateral são arredondados.
 */
export function montarBarba(t: number, qualidade: Qualidade): GeoCabelo {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const alta = qualidade === "alta";
  const esc = t / 0.46;
  const d = t * 0.92;
  const c: CtxCabelo = {
    t,
    d,
    troncoW: 0.56,
    troncoD: 0.3,
    bracoW: 0.24,
    troncoH: 0.6,
    topoTroncoY: -(0.03 + t / 2),
    ombroY: -(0.09 + t / 2),
    corteChapeu: null,
    aba: null,
    capuz: false,
    acessorioFrente: false,
    mochila: false,
    pose: "em-pe",
    qualidade,
    zEncosto: null,
    mechas: "nenhuma",
    barba3D: true,
  };
  const k = novaObra("barba", c, 1);
  const x = new Malha();
  // Grade (x, s): s anda pela frente do rosto (raio para +z) e depois gira por baixo do
  // queixo (raio inclinado de θ = 0 a 105°), descendo em bico.
  const nx = alta ? 26 : 16;
  const nA = alta ? 7 : 5;
  const nB = alta ? 14 : 9;
  const yCanto = -0.1 * esc;
  const xMax = 0.165 * esc;
  // A boca (do adesivo): elipse centro y −0,088, semi-eixos 0,087 × 0,047 (clássico).
  const bocaY = -0.088 * esc;
  const bocaA = 0.1 * esc;
  const bocaB = 0.055 * esc;
  /**
   * Topo da barba no rosto: desce até o bigode no meio, sobe pela bochecha só
   * até ~3,6 cm (o olho começa em ~7 cm) e arredonda no canto de fora.
   */
  const yTopo = (ax: number) =>
    lerp(-0.045 * esc, 0.036 * esc, sstep(0.085 * esc, 0.15 * esc, ax)) -
    0.045 * esc * sstep(0.13 * esc, xMax, ax) ** 2;
  const o = new Vector3();
  const dir = new Vector3();
  const p = new Vector3();
  const tg = new Vector3(0, -1, 0);
  const ref = new Vector3();
  const linhas: number[][] = [];
  const dentro: boolean[][] = [];
  const nS = nA + nB;
  for (let i = 0; i <= nx; i++) {
    const fx = -1 + (2 * i) / nx;
    const xx = fx * xMax;
    const ax = Math.abs(xx);
    const col: number[] = [];
    const ok: boolean[] = [];
    // a lateral afina em curva (sem placa reta no 3/4): espessura cai desde 55% da meia largura
    const lateral = 1 - sstep(0.55, 1, Math.abs(fx));
    for (let j = 0; j <= nS; j++) {
      let e: number;
      let y: number;
      if (j <= nA) {
        // frente do rosto: do topo da barba até o canto do queixo
        y = lerp(yTopo(ax), yCanto, j / nA);
        let px = xx;
        const rb = Math.hypot(xx / bocaA, (y - bocaY) / bocaB);
        if (rb < 1) {
          // dentro da boca: o vértice vai para a borda da elipse (contorno liso, sem degrau
          // da grade); os quads que ficam inteiros dentro degeneram e não aparecem
          const a = Math.atan2((y - bocaY) / bocaB, xx / bocaA);
          px = Math.cos(a) * bocaA;
          y = bocaY + Math.sin(a) * bocaB;
        }
        o.set(px, y, 0);
        dir.set(0, 0, 1);
        const bordaTopo = sstep(0, 0.03 * esc, yTopo(ax) - y);
        const bordaBoca = sstep(1.0, 1.5, Math.max(rb, 1));
        e = 0.004 + 0.016 * bordaTopo * bordaBoca * lateral;
        ok.push(rb >= 1);
      } else {
        const th = (((j - nA) / nB) * (105 * Math.PI)) / 180;
        o.set(xx, yCanto, 0);
        dir.set(0, -Math.sin(th), Math.cos(th));
        // o bico: mais grosso no meio e na frente-baixo, papel nas bordas
        const s = th / ((105 * Math.PI) / 180);
        const massa = Math.sin(Math.min(1, s * 1.25) * Math.PI) ** 0.8;
        const bico = 1 - 0.35 * Math.abs(fx) ** 1.6;
        e = 0.004 + (0.02 + 0.1 * massa * bico) * esc * lateral * (1 - sstep(0.85, 1, s));
        ok.push(true);
      }
      const r = k.cab.alcance(o, dir, e);
      p.copy(o).addScaledVector(dir, r);
      ref.copy(dir);
      // tom: mais escuro perto da pele e no fundo, mais claro na massa
      const tom = 0.85 + 0.25 * clamp01((e - 0.004) / 0.08);
      col.push(x.v(p, tom, 0, fx * 1.4 + 2, V_INICIO + (j / nS) * 0.5, tg, ref));
    }
    linhas.push(col);
    dentro.push(ok);
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nS; j++) {
      // quad com 3+ vértices na boca: fica de fora (os de borda, com vértice puxado para a
      // elipse, ficam e fazem o contorno liso)
      const fora4 =
        +dentro[i]![j]! + +dentro[i + 1]![j]! + +dentro[i]![j + 1]! + +dentro[i + 1]![j + 1]!;
      if (fora4 < 2) continue;
      const a = linhas[i]![j]!;
      const b = linhas[i + 1]![j]!;
      const a1 = linhas[i]![j + 1]!;
      const b1 = linhas[i + 1]![j + 1]!;
      // frente para +z/−y: a ordem a, a1, b deixa a face virada para fora
      x.idx.push(a, a1, b, b, a1, b1);
    }
  x.iniMechas = x.n;
  // Tufos curtos: 8 no queixo/bico (pontas para baixo) e 2 de bigode.
  k.r = semente("barba:tufos");
  const nTufos = alta ? 8 : 6;
  for (let i = 0; i < nTufos; i++) {
    const fx = -0.8 + (1.6 * (i + 0.5)) / nTufos + (k.r() - 0.5) * 0.08;
    const th = (60 + 25 * k.r()) * (Math.PI / 180);
    o.set(fx * xMax, yCanto, 0);
    dir.set(0, -Math.sin(th), Math.cos(th));
    const raio = k.cab.alcance(o, dir, 0.03 * esc);
    const a = o.clone().addScaledVector(dir, raio);
    const comp = (0.06 + 0.04 * (1 - Math.abs(fx))) * esc * (0.85 + 0.3 * k.r());
    const b = a.clone().add(new Vector3(fx * 0.02, -comp * 0.7, comp * 0.35));
    const c2 = b.clone().add(new Vector3(fx * 0.015, -comp * 0.5, -comp * 0.05));
    tufo(k, x, [a, b, c2], {
      largura: (0.022 + 0.008 * k.r()) * esc,
      espessura: 0.45,
      afina: 0.3,
      raiz: 0.8,
      pontas: 1,
      abre: 0,
      concha: 0.2,
      torce: 0,
      V0: V_INICIO + 0.1,
      u0: k.r() * 0.6,
      tom: (v) => lerp(0.9, 1.1, v),
      mascara: () => 0,
      separa: 0,
    });
  }
  for (const l of [-1, 1]) {
    const g = [
      new Vector3(0.006 * l * esc, -0.03 * esc, d / 2 + 0.008),
      new Vector3(0.06 * l * esc, -0.036 * esc, d / 2 + 0.012),
      new Vector3(0.115 * l * esc, -0.06 * esc, d / 2 + 0.008),
    ];
    const am = amostrar(k, g, alta ? 8 : 6, new Vector3(0, 0, 1));
    const n = am.c.length;
    const w = am.vs.map((v) => 0.018 * esc * Math.pow(Math.max(0.05, 1 - v), 0.6));
    fita(
      x,
      am.c,
      am.B,
      am.N,
      am.T,
      am.vs.map((v) => V_INICIO + 0.05 + v * 0.1),
      { w, h: w.map((ww) => ww * 0.45), barriga: 0.3, concha: 0.1 },
      am.vs.map(() => 1),
      new Array<number>(n).fill(0),
      0.2 + (l > 0 ? 0.3 : 0),
      0.15,
      alta ? 4 : 3,
    );
  }
  const geometria = paraGeometria(x, c);
  // a barba gira com a cabeça inteira (peso 0 em tudo)
  const peso = geometria.getAttribute("peso");
  for (let i = 0; i < peso.count; i++) peso.setX(i, 0);
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    geometria,
    usaCachos: false,
    usaBrilho: false,
    triangulos: x.idx.length / 3,
    veu: null,
    ms: t1 - t0,
  };
}

/* ————————————————— Cache com contagem de referências ————————————————— */

type Entrada = { geo: GeoCabelo; refs: number; timer: ReturnType<typeof setTimeout> | null };
const CACHE = new Map<string, Entrada>();
const DESCARTE_MS = 20_000;

function agendarDescarte(chave: string, ms: number) {
  const e = CACHE.get(chave);
  if (!e || e.refs > 0) return;
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(() => {
    const atual = CACHE.get(chave);
    if (atual && atual.refs === 0) {
      atual.geo.geometria.dispose();
      atual.geo.enfeites?.forEach((e) => e.geometria.dispose());
      CACHE.delete(chave);
    }
  }, ms);
}

/** Já está pronta no cache? (sem gerar) */
export function emCache(chave: string): GeoCabelo | null {
  return CACHE.get(chave)?.geo ?? null;
}

/**
 * Pega do cache ou gera. Registra com descarte agendado: se o render que
 * pediu nunca for "commitado" (StrictMode, Suspense), a malha some sozinha.
 */
export function obterGeo(chave: string, gerar: () => GeoCabelo | null): GeoCabelo | null {
  const e = CACHE.get(chave);
  if (e) return e.geo;
  const geo = gerar();
  if (!geo) return null;
  CACHE.set(chave, { geo, refs: 0, timer: null });
  agendarDescarte(chave, DESCARTE_MS);
  return geo;
}

/** No useEffect: segura a malha (cancela o descarte). */
export function reter(chave: string) {
  const e = CACHE.get(chave);
  if (!e) return;
  e.refs++;
  if (e.timer) {
    clearTimeout(e.timer);
    e.timer = null;
  }
}

/** No cleanup: solta; com 0 referências, descarta 20 s depois (troca rápida de look reaproveita). */
export function soltar(chave: string) {
  const e = CACHE.get(chave);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0) agendarDescarte(chave, DESCARTE_MS);
}
