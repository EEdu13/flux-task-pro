/*
 * Projetor: liga o 3D à camada 2D (crachás, selos, balões) SEM React por quadro.
 *
 * Roda dentro do Canvas, num único useFrame de prioridade 0 — depois do
 * OrbitControls (−1) — e, no mesmo quadro: projeta as âncoras e o retângulo
 * do telão, decide o layout dos balões e escreve transform/display/zIndex
 * direto nos elementos registrados. Os tamanhos vêm de um ResizeObserver
 * (cache); nada de getBoundingClientRect nem setState por quadro.
 *
 * Por que não o <Html> do drei: um <Html> por pessoa recalcula e reescreve o
 * DOM sozinho, sem saber dos outros — não dá para impedir balões de se
 * atropelarem nem de cobrirem o telão.
 */
import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { DURACAO_BALAO_MS, MAX_BALOES_NA_TELA } from "./tipos";
import type { ModoDoBalao } from "./balao-de-card";
import type { Lugar } from "./lugares";
import { meuAvatarEscondido } from "./enquadramento";
import {
  ANCORA_PARA_O_CENTRO,
  MARGEM_DO_TELAO_PX,
  MAX_COLISAO_PX,
  MAX_EMPURRAO_DO_CRACHA_PX,
  MAX_FORA_DO_TELAO_PX,
  PASSO_COLISAO_PX,
  TELAO_BASE_Y,
  TELAO_CENTRO,
  TELAO_TELA,
  VAO_DO_BALAO,
} from "./medidas-da-sala";

/* ───────── Registro de elementos e tamanhos ───────── */

type Tamanho = { w: number; h: number };

/**
 * Elementos da camada 2D por chave (`grp:id`, `cab:id`, `bal:id`,
 * `var:id:modo`) e o tamanho de cada um. Os refs são estáveis por chave —
 * ref novo a cada render faria o React soltar/prender (e o ResizeObserver
 * medir) tudo de novo a cada render.
 */
export class RegistroDaCamada {
  readonly elementos = new Map<string, HTMLElement>();
  readonly tamanhos = new Map<string, Tamanho>();
  private readonly chaveDe = new WeakMap<Element, string>();
  private readonly refs = new Map<string, (el: HTMLElement | null) => void>();
  private ro: ResizeObserver | null = null;
  /** Último valor escrito por chave+propriedade (evita reescrever o DOM igual). */
  readonly escrito = new Map<string, string>();

  private observador(): ResizeObserver | null {
    if (this.ro || typeof ResizeObserver === "undefined") return this.ro;
    this.ro = new ResizeObserver((entradas) => {
      for (const e of entradas) {
        const k = this.chaveDe.get(e.target);
        if (!k) continue;
        const b = e.borderBoxSize?.[0];
        this.tamanhos.set(
          k,
          b
            ? { w: b.inlineSize, h: b.blockSize }
            : { w: e.contentRect.width, h: e.contentRect.height },
        );
      }
    });
    return this.ro;
  }

  ref(chave: string): (el: HTMLElement | null) => void {
    let r = this.refs.get(chave);
    if (r) return r;
    r = (el) => {
      const antigo = this.elementos.get(chave);
      if (antigo && antigo !== el) {
        this.ro?.unobserve(antigo);
        this.elementos.delete(chave);
        this.tamanhos.delete(chave);
        for (const k of [...this.escrito.keys()])
          if (k.startsWith(chave + "|")) this.escrito.delete(k);
      }
      if (!el) return;
      this.elementos.set(chave, el);
      this.chaveDe.set(el, chave);
      // Primeira medida já no registro: o ResizeObserver só responde no próximo quadro.
      this.tamanhos.set(chave, { w: el.offsetWidth, h: el.offsetHeight });
      this.observador()?.observe(el);
    };
    this.refs.set(chave, r);
    return r;
  }

  tamanho(chave: string): Tamanho {
    return this.tamanhos.get(chave) ?? { w: 0, h: 0 };
  }

  /** Escreve só se mudou (o DOM é o gargalo, não a conta). */
  escrever(
    chave: string,
    prop: "transform" | "display" | "zIndex" | "modo" | "dx" | "incl" | "fora",
    valor: string,
  ) {
    const el = this.elementos.get(chave);
    if (!el) return;
    const k = chave + "|" + prop;
    if (this.escrito.get(k) === valor) return;
    this.escrito.set(k, valor);
    if (prop === "modo") el.dataset.modo = valor;
    else if (prop === "fora") {
      if (valor) el.dataset.fora = valor;
      else delete el.dataset.fora;
    } else if (prop === "dx") el.style.setProperty("--rv-dx", valor);
    else if (prop === "incl") el.style.setProperty("--rv-incl", valor);
    else el.style[prop] = valor;
  }

  desligar() {
    this.ro?.disconnect();
    this.ro = null;
  }
}

/* ───────── Layout (puro: testável sem DOM) ───────── */

export type Retangulo = { x: number; y: number; w: number; h: number };

export const cruza = (a: Retangulo, b: Retangulo, folga = 0) =>
  a.x < b.x + b.w + folga &&
  a.x + a.w + folga > b.x &&
  a.y < b.y + b.h + folga &&
  a.y + a.h + folga > b.y;

export type EntradaDoLayout = {
  id: string;
  ax: number;
  ay: number;
  /** Distância até a câmera (zIndex: o mais perto na frente). */
  profundidade: number;
  /** +1 lugar à direita do eixo da mesa, −1 à esquerda: o lado "de fora". */
  lado: number;
  cabeca: Tamanho;
  /** null = sem balão (eu, ou sem card que mereça balão). */
  balao: { chegou: number; tamanhos: Record<ModoDoBalao, Tamanho> } | null;
};

export type SaidaDoLayout = {
  id: string;
  empurraoDoCracha: number;
  cabeca: Retangulo;
  balao: { modo: ModoDoBalao; dx: number; rect: Retangulo; aoLado: boolean } | null;
  rect: Retangulo;
};

/**
 * Regras (especificação §2.8):
 * 1. Com vídeo no telão todos os balões são compactos; sem vídeo, os
 *    MAX_BALOES_NA_TELA mais novos ficam completos e o resto compacto.
 * 2. Balão que cruza o telão anda para FORA (lado do lugar) em passos até
 *    180 px; não cabendo, vira compacto; depois chip.
 * 3. Colisão com grupos já postos (ordem: de baixo para cima na tela, que é
 *    de perto para longe): anda para fora até 60 px; senão compacto/chip.
 * 4. Balão cortado pela borda da tela não vale: tenta andar para dentro.
 * 5. Último recurso: o chip vai AO LADO do crachá (nunca para cima).
 * 6. Balão também desvia dos `obstaculos`: as sobreposições 2D da tela (fila
 *    de mãos, selo da IA, "Seus cards"…), que são opacas e o cobririam.
 * Os crachás são postos ANTES de todos os balões: balão nenhum cobre um nome.
 */
export function calcularLayout(
  entradas: EntradaDoLayout[],
  telao: Retangulo | null,
  comVideo: boolean,
  /** Largura da tela: balão cortado na borda não serve (pode andar para DENTRO). */
  largura = Infinity,
  /** Retângulos (px do canvas) que balão nenhum pode cobrir. */
  obstaculos: Retangulo[] = [],
): SaidaDoLayout[] {
  const completos = new Set(
    entradas
      .filter((e) => e.balao)
      .sort((a, b) => b.balao!.chegou - a.balao!.chegou)
      .slice(0, comVideo ? 0 : MAX_BALOES_NA_TELA)
      .map((e) => e.id),
  );
  const ordem = [...entradas].sort((a, b) => b.ay - a.ay);
  const postos: Retangulo[] = [];

  // 1º passo: os crachás (presos à cabeça). Encostou em outro já posto → empurra para fora.
  const cabecas = new Map<string, { r: Retangulo; empurrao: number }>();
  for (const e of ordem) {
    const cab = (empurrao: number): Retangulo => ({
      x: e.ax - e.cabeca.w / 2 + empurrao,
      y: e.ay - e.cabeca.h,
      w: e.cabeca.w,
      h: e.cabeca.h,
    });
    let empurrao = 0;
    if (e.cabeca.w > 0) {
      // Para fora primeiro; mas empurrão que joga o crachá para fora da TELA não vale (crachá
      // preso na borda, de quem está fora do quadro): aí ele anda para dentro.
      const naTela = (r: Retangulo) => r.x >= 0 && r.x + r.w <= largura;
      // Sem lugar livre: fica no último empurrão PARA FORA que ainda coube na tela.
      let reserva: number | null = null;
      achou: for (const sentido of [e.lado || 1, -(e.lado || 1)]) {
        for (let d = sentido === (e.lado || 1) ? 0 : 4; d <= MAX_EMPURRAO_DO_CRACHA_PX; d += 4) {
          const tentativa = d * sentido;
          if (d > 0 && !naTela(cab(tentativa))) break;
          if (!postos.some((p) => cruza(cab(tentativa), p, 2))) {
            empurrao = tentativa;
            reserva = null;
            break achou;
          }
          if (sentido === (e.lado || 1)) reserva = tentativa;
        }
        empurrao = reserva ?? 0;
      }
      postos.push(cab(empurrao));
    }
    cabecas.set(e.id, { r: cab(empurrao), empurrao });
  }

  // 2º passo: os balões, desviando de TODOS os crachás e dos balões já postos.
  const saida: SaidaDoLayout[] = [];
  for (const e of ordem) {
    const { r: rCab, empurrao } = cabecas.get(e.id)!;
    let balao: SaidaDoLayout["balao"] = null;
    if (e.balao) {
      const base = e.ay - e.cabeca.h - VAO_DO_BALAO;
      const ret = (modo: ModoDoBalao, dx: number): Retangulo => {
        const t = e.balao!.tamanhos[modo];
        return { x: e.ax + dx - t.w / 2, y: base - t.h, w: t.w, h: t.h };
      };
      const noTelao = (r: Retangulo) => (telao ? cruza(r, telao, MARGEM_DO_TELAO_PX) : false);
      const emOutro = (r: Retangulo) =>
        postos.some((p) => cruza(r, p, 2)) || obstaculos.some((o) => cruza(r, o, 4));
      const naTela = (r: Retangulo) => r.x >= 4 && r.x + r.w <= largura - 4;
      const modos: ModoDoBalao[] = completos.has(e.id)
        ? ["completo", "compacto", "chip"]
        : ["compacto", "chip"];
      fora: for (const modo of modos) {
        if (e.balao.tamanhos[modo].w <= 0) continue;
        const inicial = ret(modo, empurrao);
        // Telão e sobreposições são grandes: andar só 60 px não basta para sair de baixo deles.
        const max =
          noTelao(inicial) || obstaculos.some((o) => cruza(inicial, o, 4))
            ? MAX_FORA_DO_TELAO_PX
            : MAX_COLISAO_PX;
        // Primeiro para fora; na borda da tela, para dentro (o mesmo alcance).
        for (const sentido of [1, -1]) {
          for (let d = sentido > 0 ? 0 : PASSO_COLISAO_PX; d <= max; d += PASSO_COLISAO_PX) {
            const dx = d * sentido * (e.lado || 1) + empurrao;
            const r = ret(modo, dx);
            if (!noTelao(r) && !emOutro(r) && naTela(r)) {
              balao = { modo, dx, rect: r, aoLado: false };
              break fora;
            }
          }
        }
      }
      if (!balao) {
        // Ao lado do crachá, na mesma linha: abaixo do topo da cabeça, nunca no telão.
        const t = e.balao.tamanhos.chip;
        const dx = (e.cabeca.w / 2 + 4 + t.w / 2) * (e.lado || 1) + empurrao;
        const r: Retangulo = { x: e.ax + dx - t.w / 2, y: e.ay - t.h, w: t.w, h: t.h };
        balao = { modo: "chip", dx, rect: r, aoLado: true };
      }
      postos.push(balao.rect);
    }
    const rects = [rCab, ...(balao ? [balao.rect] : [])].filter((r) => r.w > 0);
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    const y1 = Math.max(...rects.map((r) => r.y + r.h));
    saida.push({
      id: e.id,
      empurraoDoCracha: empurrao,
      cabeca: rCab,
      balao,
      rect: rects.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : rCab,
    });
  }
  return saida;
}

/* ───────── O componente (dentro do Canvas) ───────── */

export type ItemDoProjetor = {
  id: string;
  eu: boolean;
  lugar: Lugar;
  /** "Gás" da cadeira (m): entra na conta de quando o MEU boneco some. */
  elevacao: number;
  /** Altura da âncora no mundo (topo medido + elevação da cadeira). */
  topo: number;
  /** Chegada do card que vira balão (null = sem balão). */
  balaoChegou: number | null;
};

type DebugDaSala = {
  telaoRect: Retangulo | null;
  obstaculos: Retangulo[];
  grupos: {
    id: string;
    rect: Retangulo;
    modo: ModoDoBalao | null;
    balao: Retangulo | null;
    cabeca: Retangulo;
    fora: string;
  }[];
};

const MODOS: ModoDoBalao[] = ["completo", "compacto", "chip"];
const v = new Vector3();
const cantos = [
  new Vector3(-TELAO_TELA.w / 2, TELAO_BASE_Y, TELAO_CENTRO[2] + 0.04),
  new Vector3(TELAO_TELA.w / 2, TELAO_BASE_Y, TELAO_CENTRO[2] + 0.04),
  new Vector3(-TELAO_TELA.w / 2, TELAO_BASE_Y + TELAO_TELA.h, TELAO_CENTRO[2] + 0.04),
  new Vector3(TELAO_TELA.w / 2, TELAO_BASE_Y + TELAO_TELA.h, TELAO_CENTRO[2] + 0.04),
];

/** Margem (px) do crachá até a borda quando a pessoa está fora do quadro. */
const MARGEM_DA_BORDA = 14; // folga para o pulso do ✋ (a animação passa da caixa medida)
/** Fora do quadro por mais que isto (px), o crachá ganha a seta "está ali". */
const FORA_DO_QUADRO_PX = 18;
/** A cada quanto (ms) relê as sobreposições 2D (mudam pouco; ler o DOM custa). */
const RELER_OBSTACULOS_MS = 250;

/**
 * As sobreposições 2D marcadas com `data-rv-obstaculo` dentro do mesmo palco
 * (`data-rv-palco`), em px relativos ao canvas. Elementos sem tamanho (fila
 * vazia, selo escondido) não contam.
 */
function lerObstaculos(canvas: HTMLElement): Retangulo[] {
  const palco = canvas.closest("[data-rv-palco]");
  if (!palco) return [];
  const base = canvas.getBoundingClientRect();
  const lista: Retangulo[] = [];
  palco.querySelectorAll<HTMLElement>("[data-rv-obstaculo]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    lista.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
  });
  return lista;
}

/** Só para os testes de render: dev + `?__sala` na URL. */
export const debugLigado = () =>
  import.meta.env.DEV && typeof location !== "undefined" && /[?&]__sala\b/.test(location.search);

export function Projetor({
  itens,
  registro,
  comVideo,
}: {
  itens: ItemDoProjetor[];
  registro: RegistroDaCamada;
  comVideo: boolean;
}) {
  const { size, gl } = useThree();
  const obstaculos = useRef<{ t: number; lista: Retangulo[] }>({ t: -Infinity, lista: [] });
  // O useFrame lê sempre a lista mais nova sem re-registrar o callback.
  const estado = useRef({ itens, comVideo });
  useLayoutEffect(() => {
    estado.current = { itens, comVideo };
  });
  const debug = useRef(debugLigado());

  useFrame(({ camera }) => {
    const { itens: lista, comVideo: video } = estado.current;
    const W = size.width;
    const H = size.height;
    const agora = Date.now();
    if (agora - obstaculos.current.t >= RELER_OBSTACULOS_MS) {
      obstaculos.current = { t: agora, lista: lerObstaculos(gl.domElement) };
    }

    // Retângulo do telão na tela (caixa dos 4 cantos da TELA; null se atrás da câmera).
    let telao: Retangulo | null = null;
    {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let atras = false;
      for (const c of cantos) {
        v.copy(c).project(camera);
        if (v.z > 1) atras = true;
        const x = ((v.x + 1) / 2) * W;
        const y = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      if (!atras) telao = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    const entradas: EntradaDoLayout[] = [];
    const visiveis = new Set<string>();
    const fora = new Map<string, string>();
    for (const it of lista) {
      const l = it.lugar;
      // O meu boneco sumiu (câmera na minha nuca): os selos dele somem junto.
      if (it.eu && meuAvatarEscondido(camera.position, l, it.elevacao)) continue;
      v.set(l.x - l.nx * ANCORA_PARA_O_CENTRO, it.topo, l.z - l.nz * ANCORA_PARA_O_CENTRO);
      const prof = v.distanceTo(camera.position);
      v.project(camera);
      let ax = ((v.x + 1) / 2) * W;
      const ay = ((1 - v.y) / 2) * H;
      // Atrás da câmera ou acima/abaixo da tela: some.
      if (v.z > 1 || v.z < -1 || ay < -20 || ay > H + 80) continue;
      // Fora pelos LADOS: o crachá (com mudo/mão) fica preso na borda com uma
      // seta, para ninguém "sumir" da reunião só porque a câmera não o pega.
      const cabeca = registro.tamanho("cab:" + it.id);
      const meia = cabeca.w / 2 + MARGEM_DA_BORDA;
      let lado = "";
      if (ax < meia) {
        if (ax < meia - FORA_DO_QUADRO_PX) lado = "esq";
        ax = meia;
      } else if (ax > W - meia) {
        if (ax > W - meia + FORA_DO_QUADRO_PX) lado = "dir";
        ax = W - meia;
      }
      fora.set(it.id, lado);
      visiveis.add(it.id);
      const vivo = it.balaoChegou !== null && agora < it.balaoChegou + DURACAO_BALAO_MS;
      // Na borda o balão não tem para onde apontar: o "💬" do crachá avisa que há card.
      const temBalao = !it.eu && !lado && vivo && registro.elementos.has("bal:" + it.id);
      const tamanhos = Object.fromEntries(
        MODOS.map((m) => [m, registro.tamanho(`var:${it.id}:${m}`)]),
      ) as Record<ModoDoBalao, Tamanho>;
      entradas.push({
        id: it.id,
        ax,
        ay,
        profundidade: prof,
        lado: Math.sign(l.x) || 1,
        cabeca,
        balao: temBalao ? { chegou: it.balaoChegou!, tamanhos } : null,
      });
    }

    const layout = calcularLayout(entradas, telao, video, W, obstaculos.current.lista);
    const porId = new Map(entradas.map((e) => [e.id, e]));
    for (const s of layout) {
      const e = porId.get(s.id)!;
      const g = "grp:" + s.id;
      registro.escrever(g, "display", "block");
      registro.escrever(g, "fora", fora.get(s.id) ?? "");
      registro.escrever(
        g,
        "transform",
        `translate3d(${e.ax.toFixed(1)}px, ${e.ay.toFixed(1)}px, 0)`,
      );
      registro.escrever(g, "zIndex", String(Math.max(1, 1000 - Math.round(e.profundidade * 20))));
      registro.escrever(
        "cab:" + s.id,
        "transform",
        `translateX(calc(-50% + ${s.empurraoDoCracha.toFixed(0)}px))`,
      );
      const b = "bal:" + s.id;
      if (s.balao) {
        const t = e.balao!.tamanhos[s.balao.modo];
        const subida = s.balao.aoLado ? 0 : e.cabeca.h + VAO_DO_BALAO;
        registro.escrever(b, "display", "block");
        registro.escrever(b, "modo", s.balao.modo);
        registro.escrever(
          b,
          "transform",
          `translate(${(s.balao.dx - t.w / 2).toFixed(1)}px, ${(-subida).toFixed(1)}px)`,
        );
        const dxRabicho = s.balao.dx;
        registro.escrever(b, "dx", `${dxRabicho.toFixed(0)}px`);
        registro.escrever(
          b,
          "incl",
          `${Math.max(-50, Math.min(50, -dxRabicho * 0.6)).toFixed(0)}deg`,
        );
      } else {
        registro.escrever(b, "display", "none");
      }
    }
    for (const it of lista)
      if (!visiveis.has(it.id)) registro.escrever("grp:" + it.id, "display", "none");

    if (debug.current) {
      const d: DebugDaSala = {
        telaoRect: telao,
        obstaculos: obstaculos.current.lista,
        grupos: layout.map((s) => ({
          id: s.id,
          rect: s.rect,
          modo: s.balao?.modo ?? null,
          balao: s.balao?.rect ?? null,
          cabeca: s.cabeca,
          fora: fora.get(s.id) ?? "",
        })),
      };
      const w = window as unknown as { __sala?: DebugDaSala; __salaRegistro?: RegistroDaCamada };
      w.__sala = d;
      w.__salaRegistro = registro;
    }
  });

  return null;
}
