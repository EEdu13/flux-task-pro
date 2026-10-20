import type { RostoDeReacao } from "@/components/rv/avatar-texturas";
import type { Medidas } from "@/components/rv/medidas";

/**
 * Os gestos das reações do avatar (17/10/2026): beijo, bravo e comemorar. Funções puras
 * do tempo — o `Avatar3D` só aplica o resultado no `useFrame`.
 *
 * O braço do boneco é um bloco só, sem cotovelo: cada gesto diz para ONDE o
 * braço aponta (um vetor, no referencial do avatar em pé, de frente para +z) e
 * o Avatar3D gira o grupo do ombro para lá. Os alvos (boca, peito) saem das
 * MEDIDAS do corpo, então o mesmo gesto serve nos 10 corpos.
 *
 * Lados, como no resto do esqueleto: 1 é o braço ESQUERDO do boneco (x > 0, à
 * direita de quem olha), −1 o direito. O beijo sai da mão esquerda — a do
 * aceno: a direita carrega relógio, prancheta, balão (`acessorios-extras.tsx`).
 */

/**
 * `comemorar` (17/10/2026): braços para cima e pulinhos — a foto do Mural na
 * conquista. Os outros nove entraram no mesmo dia, com as reações novas do
 * chat. O id do gesto é o MESMO da reação (`reacoes-do-avatar.ts`).
 */
export type GestoDeReacao =
  | "beijo"
  | "bravo"
  | "comemorar"
  | "abraco"
  | "obrigado"
  | "joinha"
  | "olho"
  | "rindo"
  | "bora"
  | "sono"
  | "cafe"
  | "trofeu"
  // A foto do time abraçado no cartão "Time 100%" do mural (19/10/2026).
  | "grupo";
/** Todos os gestos que o Avatar3D sabe fazer. `acenar` é o tchauzinho do Início. */
export type Gesto = "acenar" | GestoDeReacao;
export type Lado = 1 | -1;
type V3 = [number, number, number];

/** Os braços que cada gesto solta da malha da roupa. */
export const BRACOS_DO_GESTO: Record<Gesto, readonly Lado[]> = {
  acenar: [1],
  beijo: [1],
  bravo: [-1, 1],
  comemorar: [-1, 1],
  abraco: [-1, 1],
  obrigado: [-1, 1],
  joinha: [1],
  olho: [1],
  rindo: [-1, 1],
  bora: [-1, 1],
  sono: [-1, 1],
  cafe: [1],
  trofeu: [-1, 1],
  grupo: [-1, 1],
};

/** O rosto de reação de cada gesto (`desenharRosto`). */
export const ROSTO_DO_GESTO: Record<GestoDeReacao, RostoDeReacao> = {
  beijo: "beijo",
  bravo: "furioso",
  comemorar: "festa",
  abraco: "carinho",
  obrigado: "grato",
  joinha: "piscada",
  olho: "desconfiado",
  rindo: "gargalhada",
  bora: "determinado",
  sono: "sono",
  cafe: "tranquilo",
  trofeu: "estrela",
  grupo: "festa",
};

/** O instante que resume o gesto numa foto — usado com movimento reduzido. */
export const INSTANTE_PARADO: Record<GestoDeReacao, number> = {
  beijo: 1.2,
  bravo: 1.5,
  // no alto do pulo, braços lá em cima
  comemorar: 0.25,
  abraco: 1.6,
  obrigado: 1.5,
  joinha: 1.0,
  olho: 2.2,
  rindo: 2.3,
  bora: 0.9,
  sono: 1.8,
  cafe: 1.8,
  trofeu: 1.2,
  grupo: 1,
};

/* Os instantes que a cena usa para soltar efeitos e sons no tempo do gesto. */
/** Abraço: os braços fecham na frente — a cena aproxima o boneco. */
export const ABRACO_EM = 1.15;
/** Joinha: o braço chega na frente. */
export const JOINHA_EM = 0.45;
/** Tô de olho: o dedo sai dos olhos e aponta para quem recebe. */
export const OLHO_APONTA_EM = 1.6;
/** Sono: a cabeça tomba — começam os "Zzz". */
export const SONO_TOMBA_EM = 2.2;
/** Obrigado: o corpo se curva. */
export const OBRIGADO_CURVA_EM = 0.9;

/** Quando, no beijo, a mão solta o beijo — a tela solta os corações junto. */
export const BEIJO_SOLTO_EM = 1.62;
/** Quando, no bravo, os braços terminam de cruzar com o pisão — a tela treme junto. */
export const PISAO_EM = 0.6;

export type PoseDeReacao = {
  /** Corpo: pulo (m), escala a partir do chão e inclinação (rad, + = para a frente). */
  y: number;
  alto: number;
  largo: number;
  inclina: number;
  balanco: number;
  /** Somado ao giro de sempre da cabeça (rad). */
  cabeca: V3;
  /** Para onde aponta cada braço solto (vetor unitário); ausente = caído. */
  bracos: Partial<Record<Lado, V3>>;
};

const suave = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** Sai rápido e assenta devagar — o "arremesso" do beijo. */
const saida = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return 1 - (1 - t) ** 3;
};
const entre = (s: number, a: number, b: number) => (s - a) / (b - a);

const normal = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const misturar = (a: V3, b: V3, k: number): V3 =>
  normal([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);

/** O braço caído, como o esqueleto o deixa em pé (ombro girado 0,06 rad em z). */
const caido = (l: Lado): V3 => [Math.sin(0.06 * l), -Math.cos(0.06 * l), 0];

/** Os pontos do corpo em pé que os gestos usam como alvo. */
function pontos(m: Medidas) {
  const ombroY = m.pernaH + m.troncoH - 0.06;
  const cabecaY = m.pernaH + m.troncoH + 0.03 + m.cabeca / 2;
  return {
    ombroX: m.troncoW / 2 + m.bracoW / 2 + 0.01,
    ombroY,
    // A boca do adesivo: 48 px abaixo do meio de uma textura de 256 px.
    bocaY: cabecaY - 0.01 - m.cabeca * 0.9 * (48 / 256),
    rostoZ: (m.cabeca * 0.92) / 2,
    /** Da articulação do ombro ao meio da mão. */
    mao: m.troncoH - 0.1,
  };
}

/** A direção que leva o MEIO da mão do braço `l` ao ponto `alvo`. */
function apontar(m: Medidas, l: Lado, alvo: V3): V3 {
  const p = pontos(m);
  return normal([alvo[0] - p.ombroX * l, alvo[1] - p.ombroY, alvo[2]]);
}

/** Esticado na direção de quem olha, um pouco para cima e para fora. */
const BEIJO_ATIRADO = normal([0.2, 0.22, 1]);

/** Onde fica a mão que atirou o beijo (referencial do avatar): de onde saem os corações. */
export function maoQueAtirouOBeijo(m: Medidas): V3 {
  const p = pontos(m);
  return [
    p.ombroX + BEIJO_ATIRADO[0] * p.mao,
    p.ombroY + BEIJO_ATIRADO[1] * p.mao,
    BEIJO_ATIRADO[2] * p.mao,
  ];
}

/** O beijo e o bravo em `s` segundos (depois do fim, a pose de descanso). */
export function poseDaReacao(gesto: GestoDeReacao, s: number, m: Medidas): PoseDeReacao {
  if (gesto === "beijo") return poseDoBeijo(s, m);
  switch (gesto) {
    case "comemorar":
      return poseDaComemoracao(s);
    case "abraco":
      return poseDoAbraco(s);
    case "obrigado":
      return poseDoObrigado(s, m);
    case "joinha":
      return poseDoJoinha(s);
    case "olho":
      return poseDoOlho(s, m);
    case "rindo":
      return poseDoRiso(s, m);
    case "bora":
      return poseDoBora(s);
    case "sono":
      return poseDoSono(s, m);
    case "cafe":
      return poseDoCafe(s, m);
    case "trofeu":
      return poseDoTrofeu(s);
    case "grupo":
      return poseDoGrupo();
    default:
      return poseDoBravo(s, m);
  }
}

/**
 * Onde está o meio da mão do braço `lado` no instante `s` do gesto
 * (referencial do avatar) — para a cena prender a xícara, o troféu, o 👍.
 * Não conta a inclinação do corpo: os gestos que seguram algo quase não inclinam.
 */
export function maoNoGesto(gesto: GestoDeReacao, s: number, m: Medidas, lado: Lado): V3 {
  const pose = poseDaReacao(gesto, s, m);
  const d = pose.bracos[lado] ?? caido(lado);
  const p = pontos(m);
  return [p.ombroX * lado + d[0] * p.mao, p.ombroY + d[1] * p.mao + pose.y, d[2] * p.mao];
}

/** Sobe em `sobe` segundos a partir de `ini` e desce nos últimos `desce` antes de `fim`. */
const janela = (s: number, ini: number, sobe: number, fim: number, desce: number) =>
  suave(entre(s, ini, ini + sobe)) * (1 - suave(entre(s, fim - desce, fim)));

/** Pose sem nada além dos braços. */
const so = (bracos: PoseDeReacao["bracos"], extra: Partial<PoseDeReacao> = {}): PoseDeReacao => ({
  y: 0,
  alto: 1,
  largo: 1,
  inclina: 0,
  balanco: 0,
  cabeca: [0, 0, 0],
  bracos,
  ...extra,
});

/**
 * Abraço (~3,4 s): abre bem os braços (0,15–0,6), fecha na frente como quem
 * abraça quem está olhando (0,9–1,25), balança de um lado para o outro
 * com a cabeça deitada e solta (3,0–3,4).
 */
function poseDoAbraco(s: number): PoseDeReacao {
  const abre = suave(entre(s, 0.15, 0.6));
  const fecha = suave(entre(s, 0.9, 1.25));
  const solta = suave(entre(s, 3.0, 3.4));
  const braco = (l: Lado) =>
    misturar(
      misturar(
        misturar(caido(l), normal([l, 0.3, 0.35]), abre),
        normal([l * 0.12, 0.06, 1]),
        fecha,
      ),
      caido(l),
      solta,
    );
  const junto = fecha * (1 - solta);
  return so(
    { 1: braco(1), [-1]: braco(-1) },
    {
      inclina: 0.12 * junto,
      balanco: 0.06 * junto * Math.sin(2 * Math.PI * 0.8 * (s - 1.25)),
      cabeca: [0.08 * junto, 0, 0.16 * junto],
    },
  );
}

/**
 * Obrigado (~3,3 s): junta as mãos no peito (0,15–0,5), curva o corpo e a
 * cabeça numa reverência (0,7–1,1), fica um pouco, levanta (2,0–2,4) e solta
 * as mãos (2,9–3,3).
 */
function poseDoObrigado(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const frente = m.troncoD / 2 + m.bracoW * 0.75;
  const peito: V3 = [0, p.ombroY - m.troncoH * 0.22, frente + 0.1];
  const k = janela(s, 0.15, 0.35, 3.3, 0.4);
  const curva = janela(s, 0.7, 0.4, 2.4, 0.4);
  return so(
    {
      1: misturar(caido(1), apontar(m, 1, peito), k),
      [-1]: misturar(caido(-1), apontar(m, -1, peito), k),
    },
    { inclina: 0.2 * curva, cabeca: [0.3 * curva, 0, 0] },
  );
}

/**
 * Joinha (~3,0 s): estica o braço para a frente (0,15–0,45) — a cena põe o
 * 👍 na mão —, dá umas sacudidas de "valeu!" e volta (2,6–3,0). Pulinho na chegada.
 */
function poseDoJoinha(s: number): PoseDeReacao {
  const k = janela(s, 0.15, 0.3, 3.0, 0.4);
  const sacode = s > 0.5 && s < 2.5 ? 0.12 * Math.sin(2 * Math.PI * 1.6 * (s - 0.5)) : 0;
  return so(
    { 1: misturar(caido(1), normal([0.2, 0.3 + sacode, 1]), k) },
    {
      y: s >= 0.3 && s < 0.6 ? 0.04 * Math.sin(Math.PI * entre(s, 0.3, 0.6)) : 0,
      cabeca: [0, -0.1 * k, 0.12 * k],
    },
  );
}

/**
 * Tô de olho (~3,5 s): aponta para os próprios olhos (0,15–0,5) olhando de
 * lado, desconfiado; depois aponta para quem recebe (1,4–1,7) com o corpo um
 * pouco para a frente; volta (3,1–3,5).
 */
function poseDoOlho(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const cabecaY = m.pernaH + m.troncoH + 0.03 + m.cabeca / 2;
  const olhoY = cabecaY - 0.01 + m.cabeca * 0.9 * (24 / 256);
  const nosOlhos = apontar(m, 1, [0.08, olhoY, p.rostoZ + 0.12]);
  const k1 = suave(entre(s, 0.15, 0.5));
  const k2 = suave(entre(s, 1.4, 1.7));
  const volta = suave(entre(s, 3.1, 3.5));
  const braco = misturar(
    misturar(misturar(caido(1), nosOlhos, k1), normal([0.05, 0.22, 1]), k2),
    caido(1),
    volta,
  );
  const aponta = k2 * (1 - volta);
  return so(
    { 1: braco },
    {
      inclina: 0.07 * aponta,
      cabeca: [0.06 * aponta, 0.28 * k1 * (1 - k2) * Math.sin(2 * Math.PI * 0.9 * s), 0],
    },
  );
}

/**
 * Rindo muito (~3,3 s): as duas mãos na barriga (0,15–0,45), a cabeça
 * jogada para trás e o corpo sacudindo de rir; no meio se dobra para a frente
 * (1,6–2,0) de tanto rir; solta (2,9–3,3).
 */
function poseDoRiso(s: number, m: Medidas): PoseDeReacao {
  const frente = m.troncoD / 2 + m.bracoW * 0.75;
  const barriga: V3 = [0, m.pernaH + m.troncoH * 0.35, frente];
  const k = janela(s, 0.15, 0.3, 3.3, 0.4);
  const dobra = suave(entre(s, 1.6, 2.0));
  const sacode = Math.sin(2 * Math.PI * 3.5 * s);
  return so(
    {
      1: misturar(caido(1), apontar(m, 1, barriga), k),
      [-1]: misturar(caido(-1), apontar(m, -1, barriga), k),
    },
    {
      y: 0.015 * k * Math.abs(sacode),
      inclina: k * (-0.08 + 0.26 * dobra + 0.035 * sacode),
      cabeca: [k * (-0.22 + 0.32 * dobra + 0.06 * sacode), 0, 0],
    },
  );
}

/**
 * Bora! (~3,1 s): pulinho e os dois braços abertos para cima, como quem
 * mostra o muque (0,15–0,4), bombando no ritmo; solta (2,7–3,1).
 */
function poseDoBora(s: number): PoseDeReacao {
  const k = janela(s, 0.15, 0.25, 3.1, 0.4);
  const bomba = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * (s - 0.4));
  const braco = (l: Lado) => misturar(caido(l), normal([l, 0.35 + 0.4 * bomba, 0.18]), k);
  const pulo = s >= 0.1 && s < 0.45 ? Math.sin(Math.PI * entre(s, 0.1, 0.45)) : 0;
  return so(
    { 1: braco(1), [-1]: braco(-1) },
    { y: 0.07 * pulo, alto: 1 + 0.03 * pulo, inclina: -0.04 * k, cabeca: [-0.08 * k, 0, 0] },
  );
}

/**
 * Sono (~3,7 s): boceja com a mão na boca e a cabeça para trás (0,2–1,3),
 * se espreguiça com os braços lá em cima (1,4–2,1) e "apaga": braços caídos,
 * cabeça tombada de lado e o corpo balançando devagar (2,2 em diante).
 */
function poseDoSono(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const naBoca = apontar(m, 1, [0.05, p.bocaY, p.rostoZ + 0.1]);
  const boceja = janela(s, 0.2, 0.35, 1.45, 0.25);
  const espreguica = janela(s, 1.35, 0.35, 2.25, 0.3);
  const apaga = suave(entre(s, 2.1, 2.6));
  const braco = (l: Lado) =>
    misturar(
      l === 1 ? misturar(caido(1), naBoca, boceja) : caido(-1),
      normal([l * 0.25, 1, 0]),
      espreguica,
    );
  return so(
    { 1: braco(1), [-1]: braco(-1) },
    {
      alto: 1 + 0.04 * espreguica,
      inclina: 0.05 * apaga * Math.sin(2 * Math.PI * 0.4 * (s - 2.2)),
      cabeca: [-0.22 * boceja + 0.18 * apaga, 0, 0.38 * apaga],
    },
  );
}

/**
 * Pausa pro café (~3,6 s): a xícara (a cena põe o ☕ na mão) vem para a
 * frente do peito (0,1–0,4), dá um gole (1,3–2,4) e chama com a cabeça,
 * balançando de lado: "vem!" (2,4 em diante).
 */
function poseDoCafe(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const frente = m.troncoD / 2 + m.bracoW * 0.75;
  const segura = apontar(m, 1, [0.16, p.ombroY - m.troncoH * 0.3, frente + 0.2]);
  const gole = apontar(m, 1, [0.06, p.bocaY - 0.02, p.rostoZ + 0.1]);
  const k = janela(s, 0.1, 0.3, 3.6, 0.4);
  const g = janela(s, 1.3, 0.3, 2.4, 0.3);
  const chama = s > 2.4 ? suave(entre(s, 2.4, 2.6)) * Math.sin(2 * Math.PI * 1.3 * (s - 2.4)) : 0;
  return so(
    { 1: misturar(misturar(caido(1), segura, k), gole, g) },
    { cabeca: [-0.12 * g, 0, 0.14 * chama * k], balanco: 0.02 * chama * k },
  );
}

/**
 * O abraço de time (parado, para a foto do mural): os dois braços abertos
 * para os lados e um pouco para trás e para cima — com os bonecos lado a lado,
 * cada braço cai por cima do ombro do vizinho. Cabeça levemente inclinada.
 */
function poseDoGrupo(): PoseDeReacao {
  return so(
    { 1: normal([1, 0.2, -0.45]), [-1]: normal([-1, 0.2, -0.45]) },
    { cabeca: [-0.04, 0, 0.06] },
  );
}

/**
 * Você é top! (~3,5 s): ergue o troféu (na mão direita) com os dois braços
 * (0,15–0,5) quicando de alegria; depois a mão esquerda aponta para quem
 * recebe (1,8–2,1) — o troféu é dele; solta (3,1–3,5).
 */
function poseDoTrofeu(s: number): PoseDeReacao {
  const k = janela(s, 0.15, 0.35, 3.5, 0.4);
  const aponta = janela(s, 1.8, 0.3, 3.5, 0.4);
  const quica = s > 0.5 && s < 1.9 ? Math.abs(Math.sin(2 * Math.PI * 1.6 * (s - 0.5))) : 0;
  const cima = (l: Lado) => misturar(caido(l), normal([l * 0.22, 1, 0.08]), k);
  return so(
    { 1: misturar(cima(1), normal([0.1, 0.2, 1]), aponta), [-1]: cima(-1) },
    { y: 0.04 * quica * k, cabeca: [-0.1 * k * (1 - aponta), 0, 0] },
  );
}

/** Os braços para cima, abertos em "V" — o "êêê!" de quem concluiu. */
const BRACO_PARA_CIMA: Record<Lado, V3> = {
  1: normal([0.62, 1, 0.18]),
  [-1]: normal([-0.62, 1, 0.18]),
};
/** No meio do balanço os braços abrem um pouco mais. */
const BRACO_ABERTO: Record<Lado, V3> = {
  1: normal([0.9, 0.75, 0.25]),
  [-1]: normal([-0.9, 0.75, 0.25]),
};

/**
 * Comemorar (repete a cada 0,9 s): sobe os braços (0–0,2 s, só na primeira
 * vez) e pula — os braços sacodem no ritmo, o corpo amassa ao pousar e a
 * cabeça vai para trás no alto do pulo. Em 0,25 s (e a cada 0,9 s) é o alto:
 * a pose da foto.
 */
function poseDaComemoracao(s: number): PoseDeReacao {
  const sobe = suave(entre(s, 0, 0.2));
  const f = ((((s - 0.25 + 0.225) % 0.9) + 0.9) % 0.9) / 0.9; // 0,25 → f = 0,25 (o alto)
  const pulo = Math.max(0, Math.sin(Math.PI * 2 * f));
  const pouso = f > 0.5 ? Math.sin(Math.PI * (f - 0.5) * 2) : 0;
  const abre = 0.5 - 0.5 * Math.cos(Math.PI * 2 * f);
  // Na cena do chat a comemoração acaba em ~3,4 s: os braços descem no fim.
  const desce = suave(entre(s, 3.0, 3.4));
  const braco = (l: Lado) =>
    misturar(
      misturar(caido(l), misturar(BRACO_PARA_CIMA[l], BRACO_ABERTO[l], abre * 0.6), sobe),
      caido(l),
      desce,
    );
  return {
    y: 0.09 * pulo * sobe * (1 - desce),
    alto: 1 - 0.05 * pouso * sobe * (1 - desce),
    largo: 1 + 0.03 * pouso * sobe,
    inclina: -0.04 * pulo,
    balanco: 0,
    cabeca: [-0.18 * pulo * sobe * (1 - desce), 0, 0],
    bracos: { 1: braco(1), [-1]: braco(-1) },
  };
}

/**
 * Beijo (~3,2 s): leva a mão à boca (0,45–0,95), segura com a cabeça de lado
 * (até 1,55), atira o beijo para a frente — o braço estica na direção de quem
 * olha (1,55–1,8) — fica assim um pouco e volta (2,7–3,2).
 */
function poseDoBeijo(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const l: Lado = 1;
  const naBoca = apontar(m, l, [0, p.bocaY - 0.03, p.rostoZ + m.bracoW]);
  const atirado = BEIJO_ATIRADO;

  let braco = caido(l);
  let inclina = 0;
  let cabecaZ = 0;
  let y = 0;
  if (s >= 0.45 && s < 1.55) {
    braco = misturar(caido(l), naBoca, suave(entre(s, 0.45, 0.95)));
    cabecaZ = -0.16 * suave(entre(s, 0.75, 1.15));
  } else if (s >= 1.55 && s < 2.7) {
    const k = saida(entre(s, 1.55, 1.8));
    braco = misturar(naBoca, atirado, k);
    cabecaZ = -0.16 * (1 - k);
    inclina = 0.1 * k * (1 - suave(entre(s, 2.1, 2.7)));
    y = 0.05 * Math.sin(Math.PI * Math.min(1, Math.max(0, entre(s, 1.55, 1.95))));
  } else if (s >= 2.7 && s < 3.2) {
    braco = misturar(atirado, caido(l), suave(entre(s, 2.7, 3.2)));
  }
  return {
    y,
    alto: 1,
    largo: 1,
    inclina,
    balanco: 0,
    cabeca: [0, 0, cabecaZ],
    bracos: { [l]: braco },
  };
}

/**
 * Bravo (~3,4 s): cruza os braços de uma vez (0,25–0,6) com um pisão (o corpo
 * amassa e volta), vira a cara de lado com o queixo para cima e bate o pé —
 * o corpo sobe e desce no ritmo (0,7–3,0) — até soltar os braços (3,0–3,4).
 *
 * Braço sem cotovelo não dobra: "cruzado" é cada braço apontando para o peito
 * do outro lado, por fora do tronco, o esquerdo um pouco acima do direito —
 * de frente, um X sobre o peito.
 */
function poseDoBravo(s: number, m: Medidas): PoseDeReacao {
  const p = pontos(m);
  const frente = m.troncoD / 2 + m.bracoW * 0.75;
  const cruzado: Record<Lado, V3> = {
    1: apontar(m, 1, [-m.troncoW * 0.32, p.ombroY - m.troncoH * 0.3, frente + 0.03]),
    [-1]: apontar(m, -1, [m.troncoW * 0.32, p.ombroY - m.troncoH * 0.4, frente]),
  };
  let k = 0;
  if (s >= 0.25 && s < 3.0) k = suave(entre(s, 0.25, 0.6));
  else if (s >= 3.0) k = 1 - suave(entre(s, 3.0, 3.4));

  // O pisão: amassa ao cruzar e volta.
  let alto = 1;
  if (s >= 0.55 && s < 0.8) alto = 1 - 0.06 * Math.sin(Math.PI * entre(s, 0.55, 0.8));
  // Batendo o pé: 2,5 batidas por segundo, sobe 1,5 cm e balança um pouco.
  const bate =
    s >= 0.8 && s < 3.0 ? suave(entre(s, 0.8, 1.0)) * (1 - suave(entre(s, 2.8, 3.0))) : 0;
  const fase = 2 * Math.PI * 2.5 * (s - 0.8);
  const y = bate * 0.015 * Math.abs(Math.sin(fase / 2));
  const balanco = bate * 0.025 * Math.sin(fase / 2);

  // A cara virada ("hunf"): queixo para cima, olhando para o lado.
  const vira = suave(entre(s, 0.5, 0.85)) * (1 - suave(entre(s, 2.9, 3.3)));
  return {
    y,
    alto,
    largo: 1 + (1 - alto) * 0.5,
    inclina: -0.05 * vira,
    balanco,
    cabeca: [-0.14 * vira, -0.38 * vira, 0.04 * vira],
    bracos: {
      1: misturar(caido(1), cruzado[1], k),
      [-1]: misturar(caido(-1), cruzado[-1], k),
    },
  };
}
