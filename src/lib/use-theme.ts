import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

export const KEY = "fluxo.theme";
export const PALETTE_KEY = "fluxo.palette";

/**
 * Script que aplica tema e paleta ANTES da primeira pintura.
 *
 * Os hooks abaixo rodam em `useEffect`, ou seja, depois que a tela já foi
 * desenhada — o que produzia um lampejo da paleta padrão a cada carga, bem
 * visível no login, que é escuro e colorido. Este trecho vai inline no `<head>`
 * e roda de forma síncrona, então a primeira pintura já sai certa.
 */
export const SCRIPT_TEMA_INICIAL = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(PALETTE_KEY)});
if(p&&p!=="forest")document.documentElement.setAttribute("data-palette",p);
var t=localStorage.getItem(${JSON.stringify(KEY)});
if(t!=="light")document.documentElement.classList.add("dark");
}catch(e){}})()`;

export type Palette =
  | "forest"
  | "ocean"
  | "sunset"
  | "noir"
  | "nebula"
  | "magenta"
  | "ruby"
  | "lagoon";

export const paletteOptions: {
  id: Palette;
  name: string;
  description: string;
  swatch: string[];
}[] = [
  {
    id: "forest",
    name: "Forest Precision",
    description: "Verde profundo com creme quente. Padrão do Fluxo.",
    swatch: ["#f4efe4", "#2f4a34", "#c8e26a", "#1a2820"],
  },
  {
    id: "ocean",
    name: "Ocean Trust",
    description: "Azul corporativo, sereno e confiável.",
    swatch: ["#f0f5fb", "#2653a8", "#7cc7e6", "#152340"],
  },
  {
    id: "sunset",
    name: "Sunset Energy",
    description: "Laranja e âmbar quentes, alta energia.",
    swatch: ["#fbf1e5", "#d9522a", "#f2b968", "#3a1e10"],
  },
  {
    id: "noir",
    name: "Noir Professional",
    description: "Preto, cinza e branco. Só a claridade separa as camadas.",
    swatch: ["#ffffff", "#c9c9c9", "#5c5c5c", "#141414"],
  },
  {
    id: "nebula",
    name: "Nebula Focus",
    description: "Roxo profundo de céu noturno com lilás estelar. Brilha no escuro.",
    swatch: ["#f3eefb", "#5b3a9e", "#c9a2ff", "#1a1030"],
  },
  {
    id: "magenta",
    name: "Magenta Pulse",
    description: "Rosa vibrante com apoio coral. Alto contraste, sem timidez.",
    swatch: ["#fdeef4", "#c22e6e", "#ff9ec4", "#2c0f1c"],
  },
  {
    id: "ruby",
    name: "Ruby Resolve",
    description: "Vermelho vivo sobre neutros quase brancos. Direto e atual.",
    swatch: ["#fdf6f4", "#ed0004", "#f7a597", "#140b09"],
  },
  {
    id: "lagoon",
    name: "Lagoon Clarity",
    description: "Verde-azulado de fundo de mar, com espuma clara. Calmo e sério.",
    swatch: ["#ecf5f3", "#0e5f57", "#6fd4bd", "#08201f"],
  },
];

/** Precisa bater com a duração da regra `.trocando-tema` em styles.css. */
const DURACAO_RESERVA = 220;
let timerTroca: ReturnType<typeof setTimeout> | undefined;

type DocumentoComTransicao = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

/**
 * Último toque, para o círculo nascer de onde a pessoa clicou.
 *
 * Um ouvinte passivo em captura, e nada mais: guardar a coordenada aqui evita
 * ter que passar o evento por `toggle()` e por `setPalette()` até chegar em
 * cada botão que troca o tema.
 */
let ultimoToque = { x: 0, y: 0, em: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      ultimoToque = { x: e.clientX, y: e.clientY, em: Date.now() };
    },
    { capture: true, passive: true },
  );
}

/**
 * De onde o círculo cresce.
 *
 * O elemento em foco vem primeiro porque cobre teclado e mouse de uma vez: em
 * ambos os casos o botão que trocou o tema é quem está focado. O limite de
 * tamanho descarta contêiner grande que tenha ficado com o foco — um card de
 * paleta de 400 px daria um "centro" que não é lugar nenhum, e aí o ponteiro
 * diz melhor onde a pessoa realmente tocou.
 */
function pontoDeOrigem(): { x: number; y: number } {
  const focado = document.activeElement;
  if (focado instanceof HTMLElement && focado !== document.body) {
    const r = focado.getBoundingClientRect();
    if (r.width > 0 && r.width <= 220 && r.height > 0 && r.height <= 220) {
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  if (Date.now() - ultimoToque.em < 1500) {
    return { x: ultimoToque.x, y: ultimoToque.y };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/**
 * Executa a troca de tema ou paleta animada.
 *
 * Caminho bom: View Transition. O navegador fotografa antes e depois e anima
 * as fotos no compositor — uma animação na GPU, custo independente de quantos
 * elementos existem na tela. Caminho de reserva: transição de cor elemento a
 * elemento, que é o que dava para fazer antes desta API existir.
 */
function comTransicao(mudar: () => void) {
  const raiz = document.documentElement;

  // Quem pediu menos movimento troca seco. O CSS já cobre, mas sair antes
  // também poupa a foto da tela inteira, que não é de graça.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    mudar();
    return;
  }

  const iniciar = (document as DocumentoComTransicao).startViewTransition;
  if (typeof iniciar !== "function") {
    raiz.classList.add("trocando-tema");
    mudar();
    // Trocando tema e paleta em sequência rápida, o primeiro timer removeria a
    // classe no meio da segunda transição e a cortaria pela metade.
    clearTimeout(timerTroca);
    timerTroca = setTimeout(() => raiz.classList.remove("trocando-tema"), DURACAO_RESERVA);
    return;
  }

  const { x, y } = pontoDeOrigem();
  // Raio até o canto mais distante: qualquer valor menor deixaria um pedaço da
  // tela sem ser revelado quando o clique acontece perto de uma borda.
  const raio = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  raiz.style.setProperty("--troca-x", `${x}px`);
  raiz.style.setProperty("--troca-y", `${y}px`);
  raiz.style.setProperty("--troca-r", `${raio}px`);

  const transicao = iniciar.call(document, mudar);
  void transicao.finished.finally(() => {
    raiz.style.removeProperty("--troca-x");
    raiz.style.removeProperty("--troca-y");
    raiz.style.removeProperty("--troca-r");
  });
}

function readPalette(): Palette {
  if (typeof window === "undefined") return "forest";
  const v = localStorage.getItem(PALETTE_KEY) as Palette | null;
  if (v && paletteOptions.some((p) => p.id === v)) return v;
  return "forest";
}

function applyPalette(p: Palette) {
  if (typeof document === "undefined") return;
  if (p === "forest") {
    document.documentElement.removeAttribute("data-palette");
  } else {
    document.documentElement.setAttribute("data-palette", p);
  }
}

/* ————— Estado compartilhado —————

   Antes cada `useTheme()` criava o próprio `useState`. Com dois botões na tela
   — o da barra superior e o de Configurações — cada um guardava a sua ideia de
   qual era o tema atual, e elas divergiam no primeiro clique: trocar por um
   deixava o outro achando que nada tinha mudado, e o toque seguinte nele só
   reaplicava o valor que já estava valendo. O DOM não mudava, e a impressão
   era de um botão que precisa de dois cliques.

   Agora a verdade mora aqui, num lugar só, e os hooks apenas leem dela por
   `useSyncExternalStore`. Quantos botões existirem, todos enxergam o mesmo
   valor e todos disparam a mesma troca. */

type Ouvinte = () => void;

function criarLoja<T extends string>(
  chave: string,
  padrao: T,
  ehValido: (v: string) => boolean,
  aplicarNoDom: (v: T) => void,
  /** Chave da preferência no banco. Sem ela, a loja não sai do navegador. */
  chaveRemota?: "tema" | "paleta",
) {
  const ouvintes = new Set<Ouvinte>();
  let valor: T | null = null;

  // Leitura preguiçosa: no servidor não existe localStorage, e ler no topo do
  // módulo quebraria a renderização antes de qualquer componente montar.
  const ler = (): T => {
    if (valor !== null) return valor;
    if (typeof window === "undefined") return padrao;
    const salvo = localStorage.getItem(chave);
    valor = salvo && ehValido(salvo) ? (salvo as T) : padrao;
    return valor;
  };

  /**
   * `doServidor` distingue "a pessoa clicou" de "acabamos de descobrir a
   * escolha dela". Sem essa diferença, aplicar o que veio do banco dispararia
   * uma gravação de volta — o valor daria a volta e a preferência ficaria se
   * reescrevendo a cada login, sem nunca estar errada e sem nunca parar.
   */
  const definir = (novo: T, doServidor = false) => {
    if (novo === ler()) return;
    valor = novo;
    comTransicao(() => {
      aplicarNoDom(novo);
      try {
        localStorage.setItem(chave, novo);
      } catch {
        // Janela privada ou cota estourada: a troca vale para esta sessão.
        // Falhar em gravar não pode impedir a pessoa de trocar o tema.
      }
    });
    ouvintes.forEach((o) => o());

    /* Escrita otimista: a tela já trocou, o banco fica sabendo depois.
       Se a gravação falhar, a escolha continua valendo nesta máquina pelo
       localStorage — só não acompanha a pessoa para outro computador. É a
       degradação certa: ninguém fica sem tema porque a rede caiu. */
    if (!doServidor && chaveRemota && typeof window !== "undefined") {
      void import("@/lib/perfil.functions")
        .then((m) => m.salvarPreferencia({ data: { chave: chaveRemota, valor: novo } }))
        .catch(() => {});
    }
  };

  const assinar = (o: Ouvinte) => {
    ouvintes.add(o);
    return () => {
      ouvintes.delete(o);
    };
  };

  return { ler, definir, assinar, noServidor: () => padrao };
}

const lojaTema = criarLoja<Theme>(
  KEY,
  "dark",
  (v) => v === "light" || v === "dark",
  (t) => document.documentElement.classList.toggle("dark", t === "dark"),
  "tema",
);

const lojaPaleta = criarLoja<Palette>(
  PALETTE_KEY,
  "forest",
  (v) => paletteOptions.some((p) => p.id === v),
  applyPalette,
  "paleta",
);

/**
 * Traz do banco a escolha de tema e paleta desta pessoa.
 *
 * Roda uma vez, depois do login. Antes disso o `localStorage` já mandou — é ele
 * que faz a primeira pintura sair certa, sem esperar rede. Esta função existe
 * para o caso de a pessoa estar num computador onde nunca escolheu nada: em vez
 * do padrão, ela recebe o tema que escolheu no outro.
 *
 * Falha em silêncio de propósito. Não conseguir ler a preferência é motivo para
 * manter a que está valendo, não para deixar alguém sem tema.
 */
export async function sincronizarPreferencias(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { minhasPreferencias } = await import("@/lib/perfil.functions");
    const guardadas = await minhasPreferencias();

    const tema = guardadas.tema;
    if (tema === "light" || tema === "dark") lojaTema.definir(tema, true);

    const paleta = guardadas.paleta;
    if (paleta && paletteOptions.some((p) => p.id === paleta)) {
      lojaPaleta.definir(paleta as Palette, true);
    }
  } catch {
    /* sem preferência salva, ou sem rede: fica o que já estava */
  }
}

/**
 * Confirma no DOM o que o script inline já aplicou antes da primeira pintura.
 * Rede de segurança: se aquele script falhar, a tela ainda sai certa.
 */
export function useApplyPalette() {
  useEffect(() => {
    applyPalette(lojaPaleta.ler());
  }, []);
}

/** Mesma rede de segurança, para o tema. */
export function useApplyTheme() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", lojaTema.ler() === "dark");
  }, []);
}

export function usePalette() {
  const palette = useSyncExternalStore(
    lojaPaleta.assinar,
    lojaPaleta.ler,
    lojaPaleta.noServidor,
  );
  return { palette, setPalette: lojaPaleta.definir };
}

export function useTheme() {
  const theme = useSyncExternalStore(lojaTema.assinar, lojaTema.ler, lojaTema.noServidor);
  return {
    theme,
    setTheme: lojaTema.definir,
    // Lê da loja, não do valor capturado: garante que o alvo do toggle é o
    // estado de agora, mesmo se este componente ainda não tiver re-renderizado.
    toggle: () => lojaTema.definir(lojaTema.ler() === "dark" ? "light" : "dark"),
  };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diff / 1000));
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} sem`;
  const m = Math.floor(d / 30);
  if (m < 12) return `há ${m} mês${m > 1 ? "es" : ""}`;
  return `há ${Math.floor(d / 365)} ano(s)`;
}

export function formatDueBucket(iso: string): "atrasada" | "hoje" | "semana" | "depois" {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(iso);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((dueDay.getTime() - now.getTime()) / (24 * 3600e3));
  if (diffDays < 0) return "atrasada";
  if (diffDays === 0) return "hoje";
  if (diffDays <= 7) return "semana";
  return "depois";
}