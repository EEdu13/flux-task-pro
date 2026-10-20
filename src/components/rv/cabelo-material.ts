import {
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  type Material,
  type Mesh,
  type WebGLRenderer,
} from "three";
import type { Qualidade } from "@/components/rv/contexto-avatar";
import {
  texturaBrilho,
  texturaCachos,
  texturaFios,
  texturaFiosAnel,
} from "@/components/rv/cabelo-texturas";

/*
 * O material do cabelo (e da barba 3D). A cor NÃO está na geometria: o
 * atributo `color` guarda r = tom e g = máscara de mecha, e o shader mistura
 * as duas cores do avatar (uniforms) — trocar a cor só mexe no uniform.
 *
 * Também faz o "pescoço flexível": o cabelo comprido que desce até o tronco
 * gira AO CONTRÁRIO do giro da cabeça, na medida do atributo `peso` (0 ao
 * lado da cabeça, 1 no tronco), para não atravessar o corpo quando a cabeça
 * balança. A cabeça usa Euler XYZ e só gira em y (a) e z (b): a inversa é
 * Rz(−b)·Ry(−a).
 */

export type UniformsCabelo = {
  uCor: { value: Color };
  uCorMechas: { value: Color };
  uGiro: { value: Vector2 };
};

type ComUniforms = Material & { userData: { u?: UniformsCabelo } };

const DECL_VERTEX = /* glsl */ `
attribute float peso;
uniform vec2 uGiro;
mat3 giroInverso(float p) {
  float a = -uGiro.x * p;
  float b = -uGiro.y * p;
  float ca = cos(a); float sa = sin(a);
  float cb = cos(b); float sb = sin(b);
  mat3 ry = mat3(ca, 0.0, -sa,  0.0, 1.0, 0.0,  sa, 0.0, ca);
  mat3 rz = mat3(cb, sb, 0.0,  -sb, cb, 0.0,  0.0, 0.0, 1.0);
  return rz * ry;
}
`;

const DECL_FRAGMENT = /* glsl */ `
uniform vec3 uCor;
uniform vec3 uCorMechas;
`;

/** Lê a rotação do grupo da cabeça (pai do grupo do cabelo) logo antes de desenhar: sem atraso de frame. */
export function ligarGiro(mesh: Mesh) {
  mesh.onBeforeRender = () => {
    const u = (mesh.material as ComUniforms).userData.u;
    const cab = mesh.parent?.parent;
    if (!u || !cab) return;
    u.uGiro.value.set(cab.rotation.y, cab.rotation.z);
  };
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const passo = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A cor que o shader usa para a cor escolhida no editor (HSL lido em sRGB, o
 * espaço do seletor). A luz da cena e o tom-mapping ACES escurecem o cabelo
 * bem mais que a pele (fita de lado, verso, raiz): sem compensar, o loiro
 * saía cáqui-escuro e o castanho quase preto. Então:
 * - claros (L > 0,55): matiz dos loiros (18°–58°) puxado para ~28° (o pêssego
 *   das refs 59/60), −15% de saturação e ganho de luz;
 * - castanhos e escuros (L 0,13–0,5): até +0,19 de luz e −20% de saturação,
 *   para os fios aparecerem (o castanho da ref. 58 é pouco saturado);
 * - pretos (L < 0,13): carvão quase neutro em L 0,29 — o reflexo cinza da
 *   ref. 53 vem do material (especular), não de clarear a base.
 */
export function corDoCabelo(hex: string, mechas = false): Color {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl, SRGBColorSpace);
  let { h, s, l } = hsl;
  const graus = h * 360;
  let ganho = 1;
  if (l > 0.55) {
    if (graus > 18 && graus < 58) h = (graus + (27 - graus) * 0.85) / 360;
    // a mecha clara GANHA saturação (a luz forte e o ACES a desbotam): a mecha loira da
    // ref. 58 é pêssego, não bege-cinza
    s = mechas ? Math.min(1, s * 1.25) : s * 0.85;
    ganho = mechas ? 1 : 1.28 + 0.3 * passo(0.55, 0.8, l);
  } else if (l < 0.13) {
    l = 0.29;
    s *= 0.4;
  } else {
    l += 0.19 * (1 - passo(0.13, 0.5, l));
    // o castanho escuro perde mais saturação (o da ref. 58 é quase neutro); o ruivo, menos
    s *= lerp(0.62, 0.85, passo(0.15, 0.4, hsl.l));
    ganho = 1.12;
  }
  c.setHSL(h, s, l, SRGBColorSpace);
  return c.multiplyScalar(ganho);
}

const BRANCO = new Color(1, 1, 1);

export type OpcoesMaterial = {
  qualidade: Qualidade;
  cachos: boolean;
  /** Anel de brilho pintado (anime). */
  anel: boolean;
  gl: WebGLRenderer;
};

export function criarMaterialCabelo(o: OpcoesMaterial): MeshStandardMaterial {
  const map = o.cachos ? texturaCachos(o.gl) : o.anel ? texturaFiosAnel(o.gl) : texturaFios(o.gl);
  const u: UniformsCabelo = {
    uCor: { value: new Color(0.2, 0.15, 0.1) },
    uCorMechas: { value: new Color(1, 1, 1) },
    uGiro: { value: new Vector2() },
  };
  const comum = {
    vertexColors: true,
    map,
    color: new Color(1.45, 1.45, 1.45),
    roughness: o.qualidade === "alta" ? 0.4 : 0.5,
    metalness: 0,
    side: DoubleSide,
  };
  const mat: MeshStandardMaterial =
    o.qualidade === "alta"
      ? new MeshPhysicalMaterial({
          ...comum,
          anisotropy: 0.8,
          anisotropyRotation: 0,
          specularIntensity: 1,
          // F0 ~0,08 (o dobro do padrão): o brilho que corre pela mecha aparece até no preto
          ior: 1.8,
          // O especular sozinho quase não aparece no cabelo preto (F0 4%): o anel de brilho
          // somado (como no lab aprovado, "aniso+pintado") garante o reflexo ≥ #4a4a4a.
          emissiveMap: o.cachos ? null : texturaBrilho(o.gl),
          emissive: new Color(0, 0, 0),
        })
      : new MeshStandardMaterial({
          ...comum,
          // brilho somado (anel serrilhado) na média: no cabelo escuro, multiplicar não aparece
          emissiveMap: o.cachos ? null : texturaBrilho(o.gl),
          emissive: new Color(0, 0, 0),
        });
  mat.userData.u = u;
  mat.onBeforeCompile = (shader) => {
    // o objeto dos uniforms é reatribuído a cada compilação (o three recria o shader ao mudar luzes)
    const uu = (mat as ComUniforms).userData.u!;
    shader.uniforms.uCor = uu.uCor;
    shader.uniforms.uCorMechas = uu.uCorMechas;
    shader.uniforms.uGiro = uu.uGiro;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + DECL_VERTEX)
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        mat3 giroCabelo = giroInverso(peso);
        objectNormal = giroCabelo * objectNormal;
        #ifdef USE_TANGENT
        objectTangent = giroCabelo * objectTangent;
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n transformed = giroInverso(peso) * transformed;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + DECL_FRAGMENT)
      .replace(
        "#include <color_fragment>",
        "diffuseColor.rgb *= mix(uCor, uCorMechas, vColor.g) * vColor.r;",
      );
  };
  const q = o.qualidade;
  mat.customProgramCacheKey = () => "cabelo-v3-" + q;
  return mat;
}

/** Atualiza as cores (sem recriar material nem geometria). */
export function definirCores(mat: MeshStandardMaterial, cor: string, corMechas: string) {
  const u = (mat as ComUniforms).userData.u;
  if (!u) return;
  const base = corDoCabelo(cor);
  u.uCor.value.copy(base);
  u.uCorMechas.value.copy(corDoCabelo(corMechas, true));
  if (mat.emissiveMap) {
    const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
    const kk = 0.5 + (0.16 - 0.5) * Math.max(0, Math.min(1, lum / 0.35));
    // média: k ≤ 0,3 (a spec). Alta: 0,9·k sem teto (o "aniso + pintado" do laboratório usava
    // 0,6·k com a base mais clara) — é o anel que dá ao preto o reflexo cinza da ref. 53; só o
    // especular quase não aparece no preto
    mat.emissive
      .copy(base)
      .lerp(BRANCO, 0.55)
      .multiplyScalar(mat instanceof MeshPhysicalMaterial ? 0.9 * kk : Math.min(0.3, kk));
  }
}
