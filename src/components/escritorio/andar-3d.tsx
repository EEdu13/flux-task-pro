/*
 * O andar inteiro em 3D (18/10/2026): todas as salas dos setores, as
 * gerências e o refeitório, num corredor só. De longe, a planta com o nome de
 * cada sala; clicando numa sala (ou aproximando com a roda do mouse) a câmera
 * "entra" por cima e as pessoas aparecem de verdade.
 *
 * `foco` move a câmera: o andar todo, uma sala, a área de um gerente (a
 * gerência e os setores dele) ou a sala onde uma pessoa está. Arrastar
 * cancela o voo — quem manda é a mão de quem está olhando.
 *
 * Carregado sob demanda pela tela de Contatos (three.js é pesado).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { type DirectionalLight, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { QualidadeDoAvatar } from "@/components/rv/contexto-avatar";
import type { MedidaDoAvatar } from "@/components/rv/sala/avatar-na-cadeira";
import { AVATAR_EM_BRANCO, carregarAvataresDe, type AvatarConfig } from "@/lib/avatar-3d";
import { comChapeuDeFesta, useAniversariosDeHoje } from "@/lib/festa-de-aniversario";
import { PlantaAlta } from "./acabamento";
import {
  LARGURA_DO_CORREDOR,
  PROFUNDIDADE_DA_SALA,
  montarAndar,
  type AndarMontado,
  type PessoaNoAndar,
  type SalaNoAndar,
  type SetorDoAndar,
} from "./andar";
import { planoComUV, porcelanato } from "./materiais";
import { EMOJI_DA_SALA, LONGE, PERTO, SalaDoAndar } from "./sala-do-andar";
import { Estatico } from "./mesclar";

export type FocoDoAndar =
  | { tipo: "andar"; n: number }
  | { tipo: "sala"; id: string; n: number }
  | { tipo: "area"; id: string; n: number }
  | { tipo: "pessoa"; id: string; n: number };

type Caixa = { x0: number; x1: number; z0: number; z1: number };

export default function Andar3D({
  setores,
  pessoas,
  foco,
  aoEscolherPessoa,
}: {
  setores: SetorDoAndar[];
  pessoas: PessoaNoAndar[];
  foco: FocoDoAndar;
  aoEscolherPessoa: (id: string) => void;
}) {
  const andar = useMemo(() => montarAndar(setores, pessoas), [setores, pessoas]);

  /* Os bonecos de todo mundo numa ida só; quem não montou o seu é o em branco. */
  const chaveDosIds = pessoas.map((p) => p.id).join(",");
  const [avatares, setAvatares] = useState<Map<string, AvatarConfig | null> | null>(null);
  useEffect(() => {
    let vivo = true;
    const ids = chaveDosIds ? chaveDosIds.split(",") : [];
    carregarAvataresDe(ids)
      .then((m) => vivo && setAvatares(m))
      .catch((e: unknown) => {
        console.warn("escritório: não deu para carregar os avatares", e);
        if (vivo) setAvatares(new Map());
      });
    return () => {
      vivo = false;
    };
  }, [chaveDosIds]);
  // Aniversariante de hoje: chapéu de festa no 3D também (19/10/2026).
  const versaoDosAniversarios = useAniversariosDeHoje();
  const configDe = useCallback(
    (id: string) => (avatares ? comChapeuDeFesta(id, avatares.get(id) ?? AVATAR_EM_BRANCO) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [avatares, versaoDosAniversarios],
  );

  // A elevação da cadeira de cada um (medida no boneco montado, como na sala de reunião).
  const [elevacoes, setElevacoes] = useState<Record<string, number>>({});
  const aoMedir = useCallback((id: string, m: MedidaDoAvatar) => {
    setElevacoes((e) =>
      Math.abs((e[id] ?? 0) - m.elevacao) < 0.002 ? e : { ...e, [id]: m.elevacao },
    );
  }, []);

  // A sala com a parede da esquerda: a que não tem vizinha encostada.
  const comParedeEsquerda = useMemo(() => {
    const s = new Set<string>();
    for (const sala of andar.salas) {
      const vizinha = andar.salas.some(
        (o) => o !== sala && o.fileira === sala.fileira && Math.abs(o.x1 - sala.x0) < 0.01,
      );
      if (!vizinha) s.add(sala.id);
    }
    return s;
  }, [andar]);

  const [entrar, setEntrar] = useState<{
    caixa: Caixa;
    fileira?: "cima" | "baixo";
    n: number;
  } | null>(null);
  const visivel = useAbaVisivel();
  const comprimento = andar.corredor.x1 - andar.corredor.x0;
  const larguraTotal = LARGURA_DO_CORREDOR + PROFUNDIDADE_DA_SALA * 2;

  // A contagem de cada sala, para o letreiro de longe.
  const contagem = (s: SalaNoAndar) =>
    s.tipo === "refeitorio" ? andar.naCopa.length : s.mesas.filter((m) => m.pessoa).length;
  const letreiros = useRef(new Map<string, HTMLButtonElement>());
  const entrarNa = (s: SalaNoAndar) => setEntrar({ caixa: s, fileira: s.fileira, n: Date.now() });

  /* Desempenho (18/10/2026: "travando, esquentando o notebook"): o Canvas só
     desenha quando precisa (`frameloop="demand"`) — câmera mexendo, voo, ou
     alguma sala aberta de perto, que anima a 30 quadros por segundo. Parado
     na visão do andar, ele não desenha nada. */
  const salasPerto = useRef(new Set<string>());
  /* A sala em foco (19/10/2026): só ela mostra avatares de verdade. É a sala
     para onde a câmera aponta, com a câmera perto o bastante. */
  const [emFoco, setEmFoco] = useState<string | null>(null);
  const aoMudarFoco = useCallback((id: string | null) => {
    salasPerto.current = new Set(id ? [id] : []);
    setEmFoco(id);
  }, []);
  // As peças paradas mudaram: a sombra fixa é refeita no próximo quadro.
  const refazerSombra = useRef(() => {});
  const aoJuntar = useCallback(() => refazerSombra.current(), []);

  return (
    <div className="relative isolate h-full w-full overflow-hidden">
      <SemTresD>
        <Canvas
          shadows
          dpr={[1, 1.25]}
          frameloop={visivel ? "demand" : "never"}
          camera={{
            position: [0, comprimento * 0.5, comprimento * 0.42],
            fov: 40,
            near: 0.1,
            far: 400,
          }}
          gl={{ alpha: true, antialias: true }}
          style={{ background: "transparent" }}
        >
          <hemisphereLight args={["#ffffff", "#d6d3cc", 0.95]} />
          <ambientLight intensity={0.2} />
          <LuzFixa comprimento={comprimento} largura={larguraTotal} refazer={refazerSombra} />
          <Animador salasPerto={salasPerto} />

          {/* a laje, o porcelanato, o corredor e a convivência: tudo parado */}
          <Estatico
            chave={`andar|${comprimento}|${andar.salas.map((s) => `${s.id}:${s.x0.toFixed(2)}:${s.x1.toFixed(2)}`).join(",")}`}
            aoJuntar={aoJuntar}
          >
            <mesh position={[0, -0.16, 0]} receiveShadow>
              <boxGeometry args={[comprimento + 1.2, 0.3, larguraTotal + 1.2]} />
              <meshStandardMaterial color="#9ca3af" roughness={0.9} />
            </mesh>
            <Piso largura={comprimento} fundo={larguraTotal} />
            <EnfeitesDoCorredor andar={andar} />
            <Convivencia andar={andar} />
          </Estatico>

          <QualidadeDoAvatar.Provider value="media">
            {andar.salas.map((sala) => (
              <SalaDoAndar
                key={sala.id}
                sala={sala}
                paredeEsquerda={comParedeEsquerda.has(sala.id)}
                configDe={configDe}
                elevacoes={elevacoes}
                aoMedir={aoMedir}
                naCopa={sala.tipo === "refeitorio" ? andar.naCopa : undefined}
                aoEscolherPessoa={aoEscolherPessoa}
                perto={emFoco === sala.id}
                aoJuntar={aoJuntar}
              />
            ))}
          </QualidadeDoAvatar.Provider>

          <Camera andar={andar} foco={foco} entrar={entrar} comprimento={comprimento} />
          <ProjetorDeLetreiros salas={andar.salas} letreiros={letreiros} emFoco={emFoco} />
          <EscolheSalaEmFoco salas={andar.salas} atual={emFoco} aoMudar={aoMudarFoco} />
        </Canvas>
      </SemTresD>

      {/* Os letreiros das salas (de longe). DOM comum por cima do 3D, movido a
        cada quadro pelo ProjetorDeLetreiros — sem o <Html> do drei, que no
        React 19 às vezes perdia um letreiro (o da recepção sumia). */}
      <div className="pointer-events-none absolute inset-0">
        {andar.salas.map((s) => {
          const n = contagem(s);
          return (
            <button
              key={s.id}
              ref={(el) => {
                if (el) letreiros.current.set(s.id, el);
                else letreiros.current.delete(s.id);
              }}
              type="button"
              onClick={() => entrarNa(s)}
              className="pointer-events-auto absolute left-0 top-0 flex select-none flex-col items-center whitespace-nowrap rounded-xl border-2 bg-white/95 px-3 py-1 text-center shadow-lg transition-[scale] hover:scale-105"
              style={{ borderColor: s.cor, visibility: "hidden" }}
            >
              <span className="text-[13px] font-extrabold uppercase tracking-tight text-slate-800">
                {EMOJI_DA_SALA[s.tipo]}
                {s.rotulo ?? s.titulo}
              </span>
              {s.subtitulo ? (
                <span className="text-[10px] font-semibold text-slate-500">{s.subtitulo}</span>
              ) : (
                s.tipo !== "reuniao" && (
                  <span className="text-[10px] font-semibold text-slate-500">
                    {n} {s.tipo === "refeitorio" ? "na pausa" : n === 1 ? "pessoa" : "pessoas"}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Põe cada letreiro em cima da sala dele, na tela, a cada quadro (mexe só no
 * `transform` — nada de render do React). Some quando a sala está perto (já
 * se "entrou" nela) ou fica atrás da câmera. Mesmos limites de perto/longe
 * da sala.
 */
function ProjetorDeLetreiros({
  salas,
  letreiros,
  emFoco,
}: {
  salas: SalaNoAndar[];
  letreiros: React.RefObject<Map<string, HTMLButtonElement>>;
  emFoco: string | null;
}) {
  const v = useMemo(() => new Vector3(), []);
  /* Quem tem prioridade quando dois letreiros se encostam (18/10/2026: "tá
     muito ruim assim"): diretoria, gerências, recepção e refeitório sempre;
     depois os setores maiores. Os que não cabem somem e voltam com o zoom. */
  const ordem = useMemo(() => {
    const peso: Record<SalaNoAndar["tipo"], number> = {
      diretoria: 0,
      gerencia: 1,
      recepcao: 2,
      refeitorio: 3,
      setor: 4,
      reuniao: 5,
    };
    return [...salas].sort(
      (a, b) => peso[a.tipo] - peso[b.tipo] || b.mesas.length - a.mesas.length,
    );
  }, [salas]);
  useFrame(({ camera, size }) => {
    const ocupados: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const s of ordem) {
      const el = letreiros.current?.get(s.id);
      if (!el) continue;
      const cx = (s.x0 + s.x1) / 2;
      const cz = (s.z0 + s.z1) / 2;
      const d = Math.hypot(camera.position.x - cx, camera.position.y - 1, camera.position.z - cz);
      v.set(cx, 3.3, cz).project(camera);
      let visivel = s.id !== emFoco && v.z < 1;
      // Encolhe com a distância: de longe o letreiro é menor.
      const escala = Math.min(1, Math.max(0.62, 26 / d));
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      if (visivel) {
        const w = (el.offsetWidth * escala) / 2 + 3;
        const h = (el.offsetHeight * escala) / 2 + 3;
        const caixa = { x0: x - w, x1: x + w, y0: y - h, y1: y + h };
        const bate = ocupados.some(
          (o) => caixa.x0 < o.x1 && caixa.x1 > o.x0 && caixa.y0 < o.y1 && caixa.y1 > o.y0,
        );
        if (bate) visivel = false;
        else ocupados.push(caixa);
      }
      el.style.visibility = visivel ? "visible" : "hidden";
      if (!visivel) continue;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${escala})`;
    }
  });
  return null;
}

/**
 * Qual sala está em foco: a que contém o ponto para onde a câmera olha, com a
 * câmera a menos de `PERTO` dele. Com folga para sair (o ponto pode passar um
 * pouco da parede e a câmera se afastar até `LONGE`), para não ficar trocando.
 * Olha em todo quadro desenhado (é barato: só os limites das salas) — e o
 * andar só desenha quadros quando algo mexe.
 */
function EscolheSalaEmFoco({
  salas,
  atual,
  aoMudar,
}: {
  salas: SalaNoAndar[];
  atual: string | null;
  aoMudar: (id: string | null) => void;
}) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useFrame(({ camera }) => {
    if (!controls) return;
    const t = controls.target;
    const d = camera.position.distanceTo(t);
    const dentro = (s: SalaNoAndar, folga: number) =>
      t.x > s.x0 - folga && t.x < s.x1 + folga && t.z > s.z0 - folga && t.z < s.z1 + folga;
    const salaAtual = atual ? salas.find((s) => s.id === atual) : undefined;
    if (salaAtual && d < LONGE && dentro(salaAtual, 0.8)) return;
    const nova = d < PERTO ? salas.find((s) => dentro(s, 0)) : undefined;
    const id = nova?.id ?? null;
    if (id !== atual) aoMudar(id);
  });
  return null;
}

/**
 * Enquanto houver sala aberta de perto (avatares digitando, papéis voando),
 * pede um quadro a cada ~33 ms — 30 por segundo, metade do que o navegador
 * faria. Sem sala perto, não pede nada: o andar fica parado e frio.
 */
function Animador({ salasPerto }: { salasPerto: React.RefObject<Set<string>> }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (salasPerto.current && salasPerto.current.size > 0) invalidate();
    }, 33);
    return () => window.clearInterval(id);
  }, [invalidate, salasPerto]);
  return null;
}

/**
 * O sol, PARADO, cobrindo o andar inteiro, e a sombra calculada uma vez só
 * (e de novo quando as peças paradas mudam ou alguém aparece perto) — em vez
 * de refazer o mapa de sombra a cada quadro.
 */
function LuzFixa({
  comprimento,
  largura,
  refazer,
}: {
  comprimento: number;
  largura: number;
  refazer: React.MutableRefObject<() => void>;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const luz = useRef<DirectionalLight>(null);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    refazer.current = () => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    };
    refazer.current();
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl, invalidate, refazer]);
  useEffect(() => {
    const l = luz.current;
    if (!l) return;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
    refazer.current();
  }, [comprimento, largura, refazer]);
  const meio = Math.max(comprimento, largura) / 2 + 4;
  return (
    <directionalLight
      ref={luz}
      position={[-8, 20, 10]}
      intensity={1.35}
      castShadow
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
      shadow-camera-left={-meio}
      shadow-camera-right={meio}
      shadow-camera-top={meio}
      shadow-camera-bottom={-meio}
      shadow-camera-near={1}
      shadow-camera-far={80}
    />
  );
}

function Piso({ largura, fundo }: { largura: number; fundo: number }) {
  const textura = porcelanato();
  const geo = useMemo(() => planoComUV(largura, fundo, 1.6), [largura, fundo]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow>
      <meshStandardMaterial map={textura ?? undefined} roughness={0.35} metalness={0.05} />
    </mesh>
  );
}

/** Plantas altas no corredor, a cada ~8 m, encostadas nas divisórias. */
function EnfeitesDoCorredor({ andar }: { andar: AndarMontado }) {
  const { x0, x1, z0, z1 } = andar.corredor;
  const vasos: [number, number, number][] = [];
  for (let x = x0 + 1.2, i = 0; x < x1 - 0.8; x += 8, i++) {
    vasos.push([x, 0, i % 2 ? z0 + 0.35 : z1 - 0.35]);
  }
  return (
    <>
      {vasos.map((p) => (
        <PlantaAlta key={p.join(",")} pos={p} />
      ))}
    </>
  );
}

/**
 * Os vãos que sobram nas pontas das fileiras (uma fileira termina antes da
 * outra) viram área de convivência: tapete, sofá, poltrona e plantas — em vez
 * de chão vazio.
 */
function Convivencia({ andar }: { andar: AndarMontado }) {
  const vaos: { x0: number; x1: number; z: number; fileira: "cima" | "baixo" }[] = [];
  for (const fileira of ["cima", "baixo"] as const) {
    const salas = andar.salas.filter((s) => s.fileira === fileira).sort((a, b) => a.x0 - b.x0);
    let x = andar.corredor.x0 + 0.2;
    const z =
      fileira === "cima"
        ? -LARGURA_DO_CORREDOR / 2 - PROFUNDIDADE_DA_SALA / 2
        : LARGURA_DO_CORREDOR / 2 + PROFUNDIDADE_DA_SALA / 2;
    for (const s of [...salas, { x0: andar.corredor.x1 - 0.2, x1: andar.corredor.x1 - 0.2 }]) {
      if (s.x0 - x > 1.6) vaos.push({ x0: x, x1: s.x0, z, fileira });
      x = Math.max(x, s.x1);
    }
  }
  return (
    <>
      {vaos.map((v) => {
        const cx = (v.x0 + v.x1) / 2;
        const w = v.x1 - v.x0;
        const lado = v.fileira === "cima" ? 1 : -1;
        return (
          <group key={`${v.fileira}${v.x0}`}>
            <mesh rotation-x={-Math.PI / 2} position={[cx, 0.006, v.z]} receiveShadow>
              <planeGeometry args={[Math.min(w - 0.6, 3.6), 2.4]} />
              <meshStandardMaterial color="#8b9aa8" roughness={0.95} />
            </mesh>
            {/* sofá de costas para a parede de fora, virado para o corredor */}
            <group
              position={[cx, 0, v.z - lado * 0.9]}
              rotation-y={v.fileira === "cima" ? 0 : Math.PI}
            >
              <mesh position={[0, 0.22, 0]} castShadow>
                <boxGeometry args={[Math.min(w - 0.8, 2.2), 0.4, 0.8]} />
                <meshStandardMaterial color="#4b5563" roughness={0.8} />
              </mesh>
              <mesh position={[0, 0.55, -0.32]} castShadow>
                <boxGeometry args={[Math.min(w - 0.8, 2.2), 0.5, 0.2]} />
                <meshStandardMaterial color="#4b5563" roughness={0.8} />
              </mesh>
            </group>
            {/* mesinha de centro */}
            <mesh position={[cx, 0.22, v.z + lado * 0.2]} castShadow>
              <cylinderGeometry args={[0.35, 0.35, 0.44, 24]} />
              <meshStandardMaterial color="#b8865a" roughness={0.5} />
            </mesh>
            <PlantaAlta pos={[v.x0 + 0.45, 0, v.z - lado * 1.9]} />
            {w > 2.6 && <PlantaAlta pos={[v.x1 - 0.45, 0, v.z - lado * 1.9]} />}
          </group>
        );
      })}
    </>
  );
}

/* ————————————————— Câmera ————————————————— */

/** Onde a câmera fica para enquadrar `caixa`: por cima, um pouco inclinada. */
function enquadrar(caixa: Caixa, fileira?: "cima" | "baixo") {
  const cx = (caixa.x0 + caixa.x1) / 2;
  const cz = (caixa.z0 + caixa.z1) / 2;
  const w = caixa.x1 - caixa.x0;
  const d = caixa.z1 - caixa.z0;
  const dist = Math.max(w * 1.05, d * 1.25, 6.5);
  // Olha de quem está no corredor: a fileira de cima é vista de +z; a de baixo, de −z.
  const lado = fileira === "baixo" ? -1 : 1;
  const dir = new Vector3(0, 0.86, 0.5 * lado).normalize();
  return {
    alvo: new Vector3(cx, 0.6, cz),
    pos: new Vector3(cx, 0.6, cz).addScaledVector(dir, dist),
  };
}

function caixaDoFoco(
  andar: AndarMontado,
  foco: FocoDoAndar,
): { caixa: Caixa; fileira?: "cima" | "baixo" } | null {
  const tudo: Caixa = {
    x0: andar.corredor.x0,
    x1: andar.corredor.x1,
    z0: -LARGURA_DO_CORREDOR / 2 - PROFUNDIDADE_DA_SALA,
    z1: LARGURA_DO_CORREDOR / 2 + PROFUNDIDADE_DA_SALA,
  };
  switch (foco.tipo) {
    case "andar":
      return { caixa: tudo };
    case "sala": {
      const s = andar.salas.find((x) => x.id === foco.id);
      return s ? { caixa: s, fileira: s.fileira } : { caixa: tudo };
    }
    case "area": {
      const a = andar.areas.get(foco.id);
      return a ? { caixa: a } : { caixa: tudo };
    }
    case "pessoa": {
      const naCopa = andar.naCopa.some((c) => c.pessoa.id === foco.id);
      const s: SalaNoAndar | undefined = naCopa
        ? andar.salas.find((x) => x.tipo === "refeitorio")
        : andar.salas.find((x) => x.mesas.some((m) => m.pessoa?.id === foco.id));
      return s ? { caixa: s, fileira: s.fileira } : { caixa: tudo };
    }
  }
}

function Camera({
  andar,
  foco,
  entrar,
  comprimento,
}: {
  andar: AndarMontado;
  foco: FocoDoAndar;
  entrar: { caixa: Caixa; fileira?: "cima" | "baixo"; n: number } | null;
  comprimento: number;
}) {
  const ref = useRef<OrbitControlsImpl>(null);
  const voo = useRef<{ alvo: Vector3; pos: Vector3 } | null>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const primeira = useRef(true);

  const voar = useCallback(
    (caixa: Caixa, fileira?: "cima" | "baixo") => {
      const v = enquadrar(caixa, fileira);
      if (primeira.current && ref.current) {
        // A primeira vez já nasce no lugar, sem voo.
        primeira.current = false;
        camera.position.copy(v.pos);
        ref.current.target.copy(v.alvo);
        ref.current.update();
        return;
      }
      voo.current = v;
      invalidate();
    },
    [camera, invalidate],
  );

  // `andar` muda a cada 10 s (presença) — só o foco novo move a câmera.
  const andarRef = useRef(andar);
  andarRef.current = andar;
  useEffect(() => {
    const c = caixaDoFoco(andarRef.current, foco);
    if (c) voar(c.caixa, c.fileira);
  }, [foco, voar]);
  useEffect(() => {
    if (entrar) voar(entrar.caixa, entrar.fileira);
  }, [entrar, voar]);

  useFrame(() => {
    const c = ref.current;
    const v = voo.current;
    if (!c || !v) return;
    invalidate();
    camera.position.lerp(v.pos, 0.09);
    c.target.lerp(v.alvo, 0.09);
    c.update();
    if (camera.position.distanceTo(v.pos) < 0.05 && c.target.distanceTo(v.alvo) < 0.05)
      voo.current = null;
  });

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={Math.max(30, comprimento * 1.2)}
      minPolarAngle={0.05}
      maxPolarAngle={1.2}
      screenSpacePanning={false}
      onStart={() => {
        voo.current = null;
      }}
    />
  );
}

/** A aba está à vista? Escondida, o laço de quadros para (economia de bateria). */
function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(typeof document === "undefined" ? true : !document.hidden);
  useEffect(() => {
    const mudar = () => setVisivel(!document.hidden);
    document.addEventListener("visibilitychange", mudar);
    return () => document.removeEventListener("visibilitychange", mudar);
  }, []);
  return visivel;
}
