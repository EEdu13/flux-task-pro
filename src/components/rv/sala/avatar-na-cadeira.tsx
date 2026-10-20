/*
 * O ÚNICO uso do Avatar3D na sala.
 *
 * Por que concentrar aqui: a equipe do avatar vai entregar braços articulados
 * (props `gesto`, `bracoAoVivo`, `cabeca` — contrato no topo de `tipos.ts`).
 * Quando chegar, só este arquivo muda.
 *
 * Faz três coisas além de desenhar o boneco:
 * 1. MEDE o boneco montado (um quadro depois de montar e a cada troca de
 *    config): topo da cabeça (âncora dos selos/balões), a parte mais baixa da
 *    mão à frente do corpo e o que fica sob o tampo. A medição vence a fórmula de
 *    reserva (`topoDaCabecaReserva`) porque o Avatar3D muda sem avisar.
 * 2. "Cadeira a gás": sobe/desce o boneco (e a cadeira, na sala) para a mão
 *    pousar 1,5 cm acima do tampo sem o sapato furar o tampo.
 * 3. Entrada/saída: escala em 300 ms no useFrame (sem trocar key nem remontar).
 *    Opacidade não: os materiais do avatar são compartilhados entre bonecos
 *    (cache da roupa) e mexer neles apagaria os outros juntos.
 */
import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { type Group, type InstancedMesh, Matrix4, type Mesh, type Object3D, Vector3 } from "three";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { MEDIDAS } from "@/components/rv/medidas";
import type { AvatarConfig } from "@/lib/avatar-3d";
import type { Lugar } from "./lugares";
import { meuAvatarEscondido } from "./enquadramento";
import {
  AFASTAMENTO_DA_CADEIRA,
  ALTURA_TAMPO,
  DURACAO_ENTRADA_MS,
  ELEVACAO_MAXIMA,
  ELEVACAO_MINIMA,
  FOLGA_DA_COXA,
  FOLGA_DA_MAO,
} from "./medidas-da-sala";

/** Quadril do avatar sentado (Avatar3D de 10/10): o pivô da escala de entrada. */
const QUADRIL_SENTADO = 0.52;

export type MedidaDoAvatar = {
  /** Topo (cabelo/chapéu) + 4 cm, no referencial do avatar (sem a elevação). */
  topo: number;
  /** Quanto a cadeira subiu (m). A âncora no mundo = topo + elevacao. */
  elevacao: number;
  /** Diagnóstico (já com a elevação): mão mais baixa e o mais alto sob o tampo. */
  mao: number | null;
  sobMesa: number | null;
};

const v = new Vector3();
const rel = new Matrix4();
const inst = new Matrix4();
const inv = new Matrix4();

/**
 * Varre os vértices do boneco no referencial dele (`raiz`) e mede:
 * - topo: o vértice mais alto (cabelo/chapéu);
 * - mao: o mais baixo dos BRAÇOS à frente do tronco (fora da largura do
 *   tronco, acima de 0,3 m — abaixo disso é o anel de "falando", no chão);
 * - sobMesa: o mais alto do que fica DEBAIXO do tampo (entre as pernas, além
 *   da borda da mesa): coxas e, principalmente, a ponta do sapato, que na pose
 *   sentada aponta para cima e não pode furar o tampo.
 * Liga a sombra de todas as malhas no caminho (o Avatar3D não liga em todas).
 */
function medirAvatar(raiz: Object3D, config: AvatarConfig) {
  const m = MEDIDAS[config.corpo] ?? MEDIDAS.classico;
  const ombroY = QUADRIL_SENTADO + m.troncoH - 0.06;
  const frente = m.troncoD / 2 + 0.08;
  const larguraDoTronco = m.troncoW / 2;
  const bordaDaMesa = AFASTAMENTO_DA_CADEIRA - 0.02;
  raiz.updateWorldMatrix(true, true);
  inv.copy(raiz.matrixWorld).invert();
  let topo = -Infinity;
  let mao = Infinity;
  let sobMesa = -Infinity;

  const ponto = () => {
    if (v.y > topo) topo = v.y;
    if (v.z <= frente) return;
    const ax = Math.abs(v.x);
    if (ax > larguraDoTronco + 0.005 && v.y > 0.3 && v.y < ombroY - 0.02) {
      if (v.y < mao) mao = v.y;
    } else if (ax < larguraDoTronco - 0.01 && v.z > bordaDaMesa && v.y > 0.1 && v.y < 0.95) {
      if (v.y > sobMesa) sobMesa = v.y;
    }
  };

  raiz.traverse((o) => {
    const malha = o as Mesh;
    if (!malha.isMesh || !malha.geometry) return;
    malha.castShadow = true;
    const pos = malha.geometry.getAttribute("position");
    if (!pos) return;
    rel.multiplyMatrices(inv, malha.matrixWorld);
    const im = o as InstancedMesh;
    if (im.isInstancedMesh) {
      // Instâncias (fios de cabelo etc.): só os cantos da caixa de cada uma.
      if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
      const bb = im.geometry.boundingBox!;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst);
        inst.premultiply(rel);
        for (let c = 0; c < 8; c++) {
          v.set(
            c & 1 ? bb.max.x : bb.min.x,
            c & 2 ? bb.max.y : bb.min.y,
            c & 4 ? bb.max.z : bb.min.z,
          );
          v.applyMatrix4(inst);
          if (v.y > topo) topo = v.y;
        }
      }
      return;
    }
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      ponto();
    }
  });
  return {
    topo: Number.isFinite(topo) ? topo : null,
    mao: Number.isFinite(mao) ? mao : null,
    sobMesa: Number.isFinite(sobMesa) ? sobMesa : null,
  };
}

/**
 * A elevação que pousa a mão 1,5 cm acima do tampo, sem deixar o que está
 * debaixo da mesa (ponta do sapato) furar o tampo por cima.
 */
export function elevacaoDaCadeira(mao: number | null, sobMesa: number | null): number {
  const pelaMao = mao === null ? 0 : ALTURA_TAMPO + FOLGA_DA_MAO - mao;
  const teto = sobMesa === null ? Infinity : ALTURA_TAMPO - FOLGA_DA_COXA - sobMesa;
  const e = Math.min(pelaMao, teto);
  return Math.max(ELEVACAO_MINIMA, Math.min(ELEVACAO_MAXIMA, e));
}

export function AvatarNaCadeira({
  id,
  config,
  nome,
  falando,
  lugar,
  saindo,
  eu,
  elevacao,
  aoMedir,
  aoSair,
}: {
  id: string;
  config: AvatarConfig;
  nome: string;
  falando: boolean;
  lugar: Lugar;
  saindo: boolean;
  eu: boolean;
  /** A elevação atual (vem da sala, que também sobe a cadeira). */
  elevacao: number;
  aoMedir: (id: string, medida: MedidaDoAvatar) => void;
  /** A animação de saída terminou: a sala pode tirar a pessoa. */
  aoSair?: (id: string) => void;
}) {
  const raiz = useRef<Group>(null);
  const escala = useRef<Group>(null);
  const medidor = useRef<Group>(null);
  const progresso = useRef(0);
  const saiu = useRef(false);
  /** Quadros que faltam para medir (0 = nada pendente). */
  const medirEm = useRef(2);
  const chaveDaConfig = JSON.stringify(config);

  // Config nova → mede de novo dois quadros depois (o R3F monta as malhas no commit).
  useLayoutEffect(() => {
    medirEm.current = 2;
  }, [chaveDaConfig]);

  useFrame(({ camera }, dt) => {
    if (medirEm.current > 0 && --medirEm.current === 0 && medidor.current) {
      const r = medirAvatar(medidor.current, config);
      const e = elevacaoDaCadeira(r.mao, r.sobMesa);
      aoMedir(id, {
        topo: (r.topo ?? 0) + 0.04,
        elevacao: e,
        mao: r.mao === null ? null : r.mao + e,
        sobMesa: r.sobMesa === null ? null : r.sobMesa + e,
      });
    }

    // Entrada/saída: progresso linear 0→1 em 300 ms, curva suave na escala.
    const passo = (dt * 1000) / DURACAO_ENTRADA_MS;
    const p = Math.max(0, Math.min(1, progresso.current + (saindo ? -passo : passo)));
    progresso.current = p;
    const s = 1 - Math.pow(1 - p, 3);
    if (escala.current) {
      escala.current.scale.setScalar(Math.max(0.001, s));
      escala.current.visible = p > 0;
    }
    if (saindo && p === 0 && !saiu.current) {
      saiu.current = true;
      aoSair?.(id);
    }

    // Câmera colada na minha cabeça (inclusive a padrão): o meu boneco some e não
    // tapa a mesa. A mesma conta esconde os selos dele no Projetor.
    if (eu && raiz.current) {
      raiz.current.visible = !meuAvatarEscondido(camera.position, lugar, elevacao);
    }
  });

  return (
    <group ref={raiz} position={[lugar.x, 0, lugar.z]} rotation-y={lugar.rotY}>
      {/* Pivô da escala no quadril: o boneco "cresce" sentado, não brota do chão. */}
      <group ref={escala} position={[0, QUADRIL_SENTADO, 0]} scale={0.001}>
        <group position={[0, elevacao - QUADRIL_SENTADO, 0]}>
          <group ref={medidor}>
            <Avatar3D
              config={config}
              nome={nome}
              falando={falando}
              mostrarNome={false}
              pose="sentado"
            />
          </group>
        </group>
      </group>
    </group>
  );
}
