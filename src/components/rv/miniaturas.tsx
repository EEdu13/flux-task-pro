import { useEffect, useState, useSyncExternalStore } from "react";
import { SemTresD } from "@/components/rv/sem-tres-d";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Avatar3D } from "@/components/rv/avatar-3d";
import { tarefasNaFila, useDrenarFila } from "@/components/rv/fila-avatar";
import { MEDIDAS } from "@/components/rv/medidas";
import {
  INSTANTE_PARADO,
  ROSTO_DO_GESTO,
  type GestoDeReacao,
} from "@/components/rv/poses-de-reacao";
import { compactarAvatar, type AvatarConfig } from "@/lib/avatar-3d";

/**
 * As fotinhas das opções no provador, como no catálogo do Roblox (pedido do
 * usuário, 13/10/2026: "ver uma prévia igual de roblox").
 *
 * Um avatar 3D vivo por opção seriam dezenas de bonecos animando ao mesmo
 * tempo — o notebook não aguenta. Então há UM canvas escondido que monta o
 * avatar com a opção, espera a fila de peças esvaziar (cabelo e roupa ficam
 * prontos aos poucos, ver `fila-avatar.ts`), tira a foto e passa para a
 * próxima. A foto fica guardada pela configuração inteira: voltar a uma cor
 * já vista é instantâneo.
 */

export type Quadro = "rosto" | "cabelo" | "chapeu" | "tronco" | "pernas" | "pes" | "corpo";

/** `gesto` (17/10/2026): a foto congela o gesto no instante que o resume (o avatar comemorando do Mural). */
type Pedido = { chave: string; config: AvatarConfig; quadro: Quadro; gesto?: GestoDeReacao };

const LIMITE = 400;
const prontas = new Map<string, string>();
const pedidos = new Map<string, Pedido>();
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/* ——— Fotos guardadas no navegador (17/10/2026) ———
   Com o modelo fixo da vitrine, a foto de cada opção é sempre a mesma: vale
   guardar entre uma visita e outra. Fica no IndexedDB (o localStorage não
   aguenta centenas de imagens). Mudou o desenho das peças? Suba a VERSAO —
   as fotos antigas deixam de casar e são refeitas. */
// v2 (17/10/2026): fotos tiradas com a câmera do pedido anterior (o "Nenhum"
// do chapéu saía com o sapato) — ver `Fotografo`.
// v3 (19/10/2026): o azul do uniforme social mudou — a foto guardada era a do tom antigo.
const VERSAO_DAS_FOTOS = "v7"; // v4: bandeiras nas mangas do uniforme social
const BANCO = "fluxo-miniaturas-avatar";
let banco: Promise<IDBDatabase | null> | null = null;

function abrirBanco(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  banco ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(BANCO, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("fotos");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return banco;
}

async function lerGuardada(chave: string): Promise<string | undefined> {
  const db = await abrirBanco();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("fotos").objectStore("fotos").get(`${VERSAO_DAS_FOTOS}|${chave}`);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function gravarGuardada(chave: string, url: string): Promise<void> {
  const db = await abrirBanco();
  if (!db) return;
  try {
    db.transaction("fotos", "readwrite")
      .objectStore("fotos")
      .put(url, `${VERSAO_DAS_FOTOS}|${chave}`);
  } catch {
    /* sem espaço ou modo privado: fica só na memória desta visita */
  }
}

function guardar(chave: string, url: string, noNavegador = true) {
  prontas.set(chave, url);
  if (noNavegador) void gravarGuardada(chave, url);
  // A mais antiga sai primeiro: o Map lembra a ordem de entrada.
  if (prontas.size > LIMITE) prontas.delete(prontas.keys().next().value!);
  pedidos.delete(chave);
  avisar();
}

/** Quantas fotinhas na tela esperam cada pedido: o pedido só sai quando a última sair. */
const interessados = new Map<string, number>();

/** A foto do avatar com essa configuração, ou `undefined` enquanto não sai. */
export function useMiniatura(
  config: AvatarConfig,
  quadro: Quadro,
  gesto?: GestoDeReacao,
): string | undefined {
  const chave = `${gesto ? `${quadro}+${gesto}` : quadro}|${compactarAvatar(config)}`;
  const url = useSyncExternalStore(
    assinar,
    () => prontas.get(chave),
    () => undefined,
  );
  const semFoto = url === undefined;
  useEffect(() => {
    if (prontas.has(chave)) return;
    let vivo = true;
    interessados.set(chave, (interessados.get(chave) ?? 0) + 1);
    // Primeiro o que já está guardado no navegador; só fotografa o que falta.
    void lerGuardada(chave).then((guardada) => {
      if (!vivo || prontas.has(chave)) return;
      if (guardada) guardar(chave, guardada, false);
      else {
        pedidos.set(chave, { chave, config, quadro, gesto });
        avisar();
      }
    });
    // Saiu da tela (trocou de aba, fechou o "+"): deixa de pedir.
    return () => {
      vivo = false;
      const n = (interessados.get(chave) ?? 1) - 1;
      if (n <= 0) {
        interessados.delete(chave);
        pedidos.delete(chave);
      } else interessados.set(chave, n);
    };
    // `config` é a mesma coisa que a chave diz. `semFoto`: a foto saiu da
    // memória (limite) com a fotinha ainda na tela — pede de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, semFoto]);
  return url;
}

/** Para onde a câmera olha em cada tipo de foto: alvo, distância e ângulo. */
function enquadrar(config: AvatarConfig, quadro: Quadro, gesto?: GestoDeReacao) {
  const m = MEDIDAS[config.corpo];
  const cabecaY = m.pernaH + m.troncoH + 0.03 + m.cabeca / 2;
  const alto = cabecaY + m.cabeca / 2;
  // Cabeça maior que a do clássico (mini, cabeçudo — 16/10/2026): afasta a câmera junto.
  const k = Math.max(1, m.cabeca / 0.46);
  switch (quadro) {
    case "rosto":
      return { y: cabecaY, d: 1.25 * k, giro: 0, sobe: 0.02 };
    case "cabelo":
      return { y: cabecaY - 0.12 * k, d: 1.85 * k, giro: 0.5, sobe: 0.1 };
    case "chapeu":
      return { y: cabecaY + 0.1 * k, d: 1.7 * k, giro: 0.35, sobe: 0.12 };
    case "tronco":
      return { y: m.pernaH + m.troncoH * 0.5, d: 2.05, giro: 0.3, sobe: 0.05 };
    case "pernas":
      return { y: m.pernaH * 0.55, d: 2.05, giro: 0.3, sobe: 0.05 };
    case "pes":
      return { y: 0.12, d: 1.15, giro: 0.45, sobe: 0.35 };
    default:
      // A foto do time abraçado: de frente e mais perto (os braços vão para os lados).
      if (gesto === "grupo")
        return { y: alto / 2 + 0.1, d: 4.0 * Math.max(1, alto / 1.82), giro: 0, sobe: 0.03 };
      // Com os braços para cima (comemorando), a câmera recua e sobe um pouco.
      if (gesto)
        return {
          y: alto / 2 + 0.12,
          d: 4.5 * Math.max(1, alto / 1.82),
          giro: 0.25,
          sobe: 0.04,
        };
      // corpos mais altos que o clássico (~1,8 m) afastam a câmera na mesma proporção
      return { y: alto / 2, d: 3.9 * Math.max(1, alto / 1.82), giro: 0.3, sobe: 0.05 };
  }
}

function Fotografo() {
  const { camera, scene } = useThree();
  const [atual, setAtual] = useState<Pedido | null>(null);
  const [estado] = useState({ chave: "", quadros: 0, vazia: 0, tentativas: 0 });
  useDrenarFila();

  useFrame(({ gl }) => {
    if (!atual) {
      const proximo = pedidos.values().next().value;
      if (proximo) setAtual(proximo);
      return;
    }
    // Foi cancelado (a fotinha saiu da tela): larga e pega o próximo.
    if (!pedidos.has(atual.chave)) {
      setAtual(null);
      return;
    }
    /* Pedido novo: mira a câmera e zera a contagem AQUI, no próprio quadro
       (17/10/2026). Era num useEffect, que roda depois de alguns quadros: com
       a contagem do pedido anterior ainda cheia, a foto saía na hora, com a
       câmera velha — o "Nenhum" do chapéu vinha com o sapato do Calçado. */
    if (estado.chave !== atual.chave) {
      const { y, d, giro, sobe } = enquadrar(atual.config, atual.quadro, atual.gesto);
      camera.position.set(Math.sin(giro) * d, y + sobe * d, Math.cos(giro) * d);
      camera.lookAt(0, y, 0);
      estado.chave = atual.chave;
      estado.quadros = 0;
      estado.vazia = 0;
      estado.tentativas = 0;
    }
    estado.quadros++;
    estado.vazia = tarefasNaFila() === 0 ? estado.vazia + 1 : 0;
    // Dois quadros seguidos com a fila vazia: a última peça já foi desenhada.
    // O teto de 90 quadros evita travar a fábrica se alguma peça falhar.
    if ((estado.quadros >= 4 && estado.vazia >= 2) || estado.quadros > 90) {
      /* Desenha AGORA, com a câmera e o avatar deste pedido, e só então
         fotografa (16/10/2026). Algumas fotinhas saíam vazias — o quadro do
         buffer ainda era de antes do avatar aparecer. Foto vazia (só pixels
         transparentes) não é guardada: espera mais um pouco e tenta de novo,
         até 4 vezes. */
      gl.render(scene, camera);
      const vazia = fotoVazia(gl.domElement);
      if (vazia && estado.tentativas < 4 && estado.quadros <= 90) {
        estado.tentativas++;
        estado.quadros = 0;
        estado.vazia = 0;
        return;
      }
      // Desistiu de uma foto vazia: mostra agora, mas não guarda no navegador.
      guardar(atual.chave, gl.domElement.toDataURL("image/png"), !vazia);
      setAtual(null);
    }
  });

  if (!atual) return null;
  return (
    <Avatar3D
      key={atual.chave}
      config={atual.config}
      mostrarNome={false}
      pose="em-pe"
      gesto={atual.gesto}
      gestoTempo={atual.gesto ? INSTANTE_PARADO[atual.gesto] : undefined}
      expressaoForcada={atual.gesto ? ROSTO_DO_GESTO[atual.gesto] : undefined}
    />
  );
}

/** A foto não tem nada desenhado: todos os pixels transparentes. */
let telinha: HTMLCanvasElement | null = null;
function fotoVazia(origem: HTMLCanvasElement): boolean {
  try {
    telinha ??= document.createElement("canvas");
    telinha.width = 24;
    telinha.height = 24;
    const ctx = telinha.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, 24, 24);
    ctx.drawImage(origem, 0, 0, 24, 24);
    const px = ctx.getImageData(0, 0, 24, 24).data;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 8) return false;
    return true;
  } catch {
    return false;
  }
}

/* Uma fábrica só (17/10/2026): o provador monta a dele e cada cartão do Mural
   com avatar comemorando também — só a primeira montada fotografa; se ela
   sai, a seguinte assume. Duas fábricas disputariam a mesma fila. */
const fabricas: symbol[] = [];
const ouvintesDaFabrica = new Set<() => void>();
function assinarFabrica(f: () => void) {
  ouvintesDaFabrica.add(f);
  return () => {
    ouvintesDaFabrica.delete(f);
  };
}

/** O canvas escondido. Pode ser montado em vários lugares; só um trabalha. */
export function FabricaDeMiniaturas() {
  const [eu] = useState(() => Symbol("fabrica"));
  useEffect(() => {
    fabricas.push(eu);
    ouvintesDaFabrica.forEach((f) => f());
    return () => {
      fabricas.splice(fabricas.indexOf(eu), 1);
      ouvintesDaFabrica.forEach((f) => f());
    };
  }, [eu]);
  const ativa = useSyncExternalStore(
    assinarFabrica,
    () => fabricas[0] === eu,
    () => false,
  );
  if (!ativa) return null;
  return (
    <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 168, height: 168 }}>
      <SemTresD>
        <Canvas
          dpr={1}
          camera={{ fov: 30, position: [0, 1.6, 2] }}
          gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        >
          <hemisphereLight args={["#ffffff", "#9ca3af", 1.15]} />
          <directionalLight position={[2, 3, 2.5]} intensity={1.3} />
          <directionalLight position={[-2, 2, -1]} intensity={0.4} />
          <Fotografo />
        </Canvas>
      </SemTresD>
    </div>
  );
}
