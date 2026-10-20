import { BufferGeometry, Float32BufferAttribute } from "three";

/**
 * Caixa de canto arredondado com UV POR FACE — a "forma" onde a roupa é
 * pintada, como o molde de Shirt/Pants do Roblox.
 *
 * Diferente do `RoundedBox` da drei (um ExtrudeGeometry, cujo UV sai em
 * METROS e gira 90° nas laterais — por isso o xadrez esticava), aqui cada
 * face recebe o seu retângulo do atlas, medido pelo comprimento do arco: a
 * meia curva de cada lado entra na face sem esticar o desenho.
 *
 * Convenção (a mesma do BoxGeometry do three): vendo a face DE FORA, `u`
 * cresce para a direita e `v` para cima. No topo, a borda da frente fica
 * embaixo; na base, a borda da frente fica em cima.
 * Ordem das faces: 0 +x, 1 −x, 2 +y, 3 −y, 4 +z (frente), 5 −z.
 */
export const FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;
export type Face = (typeof FACES)[number];

/** Retângulo em UV (0..1, com v para cima, como o three lê a textura). */
export type RetUV = { u0: number; v0: number; u1: number; v1: number };

type Eixo = 0 | 1 | 2;
type Sinal = 1 | -1;
const EIXOS: Record<Face, { n: Eixo; sn: Sinal; u: Eixo; su: Sinal; v: Eixo; sv: Sinal }> = {
  px: { n: 0, sn: 1, u: 2, su: -1, v: 1, sv: 1 },
  nx: { n: 0, sn: -1, u: 2, su: 1, v: 1, sv: 1 },
  py: { n: 1, sn: 1, u: 0, su: 1, v: 2, sv: -1 },
  ny: { n: 1, sn: -1, u: 0, su: 1, v: 2, sv: 1 },
  pz: { n: 2, sn: 1, u: 0, su: 1, v: 1, sv: 1 },
  nz: { n: 2, sn: -1, u: 0, su: -1, v: 1, sv: 1 },
};

export type OpcoesCaixa = {
  /** Segmentos em cada meia curva (45°). 4 = o arredondado do Bloco; 2 na sala. */
  segCurva?: number;
  /** Segmentos da parte plana (1 basta, mesmo afunilando). */
  segPlano?: number;
  /** Onde cada face cai no atlas. Sem isso, cada face usa a textura inteira (0..1). */
  uv?: Partial<Record<Face, RetUV>>;
  /** Estreita o topo: 0 = reto, 0.25 = topo 25% mais estreito (saia). Negativo alarga. */
  afunilar?: number;
  /**
   * Faces que NÃO viram triângulo: só as que ficam sempre enterradas noutra
   * peça (o topo da perna dentro do quadril). Economiza ~160 triângulos cada.
   */
  semFaces?: readonly Face[];
};

/** Raio efetivo (nunca maior que a metade do lado mais curto). */
export function raioEfetivo(w: number, h: number, d: number, raio: number): number {
  return Math.max(1e-4, Math.min(raio, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/** Comprimento da meia curva que entra em cada borda da face (m). */
export function bordaCurva(r: number): number {
  return (r * Math.PI) / 4;
}

/**
 * Tamanho DESDOBRADO de uma face, em metros: parte plana + meia curva de
 * cada lado. É nessa escala que o pintor desenha (1 unidade = 1 metro).
 */
export function tamanhoDaFace(
  w: number,
  h: number,
  d: number,
  raio: number,
  face: Face,
): [number, number] {
  const r = raioEfetivo(w, h, d, raio);
  const meio = [w / 2, h / 2, d / 2];
  const E = EIXOS[face];
  const L = (eixo: Eixo) => 2 * (meio[eixo]! - r) + 2 * bordaCurva(r);
  return [L(E.u), L(E.v)];
}

/** Posições ao longo de um eixo: curva (ângulo uniforme) → plano → curva. */
function marcas(meio: number, r: number, segCurva: number, segPlano: number): number[] {
  const dentro = meio - r;
  const t = (k: number) => dentro + r * Math.tan((k / segCurva) * (Math.PI / 4));
  const out: number[] = [];
  for (let k = segCurva; k >= 1; k--) out.push(-t(k));
  for (let m = 0; m <= segPlano; m++) out.push(-dentro + (2 * dentro * m) / segPlano);
  for (let k = 1; k <= segCurva; k++) out.push(t(k));
  return out;
}

/** Distância ao centro medida SOBRE a superfície (plano + arco). */
function arco(c: number, dentro: number, r: number): number {
  const a = Math.abs(c);
  return a <= dentro ? c : Math.sign(c) * (dentro + r * Math.atan((a - dentro) / r));
}

export function criarCaixaRoupa(
  w: number,
  h: number,
  d: number,
  raio: number,
  o: OpcoesCaixa = {},
): BufferGeometry {
  const segC = Math.max(1, o.segCurva ?? 4);
  // O afunilado é linear em y: cada face continua plana (trapézio), 1 segmento basta.
  const segP = o.segPlano ?? 1;
  const r = raioEfetivo(w, h, d, raio);
  const meio = [w / 2, h / 2, d / 2];
  const dentro = meio.map((m) => m - r);
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const geo = new BufferGeometry();
  const q = [0, 0, 0];
  const dd = [0, 0, 0];
  const af = o.afunilar ?? 0;

  FACES.forEach((face, grupo) => {
    if (o.semFaces?.includes(face)) return;
    const E = EIXOS[face];
    const mu = marcas(meio[E.u]!, r, segC, segP);
    const mv = marcas(meio[E.v]!, r, segC, segP);
    const Lu = dentro[E.u]! + bordaCurva(r);
    const Lv = dentro[E.v]! + bordaCurva(r);
    const ret = o.uv?.[face] ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
    const base = pos.length / 3;
    for (const cv of mv) {
      for (const cu of mu) {
        q[E.n] = E.sn * meio[E.n]!;
        q[E.u] = E.su * cu;
        q[E.v] = E.sv * cv;
        // Projeta o ponto da caixa "quadrada" na caixa arredondada.
        let len = 0;
        for (let a = 0; a < 3; a++) {
          const c = Math.max(-dentro[a]!, Math.min(dentro[a]!, q[a]!));
          dd[a] = q[a]! - c;
          q[a] = c;
          len += dd[a]! * dd[a]!;
        }
        len = Math.sqrt(len) || 1;
        let nx = dd[0]! / len;
        let ny = dd[1]! / len;
        let nz = dd[2]! / len;
        let x = q[0]! + nx * r;
        const y = q[1]! + ny * r;
        let z = q[2]! + nz * r;
        if (af) {
          // x,z encolhem conforme sobe: f(y) = 1 − af·(y/h + ½). Normal pela inversa-transposta.
          const f = 1 - af * (y / h + 0.5);
          const df = -af / h;
          const n2 = [nx / f, ny - (df * (x * nx + z * nz)) / f, nz / f];
          const l = Math.hypot(n2[0]!, n2[1]!, n2[2]!);
          [nx, ny, nz] = [n2[0]! / l, n2[1]! / l, n2[2]! / l];
          x *= f;
          z *= f;
        }
        pos.push(x, y, z);
        nor.push(nx, ny, nz);
        const su = (arco(cu, dentro[E.u]!, r) + Lu) / (2 * Lu);
        const sv = (arco(cv, dentro[E.v]!, r) + Lv) / (2 * Lv);
        uvs.push(ret.u0 + su * (ret.u1 - ret.u0), ret.v0 + sv * (ret.v1 - ret.v0));
      }
    }
    const n = mu.length;
    const ini = idx.length;
    for (let j = 0; j < mv.length - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = base + j * n + i;
        idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
      }
    }
    geo.addGroup(ini, idx.length - ini, grupo);
  });

  geo.setIndex(idx);
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geo;
}

/** Um ponto do caminho do rolo: centro do tubo e os dois raios da seção. */
export type PontoRolo = {
  p: readonly [number, number, number];
  /** Raio na horizontal (para fora do caminho). */
  a: number;
  /** Raio na vertical. */
  b: number;
};

/**
 * Tubo de seção ELÍPTICA ao longo de um caminho, com espessura variável — o
 * capuz caído (grosso nas costas, afinando até as pontas que mergulham no
 * decote). Um toro escalado não dá conta: ou fica fino e baixo, ou o arco de
 * trás passa da altura permitida (contrato com o cabelo).
 *
 * UV: u ao longo do caminho (0 → 1); v em volta do tubo com a convenção do
 * TorusGeometry do three: 0 = fora, 0,25 = em cima, 0,5 = dentro (lado do
 * `centro`), 0,75 = embaixo. As pontas ganham tampa (leque) no v = 0,5.
 */
export function criarRolo(
  pts: readonly PontoRolo[],
  centro: readonly [number, number],
  segVolta: number,
): BufferGeometry {
  const n = pts.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const M = segVolta;
  const sub = (a: readonly number[], b: readonly number[]) => [
    a[0]! - b[0]!,
    a[1]! - b[1]!,
    a[2]! - b[2]!,
  ];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return [v[0]! / l, v[1]! / l, v[2]! / l];
  };
  const cruz = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  // comprimento acumulado: u proporcional ao comprimento (o pano não estica)
  const acum = [0];
  for (let i = 1; i < n; i++)
    acum.push(acum[i - 1]! + Math.hypot(...sub(pts[i]!.p, pts[i - 1]!.p)));
  const total = acum[n - 1]! || 1;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(pts[Math.min(n - 1, i + 1)]!.p, pts[Math.max(0, i - 1)]!.p));
    // "fora": horizontal, do centro para o ponto, sem a parte ao longo do caminho
    const P = pts[i]!.p;
    let o = [P[0] - centro[0], 0, P[2] - centro[1]];
    o = norm(
      sub(
        o,
        t.map((x) => x * dot(o, t)),
      ),
    );
    let c = norm(cruz(t, o));
    if (c[1]! < 0) c = c.map((x) => -x);
    const { a, b } = pts[i]!;
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2;
      const co = Math.cos(th);
      const si = Math.sin(th);
      for (let k = 0; k < 3; k++) pos.push(P[k]! + a * co * o[k]! + b * si * c[k]!);
      const nn = norm([0, 1, 2].map((k) => (co / a) * o[k]! + (si / b) * c[k]!));
      nor.push(...nn);
      uvs.push(acum[i]! / total, j / M);
    }
  }
  const L = M + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * L + j;
      idx.push(a, a + L, a + 1, a + 1, a + L, a + L + 1);
    }
  }
  const v = (k: number) => [pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!];
  const nv = (k: number) => [nor[k * 3]!, nor[k * 3 + 1]!, nor[k * 3 + 2]!];
  // Orientação: o primeiro triângulo tem de apontar para fora; senão inverte o tubo.
  const geoN = cruz(sub(v(idx[1]!), v(idx[0]!)), sub(v(idx[2]!), v(idx[0]!)));
  if (dot(geoN, nv(idx[0]!)) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2]!, idx[k + 1]!];
  }
  // Tampas (leque, com vértices próprios e normal da tampa): fecham as pontas
  // caso algum pedaço fique para fora do tronco.
  for (const [i, s] of [
    [0, -1],
    [n - 1, 1],
  ] as const) {
    const P = pts[i]!.p;
    const t = norm(sub(pts[Math.min(n - 1, i + 1)]!.p, pts[Math.max(0, i - 1)]!.p)).map(
      (x) => x * s,
    );
    const meio = pos.length / 3;
    pos.push(P[0], P[1], P[2]);
    nor.push(...t);
    uvs.push(i ? 1 : 0, 0.5);
    const ini = pos.length / 3;
    for (let j = 0; j <= M; j++) {
      const k = i * L + j;
      pos.push(...v(k));
      nor.push(...t);
      uvs.push(i ? 1 : 0, 0.5);
    }
    for (let j = 0; j < M; j++) {
      const a = ini + j;
      const n0 = cruz(sub(v(a), v(meio)), sub(v(a + 1), v(meio)));
      if (dot(n0, t) >= 0) idx.push(meio, a, a + 1);
      else idx.push(meio, a + 1, a);
    }
  }
  const geo = new BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geo;
}

/** Leva o UV 0..1 de QUALQUER geometria (toro, cilindro…) para um retângulo do atlas. */
export function uvNoAtlas(geo: BufferGeometry, ret: RetUV): BufferGeometry {
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, ret.u0 + uv.getX(i) * (ret.u1 - ret.u0), ret.v0 + uv.getY(i) * (ret.v1 - ret.v0));
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * O UV de ExtrudeGeometry (gravata, ponta de gola) sai em METROS: normaliza
 * para 0..1 antes do `uvNoAtlas`. As paredes finas herdam um UV aproximado,
 * o que não aparece em peças de poucos milímetros.
 */
export function normalizarUV(geo: BufferGeometry): BufferGeometry {
  const uv = geo.getAttribute("uv");
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    u0 = Math.min(u0, uv.getX(i));
    u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i));
    v1 = Math.max(v1, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0 || 1), (uv.getY(i) - v0) / (v1 - v0 || 1));
  }
  uv.needsUpdate = true;
  return geo;
}
