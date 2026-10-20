import { useEffect, useMemo, useReducer, useRef } from "react";
import { useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  Euler,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Matrix4,
  type MeshStandardMaterialParameters,
  type WebGLRenderer,
} from "three";
import type { PoseAvatar, Qualidade } from "@/components/rv/contexto-avatar";
import type { Medidas } from "@/components/rv/medidas";
import { enfileirar, useDrenarFila } from "@/components/rv/fila-avatar";
import { criarCaixaRoupa, type Face, type RetUV } from "./caixa-roupa";
import { juntarPorMaterial } from "./juntar";
import { montarMolde, pintarMolde, type Molde, type ParteMolde } from "./molde";
import { esqueleto, type Peca } from "./peca";

/**
 * Cache das peças prontas (textura + material + geometria juntada),
 * compartilhado entre todos os avatares da sala. Duas pessoas de moletom
 * azul no corpo clássico usam a MESMA textura; de moletom vermelho, texturas
 * diferentes mas a MESMA forma (a geometria não depende da cor).
 *
 * Contagem de referência com descarte atrasado: o descarte é agendado já na
 * criação (se ninguém reter — render descartado —, some sozinho), o effect
 * retém, e ao chegar a 0 o descarte volta a ser agendado para 20 s depois.
 * Trocar de roupa no provador e voltar não repinta, e ninguém descarta
 * textura que outro avatar ainda usa. O R3F não descarta geometria nem
 * material passados por prop, então compartilhar é seguro.
 *
 * Na sala (`media`), a pintura vai para a fila de 1 tarefa por frame
 * (`fila-avatar.ts`, a mesma do cabelo) e, até ficar pronta, a peça usa um
 * material liso na cor base: 10 pessoas entrando juntas não travam o frame.
 */

export const PX_POR_METRO: Record<Qualidade, number> = { alta: 512, media: 256 };
const MARGEM: Record<Qualidade, number> = { alta: 6, media: 10 };
const ESPERA_MS = 20_000;
/**
 * No máximo tantas peças SEM ninguém usando ficam guardadas (as mais
 * recentes). Percorrer 20 cores no provador criava 20 atlas (até ~16 MB cada,
 * canvas + GPU) presos por 20 s — no celular isso derruba o contexto WebGL.
 */
const MAX_OCIOSAS = 6;

type Forma = {
  chave: string;
  molde: Molde;
  geo: BufferGeometry;
  pele: BufferGeometry | null;
  refs: number;
  /** Versões com braço(s) solto(s), montadas só sob pedido — por conjunto de lados ("1", "-1,1"). */
  separadas?: Map<string, PecaSeparada>;
};

/**
 * Um braço (manga, punho e o antebraço de pele) fora da malha juntada, para
 * o Avatar3D girá-lo no ombro (aceno da tela Início, 16/10/2026; reações do
 * avatar, 17/10/2026). As UVs são as mesmas do molde: o braço usa o MESMO
 * material (cor, estampa, padrão) do resto. `braco`/`bracoPele` ficam no
 * espaço do grupo do braço (pivô no ombro); `posicao`/`rotacao` posicionam
 * esse grupo.
 */
export type BracoSeparado = {
  lado: 1 | -1;
  braco: BufferGeometry | null;
  bracoPele: BufferGeometry | null;
  posicao: [number, number, number];
  rotacao: [number, number, number];
};

/** A peça sem os braços pedidos (`resto`) e cada braço solto, na ordem pedida. */
export type PecaSeparada = {
  resto: BufferGeometry;
  restoPele: BufferGeometry | null;
  bracos: BracoSeparado[];
};

type Entrada = {
  chave: string;
  forma: Forma;
  peca: Peca;
  q: Qualidade;
  pose: PoseAvatar;
  liso: MeshStandardMaterial;
  material: MeshStandardMaterial | null;
  texturas: CanvasTexture[];
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
  ouvintes: Set<() => void>;
  cancelar?: () => void;
  descartada: boolean;
};

const pecas = new Map<string, Entrada>();
const formas = new Map<string, Forma>();
/** Chaves sem referência, da mais antiga para a mais nova (Set guarda a ordem de inserção). */
const ociosas = new Set<string>();
let aparada: ReturnType<typeof setTimeout> | null = null;

/** Tempos de pintura (ms) por chave, para medir o orçamento (≤ 17 ms a 512, ≤ 8 a 256). */
export const TEMPOS_DE_PINTURA: { chave: string; ms: number }[] = [];

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** A forma depende só dos blocos (tamanho, matriz) e da densidade — nunca da cor. */
function chaveDaForma(tipo: string, p: Peca, px: number, q: Qualidade): string {
  const blocos = (lista: readonly ParteMolde[]) =>
    lista.map((x) => [
      x.nome,
      x.tam.map(r4),
      r4(x.raio),
      x.ocultas,
      x.semFaces,
      x.afunilar,
      x.livre,
      x.segCurva,
      x.matriz.elements.map(r4),
    ]);
  return JSON.stringify([
    tipo,
    px,
    q,
    blocos(p.partes),
    blocos(p.aneis ?? []),
    p.livres,
    (p.pele ?? []).map((b) => [b.tam.map(r4), r4(b.raio), b.matriz.elements.map(r4)]),
  ]);
}

/** Curva fina não precisa de 4 segmentos: economiza triângulo nas tiras e painéis. */
function segmentos(raio: number, q: Qualidade, pedido?: number): number {
  if (pedido) return pedido;
  if (q === "alta") return raio >= 0.03 ? 4 : raio >= 0.012 ? 2 : 1;
  return raio >= 0.03 ? 2 : 1;
}

function geometriaDaParte(molde: Molde, p: ParteMolde, q: Qualidade): BufferGeometry {
  const uv = {} as Record<Face, RetUV>;
  if (p.livre) {
    const r = molde.livres[p.livre]!.uv;
    for (const f of ["px", "nx", "py", "ny", "pz", "nz"] as const) uv[f] = r;
  } else {
    const P = molde.partes[p.nome]!;
    for (const [f, F] of Object.entries(P.faces)) uv[f as Face] = F.uv;
  }
  const [w, h, d] = p.tam;
  return criarCaixaRoupa(w, h, d, p.raio, {
    uv,
    afunilar: p.afunilar,
    semFaces: p.semFaces,
    segCurva: segmentos(p.raio, q, p.segCurva),
  });
}

function construirForma(
  chave: string,
  peca: Peca,
  px: number,
  q: Qualidade,
  pose: PoseAvatar,
): Forma {
  const todas = [...peca.partes, ...(peca.aneis ?? [])];
  const molde = montarMolde(todas, peca.livres, { pxPorMetro: px, margem: MARGEM[q] });
  const blocos = todas.map((p) => ({ geo: geometriaDaParte(molde, p, q), matriz: p.matriz }));
  const extras = Object.values(peca.extras?.(molde, pose) ?? {});
  const geo = juntarPorMaterial([...blocos, ...extras]);
  [...blocos, ...extras].forEach((b) => b.geo.dispose());
  let pele: BufferGeometry | null = null;
  if (peca.pele?.length) {
    const pedacos = peca.pele.map((b) => ({
      geo: criarCaixaRoupa(b.tam[0], b.tam[1], b.tam[2], b.raio, {
        segCurva: segmentos(b.raio, q),
      }),
      matriz: b.matriz,
    }));
    pele = juntarPorMaterial(pedacos);
    pedacos.forEach((b) => b.geo.dispose());
  }
  return { chave, molde, geo, pele, refs: 0 };
}

function anisotropia(gl: WebGLRenderer): number {
  return Math.min(8, gl.capabilities.getMaxAnisotropy());
}

function textura(c: HTMLCanvasElement, chave: string, gl: WebGLRenderer): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropia(gl);
  t.name = chave;
  return t;
}

/** Pinta o atlas (e a máscara do brilho) e cria o material com `map` no construtor. */
function pintar(e: Entrada, gl: WebGLRenderer) {
  if (e.descartada || e.material) return;
  const t0 = performance.now();
  const { peca, forma, q } = e;
  const mapa = textura(pintarMolde(forma.molde, peca.pintar, { qualidade: q }), e.chave, gl);
  e.texturas.push(mapa);
  // `map` já no construtor: o shader nasce com USE_MAP (nada de material reaproveitado).
  const params: MeshStandardMaterialParameters = {
    map: mapa,
    roughness: peca.rugosidade ?? 0.85,
    metalness: 0,
  };
  if (peca.emissivoFaixas && peca.mascara) {
    const masc = textura(
      pintarMolde(forma.molde, peca.mascara, { qualidade: q, escala: 0.25, mascara: true }),
      `${e.chave}|brilho`,
      gl,
    );
    e.texturas.push(masc);
    params.emissive = 0xffffff;
    params.emissiveIntensity = 0.15;
    params.emissiveMap = masc;
  }
  e.material = new MeshStandardMaterial(params);
  TEMPOS_DE_PINTURA.push({ chave: e.chave, ms: performance.now() - t0 });
  if (TEMPOS_DE_PINTURA.length > 200) TEMPOS_DE_PINTURA.shift();
  e.ouvintes.forEach((f) => f());
}

function descartar(chave: string) {
  const e = pecas.get(chave);
  if (!e || e.refs > 0) return;
  pecas.delete(chave);
  ociosas.delete(chave);
  clearTimeout(e.timer);
  e.descartada = true;
  e.cancelar?.();
  e.texturas.forEach((t) => t.dispose());
  e.material?.dispose();
  e.liso.dispose();
  const f = e.forma;
  if (--f.refs <= 0) {
    formas.delete(f.chave);
    f.geo.dispose();
    f.pele?.dispose();
    f.separadas?.forEach(descartarSeparado);
  }
}

/**
 * `soltou`: a última referência acabou de sair (troca de cor no provador).
 * Só então a peça entra na fila das ociosas: na CRIAÇÃO não, porque 10
 * avatares montando no mesmo render criam 30 entradas antes de qualquer
 * effect reter — o limite descartaria peças que estão para ser usadas.
 */
function agendarDescarte(e: Entrada, soltou = false) {
  clearTimeout(e.timer);
  e.timer = setTimeout(() => descartar(e.chave), ESPERA_MS);
  if (!soltou) return;
  // Vira a ociosa mais nova; o excesso sai na próxima "aparada".
  ociosas.delete(e.chave);
  ociosas.add(e.chave);
  if (ociosas.size > MAX_OCIOSAS && !aparada) aparada = setTimeout(aparar, 1000);
}

/**
 * Descarta as ociosas mais antigas além do limite. Roda 1 s depois, não na
 * hora: no modo estrito do React (dev) os effects desmontam e remontam em
 * seguida, e quem foi retido de novo nesse meio-tempo já saiu da fila.
 */
function aparar() {
  aparada = null;
  while (ociosas.size > MAX_OCIOSAS) {
    const velha = ociosas.values().next().value as string;
    ociosas.delete(velha);
    descartar(velha);
  }
}

/** Alguém passou a usar a peça: sai da fila de descarte. */
function reter(e: Entrada) {
  e.refs++;
  clearTimeout(e.timer);
  ociosas.delete(e.chave);
}

function obter(
  chave: string,
  tipo: string,
  criar: () => Peca,
  q: Qualidade,
  pose: PoseAvatar,
  gl: WebGLRenderer,
  adiar: boolean,
): Entrada {
  let e = pecas.get(chave);
  if (e) return e;
  const peca = criar();
  const px = PX_POR_METRO[q];
  const cf = chaveDaForma(tipo, peca, px, q);
  let forma = formas.get(cf);
  if (!forma) {
    forma = construirForma(cf, peca, px, q, pose);
    formas.set(cf, forma);
  }
  forma.refs++;
  e = {
    chave,
    forma,
    peca,
    q,
    pose,
    liso: new MeshStandardMaterial({ color: peca.corBase, roughness: peca.rugosidade ?? 0.85 }),
    material: null,
    texturas: [],
    refs: 0,
    ouvintes: new Set(),
    descartada: false,
  };
  pecas.set(chave, e);
  agendarDescarte(e);
  const alvo = e;
  if (adiar) alvo.cancelar = enfileirar(chave, () => pintar(alvo, gl));
  else pintar(alvo, gl);
  return e;
}

export type PecaPronta = {
  geo: BufferGeometry;
  pele: BufferGeometry | null;
  material: MeshStandardMaterial;
  pronta: boolean;
  /** Identifica a forma (geometria) — muda só quando a forma muda. */
  forma: string;
  /** Só com `separar`: a peça com o(s) braço(s) solto(s). */
  separado: PecaSeparada | null;
};

/**
 * Pede a versão com os braços `lados` soltos (−1 direito, 1 esquerdo do
 * boneco): `[1]` o aceno, `[-1, 1]` os dois (reação "bravo", 17/10/2026).
 */
export type SepararBraco = { lados: readonly (1 | -1)[]; m: Medidas };

/**
 * A peça pronta para `chave` (que deve conter TUDO o que muda o desenho:
 * tipo, cores, estampa, corpo, pose). `criar` só roda se não houver cache.
 */
export function usePeca(
  chave: string,
  tipo: string,
  criar: () => Peca,
  q: Qualidade,
  pose: PoseAvatar,
  separar?: SepararBraco,
): PecaPronta {
  const gl = useThree((s) => s.gl);
  const frameloop = useThree((s) => s.frameloop);
  // Com frameloop "demand" não há frame garantido para drenar a fila: pinta já.
  const adiar = q === "media" && frameloop !== "demand";
  useDrenarFila();
  const k = `${chave}|${PX_POR_METRO[q]}`;
  const e = useMemo(
    () => obter(k, tipo, criar, q, pose, gl, adiar),
    // `criar` muda a cada render; a chave é que manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [k],
  );
  // Sem `separar` (sala, provador) nada disto roda: a malha é a de sempre.
  // Os lados viram texto: um array novo a cada render não pode refazer o memo.
  const ladosSep = separar?.lados.length ? separar.lados.join(",") : "";
  const mSep = separar?.m;
  const separado = useMemo(
    () =>
      ladosSep && mSep
        ? obterSeparado(
            e,
            mSep,
            ladosSep.split(",").map((l): 1 | -1 => (l === "1" ? 1 : -1)),
          )
        : null,
    [e, ladosSep, mSep],
  );
  const [, forcar] = useReducer((x: number) => x + 1, 0);
  const prontaNoRender = useRef(false);
  prontaNoRender.current = !!e.material;
  useEffect(() => {
    reter(e);
    const ouvir = () => forcar();
    e.ouvintes.add(ouvir);
    // Pintou entre o render e este effect: atualiza já.
    if (e.material && !prontaNoRender.current) forcar();
    return () => {
      e.ouvintes.delete(ouvir);
      e.refs--;
      if (e.refs <= 0) agendarDescarte(e, true);
    };
  }, [e]);
  return {
    geo: e.forma.geo,
    pele: e.forma.pele,
    material: e.material ?? e.liso,
    pronta: !!e.material,
    forma: e.forma.chave,
    separado,
  };
}

/* ———————————— braço solto (aceno, 16/10/2026) ———————————— */

const _centro = new Vector3();
const _pos = new Vector3();
const _rot = new Quaternion();
const _esc = new Vector3();
const _euler = new Euler();

/**
 * Separa da forma os braços `lados`: cada bloco (parte, anel, extra, pele) cujo
 * CENTRO cai dentro de um braço, no espaço do ombro, vai para o grupo dele.
 * Funciona para toda parte de cima sem mexer nos construtores: só
 * `mangasEBracos`/`aneisDePunho` penduram blocos no braço (`e.braco`), e o
 * resto (tronco, painéis do casaco, babado dos ombros, saia, capuz) tem o
 * centro longe dele. Sem manga (regata, alcinha), o braço é só a pele.
 * Guardada na forma: duas pessoas acenando com a mesma forma dividem.
 */
function obterSeparado(e: Entrada, m: Medidas, lados: (1 | -1)[]): PecaSeparada {
  const f = e.forma;
  const chave = lados.join(",");
  const pronta = f.separadas?.get(chave);
  if (pronta) return pronta;
  const meia = m.bracoW / 2;
  const ombros = lados.map((lado) => {
    const pivo = esqueleto(m, e.pose).braco(lado);
    return { lado, pivo, inv: pivo.clone().invert() };
  });
  /** Em qual dos braços pedidos o bloco está (índice em `ombros`), ou −1. */
  const deQualBraco = (matriz: Matrix4) =>
    ombros.findIndex(({ inv }) => {
      _centro.setFromMatrixPosition(matriz).applyMatrix4(inv);
      return Math.abs(_centro.x) < meia && Math.abs(_centro.z) < meia && _centro.y < 0.07;
    });
  type Bloco = { geo: BufferGeometry; matriz: Matrix4 };
  const dividir = (blocos: Bloco[]) => {
    const resto: Bloco[] = [];
    const bracos: Bloco[][] = ombros.map(() => []);
    for (const b of blocos) {
      const i = deQualBraco(b.matriz);
      if (i >= 0)
        bracos[i]!.push({ geo: b.geo, matriz: ombros[i]!.inv.clone().multiply(b.matriz) });
      else resto.push(b);
    }
    const juntar = (l: Bloco[]) => (l.length ? juntarPorMaterial(l) : null);
    const r = { resto: juntar(resto), bracos: bracos.map(juntar) };
    blocos.forEach((b) => b.geo.dispose());
    return r;
  };

  const todas = [...e.peca.partes, ...(e.peca.aneis ?? [])];
  const roupa = dividir([
    ...todas.map((p) => ({ geo: geometriaDaParte(f.molde, p, e.q), matriz: p.matriz })),
    ...Object.values(e.peca.extras?.(f.molde, e.pose) ?? {}),
  ]);
  const pele = dividir(
    (e.peca.pele ?? []).map((b) => ({
      geo: criarCaixaRoupa(b.tam[0], b.tam[1], b.tam[2], b.raio, {
        segCurva: segmentos(b.raio, e.q),
      }),
      matriz: b.matriz,
    })),
  );
  if (!roupa.resto) throw new Error("separar braço: a peça ficou sem tronco");

  const sep: PecaSeparada = {
    resto: roupa.resto,
    restoPele: pele.resto,
    bracos: ombros.map(({ lado, pivo }, i) => {
      pivo.decompose(_pos, _rot, _esc);
      _euler.setFromQuaternion(_rot);
      return {
        lado,
        braco: roupa.bracos[i] ?? null,
        bracoPele: pele.bracos[i] ?? null,
        posicao: [_pos.x, _pos.y, _pos.z] as [number, number, number],
        rotacao: [_euler.x, _euler.y, _euler.z] as [number, number, number],
      };
    }),
  };
  if (!f.separadas) f.separadas = new Map();
  f.separadas.set(chave, sep);
  return sep;
}

function descartarSeparado(s: PecaSeparada) {
  s.resto.dispose();
  s.restoPele?.dispose();
  for (const b of s.bracos) {
    b.braco?.dispose();
    b.bracoPele?.dispose();
  }
}

/* ———————————— material da pele ———————————— */

type EntradaPele = {
  mat: MeshStandardMaterial;
  refs: number;
  timer?: ReturnType<typeof setTimeout>;
};
const peles = new Map<string, EntradaPele>();

/** Um material por cor de pele, compartilhado (antebraços, canelas, pescoço vestido). */
export function useMaterialPele(cor: string): MeshStandardMaterial {
  const e = useMemo(() => {
    let x = peles.get(cor);
    if (!x) {
      const novo: EntradaPele = {
        mat: new MeshStandardMaterial({ color: cor, roughness: 0.6 }),
        refs: 0,
      };
      peles.set(cor, novo);
      x = novo;
      const criado = novo;
      criado.timer = setTimeout(() => soltarPele(cor, criado), ESPERA_MS);
    }
    return x;
  }, [cor]);
  useEffect(() => {
    e.refs++;
    clearTimeout(e.timer);
    return () => {
      e.refs--;
      if (e.refs <= 0) {
        clearTimeout(e.timer);
        e.timer = setTimeout(() => soltarPele(cor, e), ESPERA_MS);
      }
    };
  }, [cor, e]);
  return e.mat;
}

function soltarPele(cor: string, e: EntradaPele) {
  if (e.refs > 0 || peles.get(cor) !== e) return;
  peles.delete(cor);
  e.mat.dispose();
}

/* ———————————— medição (ferramentas de orçamento, fora do render) ———————————— */

/** Triângulos, atlas e tempo de pintura de uma peça, sem cache (para medir o orçamento). */
export function medirPeca(
  peca: Peca,
  q: Qualidade,
  pose: PoseAvatar,
): {
  triangulos: number;
  trianguloPele: number;
  atlas: [number, number];
  msPintura: number;
  /** Caixa da roupa no espaço do avatar (conferir o contrato de espaço com o cabelo). */
  caixa: { min: [number, number, number]; max: [number, number, number] };
} {
  const forma = construirForma("medir", peca, PX_POR_METRO[q], q, pose);
  const tri = (g: BufferGeometry | null) =>
    g ? (g.index ? g.index.count : g.getAttribute("position").count) / 3 : 0;
  const t0 = performance.now();
  pintarMolde(forma.molde, peca.pintar, { qualidade: q });
  const msPintura = performance.now() - t0;
  const r = {
    triangulos: tri(forma.geo),
    trianguloPele: tri(forma.pele),
    atlas: [forma.molde.largura, forma.molde.altura] as [number, number],
    msPintura,
    caixa: {
      min: forma.geo.boundingBox!.min.toArray() as [number, number, number],
      max: forma.geo.boundingBox!.max.toArray() as [number, number, number],
    },
  };
  forma.geo.dispose();
  forma.pele?.dispose();
  return r;
}
