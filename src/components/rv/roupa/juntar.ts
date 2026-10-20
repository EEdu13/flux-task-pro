import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Junta as partes de UM material (já transformadas para o espaço do avatar)
 * numa geometria só: o corpo é estático por pose, então tronco, mangas,
 * anéis e capuz de uma peça viram 1 draw call em vez de 10.
 *
 * O `mergeGeometries` exige o mesmo conjunto de atributos e todas indexadas
 * (ou nenhuma): ExtrudeGeometry não é indexada e o toro tem atributos a
 * mais, então cada uma é normalizada antes (só position, normal e uv).
 */
export function juntarPorMaterial(
  partes: readonly { geo: BufferGeometry; matriz: Matrix4 }[],
): BufferGeometry {
  const prontas = partes.map(({ geo, matriz }) => {
    const g = new BufferGeometry();
    for (const nome of ["position", "normal", "uv"] as const) {
      const a = geo.getAttribute(nome);
      if (!a) throw new Error(`juntar: geometria sem ${nome}`);
      g.setAttribute(nome, (a as BufferAttribute).clone());
    }
    if (geo.index) g.setIndex(geo.index.clone());
    else g.setIndex(Array.from({ length: geo.getAttribute("position").count }, (_, i) => i));
    g.applyMatrix4(matriz);
    return g;
  });
  const junta = mergeGeometries(prontas, false);
  prontas.forEach((g) => g.dispose());
  if (!junta) throw new Error("juntar: atributos incompatíveis");
  junta.computeBoundingSphere();
  junta.computeBoundingBox();
  return junta;
}

/** Junta várias geometrias já no espaço do avatar (a pele das 3 peças). */
export function juntarProntas(geos: readonly BufferGeometry[]): BufferGeometry | null {
  if (!geos.length) return null;
  return juntarPorMaterial(geos.map((geo) => ({ geo, matriz: new Matrix4() })));
}
