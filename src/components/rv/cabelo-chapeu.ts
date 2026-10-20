import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { clamp01, lerp, sstep, type TipoAba } from "@/components/rv/cabelo-casca";

/*
 * Chapéus reestilizados (C3.2), no mesmo espírito do cabelo: geometria
 * procedural com UV + textura cinza (`texturaChapeu`), cor do material, e o
 * tom (fita de cetim mais escura, vinco) no atributo `color`. Uma geometria
 * = 1 draw call por chapéu.
 *
 * As medidas das abas ficam aqui e valem para os DOIS lados: a geometria do
 * chapéu e o cabelo (`baixoDaAba`), que passa sempre por baixo da aba.
 */

const PI = Math.PI;

/** Acumula uma grade (colunas em volta × linhas no perfil), com costura em θ. */
export class Grade {
  pos: number[] = [];
  cor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  costuras: [number, number][] = [];
  get n() {
    return this.pos.length / 3;
  }
  /**
   * `ponto(i/nu, j/nv, out)` devolve a posição e o tom; a coluna nu repete a 0
   * (normais promediadas na costura). `inverter` = vira as faces (normal para o outro lado).
   * `fechar` = false: grade aberta (um gomo, uma fita), sem costura entre a 1ª e a última coluna.
   */
  grade(
    nu: number,
    nv: number,
    ponto: (fu: number, fv: number, out: Vector3) => number,
    uRep: number,
    vEsc: number,
    inverter = false,
    fechar = true,
  ) {
    const ini = this.n;
    const p = new Vector3();
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const tom = ponto(i / nu, j / nv, p);
        this.pos.push(p.x, p.y, p.z);
        this.cor.push(tom, tom, tom);
        this.uv.push((i / nu) * uRep, (j / nv) * vEsc);
      }
    }
    const L = nv + 1;
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = ini + i * L + j;
        const b = ini + (i + 1) * L + j;
        if (inverter) this.idx.push(a, b, a + 1, b, b + 1, a + 1);
        else this.idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    if (fechar) for (let j = 0; j <= nv; j++) this.costuras.push([ini + j, ini + nu * L + j]);
  }
  geometria(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.cor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nrm = g.getAttribute("normal");
    const a = new Vector3();
    const b = new Vector3();
    for (const [i, j] of this.costuras) {
      a.fromBufferAttribute(nrm, i);
      b.fromBufferAttribute(nrm, j);
      a.add(b).normalize();
      if (!(a.lengthSq() > 0.5)) continue;
      nrm.setXYZ(i, a.x, a.y, a.z);
      nrm.setXYZ(j, a.x, a.y, a.z);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/* ————————————————— Medidas das abas (compartilhadas com o cabelo) ————————————————— */

/** Chapéu de aba (o do 57), no corpo clássico; escala por t/0,46. */
const ABA = {
  rx0: 0.29,
  rz0: 0.27,
  rxA: 0.42,
  rzA: 0.4,
  esp: 0.007,
  rIn: 0.96,
  sobe: 0.075,
  cai: 0.012,
};

/** A aba curva para cima nas laterais (sin²θ) e cai de leve na frente e atrás (f = fração radial). */
function sobeDaAba(esc: number, sx: number, cz: number, f: number) {
  const ff = Math.min(1, f);
  return ABA.sobe * esc * sx * sx * Math.pow(ff, 1.6) - ABA.cai * esc * cz * cz * ff * ff;
}

/**
 * As abas dos chapéus novos (16/10/2026), no corpo clássico (escala por t/0,46): raios da
 * copa na base (rx0, rz0) e da borda (rxA, rzA), espessura e a altura da face de CIMA da aba
 * acima da base (`sobe`, em função de sen θ, cos θ e da fração radial f) — a mesma conta vale
 * para a geometria (`cabelo-chapeus-novos.ts`) e para o cabelo passar por baixo.
 */
export type AbaNova = {
  rx0: number;
  rz0: number;
  rxA: number;
  rzA: number;
  esp: number;
  sobe: (sx: number, cz: number, f: number) => number;
};
export const ABAS_NOVAS: Record<
  "chapeuPalha" | "chapeuCowboy" | "sombrero" | "chapeuPescador",
  AbaNova
> = {
  // palha de roça: aba larga, quase reta, que cai um pouco na frente e atrás
  chapeuPalha: {
    rx0: 0.29,
    rz0: 0.27,
    rxA: 0.48,
    rzA: 0.46,
    esp: 0.008,
    sobe: (sx, cz, f) => 0.022 * sx * sx * Math.pow(f, 1.5) - 0.03 * cz * cz * f * f,
  },
  // cowboy: as laterais enroladas para cima, a frente e as costas caindo
  chapeuCowboy: {
    rx0: 0.285,
    rz0: 0.27,
    rxA: 0.45,
    rzA: 0.43,
    esp: 0.007,
    sobe: (sx, cz, f) => 0.115 * sx * sx * Math.pow(f, 1.8) - 0.022 * cz * cz * f * f,
  },
  // sombrero: aba enorme e chata, com a borda virada para cima
  sombrero: {
    rx0: 0.29,
    rz0: 0.27,
    rxA: 0.6,
    rzA: 0.58,
    esp: 0.009,
    sobe: (_sx, _cz, f) => 0.012 * f + 0.055 * Math.pow(sstep(0.68, 1, f), 2),
  },
  // bucket (pescador): aba curta caindo em volta toda
  chapeuPescador: {
    rx0: 0.29,
    rz0: 0.272,
    rxA: 0.37,
    rzA: 0.35,
    esp: 0.006,
    sobe: (_sx, _cz, f) => -0.07 * f - 0.01 * f * f,
  },
};

/** Cartola (assentada no corte): raios em t, aba e copa; a copa abraça a cabeça no corte. */
export const CARTOLA = { aba: 0.74, copa: 0.56, faixa: 0.565, espAba: 0.025, alt: 0.36 };

/**
 * A face de BAIXO da aba no ponto (x, z), para o cabelo passar por baixo
 * dela; null dentro da copa (o cabelo ali fica escondido) e além da borda.
 * `base` = altura do corte (rel. ao centro da cabeça).
 */
export function baixoDaAba(
  tipo: TipoAba,
  t: number,
  base: number,
): (x: number, z: number) => number | null {
  const esc = t / 0.46;
  if (tipo === "rente") {
    // chapéu justo dos novos (gorro, boné, capacete): a "aba" é a própria borda, no corte,
    // até uns 12 cm fora da cabeça
    const rMax = 0.75 * t;
    return (x, z) => (Math.hypot(x, z / 0.92) < rMax ? base : null);
  }
  const nova = (ABAS_NOVAS as Partial<Record<TipoAba, AbaNova>>)[tipo];
  if (nova) {
    const rx0 = nova.rx0 * esc * ABA.rIn;
    const rz0 = nova.rz0 * esc * ABA.rIn;
    const rxA = nova.rxA * esc;
    const rzA = nova.rzA * esc;
    return (x, z) => {
      const th = Math.atan2(x, z);
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const rr = Math.hypot(x, z);
      const rIn = Math.hypot(sx * rx0, cz * rz0);
      const rOut = Math.hypot(sx * rxA, cz * rzA);
      const f = (rr - rIn) / (rOut - rIn);
      if (f < -0.12 || f > 1.3) return null;
      return base + 0.004 + nova.sobe(sx, cz, clamp01(f)) * esc - nova.esp * esc;
    };
  }
  if (tipo === "chapeu") {
    const rx0 = ABA.rx0 * esc * ABA.rIn;
    const rz0 = ABA.rz0 * esc * ABA.rIn;
    const rxA = ABA.rxA * esc;
    const rzA = ABA.rzA * esc;
    return (x, z) => {
      const th = Math.atan2(x, z);
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const rr = Math.hypot(x, z);
      const rIn = Math.hypot(sx * rx0, cz * rz0);
      const rOut = Math.hypot(sx * rxA, cz * rzA);
      const f = (rr - rIn) / (rOut - rIn);
      // um pouco para dentro da copa também (a parede da copa desce até a aba) e para fora da
      // borda: o cabelo que passa da aba continua na altura dela, sem subir na frente da borda
      if (f < -0.12 || f > 1.3) return null;
      return base + 0.004 + sobeDaAba(esc, sx, cz, clamp01(f)) - ABA.esp * esc;
    };
  }
  if (tipo === "cartola") {
    const rc = CARTOLA.copa * t;
    const ra = CARTOLA.aba * t;
    return (x, z) => {
      const rr = Math.hypot(x, z);
      if (rr < rc * 0.9 || rr > ra * 1.25) return null;
      return base;
    };
  }
  // capacete (ainda o antigo): aba circular em topo + 0,03, raio 0,72t (×1,15 em z)
  const ra = 0.72 * t;
  const yAba = t / 2 + 0.03 - 0.0125;
  return (x, z) => {
    const rr = Math.hypot(x, z / 1.15);
    if (rr < 0.6 * t || rr > ra * 1.25) return null;
    return yAba;
  };
}

/* ————————————————— Chapéu de aba ————————————————— */

/**
 * O chapéu de aba (o amarelo do print 57): copa oval que afina para cima, com
 * VINCO central no alto e as duas "pinças" da frente; fita de cetim de 1,2 cm
 * escurecida na base da copa; aba que curva para cima nas laterais, com
 * espessura e borda arredondada. A base fica na altura do corte do cabelo
 * (`base` = y relativo ao centro da cabeça), envolvendo a cabeça.
 */
export function geoChapeuAba(t: number, base: number, alta: boolean): BufferGeometry {
  const esc = t / 0.46;
  const g = new Grade();
  const nu = alta ? 64 : 40;
  // —— copa ——
  const rx0 = ABA.rx0 * esc;
  const rz0 = ABA.rz0 * esc;
  const alt = 0.2 * esc;
  const afinaTopo = 0.86;
  const vinco = 0.04 * esc;
  /** O alto da copa: abóbada leve menos o vinco (central, mais fundo atrás) e as pinças da frente. */
  const yTopo = (x: number, z: number, rho: number) => {
    const domo = 0.025 * esc * (1 - rho * rho);
    const v =
      vinco *
      Math.exp(-((x / (0.06 * esc)) ** 2)) *
      lerp(0.55, 1, sstep(0.2, -0.2, z / rz0)) *
      sstep(1, 0.75, rho);
    return base + alt + domo - v;
  };
  const pinca = (th: number, s: number) =>
    1 - 0.13 * s * s * Math.exp(-(((Math.abs(th) - 0.75) / 0.32) ** 2)) * Math.max(0, Math.cos(th));
  const nS = alta ? 10 : 6;
  const nT = alta ? 8 : 5;
  g.grade(
    nu,
    nS + nT,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const j = fv * (nS + nT);
      if (j <= nS) {
        // parede: de baixo (s = 0) até a borda do alto
        const s = j / nS;
        const k = lerp(1, afinaTopo, s) * pinca(th, s);
        const x = sx * rx0 * k;
        const z = cz * rz0 * k;
        const yTop = yTopo(x, z, 1);
        out.set(x, lerp(base - 0.004, yTop, s), z);
        return lerp(1.0, 1.1, s);
      }
      // alto: da borda (rho = 1) ao centro
      const rho = 1 - (j - nS) / nT;
      const k = afinaTopo * pinca(th, 1) * rho;
      const x = sx * rx0 * k;
      const z = cz * rz0 * k;
      out.set(x, yTopo(x, z, rho), z);
      return 1.1 - 0.2 * (1 - sstep(0, 0.03 * esc, yTopo(x, z, rho) - (base + alt - vinco)));
    },
    6,
    1,
    true,
  );
  // —— fita de cetim: 1,2 cm, logo acima da aba, um pouco para fora da copa ——
  const yF0 = base + 0.02 * esc;
  const yF1 = yF0 + 0.012 * esc;
  g.grade(
    nu,
    3,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const yy = lerp(yF0, yF1, fv);
      const s = (yy - (base - 0.004)) / (alt + 0.004);
      const k = lerp(1, afinaTopo, s) * pinca(th, s) + 0.012;
      // bordinha arredondada em cima e embaixo
      const borda = fv === 0 || fv === 1 ? -0.004 : 0;
      out.set(Math.sin(th) * (rx0 * k + borda), yy, Math.cos(th) * (rz0 * k + borda));
      return 0.3;
    },
    10,
    0.2,
    true,
  );
  // —— aba ——
  const rxA = ABA.rxA * esc;
  const rzA = ABA.rzA * esc;
  const esp = ABA.esp * esc;
  // perfil fechado: (fração radial, lado) — de dentro por cima, até a borda, volta por baixo
  const perfil: [number, number][] = [];
  const nR = alta ? 7 : 4;
  for (let i = 0; i <= nR; i++) perfil.push([i / nR, 1]);
  perfil.push([1.015, 0.5], [1.02, 0], [1.015, -0.5]);
  for (let i = nR; i >= 0; i--) perfil.push([i / nR, -1]);
  const nP = perfil.length - 1;
  g.grade(
    nu,
    nP,
    (fu, fv, out) => {
      const th = fu * 2 * PI - PI;
      const sx = Math.sin(th);
      const cz = Math.cos(th);
      const [f, lado] = perfil[Math.round(fv * nP)]!;
      const rx = lerp(rx0 * ABA.rIn, rxA, f);
      const rz = lerp(rz0 * ABA.rIn, rzA, f);
      out.set(
        sx * rx,
        base + 0.004 + sobeDaAba(esc, sx, cz, f) + lado * esp * (1 - 0.3 * Math.max(0, f - 1) * 40),
        cz * rz,
      );
      return lado < 0 ? 0.8 : 1.06;
    },
    8,
    1,
  );
  return g.geometria();
}

/** Altura do topo do chapéu de aba acima da base (para o rótulo do nome). */
export function alturaChapeuAba(t: number) {
  return 0.225 * (t / 0.46);
}
