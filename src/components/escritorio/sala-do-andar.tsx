/*
 * Uma sala do andar (18/10/2026): a placa da porta, a mobília do tipo (setor,
 * gerência, refeitório) e as pessoas. As divisórias são do andar (27/10/2026):
 * duas salas vizinhas dividem a mesma, e ela é levantada uma vez só.
 *
 * Nível de detalhe: a sala mede, a cada poucos quadros, a distância da câmera
 * até ela. Perto (alguém "entrou" com o zoom) → avatares de verdade e nomes;
 * longe → peões e só o letreiro da sala por cima. Com folga entre os dois
 * limites, para não ficar trocando na beirada.
 */
import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import type { MedidaDoAvatar } from "@/components/rv/sala/avatar-na-cadeira";
import type { AvatarConfig } from "@/lib/avatar-3d";
import {
  ALTURA_DA_MESA,
  AFASTAMENTO,
  CadeiraReal,
  MesaReal,
  Monitor,
  PlantaAlta,
  QuadroBranco,
  TV,
} from "./acabamento";
import {
  MESA_DO_REFEITORIO,
  mesasCompridasDoRefeitorio,
  paraOMundo,
  type MesaNoAndar,
  type PessoaNoAndar,
  type SalaNoAndar,
  type LugarDePe,
} from "./andar";
import {
  carpete,
  letreiroDaParede,
  madeiraDaMesa,
  madeiraDoPainel,
  planoComUV,
  textoDePlaca,
} from "./materiais";
import { Estatico } from "./mesclar";
import { Bagunca, Caneca, COR_DA_SITUACAO, type Situacao } from "./moveis";
import { NoRefeitorio, NomeFlutuante, Peao, Trabalhando } from "./pessoas";

export const PERTO = 13;

/** A cor do carpete de cada tipo de sala (sem cor = porcelanato do andar). */
const CARPETE: Partial<Record<SalaNoAndar["tipo"], string>> = {
  gerencia: "#5b6170",
  reuniao: "#56606e",
  atendimento: "#56606e",
  espera: "#8b9aa8",
};

export const EMOJI_DA_SALA: Record<SalaNoAndar["tipo"], string> = {
  setor: "",
  gerencia: "",
  reuniao: "📅 ",
  atendimento: "🤝 ",
  recepcao: "🛎️ ",
  espera: "🛋️ ",
  banheiro: "🚻 ",
  refeitorio: "☕ ",
};
export const LONGE = 16;

/** Sem TV nem planta no canto: salas de passagem e de serviço. */
const SEM_TV = new Set<SalaNoAndar["tipo"]>(["refeitorio", "recepcao", "espera", "banheiro"]);

export function SalaDoAndar({
  sala,
  configDe,
  elevacoes,
  aoMedir,
  naCopa,
  aoEscolherPessoa,
  perto,
  aoJuntar,
}: {
  sala: SalaNoAndar;
  configDe: (id: string) => AvatarConfig | null;
  elevacoes: Record<string, number>;
  aoMedir: (id: string, m: MedidaDoAvatar) => void;
  /** Só no refeitório: quem está ausente e onde fica. */
  naCopa?: { pessoa: PessoaNoAndar; lugar: LugarDePe }[];
  aoEscolherPessoa: (id: string) => void;
  /**
   * É a sala em foco (19/10/2026): só UMA sala do andar mostra os avatares de
   * verdade — a que a câmera está olhando de perto. Antes, perto de uma sala,
   * as vizinhas acendiam junto (15–20 avatares completos) e travava.
   */
  perto: boolean;
  /** As peças paradas foram juntadas de novo (a sombra fixa é refeita). */
  aoJuntar: () => void;
}) {
  const cx = (sala.x0 + sala.x1) / 2;
  const cz = (sala.z0 + sala.z1) / 2;

  const W = sala.largura;
  const D = sala.fundo;
  const mundo = paraOMundo(cx, cz, sala.giro);
  // A parede do fundo, de frente para a porta (TV, quadro): um pouco para dentro dela.
  const fundo = mundo(0, -D / 2 + 0.1, 0);
  const c = mundo(-W / 2 + 0.45, -D / 2 + 0.45, 0);
  const canto: [number, number, number] = [c.x, 0, c.z];
  const gerencia = sala.tipo === "gerencia";

  /* O que está PARADO na sala (paredes, móveis, mesas e — de longe — os
     peões) vai para o `Estatico`, que troca tudo por poucas malhas. A chave
     muda quando alguma coisa parada muda: alguém sai da mesa, fica ocupado,
     os bonecos chegam do servidor ou a sala passa de longe para perto. */
  // Os peões são juntados à parte: entrar e sair de perto não remonta a sala.
  const comBonecos = sala.mesas.some((m) => m.pessoa && configDe(m.pessoa.id));
  const situacoes = sala.mesas.map((m) => m.pessoa?.situacao ?? "x").join(",");
  /* A forma e o lugar da sala entram na chave: o andar se remonta quando muda
     gente (o refeitório cresce, um setor ganha mesa) e as salas andam. Sem
     isto, as paredes juntadas ficavam onde estavam antes. */
  const forma = [sala.x0, sala.x1, sala.z0, sala.z1].map((n) => n.toFixed(3)).join(",");
  const chave = `${sala.id}|${forma}|${sala.mesasCompridas ?? 0}|${situacoes}`;
  const chaveDosPeoes = [
    sala.id,
    forma,
    sala.mesas.map((m) => m.pessoa?.id ?? "").join(","),
    comBonecos ? "b" : "-",
    situacoes,
    naCopa?.map((c) => c.pessoa.id).join(",") ?? "",
  ].join("|");

  return (
    <group>
      <Estatico chave={chave} aoJuntar={aoJuntar}>
        {CARPETE[sala.tipo] && (
          <mesh rotation-x={-Math.PI / 2} position={[cx, 0.004, cz]} receiveShadow>
            <planeGeometry args={[sala.x1 - sala.x0 - 0.2, sala.z1 - sala.z0 - 0.2]} />
            <meshStandardMaterial
              map={carpete(CARPETE[sala.tipo]!) ?? undefined}
              roughness={0.95}
            />
          </mesh>
        )}

        {!sala.aberta && <PlacaDaPorta sala={sala} />}

        {!SEM_TV.has(sala.tipo) && (
          <>
            <TV
              pos={[fundo.x, 1.55, fundo.z]}
              rotY={fundo.rotY}
              largura={
                sala.tipo === "gerencia" || sala.tipo === "atendimento"
                  ? 1.1
                  : sala.tipo === "reuniao"
                    ? 1.9
                    : 1.4
              }
            />
            <PlantaAlta pos={canto} />
          </>
        )}
        {sala.tipo === "setor" && W > 5 && (
          <QuadroBranco pos={noFundo(mundo, W / 2 - 1.2, D, 1.5)} rotY={fundo.rotY} />
        )}
        {sala.tipo === "gerencia" && <MoveisDaGerencia mundo={mundo} />}
        {sala.tipo === "reuniao" && <MoveisDaReuniao mundo={mundo} />}
        {sala.tipo === "atendimento" && <MoveisDoAtendimento mundo={mundo} />}
        {sala.tipo === "recepcao" && <MoveisDaRecepcao mundo={mundo} fundo={D} />}
        {sala.tipo === "espera" && <MoveisDaEspera mundo={mundo} />}
        {sala.tipo === "banheiro" && <MoveisDoBanheiro mundo={mundo} fundo={D} />}
        {sala.tipo === "refeitorio" && <MoveisDoRefeitorio sala={sala} mundo={mundo} />}

        {sala.mesas.map((mesa, i) => (
          <group key={i} position={[mesa.x, 0, mesa.z]} rotation-y={mesa.rotY}>
            <MesaParada mesa={mesa} gerencia={gerencia} />
          </group>
        ))}
      </Estatico>

      {/* de longe, as pessoas são peões — parados, juntados num bloco só deles */}
      {!perto && (
        <Estatico chave={chaveDosPeoes}>
          {sala.mesas.map((mesa, i) => {
            const config = mesa.pessoa ? configDe(mesa.pessoa.id) : null;
            return mesa.pessoa && naMesa(mesa.pessoa) && config ? (
              <group key={i} position={[mesa.x, 0, mesa.z]} rotation-y={mesa.rotY}>
                <Peao config={config} sentado situacao={mesa.pessoa.situacao} />
              </group>
            ) : null;
          })}
          {naCopa?.map(({ pessoa, lugar }) => {
            const config = configDe(pessoa.id);
            return config ? (
              <group key={pessoa.id} position={[lugar.x, 0, lugar.z]} rotation-y={lugar.rotY}>
                <Peao config={config} sentado={!!lugar.sentado} situacao="ausente" />
              </group>
            ) : null;
          })}
        </Estatico>
      )}

      {/* perto: as pessoas de verdade, animadas e com o nome — fora do Estatico */}
      {perto &&
        sala.mesas.map((mesa, i) => (
          <PessoaNaMesa
            key={mesa.pessoa?.id ?? `v${i}`}
            mesa={mesa}
            config={mesa.pessoa ? configDe(mesa.pessoa.id) : null}
            elevacao={mesa.pessoa ? (elevacoes[mesa.pessoa.id] ?? 0) : 0}
            aoMedir={aoMedir}
            aoEscolher={aoEscolherPessoa}
            gerencia={gerencia}
          />
        ))}
      {perto &&
        naCopa?.map(({ pessoa, lugar }) => {
          const config = configDe(pessoa.id);
          if (!config) return null;
          return (
            <group
              key={pessoa.id}
              position={[lugar.x, 0, lugar.z]}
              rotation-y={lugar.rotY}
              onClick={(e) => {
                e.stopPropagation();
                aoEscolherPessoa(pessoa.id);
              }}
            >
              <NoRefeitorio
                nome={pessoa.nome}
                config={config}
                status={pessoa.status}
                sentado={!!lugar.sentado}
                naMesa={lugar.naMesa}
              />
            </group>
          );
        })}
    </group>
  );
}

const naMesa = (p: PessoaNoAndar) => p.situacao === "disponivel" || p.situacao === "ocupado";

/* ————————————————— Uma mesa ————————————————— */

const medidasDaMesa = (mesa: MesaNoAndar, gerencia: boolean) => ({
  w: gerencia ? 1.7 : mesa.gestor ? 1.5 : 1.3,
  d: gerencia ? 0.8 : 0.65,
});

/** A mesa com tudo em cima, parada (vai para o Estatico). */
function MesaParada({ mesa, gerencia }: { mesa: MesaNoAndar; gerencia: boolean }) {
  const situacao: Situacao = mesa.pessoa?.situacao ?? "offline";
  const sentado = !!mesa.pessoa && naMesa(mesa.pessoa);
  const { w, d } = medidasDaMesa(mesa, gerencia);
  const dois = !mesa.balcao && (gerencia || mesa.gestor || situacao === "ocupado");
  return (
    <>
      {/* A cadeira fica na altura padrão: subir e descer junto com o boneco
          (a "cadeira a gás" da sala de reunião) obrigaria a juntar tudo de novo. */}
      <CadeiraReal elevacao={0} vazia={!sentado} />
      {mesa.balcao ? <BalcaoDeRecepcao /> : <MesaReal w={w} d={d} />}
      {(dois ? [-0.3, 0.3] : [0]).map((x) => (
        <Monitor
          key={x}
          x={x}
          d={d}
          ligado={situacao !== "offline"}
          luz={COR_DA_SITUACAO[situacao]}
        />
      ))}
      {/* teclado, mouse e a caneca */}
      <mesh position={[0, ALTURA_DA_MESA + 0.01, AFASTAMENTO + 0.2]}>
        <boxGeometry args={[0.42, 0.02, 0.13]} />
        <meshStandardMaterial color="#2a2a2d" roughness={0.6} />
      </mesh>
      <mesh position={[0.32, ALTURA_DA_MESA + 0.012, AFASTAMENTO + 0.2]}>
        <boxGeometry args={[0.06, 0.025, 0.1]} />
        <meshStandardMaterial color="#2a2a2d" roughness={0.6} />
      </mesh>
      <Caneca pos={[-w / 2 + 0.18, ALTURA_DA_MESA, AFASTAMENTO + 0.18]} cor="#f5f5f4" />
      {situacao === "ocupado" && <Bagunca w={w} zc={AFASTAMENTO + d / 2} topo={ALTURA_DA_MESA} />}
    </>
  );
}

/** Perto: a pessoa de verdade na mesa (ou só o nome, se saiu), clicável. */
function PessoaNaMesa({
  mesa,
  config,
  elevacao,
  aoMedir,
  aoEscolher,
  gerencia,
}: {
  mesa: MesaNoAndar;
  config: AvatarConfig | null;
  elevacao: number;
  aoMedir: (id: string, m: MedidaDoAvatar) => void;
  aoEscolher: (id: string) => void;
  gerencia: boolean;
}) {
  const p = mesa.pessoa;
  const situacao: Situacao = p?.situacao ?? "offline";
  const sentado = !!p && naMesa(p);
  return (
    <group
      position={[mesa.x, 0, mesa.z]}
      rotation-y={mesa.rotY}
      onClick={(e) => {
        if (!p) return;
        e.stopPropagation();
        aoEscolher(p.id);
      }}
    >
      {p && sentado && config && (
        <Trabalhando
          id={p.id}
          nome={p.nome}
          config={config}
          ocupado={situacao === "ocupado"}
          elevacao={elevacao}
          aoMedir={aoMedir}
          gestor={mesa.gestor}
          status={p.status}
        />
      )}
      {/* a mesa de quem ainda não usa o CONECTA: só o nome */}
      {!p && mesa.nomeFixo && (
        <NomeFlutuante nome={mesa.nomeFixo} situacao="offline" altura={ALTURA_DA_MESA + 0.75} />
      )}
      {/* quem não está na mesa: só o nome, em cima do monitor — e o status,
          quando há (19/10/2026: "🚜 Em campo" no lugar do 💤) */}
      {p && !sentado && (
        <NomeFlutuante
          nome={p.nome}
          situacao={situacao}
          altura={ALTURA_DA_MESA + 0.75}
          prefixo={p.status ? "" : situacao === "ausente" ? "☕ " : "💤 "}
          status={p.status}
        />
      )}
    </group>
  );
}

/* ————————————————— Placa da porta ————————————————— */

/** Um ponto na parede do fundo, `lx` para o lado, na altura `y`. */
function noFundo(mundo: Mundo, lx: number, fundo: number, y: number): [number, number, number] {
  const p = mundo(lx, -fundo / 2 + 0.1, 0);
  return [p.x, y, p.z];
}

/** Do lado de fora da porta principal, ao lado dela (do lado do meio da sala). */
function PlacaDaPorta({ sala }: { sala: SalaNoAndar }) {
  const porta = sala.portas[0];
  const texto = textoDePlaca(sala.titulo);
  if (!porta) return null;
  const cx = (sala.x0 + sala.x1) / 2;
  const cz = (sala.z0 + sala.z1) / 2;
  // a porta no referencial da sala (só o lado importa)
  const lx = (porta.x - cx) * Math.cos(sala.giro) - (porta.z - cz) * Math.sin(sala.giro);
  const p = paraOMundo(cx, cz, sala.giro)(lx + (lx > 0 ? -0.85 : 0.85), sala.fundo / 2 + 0.06, 0);
  return (
    <group position={[p.x, 1.6, p.z]} rotation-y={p.rotY}>
      <mesh>
        <boxGeometry args={[0.62, 0.2, 0.015]} />
        <meshStandardMaterial color="#1c1c1e" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.0085]}>
        <planeGeometry args={[0.6, 0.19]} />
        <meshBasicMaterial map={texto ?? undefined} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ————————————————— Gerência e refeitório ————————————————— */

type Mundo = ReturnType<typeof paraOMundo>;

function MoveisDaGerencia({ mundo }: { mundo: Mundo }) {
  const mesa = mundo(1.1, 1.3, 0);
  const sofa = mundo(1.1, -1.7, 0);
  return (
    <group>
      {/* mesinha redonda de reunião com duas cadeiras */}
      <group position={[mesa.x, 0, mesa.z]}>
        <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, 0.04, 32]} />
          <meshStandardMaterial color="#efe9df" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.72, 10]} />
          <meshStandardMaterial color="#1c1c1e" metalness={0.4} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.03, 20]} />
          <meshStandardMaterial color="#1c1c1e" metalness={0.4} />
        </mesh>
        {[-1, 1].map((l) => (
          <group key={l} position={[l * 0.8, 0, 0]} rotation-y={(-l * Math.PI) / 2}>
            <CadeiraReal elevacao={0} vazia={false} />
          </group>
        ))}
      </group>
      {/* sofá de couro */}
      <group position={[sofa.x, 0, sofa.z]} rotation-y={mesa.rotY}>
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[1.5, 0.4, 0.7]} />
          <meshStandardMaterial color="#3b2a20" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.55, -0.28]} castShadow>
          <boxGeometry args={[1.5, 0.5, 0.18]} />
          <meshStandardMaterial color="#3b2a20" roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
}

function MoveisDoRefeitorio({ sala, mundo }: { sala: SalaNoAndar; mundo: Mundo }) {
  const largura = sala.largura;
  const balcao = mundo(-largura / 2 + 2.1, -sala.fundo / 2 + 0.38, 0);
  const geladeira = mundo(largura / 2 - 0.5, -sala.fundo / 2 + 0.45, 0);
  const mesas = mesasCompridasDoRefeitorio(sala.mesasCompridas ?? 2).map((m) => mundo(m.x, m.z, 0));
  const vaso = mundo(largura / 2 - 0.5, sala.fundo / 2 - 0.6, 0);
  return (
    <group>
      {/* balcão branco com tampo de granito, cuba, cafeteira e micro-ondas */}
      <group position={[balcao.x, 0, balcao.z]} rotation-y={balcao.rotY}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.9, 0.6]} />
          <meshStandardMaterial color="#f3f3f1" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.92, 0]} castShadow>
          <boxGeometry args={[3.26, 0.04, 0.64]} />
          <meshStandardMaterial color="#2d2f33" roughness={0.25} metalness={0.2} />
        </mesh>
        <mesh position={[-0.6, 0.935, 0.02]}>
          <boxGeometry args={[0.5, 0.02, 0.36]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.2} metalness={0.8} />
        </mesh>
        <mesh position={[0.4, 1.1, -0.05]} castShadow>
          <boxGeometry args={[0.28, 0.34, 0.3]} />
          <meshStandardMaterial color="#1c1c1e" roughness={0.4} />
        </mesh>
        <mesh position={[1.1, 1.08, -0.05]} castShadow>
          <boxGeometry args={[0.5, 0.3, 0.38]} />
          <meshStandardMaterial color="#d4d4d8" roughness={0.4} metalness={0.4} />
        </mesh>
        {/* armário de cima, em madeira */}
        <mesh position={[0, 1.95, -0.12]} castShadow>
          <boxGeometry args={[3.2, 0.6, 0.36]} />
          <meshStandardMaterial color="#8a5432" roughness={0.5} />
        </mesh>
      </group>
      {/* geladeira inox */}
      <group position={[geladeira.x, 0, geladeira.z]} rotation-y={geladeira.rotY}>
        <mesh position={[0, 0.95, 0]} castShadow>
          <boxGeometry args={[0.75, 1.9, 0.7]} />
          <meshStandardMaterial color="#c9ccd1" roughness={0.3} metalness={0.6} />
        </mesh>
      </group>
      {/* mesas compridas de madeira com pé preto e um banco de cada lado */}
      {mesas.map((m, i) => (
        <group key={i} position={[m.x, 0, m.z]} rotation-y={m.rotY}>
          <MesaComprida />
        </group>
      ))}
      <PlantaAlta pos={[vaso.x, 0, vaso.z]} />
    </group>
  );
}

/* ————————————————— Recepção, reunião, espera e atendimento ————————————————— */

/**
 * O balcão alto da recepção, no referencial da cadeira de quem atende (olha
 * para +z): o tampo de trabalho na altura de mesa e, na frente, o painel alto
 * de madeira em réguas com o tampo branco por cima — a 1,1 m, como o de
 * hotel — e uma fita de luz embaixo dele. Um retorno em "L" do lado esquerdo.
 */
function BalcaoDeRecepcao() {
  const painel = madeiraDoPainel();
  const frenteZ = AFASTAMENTO + 0.68;
  const largura = 2.6;
  const geoFrente = useMemo(() => planoComUV(largura, 1.08, 1.0), []);
  return (
    <group>
      {/* tampo de trabalho, de quem atende */}
      <mesh position={[0, ALTURA_DA_MESA - 0.02, AFASTAMENTO + 0.3]} castShadow receiveShadow>
        <boxGeometry args={[largura - 0.1, 0.04, 0.62]} />
        <meshStandardMaterial color="#f4f1ec" roughness={0.35} />
      </mesh>
      {/* o painel alto da frente: miolo e a face de madeira virada para quem chega */}
      <mesh position={[0, 0.54, frenteZ]} castShadow receiveShadow>
        <boxGeometry args={[largura, 1.08, 0.08]} />
        <meshStandardMaterial color="#6b3d22" roughness={0.6} />
      </mesh>
      <mesh geometry={geoFrente} position={[0, 0.54, frenteZ + 0.041]}>
        <meshStandardMaterial map={painel ?? undefined} roughness={0.45} />
      </mesh>
      {/* o tampo alto, branco, avançando sobre a frente */}
      <mesh position={[0, 1.11, frenteZ - 0.05]} castShadow>
        <boxGeometry args={[largura + 0.12, 0.05, 0.38]} />
        <meshStandardMaterial color="#fafaf9" roughness={0.2} />
      </mesh>
      {/* a fita de luz embaixo do tampo alto */}
      <mesh position={[0, 1.075, frenteZ + 0.135]}>
        <boxGeometry args={[largura, 0.012, 0.012]} />
        <meshBasicMaterial color="#99f6e4" toneMapped={false} />
      </mesh>
      {/* o retorno em L, do lado esquerdo */}
      <mesh position={[-largura / 2 + 0.04, 0.54, AFASTAMENTO + 0.25]} castShadow receiveShadow>
        <boxGeometry args={[0.08, 1.08, 0.9]} />
        <meshStandardMaterial color="#6b3d22" roughness={0.6} />
      </mesh>
      <mesh position={[-largura / 2 + 0.04, 1.11, AFASTAMENTO + 0.25]}>
        <boxGeometry args={[0.2, 0.05, 0.96]} />
        <meshStandardMaterial color="#fafaf9" roughness={0.2} />
      </mesh>
      {/* um vasinho de orquídea no tampo alto */}
      <mesh position={[0.95, 1.2, frenteZ - 0.05]} castShadow>
        <cylinderGeometry args={[0.06, 0.05, 0.12, 14]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.95 + (i - 1) * 0.04, 1.36 + i * 0.03, frenteZ - 0.05]}>
          <sphereGeometry args={[0.035, 10, 8]} />
          <meshStandardMaterial color="#f0abfc" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** A recepção: o nome da empresa na parede de madeira e o canto de espera. */
function MoveisDaRecepcao({ mundo, fundo }: { mundo: Mundo; fundo: number }) {
  const painel = madeiraDoPainel();
  const letreiro = letreiroDaParede("PLANTSIL");
  const geoParede = useMemo(() => planoComUV(3.6, 2.3, 1.0), []);
  const espera = mundo(1.7, 1.2, 0);
  const vaso = mundo(2.6, 2.4, 0);
  const parede = mundo(-0.9, -fundo / 2 + 0.11, 0);
  return (
    <group>
      {/* a parede de madeira com o nome, atrás do balcão */}
      <group position={[parede.x, 1.25, parede.z]} rotation-y={parede.rotY}>
        <mesh geometry={geoParede}>
          <meshStandardMaterial map={painel ?? undefined} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.25, 0.01]}>
          <planeGeometry args={[2.6, 0.65]} />
          <meshBasicMaterial map={letreiro ?? undefined} transparent toneMapped={false} />
        </mesh>
      </group>
      {/* canto de espera: duas poltronas e a mesinha */}
      <group position={[espera.x, 0, espera.z]} rotation-y={espera.rotY}>
        {[-0.55, 0.55].map((x) => (
          <group key={x} position={[x, 0, 0]} rotation-y={-x * 0.6}>
            <RoundedBox
              args={[0.7, 0.42, 0.7]}
              radius={0.08}
              smoothness={2}
              position={[0, 0.21, 0]}
              castShadow
            >
              <meshStandardMaterial color="#cbb89d" roughness={0.85} />
            </RoundedBox>
            <RoundedBox
              args={[0.7, 0.45, 0.16]}
              radius={0.06}
              smoothness={2}
              position={[0, 0.55, -0.28]}
              castShadow
            >
              <meshStandardMaterial color="#cbb89d" roughness={0.85} />
            </RoundedBox>
          </group>
        ))}
        <mesh position={[0, 0.22, 0.6]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.04, 24]} />
          <meshStandardMaterial color="#1c1c1e" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.11, 0.6]}>
          <cylinderGeometry args={[0.03, 0.03, 0.2, 8]} />
          <meshStandardMaterial color="#1c1c1e" metalness={0.5} />
        </mesh>
      </group>
      <PlantaAlta pos={[vaso.x, 0, vaso.z]} />
    </group>
  );
}

/** Sala de reunião: mesa comprida branca com pé preto, cadeiras em volta. */
function MoveisDaReuniao({ mundo }: { mundo: Mundo }) {
  const centro = mundo(0, -0.3, 0);
  const comprimento = 3.4;
  const lugares: [number, number, number][] = [
    ...[-1.2, -0.4, 0.4, 1.2].flatMap((x) => [
      [x, -0.95, 0] as [number, number, number],
      [x, 0.95, Math.PI] as [number, number, number],
    ]),
    [-2.15, 0, Math.PI / 2],
    [2.15, 0, -Math.PI / 2],
  ];
  return (
    <group position={[centro.x, 0, centro.z]} rotation-y={centro.rotY}>
      <RoundedBox
        args={[comprimento, 0.05, 1.2]}
        radius={0.02}
        smoothness={2}
        position={[0, 0.75, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#f7f7f5" roughness={0.3} />
      </RoundedBox>
      {[-1, 1].map((l) => (
        <mesh key={l} position={[l * (comprimento / 2 - 0.4), 0.37, 0]}>
          <boxGeometry args={[0.08, 0.72, 0.8]} />
          <meshStandardMaterial color="#1c1c1e" roughness={0.45} metalness={0.4} />
        </mesh>
      ))}
      {/* a caixa de tomadas no meio da mesa */}
      <mesh position={[0, 0.78, 0]}>
        <boxGeometry args={[0.3, 0.02, 0.12]} />
        <meshStandardMaterial color="#3f3f46" metalness={0.6} roughness={0.3} />
      </mesh>
      {lugares.map(([x, z, r], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={r}>
          <CadeiraReal elevacao={0} vazia={false} />
        </group>
      ))}
    </group>
  );
}

/** Sala de atendimento: mesa redonda para três, de frente para a TV. */
function MoveisDoAtendimento({ mundo }: { mundo: Mundo }) {
  const mesa = mundo(0, 0.2, 0);
  return (
    <group position={[mesa.x, 0, mesa.z]} rotation-y={mesa.rotY}>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.04, 32]} />
        <meshStandardMaterial color="#f7f7f5" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.72, 10]} />
        <meshStandardMaterial color="#1c1c1e" metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.03, 20]} />
        <meshStandardMaterial color="#1c1c1e" metalness={0.4} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <group
            key={i}
            position={[Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9]}
            rotation-y={a + Math.PI}
          >
            <CadeiraReal elevacao={0} vazia={false} />
          </group>
        );
      })}
    </group>
  );
}

/** Sala de espera (o hall): tapete, dois sofás frente a frente, mesinha e plantas. */
function MoveisDaEspera({ mundo }: { mundo: Mundo }) {
  const centro = mundo(0, 0, 0);
  const vasos = [mundo(-1.9, -1.6, 0), mundo(1.9, 1.6, 0)];
  return (
    <group>
      <group position={[centro.x, 0, centro.z]} rotation-y={centro.rotY}>
        {[-1, 1].map((l) => (
          <group key={l} position={[0, 0, l * 1.05]} rotation-y={l > 0 ? Math.PI : 0}>
            <RoundedBox
              args={[2.2, 0.42, 0.8]}
              radius={0.08}
              smoothness={2}
              position={[0, 0.23, 0]}
              castShadow
            >
              <meshStandardMaterial color="#4b5563" roughness={0.8} />
            </RoundedBox>
            <RoundedBox
              args={[2.2, 0.5, 0.2]}
              radius={0.06}
              smoothness={2}
              position={[0, 0.6, -0.31]}
              castShadow
            >
              <meshStandardMaterial color="#4b5563" roughness={0.8} />
            </RoundedBox>
          </group>
        ))}
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.4, 0.44, 24]} />
          <meshStandardMaterial color="#b8865a" roughness={0.5} />
        </mesh>
      </group>
      {vasos.map((v) => (
        <PlantaAlta key={`${v.x}`} pos={[v.x, 0, v.z]} />
      ))}
    </group>
  );
}

/** O banheiro: a bancada com a cuba e o espelho, na parede do fundo. */
function MoveisDoBanheiro({ mundo, fundo }: { mundo: Mundo; fundo: number }) {
  const bancada = mundo(0, -fundo / 2 + 0.35, 0);
  return (
    <group position={[bancada.x, 0, bancada.z]} rotation-y={bancada.rotY}>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.05, 0.5]} />
        <meshStandardMaterial color="#e7e5e4" roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.88, 0.02]}>
        <cylinderGeometry args={[0.17, 0.17, 0.02, 24]} />
        <meshStandardMaterial color="#ffffff" roughness={0.15} />
      </mesh>
      <mesh position={[0, 1.55, -0.22]}>
        <boxGeometry args={[0.9, 0.7, 0.02]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.05} metalness={0.9} />
      </mesh>
    </group>
  );
}

/** Mesa comprida do refeitório (tampo de madeira, pés pretos) com os dois bancos. */
function MesaComprida() {
  const tampo = madeiraDaMesa();
  const { comp, prof, banco } = MESA_DO_REFEITORIO;
  return (
    <group>
      <mesh position={[0, 0.745, 0]} castShadow receiveShadow>
        <boxGeometry args={[comp, 0.04, prof]} />
        <meshStandardMaterial map={tampo ?? undefined} roughness={0.5} />
      </mesh>
      {[-1, 1].map((l) => (
        <mesh key={l} position={[l * (comp / 2 - 0.2), 0.36, 0]} castShadow>
          <boxGeometry args={[0.06, 0.72, prof - 0.15]} />
          <meshStandardMaterial color="#1c1c1e" roughness={0.45} metalness={0.4} />
        </mesh>
      ))}
      {[-1, 1].map((lado) => (
        <group key={lado} position={[0, 0, lado * banco]}>
          <mesh position={[0, 0.43, 0]} castShadow receiveShadow>
            <boxGeometry args={[comp, 0.05, 0.32]} />
            <meshStandardMaterial map={tampo ?? undefined} roughness={0.55} />
          </mesh>
          {[-1, 1].map((l) => (
            <mesh key={l} position={[l * (comp / 2 - 0.2), 0.205, 0]}>
              <boxGeometry args={[0.05, 0.41, 0.26]} />
              <meshStandardMaterial color="#1c1c1e" roughness={0.45} metalness={0.4} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}
