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
import { Divisoria, PlantaAlta } from "./acabamento";
import {
  montarAndar,
  type AndarMontado,
  type Caixa,
  type PessoaNoAndar,
  type SalaNoAndar,
  type SetorDoAndar,
} from "./andar";
import { planoComUV, porcelanato } from "./materiais";
import { EMOJI_DA_SALA, LONGE, PERTO, SalaDoAndar } from "./sala-do-andar";
import { Estatico } from "./mesclar";

const SEM_CONTAGEM = new Set<SalaNoAndar["tipo"]>(["reuniao", "atendimento", "espera", "banheiro"]);

export type FocoDoAndar =
  | { tipo: "andar"; n: number }
  | { tipo: "sala"; id: string; n: number }
  | { tipo: "area"; id: string; n: number }
  | { tipo: "pessoa"; id: string; n: number };

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

  const [entrar, setEntrar] = useState<{ caixa: Caixa; giro?: number; n: number } | null>(null);
  const visivel = useAbaVisivel();
  const comprimento = andar.limites.x1 - andar.limites.x0;
  const larguraTotal = andar.limites.z1 - andar.limites.z0;

  // A contagem de cada sala, para o letreiro de longe.
  const contagem = (s: SalaNoAndar) =>
    s.tipo === "refeitorio" ? andar.naCopa.length : s.mesas.filter((m) => m.pessoa).length;
  const letreiros = useRef(new Map<string, HTMLButtonElement>());
  const entrarNa = (s: SalaNoAndar) => setEntrar({ caixa: s, giro: s.giro, n: Date.now() });

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

          {/* o porcelanato das salas e corredores, as paredes e as plantas: tudo
              parado (a planta é fixa) */}
          <Estatico chave={`andar|${comprimento}|${larguraTotal}`} aoJuntar={aoJuntar}>
            <Piso andar={andar} />
            {andar.paredes.map((p, i) => (
              <Divisoria key={i} de={p.de} ate={p.ate} porta={p.porta} vidro={!p.cheia} />
            ))}
            <EnfeitesDoCorredor andar={andar} />
            {andar.entrada && <Entrada porta={andar.entrada} />}
          </Estatico>

          <QualidadeDoAvatar.Provider value="media">
            {andar.salas.map((sala) => (
              <SalaDoAndar
                key={sala.id}
                sala={sala}
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

          {/* A planta é quase quadrada: o afastamento máximo vem do lado maior. */}
          <Camera
            andar={andar}
            foco={foco}
            entrar={entrar}
            comprimento={Math.max(comprimento, larguraTotal) * 1.6}
          />
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
                // Sala de passagem ou de reunião não tem "0 pessoas": ninguém mora nela.
                !SEM_CONTAGEM.has(s.tipo) && (
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
      gerencia: 1,
      recepcao: 2,
      refeitorio: 3,
      setor: 4,
      reuniao: 5,
      atendimento: 6,
      espera: 6,
      banheiro: 7,
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

/**
 * O chão: a laje cinza só debaixo do que é andar (salas e corredores) e o
 * porcelanato por cima. Os vãos da planta (fora do prédio) ficam sem chão.
 */
/**
 * A entrada do prédio (09/11/2026): do lado de fora da porta da recepção, a
 * calçada de concreto e o tapete escuro, para a porta de entrada se destacar
 * das portas de vidro das salas.
 */
function Entrada({ porta }: { porta: AndarMontado["entrada"] & object }) {
  // Para fora: a direção oposta ao interior da sala, pelo lado da parede.
  const fora = { n: [0, -1], s: [0, 1], l: [1, 0], o: [-1, 0] }[porta.lado] as [number, number];
  const deLado = porta.lado === "l" || porta.lado === "o";
  const ang = deLado ? Math.PI / 2 : 0;
  const ponto = (d: number): [number, number, number] => [
    porta.x + fora[0] * d,
    0,
    porta.z + fora[1] * d,
  ];
  return (
    <>
      <group position={ponto(1.4)} rotation-y={ang}>
        <mesh position={[0, -0.12, 0]} receiveShadow>
          <boxGeometry args={[3.6, 0.26, 2.6]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.95} />
        </mesh>
      </group>
      <group position={ponto(0.75)} rotation-y={ang}>
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[1.5, 0.03, 1.0]} />
          <meshStandardMaterial color="#1f2937" roughness={1} />
        </mesh>
      </group>
    </>
  );
}

function Piso({ andar }: { andar: AndarMontado }) {
  const textura = porcelanato();
  const pedacos = useMemo(
    () =>
      [...andar.salas, ...andar.corredores].map((c) => ({
        cx: (c.x0 + c.x1) / 2,
        cz: (c.z0 + c.z1) / 2,
        w: c.x1 - c.x0,
        d: c.z1 - c.z0,
        geo: planoComUV(c.x1 - c.x0, c.z1 - c.z0, 1.6),
      })),
    [andar],
  );
  useEffect(() => () => pedacos.forEach((p) => p.geo.dispose()), [pedacos]);
  return (
    <>
      {pedacos.map((p, i) => (
        <group key={i} position={[p.cx, 0, p.cz]}>
          <mesh position={[0, -0.16, 0]} receiveShadow>
            <boxGeometry args={[p.w + 0.3, 0.3, p.d + 0.3]} />
            <meshStandardMaterial color="#9ca3af" roughness={0.9} />
          </mesh>
          <mesh geometry={p.geo} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow>
            <meshStandardMaterial map={textura ?? undefined} roughness={0.35} metalness={0.05} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * Plantas altas nos corredores, a cada ~8 m, encostadas num lado e alternando
 * — longe das portas, para não tapar a passagem.
 */
function EnfeitesDoCorredor({ andar }: { andar: AndarMontado }) {
  const portas = andar.salas.flatMap((s) => s.portas);
  const vasos: [number, number, number][] = [];
  for (const c of andar.corredores) {
    const deitado = c.x1 - c.x0 >= c.z1 - c.z0;
    const [a, b] = deitado ? [c.x0, c.x1] : [c.z0, c.z1];
    for (let t = a + 1.2, i = 0; t < b - 0.8; t += 8, i++) {
      const v: [number, number, number] = deitado
        ? [t, 0, i % 2 ? c.z0 + 0.35 : c.z1 - 0.35]
        : [i % 2 ? c.x0 + 0.35 : c.x1 - 0.35, 0, t];
      if (portas.every((p) => Math.hypot(p.x - v[0], p.z - v[2]) > 1.4)) vasos.push(v);
    }
  }
  return (
    <>
      {vasos.map((p) => (
        <PlantaAlta key={p.join(",")} pos={p} />
      ))}
    </>
  );
}

/* ————————————————— Câmera ————————————————— */

/** Onde a câmera fica para enquadrar `caixa`: por cima, um pouco inclinada. */
function enquadrar(caixa: Caixa, giro = 0) {
  const cx = (caixa.x0 + caixa.x1) / 2;
  const cz = (caixa.z0 + caixa.z1) / 2;
  const w = caixa.x1 - caixa.x0;
  const d = caixa.z1 - caixa.z0;
  const deLado = Math.abs(Math.sin(giro)) > 0.5;
  const dist = Math.max((deLado ? d : w) * 1.12, (deLado ? w : d) * 1.4, 6.5);
  // Olha de quem chega pela porta: a câmera fica do lado dela.
  const dir = new Vector3(0.5 * Math.sin(giro), 0.86, 0.5 * Math.cos(giro)).normalize();
  return {
    alvo: new Vector3(cx, 0.6, cz),
    pos: new Vector3(cx, 0.6, cz).addScaledVector(dir, dist),
  };
}

function caixaDoFoco(
  andar: AndarMontado,
  foco: FocoDoAndar,
): { caixa: Caixa; giro?: number } | null {
  /* O andar todo, um pouco puxado para baixo: com a câmera inclinada, a
     fileira de baixo (reunião 2 e RH) é a que fica mais longe. */
  const l = andar.limites;
  const tudo: Caixa = { ...l, z1: l.z1 + 2 };
  switch (foco.tipo) {
    case "andar":
      return { caixa: tudo };
    case "sala": {
      // Pelo id da sala ou pelo setor de quem senta nela (Compras está em Suprimentos).
      const s =
        andar.salas.find((x) => x.id === foco.id) ??
        andar.salas.find((x) => x.setores.includes(foco.id));
      return s ? { caixa: s, giro: s.giro } : { caixa: tudo };
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
      return s ? { caixa: s, giro: s.giro } : { caixa: tudo };
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
  entrar: { caixa: Caixa; giro?: number; n: number } | null;
  comprimento: number;
}) {
  const ref = useRef<OrbitControlsImpl>(null);
  const voo = useRef<{ alvo: Vector3; pos: Vector3 } | null>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const primeira = useRef(true);

  const voar = useCallback(
    (caixa: Caixa, giro?: number) => {
      const v = enquadrar(caixa, giro);
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
    if (c) voar(c.caixa, c.giro);
  }, [foco, voar]);
  useEffect(() => {
    if (entrar) voar(entrar.caixa, entrar.giro);
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
