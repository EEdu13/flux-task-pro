import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DoubleSide, MeshStandardMaterial, type Group } from "three";
import { ContextoDoAvatar } from "@/components/rv/contexto-avatar";
import { texturaChapeu } from "@/components/rv/cabelo-texturas";
import {
  corDaPeca,
  pecasDoChapeuNovo,
  type CtxChapeuNovo,
  type PecaChapeu,
} from "@/components/rv/cabelo-chapeus-novos";

/*
 * Os chapéus e enfeites novos do catálogo (16/10/2026), montados pelas peças
 * de `cabelo-chapeus-novos.ts`: uma malha por cor/acabamento, a cor do chapéu
 * (`corChapeu`) nas peças "" (e nas escurecidas/clareadas), e a hélice do boné
 * girando em volta do próprio eixo.
 */

/** Uma peça: o material (cor, acabamento, textura) e, se for a hélice, o giro. */
function Peca({ peca, corChapeu }: { peca: PecaChapeu; corChapeu: string }) {
  const gl = useThree((s) => s.gl);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: peca.textura ? texturaChapeu(peca.textura, gl) : null,
        vertexColors: true,
        roughness: peca.rugosidade,
        metalness: peca.metal,
        side: DoubleSide,
      }),
    [peca, gl],
  );
  const cor = corDaPeca(peca.cor, corChapeu);
  useLayoutEffect(() => {
    material.color.set(cor);
    material.emissive.set(peca.brilho > 0 ? cor : "#000000");
    material.emissiveIntensity = peca.brilho;
  }, [material, cor, peca.brilho]);
  useEffect(() => () => material.dispose(), [material]);
  const giro = useRef<Group>(null);
  useFrame((_, dt) => {
    if (peca.giro && giro.current) giro.current.rotation.y += peca.giro.vel * Math.min(dt, 0.1);
  });
  if (peca.giro)
    return (
      <group position={peca.giro.pivo}>
        <group ref={giro}>
          <mesh geometry={peca.geo} material={material} castShadow />
        </group>
      </group>
    );
  return <mesh geometry={peca.geo} material={material} castShadow />;
}

/** Um chapéu novo (null se o tipo não é dos novos). */
export function ChapeuNovo({
  tipo,
  cor,
  t,
  ctx,
}: {
  tipo: string;
  cor: string;
  t: number;
  ctx: CtxChapeuNovo;
}) {
  const { qualidade } = useContext(ContextoDoAvatar);
  const { corte, alturaCab, largTopo, largLado } = ctx;
  const pecas = useMemo(
    () =>
      pecasDoChapeuNovo(tipo, t, { corte, alturaCab, largTopo, largLado }, qualidade === "alta"),
    [tipo, t, corte, alturaCab, largTopo, largLado, qualidade],
  );
  useEffect(() => () => pecas?.forEach((p) => p.geo.dispose()), [pecas]);
  if (!pecas) return null;
  return (
    <group>
      {pecas.map((p, i) => (
        <Peca key={i} peca={p} corChapeu={cor} />
      ))}
    </group>
  );
}
