/*
 * Todas as medidas da sala de reunião 3D (metros, radianos, cores), num lugar só.
 *
 * Por que um arquivo só: a sala, as âncoras dos balões e os testes de render
 * conferem as MESMAS contas (altura do tampo, base do telão, limites da câmera).
 * Número mágico espalhado faz um desses três divergir sem ninguém perceber.
 */

/* ───────── Planta ───────── */

/** Paredes laterais em x = ±PAREDE_X. */
export const PAREDE_X = 5.2;
/** Parede do telão (fundo). */
export const PAREDE_FUNDO_Z = -4.6;
/** Parede de trás (com a porta), atrás de quem olha. */
export const PAREDE_FRENTE_Z = 5.0;
export const LARGURA_DA_SALA = PAREDE_X * 2; // 10,4
export const PROFUNDIDADE_DA_SALA = PAREDE_FRENTE_Z - PAREDE_FUNDO_Z; // 9,6
export const CENTRO_DA_SALA_Z = (PAREDE_FRENTE_Z + PAREDE_FUNDO_Z) / 2;
/**
 * Pé-direito. A especificação pedia 3,0, mas o telão especificado (centro 2,35,
 * moldura de 2,7) chega a 3,7 — atravessaria o forro. Mantive o telão (a camada
 * 2D usa a base da tela, 1,17) e subi o forro; a câmera continua presa em y ≤ 2,8.
 */
export const PE_DIREITO = 3.8;
export const ESPESSURA_DA_PAREDE = 0.1;
export const RODAPE_ALTURA = 0.1;
export const COR_RODAPE = "#5b4636";
export const COR_PAREDE = "#f2ece2";
export const COR_PISO = "#a47750";
export const COR_FORRO = "#f4efe7";

/* ───────── Mesa ───────── */

export const MESA_CENTRO_Z = 0.3;
export const MESA_RX = 2.44;
export const MESA_RZ = 1.64;
/** Topo do tampo. A mão do avatar sentado deve ficar 0–3 cm acima disto. */
export const ALTURA_TAMPO = 0.76;
export const ESPESSURA_TAMPO = 0.05;
export const ARO_DA_MESA = 0.02;
export const COR_MADEIRA = "#b8834f";
export const COR_ARO = "#6b4a32";
export const PEDESTAL = { largura: 0.25, profundidade: 0.9, x: 1.1 } as const;

/* ───────── Cadeira ───────── */

/** Distância da borda da mesa até o centro da cadeira, ao longo da normal. */
export const AFASTAMENTO_DA_CADEIRA = 0.4;
export const ASSENTO = { w: 0.5, h: 0.07, d: 0.48, y: 0.32, raio: 0.03 } as const;
export const ENCOSTO = { w: 0.48, h: 0.55, d: 0.06, y: 0.72, z: -0.34, giro: -0.1 } as const;
export const COLUNA = { raio: 0.035, altura: 0.3 } as const;
export const PE_DA_ESTRELA = { comprimento: 0.3, largura: 0.05, altura: 0.035 } as const;
export const RODIZIO_RAIO = 0.025;
export const COR_ESTOFADO = "#2f6b4f";
export const COR_ESTOFADO_VAZIO = "#6b7f74";
export const COR_BASE_CADEIRA = "#2b3440";
/**
 * "Cadeira a gás": a cadeira ocupada sobe ou desce (e o avatar junto) para a
 * mão do boneco pousar sobre o tampo. A pose sentada do Avatar3D é fixa (braço
 * a −1,2 rad no ombro), então cada tipo de corpo alcança uma altura diferente.
 */
export const FOLGA_DA_MAO = 0.015;
export const ELEVACAO_MINIMA = -0.05;
export const ELEVACAO_MAXIMA = 0.1;
/** O que fica debaixo da mesa (ponta do sapato) para isto abaixo do topo do tampo. */
export const FOLGA_DA_COXA = 0.005;

/* ───────── Lugares (ferradura voltada ao telão) ───────── */

/**
 * Graus. O lugar 0 é o de quem olha; os outros, na ordem em que são ocupados.
 * Os primeiros a chegar sentam a ±112° (do outro lado da mesa, de frente para
 * mim e perto do centro do quadro), não a ±84°: as laterais ficam na borda da
 * tela e, numa reunião de 2, o único outro participante sumia na borda.
 */
export const ANGULOS_DOS_LUGARES_GRAUS = [0, 112, -112, 84, -84, 140, -140, 56, -56, 28] as const;
export const MAX_CADEIRAS = 10;
export const MIN_CADEIRAS = 7;

/* ───────── Câmera ───────── */

export const CAMERA_POSICAO: [number, number, number] = [0, 2.5, 3.8];
export const CAMERA_ALVO: [number, number, number] = [0, 0.95, -1.1];
/** FOV vertical mínimo (palco largo). Em palco estreito ele abre — ver abaixo. */
export const CAMERA_FOV = 48;
/**
 * tan(FOV horizontal / 2) mínimo: 1,0 = 90° de campo horizontal, o bastante
 * para as cabeças (e crachás) dos lugares ±84° e ±56° caberem no quadro padrão.
 * Como o FOV do three é VERTICAL, num palco de proporção 1,4 (monitor 1920 com
 * painel aberto) 48° davam só ~64° na horizontal e as laterais saíam da tela.
 */
export const CAMERA_TAN_HORIZONTAL_MIN = 1.0;
/** Teto do FOV vertical: acima disto a perspectiva distorce demais (palco "retrato"). */
export const CAMERA_FOV_MAX = 76;
export const CAMERA_DIST_MIN = 3;
export const CAMERA_DIST_MAX = 5.2;
export const CAMERA_POLAR_MAX = 1.35;
export const CAMERA_AZIMUTE = 1.1;
/** alvo.y + isto = altura máxima da câmera pela órbita (minPolar dinâmico). */
export const CAMERA_FOLGA_DO_FORRO = 1.85;
export const CAMERA_Y_MAX = 2.8;
export const CAMERA_X_MAX = 4.9;
export const CAMERA_Z_MAX = 4.7;
/**
 * Mais perto que isto da minha cabeça, o meu avatar (e os selos dele) some.
 * 2,3 m cobre a câmera padrão (~1,9 m da minha nuca): de lá a minha nuca era
 * o maior objeto da cena, no meio da mesa, e o meu estado (mudo/mão) já está
 * na barra. Girando a câmera para o lado, eu reapareço sentado.
 */
export const CAMERA_PERTO_DA_CABECA = 2.3;
/** Altura da "cabeça" usada nessa conta, acima do quadril sentado (0,52). */
export const ALTURA_DA_NUCA = 0.52 + 0.75;

/* ───────── Telão ───────── */

export const TELAO_CENTRO: [number, number, number] = [0, 2.35, -4.55];
export const TELAO_MOLDURA = { w: 4.5, h: 2.7 } as const;
export const TELAO_TELA = { w: 4.2, h: 2.36 } as const;
export const TELAO_BRILHO = { w: 4.9, h: 3.1 } as const;
/** Base da tela no mundo (2,35 − 2,36/2). A camada 2D não deixa balão subir dela. */
export const TELAO_BASE_Y = TELAO_CENTRO[1] - TELAO_TELA.h / 2;
export const TELAO_ESPERA_PX = { w: 1024, h: 576 } as const;

/* ───────── Quadro da parede ───────── */

export const QUADRO_CENTRO: [number, number, number] = [3.75, 1.9, -4.57];
export const QUADRO = { w: 2.0, h: 1.5, moldura: 0.06 } as const;
export const QUADRO_PX = { w: 1024, h: 768 } as const;

/* ───────── Ambiente ───────── */

/**
 * Luminária pendente. A especificação pedia um disco de 2,6 m em y 2,7: da
 * câmera padrão (y 2,5) ele tapava o alto do telão. Virou um ANEL (não tapa)
 * a 3,25 m, acima da linha de visão câmera→topo do telão.
 */
export const LUMINARIA = { raio: 1.3, espessura: 0.05, tubo: 0.035, y: 3.25 } as const;
/** A luz quente da mesa continua em 2,6 m (a do anel é só aparência). */
export const LUZ_DA_MESA_Y = 2.6;
export const TAPETE = { rx: 3.05, rz: 2.05, borda: 0.08, y: 0.005 } as const;
export const RIPA = { largura: 0.06, passo: 0.12, profundidade: 0.03, cor: "#8a6142" } as const;
export const JANELA = { w: 1.6, h: 1.4, y: 1.6, zs: [-1.6, 1.9] as const } as const;
export const POSICOES_DAS_PLANTAS: [number, number][] = [
  [-4.6, -3.8],
  [4.6, -3.8],
  [-4.6, 4.2],
  [4.6, 4.2],
];
export const LOGO = { w: 1.2, h: 0.3, x: -3.75, y: 2.6 } as const;
export const APARADOR = { w: 3.0, h: 0.7, d: 0.45, z: -4.3, cor: "#6b4a32" } as const;

/* ───────── Sombra ───────── */

export const SOMBRA_HZ = 2;
export const SOMBRA_MAPA = 2048;

/* ───────── Camada 2D ───────── */

/** A âncora dos selos sobe do topo medido do avatar e anda isto para o centro da mesa. */
export const ANCORA_PARA_O_CENTRO = 0.1;
/** Espaço entre a linha da cabeça (crachá/selos) e o balão. */
export const VAO_DO_BALAO = 6;
export const MARGEM_DO_TELAO_PX = 8;
export const PASSO_FORA_DO_TELAO_PX = 16;
export const MAX_FORA_DO_TELAO_PX = 180;
export const PASSO_COLISAO_PX = 8;
export const MAX_COLISAO_PX = 60;
/** Crachás que se encostam andam no máximo isto para os lados. */
export const MAX_EMPURRAO_DO_CRACHA_PX = 40;
export const DURACAO_ENTRADA_MS = 300;
export const DURACAO_SAIDA_BALAO_MS = 400;
