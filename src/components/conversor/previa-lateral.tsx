import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { CaixaDePrevia, PreviaPronta } from "./locais/miniaturas";
import { ContextoDaPrevia, type ValorDaPrevia } from "./previa-contexto";
import { ErroDeConversao } from "./tipos";

/*
 * A prévia lateral (05/11/2026): passar o mouse numa página, numa imagem ou no
 * nome de um arquivo abre, no lado direito do painel, aquela página ou imagem em
 * tamanho grande. A miniatura de 112 px serve para achar a página; a prévia serve
 * para ler o que está nela antes de marcar, girar ou ordenar.
 *
 * Como é montada:
 * - `PreviaLateral` fica por fora da moldura do painel (`paleta-de-conversao.tsx`)
 *   e cuida de quando abrir, de quanto cabe e do painel em si;
 * - quem pede a prévia é o próprio item (a miniatura, a linha): ele espalha os
 *   gestos de `usePreviaLateral` e, enquanto for a vez dele, desenha o
 *   `PreviaNoPainel` — que entra no painel por um portal. Por isso a prévia
 *   acompanha o item ao vivo: girou a página com o mouse em cima, a prévia gira.
 *
 * Cabe só o que sobra ao lado do painel. Em janela estreita demais (menos de uns
 * 1250 px) não abre: a página ficaria do tamanho da miniatura. O painel não
 * recebe o mouse (`pointer-events-none`): não rouba o hover do item, e um clique
 * em cima dele cai no vazio da paleta, como em qualquer outro canto do véu.
 * Fica escondido dos leitores de tela — o item já tem o rótulo.
 */

/** Espera antes de abrir, para a prévia não piscar a cada miniatura que o mouse atravessa. */
const ESPERA_PARA_ABRIR = 140;
/** Espera antes de fechar, para trocar de miniatura sem fechar e abrir de novo. */
const ESPERA_PARA_FECHAR = 90;
const LARGURA_MAXIMA = 560;
const ALTURA_MAXIMA = 1000;
/** Menos largura que isso e a página não passa de uma miniatura um pouco maior: não abre. */
const LARGURA_MINIMA = 200;
const ALTURA_MINIMA = 200;
/** Entre o painel e o cartão, e entre o cartão e a borda da tela. */
const RESPIRO = 16;
/** O padding do cartão. */
const MOLDURA = 12;
/** A linha da legenda, com a folga embaixo dela. */
const LEGENDA = 32;

type Espaco = { livre: number; alto: number };

/**
 * Quanto sobra à direita do painel e quanto tem de altura. Usa as medidas de
 * layout (`offset*`), que ignoram a animação de entrada do painel (ele cresce de
 * 98% a 100%).
 */
function medirEspaco(painel: HTMLElement | null): Espaco {
  const casca = painel?.offsetParent;
  const tela = casca instanceof HTMLElement ? casca.offsetParent : null;
  if (!(casca instanceof HTMLElement) || !(tela instanceof HTMLElement)) {
    return { livre: 0, alto: 0 };
  }
  return {
    livre: tela.clientWidth - (casca.offsetLeft + casca.offsetWidth),
    alto: tela.clientHeight,
  };
}

function caixaDaPrevia({ livre, alto }: Espaco): CaixaDePrevia {
  return {
    largura: Math.max(0, Math.min(LARGURA_MAXIMA, livre - 2 * RESPIRO - 2 * MOLDURA)),
    altura: Math.max(0, Math.min(ALTURA_MAXIMA, alto - 2 * RESPIRO - 2 * MOLDURA - LEGENDA)),
  };
}

export function PreviaLateral({ children }: { children: ReactNode }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [espaco, setEspaco] = useState<Espaco>({ livre: 0, alto: 0 });
  const abrindo = useRef(0);
  const saindo = useRef(0);
  const ativoAgora = useRef<string | null>(null);
  const bloqueado = useRef(false);

  const caixa = useMemo(() => caixaDaPrevia(espaco), [espaco]);
  const cabe = caixa.largura >= LARGURA_MINIMA && caixa.altura >= ALTURA_MINIMA;
  const cabeAgora = useRef(false);

  const definir = useCallback((id: string | null) => {
    ativoAgora.current = id;
    setAtivo(id);
  }, []);

  useLayoutEffect(() => {
    const medir = () => {
      const nova = medirEspaco(raiz.current);
      setEspaco((antiga) =>
        antiga.livre === nova.livre && antiga.alto === nova.alto ? antiga : nova,
      );
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  // A janela encolheu com a prévia aberta: não cabe mais, fecha.
  useEffect(() => {
    cabeAgora.current = cabe;
    if (!cabe) {
      window.clearTimeout(abrindo.current);
      definir(null);
    }
  }, [cabe, definir]);

  useEffect(
    () => () => {
      window.clearTimeout(abrindo.current);
      window.clearTimeout(saindo.current);
    },
    [],
  );

  const entrar = useCallback(
    (id: string) => {
      window.clearTimeout(saindo.current);
      if (bloqueado.current || !cabeAgora.current) return;
      if (ativoAgora.current !== null) {
        definir(id);
        return;
      }
      window.clearTimeout(abrindo.current);
      abrindo.current = window.setTimeout(() => definir(id), ESPERA_PARA_ABRIR);
    },
    [definir],
  );

  const sair = useCallback(
    (id: string) => {
      window.clearTimeout(abrindo.current);
      window.clearTimeout(saindo.current);
      saindo.current = window.setTimeout(() => {
        if (ativoAgora.current === id) definir(null);
      }, ESPERA_PARA_FECHAR);
    },
    [definir],
  );

  const fechar = useCallback(
    (id: string) => {
      window.clearTimeout(abrindo.current);
      window.clearTimeout(saindo.current);
      if (ativoAgora.current === id) definir(null);
    },
    [definir],
  );

  const bloquear = useCallback(
    (b: boolean) => {
      bloqueado.current = b;
      if (!b) return;
      window.clearTimeout(abrindo.current);
      window.clearTimeout(saindo.current);
      definir(null);
    },
    [definir],
  );

  const valor = useMemo<ValorDaPrevia>(
    () => ({ ativo, slot, caixa, entrar, sair, fechar, bloquear }),
    [ativo, slot, caixa, entrar, sair, fechar, bloquear],
  );

  return (
    <ContextoDaPrevia.Provider value={valor}>
      {children}
      <div
        ref={raiz}
        aria-hidden
        className="pointer-events-none absolute left-full top-0 z-10 flex h-full items-center pl-4"
      >
        {ativo !== null && cabe && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="rounded-2xl border border-white/15 bg-zinc-900/95 p-3 shadow-[0_24px_70px_rgb(0_0_0/0.55)]"
          >
            <div ref={setSlot} />
          </motion.div>
        )}
      </div>
    </ContextoDaPrevia.Provider>
  );
}

/* ------------------------------ O que aparece ------------------------------ */

type Estado =
  | { tipo: "carregando" }
  | { tipo: "pronto"; pronta: PreviaPronta }
  | { tipo: "erro"; mensagem: string };

type PropsDaPrevia = {
  /** O nome do que está na prévia: "Página 2 de 6", o nome do arquivo. */
  legenda: string;
  /** Muda quando a prévia tem de ser desenhada de novo (outra página, outro giro). */
  chave: string;
  /** Desenha a prévia, cabendo na caixa. Chamado de novo se a `chave` ou a caixa mudarem. */
  carregar: (caixa: CaixaDePrevia, sinal: AbortSignal) => Promise<PreviaPronta>;
  /**
   * A miniatura da própria página, se já foi desenhada: aparece esticada enquanto
   * a página grande não fica pronta, para a prévia nunca abrir vazia.
   */
  miniatura?: HTMLCanvasElement | null;
  /** O giro (0, 90, 180 ou 270) que a miniatura ainda não tem nos pixels, só no CSS. */
  giro?: number;
};

/** A prévia deste item, desenhada dentro do painel lateral. Não faz nada se o painel não está aberto para ele. */
export function PreviaNoPainel(props: PropsDaPrevia) {
  const valor = useContext(ContextoDaPrevia);
  if (!valor?.slot) return null;
  return createPortal(<CartaoDaPrevia {...props} caixa={valor.caixa} />, valor.slot);
}

/** Cabe na caixa sem deformar. */
function caber(largura: number, altura: number, caixa: CaixaDePrevia) {
  const escala = Math.min(caixa.largura / largura, caixa.altura / altura);
  return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}

/** A miniatura nos pixels do canvas da prévia, já com o giro. */
function desenharMiniatura(alvo: HTMLCanvasElement, origem: HTMLCanvasElement, giro: number) {
  const deitada = giro === 90 || giro === 270;
  alvo.width = deitada ? origem.height : origem.width;
  alvo.height = deitada ? origem.width : origem.height;
  const ctx = alvo.getContext("2d");
  if (!ctx) return;
  ctx.translate(alvo.width / 2, alvo.height / 2);
  ctx.rotate((giro * Math.PI) / 180);
  ctx.drawImage(origem, -origem.width / 2, -origem.height / 2);
}

function CartaoDaPrevia({
  legenda,
  chave,
  carregar,
  miniatura,
  giro = 0,
  caixa,
}: PropsDaPrevia & { caixa: CaixaDePrevia }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const { largura, altura } = caixa;

  const carregarAtual = useRef(carregar);
  useEffect(() => {
    carregarAtual.current = carregar;
  });

  useEffect(() => {
    const controle = new AbortController();
    setEstado({ tipo: "carregando" });
    carregarAtual.current({ largura, altura }, controle.signal).then(
      (pronta) => {
        if (!controle.signal.aborted) setEstado({ tipo: "pronto", pronta });
      },
      (e: unknown) => {
        if (controle.signal.aborted) return;
        setEstado({
          tipo: "erro",
          mensagem: e instanceof ErroDeConversao ? e.message : "Não consegui mostrar a prévia.",
        });
      },
    );
    return () => controle.abort();
  }, [chave, largura, altura]);

  const comMiniatura =
    estado.tipo === "carregando" && !!miniatura && miniatura.width > 1 && miniatura.height > 1;

  useLayoutEffect(() => {
    const alvo = canvas.current;
    if (!alvo) return;
    try {
      if (estado.tipo === "pronto") {
        const { fonte } = estado.pronta;
        alvo.width = fonte.width;
        alvo.height = fonte.height;
        alvo.getContext("2d")?.drawImage(fonte, 0, 0);
      } else if (estado.tipo === "carregando" && miniatura) {
        desenharMiniatura(alvo, miniatura, giro);
      }
    } catch {
      /* A fonte foi solta (a tela fechou no meio): não há o que mostrar. */
    }
  }, [estado, miniatura, giro]);

  let tamanho: { largura: number; altura: number } | null = null;
  if (estado.tipo === "pronto") {
    tamanho = { largura: estado.pronta.larguraCss, altura: estado.pronta.alturaCss };
  } else if (comMiniatura && miniatura) {
    const deitada = giro === 90 || giro === 270;
    tamanho = caber(
      deitada ? miniatura.height : miniatura.width,
      deitada ? miniatura.width : miniatura.height,
      caixa,
    );
  }

  return (
    <>
      {/* `w-0 min-w-full`: a legenda acompanha a largura da página e nunca a alarga. */}
      <div className="mb-2 flex w-0 min-w-full items-baseline gap-2 text-xs">
        <span className="min-w-0 truncate font-semibold text-white" title={legenda}>
          {legenda}
        </span>
        {estado.tipo === "pronto" && estado.pronta.detalhe && (
          <span className="shrink-0 text-white/50">{estado.pronta.detalhe}</span>
        )}
      </div>
      {estado.tipo === "erro" ? (
        <p className="max-w-56 text-xs leading-snug text-white/65">{estado.mensagem}</p>
      ) : tamanho ? (
        <canvas
          ref={canvas}
          style={{ width: tamanho.largura, height: tamanho.altura }}
          className="block rounded-md bg-white shadow-[0_6px_24px_rgb(0_0_0/0.35)] ring-1 ring-white/10"
        />
      ) : (
        <div
          className="grid place-items-center rounded-md bg-white/[0.06]"
          style={{ width: Math.min(largura, 240), height: Math.min(altura, 300) }}
        >
          <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-hidden />
        </div>
      )}
    </>
  );
}
