/*
 * Onde cada pessoa senta: ferradura em volta da mesa oval, aberta para o telão.
 *
 * Por que ferradura: em reunião todo mundo olha o telão. Com a cabeceira do
 * telão vazia, ninguém fica de costas para a tela e, da minha câmera (lugar 0,
 * na ponta de baixo), vejo os rostos dos outros em vez de nucas.
 */
import type { AvatarConfig } from "@/lib/avatar-3d";
import { alturaAcimaDaCabeca } from "@/components/rv/cabeca-3d";
import { MEDIDAS } from "@/components/rv/medidas";
import {
  AFASTAMENTO_DA_CADEIRA,
  ANGULOS_DOS_LUGARES_GRAUS,
  MAX_CADEIRAS,
  MESA_CENTRO_Z,
  MESA_RX,
  MESA_RZ,
  MIN_CADEIRAS,
} from "./medidas-da-sala";

export type Lugar = {
  /** Centro da cadeira no chão. */
  x: number;
  z: number;
  /** Giro em Y: o avatar (de frente para +z) fica de frente para a mesa. */
  rotY: number;
  /** Normal da borda (para fora da mesa), no plano XZ. */
  nx: number;
  nz: number;
  /** Ângulo do lugar na elipse, em graus (0 = perto de mim; ±180 = telão). */
  graus: number;
};

/**
 * Ordem de ocupação dos OUTROS (o 0 sou eu): primeiro o outro lado da mesa
 * (±112°, de frente e perto do centro do quadro), depois as laterais e o fundo,
 * de onde se vê o rosto; por último os vizinhos de lado (±28°), que eu veria
 * de perfil, colados na câmera. A lista da especificação tinha 11 ângulos para
 * 10 cadeiras: o −28° (11º) ficou de fora para manter ±140° em par.
 */
export const ORDEM_DE_OCUPACAO = ANGULOS_DOS_LUGARES_GRAUS.slice(1);

/**
 * Lugar `i` (0 = eu). P na elipse; a cadeira sai pela normal da elipse — não
 * pelo raio — para ficar perpendicular à borda mesmo nas pontas achatadas.
 */
export function lugar(i: number): Lugar {
  const graus = ANGULOS_DOS_LUGARES_GRAUS[Math.max(0, Math.min(MAX_CADEIRAS - 1, i))];
  const t = (graus * Math.PI) / 180;
  const px = MESA_RX * Math.sin(t);
  const pz = MESA_CENTRO_Z + MESA_RZ * Math.cos(t);
  // Gradiente da elipse: (x/RX², z/RZ²) ∝ (sinθ/RX, cosθ/RZ).
  let nx = Math.sin(t) / MESA_RX;
  let nz = Math.cos(t) / MESA_RZ;
  const len = Math.hypot(nx, nz) || 1;
  nx /= len;
  nz /= len;
  return {
    x: px + nx * AFASTAMENTO_DA_CADEIRA,
    z: pz + nz * AFASTAMENTO_DA_CADEIRA,
    rotY: Math.atan2(-nx, -nz),
    nx,
    nz,
    graus,
  };
}

/**
 * Quantas cadeiras aparecem com `n` pessoas: sempre sobram duas livres (quem
 * chega tem onde sentar) e o total é ímpar — o lugar 0 mais pares simétricos —
 * entre 7 e 10 (com 10, o último par fica incompleto: não cabe mais na mesa).
 */
export function quantasCadeiras(n: number): number {
  let k = Math.max(MIN_CADEIRAS, n + 2);
  if (k % 2 === 0) k += 1;
  return Math.min(MAX_CADEIRAS, k);
}

/** Os índices dos lugares visíveis com `n` pessoas (0 e os primeiros da ordem). */
export function cadeirasVisiveis(n: number): number[] {
  return Array.from({ length: quantasCadeiras(n) }, (_, i) => i);
}

/**
 * Altura do topo (cabelo/chapéu) do avatar sentado, ANTES da medição por Box3.
 * Espelha as fórmulas do Avatar3D de 10/10 (quadril sentado a 0,52, cabeça
 * apoiada no tronco); a medição real em `avatar-na-cadeira.tsx` sempre vence —
 * isto só evita o balão "pular" no primeiro quadro.
 */
export function topoDaCabecaReserva(config: AvatarConfig): number {
  const m = MEDIDAS[config.corpo] ?? MEDIDAS.classico;
  return 0.52 + m.troncoH + 0.03 + m.cabeca + alturaAcimaDaCabeca(config, m.cabeca) + 0.04;
}

/**
 * Atribuição estável de lugares: quem já está sentado não troca de cadeira
 * quando alguém entra ou sai (trocar faria o avatar "teleportar"). Eu fico
 * sempre no 0. Só quem ficou além das cadeiras visíveis é puxado para o
 * primeiro lugar livre — assim as cadeiras continuam em pares simétricos.
 */
export function distribuirLugares(
  ids: { id: string; eu: boolean }[],
  anterior: ReadonlyMap<string, number>,
): Map<string, number> {
  const k = quantasCadeiras(ids.length);
  const novo = new Map<string, number>();
  const ocupados = new Set<number>();
  const eu = ids.find((p) => p.eu);
  if (eu) {
    novo.set(eu.id, 0);
    ocupados.add(0);
  }
  const outros = ids.filter((p) => !p.eu).slice(0, MAX_CADEIRAS - (eu ? 1 : 0));
  // 1º passo: quem tinha lugar válido continua nele.
  for (const p of outros) {
    const l = anterior.get(p.id);
    if (l !== undefined && l > 0 && l < k && !ocupados.has(l)) {
      novo.set(p.id, l);
      ocupados.add(l);
    }
  }
  // 2º passo: o resto pega o primeiro livre, na ordem de ocupação.
  for (const p of outros) {
    if (novo.has(p.id)) continue;
    for (let l = eu ? 1 : 0; l < MAX_CADEIRAS; l++) {
      if (!ocupados.has(l)) {
        novo.set(p.id, l);
        ocupados.add(l);
        break;
      }
    }
  }
  return novo;
}
