/*
 * O telão da parede do fundo.
 *
 * Com tela compartilhada: o vídeo como VideoTexture e uma faixa "Tela de …".
 * Sem: a "tela de espera" desenhada num canvas (1024×576) com os últimos cards
 * da conversa em letra grande — é o lugar da sala onde todos leem os cards
 * sem precisar abrir painel nenhum.
 *
 * Nada de drei <Html> aqui: o texto vai na textura (fica no 3D, sem DOM por
 * quadro e sem brigar com a camada dos balões).
 */
import { useEffect, useMemo, useState } from "react";
import { SRGBColorSpace, VideoTexture } from "three";
import { CARDS_NO_TELAO, type CardNaSala, type TipoVisivel, VISUAL_DO_CARD } from "./tipos";
import {
  TELAO_BRILHO,
  TELAO_CENTRO,
  TELAO_ESPERA_PX,
  TELAO_MOLDURA,
  TELAO_TELA,
} from "./medidas-da-sala";
import {
  FONTE,
  FONTE_EMOJI,
  cortarTexto,
  retanguloArredondado,
  useTexturaDeCanvas,
} from "./textura-de-canvas";

/** Os cards que o telão mostra: os N mais novos (o mais novo em cima), sem "nada". */
export function cardsDoTelao(mural: CardNaSala[]): CardNaSala[] {
  return mural
    .filter((c) => c.card.tipo !== "nada")
    .slice(-CARDS_NO_TELAO)
    .reverse();
}

/** "HH:MM" e uma chave que só muda quando o minuto vira (para redesenhar o relógio). */
function useMinuto(): string {
  const agora = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const [hhmm, setHhmm] = useState(agora);
  useEffect(() => {
    const t = setInterval(() => setHhmm(agora()), 10_000);
    return () => clearInterval(t);
  }, []);
  return hhmm;
}

/** Compara nomes pelo 1º nome, sem acento nem caixa ("ana" = "Ana Paula" = "ANA"). */
function mesmaPessoa(a: string, b: string): boolean {
  const primeiro = (n: string) =>
    n.normalize("NFD").replace(/\p{M}/gu, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const pa = primeiro(a);
  return pa !== "" && pa === primeiro(b);
}

function chip(g: CanvasRenderingContext2D, x: number, y: number, texto: string): number {
  g.font = `600 26px ${FONTE}`;
  const w = g.measureText(texto).width + 28;
  g.fillStyle = "rgba(255,255,255,0.14)";
  retanguloArredondado(g, x, y - 20, w, 40, 20);
  g.fill();
  g.fillStyle = "#f8fafc";
  g.fillText(texto, x + 14, y + 1);
  return w;
}

function desenharEspera(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  cards: CardNaSala[],
  nomeDaSala: string,
  hhmm: string,
) {
  const fundo = g.createLinearGradient(0, 0, w, h);
  fundo.addColorStop(0, "#0f2a1f");
  fundo.addColorStop(1, "#13352a");
  g.fillStyle = fundo;
  g.fillRect(0, 0, w, h);

  // Topo: marca, nome da sala e relógio.
  g.textBaseline = "middle";
  g.fillStyle = "#e7dcc6";
  g.font = `800 30px ${FONTE}`;
  g.textAlign = "left";
  g.fillText("LARSIL", 40, 46);
  g.fillStyle = "rgba(231,220,198,0.75)";
  g.font = `500 26px ${FONTE}`;
  g.fillText(cortarTexto(g, nomeDaSala, 560), 190, 47);
  g.textAlign = "right";
  g.fillStyle = "#f8fafc";
  g.font = `600 32px ${FONTE}`;
  g.fillText(hhmm, w - 40, 46);
  g.fillStyle = "rgba(255,255,255,0.12)";
  g.fillRect(40, 84, w - 80, 2);

  g.textAlign = "left";
  if (!cards.length) {
    g.textAlign = "center";
    g.fillStyle = "rgba(248,250,252,0.85)";
    g.font = `600 40px ${FONTE}`;
    g.fillText("Os cards da conversa aparecem aqui", w / 2, h / 2 - 6);
    g.fillStyle = "rgba(248,250,252,0.5)";
    g.font = `400 26px ${FONTE}`;
    g.fillText("Ligue “Cards por IA” e fale normalmente", w / 2, h / 2 + 44);
  }

  // Um card por linha: faixa da cor do tipo, emoji grande, título e "— Autor" + chips.
  const altura = 132;
  cards.forEach((c, i) => {
    const y = 104 + i * (altura + 8);
    const visual = VISUAL_DO_CARD[c.card.tipo as TipoVisivel];
    g.fillStyle = "rgba(255,255,255,0.07)";
    retanguloArredondado(g, 40, y, w - 80, altura, 16);
    g.fill();
    g.fillStyle = visual?.cor ?? "#94a3b8";
    retanguloArredondado(g, 40, y, 12, altura, 6);
    g.fill();

    g.textAlign = "center";
    g.font = `56px ${FONTE_EMOJI}`;
    g.fillText(c.card.emoji || visual?.emoji || "💬", 100, y + altura / 2 + 2);

    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    g.font = `600 44px ${FONTE}`;
    g.fillText(cortarTexto(g, c.card.titulo, w - 80 - 120 - 24), 150, y + 44);

    g.font = `500 26px ${FONTE}`;
    g.fillStyle = "rgba(248,250,252,0.75)";
    const autor = `— ${c.autorNome}`;
    g.fillText(autor, 150, y + 96);
    let x = 150 + g.measureText(autor).width + 18;
    // Autor = responsável ("— Ana" e o chip "Ana"): o chip só repetiria o nome.
    if (c.card.responsavel && !mesmaPessoa(c.card.responsavel, c.autorNome))
      x += chip(g, x, y + 96, `👤 ${c.card.responsavel}`) + 10;
    if (c.card.prazo) chip(g, x, y + 96, `📅 ${cortarTexto(g, c.card.prazo, 260)}`);
  });

  g.textAlign = "center";
  g.fillStyle = "rgba(248,250,252,0.45)";
  g.font = `500 22px ${FONTE}`;
  g.fillText("Telão livre · use Compartilhar tela", w / 2, h - 26);
}

function desenharFaixa(g: CanvasRenderingContext2D, w: number, h: number, quem: string) {
  g.fillStyle = "rgba(17,24,39,0.92)";
  retanguloArredondado(g, 0, 0, w, h, h / 2);
  g.fill();
  g.fillStyle = "#f8fafc";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 22px ${FONTE}`;
  g.fillText(
    cortarTexto(g, `Tela de ${quem || "alguém"} · clique duas vezes para ampliar`, w - 32),
    w / 2,
    h / 2 + 1,
  );
}

function TelaDeEspera({ mural, nomeDaSala }: { mural: CardNaSala[]; nomeDaSala: string }) {
  const cards = useMemo(() => cardsDoTelao(mural), [mural]);
  const hhmm = useMinuto();
  const chave = `${cards.map((c) => c.id).join(",")}|${hhmm}|${nomeDaSala}`;
  const textura = useTexturaDeCanvas(
    TELAO_ESPERA_PX.w,
    TELAO_ESPERA_PX.h,
    (g, w, h) => desenharEspera(g, w, h, cards, nomeDaSala, hhmm),
    chave,
    { anisotropia: 8 },
  );
  return (
    <mesh position={[0, 0, 0.036]}>
      <planeGeometry args={[TELAO_TELA.w, TELAO_TELA.h]} />
      {textura ? (
        <meshBasicMaterial map={textura} toneMapped={false} />
      ) : (
        <meshBasicMaterial color="#0f2a1f" />
      )}
    </mesh>
  );
}

function TelaComVideo({
  video,
  quem,
  aoVerTela,
}: {
  video: HTMLVideoElement;
  quem: string;
  aoVerTela?: () => void;
}) {
  const textura = useMemo(() => {
    const t = new VideoTexture(video);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [video]);
  useEffect(() => () => textura.dispose(), [textura]);
  const faixa = useTexturaDeCanvas(512, 64, (g, w, h) => desenharFaixa(g, w, h, quem), quem);
  return (
    <group>
      <mesh
        position={[0, 0, 0.036]}
        onDoubleClick={(e) => {
          e.stopPropagation();
          aoVerTela?.();
        }}
        onPointerOver={() => {
          if (aoVerTela) document.body.style.cursor = "zoom-in";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[TELAO_TELA.w, TELAO_TELA.h]} />
        <meshBasicMaterial map={textura} toneMapped={false} />
      </mesh>
      <mesh position={[0, -TELAO_MOLDURA.h / 2 - 0.13, 0.04]}>
        <planeGeometry args={[2.6, 0.325]} />
        {faixa ? (
          <meshBasicMaterial map={faixa} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#111827" />
        )}
      </mesh>
    </group>
  );
}

export function Telao({
  video,
  quem,
  mural,
  nomeDaSala,
  aoVerTela,
}: {
  video: HTMLVideoElement | null;
  quem?: string;
  mural: CardNaSala[];
  nomeDaSala: string;
  aoVerTela?: () => void;
}) {
  // O cursor de "ampliar" não pode ficar preso se o telão sair do ar com o mouse em cima.
  useEffect(() => () => void (document.body.style.cursor = ""), [video]);
  return (
    <group position={TELAO_CENTRO}>
      {/* Brilho azul atrás da moldura (o telão "acende" a parede). */}
      <mesh position={[0, 0, -0.012]}>
        <planeGeometry args={[TELAO_BRILHO.w, TELAO_BRILHO.h]} />
        <meshBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.15}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[TELAO_MOLDURA.w, TELAO_MOLDURA.h, 0.06]} />
        <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* A key separa as duas formas (vídeo × espera): o fiber de uma não serve à outra. */}
      <group key={"telao-" + (video ? "video" : "espera")}>
        {video ? (
          <TelaComVideo video={video} quem={quem ?? ""} aoVerTela={aoVerTela} />
        ) : (
          <TelaDeEspera mural={mural} nomeDaSala={nomeDaSala} />
        )}
      </group>
    </group>
  );
}
