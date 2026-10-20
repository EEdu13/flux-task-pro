/*
 * Peças pequenas do escritório (17/10/2026): o bloco arredondado, a caneca,
 * a bagunça de papel de quem está ocupado, os papéis voando e a bolinha da
 * situação. As salas em si (divisórias, mesas, cadeiras) estão em
 * `acabamento.tsx`.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type { Group } from "three";

type V3 = [number, number, number];

/** Bloco arredondado com sombra — a peça básica de tudo aqui. */
export function Caixa({
  tam,
  pos = [0, 0, 0],
  cor,
  raio = 0.03,
  rot,
  brilho = 0.65,
  emissivo,
  sombra = true,
}: {
  tam: V3;
  pos?: V3;
  cor: string;
  raio?: number;
  rot?: V3;
  brilho?: number;
  emissivo?: string;
  sombra?: boolean;
}) {
  return (
    <RoundedBox
      args={tam}
      position={pos}
      rotation={rot}
      radius={Math.min(raio, Math.min(...tam) / 2 - 0.001)}
      smoothness={3}
      castShadow={sombra}
      receiveShadow
    >
      <meshStandardMaterial
        color={cor}
        roughness={brilho}
        emissive={emissivo ?? "#000000"}
        emissiveIntensity={emissivo ? 0.9 : 0}
      />
    </RoundedBox>
  );
}

/* ————————————————— Situação e o que fica na mesa ————————————————— */

export type Situacao = "disponivel" | "ocupado" | "ausente" | "offline";

export const COR_DA_SITUACAO: Record<Situacao, string> = {
  disponivel: "#22c55e",
  ocupado: "#ef4444",
  ausente: "#f59e0b",
  offline: "#94a3b8",
};

/** A mesa de quem está ocupado: torres de papel, mais canecas, pasta aberta. */
export function Bagunca({ w, zc, topo }: { w: number; zc: number; topo: number }) {
  const torres: { x: number; z: number; n: number; cor: string }[] = [
    { x: -w / 2 + 0.18, z: zc + 0.12, n: 7, cor: "#f8fafc" },
    { x: -w / 2 + 0.36, z: zc + 0.02, n: 4, cor: "#fef3c7" },
    { x: w / 2 - 0.25, z: zc - 0.05, n: 9, cor: "#f8fafc" },
  ];
  return (
    <group>
      {torres.map((t, i) =>
        Array.from({ length: t.n }, (_, k) => (
          <Caixa
            key={`${i}-${k}`}
            tam={[0.21, 0.035, 0.28]}
            pos={[t.x + Math.sin(k * 1.7 + i) * 0.015, topo + 0.018 + k * 0.036, t.z]}
            rot={[0, Math.sin(k * 2.3 + i) * 0.18, 0]}
            cor={k % 3 === 2 ? "#bfdbfe" : t.cor}
            raio={0.008}
            sombra={k === t.n - 1}
          />
        )),
      )}
      <Caneca pos={[w / 2 - 0.45, topo, zc + 0.15]} cor="#f97316" />
      <Caneca pos={[w / 2 - 0.55, topo, zc - 0.12]} cor="#a855f7" />
      <Caixa
        tam={[0.3, 0.02, 0.22]}
        pos={[0.05, topo + 0.01, zc + 0.12]}
        rot={[0, 0.4, 0]}
        cor="#fca5a5"
        raio={0.006}
      />
    </group>
  );
}

export function Caneca({ pos, cor }: { pos: V3; cor: string }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.055, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.036, 0.11, 14]} />
        <meshStandardMaterial color={cor} roughness={0.5} />
      </mesh>
      <mesh position={[0.045, 0.06, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.025, 0.008, 6, 12]} />
        <meshStandardMaterial color={cor} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.106, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.034, 14]} />
        <meshStandardMaterial color="#5b3a1e" roughness={0.3} />
      </mesh>
    </group>
  );
}

/* ————————————————— Coisas que mexem ————————————————— */

/** Papéis voando em volta da cabeça de quem está ocupado. */
export function PapeisVoando({ altura }: { altura: number }) {
  const grupo = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = grupo.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.y = t * 1.6;
    g.children.forEach((f, i) => {
      f.position.y = altura + 0.12 * Math.sin(t * 3 + i * 2.1);
      f.rotation.z = Math.sin(t * 4 + i) * 0.5;
    });
  });
  return (
    <group ref={grupo}>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.45, altura, Math.sin(a) * 0.45]} rotation-y={-a}>
            <planeGeometry args={[0.16, 0.21]} />
            <meshStandardMaterial color={i % 2 ? "#f8fafc" : "#fef9c3"} side={2} roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A bolinha da situação flutuando sobre a cabeça. */
export function BolinhaDeSituacao({ situacao, altura }: { situacao: Situacao; altura: number }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = altura + Math.sin(t * 2) * 0.03;
    const pulso = situacao === "ocupado" ? 1 + 0.18 * Math.sin(t * 7) : 1;
    ref.current.scale.setScalar(pulso);
  });
  return (
    <group ref={ref} position={[0, altura, 0]}>
      <mesh>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshStandardMaterial
          color={COR_DA_SITUACAO[situacao]}
          emissive={COR_DA_SITUACAO[situacao]}
          emissiveIntensity={0.7}
          roughness={0.3}
        />
      </mesh>
    </group>
  );
}
