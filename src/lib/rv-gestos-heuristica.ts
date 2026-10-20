/*
 * rv-gestos-heuristica.ts — transforma os PONTOS do MediaPipe em GESTOS da sala 3D.
 *
 * Veio do protótipo de pesquisa (scratchpad gestos-teste/heuristica-gestos.ts, 09/10/2026),
 * com as regras da especificação da sala imersiva (§4.1):
 *  - mão levantada só conta PARADA (punho com pouca velocidade horizontal) e por MAO_TRAVA_MS
 *    seguidos — quem está gesticulando ou acenando não entra na fila sem querer;
 *  - aceno vence a mão: enquanto houver ≥ 2 viradas na janela, a mão fica suprimida;
 *  - cotovelo acima do ombro com o punho fora do quadro também é mão levantada (quem senta
 *    perto da webcam corta a mão no alto da imagem);
 *  - momentâneos (aceno, palmas, joinha, coração) valem DURACAO_MOMENTANEO_MS; falando, aceno
 *    e palmas são ignorados (brasileiro gesticula falando).
 *
 * Por que existe: o MediaPipe devolve pontos a cada quadro, não gestos. "Levantou a mão" é uma
 * decisão no TEMPO. Aqui dentro não há DOM nem MediaPipe: o mesmo código roda na página e no
 * Node (os testes sintéticos do scratchpad importam este arquivo).
 *
 * Convenções:
 *  - Pontos normalizados como o MediaPipe entrega: x e y de 0 a 1, y para BAIXO. O x é
 *    multiplicado pelo aspecto (largura/altura) para as distâncias valerem igual nos dois eixos.
 *  - "esquerda"/"direita" são da PESSOA (anatômicas), como o PoseLandmarker nomeia os pontos —
 *    o mesmo lado do avatar dela.
 *  - Cabeça em radianos: yaw > 0 = virou para a ESQUERDA dela; pitch > 0 = olhou para CIMA.
 *  - Só sintaxe "apagável" de TypeScript (sem enum/namespace), para rodar com
 *    node --experimental-strip-types.
 */
import {
  DURACAO_MOMENTANEO_MS,
  MAO_TRAVA_MS,
  type GestoMomentaneo,
  type LadoDaMao,
} from "../components/rv/sala/tipos";

export interface Ponto {
  x: number;
  y: number;
  z?: number;
  /** 0–1: chance de o ponto estar à vista (o modelo também "chuta" os de fora do quadro). */
  visibility?: number;
}

export type Lado = "esquerda" | "direita";

/** Uma mão vinda do GestureRecognizer (que já inclui o HandLandmarker). */
export interface MaoDetectada {
  /** Os 21 pontos da mão, normalizados como os do corpo. */
  pontos: Ponto[];
  /** O gesto pronto ("Thumb_Up", "Open_Palm"…) com a nota, se houver. */
  gesto?: { nome: string; score: number } | null;
}

export interface EntradaDoQuadro {
  /** Instante do quadro em ms, estritamente crescente. */
  t: number;
  /** largura / altura do vídeo — os pontos chegam normalizados em cada eixo. */
  aspecto: number;
  /** Os 33 pontos do corpo da pessoa principal, ou null se não há ninguém. */
  pose: Ponto[] | null;
  /** As mãos do GestureRecognizer, quando ele rodou neste quadro (undefined = não rodou). */
  maos?: MaoDetectada[] | null;
  /** A pessoa está falando: aceno e palmas não viram momentâneo (joinha e coração sim). */
  ignorarMovimentoAmplo?: boolean;
}

export type TipoDeEvento =
  "mao-levantada" | "mao-abaixada" | "aceno" | "aplauso" | "joinha" | "coracao" | "chegou" | "saiu";

export interface EventoDeGesto {
  tipo: TipoDeEvento;
  lado?: Lado | "ambas";
  t: number;
}

export interface DirecaoDaCabeca {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface EstadoDosGestos {
  presente: boolean;
  /** Mão levantada (já parada por MAO_TRAVA_MS), sem a supressão do aceno. */
  maoLevantada: Record<Lado, boolean>;
  acenando: Lado | null;
  aplaudindo: boolean;
  joinha: boolean;
  coracao: boolean;
  /** Já calibrada (0,0,0 = postura de descanso) e suavizada; null de perfil ou sem ninguém. */
  cabeca: DirecaoDaCabeca | null;
  /** O que a sala usa: a mão levantada AGORA, já com aceno tendo prioridade. */
  maoAoVivo: LadoDaMao | null;
  /** O momentâneo da vez (janela de DURACAO_MOMENTANEO_MS), já com a prioridade aplicada. */
  momentaneo: GestoMomentaneo | null;
}

export interface Limiares {
  /** Visibilidade mínima para confiar num ponto do corpo. */
  visibilidadeMin: number;
  /** Abaixo disto o punho "sumiu" (regra do cotovelo alto com a mão fora do quadro). */
  visibilidadeSumiu: number;
  /** ms com a mão no alto E parada até contar (é a trava da fila). */
  levantarMs: number;
  /** ms com a mão embaixo (ou sumida) até soltar. */
  abaixarMs: number;
  /** Uma falha curta (ms) no meio da subida não zera a contagem. */
  toleranciaMs: number;
  /** Para ENTRAR: centro da mão afastado do nariz na horizontal (larguras de ombro). */
  afastamentoDoRosto: number;
  /** Porta 2 (juramento): mão só acima da BOCA, bem ao lado da cabeça e antebraço em pé. */
  afastamentoJuramento: number;
  /** Antebraço "em pé": ângulo máximo com a vertical, em graus. */
  antebracoMaxGraus: number;
  /** Para FICAR: topo da mão acima da linha do ombro por pelo menos isto (larguras de ombro). */
  margemParaFicar: number;
  /** Punho "parado": velocidade horizontal típica abaixo disto (larguras de ombro por segundo). */
  velocidadeParadaMax: number;
  /** Janela em que a velocidade é julgada (ms). */
  janelaParadaMs: number;
  /** Cada amostra de velocidade compara com a posição de pelo menos este tempo atrás (ms). */
  passoVelocidadeMs: number;
  /** Aceno: amplitude mínima de cada vaivém (larguras de ombro). */
  acenoAmplitude: number;
  /** Aceno: quantas viradas de direção dentro da janela. */
  acenoViradas: number;
  acenoJanelaMs: number;
  /** Aceno termina sem virada por este tempo. */
  acenoFimMs: number;
  /** Com pelo menos estas viradas na janela, a mão levantada fica suprimida (aceno > mão). */
  viradasQueSuprimem: number;
  /** Palmas: distância entre as mãos (larguras de ombro) para "juntas" e "separadas". */
  palmasJuntas: number;
  palmasSeparadas: number;
  palmasBatidas: number;
  palmasJanelaMs: number;
  palmasFimMs: number;
  /** Nota mínima do GestureRecognizer para o joinha. */
  joinhaNota: number;
  /** ms segurando o joinha / o coração até valer. */
  segurarGestoMs: number;
  /** ms sem ver o gesto até soltar. */
  soltarGestoMs: number;
  /** Tolerância dos gestos de mão: o reconhecedor roda a ~4 qps (250 ms entre amostras). */
  toleranciaMaoMs: number;
  /** Intervalo mínimo entre dois anúncios do mesmo gesto pontual. */
  reanunciarMs: number;
  /** Quanto tempo um momentâneo fica valendo depois de reconhecido. */
  momentaneoMs: number;
  /** Sem ninguém na frente da câmera por este tempo = "saiu". */
  ausenteMs: number;
  /** Calibração da cabeça: amostras do "olhando para a frente". */
  calibrarCabecaMs: number;
}

export const LIMIARES_PADRAO: Limiares = {
  visibilidadeMin: 0.5,
  visibilidadeSumiu: 0.3,
  levantarMs: MAO_TRAVA_MS,
  abaixarMs: 800,
  // 350 ms = um quadro perdido a 6 qps (a cadência degradada) não zera a contagem da trava.
  toleranciaMs: 350,
  afastamentoDoRosto: 0.3,
  afastamentoJuramento: 0.6,
  antebracoMaxGraus: 35,
  margemParaFicar: 0.15,
  velocidadeParadaMax: 0.5,
  janelaParadaMs: 800,
  passoVelocidadeMs: 100,
  acenoAmplitude: 0.12,
  acenoViradas: 3,
  acenoJanelaMs: 1600,
  acenoFimMs: 700,
  viradasQueSuprimem: 2,
  palmasJuntas: 0.3,
  palmasSeparadas: 0.45,
  palmasBatidas: 3,
  palmasJanelaMs: 1500,
  palmasFimMs: 900,
  joinhaNota: 0.6,
  segurarGestoMs: 400,
  soltarGestoMs: 600,
  toleranciaMaoMs: 400,
  reanunciarMs: 3000,
  momentaneoMs: DURACAO_MOMENTANEO_MS,
  ausenteMs: 3000,
  calibrarCabecaMs: 2000,
};

/* Índices do PoseLandmarker (33 pontos). Lado = da PESSOA. */
export const POSE = {
  nariz: 0,
  olhoEsq: 2,
  olhoDir: 5,
  orelhaEsq: 7,
  orelhaDir: 8,
  bocaEsq: 9,
  bocaDir: 10,
  ombroEsq: 11,
  ombroDir: 12,
} as const;

const BRACO = {
  esquerda: { ombro: 11, cotovelo: 13, pulso: 15, mindinho: 17, indicador: 19 },
  direita: { ombro: 12, cotovelo: 14, pulso: 16, mindinho: 18, indicador: 20 },
} as const;

/** Linhas do esqueleto desenhado na prévia (tronco e braços — o que a heurística usa). */
export const LIGACOES_DO_ESQUELETO: readonly (readonly [number, number])[] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [15, 19],
  [16, 20],
  [7, 0],
  [8, 0],
];

const LADOS: readonly Lado[] = ["esquerda", "direita"];

/** Prioridade entre momentâneos quando mais de um está valendo. */
const PRIORIDADE_MOMENTANEO: readonly GestoMomentaneo[] = ["aceno", "palmas", "joinha", "coracao"];

/* ———————————————————— medidas de um quadro (sem memória) ———————————————————— */

interface Xy {
  x: number;
  y: number;
}

export interface MedidasDaMao {
  /** A mão (ou, fora do quadro, o cotovelo alto) está à vista. */
  visivel: boolean;
  /** Topo da mão (o ponto mais alto entre pulso, indicador e mindinho) — isotrópico. */
  topo: Xy | null;
  /** Centro aproximado da mão. */
  centro: Xy | null;
  /** Condição para ENTRAR em "levantada" neste quadro (sem o "parada"). */
  entra: boolean;
  /** Condição para CONTINUAR "levantada" neste quadro. */
  fica: boolean;
  /** Posição horizontal da mão em relação ao ombro do mesmo lado (larguras de ombro). */
  xRel: number | null;
  /** Contou pela regra do cotovelo alto com o punho fora do quadro. */
  foraDoQuadro: boolean;
}

export interface MedidasDoQuadro {
  pessoa: boolean;
  /** Largura dos ombros na imagem (unidade = altura da imagem). NaN se não deu para medir. */
  escala: number;
  mao: Record<Lado, MedidasDaMao>;
  /** Distância entre as mãos, em larguras de ombro (NaN se alguma não aparece). */
  distanciaMaos: number;
  /** Cabeça estimada pelos pontos do rosto do PRÓPRIO corpo (sem calibração). */
  cabeca: DirecaoDaCabeca | null;
}

const MAO_VAZIA: MedidasDaMao = {
  visivel: false,
  topo: null,
  centro: null,
  entra: false,
  fica: false,
  xRel: null,
  foraDoQuadro: false,
};

function iso(p: Ponto, aspecto: number): Xy {
  return { x: p.x * aspecto, y: p.y };
}

function dist(a: Xy, b: Xy): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ve(p: Ponto | undefined, min: number): p is Ponto {
  return !!p && (p.visibility ?? 1) >= min;
}

/**
 * A régua do quadro: a largura dos ombros. Quando um ombro sai da imagem, a cabeça serve de
 * régua (orelha a orelha ≈ 1/2,6 dos ombros; olho a olho ≈ 1/4) — só precisa ser estável.
 */
export function escalaDoCorpo(pose: Ponto[], aspecto: number, min: number): number {
  const oe = pose[POSE.ombroEsq];
  const od = pose[POSE.ombroDir];
  if (ve(oe, min) && ve(od, min)) return dist(iso(oe, aspecto), iso(od, aspecto));
  const re = pose[POSE.orelhaEsq];
  const rd = pose[POSE.orelhaDir];
  if (ve(re, min) && ve(rd, min)) return dist(iso(re, aspecto), iso(rd, aspecto)) * 2.6;
  const ye = pose[POSE.olhoEsq];
  const yd = pose[POSE.olhoDir];
  if (ve(ye, min) && ve(yd, min)) return dist(iso(ye, aspecto), iso(yd, aspecto)) * 4.0;
  return Number.NaN;
}

function medirMao(
  pose: Ponto[],
  lado: Lado,
  aspecto: number,
  escala: number,
  lim: Limiares,
): MedidasDaMao {
  const b = BRACO[lado];
  const min = lim.visibilidadeMin;
  if (!(escala > 0)) return MAO_VAZIA;
  const outro = BRACO[lado === "esquerda" ? "direita" : "esquerda"];
  const ombroP = ve(pose[b.ombro], min)
    ? pose[b.ombro]
    : ve(pose[outro.ombro], min)
      ? pose[outro.ombro]
      : null;
  const pulsoP = pose[b.pulso];
  const cotoveloP = pose[b.cotovelo];

  // Fora do quadro: quem senta perto da webcam e ergue a mão corta o punho no alto da imagem.
  // Se o cotovelo está ACIMA do ombro e o punho sumiu (ou saiu por cima), é mão levantada —
  // ninguém deixa o cotovelo acima do ombro sem estar com o braço erguido.
  const pulsoSumiu = !pulsoP || (pulsoP.visibility ?? 1) < lim.visibilidadeSumiu || pulsoP.y < 0;
  if (pulsoSumiu && ombroP && ve(cotoveloP, min) && cotoveloP.y < ombroP.y) {
    const cot = iso(cotoveloP, aspecto);
    return {
      visivel: true,
      topo: cot,
      centro: cot,
      entra: true,
      fica: true,
      xRel: (cot.x - ombroP.x * aspecto) / escala,
      foraDoQuadro: true,
    };
  }
  if (!ve(pulsoP, min)) return MAO_VAZIA;

  const pulso = iso(pulsoP, aspecto);
  const pontosDaMao = [pulso];
  for (const i of [b.indicador, b.mindinho]) {
    const p = pose[i];
    if (ve(p, min * 0.6)) pontosDaMao.push(iso(p, aspecto));
  }
  let topo = pulso;
  for (const p of pontosDaMao) if (p.y < topo.y) topo = p;
  const centro = {
    x: pontosDaMao.reduce((s, p) => s + p.x, 0) / pontosDaMao.length,
    y: pontosDaMao.reduce((s, p) => s + p.y, 0) / pontosDaMao.length,
  };

  // A linha do ombro; se os dois ombros sumiram (rosto colado na câmera), um palpite abaixo da boca.
  const bocaP = ve(pose[POSE.bocaEsq], min) ? pose[POSE.bocaEsq] : null;
  const linhaDoOmbro = ombroP ? ombroP.y : bocaP ? bocaP.y + 0.3 * escala : Number.NaN;
  if (Number.isNaN(linhaDoOmbro)) return { ...MAO_VAZIA, visivel: true, topo, centro };

  const olhoP = ve(pose[POSE.olhoEsq], min)
    ? pose[POSE.olhoEsq]
    : ve(pose[POSE.olhoDir], min)
      ? pose[POSE.olhoDir]
      : null;
  const narizP = ve(pose[POSE.nariz], min) ? pose[POSE.nariz] : null;
  const linhaDosOlhos = olhoP ? olhoP.y : linhaDoOmbro - 0.45 * escala;
  const linhaDaBoca = bocaP ? bocaP.y : linhaDoOmbro - 0.25 * escala;
  const afastamento = narizP
    ? Math.abs(centro.x - narizP.x * aspecto) / escala
    : Number.POSITIVE_INFINITY;

  // Antebraço para cima (pulso acima do cotovelo). Cotovelo fora do quadro não veta.
  const cotovelo = ve(cotoveloP, min) ? iso(cotoveloP, aspecto) : null;
  const antebracoParaCima = cotovelo ? pulso.y < cotovelo.y : true;
  const antebracoEmPe = cotovelo
    ? pulso.y < cotovelo.y &&
      (Math.atan2(Math.abs(pulso.x - cotovelo.x), cotovelo.y - pulso.y) * 180) / Math.PI <=
        lim.antebracoMaxGraus
    : false;

  // Porta 1: topo acima dos olhos, pulso acima do ombro, mão AO LADO da cabeça (não na frente
  // do rosto: coçar o olho, tomar café) e antebraço para cima.
  // Porta 2 (juramento): nas fotos reais os pontos "indicador"/"mindinho" ficam nos NÓS dos
  // dedos — a mão erguida "de leve" para no nível do nariz. Aceita topo acima da boca + pulso
  // acima do ombro + antebraço em pé + mão bem ao lado da cabeça (telefone na orelha não passa).
  const porta1 =
    topo.y < linhaDosOlhos &&
    pulso.y < linhaDoOmbro &&
    afastamento >= lim.afastamentoDoRosto &&
    antebracoParaCima;
  const porta2 =
    topo.y < linhaDaBoca &&
    pulso.y < linhaDoOmbro &&
    antebracoEmPe &&
    afastamento >= lim.afastamentoJuramento;
  // FICAR: basta o topo da mão seguir acima da linha do ombro — o braço cansa e desce um pouco.
  const fica = topo.y < linhaDoOmbro - lim.margemParaFicar * escala;
  const xRel = ombroP ? (centro.x - ombroP.x * aspecto) / escala : null;
  return { visivel: true, topo, centro, entra: porta1 || porta2, fica, xRel, foraDoQuadro: false };
}

/**
 * Direção da cabeça só com nariz e orelhas do PoseLandmarker: custa zero e basta para o avatar
 * olhar para os lados. O deslocamento do nariz em relação ao meio das orelhas, em "distâncias
 * entre orelhas", é ≈ 0,65·tan(yaw) na horizontal e ≈ 0,55·sen(pitch) na vertical.
 * De perfil (ou de costas) a geometria não fecha: devolve null em vez de girar o avatar à toa.
 */
export function cabecaDoCorpo(pose: Ponto[], aspecto: number): DirecaoDaCabeca | null {
  const n = pose[POSE.nariz];
  const oe = pose[POSE.orelhaEsq];
  const od = pose[POSE.orelhaDir];
  if (!ve(n, 0.5) || !ve(oe, 0.05) || !ve(od, 0.05)) return null;
  const l = iso(oe, aspecto);
  const r = iso(od, aspecto);
  const p = iso(n, aspecto);
  const ux = l.x - r.x;
  const uy = l.y - r.y;
  const d = Math.hypot(ux, uy);
  if (d < 1e-4) return null;
  const ex = ux / d;
  const ey = uy / d;
  const dx = p.x - (l.x + r.x) / 2;
  const dy = p.y - (l.y + r.y) / 2;
  const lateral = (dx * ex + dy * ey) / d;
  const vertical = (dx * ey - dy * ex) / d;
  if (Math.abs(lateral) > 1.6 || Math.abs(vertical) > 0.5) return null;
  return {
    yaw: Math.atan(lateral / 0.65),
    pitch: Math.asin(Math.max(-1, Math.min(1, vertical / 0.55))),
    roll: Math.atan2(ey, ex),
  };
}

/** As medidas de um quadro, sem memória — útil para testar fotos. */
export function medirQuadro(
  pose: Ponto[] | null,
  aspecto: number,
  lim: Limiares = LIMIARES_PADRAO,
): MedidasDoQuadro {
  if (!pose || pose.length < 23) {
    return {
      pessoa: false,
      escala: Number.NaN,
      mao: { esquerda: MAO_VAZIA, direita: MAO_VAZIA },
      distanciaMaos: Number.NaN,
      cabeca: null,
    };
  }
  const escala = escalaDoCorpo(pose, aspecto, lim.visibilidadeMin);
  const mao = {
    esquerda: medirMao(pose, "esquerda", aspecto, escala, lim),
    direita: medirMao(pose, "direita", aspecto, escala, lim),
  };
  const ce = mao.esquerda.centro;
  const cd = mao.direita.centro;
  const distanciaMaos =
    mao.esquerda.visivel &&
    mao.direita.visivel &&
    !mao.esquerda.foraDoQuadro &&
    !mao.direita.foraDoQuadro &&
    ce &&
    cd &&
    escala > 0
      ? dist(ce, cd) / escala
      : Number.NaN;
  return { pessoa: true, escala, mao, distanciaMaos, cabeca: cabecaDoCorpo(pose, aspecto) };
}

/**
 * Alguma mão passou do meio do peito? Liga o GestureRecognizer (caro) só quando pode haver
 * joinha ou coração — as mãos de quem está com os braços na mesa ficam abaixo disso.
 */
export function maoAcimaDoPeito(pose: Ponto[] | null, aspecto: number, min = 0.5): boolean {
  if (!pose || pose.length < 23) return false;
  const escala = escalaDoCorpo(pose, aspecto, min);
  if (!(escala > 0)) return false;
  const oe = pose[POSE.ombroEsq];
  const od = pose[POSE.ombroDir];
  const ombros = [oe, od].filter((p) => ve(p, min));
  if (!ombros.length) return false;
  const linhaDoOmbro = ombros.reduce((s, p) => s + p.y, 0) / ombros.length;
  // Meio do peito ≈ 0,6 largura de ombro abaixo da linha dos ombros (o tronco tem ~1,2).
  const meioDoPeito = linhaDoOmbro + 0.6 * escala;
  return [15, 16].some((i) => ve(pose[i], min) && pose[i].y < meioDoPeito);
}

/* ———————————————————— gestos de mão (21 pontos) ———————————————————— */

/**
 * Coração com as duas mãos: pontas dos indicadores se tocam em cima, as dos polegares embaixo,
 * pulsos afastados. Régua = pulso → base do dedo médio. Experimental: as mãos se cobrem.
 */
export function formaCoracao(a: Ponto[], b: Ponto[], aspecto: number): boolean {
  if (a.length < 21 || b.length < 21) return false;
  const P = (m: Ponto[], i: number) => iso(m[i], aspecto);
  const regua = (dist(P(a, 0), P(a, 9)) + dist(P(b, 0), P(b, 9))) / 2;
  if (!(regua > 0)) return false;
  const polegares = dist(P(a, 4), P(b, 4));
  const indicadores = dist(P(a, 8), P(b, 8));
  const yIndicadores = (a[8].y + b[8].y) / 2;
  const yPolegares = (a[4].y + b[4].y) / 2;
  const pulsos = dist(P(a, 0), P(b, 0));
  return (
    polegares < 0.6 * regua &&
    indicadores < 0.6 * regua &&
    yPolegares - yIndicadores > 0.5 * regua &&
    pulsos > 0.8 * regua
  );
}

/* ———————————————————— filtro da cabeça ———————————————————— */

/**
 * Filtro "One Euro" (Casiez et al., 2012): suaviza muito com a cabeça parada (tira o tremido) e
 * pouco quando ela se mexe rápido (sem atraso).
 */
export class FiltroUmEuro {
  private x: number | null = null;
  private dx = 0;
  private tAnterior = 0;
  private readonly corteMin: number;
  private readonly beta: number;

  constructor(corteMin = 1.2, beta = 0.6) {
    this.corteMin = corteMin;
    this.beta = beta;
  }

  filtrar(t: number, valor: number): number {
    if (this.x === null) {
      this.x = valor;
      this.tAnterior = t;
      return valor;
    }
    const dt = Math.max(1e-3, (t - this.tAnterior) / 1000);
    this.tAnterior = t;
    const alfa = (corte: number) => 1 / (1 + 1 / (2 * Math.PI * corte * dt));
    const dxBruto = (valor - this.x) / dt;
    this.dx += alfa(1.0) * (dxBruto - this.dx);
    const corte = this.corteMin + this.beta * Math.abs(this.dx);
    this.x += alfa(corte) * (valor - this.x);
    return this.x;
  }

  zerar(): void {
    this.x = null;
    this.dx = 0;
  }
}

/* ———————————————————— a máquina de estados ———————————————————— */

interface EstadoDaMao {
  levantada: boolean;
  /** Início da sequência de quadros "entra e parada" (null = não está subindo). */
  subindoDesde: number | null;
  ultimoEntra: number;
  ultimoFica: number;
}

/** Histórico do punho para medir a velocidade horizontal no TEMPO (não por quadro). */
interface Rastro {
  posicoes: { t: number; x: number }[];
  velocidades: { t: number; v: number }[];
}

interface Vaivem {
  extremo: number;
  direcao: -1 | 0 | 1;
  viradas: number[];
  acenando: boolean;
  ultimoAnuncio: number;
}

interface Segurador {
  ativo: boolean;
  desde: number | null;
  ultimoVisto: number;
  ultimoAnuncio: number;
}

function novoSegurador(): Segurador {
  return {
    ativo: false,
    desde: null,
    ultimoVisto: Number.NEGATIVE_INFINITY,
    ultimoAnuncio: Number.NEGATIVE_INFINITY,
  };
}

function novoVaivem(): Vaivem {
  return {
    extremo: Number.NaN,
    direcao: 0,
    viradas: [],
    acenando: false,
    ultimoAnuncio: Number.NEGATIVE_INFINITY,
  };
}

function novaMao(): EstadoDaMao {
  return {
    levantada: false,
    subindoDesde: null,
    ultimoEntra: Number.NEGATIVE_INFINITY,
    ultimoFica: Number.NEGATIVE_INFINITY,
  };
}

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Recebe um quadro por vez e devolve os EVENTOS (o que mudou); o estado corrente fica em
 * `estado` (maoAoVivo e momentaneo são o que a sala usa). Tempo em ms, sempre crescente.
 */
export class MaquinaDeGestos {
  readonly lim: Limiares;
  estado: EstadoDosGestos = {
    presente: false,
    maoLevantada: { esquerda: false, direita: false },
    acenando: null,
    aplaudindo: false,
    joinha: false,
    coracao: false,
    cabeca: null,
    maoAoVivo: null,
    momentaneo: null,
  };

  private escala = Number.NaN;
  private ultimaPessoa = Number.NEGATIVE_INFINITY;
  /** Intervalo típico entre quadros (média móvel): a tolerância cresce em máquina lenta. */
  private dtMedio = 0;
  private tAnterior: number | null = null;
  private maos: Record<Lado, EstadoDaMao> = { esquerda: novaMao(), direita: novaMao() };
  private rastros: Record<Lado, Rastro> = {
    esquerda: { posicoes: [], velocidades: [] },
    direita: { posicoes: [], velocidades: [] },
  };
  private vaivens: Record<Lado, Vaivem> = { esquerda: novoVaivem(), direita: novoVaivem() };
  private palmas = {
    juntas: false,
    batidas: [] as number[],
    ultimoAnuncio: Number.NEGATIVE_INFINITY,
  };
  private joinha = novoSegurador();
  private coracao = novoSegurador();
  /** Até quando cada momentâneo vale (ms, no relógio dos quadros). */
  private validade: Record<GestoMomentaneo, number> = {
    aceno: Number.NEGATIVE_INFINITY,
    palmas: Number.NEGATIVE_INFINITY,
    joinha: Number.NEGATIVE_INFINITY,
    coracao: Number.NEGATIVE_INFINITY,
  };
  private filtros = {
    yaw: new FiltroUmEuro(1.2, 0.6),
    pitch: new FiltroUmEuro(1.2, 0.6),
    roll: new FiltroUmEuro(1.2, 0.6),
  };
  private amostrasCabeca: DirecaoDaCabeca[] = [];
  private inicioCalibracao: number | null = null;
  private neutro: DirecaoDaCabeca | null = null;

  constructor(lim: Partial<Limiares> = {}) {
    this.lim = { ...LIMIARES_PADRAO, ...lim };
  }

  /** Esquece a postura neutra da cabeça (botão "Recalibrar cabeça", volta da aba oculta). */
  recalibrarCabeca(): void {
    this.neutro = null;
    this.amostrasCabeca = [];
    this.inicioCalibracao = null;
    this.filtros.yaw.zerar();
    this.filtros.pitch.zerar();
    this.filtros.roll.zerar();
  }

  alimentar(q: EntradaDoQuadro): EventoDeGesto[] {
    const ev: EventoDeGesto[] = [];
    const t = q.t;
    const lim = this.lim;
    const m = medirQuadro(q.pose, q.aspecto, lim);
    if (this.tAnterior !== null) {
      const dt = Math.min(2_000, t - this.tAnterior);
      this.dtMedio = this.dtMedio ? this.dtMedio + 0.2 * (dt - this.dtMedio) : dt;
    }
    this.tAnterior = t;
    // Um quadro perdido não pode zerar a trava: a 3 qps (máquina sobrecarregada) a folga de
    // 350 ms seria menor que o próprio intervalo entre quadros.
    const tolerancia = Math.max(lim.toleranciaMs, 1.6 * this.dtMedio);

    // Presença: some por ausenteMs = "saiu" (as mãos descem pelo caminho normal).
    if (m.pessoa) {
      if (!this.estado.presente) ev.push({ tipo: "chegou", t });
      this.estado.presente = true;
      this.ultimaPessoa = t;
    } else if (this.estado.presente && t - this.ultimaPessoa >= lim.ausenteMs) {
      this.estado.presente = false;
      ev.push({ tipo: "saiu", t });
    }

    if (m.escala > 0)
      this.escala = Number.isNaN(this.escala)
        ? m.escala
        : this.escala + 0.2 * (m.escala - this.escala);

    // —— aceno (antes da mão levantada: um aceno não é "levantar a mão") ——
    for (const lado of LADOS) {
      const md = m.mao[lado];
      const v = this.vaivens[lado];
      this.passoDoVaivem(v, t, md.fica ? md.xRel : null);
      if (!v.acenando && v.viradas.length >= lim.acenoViradas) {
        v.acenando = true;
        if (t - v.ultimoAnuncio >= lim.reanunciarMs) {
          v.ultimoAnuncio = t;
          ev.push({ tipo: "aceno", lado, t });
        }
      } else if (
        v.acenando &&
        (v.viradas.length === 0 || t - v.viradas[v.viradas.length - 1] > lim.acenoFimMs)
      ) {
        v.acenando = false;
      }
    }
    this.estado.acenando = this.vaivens.direita.acenando
      ? "direita"
      : this.vaivens.esquerda.acenando
        ? "esquerda"
        : null;

    // —— mão levantada: no alto, PARADA e por levantarMs seguidos; histerese para descer ——
    const subiu: Lado[] = [];
    const desceu: Lado[] = [];
    const visivelAgora: Record<Lado, boolean> = { esquerda: false, direita: false };
    for (const lado of LADOS) {
      const md = m.mao[lado];
      const e = this.maos[lado];
      const v = this.vaivens[lado];
      const parada = this.passoDaVelocidade(this.rastros[lado], t, md.xRel);
      // Com ≥ 2 viradas na janela a pessoa está acenando (ou prestes a): a mão não sobe, mas a
      // contagem do "parado" segue — quem acena e depois deixa a mão no alto entra logo.
      const suprimida = v.viradas.length >= lim.viradasQueSuprimem;
      if (!e.levantada) {
        if (md.entra && parada) {
          if (e.subindoDesde === null || t - e.ultimoEntra > tolerancia) e.subindoDesde = t;
          e.ultimoEntra = t;
          if (t - e.subindoDesde >= lim.levantarMs && !suprimida) {
            e.levantada = true;
            e.subindoDesde = null;
            e.ultimoFica = t;
            subiu.push(lado);
          }
        } else if (e.subindoDesde !== null && t - e.ultimoEntra > tolerancia) {
          e.subindoDesde = null;
        }
      } else if (md.fica) {
        e.ultimoFica = t;
      } else if (t - e.ultimoFica >= lim.abaixarMs) {
        e.levantada = false;
        desceu.push(lado);
      }
      this.estado.maoLevantada[lado] = e.levantada;
      visivelAgora[lado] = e.levantada && !suprimida && !v.acenando;
    }
    // As duas no mesmo quadro viram um evento só ("ambas").
    if (subiu.length === 2) ev.push({ tipo: "mao-levantada", lado: "ambas", t });
    else for (const lado of subiu) ev.push({ tipo: "mao-levantada", lado, t });
    if (desceu.length === 2) ev.push({ tipo: "mao-abaixada", lado: "ambas", t });
    else for (const lado of desceu) ev.push({ tipo: "mao-abaixada", lado, t });
    this.estado.maoAoVivo =
      visivelAgora.direita && visivelAgora.esquerda
        ? "duas"
        : visivelAgora.direita
          ? "direita"
          : visivelAgora.esquerda
            ? "esquerda"
            : null;

    // —— palmas: as mãos se encontram e se separam várias vezes ——
    const d = m.distanciaMaos;
    const p = this.palmas;
    if (!Number.isNaN(d)) {
      if (!p.juntas && d < lim.palmasJuntas) {
        p.juntas = true;
        p.batidas.push(t);
      } else if (p.juntas && d > lim.palmasSeparadas) {
        p.juntas = false;
      }
    }
    while (p.batidas.length && t - p.batidas[0] > lim.palmasJanelaMs) p.batidas.shift();
    if (!this.estado.aplaudindo && p.batidas.length >= lim.palmasBatidas) {
      this.estado.aplaudindo = true;
      if (t - p.ultimoAnuncio >= lim.reanunciarMs) {
        p.ultimoAnuncio = t;
        ev.push({ tipo: "aplauso", t });
      }
    } else if (
      this.estado.aplaudindo &&
      (p.batidas.length === 0 || t - p.batidas[p.batidas.length - 1] > lim.palmasFimMs)
    ) {
      this.estado.aplaudindo = false;
    }

    // —— gestos de mão (só quando o GestureRecognizer rodou neste quadro) ——
    if (q.maos !== undefined) {
      const maos = q.maos ?? [];
      const viuJoinha = maos.some(
        (h) => h.gesto?.nome === "Thumb_Up" && h.gesto.score >= lim.joinhaNota,
      );
      if (this.segurar(this.joinha, t, viuJoinha)) ev.push({ tipo: "joinha", t });
      const viuCoracao =
        maos.length >= 2 && formaCoracao(maos[0].pontos, maos[1].pontos, q.aspecto);
      if (this.segurar(this.coracao, t, viuCoracao)) ev.push({ tipo: "coracao", t });
    } else {
      // Sem amostra nova o segurador só pode SOLTAR (o reconhecedor desligou com as mãos baixas).
      this.segurar(this.joinha, t, null);
      this.segurar(this.coracao, t, null);
    }
    this.estado.joinha = this.joinha.ativo;
    this.estado.coracao = this.coracao.ativo;

    // —— momentâneos: cada um vale momentaneoMs; renova se o gesto continua ——
    const amplo = !q.ignorarMovimentoAmplo;
    const ativos: Record<GestoMomentaneo, boolean> = {
      aceno: amplo && this.estado.acenando !== null,
      palmas: amplo && this.estado.aplaudindo,
      joinha: this.estado.joinha,
      coracao: this.estado.coracao,
    };
    for (const g of PRIORIDADE_MOMENTANEO) {
      if (ativos[g] && this.validade[g] <= t) this.validade[g] = t + lim.momentaneoMs;
    }
    this.estado.momentaneo = PRIORIDADE_MOMENTANEO.find((g) => this.validade[g] > t) ?? null;

    // —— cabeça: calibra a postura neutra e suaviza ——
    this.estado.cabeca = this.passoDaCabeca(t, m.cabeca);
    return ev;
  }

  /**
   * Velocidade horizontal do punho medida no TEMPO: cada amostra compara com a posição de pelo
   * menos passoVelocidadeMs atrás (divide o tremido do modelo por um dt maior) e o "parado" é a
   * MEDIANA da janela — um quadro torto não derruba nem levanta a mão.
   */
  private passoDaVelocidade(r: Rastro, t: number, x: number | null): boolean {
    const lim = this.lim;
    if (x === null || !(this.escala > 0)) {
      r.posicoes = [];
      r.velocidades = [];
      return false;
    }
    r.posicoes.push({ t, x });
    while (r.posicoes.length && t - r.posicoes[0].t > lim.janelaParadaMs + 400) r.posicoes.shift();
    let ref: { t: number; x: number } | null = null;
    for (let i = r.posicoes.length - 1; i >= 0; i--) {
      if (t - r.posicoes[i].t >= lim.passoVelocidadeMs) {
        ref = r.posicoes[i];
        break;
      }
    }
    if (ref) r.velocidades.push({ t, v: Math.abs(x - ref.x) / ((t - ref.t) / 1000) });
    while (r.velocidades.length && t - r.velocidades[0].t > lim.janelaParadaMs)
      r.velocidades.shift();
    // Mão que acabou de aparecer: ainda não dá para medir; quem decide é a contagem de 1 s.
    if (r.velocidades.length < 2) return true;
    return mediana(r.velocidades.map((a) => a.v)) < lim.velocidadeParadaMax;
  }

  /** Detector de vaivém (zigue-zague com amplitude mínima). x = null zera. */
  private passoDoVaivem(v: Vaivem, t: number, x: number | null): void {
    const amp = this.lim.acenoAmplitude;
    if (x === null) {
      v.extremo = Number.NaN;
      v.direcao = 0;
    } else if (Number.isNaN(v.extremo)) {
      v.extremo = x;
      v.direcao = 0;
    } else if (v.direcao === 0) {
      if (x - v.extremo >= amp) {
        v.direcao = 1;
        v.extremo = x;
      } else if (v.extremo - x >= amp) {
        v.direcao = -1;
        v.extremo = x;
      }
    } else if (v.direcao === 1) {
      if (x > v.extremo) v.extremo = x;
      else if (v.extremo - x >= amp) {
        v.direcao = -1;
        v.extremo = x;
        v.viradas.push(t);
      }
    } else if (x < v.extremo) {
      v.extremo = x;
    } else if (x - v.extremo >= amp) {
      v.direcao = 1;
      v.extremo = x;
      v.viradas.push(t);
    }
    while (v.viradas.length && t - v.viradas[0] > this.lim.acenoJanelaMs) v.viradas.shift();
  }

  /**
   * Gesto "segurado" (joinha, coração): liga após segurarGestoMs, solta após soltarGestoMs.
   * visto = null: o reconhecedor não rodou neste quadro (só confere se é hora de soltar).
   * Devolve true quando deve ANUNCIAR.
   */
  private segurar(s: Segurador, t: number, visto: boolean | null): boolean {
    const lim = this.lim;
    if (visto) {
      if (s.desde === null || t - s.ultimoVisto > lim.toleranciaMaoMs) s.desde = t;
      s.ultimoVisto = t;
      if (!s.ativo && t - s.desde >= lim.segurarGestoMs) {
        s.ativo = true;
        if (t - s.ultimoAnuncio >= lim.reanunciarMs) {
          s.ultimoAnuncio = t;
          return true;
        }
      }
    } else if (s.ativo && t - s.ultimoVisto >= lim.soltarGestoMs) {
      s.ativo = false;
      s.desde = null;
    } else if (!s.ativo && s.desde !== null && t - s.ultimoVisto > lim.toleranciaMaoMs) {
      s.desde = null;
    }
    return false;
  }

  private passoDaCabeca(t: number, bruta: DirecaoDaCabeca | null): DirecaoDaCabeca | null {
    if (!bruta) {
      // De perfil ou sem ninguém: "não sei". Zera o filtro para não arrastar o valor velho.
      this.filtros.yaw.zerar();
      this.filtros.pitch.zerar();
      this.filtros.roll.zerar();
      return null;
    }
    if (!this.neutro) {
      // Calibração: a mediana dos primeiros segundos vira o "olhando para a frente" — tira o
      // efeito da câmera estar acima/abaixo/ao lado da tela.
      if (this.inicioCalibracao === null) this.inicioCalibracao = t;
      this.amostrasCabeca.push(bruta);
      if (t - this.inicioCalibracao < this.lim.calibrarCabecaMs) return null;
      this.neutro = {
        yaw: mediana(this.amostrasCabeca.map((a) => a.yaw)),
        pitch: mediana(this.amostrasCabeca.map((a) => a.pitch)),
        roll: mediana(this.amostrasCabeca.map((a) => a.roll)),
      };
      this.amostrasCabeca = [];
    }
    const n = this.neutro;
    return {
      yaw: this.filtros.yaw.filtrar(t, bruta.yaw - n.yaw),
      pitch: this.filtros.pitch.filtrar(t, bruta.pitch - n.pitch),
      roll: this.filtros.roll.filtrar(t, bruta.roll - n.roll),
    };
  }
}
