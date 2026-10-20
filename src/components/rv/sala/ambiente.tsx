/*
 * O "prédio" da sala: piso, tapete, paredes (a do telão ripada), forro com
 * luminária, janelas com vista de eucaliptal, plantas, logo, prateleira, porta
 * e as luzes.
 *
 * Regras de custo (a sala divide o orçamento de draw calls com os avatares):
 * - peças estáticas parecidas são MESCLADAS (mergeGeometries) com cor por
 *   vértice → 1 draw call por grupo;
 * - repetições (ripas, painéis do forro) são InstancedMesh;
 * - paredes, forro, janelas, piso e tapete NÃO fazem sombra, só recebem.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  type InstancedMesh,
  Object3D,
  SphereGeometry,
  type SpotLight,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CENTRO_DA_SALA_Z,
  COR_FORRO,
  COR_PAREDE,
  COR_PISO,
  COR_RODAPE,
  ESPESSURA_DA_PAREDE,
  JANELA,
  LARGURA_DA_SALA,
  LOGO,
  LUMINARIA,
  LUZ_DA_MESA_Y,
  MESA_CENTRO_Z,
  PAREDE_FRENTE_Z,
  PAREDE_FUNDO_Z,
  PAREDE_X,
  PE_DIREITO,
  POSICOES_DAS_PLANTAS,
  PROFUNDIDADE_DA_SALA,
  RIPA,
  RODAPE_ALTURA,
  SOMBRA_MAPA,
  TAPETE,
  TELAO_CENTRO,
} from "./medidas-da-sala";
import { FONTE, useTexturaDeCanvas } from "./textura-de-canvas";

/* ───────── utilidades de malha ───────── */

/** Pinta a geometria inteira de uma cor (atributo `color`), para mesclar peças de cores diferentes. */
function pintar(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute("position").count;
  const cores = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cores[i * 3] = c.r;
    cores[i * 3 + 1] = c.g;
    cores[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(cores, 3));
  return g;
}

/** Mescla e descarta as partes (as partes só existiam para virar uma malha). */
function mesclar(partes: BufferGeometry[]): BufferGeometry | null {
  const g = mergeGeometries(partes.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of partes) p.dispose();
  return g;
}

function useGeometria(fazer: () => BufferGeometry | null): BufferGeometry | null {
  const g = useMemo(fazer, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => g?.dispose(), [g]);
  return g;
}

/* ───────── Luzes ───────── */

function Luzes() {
  const spotE = useRef<SpotLight>(null);
  const spotD = useRef<SpotLight>(null);
  useLayoutEffect(() => {
    // Os spots miram a moldura do telão (o alvo precisa estar na cena para atualizar).
    for (const [s, x] of [
      [spotE.current, -1.2],
      [spotD.current, 1.2],
    ] as const) {
      if (!s) continue;
      s.target.position.set(x, TELAO_CENTRO[1], TELAO_CENTRO[2]);
      s.target.updateMatrixWorld();
    }
  }, []);
  return (
    <>
      <hemisphereLight args={["#fff6e8", "#8a7a66", 0.55]} />
      <directionalLight
        position={[6, 6, 1]}
        intensity={1.6}
        color="#fff1d6"
        castShadow
        shadow-mapSize={[SOMBRA_MAPA, SOMBRA_MAPA]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0005}
      />
      {/* Luz quente da luminária sobre a mesa — sem sombra (custaria 6 passes de cubo). */}
      <pointLight
        position={[0, LUZ_DA_MESA_Y, MESA_CENTRO_Z]}
        color="#ffd9a0"
        intensity={25}
        distance={7}
        decay={2}
      />
      <spotLight
        ref={spotE}
        position={[-1.6, PE_DIREITO - 0.2, TELAO_CENTRO[2] + 1.2]}
        intensity={6}
        angle={0.6}
        penumbra={0.6}
        distance={6}
        color="#fff4e0"
      />
      <spotLight
        ref={spotD}
        position={[1.6, PE_DIREITO - 0.2, TELAO_CENTRO[2] + 1.2]}
        intensity={6}
        angle={0.6}
        penumbra={0.6}
        distance={6}
        color="#fff4e0"
      />
    </>
  );
}

/* ───────── Piso, tapete, paredes, rodapé ───────── */

function PisoETapete() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, CENTRO_DA_SALA_Z]} receiveShadow>
        <planeGeometry args={[LARGURA_DA_SALA, PROFUNDIDADE_DA_SALA]} />
        <meshStandardMaterial color={COR_PISO} roughness={0.7} />
      </mesh>
      {/* Borda clara + miolo verde: dois discos, o miolo 1 mm acima. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, TAPETE.y - 0.001, MESA_CENTRO_Z]}
        scale={[TAPETE.rx, TAPETE.rz, 1]}
        receiveShadow
      >
        <circleGeometry args={[1, 72]} />
        <meshStandardMaterial color="#e7dcc6" roughness={1} />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, TAPETE.y, MESA_CENTRO_Z]}
        scale={[TAPETE.rx - TAPETE.borda, TAPETE.rz - TAPETE.borda, 1]}
        receiveShadow
      >
        <circleGeometry args={[1, 72]} />
        <meshStandardMaterial color="#2f5d46" roughness={1} />
      </mesh>
    </group>
  );
}

function Paredes() {
  const e = ESPESSURA_DA_PAREDE;
  const h = PE_DIREITO;
  const prof = PROFUNDIDADE_DA_SALA;
  const larg = LARGURA_DA_SALA;
  // As quatro paredes numa malha (mesma cor): 1 draw call.
  const paredes = useGeometria(() =>
    mesclar([
      new BoxGeometry(larg + 2 * e, h, e).translate(0, h / 2, PAREDE_FUNDO_Z - e / 2),
      new BoxGeometry(larg + 2 * e, h, e).translate(0, h / 2, PAREDE_FRENTE_Z + e / 2),
      new BoxGeometry(e, h, prof).translate(-PAREDE_X - e / 2, h / 2, CENTRO_DA_SALA_Z),
      new BoxGeometry(e, h, prof).translate(PAREDE_X + e / 2, h / 2, CENTRO_DA_SALA_Z),
    ]),
  );
  const rodape = useGeometria(() => {
    const r = RODAPE_ALTURA;
    const d = 0.015;
    return mesclar([
      new BoxGeometry(larg, r, d).translate(0, r / 2, PAREDE_FUNDO_Z + RIPA.profundidade + d / 2),
      new BoxGeometry(larg, r, d).translate(0, r / 2, PAREDE_FRENTE_Z - d / 2),
      new BoxGeometry(d, r, prof).translate(-PAREDE_X + d / 2, r / 2, CENTRO_DA_SALA_Z),
      new BoxGeometry(d, r, prof).translate(PAREDE_X - d / 2, r / 2, CENTRO_DA_SALA_Z),
    ]);
  });
  return (
    <group>
      {paredes && (
        <mesh geometry={paredes} receiveShadow>
          <meshStandardMaterial color={COR_PAREDE} roughness={0.95} />
        </mesh>
      )}
      {rodape && (
        <mesh geometry={rodape}>
          <meshStandardMaterial color={COR_RODAPE} roughness={0.7} />
        </mesh>
      )}
    </group>
  );
}

/** Parede do telão ripada: barras de 6 cm a cada 12 cm sobre um fundo escuro (1 InstancedMesh). */
function Ripas() {
  const ref = useRef<InstancedMesh>(null);
  const n = Math.floor(LARGURA_DA_SALA / RIPA.passo);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    const x0 = -((n - 1) * RIPA.passo) / 2;
    for (let i = 0; i < n; i++) {
      o.position.set(x0 + i * RIPA.passo, PE_DIREITO / 2, PAREDE_FUNDO_Z + RIPA.profundidade / 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [n]);
  return (
    <group>
      {/* Fundo escuro entre as ripas (dá a profundidade do painel). */}
      <mesh position={[0, PE_DIREITO / 2, PAREDE_FUNDO_Z + 0.002]} receiveShadow>
        <planeGeometry args={[LARGURA_DA_SALA, PE_DIREITO]} />
        <meshStandardMaterial color="#4a3426" roughness={1} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, n]} receiveShadow>
        <boxGeometry args={[RIPA.largura, PE_DIREITO, RIPA.profundidade]} />
        <meshStandardMaterial color={RIPA.cor} roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

/* ───────── Forro e luminária ───────── */

const PAINEIS_DO_FORRO: [number, number][] = [
  [-2.6, -2.4],
  [0, -2.4],
  [2.6, -2.4],
  [-2.6, 2.6],
  [0, 2.6],
  [2.6, 2.6],
];

function Forro() {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    PAINEIS_DO_FORRO.forEach(([x, z], i) => {
      o.position.set(x, PE_DIREITO - 0.004, z);
      o.rotation.set(Math.PI / 2, 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, []);
  const cabos = useGeometria(() =>
    mesclar(
      [-1, 1].flatMap((l) =>
        [-1, 1].map((k) =>
          new CylinderGeometry(0.004, 0.004, PE_DIREITO - LUMINARIA.y, 4).translate(
            l * LUMINARIA.raio * 0.7,
            (PE_DIREITO + LUMINARIA.y) / 2,
            MESA_CENTRO_Z + k * LUMINARIA.raio * 0.45,
          ),
        ),
      ),
    ),
  );
  return (
    <group name="forro">
      <mesh rotation-x={Math.PI / 2} position={[0, PE_DIREITO, CENTRO_DA_SALA_Z]}>
        <planeGeometry args={[LARGURA_DA_SALA, PROFUNDIDADE_DA_SALA]} />
        <meshStandardMaterial color={COR_FORRO} emissive={COR_FORRO} emissiveIntensity={0.15} />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, PAINEIS_DO_FORRO.length]}>
        <planeGeometry args={[1.2, 0.6]} />
        <meshBasicMaterial color="#fffaf0" toneMapped={false} />
      </instancedMesh>
      {/* Luminária pendente: anel achatado (elipse da mesa) + cabos. */}
      <mesh
        position={[0, LUMINARIA.y, MESA_CENTRO_Z]}
        rotation-x={Math.PI / 2}
        scale={[1, 0.62, 1]}
      >
        <torusGeometry args={[LUMINARIA.raio, LUMINARIA.tubo, 10, 96]} />
        <meshStandardMaterial color="#fff3dc" emissive="#ffe8c2" emissiveIntensity={2} />
      </mesh>
      {cabos && (
        <mesh geometry={cabos}>
          <meshBasicMaterial color="#374151" />
        </mesh>
      )}
    </group>
  );
}

/* ───────── Janelas com vista ───────── */

/** Céu, morro e talhões de eucalipto — a vista da Larsil, desenhada por código. */
function desenharPaisagem(g: CanvasRenderingContext2D, w: number, h: number) {
  const ceu = g.createLinearGradient(0, 0, 0, h * 0.6);
  ceu.addColorStop(0, "#6fb6e8");
  ceu.addColorStop(1, "#dcefff");
  g.fillStyle = ceu;
  g.fillRect(0, 0, w, h);
  // Nuvens.
  g.fillStyle = "rgba(255,255,255,0.85)";
  for (const [x, y, r] of [
    [180, 90, 34],
    [220, 80, 44],
    [262, 94, 30],
    [700, 60, 28],
    [736, 52, 38],
    [772, 64, 26],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Morro ao fundo, azulado pela distância.
  const morro = (cor: string, base: number, amp: number, fase: number) => {
    g.fillStyle = cor;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8)
      g.lineTo(x, base - Math.sin(x * 0.006 + fase) * amp - Math.sin(x * 0.017) * amp * 0.3);
    g.lineTo(w, h);
    g.fill();
  };
  morro("#9fb8c4", h * 0.5, 40, 0.4);
  morro("#7fa38a", h * 0.6, 30, 2.1);
  // Talhões de eucalipto: faixas de árvores altas e finas, cada talhão num tom.
  const tons = ["#2f6b3f", "#3d7d4a", "#285c37", "#47885a"];
  const talhoes = 5;
  for (let t = 0; t < talhoes; t++) {
    const x0 = (t * w) / talhoes;
    const x1 = ((t + 1) * w) / talhoes - 10;
    const topo = h * (0.58 + (t % 2) * 0.04);
    g.fillStyle = tons[t % tons.length];
    g.fillRect(x0, topo + 18, x1 - x0, h - topo);
    for (let x = x0 + 4; x < x1; x += 9) {
      const alt = 30 + ((x * 7) % 13);
      g.fillStyle = "#6b5a46";
      g.fillRect(x, topo + 6, 2, alt);
      g.fillStyle = tons[(t + 1) % tons.length];
      g.beginPath();
      g.ellipse(x + 1, topo + 4, 5, 16, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Estrada de terra entre os talhões.
  g.fillStyle = "#b48a5a";
  g.beginPath();
  g.moveTo(w * 0.44, h);
  g.lineTo(w * 0.5, h * 0.7);
  g.lineTo(w * 0.52, h * 0.7);
  g.lineTo(w * 0.56, h);
  g.fill();
}

function Janelas() {
  const paisagem = useTexturaDeCanvas(1024, 512, desenharPaisagem, "fixa");
  const x = PAREDE_X - 0.002;
  const caixilho = useGeometria(() => {
    const p: BufferGeometry[] = [];
    const b = 0.06; // largura do perfil
    const fundo = 0.08;
    for (const z of JANELA.zs) {
      const { w, h, y } = JANELA;
      p.push(
        new BoxGeometry(fundo, b, w + 2 * b).translate(x - fundo / 2, y + h / 2 + b / 2, z),
        new BoxGeometry(fundo, b, w + 2 * b).translate(x - fundo / 2, y - h / 2 - b / 2, z),
        new BoxGeometry(fundo, h, b).translate(x - fundo / 2, y, z - w / 2 - b / 2),
        new BoxGeometry(fundo, h, b).translate(x - fundo / 2, y, z + w / 2 + b / 2),
        new BoxGeometry(fundo * 0.6, h, 0.03).translate(x - fundo / 2, y, z),
        // Peitoril de madeira.
        pintar(
          new BoxGeometry(0.2, 0.04, w + 0.3).translate(x - 0.1, y - h / 2 - b - 0.02, z),
          "#d6c3a3",
        ),
      );
      for (let i = 0; i < 5; i++) pintar(p[p.length - 2 - i], "#e5e7eb");
    }
    return mesclar(p);
  });
  return (
    <group>
      {JANELA.zs.map((z) => (
        <group key={z}>
          {/* Paisagem colada na parede (sem furo: barato e não mostra o "fora" da sala). */}
          <mesh position={[x, JANELA.y, z]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[JANELA.w, JANELA.h]} />
            {paisagem ? (
              <meshBasicMaterial map={paisagem} toneMapped={false} />
            ) : (
              <meshBasicMaterial color="#9fd0ef" />
            )}
          </mesh>
          <mesh position={[x - 0.05, JANELA.y, z]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[JANELA.w, JANELA.h]} />
            <meshPhysicalMaterial
              color="#dbeafe"
              transparent
              opacity={0.25}
              roughness={0.05}
              metalness={0}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      {caixilho && (
        <mesh geometry={caixilho}>
          <meshStandardMaterial vertexColors roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}

/* ───────── Plantas ───────── */

/** Vaso + tronco + 5 a 7 folhas numa geometria (1 draw call por planta). */
function geometriaDePlanta(semente: number): BufferGeometry | null {
  const folhas = 5 + (semente % 3);
  const p: BufferGeometry[] = [
    pintar(new CylinderGeometry(0.24, 0.18, 0.5, 20).translate(0, 0.25, 0), "#e7e1d6"),
    pintar(new CylinderGeometry(0.22, 0.22, 0.03, 20).translate(0, 0.49, 0), "#5a4232"),
    pintar(new CylinderGeometry(0.025, 0.035, 0.45, 6).translate(0, 0.7, 0), "#6b4f3a"),
  ];
  for (let i = 0; i < folhas; i++) {
    const a = (i / folhas) * Math.PI * 2 + semente;
    const alt = 0.75 + (i % 3) * 0.1;
    const folha = new ConeGeometry(0.09, 0.42, 6);
    folha.rotateZ(0.9 + (i % 2) * 0.25);
    folha.rotateY(a);
    folha.translate(Math.cos(a) * 0.14, alt, -Math.sin(a) * 0.14);
    p.push(pintar(folha, i % 2 ? "#2f7d4a" : "#3f9a5c"));
  }
  p.push(pintar(new SphereGeometry(0.16, 10, 8).scale(1, 1.2, 1).translate(0, 1.0, 0), "#3f9a5c"));
  return mesclar(p);
}

function Planta({ x, z, semente }: { x: number; z: number; semente: number }) {
  const geo = useGeometria(() => geometriaDePlanta(semente));
  if (!geo) return null;
  return (
    <mesh geometry={geo} position={[x, 0, z]}>
      <meshStandardMaterial vertexColors roughness={0.85} />
    </mesh>
  );
}

/* ───────── Logo, prateleira e porta ───────── */

function desenharLogo(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = "#13352a";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#e7dcc6";
  g.font = `800 ${Math.round(h * 0.62)}px ${FONTE}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Letras espaçadas à mão (letterSpacing do canvas ainda não é universal).
  const texto = "LARSIL";
  const passo = w * 0.13;
  const x0 = w / 2 - (passo * (texto.length - 1)) / 2;
  for (let i = 0; i < texto.length; i++) g.fillText(texto[i], x0 + i * passo, h * 0.54);
}

function Logo() {
  const t = useTexturaDeCanvas(512, 128, desenharLogo, "fixa");
  return (
    <mesh position={[LOGO.x, LOGO.y, PAREDE_FUNDO_Z + RIPA.profundidade + 0.01]}>
      <planeGeometry args={[LOGO.w, LOGO.h]} />
      {t ? (
        <meshStandardMaterial map={t} roughness={0.6} />
      ) : (
        <meshStandardMaterial color="#13352a" />
      )}
    </mesh>
  );
}

/** Prateleira com pastas na parede de trás (onde fica a porta). */
function Prateleira() {
  const geo = useGeometria(() => {
    const z = PAREDE_FRENTE_Z - 0.15;
    const p: BufferGeometry[] = [];
    for (const y of [1.2, 1.65]) {
      p.push(pintar(new BoxGeometry(2.2, 0.04, 0.28).translate(2.4, y, z), "#6b4a32"));
      const cores = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#334155", "#7c3aed"];
      for (let i = 0; i < 12; i++) {
        const alt = 0.3 + ((i * 5) % 7) * 0.012;
        p.push(
          pintar(
            new BoxGeometry(0.07, alt, 0.24).translate(
              1.5 + i * 0.09 + (i > 7 ? 0.25 : 0),
              y + 0.02 + alt / 2,
              z,
            ),
            cores[(i + (y > 1.5 ? 2 : 0)) % cores.length],
          ),
        );
      }
    }
    return mesclar(p);
  });
  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={0.7} />
    </mesh>
  );
}

function Porta() {
  const geo = useGeometria(() => {
    const z = PAREDE_FRENTE_Z - 0.03;
    return mesclar([
      pintar(new BoxGeometry(1.0, 2.15, 0.05).translate(-2.6, 1.075, z), "#8a6142"),
      pintar(new BoxGeometry(1.12, 0.06, 0.06).translate(-2.6, 2.18, z - 0.01), "#5b4636"),
      pintar(new BoxGeometry(0.06, 2.2, 0.06).translate(-3.13, 1.1, z - 0.01), "#5b4636"),
      pintar(new BoxGeometry(0.06, 2.2, 0.06).translate(-2.07, 1.1, z - 0.01), "#5b4636"),
      pintar(new BoxGeometry(0.14, 0.03, 0.05).translate(-2.25, 1.05, z - 0.05), "#d1d5db"),
    ]);
  });
  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={0.6} />
    </mesh>
  );
}

/* ───────── Tudo junto ───────── */

export function Ambiente() {
  return (
    <group>
      <Luzes />
      <PisoETapete />
      <Paredes />
      <Ripas />
      <Forro />
      <Janelas />
      {POSICOES_DAS_PLANTAS.map(([x, z], i) => (
        <Planta key={i} x={x} z={z} semente={i * 3 + 1} />
      ))}
      <Logo />
      <Prateleira />
      <Porta />
    </group>
  );
}
