/*
 * O acabamento do escritório "de verdade" (18/10/2026, pelas fotos):
 * divisória com rodapé alto de madeira em réguas e vidro com perfil preto em
 * cima, porta de vidro com listras foscas, mesa de madeira com pé quadrado de
 * metalon preto, cadeira preta, TV na parede.
 *
 * Os avatares continuam no estilo deles (Roblox); a sala é que fica real.
 * Leve: as paredes são poucas caixas e planos com as MESMAS texturas para o
 * andar inteiro, e só o que importa projeta sombra.
 */
import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import { DoubleSide } from "three";
import { madeiraDaMesa, madeiraDoPainel, planoComUV, vidroListrado } from "./materiais";

type V3 = [number, number, number];

export const PE_DIREITO = 2.7;
export const ALTURA_DO_PAINEL = 1.05;
const ESPESSURA = 0.08;
const PERFIL = 0.04;
const PRETO = "#1c1c1e";

/* ————————————————— Divisória ————————————————— */

/**
 * Uma divisória reta de `de` até `ate` (no chão, mundo): painel de madeira
 * até 1,05 m, vidro até o teto, perfis pretos (em cima, no encontro da
 * madeira com o vidro e a cada ~1,2 m). Com `porta`, abre o vão e põe a folha
 * de vidro listrada — `porta` é a distância do `de` até o centro da porta.
 */
export function Divisoria({
  de,
  ate,
  porta,
  vidro = true,
}: {
  de: [number, number];
  ate: [number, number];
  porta?: number;
  /** Sem vidro: parede cheia (a parede de fora do prédio). */
  vidro?: boolean;
}) {
  const dx = ate[0] - de[0];
  const dz = ate[1] - de[1];
  const comprimento = Math.hypot(dx, dz);
  const giro = -Math.atan2(dz, dx);
  const LARGURA_PORTA = 0.95;
  // Os trechos cheios: sem porta é um só; com porta, antes e depois do vão.
  const trechos: [number, number][] = porta
    ? [
        [0, porta - LARGURA_PORTA / 2],
        [porta + LARGURA_PORTA / 2, comprimento],
      ]
    : [[0, comprimento]];

  return (
    <group position={[de[0], 0, de[1]]} rotation-y={giro}>
      {trechos.map(([a, b]) =>
        b - a > 0.02 ? (
          vidro ? (
            <TrechoDeDivisoria key={a} a={a} b={b} />
          ) : (
            <ParedeCheia key={a} a={a} b={b} />
          )
        ) : null,
      )}
      {porta !== undefined && <PortaDeVidro x={porta} largura={LARGURA_PORTA} />}
    </group>
  );
}

function TrechoDeDivisoria({ a, b }: { a: number; b: number }) {
  const w = b - a;
  const cx = (a + b) / 2;
  const painel = madeiraDoPainel();
  const geoFrente = useMemo(() => planoComUV(w, ALTURA_DO_PAINEL, 1.0), [w]);
  const altoVidro = PE_DIREITO - ALTURA_DO_PAINEL;
  const montantes = Math.max(0, Math.floor(w / 1.2));
  return (
    <group>
      {/* o painel de madeira: miolo escuro e as duas faces com as réguas */}
      <mesh position={[cx, ALTURA_DO_PAINEL / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, ALTURA_DO_PAINEL, ESPESSURA]} />
        <meshStandardMaterial color="#6b3d22" roughness={0.6} />
      </mesh>
      {[1, -1].map((l) => (
        <mesh
          key={l}
          geometry={geoFrente}
          position={[cx, ALTURA_DO_PAINEL / 2, (l * ESPESSURA) / 2 + l * 0.001]}
          rotation-y={l === 1 ? 0 : Math.PI}
          receiveShadow
        >
          <meshStandardMaterial map={painel ?? undefined} roughness={0.45} />
        </mesh>
      ))}
      {/* o vidro */}
      <mesh position={[cx, ALTURA_DO_PAINEL + altoVidro / 2, 0]}>
        <planeGeometry args={[w, altoVidro]} />
        <meshStandardMaterial
          color="#cfe3ee"
          transparent
          opacity={0.16}
          roughness={0.05}
          metalness={0.1}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* perfis pretos: em cima, no encontro com a madeira e os montantes */}
      <mesh position={[cx, PE_DIREITO - PERFIL / 2, 0]}>
        <boxGeometry args={[w, PERFIL, PERFIL * 1.6]} />
        <meshStandardMaterial color={PRETO} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[cx, ALTURA_DO_PAINEL + PERFIL / 2, 0]}>
        <boxGeometry args={[w, PERFIL, ESPESSURA + 0.02]} />
        <meshStandardMaterial color={PRETO} roughness={0.5} metalness={0.3} />
      </mesh>
      {Array.from({ length: montantes + 1 }, (_, i) => {
        const x = a + (w * i) / Math.max(1, montantes);
        return (
          <mesh key={i} position={[x, ALTURA_DO_PAINEL + altoVidro / 2, 0]}>
            <boxGeometry args={[PERFIL, altoVidro, PERFIL * 1.6]} />
            <meshStandardMaterial color={PRETO} roughness={0.5} metalness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A parede de fora do prédio: alvenaria branca, com rodapé. */
function ParedeCheia({ a, b }: { a: number; b: number }) {
  const w = b - a;
  return (
    <group position={[(a + b) / 2, 0, 0]}>
      <mesh position={[0, PE_DIREITO / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, PE_DIREITO, 0.16]} />
        <meshStandardMaterial color="#f4f4f2" roughness={0.9} />
      </mesh>
      {[1, -1].map((l) => (
        <mesh key={l} position={[0, 0.05, l * 0.085]}>
          <boxGeometry args={[w, 0.1, 0.012]} />
          <meshStandardMaterial color="#d4d4d0" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/** A porta de vidro com as listras foscas, puxador preto e o batente. */
function PortaDeVidro({ x, largura }: { x: number; largura: number }) {
  const listras = vidroListrado();
  const alto = 2.1;
  return (
    <group position={[x, 0, 0]}>
      {/* a folha */}
      <mesh position={[0, alto / 2, 0]}>
        <planeGeometry args={[largura - 0.06, alto - 0.04]} />
        <meshStandardMaterial
          map={listras ?? undefined}
          color="#ffffff"
          transparent
          roughness={0.2}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* batente preto em volta da porta e a bandeira de vidro em cima */}
      {[-1, 1].map((l) => (
        <mesh key={l} position={[(l * largura) / 2, PE_DIREITO / 2, 0]}>
          <boxGeometry args={[PERFIL, PE_DIREITO, PERFIL * 1.8]} />
          <meshStandardMaterial color={PRETO} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, alto + PERFIL / 2, 0]}>
        <boxGeometry args={[largura, PERFIL, PERFIL * 1.8]} />
        <meshStandardMaterial color={PRETO} roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, (alto + PE_DIREITO) / 2, 0]}>
        <planeGeometry args={[largura, PE_DIREITO - alto]} />
        <meshStandardMaterial
          color="#cfe3ee"
          transparent
          opacity={0.16}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* puxador (dos dois lados) */}
      {[1, -1].map((l) => (
        <mesh key={l} position={[largura / 2 - 0.12, 1.05, l * 0.04]}>
          <boxGeometry args={[0.025, 0.42, 0.025]} />
          <meshStandardMaterial color={PRETO} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ————————————————— Mesa e cadeira ————————————————— */

/** Da cadeira até a borda da mesa (o mesmo da sala de reunião — ver `AvatarNaCadeira`). */
export const AFASTAMENTO = 0.4;
export const ALTURA_DA_MESA = 0.76;

/**
 * Mesa de madeira com pé de metalon preto (o "quadro" fechado dos lados, como
 * na foto), no referencial da CADEIRA: a pessoa olha para +z e o tampo começa
 * `AFASTAMENTO` à frente.
 */
export function MesaReal({ w, d }: { w: number; d: number }) {
  const tampo = madeiraDaMesa();
  const zc = AFASTAMENTO + d / 2;
  const t = 0.035;
  const alto = ALTURA_DA_MESA - t;
  const b = 0.035; // a bitola do metalon
  return (
    <group position={[0, 0, zc]}>
      <mesh position={[0, ALTURA_DA_MESA - t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, t, d]} />
        <meshStandardMaterial map={tampo ?? undefined} roughness={0.5} />
      </mesh>
      {[-1, 1].map((l) => (
        <group key={l} position={[l * (w / 2 - 0.06), 0, 0]}>
          {/* o quadro: dois montantes, a travessa de baixo e a de cima */}
          {[-1, 1].map((k) => (
            <mesh key={k} position={[0, alto / 2, k * (d / 2 - 0.05)]} castShadow>
              <boxGeometry args={[b, alto, b]} />
              <meshStandardMaterial color={PRETO} roughness={0.45} metalness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, b / 2, 0]}>
            <boxGeometry args={[b, b, d - 0.1]} />
            <meshStandardMaterial color={PRETO} roughness={0.45} metalness={0.4} />
          </mesh>
          <mesh position={[0, alto - b / 2, 0]}>
            <boxGeometry args={[b, b, d - 0.1]} />
            <meshStandardMaterial color={PRETO} roughness={0.45} metalness={0.4} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Monitor fino preto em cima da mesa (referencial da cadeira), tela virada para a pessoa. */
export function Monitor({
  x,
  d,
  ligado,
  luz,
}: {
  x: number;
  d: number;
  ligado: boolean;
  luz: string;
}) {
  const z = AFASTAMENTO + d - 0.14;
  return (
    <group position={[x, ALTURA_DA_MESA, z]}>
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[0.2, 0.01, 0.15]} />
        <meshStandardMaterial color={PRETO} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.12, 0.02]}>
        <boxGeometry args={[0.04, 0.22, 0.03]} />
        <meshStandardMaterial color={PRETO} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.33, 0]} castShadow>
        <boxGeometry args={[0.56, 0.33, 0.025]} />
        <meshStandardMaterial color="#111113" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.335, -0.0135]} rotation-y={Math.PI}>
        <planeGeometry args={[0.53, 0.3]} />
        <meshBasicMaterial color={ligado ? "#cfe8ff" : "#0b0b0d"} toneMapped={false} />
      </mesh>
      {/* o LED na traseira: a situação, vista de fora */}
      <mesh position={[0, 0.18, 0.0135]}>
        <planeGeometry args={[0.36, 0.012]} />
        <meshBasicMaterial color={luz} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Cadeira de escritório preta (encosto de tela), no referencial da cadeira. */
export function CadeiraReal({ elevacao, vazia }: { elevacao: number; vazia: boolean }) {
  const y = 0.44 + elevacao;
  return (
    <group position={[0, 0, vazia ? -0.3 : 0]} rotation-y={vazia ? 0.4 : 0}>
      <RoundedBox
        args={[0.5, 0.07, 0.48]}
        radius={0.03}
        smoothness={2}
        position={[0, y, 0]}
        castShadow
      >
        <meshStandardMaterial color="#232326" roughness={0.8} />
      </RoundedBox>
      <RoundedBox
        args={[0.46, 0.6, 0.05]}
        radius={0.03}
        smoothness={2}
        position={[0, y + 0.36, -0.26]}
        rotation={[-0.12, 0, 0]}
        castShadow
      >
        <meshStandardMaterial color="#2c2c30" roughness={0.9} />
      </RoundedBox>
      <mesh position={[0, y / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, y, 8]} />
        <meshStandardMaterial color="#8a8a8f" roughness={0.3} metalness={0.7} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15]} rotation-y={-a}>
            <boxGeometry args={[0.3, 0.03, 0.04]} />
            <meshStandardMaterial color="#232326" roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ————————————————— Parede: TV e quadro ————————————————— */

/** TV na parede (de frente para +z), apagada com um reflexo. */
export function TV({ pos, rotY = 0, largura = 1.3 }: { pos: V3; rotY?: number; largura?: number }) {
  const alto = largura * 0.5625;
  return (
    <group position={pos} rotation-y={rotY}>
      <mesh castShadow>
        <boxGeometry args={[largura + 0.04, alto + 0.04, 0.05]} />
        <meshStandardMaterial color="#0d0d0f" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[largura, alto]} />
        <meshStandardMaterial color="#16181d" roughness={0.15} metalness={0.4} />
      </mesh>
    </group>
  );
}

/** Quadro branco com uns rabiscos coloridos. */
export function QuadroBranco({ pos, rotY = 0 }: { pos: V3; rotY?: number }) {
  return (
    <group position={pos} rotation-y={rotY}>
      <mesh>
        <boxGeometry args={[1.6, 0.95, 0.03]} />
        <meshStandardMaterial color="#b8b8bc" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.016]}>
        <planeGeometry args={[1.54, 0.89]} />
        <meshStandardMaterial color="#fbfbfb" roughness={0.25} />
      </mesh>
      {[
        [-0.4, 0.2, 0.6, "#2563eb"],
        [-0.3, 0.05, 0.4, "#2563eb"],
        [0.35, 0.18, 0.35, "#dc2626"],
        [0.25, -0.15, 0.5, "#16a34a"],
      ].map(([x, y, w, cor], i) => (
        <mesh key={i} position={[x as number, y as number, 0.018]}>
          <planeGeometry args={[w as number, 0.018]} />
          <meshBasicMaterial color={cor as string} />
        </mesh>
      ))}
    </group>
  );
}

/** Vaso alto com uma planta (folhas em leque). */
export function PlantaAlta({ pos }: { pos: V3 }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.16, 0.5, 16]} />
        <meshStandardMaterial color="#3a3a3d" roughness={0.6} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.12, 0.85, Math.sin(a) * 0.12]}
            rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]}
            castShadow
          >
            <coneGeometry args={[0.1, 0.8, 5]} />
            <meshStandardMaterial
              color={i % 2 ? "#2f7d3a" : "#3e9149"}
              roughness={0.8}
              flatShading
            />
          </mesh>
        );
      })}
    </group>
  );
}
