import { useEffect } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { useReducedMotion } from "framer-motion";
import { Canvas, useThree } from "@react-three/fiber";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { MEDIDAS } from "@/components/rv/medidas";
import { INSTANTE_PARADO, ROSTO_DO_GESTO, type Gesto } from "@/components/rv/poses-de-reacao";

/**
 * O boneco 3D do Wrapped do mês (19/10/2026). Fica montado durante a
 * sequência inteira — um <Canvas> só, e não um por tela: trocar de tela só
 * troca o gesto (e `chave` reinicia o relógio dele, para o mesmo gesto em
 * duas telas seguidas também recomeçar).
 *
 * Carregado sob demanda por `wrapped-telas.tsx`: three.js não entra no
 * pacote das outras telas. Com movimento reduzido, o boneco fica parado no
 * instante que resume o gesto, como na reação do avatar.
 */
export default function AvatarDoWrapped({
  config,
  gesto,
  chave,
}: {
  config: AvatarConfig;
  gesto: Gesto;
  chave: number;
}) {
  const reduzir = !!useReducedMotion();
  const reacao = gesto === "acenar" ? null : gesto;
  return (
    <SemTresD>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 1.3, 3.6], fov: 30 }}
        style={{ background: "transparent", pointerEvents: "none" }}
      >
        <Enquadrar avatar={config} />
        <hemisphereLight args={["#ffffff", "#9ca3af", 1.15]} />
        <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
        <directionalLight position={[-2, 2, -1]} intensity={0.4} />
        <Avatar3D
          config={config}
          pose="em-pe"
          mostrarNome={false}
          // O tchauzinho repete sozinho; com movimento reduzido, fica parado.
          gesto={reduzir && !reacao ? undefined : gesto}
          acenarChave={chave}
          gestoTempo={reduzir && reacao ? INSTANTE_PARADO[reacao] : undefined}
          expressaoForcada={reacao ? ROSTO_DO_GESTO[reacao] : undefined}
        />
      </Canvas>
    </SemTresD>
  );
}

/**
 * A câmera mirando o boneco dos joelhos até acima da cabeça, com folga para
 * os braços erguidos do "comemorar" — a mesma conta de
 * `reacao-de-avatar-cena.tsx` (o R3F aponta a câmera para o chão por padrão).
 */
function Enquadrar({ avatar }: { avatar: AvatarConfig }) {
  const { camera, size } = useThree();
  const m = MEDIDAS[avatar.corpo];
  useEffect(() => {
    const topo = m.pernaH + m.troncoH + 0.03 + m.cabeca + 0.3;
    const base = m.pernaH * 0.4;
    const meio = (topo + base) / 2;
    // fov 30: a altura visível é 2·d·tg(15°) ≈ 0,536·d; 8% de folga.
    const d = ((topo - base) * 1.08) / 0.536;
    camera.position.set(0, meio + 0.12, d);
    camera.lookAt(0, meio, 0);
    camera.updateProjectionMatrix();
  }, [camera, m, size.width, size.height]);
  return null;
}
