import { useEffect, useState } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { Canvas, useThree } from "@react-three/fiber";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { Avatar3D } from "@/components/rv/avatar-3d";

/**
 * O avatar da pessoa na tela Início dando um pulinho e um tchauzinho
 * (16/10/2026). Um <Canvas> pequeno e transparente (cabe numa caixa de
 * ~170×200 px), enquadrado da cabeça aos joelhos com folga para a mão
 * erguida e o pulo. O boneco gira um pouco (3/4) para o braço que acena —
 * o esquerdo dele, à direita de quem olha — vir para a frente.
 *
 * Desempenho: dpr no máximo 1,5 e, com a aba escondida, o laço de frames
 * para (`frameloop="never"`). Sem `config` (ainda carregando, ou sem
 * avatar), não mostra nada.
 */
export function AvatarAcenando({
  config,
  className,
  humor = "normal",
}: {
  config: AvatarConfig | null | undefined;
  className?: string;
  /**
   * O humor da ofensiva (19/10/2026, como a coruja do Duolingo): triste quando
   * a sequência do pack quebrou — e aí ele não acena —, preocupado quando o
   * pack de hoje ainda está aberto no fim da tarde, feliz quando fechou.
   */
  humor?: "normal" | "feliz" | "preocupado" | "triste";
}) {
  const visivel = useAbaVisivel();
  if (!config) return null;
  return (
    <div className={className} aria-hidden>
      <SemTresD>
        <Canvas
          dpr={[1, 1.5]}
          frameloop={visivel ? "always" : "never"}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 1.15, 4.35], fov: 30 }}
          style={{ background: "transparent" }}
        >
          <Mirar />
          <hemisphereLight args={["#ffffff", "#9ca3af", 1.1]} />
          <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
          <directionalLight position={[-2, 2, -1]} intensity={0.4} />
          {/* Desloca um pouco para a esquerda: a mão erguida sai pela direita. */}
          <group position={[-0.12, -0.05, 0]} rotation-y={-0.28}>
            <Avatar3D
              config={config}
              pose="em-pe"
              mostrarNome={false}
              acenar={humor !== "triste"}
              expressaoForcada={
                humor === "triste"
                  ? "triste"
                  : humor === "preocupado"
                    ? "preocupado"
                    : humor === "feliz"
                      ? "festa"
                      : undefined
              }
            />
          </group>
        </Canvas>
      </SemTresD>
    </div>
  );
}

/* O R3F aponta a câmera padrão para a origem (o chão): o quadro mostrava das
   canelas para baixo e cortava a cabeça (16/10/2026). Aqui ela mira o meio
   do corpo (y 1,0), e da distância 4,35 cabe o corpo inteiro, dos sapatos
   (y 0) à mão erguida (~2,3 m), com folga para o pulinho. */
function Mirar() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1.0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

/** true enquanto a aba do navegador está à vista. */
function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const mudou = () => setVisivel(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", mudou);
    return () => document.removeEventListener("visibilitychange", mudou);
  }, []);
  return visivel;
}
