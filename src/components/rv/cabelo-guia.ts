import { Vector3 } from "three";
import {
  KV,
  Malha,
  PI,
  corrida,
  empurrarDaCabeca,
  empurrarDaCabecaNoPlano,
  envelope,
  FOLGA_ENCOSTO,
  faixa,
  foraDaCabeca,
  foraDaMecha,
  lerp,
  limitarEncosto,
  pontoCasca,
  sstep,
  yMinimo,
  type Campo,
  type CascaCfg,
  type CtxCabelo,
  type Obra,
} from "@/components/rv/cabelo-casca";
import { tufo } from "@/components/rv/cabelo-fita";
import { V_INICIO } from "@/components/rv/cabelo-texturas";

/*
 * O crescimento das mechas: cada uma nasce na casca, segue o fluxo grudada
 * nela ("abraço"), e depois fica solta — gravidade, pulo para fora, enrolar.
 * Em cada passo do trecho solto a mecha é empurrada para fora da cabeça e
 * respeita o rosto, a aba do chapéu e o CORPO. O corpo entra como um
 * envelope suave (cabelo-casca): a mecha começa a se afastar do ombro, do
 * capuz e da mochila ANTES de chegar neles, numa rampa — nada de trava em
 * degrau, que virava quina, mola e dobra. Onde pousar segue o contrato das
 * frentes (peito fora da gola e dos braços, costas, capuz, mochila, encosto).
 */

export type Camada = {
  n: number;
  /** Faixa de u (volta da cabeça: 0 nuca, 0,25 +x, 0,5 frente, 0,75 −x). */
  u: [number, number];
  /** Raiz: fração da corrida da linha (0 = risca/polo). */
  raiz?: [number, number];
  /** Até onde gruda na casca (fração da corrida; > 1 passa da linha do cabelo). */
  abraco: [number, number];
  /** Trecho solto (m). */
  livre: [number, number];
  largura: [number, number];
  pontas?: number;
  espessura?: number;
  afina?: number;
  abre?: number;
  gravidade?: number;
  /** Empurra para fora no começo do trecho solto. */
  levanta?: number;
  /** Curva por metro (+ para fora, − para dentro). */
  enrola?: number;
  /** O `enrola` só vale a partir desta fração do trecho solto (gancho só na ponta). */
  enrolaDesde?: number;
  /** A raiz sai deitada na casca (folga crescendo aos poucos): risca limpa, sem raiz em pé. */
  raizRente?: boolean;
  /** Desvio lateral do fluxo (em u por rad). */
  deriva?: number;
  folga?: number;
  tom?: number;
  /** Na frente do rosto, não desce abaixo deste y (corpo clássico; escala com a cabeça). */
  testa?: number;
  /**
   * Franja: desce até a `testa` e ENCOSTA na testa (z = d/2 + 0,012) em vez de
   * flutuar à frente dela; sob chapéu, renasce no corte da frente e deita até a testa.
   */
  franja?: boolean;
  /** No trecho solto, a mecha não se afasta mais que isto da pele (pontas da nuca rentes). */
  saidaMax?: number;
  zAlvo?: "tras" | "frente" | "auto";
  jitter?: number;
  /** Mecha da frente (modo de mechas "frente"). */
  frente?: boolean;
  /** Só as N mechas centrais da camada recebem a máscara "frente" (curtos: 2 da franja). */
  frenteN?: number;
  /**
   * Mecha sempre na cor das mechas (máscara 1), seja qual for o modo: as luzes que fazem
   * parte do penteado (as duas mechas loiras da frente do "longo com luzes").
   */
  mecha?: boolean;
  concha?: number;
  torce?: number;
  /** Ondas laterais no trecho solto (amplitude m). */
  onda?: number;
  /** Cachos (hélice) no trecho solto: raio (m). */
  cacho?: number;
  /** Variação do fim de cada fita (±); padrão 0,08 (cortes retos: 0,02). */
  fimVar?: number;
  /** Separação das pontas (fração de w); padrão 0,35. */
  separa?: number;
  /** Regra anti-pente (C2.9): comprimento ±22% e giro ±12° em leques e cristas. */
  antiPente?: boolean;
  /**
   * Cabelo comprido: a mecha que sai da cabeça mais alta que a nuca ganha esse tanto a mais
   * de comprimento (0..1), para as pontas acabarem na mesma barra; e `vCentro` alonga as do
   * meio de trás (barra em V).
   */
  nivelar?: number;
  vCentro?: number;
};

/* ————————————————— Máscara de mechas e tom ————————————————— */

export type ModoMechas = CtxCabelo["mechas"];

/** Máscara (canal g) de uma fita ao longo de v, conforme o modo (C2.7). */
export function mascaraDaFita(
  modo: ModoMechas,
  frente: boolean,
  luz: boolean,
): (v: number) => number {
  switch (modo) {
    case "frente":
      return () => (frente ? 1 : 0);
    case "pontas":
      return (v) => sstep(0.5, 0.92, v);
    case "luzes":
      return () => (luz ? 0.75 : 0);
    case "raiz":
      return (v) => 1 - sstep(0.15, 0.3, v);
    case "ombre":
      return (v) => sstep(0.3, 0.8, v);
    default:
      return () => 0;
  }
}

/** Tom ao longo da mecha: raiz mais escura (×0,72), ponta mais clara (×1,12). */
export function tomDaMecha(tom: number): (v: number) => number {
  return (v) => tom * lerp(0.72, 1, sstep(0, 0.22, v)) * (1 + 0.12 * sstep(0.55, 1, v));
}

/* ————————————————— Rosto, aba e corpo ————————————————— */

/** Linha da testa (C2.3-6): a franja "até a sobrancelha" = −0,01 + 0,30t. */
export function testaPadrao(t: number) {
  return -0.01 + 0.3 * t;
}

/** O ponto está na frente do rosto, entre a `testa` e o queixo? */
export function naFrenteDoRosto(k: Obra, p: Vector3, testa: number) {
  return p.z > k.d / 2 - 0.07 && Math.abs(p.x) < k.t * 0.5 && p.y < testa && p.y > -k.t / 2 - 0.03;
}

/**
 * Rosto no trecho solto: na frente do rosto só passa a MOLDURA, em |x| ≥
 * 0,29t (olhos, óculos e o meio do rosto ficam livres). Devolve true quando a
 * mecha chega por cima no meio do rosto — é franja e acaba ali.
 */
function limitarRosto(k: Obra, q: Vector3, ant: Vector3, testa: number, sx: number): boolean {
  if (!naFrenteDoRosto(k, q, testa)) return false;
  const xm = 0.29 * k.t;
  const ax = Math.abs(q.x);
  if (ax < xm && ant.y >= testa - 0.002) return true;
  if (ax < xm) q.x = (Math.sign(q.x) || sx || 1) * xm;
  return false;
}

/** Sob chapéu de aba: o cabelo fica abaixo da face de baixo da aba (com folga da espessura da fita). */
function limitarAba(k: Obra, p: Vector3, margem = 0.014) {
  if (!k.aba) return;
  const y = k.aba(p.x, p.z);
  if (y !== null && p.y > y - margem) p.y = y - margem;
}

/** Quanto a mecha comprida se aproxima das costas/do peito por metro que desce. */
const APROXIMA = 0.35;

/**
 * Onde o cabelo comprido pode ficar no corpo (contrato item 7), com a
 * precedência encosto (sentado) > capuz > mochila (em pé) > costas genérica.
 * `lado` = +1 mecha da frente (peito), −1 de trás (costas); `ant` = o ponto
 * anterior da mesma mecha (a aproximação das costas/do peito é gradual).
 */
export function pousar(
  k: Obra,
  q: Vector3,
  ant: Vector3 | null,
  lado: number,
  sx: number,
  xAlvo?: number,
) {
  const c = k.ctx;
  if (q.y > c.topoTroncoY + 0.42) return;
  const env = envelope(k);
  const tD = c.troncoD / 2;
  if (lado > 0) {
    // Frente: fora da faixa central da gola/gravata/crachá e fora do braço, em rampa desde
    // 14 cm acima do ombro (a linha central fica a ≥ 19 cm do meio: a fita, com a meia
    // largura, não entra nos 10 cm da gola). Sentado o braço gira para a frente e o canto do
    // ombro sobe até ~topo + 0,085, colado ao peito: a mecha entra no peito logo abaixo do
    // queixo e mais para dentro.
    const sentado = c.pose === "sentado";
    const s = sentado
      ? sstep(-k.t / 2 + 0.06, -k.t / 2 - 0.02, q.y)
      : sstep(c.ombroY + 0.14, c.ombroY - 0.02, q.y);
    // barba lenhador 3D: a moldura passa por fora dela (|x| ≥ 0,20 abaixo de y −0,16)
    const sb = c.barba3D && q.z > 0 ? sstep(-0.13, -0.17, q.y) : 0;
    if (s > 0 || sb > 0) {
      const ax = Math.abs(q.x);
      const sg = Math.sign(q.x) || sx || 1;
      const xmax = c.troncoW / 2 - (sentado ? 0.075 : 0.01);
      // cada mecha da frente tem o seu lugar no peito (a mais da frente vai mais para o meio):
      // a cortina se espalha em vez de virar um rabo fino só na beira do ombro
      const x0 = xAlvo === undefined ? ax : xAlvo;
      let alvo = lerp(ax, Math.min(xmax, Math.max(0.19, x0)), s);
      alvo = lerp(alvo, Math.max(0.2, alvo), sb);
      q.x = sg * alvo;
    }
    const zp = tD + (c.acessorioFrente ? 0.075 : 0.055);
    if (ant && q.z > zp && q.y < c.ombroY + 0.04 && Math.abs(q.x) < c.troncoW / 2)
      q.z = Math.min(q.z, Math.max(zp, ant.z - APROXIMA * Math.max(0, ant.y - q.y)));
    q.z = Math.max(q.z, env.limFrente(q.x, q.y));
    return;
  }
  // Costas genérica (faixa tD + 0,035 a tD + 0,06): o cabelo que desce afastado chega nela aos
  // poucos, a partir da linha do ombro.
  const zg = -(tD + 0.05);
  if (ant && q.z < zg && q.y < c.topoTroncoY && Math.abs(q.x) < c.troncoW / 2 + 0.03)
    q.z = Math.max(q.z, Math.min(zg, ant.z + APROXIMA * Math.max(0, ant.y - q.y)));
  // Capuz, mochila, tronco e braços: o z máximo, já com a rampa de antecipação.
  q.z = Math.min(q.z, env.limTras(q.x, q.y));
  // Encosto (sentado) vence tudo.
  const e = env.limEncosto(q.x, q.y);
  if (e > -0.9 && q.z < e) q.z = e;
}

/** Empurra para fora da cabeça; abaixo do queixo só na horizontal (nunca joga a mecha para cima). */
function afastarDaCabeca(k: Obra, q: Vector3, margem: number) {
  if (q.y > -k.t / 2 + 0.02) empurrarDaCabeca(k, q, margem);
  else empurrarDaCabecaNoPlano(k, q, margem);
}

/** Pontas rentes: puxa o ponto para a cabeça se ele passou de `max` da pele. */
function limitarSaida(k: Obra, q: Vector3, max: number, n: Vector3) {
  const s = k.cab.sdf(q.x, q.y, q.z);
  if (s <= max) return;
  foraDaCabeca(k, q, n);
  q.addScaledVector(n, max - s);
}

/* ————————————————— Bancada ————————————————— */

/**
 * Sonda da bancada (scratchpad): recebe cada guia pronta e o índice onde
 * começa o trecho solto — conta dobras do cabelo comprido. Fica null no app.
 */
export const sondaDeGuias: { fn: ((g: Vector3[], iniLivre: number) => void) | null } = { fn: null };

/* ————————————————— Crescimento de uma camada ————————————————— */

const _eixo = new Vector3();
const _n = new Vector3();
const _perp = new Vector3();

type Regras = {
  folga: number;
  testa: number;
  lado: number;
  sx: number;
  saidaMax: number | undefined;
  /** Mecha da frente: onde ela pousa no peito (|x|). */
  xAlvo: number | undefined;
};

/** Aplica (de novo) as regras do trecho solto num ponto já movido. */
function restringirSolto(k: Obra, q: Vector3, ant: Vector3, r: Regras) {
  afastarDaCabeca(k, q, r.folga + 0.006);
  if (r.saidaMax !== undefined && q.y > -k.t / 2) limitarSaida(k, q, r.saidaMax, _n);
  // (no alisamento a franja não "acaba" de novo: só não desce da testa)
  if (limitarRosto(k, q, ant, r.testa, r.sx)) q.y = Math.max(q.y, r.testa);
  limitarAba(k, q);
  pousar(k, q, ant, r.lado, r.sx, r.xAlvo);
}

export function crescerCamada(
  k: Obra,
  c: CascaCfg,
  campo: Campo,
  cam: Camada,
  x: Malha,
  modo: ModoMechas,
) {
  const p = new Vector3();
  const q = new Vector3();
  const dir = new Vector3();
  const nrm = new Vector3();
  const ant = new Vector3();
  const yMin = yMinimo(k.ctx);
  const esc = k.t / 0.46;
  const testa = (cam.testa ?? 0.128) * esc;
  for (let i = 0; i < cam.n; i++) {
    const r = k.r;
    const uu = faixa(cam.u, (i + 0.5 + (r() - 0.5) * (cam.jitter ?? 0.6)) / cam.n);
    const sorteioRaiz = r();
    const sorteioAbraco = r();
    // franja: a guia vai ~2 cm além da linha da testa (as pontas das sub-fitas acabam antes da
    // guia); o tufo do meio desce mais e as pontas ficam desencontradas (anti-pente)
    const centro = 1 - Math.abs((2 * (i + 0.5)) / cam.n - 1);
    // (nunca abaixo da faixa dos óculos: −0,01 + 0,21t, com folga para a ponta da fita)
    const testaI = cam.franja
      ? Math.max(-0.01 + 0.26 * k.t, testa - (0.018 + 0.012 * centro + (r() - 0.5) * 0.014) * esc)
      : testa;
    // a corrida inteira (sem chapéu) diz onde a mecha nasceria; a corrida da mecha começa no corte
    const crTudo = corrida(k, c, campo, uu, false);
    const cr = corrida(k, c, campo, uu, true);
    if (!cr || !crTudo) continue;
    const [A, b] = crTudo;
    const a = cr[0];
    const corr = b - A;
    let psi0 = A + corr * faixa(cam.raiz ?? [0, 0.08], sorteioRaiz);
    let psi1 = A + corr * faixa(cam.abraco, sorteioAbraco);
    // Sob chapéu, a mecha que nasceria acima do corte RENASCE no corte (mesmo u), amassada:
    // é isso que deixa franja, laterais e nuca cheias por baixo da aba (nada de "dois tufos").
    let amassa = 1;
    let solto = 1;
    const renasce = k.corte !== null && psi0 < a;
    if (renasce) {
      // só a mecha que acabaria toda acima do corte (topo/redemoinho) sai amassada e curta;
      // a comprida (abraço passa do corte) só muda a raiz e mantém o comprimento
      if (psi1 < a + 0.1) {
        amassa = 0.3;
        solto = 0.6;
      }
      // sob aba larga não levanta e nasce ~7 cm abaixo do corte, já na parede da cabeça: na
      // quina de cima a folga empurra a mecha para o alto, e ela furava a aba
      if (k.aba) amassa = 0;
      psi0 = a + (k.aba ? 0.3 : 0.01);
      psi1 = cam.franja ? Math.max(psi1, a + 0.6) : Math.max(psi1, psi0 + 0.1);
    }
    // a renascida sob a aba sai amassada pelo chapéu: rente à casca (com a folga cheia, na
    // quina de cima da cabeça ela subia acima da aba)
    const folga = Math.min(
      ((cam.folga ?? 0.008) + 0.002 * r()) * k.inflar,
      renasce && k.aba ? 0.014 : 1,
    );
    const deriva = (cam.deriva ?? 0) * (0.7 + 0.6 * r());
    const guia: Vector3[] = [];
    // começa um pouco antes e por dentro da casca (raiz escondida); com `raizRente`, a raiz
    // já sai deitada na casca e a folga vem aos poucos (sem degrau na risca)
    const rente = renasce || !!cam.raizRente;
    pontoCasca(
      k,
      c,
      campo,
      uu,
      Math.max(a, psi0 - 0.05),
      b,
      rente ? -0.002 : -0.006,
      p,
      FOLGA_ENCOSTO,
    );
    limitarAba(k, p);
    guia.push(p.clone());
    const passos = Math.max(rente ? 4 : 2, Math.ceil(Math.abs(psi1 - psi0) / 0.08));
    for (let j = 0; j <= passos; j++) {
      const psi = lerp(psi0, psi1, j / passos);
      // a renascida no corte (e a de raiz rente) sai rente e só depois ganha a folga: sem
      // "prateleira" saindo na horizontal debaixo da aba (a fita ali ficava de pé e furava a
      // aba) e sem a raiz em pé na risca (que virava franja de pedaços escuros nela)
      const fj = rente ? lerp(0.004, folga, sstep(0, renasce ? 0.75 : 0.35, j / passos)) : folga;
      pontoCasca(k, c, campo, uu + deriva * (psi - psi0), psi, b, fj, p, FOLGA_ENCOSTO);
      if (naFrenteDoRosto(k, p, testaI)) break;
      // na nuca o abraço não dobra para baixo do queixo: ali já é o pescoço e o capuz caído
      if (j > 1 && p.y < -k.t / 2 + 0.03 && p.z < 0 && Math.abs(p.x) < k.ctx.troncoW / 2) break;
      limitarAba(k, p);
      guia.push(p.clone());
    }
    const iniLivre = guia.length - 1;
    const ultAbraco = guia[guia.length - 1]!;
    const frenteZ = cam.zAlvo === "frente" || (cam.zAlvo !== "tras" && ultAbraco.z > 0.02);
    const sx = Math.sign(ultAbraco.x);
    const regras: Regras = {
      folga,
      testa: testaI,
      lado: frenteZ ? 1 : -1,
      sx,
      saidaMax: cam.saidaMax === undefined ? undefined : cam.saidaMax * esc,
      // a mais da frente (abraço acabando perto do rosto) pousa mais para o meio do peito
      xAlvo: frenteZ ? lerp(0.27, 0.19, sstep(0.06, 0.18, ultAbraco.z)) * esc : undefined,
    };
    let livre = faixa(cam.livre, r()) * solto * (k.corte !== null && cam.franja ? 0.5 : 1);
    if (cam.antiPente) livre *= 0.78 + 0.44 * r();
    const giro = cam.antiPente ? (r() - 0.5) * 2 * 0.21 : 0;
    if (cam.nivelar && guia.length) livre += cam.nivelar * Math.max(0, ultAbraco.y + 0.2 * esc);
    if (cam.vCentro) {
      const du = Math.abs((((uu % 1) + 1.5) % 1) - 0.5);
      livre *= 1 + cam.vCentro * sstep(0.25, 0, du);
    }
    if (guia.length >= 2 && livre > 0.005) {
      dir
        .copy(ultAbraco)
        .sub(guia[guia.length - 2]!)
        .normalize();
      if (giro) {
        foraDaCabeca(k, ultAbraco, _eixo);
        dir.applyAxisAngle(_eixo, giro);
      }
      // Passando da linha do cabelo por baixo da cabeça, o abraço aponta para o pescoço: o
      // trecho solto não pode começar entrando (empilharia na nuca e no ombro).
      _eixo.set(ultAbraco.x, 0, ultAbraco.z);
      if (_eixo.lengthSq() > 1e-6 && ultAbraco.y < 0) {
        _eixo.normalize();
        const dentro = dir.dot(_eixo);
        if (dentro < 0) dir.addScaledVector(_eixo, -dentro).normalize();
      }
      const n = Math.max(2, Math.ceil(livre / (cam.cacho ? 0.008 : 0.025)));
      const passo = livre / n;
      q.copy(ultAbraco);
      const levanta = (cam.levanta ?? 0) * amassa;
      const enrola = (cam.enrola ?? 0) * (amassa > 0 ? amassa : 0.3);
      // renascida sob a aba: cai (espetada para fora, ela furava a aba ou virava saia de lado)
      const gravidade = (cam.gravidade ?? 0.2) + (amassa === 0 ? 0.45 : 0);
      const desde = cam.enrolaDesde ?? 0;
      for (let j = 0; j < n; j++) {
        const s = j / n;
        foraDaCabeca(k, q, nrm);
        dir.addScaledVector(nrm, levanta * (1 - s));
        dir.y -= gravidade;
        dir.normalize();
        if (enrola && s >= desde) {
          _perp.copy(nrm).addScaledVector(dir, -nrm.dot(dir));
          if (_perp.lengthSq() > 1e-6)
            dir.addScaledVector(_perp.normalize(), enrola * passo).normalize();
        }
        ant.copy(q);
        q.addScaledVector(dir, passo);
        afastarDaCabeca(k, q, folga + 0.006);
        if (regras.saidaMax !== undefined && q.y > -k.t / 2)
          limitarSaida(k, q, regras.saidaMax, _n);
        if (limitarRosto(k, q, ant, testaI, sx)) {
          // franja: a ponta acaba na linha da testa, encostada nela
          const f = Math.max(0, Math.min(1, (ant.y - testaI) / Math.max(1e-6, ant.y - q.y)));
          q.lerpVectors(ant, q, f);
          q.z = Math.max(q.z, k.d / 2 + 0.018);
          guia.push(q.clone());
          break;
        }
        limitarAba(k, q);
        pousar(k, q, ant, regras.lado, sx, regras.xAlvo);
        guia.push(q.clone());
        if (q.y < yMin) break;
      }
    }
    if (guia.length < 3) continue;
    if (cam.franja) encostarNaTesta(k, guia, testaI, c.linha.frente);
    suavizar(k, guia, regras, iniLivre);
    if (cam.onda || cam.cacho) ondular(k, guia, iniLivre, cam, regras);
    sondaDeGuias.fn?.(guia, iniLivre);
    const luz = r() < 0.3;
    // "frente" nos curtos: só as N centrais da camada
    let ehFrente = !!cam.frente;
    if (ehFrente && cam.frenteN !== undefined) {
      const meio = (cam.n - 1) / 2;
      ehFrente = Math.abs(i - meio) < cam.frenteN / 2;
    }
    const masc = cam.mecha ? () => 1 : mascaraDaFita(modo, ehFrente, luz);
    const tom = tomDaMecha(cam.tom ?? 1);
    tufo(k, x, guia, {
      // sentado, a mecha do peito fica entre a gola e o braço que sobe: fita mais estreita
      largura: faixa(cam.largura, r()) * (frenteZ && k.ctx.pose === "sentado" ? 0.8 : 1),
      espessura: (cam.espessura ?? 0.32) * k.inflar,
      afina: cam.afina ?? 0.55,
      raiz: 0.6,
      pontas: cam.pontas ?? 1,
      abre: cam.abre ?? 0.25,
      concha: cam.concha ?? 0.18,
      torce: (cam.torce ?? 0) * (r() - 0.5) * 2,
      V0: V_INICIO + (Math.max(0, psi0 - A) * k.t * 0.5) / KV,
      u0: r() * 0.8,
      tom: (v) => tom(v),
      mascara: (v) => masc(v),
      fimVar: cam.fimVar,
      separa: cam.separa,
      fino: !!cam.cacho,
      M: cam.cacho ? 3 : undefined,
    });
  }
}

/**
 * Franja: da linha do cabelo para baixo, a mecha vai deitando até encostar
 * na testa (a ponta toca a pele em z = d/2 + 0,012 + a barriga da fita) —
 * o volume fica no alto, e a testa não ganha uma "viseira" flutuando.
 */
function encostarNaTesta(k: Obra, g: Vector3[], testa: number, linha: number) {
  const zAlvo = k.d / 2 + 0.018;
  for (const p of g) {
    if (p.z < k.d / 2 - 0.03 || Math.abs(p.x) > k.t * 0.48) continue;
    const w = sstep(linha + 0.03, testa + 0.005, p.y);
    if (w > 0 && p.z > zAlvo) p.z = lerp(p.z, zAlvo, w);
  }
}

/** Ondas e cachos: deslocamento lateral/helicoidal crescente no trecho solto. */
function ondular(k: Obra, g: Vector3[], ini: number, cam: Camada, regras: Regras) {
  const fase = k.r() * PI * 2;
  const n = g.length - 1;
  let arco = 0;
  const base = g.map((p) => p.clone());
  const fo = new Vector3();
  for (let i = Math.max(1, ini - 6); i <= n; i++) {
    arco += base[i]!.distanceTo(base[i - 1]!);
    const t = base[Math.min(n, i + 1)]!.clone()
      .sub(base[i - 1]!)
      .normalize();
    foraDaMecha(k, base[i]!, fo);
    const lado = new Vector3().crossVectors(t, fo).normalize();
    const frente = new Vector3().crossVectors(lado, t).normalize();
    const s = sstep(ini - 6, Math.min(n, ini + 6), i);
    if (cam.onda) g[i]!.addScaledVector(lado, Math.sin(arco * 38 + fase) * cam.onda * s);
    if (cam.cacho) {
      const a = arco * 105 + fase;
      g[i]!.addScaledVector(lado, Math.cos(a) * cam.cacho * s).addScaledVector(
        frente,
        Math.sin(a) * cam.cacho * s,
      );
    }
    if (i >= ini) restringirSolto(k, g[i]!, g[i - 1]!, regras);
    else afastarDaCabeca(k, g[i]!, regras.folga + 0.004);
  }
}

/**
 * Alisa a guia (tira os "dentes" das colisões) e reaplica as regras: cabeça
 * em todo o comprimento; rosto, aba e corpo no trecho solto.
 */
function suavizar(k: Obra, g: Vector3[], regras: Regras, iniLivre: number) {
  // mecha comprida (que pousa no corpo) ganha passadas a mais: arredonda a curva do ombro
  const passadas = g.length - iniLivre > 12 ? 4 : 2;
  const m = new Vector3();
  for (let it = 0; it < passadas; it++) {
    for (let i = 2; i < g.length - 1; i++) {
      m.copy(g[i - 1]!)
        .add(g[i + 1]!)
        .multiplyScalar(0.5);
      g[i]!.lerp(m, 0.5);
      if (i > iniLivre) restringirSolto(k, g[i]!, g[i - 1]!, regras);
      else {
        afastarDaCabeca(k, g[i]!, regras.folga + 0.004);
        limitarAba(k, g[i]!);
        limitarEncosto(k, g[i]!, FOLGA_ENCOSTO);
      }
    }
  }
}

/* ————————————————— Guias livres (peças sob medida dos estilos) ————————————————— */

/**
 * Guia que corre SOBRE a casca de `de` até `ate` (direções a partir do
 * centro da cabeça), afastada da pele `folga(s)` (s = 0..1): as fitas largas
 * que levam o cabelo da risca até o elástico da maria-chiquinha.
 */
export function guiaSobreACabeca(
  k: Obra,
  de: Vector3,
  ate: Vector3,
  folga: (s: number) => number,
  n = 8,
): Vector3[] {
  const a = de.clone().normalize();
  const b = ate.clone().normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
  const o = new Vector3();
  const out: Vector3[] = [];
  const d = new Vector3();
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    if (ang < 1e-4) d.copy(a);
    else {
      // slerp: a curva acompanha a cabeça em vez de cortar caminho por dentro dela
      const wa = Math.sin((1 - s) * ang) / Math.sin(ang);
      const wb = Math.sin(s * ang) / Math.sin(ang);
      d.copy(a).multiplyScalar(wa).addScaledVector(b, wb).normalize();
    }
    const r = k.cab.alcance(o, d, folga(s));
    const p = d.clone().multiplyScalar(r);
    limitarEncosto(k, p, FOLGA_ENCOSTO);
    out.push(p);
  }
  return out;
}
