import { useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TubeGeometry,
  Vector3,
  type Mesh,
} from "three";
import type { AvatarConfig } from "@/lib/avatar-3d";
import { Bloco } from "@/components/rv/bloco";
import type { Medidas } from "@/components/rv/medidas";
import { baseDoCabelo, gerarCabelo } from "@/components/rv/cabelos-3d";
import { clarear, desenharFios, escurecer } from "@/components/rv/avatar-texturas";
import { ContextoDoAvatar, type ContextoAvatar } from "@/components/rv/contexto-avatar";
import { enfileirar, useDrenarFila } from "@/components/rv/fila-avatar";
import {
  ALTURA_TOPO,
  ESTILOS,
  LARGURA_LATERAL,
  LARGURA_TOPO,
  type EstiloCabelo,
} from "@/components/rv/cabelo-estilos";
import {
  CORTE_DO_CHAPEU,
  chaveDoCtx,
  ctxDoCabelo,
  emCache,
  montarBarba,
  montarCabelo,
  obterGeo,
  reter,
  soltar,
  type GeoCabelo,
  type TipoChapeu,
  type VeuFranja,
} from "@/components/rv/cabelo-malha";
import { criarMaterialCabelo, definirCores, ligarGiro } from "@/components/rv/cabelo-material";
import { texturaChapeu } from "@/components/rv/cabelo-texturas";
import { CARTOLA, alturaChapeuAba, geoChapeuAba } from "@/components/rv/cabelo-chapeu";
import { COBRE_O_ALTO_NOVOS, alturaDoChapeuNovo } from "@/components/rv/cabelo-chapeus-novos";
import { ChapeuNovo } from "@/components/rv/chapeu-novo";

export { chaveDoCabelo, type TipoChapeu } from "@/components/rv/cabelo-malha";

/*
 * O que vai em cima da cabeça do avatar: o cabelo, o chapéu/enfeite e a
 * barba 3D. Fica separado do corpo (`avatar-3d.tsx`) para cada parte evoluir
 * sozinha. Coordenadas: centro da cabeça na origem, rosto para +z.
 *
 * Cabelo: os penteados já portados para o motor novo (casca + mechas em fita
 * lente, `cabelo-*.ts`) usam ele; os demais continuam no motor antigo
 * (`cabelos-3d.ts`) até o fim da Fase 1.
 */

/** Chapéus que cobrem o alto da cabeça: com eles, o cabelo nasce do corte para baixo. */
export const COBRE_O_ALTO = new Set<TipoChapeu>([
  "bone",
  "boneTras",
  "gorro",
  "chapeu",
  "capacete",
  "cartola",
  "chapeuPescador",
  // os chapéus novos (16/10/2026): palha, trucker, cowboy, capacete florestal, gorro…
  ...COBRE_O_ALTO_NOVOS,
]);

/** O cabelo do avatar (assinatura congelada no contrato). */
export function Cabelo({ config, m }: { config: AvatarConfig; m: Medidas }) {
  const ctx = useContext(ContextoDoAvatar);
  if (config.cabelo === "careca") return null;
  const estilo = config.cabelo as EstiloCabelo;
  if (!ESTILOS[estilo])
    return <CabeloAntigo key={`antigo-${config.cabelo}`} config={config} m={m} />;
  const c = ctxDoCabelo(config, m, ctx.pose, ctx.qualidade);
  const chave = chaveDoCtx(estilo, c);
  return <CabeloMalha key={chave} chave={chave} config={config} m={m} ctx={ctx} />;
}

/**
 * O véu de sombra da franja, colado na borda REAL dela (coluna a coluna): em
 * cima nasce transparente (escondido atrás das pontas), escurece de leve logo
 * abaixo da borda e some 2 cm depois — profundidade sem risco reto na testa.
 */
function geoVeu(v: VeuFranja, t: number): BufferGeometry {
  const esc = t / 0.46;
  const linhas = [
    { dy: 0.008 * esc, a: 0 },
    { dy: -0.004 * esc, a: 0.11 },
    { dy: -0.02 * esc, a: 0 },
  ];
  const n = v.xs.length;
  const pos: number[] = [];
  const cor: number[] = [];
  const idx: number[] = [];
  const passo = n > 1 ? Math.abs(v.xs[1]! - v.xs[0]!) : 0.015;
  for (let i = 0; i < n; i++) {
    // as pontas de cada trecho contínuo somem (sem borda lateral reta)
    const pontaEsq = i === 0 || v.xs[i]! - v.xs[i - 1]! > passo * 1.5;
    const pontaDir = i === n - 1 || v.xs[i + 1]! - v.xs[i]! > passo * 1.5;
    const lado = pontaEsq || pontaDir ? 0.3 : 1;
    for (const l of linhas) {
      pos.push(v.xs[i]!, v.ys[i]! + l.dy, 0);
      cor.push(0, 0, 0, l.a * lado);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (v.xs[i + 1]! - v.xs[i]! > passo * 1.5) continue;
    for (let j = 0; j < linhas.length - 1; j++) {
      const a = i * 3 + j;
      const b = (i + 1) * 3 + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(cor, 4));
  g.setIndex(idx);
  return g;
}

/** Cor do elástico das tranças quando a roupa não tem cor de destaque. */
const COR_DO_ENFEITE = "#ec4899";

/**
 * Um enfeite colorido do penteado: o mesmo material do cabelo (giro do pescoço e a faixa lisa
 * da textura), pintado com a cor dele — "" = a cor de destaque da roupa; "cor1|cor2" = cores
 * fixas (a cor 2 onde a máscara da malha é 1, como as mechas).
 */
function EnfeiteDoCabelo({
  geometria,
  cor,
  corDestaque,
  qualidade,
}: {
  geometria: BufferGeometry;
  cor: string;
  corDestaque: string;
  qualidade: ContextoAvatar["qualidade"];
}) {
  const gl = useThree((s) => s.gl);
  const material = useMemo(
    () => criarMaterialCabelo({ qualidade, cachos: false, anel: false, gl }),
    [qualidade, gl],
  );
  const [c1, c2] = cor ? cor.split("|") : [corDestaque, corDestaque];
  useLayoutEffect(
    () => definirCores(material, c1 ?? corDestaque, c2 ?? c1 ?? corDestaque),
    [material, c1, c2, corDestaque],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      geometry={geometria}
      material={material}
      castShadow
      ref={(me: Mesh | null) => {
        if (me) ligarGiro(me);
      }}
    />
  );
}

function CabeloMalha({
  chave,
  config,
  m,
  ctx,
}: {
  chave: string;
  config: AvatarConfig;
  m: Medidas;
  ctx: ContextoAvatar;
}) {
  const gl = useThree((s) => s.gl);
  const frameloop = useThree((s) => s.frameloop);
  const estilo = config.cabelo as EstiloCabelo;
  const c = useMemo(
    () => ctxDoCabelo(config, m, ctx.pose, ctx.qualidade),
    [config, m, ctx.pose, ctx.qualidade],
  );
  // Na sala (média, quadro contínuo) a malha completa entra na fila: 1 trabalho pesado por
  // quadro para a sala inteira. Até lá, só a casca (barata, síncrona).
  const adiar = ctx.qualidade === "media" && frameloop !== "demand";
  const [pronta, setPronta] = useState<GeoCabelo | null>(() =>
    adiar ? emCache(chave) : obterGeo(chave, () => montarCabelo(estilo, c)),
  );
  const casca = useMemo(
    () => (pronta ? null : obterGeo(chave + "|casca", () => montarCabelo(estilo, c, true))),
    [pronta, chave, estilo, c],
  );
  useDrenarFila();
  useEffect(() => {
    if (pronta) return;
    return enfileirar(chave, () => setPronta(obterGeo(chave, () => montarCabelo(estilo, c))));
  }, [pronta, chave, estilo, c]);
  const usada = pronta ? chave : chave + "|casca";
  useEffect(() => {
    reter(usada);
    return () => soltar(usada);
  }, [usada]);

  const geo = pronta ?? casca;
  const usaCachos = !!geo?.usaCachos;
  const usaBrilho = !!geo?.usaBrilho;
  const material = useMemo(
    () => criarMaterialCabelo({ qualidade: ctx.qualidade, cachos: usaCachos, anel: usaBrilho, gl }),
    [ctx.qualidade, usaCachos, usaBrilho, gl],
  );
  // penteado com as luzes desenhadas (longo com luzes na frente): se a cor das mechas for a
  // mesma do cabelo, as luzes saem num tom mais claro dele (senão sumiriam)
  const corMechas =
    estilo === "longoMechas" && config.corMechas.toLowerCase() === config.corCabelo.toLowerCase()
      ? clarear(config.corCabelo, 0.3)
      : config.corMechas;
  useLayoutEffect(
    () => definirCores(material, config.corCabelo, corMechas),
    [material, config.corCabelo, corMechas],
  );
  useEffect(() => () => material.dispose(), [material]);

  // enfeites coloridos do penteado (elástico das tranças, flor): uma malha por cor
  const enfeites = pronta?.enfeites ?? [];
  const corDestaque = config.corRoupa2 || COR_DO_ENFEITE;

  const veu = pronta?.veu ?? null;
  const veuGeo = useMemo(() => (veu ? geoVeu(veu, m.cabeca) : null), [veu, m.cabeca]);
  const veuMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: "#000000",
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  );
  useEffect(
    () => () => {
      veuGeo?.dispose();
    },
    [veuGeo],
  );
  useEffect(() => () => veuMat.dispose(), [veuMat]);

  if (!geo) return null;
  return (
    <group key={pronta ? "pronto" : "casca"}>
      <mesh
        geometry={geo.geometria}
        material={material}
        castShadow
        ref={(me: Mesh | null) => {
          if (me) ligarGiro(me);
        }}
      />
      {enfeites.map((e) => (
        <EnfeiteDoCabelo
          key={e.cor}
          geometria={e.geometria}
          cor={e.cor}
          corDestaque={corDestaque}
          qualidade={ctx.qualidade}
        />
      ))}
      {veuGeo && (
        <mesh
          geometry={veuGeo}
          material={veuMat}
          renderOrder={1}
          position={[0, 0, (m.cabeca * 0.92) / 2 + 0.004]}
        />
      )}
    </group>
  );
}

/**
 * O motor antigo (penteados ainda não portados): a base (capa no alto e
 * nuca, para não aparecer pele entre as mechas) e as mechas de `cabelos-3d.ts`.
 */
function CabeloAntigo({ config, m }: { config: AvatarConfig; m: Medidas }) {
  const t = m.cabeca;
  const d = t * 0.92;
  const topo = t / 2;
  const coberto = COBRE_O_ALTO.has(config.chapeu);
  const geo = useMemo(
    () =>
      gerarCabelo(config.cabelo, config.corCabelo, {
        t,
        peito: m.troncoD / 2,
        ombroX: m.troncoW / 2 + m.bracoW,
        coberto,
      }),
    [config.cabelo, config.corCabelo, t, m, coberto],
  );
  const base = baseDoCabelo(config.cabelo);
  const fios = useMemo(
    () => (base === "liso" ? desenharFios(config.corCabelo) : null),
    [base, config.corCabelo],
  );
  useEffect(
    () => () => {
      geo?.dispose();
      fios?.dispose();
    },
    [geo, fios],
  );
  const fundo = escurecer(config.corCabelo, base === "rente" ? 0.35 : 0.2);
  return (
    <group>
      {base === "capa" && (
        <>
          {!coberto && (
            <Bloco
              tam={[t + 0.03, 0.12, d + 0.03]}
              pos={[0, topo - 0.02, 0]}
              cor={fundo}
              raio={0.06}
            />
          )}
          <Bloco
            tam={[t + 0.03, t * 0.62, (d + 0.03) / 2]}
            pos={[0, topo - t * 0.31, -(d + 0.03) / 4]}
            cor={fundo}
            raio={0.05}
          />
        </>
      )}
      {base === "liso" && (
        <>
          {!coberto && (
            <Bloco
              tam={[t + 0.03, 0.14, d + 0.03]}
              pos={[0, topo - 0.025, 0]}
              cor={config.corCabelo}
              mapa={fios}
              raio={0.065}
              brilho={0.35}
            />
          )}
          <Bloco
            tam={[t + 0.03, t * 0.68, (d + 0.03) * 0.55]}
            pos={[0, topo - t * 0.34, -(d + 0.03) * 0.225]}
            cor={config.corCabelo}
            mapa={fios}
            raio={0.06}
            brilho={0.35}
          />
        </>
      )}
      {base === "rente" && (
        <>
          {!coberto && (
            <Bloco
              tam={[t + 0.006, 0.05, d + 0.006]}
              pos={[0, topo - 0.02, 0]}
              cor={fundo}
              raio={0.025}
            />
          )}
          <Bloco
            tam={[t + 0.008, t * 0.45, 0.03]}
            pos={[0, topo - t * 0.25, -d / 2 + 0.01]}
            cor={fundo}
            raio={0.012}
          />
        </>
      )}
      {geo && (
        <mesh geometry={geo} castShadow>
          <meshStandardMaterial vertexColors roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}

/* ————————————————— Barba 3D ————————————————— */

/**
 * A barba em volume (hoje só a "lenhador"; as outras continuam desenhadas no
 * adesivo do rosto e aqui retornam null). Mesmo material do cabelo, com a
 * cor da barba no uniform. `cor` = a mesma expressão de cor que o bloco antigo
 * usava (`escurecer(corCabelo, 0,15)`), calculada por quem chama.
 */
export function Barba3D({
  tipo,
  cor,
  t,
  m,
}: {
  tipo: AvatarConfig["barba"];
  cor: string;
  t: number;
  m: Medidas;
}) {
  if (tipo !== "lenhador") return null;
  return <BarbaMalha key={`barba-${t}`} cor={cor} t={t} m={m} />;
}

function BarbaMalha({ cor, t }: { cor: string; t: number; m: Medidas }) {
  const gl = useThree((s) => s.gl);
  const { qualidade } = useContext(ContextoDoAvatar);
  const chave = `barba|${t.toFixed(3)}|${qualidade}`;
  const geo = useMemo(
    () => obterGeo(chave, () => montarBarba(t, qualidade)),
    [chave, t, qualidade],
  );
  useEffect(() => {
    reter(chave);
    return () => soltar(chave);
  }, [chave]);
  const material = useMemo(
    () => criarMaterialCabelo({ qualidade, cachos: false, anel: false, gl }),
    [qualidade, gl],
  );
  useLayoutEffect(() => definirCores(material, cor, cor), [material, cor]);
  useEffect(() => () => material.dispose(), [material]);
  if (!geo) return null;
  return <mesh geometry={geo.geometria} material={material} castShadow />;
}

/* ————————————————— Chapéus ————————————————— */

/** Topo do cabelo (acima do alto da cabeça) no corpo atual; 0 para o motor antigo. */
function topoDoCabelo(cabelo: AvatarConfig["cabelo"] | undefined, t: number) {
  if (!cabelo || cabelo === "careca") return 0;
  return ((ALTURA_TOPO[cabelo as EstiloCabelo] ?? 0) * t) / 0.46;
}

/** Altura do corte de um chapéu que cobre o alto (rel. ao centro da cabeça). */
function corteDe(tipo: TipoChapeu, t: number) {
  return t / 2 - ((CORTE_DO_CHAPEU[tipo] ?? 0.04) * t) / 0.46;
}

/** O chapéu de aba reestilizado (C3.2): base no corte do cabelo, envolvendo a cabeça. */
function ChapeuAba({ cor, t }: { cor: string; t: number }) {
  const gl = useThree((s) => s.gl);
  const { qualidade } = useContext(ContextoDoAvatar);
  const base = corteDe("chapeu", t);
  const geo = useMemo(() => geoChapeuAba(t, base, qualidade === "alta"), [t, base, qualidade]);
  const mat = useMemo(
    () =>
      new MeshStandardMaterial({
        map: texturaChapeu("chapeu", gl),
        vertexColors: true,
        roughness: 0.85,
      }),
    [gl],
  );
  useLayoutEffect(() => {
    mat.color.set(cor);
  }, [mat, cor]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh geometry={geo} material={mat} castShadow />;
}

/**
 * Tiara: um arco que passa POR CIMA do cabelo de orelha a orelha, medido pelo
 * penteado (altura do topo e largura dos lados) — não mais uma trave solta.
 */
function Tiara({
  cor,
  t,
  alto,
  largura,
}: {
  cor: string;
  t: number;
  alto: number;
  largura: number;
}) {
  const geo = useMemo(() => {
    const d = t * 0.92;
    const a = Math.max(t / 2 + 0.03, largura / 2 + 0.01);
    const b = t / 2 + alto;
    const pts: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const th = -0.93 * (Math.PI / 2) + (i / 16) * 0.93 * Math.PI;
      // um pouco à frente do meio da cabeça, inclinada para a frente no alto
      const y = 0.03 + (b - 0.03) * Math.cos(th);
      pts.push(new Vector3(a * Math.sin(th), y, d * 0.12 + 0.03 * Math.cos(th)));
    }
    return new TubeGeometry(new CatmullRomCurve3(pts), 48, 0.019, 8, false);
  }, [t, alto, largura]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={cor} roughness={0.35} metalness={0.15} />
    </mesh>
  );
}

/** O chapéu/enfeite (assinatura congelada). Cada ramo fica num grupo com a key do tipo. */
export function Chapeu({ tipo, cor, t }: { tipo: AvatarConfig["chapeu"]; cor: string; t: number }) {
  const ctx = useContext(ContextoDoAvatar);
  const cabelo = ctx.config?.cabelo;
  const d = t * 0.92;
  const topo = t / 2;
  // Enfeites que não cobrem o alto sobem e abrem com o volume do cabelo (medido).
  const alturaCab = topoDoCabelo(cabelo, t);
  const dy = Math.max(0, alturaCab - 0.335 * t);
  const estilo = cabelo as EstiloCabelo | undefined;
  const largTopo = estilo ? ((LARGURA_TOPO[estilo] ?? t) * t) / 0.46 : t;
  const largLado = estilo ? ((LARGURA_LATERAL[estilo] ?? 0) * t) / 0.46 : 0;
  const escalaTopo = 1 + 0.5 * (largTopo / t - 1);
  switch (tipo as TipoChapeu) {
    case "bone":
    case "boneTras": {
      const tras = tipo === "boneTras";
      return (
        <group key={tipo}>
          <Bloco tam={[t + 0.04, 0.17, d + 0.04]} pos={[0, topo + 0.03, 0]} cor={cor} raio={0.08} />
          <Bloco
            tam={[t * 0.8, 0.03, 0.2]}
            pos={[0, topo - 0.04, tras ? -d / 2 - 0.08 : d / 2 + 0.08]}
            cor={escurecer(cor, 0.1)}
            raio={0.012}
          />
        </group>
      );
    }
    case "gorro":
      return (
        <group key={tipo}>
          <Bloco tam={[t + 0.05, 0.24, d + 0.05]} pos={[0, topo + 0.06, 0]} cor={cor} raio={0.1} />
          <Bloco
            tam={[t + 0.07, 0.08, d + 0.07]}
            pos={[0, topo - 0.04, 0]}
            cor={escurecer(cor, 0.2)}
            raio={0.03}
          />
          <mesh position={[0, topo + 0.21, 0]}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial color="#f8fafc" roughness={1} />
          </mesh>
        </group>
      );
    case "chapeu":
      return (
        <group key={tipo}>
          <ChapeuAba cor={cor} t={t} />
        </group>
      );
    case "capacete":
      return (
        <group key={tipo} position={[0, topo - 0.02, 0]}>
          <mesh position={[0, 0.05, 0]} scale={[1, 0.62, 1]}>
            <sphereGeometry args={[t * 0.62, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={cor} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.05, 0.02]} scale={[1, 1, 1.15]}>
            <cylinderGeometry args={[t * 0.72, t * 0.72, 0.025, 40]} />
            <meshStandardMaterial color={cor} roughness={0.35} />
          </mesh>
          <Bloco
            tam={[0.06, 0.06, t * 1.15]}
            pos={[0, 0.22, 0]}
            cor={escurecer(cor, 0.08)}
            raio={0.025}
          />
        </group>
      );
    case "cartola": {
      // assentada no corte do cabelo (sem fresta entre a aba e o cabelo): a copa abraça a
      // cabeça ali, e o cabelo que sai por baixo passa sob a aba
      const esp = CARTOLA.espAba;
      return (
        <group key={tipo} position={[0, corteDe("cartola", t) + esp / 2, 0]}>
          <mesh>
            <cylinderGeometry args={[t * CARTOLA.aba, t * CARTOLA.aba, esp, 40]} />
            <meshStandardMaterial color={cor} />
          </mesh>
          <mesh position={[0, CARTOLA.alt / 2, 0]}>
            <cylinderGeometry args={[t * CARTOLA.copa * 0.96, t * CARTOLA.copa, CARTOLA.alt, 32]} />
            <meshStandardMaterial color={cor} />
          </mesh>
          <mesh position={[0, 0.045, 0]}>
            <cylinderGeometry args={[t * CARTOLA.faixa, t * CARTOLA.faixa, 0.06, 32]} />
            <meshStandardMaterial color="#b91c1c" />
          </mesh>
        </group>
      );
    }
    case "fone": {
      const xc = Math.max(t / 2 + 0.04, largLado / 2 + 0.02);
      return (
        <group key={tipo}>
          <mesh position={[0, topo - 0.04 + dy, 0]} scale={[xc / (t / 2 + 0.04), 1, 1]}>
            <torusGeometry args={[t / 2 + 0.04, 0.025, 10, 32, Math.PI]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[xc * l, -0.02, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.09, 0.09, 0.08, 24]} />
              <meshStandardMaterial color={cor} />
            </mesh>
          ))}
        </group>
      );
    }
    case "coroa":
      return (
        <group key={tipo} position={[0, topo + 0.06 + dy, 0]} scale={[escalaTopo, 1, escalaTopo]}>
          <mesh>
            <cylinderGeometry args={[t * 0.42, t * 0.42, 0.1, 8, 1, true]} />
            <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} side={2} />
          </mesh>
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * t * 0.42, 0.1, Math.sin(a) * t * 0.42]}>
                <coneGeometry args={[0.035, 0.1, 4]} />
                <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.25} />
              </mesh>
            );
          })}
          <mesh position={[0, 0, t * 0.43]}>
            <sphereGeometry args={[0.025, 12, 12]} />
            <meshStandardMaterial color="#dc2626" />
          </mesh>
        </group>
      );
    case "laco": {
      // o laço fica de lado no alto: sobe com o volume do cabelo ali (o anime cobria o laço)
      const dyLaco = Math.max(dy, alturaCab - 0.1 * (t / 0.46));
      return (
        <group key={tipo} position={[t * 0.22, topo + 0.1 + dyLaco, d * 0.12]} rotation-z={-0.3}>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[0.065 * l, 0, 0]} rotation-z={(Math.PI / 2) * l}>
              <coneGeometry args={[0.065, 0.12, 4]} />
              <meshStandardMaterial color={cor} roughness={0.5} />
            </mesh>
          ))}
          <mesh>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshStandardMaterial color={escurecer(cor, 0.2)} />
          </mesh>
        </group>
      );
    }
    case "tiara":
      return (
        <group key={tipo}>
          <Tiara cor={cor} t={t} alto={Math.max(0.04, alturaCab + 0.015)} largura={largLado} />
        </group>
      );
    case "flores": {
      const petalas = [cor, "#f9a8d4", "#c4b5fd", "#f8fafc"];
      return (
        <group key={tipo} position={[0, dy, 0]}>
          {Array.from({ length: 7 }, (_, i) => {
            const a = Math.PI * (0.06 + (i / 6) * 0.88);
            return (
              <group
                key={i}
                position={[
                  Math.cos(a) * (t / 2 + 0.05),
                  topo - 0.04 + Math.sin(a) * 0.17,
                  d * 0.22,
                ]}
              >
                <mesh>
                  <sphereGeometry args={[0.07, 14, 10]} />
                  <meshStandardMaterial color={petalas[i % petalas.length]} roughness={0.7} />
                </mesh>
                <mesh position={[0, 0, 0.06]}>
                  <sphereGeometry args={[0.026, 10, 8]} />
                  <meshStandardMaterial color="#facc15" />
                </mesh>
              </group>
            );
          })}
        </group>
      );
    }
    case "oculosNaCabeca":
      return (
        <group key={tipo} position={[0, topo + 0.07 + dy, d / 2 - 0.03]} rotation-x={-0.35}>
          {[-1, 1].map((l) => (
            <Bloco
              key={l}
              tam={[0.15, 0.085, 0.03]}
              pos={[0.088 * l, 0, 0]}
              cor="#0f172a"
              raio={0.025}
              brilho={0.15}
            />
          ))}
          <mesh>
            <boxGeometry args={[0.04, 0.015, 0.02]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {[-1, 1].map((l) => (
            <mesh key={`h${l}`} position={[0.17 * l, 0, -0.1]}>
              <boxGeometry args={[0.012, 0.012, 0.2]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          ))}
        </group>
      );
    case "orelhas":
      return (
        <group key={tipo} position={[0, dy, 0]}>
          {[-1, 1].map((l) => (
            <group key={l} position={[t * 0.32 * l, topo + 0.19, -0.02]} rotation-z={-0.25 * l}>
              <mesh>
                <coneGeometry args={[0.1, 0.2, 4]} />
                <meshStandardMaterial color={cor} />
              </mesh>
              <mesh position={[0, -0.01, 0.045]} scale={[0.6, 0.7, 0.4]}>
                <coneGeometry args={[0.1, 0.2, 4]} />
                <meshStandardMaterial color="#f9a8d4" />
              </mesh>
            </group>
          ))}
        </group>
      );
    default: {
      // os chapéus novos do catálogo (16/10/2026): `chapeu-novo.tsx` (null se não for um deles)
      const corte = CORTE_DO_CHAPEU[tipo as TipoChapeu] === undefined ? null : corteDe(tipo, t);
      return (
        <ChapeuNovo
          key={tipo}
          tipo={tipo}
          cor={cor}
          t={t}
          ctx={{ corte, alturaCab, largTopo, largLado }}
        />
      );
    }
  }
}

/** Altura do topo de cabelo + chapéu acima do alto da cabeça (t/2): o rótulo do nome fica acima. */
export function alturaAcimaDaCabeca(cfg: AvatarConfig, t: number): number {
  const esc = t / 0.46;
  const tipo = cfg.chapeu as TipoChapeu;
  const alturaCab = topoDoCabelo(cfg.cabelo, t);
  const cabelo = COBRE_O_ALTO.has(tipo) ? 0 : Math.max(0.06 * esc, alturaCab);
  const dy = Math.max(0, alturaCab - 0.335 * t);
  const corte = ((CORTE_DO_CHAPEU[tipo] ?? 0) * t) / 0.46;
  const chapeu: Partial<Record<TipoChapeu, number>> = {
    bone: 0.115,
    boneTras: 0.115,
    gorro: 0.27,
    chapeu: alturaChapeuAba(t) - corte,
    capacete: 0.22,
    cartola: CARTOLA.espAba / 2 + CARTOLA.alt - corte,
    coroa: 0.16 + dy,
    tiara: Math.max(0.04, alturaCab + 0.015) + 0.02,
    laco: 0.17 + Math.max(dy, alturaCab - 0.1 * esc),
    flores: 0.2 + dy,
    oculosNaCabeca: 0.11 + dy,
    orelhas: 0.29 + dy,
    fone: 0.03 + dy,
  };
  // os chapéus novos (16/10/2026) têm a altura medida na bancada
  const corteNovo = CORTE_DO_CHAPEU[tipo] === undefined ? null : corteDe(tipo, t);
  const novo = alturaDoChapeuNovo(tipo, t, corteNovo, alturaCab);
  return Math.max(cabelo, chapeu[tipo] ?? novo ?? 0);
}
