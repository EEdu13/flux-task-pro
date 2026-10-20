import { RoundedBox } from "@react-three/drei";
import type { CanvasTexture } from "three";

/** Bloco de canto arredondado — a peça básica do boneco (corpo, chapéus, enfeites). */
export function Bloco({
  tam,
  pos = [0, 0, 0],
  cor,
  raio = 0.05,
  mapa,
  rot,
  brilho = 0.55,
}: {
  tam: [number, number, number];
  pos?: [number, number, number];
  cor: string;
  raio?: number;
  mapa?: CanvasTexture | null;
  rot?: [number, number, number];
  brilho?: number;
}) {
  return (
    <RoundedBox
      args={tam}
      position={pos}
      rotation={rot}
      radius={Math.min(raio, Math.min(...tam) / 2 - 0.001)}
      smoothness={4}
      castShadow
    >
      <meshStandardMaterial
        color={mapa ? "#ffffff" : cor}
        map={mapa ?? undefined}
        roughness={brilho}
      />
    </RoundedBox>
  );
}
