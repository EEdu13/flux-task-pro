/*
 * Junta as peças PARADAS de um pedaço do andar em poucas malhas (18/10/2026:
 * "tá travando demais, esquentando o notebook").
 *
 * Cada parede, perfil, tampo, pé de mesa e monitor era uma malha — e cada
 * malha é um "desenho" por quadro para a placa de vídeo (mais um por quadro
 * de sombra). Um andar com 17 setores passava de 3.000. Aqui os filhos montam
 * normalmente uma vez, a gente lê todos, agrupa por material (mesma cor, mesma
 * textura…) e troca tudo por UMA malha por material. Uma sala vira ~15
 * desenhos.
 *
 * Só para o que não mexe: avatares, coisas animadas e <Html> ficam FORA.
 * Mudou alguma coisa (alguém saiu da mesa)? Troca a `chave` e ele junta de novo.
 */
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  type Material,
  Matrix4,
  Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type MaterialComum = MeshStandardMaterial & MeshBasicMaterial;

/** O que faz dois materiais desenharem igual. */
function chaveDoMaterial(m: Material): string {
  const x = m as MaterialComum;
  return [
    m.type,
    x.color?.getHexString() ?? "",
    x.map?.uuid ?? "",
    m.transparent ? 1 : 0,
    m.opacity.toFixed(2),
    m.side,
    m.depthWrite ? 1 : 0,
    x.roughness?.toFixed(2) ?? "",
    x.metalness?.toFixed(2) ?? "",
    x.emissive?.getHexString() ?? "",
    x.toneMapped ? 1 : 0,
  ].join("|");
}

/** Só posição, normal e UV (o que todas as peças têm), sem índice. */
function normalizar(geo: BufferGeometry, matriz: Matrix4): BufferGeometry {
  const base = geo.index ? geo.toNonIndexed() : geo.clone();
  const g = new BufferGeometry();
  g.setAttribute("position", base.getAttribute("position").clone());
  const normal = base.getAttribute("normal");
  if (normal) g.setAttribute("normal", normal.clone());
  else g.computeVertexNormals();
  const uv = base.getAttribute("uv");
  g.setAttribute(
    "uv",
    uv
      ? uv.clone()
      : new BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2),
  );
  g.applyMatrix4(matriz);
  if (base !== geo) base.dispose();
  return g;
}

function juntar(raiz: Group): Mesh[] {
  raiz.updateMatrixWorld(true);
  const inversa = new Matrix4().copy(raiz.matrixWorld).invert();
  const grupos = new Map<string, { material: Material; geos: BufferGeometry[]; sombra: boolean }>();
  const m = new Matrix4();
  raiz.traverse((o) => {
    const malha = o as Mesh;
    if (!malha.isMesh || !malha.visible || Array.isArray(malha.material)) return;
    const material = malha.material as Material;
    const chave = chaveDoMaterial(material);
    let g = grupos.get(chave);
    if (!g) {
      g = { material: material.clone(), geos: [], sombra: false };
      grupos.set(chave, g);
    }
    g.geos.push(normalizar(malha.geometry, m.multiplyMatrices(inversa, malha.matrixWorld)));
    g.sombra ||= malha.castShadow;
  });
  const saida: Mesh[] = [];
  for (const g of grupos.values()) {
    const geo = mergeGeometries(g.geos, false);
    for (const x of g.geos) x.dispose();
    if (!geo) continue;
    const malha = new Mesh(geo, g.material);
    malha.castShadow = g.sombra;
    malha.receiveShadow = true;
    // Vidro e transparências desenham depois do que é opaco.
    if (g.material.transparent) malha.renderOrder = 1;
    saida.push(malha);
  }
  return saida;
}

export function Estatico({
  chave,
  children,
  aoJuntar,
}: {
  chave: string;
  children: ReactNode;
  /** Avisa quando trocou (a sombra fixa precisa ser recalculada). */
  aoJuntar?: () => void;
}) {
  const raiz = useRef<Group>(null);
  const [juntas, setJuntas] = useState<{ chave: string; malhas: Mesh[] } | null>(null);
  const atual = juntas?.chave === chave ? juntas : null;

  // Com os filhos montados (chave nova), junta e troca.
  useLayoutEffect(() => {
    if (atual || !raiz.current) return;
    const malhas = juntar(raiz.current);
    setJuntas({ chave, malhas });
  }, [chave, atual]);

  // As malhas antigas saem da placa de vídeo quando são trocadas.
  useLayoutEffect(() => {
    if (!juntas) return;
    aoJuntar?.();
    return () => {
      for (const m of juntas.malhas) {
        m.geometry.dispose();
        (m.material as Material).dispose();
      }
    };
  }, [juntas, aoJuntar]);

  if (!atual) return <group ref={raiz}>{children}</group>;
  return <Malhas malhas={atual.malhas} />;
}

/**
 * Põe as malhas juntadas na cena direto no grupo, sem `<primitive>`: o plugin
 * de desenvolvimento marca todo elemento JSX com "data-tsd-source", e no
 * `<primitive>` o R3F tenta gravar isso na malha e quebra.
 */
function Malhas({ malhas }: { malhas: Mesh[] }) {
  const grupo = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const g = grupo.current;
    if (!g) return;
    for (const m of malhas) g.add(m);
    invalidate();
    return () => {
      for (const m of malhas) g.remove(m);
    };
  }, [malhas, invalidate]);
  return <group ref={grupo} />;
}
