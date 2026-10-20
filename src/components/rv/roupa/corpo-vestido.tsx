import { useContext, useEffect, useMemo, type ReactNode, type RefObject } from "react";
import type { BufferGeometry, Group } from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { ContextoDoAvatar, type PoseAvatar } from "@/components/rv/contexto-avatar";
import type { Medidas } from "@/components/rv/medidas";
import { usePeca, useMaterialPele } from "./cache";
import { juntarProntas } from "./juntar";
import { chaveDeBaixo, pecaDeBaixo } from "./pecas-baixo";
import { PECAS_CIMA, chaveDeCima } from "./pecas-cima";
import { PECAS_PES, chaveDosPes } from "./pecas-pes";

/**
 * O corpo vestido: parte de cima, de baixo, calçado e a pele dos braços e
 * pernas — 4 malhas no total (uma por material), com geometria e material
 * vindos do cache. Nenhum elemento R3F troca de tipo aqui dentro (regra do
 * data-tsd-source); quem muda a ESTRUTURA é a `key` do `<CorpoVestido>` no
 * Avatar3D (roupa|calça|sapato|pose).
 *
 * Os números `quadrilY`, `ombroY` e `topo` vêm do Avatar3D só para conferir:
 * as peças recalculam o mesmo esqueleto (`peca.ts`) pela pose.
 *
 * `bracos` (aceno, 16/10/2026; reações, 17/10/2026): cada braço pedido sai
 * da malha da parte de cima (e da pele) e vira um grupo com pivô no ombro; o
 * Avatar3D gira o `ref` dele. `filhos` vão junto com o braço (o relógio).
 * Sem `bracos`, as 4 malhas de sempre (nada muda na sala nem no provador).
 */
/** Um braço que o Avatar3D quer girar: o lado, o grupo do ombro e o que vai junto. */
export type BracoSolto = { lado: 1 | -1; ref: RefObject<Group | null>; filhos?: ReactNode };

export function CorpoVestido({
  config,
  m,
  pose,
  bracos,
}: {
  config: AvatarConfig;
  m: Medidas;
  pose: PoseAvatar;
  quadrilY: number;
  ombroY: number;
  topo: number;
  bracos?: BracoSolto[];
}) {
  const { qualidade } = useContext(ContextoDoAvatar);
  const corpo = config.corpo;
  const cima = usePeca(
    `${chaveDeCima(config)}|${corpo}|${pose}`,
    `cima|${config.roupa}|${corpo}`,
    () => PECAS_CIMA[config.roupa](m, config, qualidade, pose),
    qualidade,
    pose,
    bracos?.length ? { lados: bracos.map((b) => b.lado), m } : undefined,
  );
  const sep = cima.separado;
  // Vestido/macacão: a parte de baixo vem da própria roupa (a calça guardada é ignorada).
  const deBaixo = pecaDeBaixo(config);
  const baixo = usePeca(
    `${chaveDeBaixo(config)}|${corpo}|${pose}`,
    `baixo|${deBaixo.tipo}|${corpo}`,
    () => deBaixo.criar(m, config, qualidade, pose),
    qualidade,
    pose,
  );
  const pes = usePeca(
    `${chaveDosPes(config)}|${corpo}|${pose}`,
    `pes|${config.sapato}|${corpo}`,
    () => PECAS_PES[config.sapato](m, config, qualidade, pose),
    qualidade,
    pose,
  );
  const materialPele = useMaterialPele(config.pele);

  // A pele das 3 peças (antebraço, canela, pé do chinelo) vira UMA malha.
  const fontes = [sep ? sep.restoPele : cima.pele, baixo.pele, pes.pele].filter(
    (g): g is BufferGeometry => !!g,
  );
  const geoPele = useMemo(
    () => juntarProntas(fontes),
    // as geometrias de pele só mudam junto com a forma de cada peça
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cima.forma, baixo.forma, pes.forma, sep],
  );
  useEffect(() => () => geoPele?.dispose(), [geoPele]);

  return (
    <group>
      <mesh
        key={cima.pronta ? "cima-pronto" : "cima-liso"}
        geometry={sep ? sep.resto : cima.geo}
        material={cima.material}
        castShadow
      />
      <mesh
        key={baixo.pronta ? "baixo-pronto" : "baixo-liso"}
        geometry={baixo.geo}
        material={baixo.material}
        castShadow
      />
      <mesh
        key={pes.pronta ? "pes-pronto" : "pes-liso"}
        geometry={pes.geo}
        material={pes.material}
        castShadow
      />
      {geoPele && <mesh key="pele" geometry={geoPele} material={materialPele} castShadow />}
      {sep &&
        bracos?.map((pedido, i) => {
          const b = sep.bracos[i];
          if (!b) return null;
          return (
            <group key={b.lado} position={b.posicao} rotation={b.rotacao}>
              <group ref={pedido.ref}>
                {b.braco && (
                  <mesh
                    key={cima.pronta ? "braco-pronto" : "braco-liso"}
                    geometry={b.braco}
                    material={cima.material}
                    castShadow
                  />
                )}
                {b.bracoPele && (
                  <mesh
                    key="braco-pele"
                    geometry={b.bracoPele}
                    material={materialPele}
                    castShadow
                  />
                )}
                {pedido.filhos}
              </group>
            </group>
          );
        })}
    </group>
  );
}
