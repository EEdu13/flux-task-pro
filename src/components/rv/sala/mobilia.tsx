/*
 * Mesa oval, cadeiras de escritório e aparador.
 *
 * As cadeiras são CINCO InstancedMesh compartilhados por todas (assento,
 * encosto, coluna, pés da estrela e rodízios): com 10 cadeiras isso é 5 draw
 * calls em vez de ~130 — a sala divide o orçamento com os avatares.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  type InstancedMesh,
  Matrix4,
  Object3D,
  SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Lugar } from "./lugares";
import {
  ALTURA_TAMPO,
  APARADOR,
  ARO_DA_MESA,
  ASSENTO,
  COLUNA,
  COR_ARO,
  COR_BASE_CADEIRA,
  COR_ESTOFADO,
  COR_ESTOFADO_VAZIO,
  COR_MADEIRA,
  ENCOSTO,
  ESPESSURA_TAMPO,
  MAX_CADEIRAS,
  MESA_CENTRO_Z,
  MESA_RX,
  MESA_RZ,
  PE_DA_ESTRELA,
  PEDESTAL,
  RODIZIO_RAIO,
} from "./medidas-da-sala";

/* ───────── Mesa ───────── */

export function Mesa() {
  // Os dois pedestais numa geometria só (1 draw call, 1 sombra).
  const pedestais = useMemo(() => {
    const alto = ALTURA_TAMPO - ESPESSURA_TAMPO;
    const partes = [-1, 1].map((l) =>
      new BoxGeometry(PEDESTAL.largura, alto, PEDESTAL.profundidade).translate(
        PEDESTAL.x * l,
        alto / 2,
        0,
      ),
    );
    const g = mergeGeometries(partes);
    for (const p of partes) p.dispose();
    return g;
  }, []);
  useEffect(() => () => pedestais?.dispose(), [pedestais]);

  return (
    <group position={[0, 0, MESA_CENTRO_Z]}>
      {/* Tampo: cilindro unitário esticado na elipse; o TOPO fica em ALTURA_TAMPO. */}
      <mesh
        position={[0, ALTURA_TAMPO - ESPESSURA_TAMPO / 2, 0]}
        scale={[MESA_RX, 1, MESA_RZ]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, ESPESSURA_TAMPO, 96]} />
        <meshStandardMaterial color={COR_MADEIRA} roughness={0.45} />
      </mesh>
      {/* Aro escuro: só a casca (openEnded), 2 cm para fora do tampo. */}
      <mesh
        position={[0, ALTURA_TAMPO - ESPESSURA_TAMPO / 2 - 0.001, 0]}
        scale={[MESA_RX + ARO_DA_MESA, 1, MESA_RZ + ARO_DA_MESA]}
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, ESPESSURA_TAMPO + 0.002, 96, 1, true]} />
        <meshStandardMaterial color={COR_ARO} roughness={0.5} />
      </mesh>
      {pedestais && (
        <mesh geometry={pedestais} castShadow receiveShadow>
          <meshStandardMaterial color={COR_ARO} roughness={0.6} />
        </mesh>
      )}
    </group>
  );
}

/* ───────── Cadeiras ───────── */

export type CadeiraNaSala = {
  lugar: Lugar;
  ocupada: boolean;
  /** "Cadeira a gás" (m): assento e encosto sobem/descem com o avatar. */
  elevacao: number;
};

const PES = 5;
const BASE_Y = 0.06;
const cor = new Color();
const aux = new Object3D();
const pai = new Matrix4();

export function Cadeiras({ cadeiras }: { cadeiras: CadeiraNaSala[] }) {
  const assento = useRef<InstancedMesh>(null);
  const encosto = useRef<InstancedMesh>(null);
  const coluna = useRef<InstancedMesh>(null);
  const pes = useRef<InstancedMesh>(null);
  const rodizios = useRef<InstancedMesh>(null);

  const geo = useMemo(
    () => ({
      assento: new RoundedBoxGeometry(ASSENTO.w, ASSENTO.h, ASSENTO.d, 3, ASSENTO.raio),
      encosto: new RoundedBoxGeometry(ENCOSTO.w, ENCOSTO.h, ENCOSTO.d, 3, 0.025),
      // Altura 1: a escala Y de cada instância vira a altura real (muda com o gás).
      coluna: new CylinderGeometry(COLUNA.raio, COLUNA.raio, 1, 12).translate(0, 0.5, 0),
      // O pé sai do centro para +z; cada instância gira 72°.
      pe: new BoxGeometry(
        PE_DA_ESTRELA.largura,
        PE_DA_ESTRELA.altura,
        PE_DA_ESTRELA.comprimento,
      ).translate(0, 0, PE_DA_ESTRELA.comprimento / 2),
      rodizio: new SphereGeometry(RODIZIO_RAIO, 10, 8),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(geo)) g.dispose();
    },
    [geo],
  );

  useLayoutEffect(() => {
    const ms = [assento.current, encosto.current, coluna.current, pes.current, rodizios.current];
    if (ms.some((m) => !m)) return;
    const n = Math.min(MAX_CADEIRAS, cadeiras.length);
    cadeiras.slice(0, n).forEach((c, i) => {
      const { lugar: l, elevacao: e } = c;
      aux.position.set(l.x, 0, l.z);
      aux.rotation.set(0, l.rotY, 0);
      aux.scale.set(1, 1, 1);
      aux.updateMatrix();
      pai.copy(aux.matrix);

      const local = (x: number, y: number, z: number, rx: number, ry: number, sy = 1) => {
        aux.position.set(x, y, z);
        aux.rotation.set(rx, ry, 0);
        aux.scale.set(1, sy, 1);
        aux.updateMatrix();
        return aux.matrix.premultiply(pai);
      };
      assento.current!.setMatrixAt(i, local(0, ASSENTO.y + e, 0, 0, 0));
      encosto.current!.setMatrixAt(i, local(0, ENCOSTO.y + e, ENCOSTO.z, ENCOSTO.giro, 0));
      const baseDoAssento = ASSENTO.y + e - ASSENTO.h / 2;
      coluna.current!.setMatrixAt(
        i,
        local(0, BASE_Y, 0, 0, 0, Math.max(0.05, baseDoAssento - BASE_Y)),
      );
      for (let p = 0; p < PES; p++) {
        const a = (p * Math.PI * 2) / PES;
        pes.current!.setMatrixAt(i * PES + p, local(0, BASE_Y, 0, 0, a));
        const r = PE_DA_ESTRELA.comprimento - 0.02;
        rodizios.current!.setMatrixAt(
          i * PES + p,
          local(Math.sin(a) * r, RODIZIO_RAIO, Math.cos(a) * r, 0, 0),
        );
      }
      cor.set(c.ocupada ? COR_ESTOFADO : COR_ESTOFADO_VAZIO);
      assento.current!.setColorAt(i, cor);
      encosto.current!.setColorAt(i, cor);
    });
    for (const m of [assento.current!, encosto.current!, coluna.current!]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    for (const m of [pes.current!, rodizios.current!]) {
      m.count = n * PES;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }, [cadeiras]);

  // args fixos (máximo de instâncias): mudar o número de cadeiras só mexe em `count`,
  // a árvore R3F não muda de forma.
  return (
    <group>
      <instancedMesh
        ref={assento}
        args={[geo.assento, undefined, MAX_CADEIRAS]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh
        ref={encosto}
        args={[geo.encosto, undefined, MAX_CADEIRAS]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={coluna} args={[geo.coluna, undefined, MAX_CADEIRAS]} castShadow>
        <meshStandardMaterial color={COR_BASE_CADEIRA} metalness={0.5} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={pes} args={[geo.pe, undefined, MAX_CADEIRAS * PES]} castShadow>
        <meshStandardMaterial color={COR_BASE_CADEIRA} metalness={0.4} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={rodizios} args={[geo.rodizio, undefined, MAX_CADEIRAS * PES]}>
        <meshStandardMaterial color="#111827" roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

/* ───────── Aparador (sob o telão) ───────── */

export function Aparador() {
  return (
    <group position={[0, 0, APARADOR.z]}>
      <mesh position={[0, APARADOR.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[APARADOR.w, APARADOR.h, APARADOR.d]} />
        <meshStandardMaterial color={APARADOR.cor} roughness={0.55} />
      </mesh>
    </group>
  );
}
