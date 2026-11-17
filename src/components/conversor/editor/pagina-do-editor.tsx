import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Loader2 } from "lucide-react";
import { abrirNoPdfjs } from "../locais/pdfjs";
import { previaDaPagina } from "../locais/editor/aplicar";
import {
  viewportEmPontos,
  type DocumentoAberto,
  type PaginaPdfjs,
} from "../locais/editor/documento";
import type { LinhaDeTexto } from "../locais/editor/linhas";
import type { ResumoDaTroca, Rgb } from "../locais/editor/pagina";
import { temArquivo } from "../so-arquivo";
import { camposDaPagina, type CampoDaPagina } from "./campos";
import { CamposDoFormulario } from "./campos-do-formulario";
import {
  alturaDoTexto,
  amostrarCores,
  cssDe,
  ENTRELINHA,
  FONTE_CSS,
  medidasNaTela,
  novoId,
  quebrarLinhas,
  type EdicaoNoEstado,
  type Estilo,
  type Ferramenta,
  type Giro,
  type ImagemGuardada,
  type Objeto,
  type ObjetoLinha,
  type ObjetoTexto,
  type PaginaDoEditor as Pagina,
  type Pendente,
  type ValorDeCampo,
} from "./modelo";

/*
 * Uma página do Editor de PDF (05/11/2026): o desenho do PDF num canvas e, por cima,
 * as linhas de texto clicáveis e os objetos que a pessoa acrescentou.
 *
 * O desenho é o PDF de verdade: toda linha trocada gera uma prévia da página, pelo
 * mesmo caminho que salva (`previaDaPagina`), e é ela que aparece. O que a pessoa vê
 * é o que sai no arquivo, com a mesma fonte, e não uma imitação na tela. Enquanto a
 * prévia não fica pronta, a linha mostra um remendo com a cor de fundo.
 *
 * Tudo por cima do canvas está em pontos do PDF, numa camada com `scale(zoom)`: as
 * contas não dependem do zoom. As alças e os contornos dividem por `--z` para ficarem
 * do mesmo tamanho em qualquer zoom.
 */

type DocumentoPdfjs = DocumentoAberto["pdf"];

/** Teto de pixels de uma página: 6 milhões é uma folha A4 a 280 dpi, e são 24 MB de canvas. */
const PIXELS_MAXIMOS = 6_000_000;
const ESPERA_PARA_REDESENHAR_MS = 120;
const LADO_MINIMO = 4;
const DISTANCIA_MINIMA_DO_TRACO = 0.75;

export type PropsDaPagina = {
  pagina: Pagina;
  documento: DocumentoAberto | null;
  zoom: number;
  ferramenta: Ferramenta;
  estilo: Estilo;
  objetos: readonly Objeto[];
  edicoes: readonly EdicaoNoEstado[];
  imagens: ReadonlyMap<string, ImagemGuardada>;
  selecionado: string | null;
  raiz: RefObject<HTMLElement | null>;
  aoSelecionar: (id: string | null) => void;
  aoAdicionar: (o: Objeto) => void;
  aoAtualizar: (id: string, novo: Partial<Objeto>) => void;
  aoRemover: (id: string) => void;
  aoEditarLinha: (
    paginaId: string,
    linha: LinhaDeTexto,
    texto: string,
    cores: { fundo: Rgb; texto: Rgb },
  ) => void;
  aoTerminarFerramenta: () => void;
  aoSoltarArquivos: (arquivos: File[], paginaId: string, x: number, y: number) => void;
  aoResumo: (paginaId: string, resumo: ResumoDaTroca | null) => void;
  aoContarLinhas: (paginaId: string, quantas: number) => void;
  /** Os campos de formulário já mudados (de todo o PDF), pelo nome do campo. */
  campos: Readonly<Record<string, ValorDeCampo>>;
  aoMudarCampo: (nome: string, valor: ValorDeCampo) => void;
  /** O que está sendo digitado agora (para o rascunho), ou `null` quando o campo fecha. */
  aoDigitar: (p: Pendente | null) => void;
};

type Caixa = { x: number; y: number; l: number; a: number };

/** A linha nas coordenadas da página: de onde sai, para onde aponta, e quanto ocupa. */
type CaixaDaLinha = {
  x: number;
  y: number;
  angulo: number;
  largura: number;
  acima: number;
  abaixo: number;
};

function caixaDaLinha(l: LinhaDeTexto, vp: ReturnType<PaginaPdfjs["getViewport"]>): CaixaDaLinha {
  const { regiao: r } = l;
  const [px, py] = vp.convertToViewportPoint(r.x, r.y) as [number, number];
  const [qx, qy] = vp.convertToViewportPoint(r.x + r.ux, r.y + r.uy) as [number, number];
  return {
    x: px,
    y: py,
    angulo: (Math.atan2(qy - py, qx - px) * 180) / Math.PI,
    largura: r.largura,
    acima: l.ascendente * r.tamanho,
    abaixo: l.descendente * r.tamanho,
  };
}

function estiloDaCaixa(c: CaixaDaLinha, largura = c.largura): CSSProperties {
  return {
    position: "absolute",
    left: c.x,
    top: c.y,
    width: largura,
    height: c.acima + c.abaixo,
    transformOrigin: "0 0",
    transform: `rotate(${c.angulo}deg) translateY(${-c.acima}px)`,
  };
}

function coresDaLinha(canvas: HTMLCanvasElement | null, c: CaixaDaLinha, larguraDaPagina: number) {
  const padrao = { fundo: { r: 1, g: 1, b: 1 }, texto: { r: 0, g: 0, b: 0 } };
  if (!canvas || canvas.width === 0) return padrao;
  const s = canvas.width / larguraDaPagina;
  const rad = (c.angulo * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sen = Math.sin(rad);
  const cantos = [
    [0, -c.acima],
    [c.largura, -c.acima],
    [0, c.abaixo],
    [c.largura, c.abaixo],
  ].map(([u, v]) => [c.x + u! * cos - v! * sen, c.y + u! * sen + v! * cos] as const);
  const xs = cantos.map((p) => p[0]);
  const ys = cantos.map((p) => p[1]);
  return amostrarCores(canvas, {
    x0: Math.min(...xs) * s,
    y0: Math.min(...ys) * s,
    x1: Math.max(...xs) * s,
    y1: Math.max(...ys) * s,
  });
}

/* ------------------------------- O desenho ---------------------------------- */

function DesenhoDoObjeto({
  o,
  imagens,
}: {
  o: Objeto;
  imagens: ReadonlyMap<string, ImagemGuardada>;
}) {
  switch (o.tipo) {
    case "texto":
      return <LinhasDoTexto o={o} />;
    case "imagem": {
      const img = imagens.get(o.imagemId);
      return img ? (
        <img src={img.url} alt="" draggable={false} className="block h-full w-full select-none" />
      ) : null;
    }
    case "realce":
      return <div className="h-full w-full" style={{ background: o.cor, opacity: 0.4 }} />;
    case "retangulo":
      return (
        <svg width={o.l} height={o.a} className="absolute inset-0 overflow-visible" aria-hidden>
          <rect
            width={o.l}
            height={o.a}
            fill={o.preenchimento ?? "none"}
            stroke={o.cor}
            strokeWidth={o.espessura}
          />
        </svg>
      );
    case "elipse":
      return (
        <svg width={o.l} height={o.a} className="absolute inset-0 overflow-visible" aria-hidden>
          <ellipse
            cx={o.l / 2}
            cy={o.a / 2}
            rx={o.l / 2}
            ry={o.a / 2}
            fill={o.preenchimento ?? "none"}
            stroke={o.cor}
            strokeWidth={o.espessura}
          />
        </svg>
      );
    default:
      return <DesenhoDaLinha o={o} />;
  }
}

function DesenhoDaLinha({ o }: { o: ObjetoLinha }) {
  const pontos = o.pontos.map(([x, y]) => [x * o.l, y * o.a] as const);
  const ultimo = pontos[pontos.length - 1];
  const penultimo = pontos[pontos.length - 2];
  let ponta = "";
  if (o.tipo === "seta" && ultimo && penultimo) {
    const angulo = Math.atan2(ultimo[1] - penultimo[1], ultimo[0] - penultimo[0]);
    const tamanho = Math.max(8, o.espessura * 4);
    for (const lado of [-1, 1]) {
      const a = angulo + Math.PI + (lado * Math.PI) / 7;
      ponta += `M${ultimo[0]} ${ultimo[1]}L${ultimo[0] + Math.cos(a) * tamanho} ${ultimo[1] + Math.sin(a) * tamanho}`;
    }
  }
  return (
    <svg width={o.l} height={o.a} className="absolute inset-0 overflow-visible" aria-hidden>
      <polyline
        points={pontos.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke={o.cor}
        strokeWidth={o.espessura}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {ponta && (
        <path
          d={ponta}
          fill="none"
          stroke={o.cor}
          strokeWidth={o.espessura}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function estiloDoTexto(o: Omit<ObjetoTexto, "id" | "paginaId" | "giroDaCamada">): CSSProperties {
  return {
    fontFamily: FONTE_CSS[o.familia],
    fontSize: o.tamanho,
    lineHeight: ENTRELINHA,
    fontWeight: o.negrito ? 700 : 400,
    fontStyle: o.italico ? "italic" : "normal",
    color: o.cor,
    textAlign:
      o.alinhamento === "centro" ? "center" : o.alinhamento === "direita" ? "right" : "left",
  };
}

function LinhasDoTexto({ o }: { o: ObjetoTexto }) {
  // As mesmas quebras de linha do arquivo salvo, e não as que o navegador escolheria.
  return (
    <div style={estiloDoTexto(o)} className="select-none whitespace-pre">
      {quebrarLinhas(o.texto, o.l, o).map((linha, i) => (
        <div key={i}>{linha || " "}</div>
      ))}
    </div>
  );
}

/* --------------------------- Editores de texto ------------------------------- */

function CaixaDeTexto({
  o,
  aoTerminar,
  aoDigitar,
}: {
  o: ObjetoTexto;
  /** `null` = cancelou com Esc. */
  aoTerminar: (texto: string | null) => void;
  /** O texto a cada letra (para o rascunho), e `null` ao terminar. */
  aoDigitar: (texto: string | null) => void;
}) {
  const [texto, setTexto] = useState(o.texto);
  const campo = useRef<HTMLTextAreaElement>(null);
  const terminou = useRef(false);
  const terminar = (valor: string | null) => {
    if (terminou.current) return;
    terminou.current = true;
    aoDigitar(null);
    aoTerminar(valor);
  };
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.setSelectionRange(c.value.length, c.value.length);
  }, []);
  return (
    <textarea
      ref={campo}
      value={texto}
      rows={1}
      aria-label="Texto"
      onChange={(e) => {
        setTexto(e.target.value);
        aoDigitar(e.target.value);
      }}
      onBlur={() => terminar(texto)}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          // Grava o que foi digitado e deixa subir: quem salva é o atalho do Editor.
          e.preventDefault();
          terminar(texto);
          return;
        }
        e.stopPropagation();
        // O Esc também guarda: um texto comprido não some por um toque, e o Ctrl+Z desfaz.
        if (e.key === "Escape") terminar(texto);
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) terminar(texto);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={
        {
          ...estiloDoTexto(o),
          width: o.l,
          fieldSizing: "content",
          outlineWidth: "calc(1.5px / var(--z))",
        } as CSSProperties
      }
      className="block min-h-[1em] resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent p-0 outline-dashed outline-[var(--acento)]"
    />
  );
}

function EditorDeLinha({
  caixa,
  linha,
  inicial,
  cores,
  aoTerminar,
  aoDigitar,
}: {
  caixa: CaixaDaLinha;
  linha: LinhaDeTexto;
  inicial: string;
  cores: { fundo: Rgb; texto: Rgb };
  aoTerminar: (texto: string | null) => void;
  /** O texto a cada letra (para o rascunho), e `null` ao terminar. */
  aoDigitar: (texto: string | null) => void;
}) {
  const [texto, setTexto] = useState(inicial);
  const campo = useRef<HTMLInputElement>(null);
  const terminou = useRef(false);
  const terminar = (valor: string | null) => {
    if (terminou.current) return;
    terminou.current = true;
    aoDigitar(null);
    aoTerminar(valor);
  };
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.select();
  }, []);
  return (
    <input
      ref={campo}
      data-linha-aberta
      value={texto}
      aria-label={`Editar: ${inicial}`}
      onChange={(e) => {
        setTexto(e.target.value);
        aoDigitar(e.target.value);
      }}
      onBlur={() => terminar(texto)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          // Grava o que foi digitado e deixa subir: quem salva é o atalho do Editor.
          e.preventDefault();
          terminar(texto);
          return;
        }
        e.stopPropagation();
        if (e.key === "Enter") terminar(texto);
        if (e.key === "Escape") terminar(null);
      }}
      style={
        {
          ...estiloDaCaixa(caixa),
          minWidth: caixa.largura,
          width: undefined,
          fieldSizing: "content",
          fontFamily: FONTE_CSS[linha.familia],
          fontSize: linha.regiao.tamanho,
          fontWeight: linha.negrito ? 700 : 400,
          fontStyle: linha.italico ? "italic" : "normal",
          lineHeight: `${caixa.acima + caixa.abaixo}px`,
          color: cssDe(cores.texto),
          background: cssDe(cores.fundo),
          outlineWidth: "calc(1.5px / var(--z))",
          zIndex: 25,
        } as CSSProperties
      }
      className="whitespace-pre border-0 p-0 outline outline-[var(--acento)]"
    />
  );
}

/* --------------------------- O objeto selecionável ---------------------------- */

const ALCAS = [
  { id: "no", hx: -1, hy: -1, cursor: "nwse-resize" },
  { id: "n", hx: 0, hy: -1, cursor: "ns-resize" },
  { id: "ne", hx: 1, hy: -1, cursor: "nesw-resize" },
  { id: "l", hx: 1, hy: 0, cursor: "ew-resize" },
  { id: "se", hx: 1, hy: 1, cursor: "nwse-resize" },
  { id: "s", hx: 0, hy: 1, cursor: "ns-resize" },
  { id: "so", hx: -1, hy: 1, cursor: "nesw-resize" },
  { id: "o", hx: -1, hy: 0, cursor: "ew-resize" },
] as const;

type Alca = (typeof ALCAS)[number];

/* ------------------------------ A página ------------------------------------- */

function PaginaDoEditorSemMemo(props: PropsDaPagina) {
  const {
    pagina,
    documento,
    zoom,
    ferramenta,
    estilo,
    objetos,
    edicoes,
    imagens,
    selecionado,
    raiz,
    aoSelecionar,
    aoAdicionar,
    aoAtualizar,
    aoRemover,
    aoEditarLinha,
    aoTerminarFerramenta,
    aoSoltarArquivos,
    aoResumo,
    aoContarLinhas,
    campos,
    aoMudarCampo,
    aoDigitar,
  } = props;
  const casca = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [original, setOriginal] = useState<PaginaPdfjs | null>(null);
  const [linhas, setLinhas] = useState<LinhaDeTexto[]>([]);
  const [editada, setEditada] = useState<{ pagina: PaginaPdfjs; assinatura: string } | null>(null);
  /** Com o que o canvas está desenhado agora: a assinatura das edições, ou `null` se vazio. */
  const [desenhada, setDesenhada] = useState<string | null>(null);
  const [linhaAberta, setLinhaAberta] = useState<LinhaDeTexto | null>(null);
  const [coresAbertas, setCoresAbertas] = useState<{ fundo: Rgb; texto: Rgb } | null>(null);
  const [editandoTexto, setEditandoTexto] = useState<string | null>(null);
  const [textoNovo, setTextoNovo] = useState<ObjetoTexto | null>(null);
  const [rascunho, setRascunho] = useState<(Caixa & { id: string }) | null>(null);
  const [desenhando, setDesenhando] = useState<Objeto | null>(null);

  const tela = medidasNaTela(pagina, pagina.giro);
  const indice = pagina.indice;

  /* ---- Só desenha o que está perto da tela ---- */
  useEffect(() => {
    const alvo = casca.current;
    if (!alvo) return;
    const obs = new IntersectionObserver((e) => setVisivel(e.some((x) => x.isIntersecting)), {
      root: raiz.current,
      rootMargin: "400px",
    });
    obs.observe(alvo);
    return () => obs.disconnect();
  }, [raiz]);

  useEffect(() => {
    if (!visivel || !documento || original) return;
    let vivo = true;
    documento.pagina(indice).then(
      (p) => {
        if (vivo) setOriginal(p);
      },
      () => {}, // Só falha com o Editor fechando.
    );
    return () => {
      vivo = false;
    };
  }, [visivel, documento, indice, original]);

  /* ---- As linhas de texto ---- */
  useEffect(() => {
    if (!visivel || !documento) return;
    let vivo = true;
    void documento
      .linhas(indice)
      .then((l) => {
        if (!vivo) return;
        setLinhas(l);
        aoContarLinhas(pagina.id, l.length);
      })
      .catch((e: unknown) => console.warn("[editor de PDF] não li o texto da página", e));
    return () => {
      vivo = false;
    };
  }, [visivel, documento, indice, pagina.id, aoContarLinhas]);

  const viewport = useMemo(() => (original ? viewportEmPontos(original) : null), [original]);
  const caixas = useMemo(() => {
    const m = new Map<string, CaixaDaLinha>();
    if (viewport) for (const l of linhas) m.set(l.id, caixaDaLinha(l, viewport));
    return m;
  }, [linhas, viewport]);
  const edicoesPorLinha = useMemo(() => new Map(edicoes.map((e) => [e.linha.id, e])), [edicoes]);

  /* ---- Os campos de formulário (só do PDF principal: os de outro PDF não entram no formulário dele) ---- */
  const [camposDaPagina_, setCamposDaPagina] = useState<CampoDaPagina[]>([]);
  useEffect(() => {
    if (!visivel || !original || !viewport || pagina.documento !== 0) return;
    let vivo = true;
    camposDaPagina(original, viewport).then(
      (c) => {
        if (vivo) setCamposDaPagina(c);
      },
      (e: unknown) => console.warn("[editor de PDF] não li os campos da página", e),
    );
    return () => {
      vivo = false;
    };
  }, [visivel, original, viewport, pagina.documento]);

  /* ---- A prévia com as linhas trocadas ---- */
  const assinatura = useMemo(
    () => JSON.stringify(edicoes.map((e) => [e.linha.id, e.texto]).sort()),
    [edicoes],
  );
  const semEdicoes = edicoes.length === 0;
  const edicoesAtuais = useRef(edicoes);
  useEffect(() => {
    edicoesAtuais.current = edicoes;
  });
  const documentoDaPrevia = useRef<DocumentoPdfjs | null>(null);
  useEffect(() => {
    if (!documento || semEdicoes) {
      setEditada(null);
      aoResumo(pagina.id, null);
      return;
    }
    let vivo = true;
    const espera = window.setTimeout(() => {
      void (async () => {
        try {
          const { bytes, resumo } = await previaDaPagina(documento, indice, edicoesAtuais.current);
          if (!vivo) return;
          const pdf = await abrirNoPdfjs(bytes, documento.nome);
          const p = await pdf.getPage(1);
          if (!vivo) {
            void pdf.loadingTask.destroy();
            return;
          }
          const anterior = documentoDaPrevia.current;
          documentoDaPrevia.current = pdf;
          setEditada({ pagina: p, assinatura });
          aoResumo(pagina.id, resumo);
          // O desenho que está em curso ainda usa a anterior: solta depois de ele acabar.
          if (anterior) window.setTimeout(() => void anterior.loadingTask.destroy(), 2000);
        } catch (e) {
          console.warn("[editor de PDF] a prévia da página falhou", e);
        }
      })();
    }, ESPERA_PARA_REDESENHAR_MS);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
    };
  }, [documento, indice, assinatura, semEdicoes, pagina.id, aoResumo]);
  useEffect(
    () => () => {
      void documentoDaPrevia.current?.loadingTask.destroy();
      documentoDaPrevia.current = null;
    },
    [],
  );

  /* ---- O desenho no canvas ---- */
  const paginaPdf = editada?.pagina ?? original;
  const assinaturaDoDesenho = editada ? editada.assinatura : "[]";
  useEffect(() => {
    const alvo = canvas.current;
    if (!alvo) return;
    if (!visivel) {
      // Longe da tela: solta a memória. Ao voltar, desenha de novo.
      alvo.width = 0;
      alvo.height = 0;
      setDesenhada(null);
      return;
    }
    if (!paginaPdf) return;
    let tarefa: ReturnType<PaginaPdfjs["render"]> | null = null;
    let vivo = true;
    const espera = window.setTimeout(() => {
      const densidade = Math.min(window.devicePixelRatio || 1, 2);
      const natural = viewportEmPontos(paginaPdf);
      const escala = Math.min(
        zoom * densidade,
        Math.sqrt(PIXELS_MAXIMOS / (natural.width * natural.height)),
      );
      const vp = viewportEmPontos(paginaPdf, escala);
      const fora = document.createElement("canvas");
      fora.width = Math.max(1, Math.ceil(vp.width));
      fora.height = Math.max(1, Math.ceil(vp.height));
      tarefa = paginaPdf.render({ canvas: fora, viewport: vp });
      tarefa.promise.then(
        () => {
          if (!vivo || !canvas.current) return;
          const c = canvas.current;
          c.width = fora.width;
          c.height = fora.height;
          c.getContext("2d")?.drawImage(fora, 0, 0);
          setDesenhada(assinaturaDoDesenho);
        },
        (e: unknown) => {
          const nome = (e as { name?: string } | null)?.name;
          if (nome !== "RenderingCancelledException") {
            console.warn("[editor de PDF] não desenhei a página", e);
          }
        },
      );
    }, ESPERA_PARA_REDESENHAR_MS);
    return () => {
      vivo = false;
      window.clearTimeout(espera);
      tarefa?.cancel();
    };
  }, [visivel, paginaPdf, zoom, assinaturaDoDesenho]);

  const prontaAgora = desenhada === assinatura;

  /* ---- De coordenada de tela para a coordenada de uma camada ---- */
  const paraCamada = (clientX: number, clientY: number, giroDaCamada: Giro): [number, number] => {
    const r = casca.current!.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const teta = ((pagina.giro - giroDaCamada) * Math.PI) / 180;
    const x = (dx * Math.cos(teta) + dy * Math.sin(teta)) / zoom;
    const y = (-dx * Math.sin(teta) + dy * Math.cos(teta)) / zoom;
    const m = medidasNaTela(pagina, giroDaCamada);
    return [x + m.largura / 2, y + m.altura / 2];
  };

  /* ---- Mover e redimensionar ---- */
  const seguirGesto = (
    aoMover: (e: PointerEvent) => void,
    aoSoltar: (e: PointerEvent, cancelado: boolean) => void,
  ) => {
    const mover = (e: PointerEvent) => aoMover(e);
    const fim = (e: PointerEvent) => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", fim);
      window.removeEventListener("pointercancel", fim);
      aoSoltar(e, e.type === "pointercancel");
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", fim);
    window.addEventListener("pointercancel", fim);
  };

  const iniciarMover = (e: ReactPointerEvent, o: Objeto) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    aoSelecionar(o.id);
    const [x0, y0] = paraCamada(e.clientX, e.clientY, o.giroDaCamada);
    let ultimo: Caixa = { x: o.x, y: o.y, l: o.l, a: o.a };
    seguirGesto(
      (ev) => {
        const [x, y] = paraCamada(ev.clientX, ev.clientY, o.giroDaCamada);
        ultimo = { x: o.x + x - x0, y: o.y + y - y0, l: o.l, a: o.a };
        setRascunho({ id: o.id, ...ultimo });
      },
      (_ev, cancelado) => {
        setRascunho(null);
        if (!cancelado && (ultimo.x !== o.x || ultimo.y !== o.y)) {
          aoAtualizar(o.id, { x: ultimo.x, y: ultimo.y });
        }
      },
    );
  };

  const iniciarRedimensionar = (e: ReactPointerEvent, o: Objeto, alca: Alca) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const [x0, y0] = paraCamada(e.clientX, e.clientY, o.giroDaCamada);
    const proporcao = o.l / Math.max(o.a, 1);
    const travada = o.tipo === "imagem" && alca.hx !== 0 && alca.hy !== 0;
    let ultimo: Caixa = { x: o.x, y: o.y, l: o.l, a: o.a };
    seguirGesto(
      (ev) => {
        const [x, y] = paraCamada(ev.clientX, ev.clientY, o.giroDaCamada);
        const dx = x - x0;
        const dy = y - y0;
        let l = o.l + alca.hx * dx;
        let a = o.a + alca.hy * dy;
        if (travada && !ev.shiftKey) {
          // Imagem pelo canto: mantém a proporção, sempre (Shift libera).
          if (Math.abs(dx) * o.a > Math.abs(dy) * o.l) a = l / proporcao;
          else l = a * proporcao;
        }
        l = Math.max(LADO_MINIMO, l);
        a = Math.max(LADO_MINIMO, a);
        const novo: Caixa = {
          x: alca.hx < 0 ? o.x + o.l - l : o.x,
          y: alca.hy < 0 ? o.y + o.a - a : o.y,
          l,
          a,
        };
        if (o.tipo === "texto") {
          novo.y = o.y;
          novo.l = Math.max(20, l);
          novo.x = alca.hx < 0 ? o.x + o.l - novo.l : o.x;
          novo.a = alturaDoTexto({ ...o, l: novo.l });
        }
        ultimo = novo;
        setRascunho({ id: o.id, ...novo });
      },
      (_ev, cancelado) => {
        setRascunho(null);
        if (!cancelado) aoAtualizar(o.id, ultimo);
      },
    );
  };

  /* ---- Ferramentas de desenho ---- */
  const iniciarDesenho = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const giro = pagina.giro;
    const [x0, y0] = paraCamada(e.clientX, e.clientY, giro);
    const base = { id: novoId("obj"), paginaId: pagina.id, giroDaCamada: giro };
    if (ferramenta === "texto") {
      const m = medidasNaTela(pagina, giro);
      const largura = Math.max(60, Math.min(260, m.largura - x0 - 8));
      setTextoNovo({
        ...base,
        tipo: "texto",
        x: x0,
        y: y0 - (estilo.tamanho * ENTRELINHA) / 2,
        l: largura,
        a: estilo.tamanho * ENTRELINHA,
        texto: "",
        familia: estilo.familia,
        tamanho: estilo.tamanho,
        cor: estilo.corDoTexto,
        negrito: estilo.negrito,
        italico: estilo.italico,
        alinhamento: estilo.alinhamento,
      });
      // A ferramenta só termina com a caixa: até lá, a barra de fonte fica à mão.
      return;
    }

    const caixaDe = (x: number, y: number): Caixa => ({
      x: Math.min(x0, x),
      y: Math.min(y0, y),
      l: Math.abs(x - x0),
      a: Math.abs(y - y0),
    });
    const montar = (x: number, y: number, pontos: [number, number][]): Objeto | null => {
      const c = caixaDe(x, y);
      switch (ferramenta) {
        case "realce":
          return { ...base, ...c, tipo: "realce", cor: estilo.corDoRealce };
        case "retangulo":
        case "elipse":
          return {
            ...base,
            ...c,
            tipo: ferramenta,
            cor: estilo.corDoTraco,
            espessura: estilo.espessura,
            preenchimento: estilo.preenchimento,
          };
        case "linha":
        case "seta": {
          const l = Math.max(c.l, 1);
          const a = Math.max(c.a, 1);
          return {
            ...base,
            ...c,
            l,
            a,
            tipo: ferramenta,
            cor: estilo.corDoTraco,
            espessura: estilo.espessura,
            pontos: [
              [(x0 - c.x) / l, (y0 - c.y) / a],
              [(x - c.x) / l, (y - c.y) / a],
            ],
          };
        }
        case "desenho": {
          const xs = pontos.map((p) => p[0]);
          const ys = pontos.map((p) => p[1]);
          const xMin = Math.min(...xs);
          const yMin = Math.min(...ys);
          const l = Math.max(Math.max(...xs) - xMin, 1);
          const a = Math.max(Math.max(...ys) - yMin, 1);
          return {
            ...base,
            x: xMin,
            y: yMin,
            l,
            a,
            tipo: "traco",
            cor: estilo.corDoTraco,
            espessura: estilo.espessura,
            pontos: pontos.map(([px, py]) => [(px - xMin) / l, (py - yMin) / a] as const),
          };
        }
        default:
          return null;
      }
    };

    const pontos: [number, number][] = [[x0, y0]];
    let ultimo: [number, number] = [x0, y0];
    seguirGesto(
      (ev) => {
        const [x, y] = paraCamada(ev.clientX, ev.clientY, giro);
        if (ferramenta === "desenho") {
          const [ax, ay] = pontos[pontos.length - 1]!;
          if (Math.hypot(x - ax, y - ay) >= DISTANCIA_MINIMA_DO_TRACO) pontos.push([x, y]);
        }
        ultimo = [x, y];
        setDesenhando(montar(x, y, pontos));
      },
      (_ev, cancelado) => {
        setDesenhando(null);
        if (cancelado) return;
        const [x, y] = ultimo;
        const moveu = Math.hypot(x - x0, y - y0) >= LADO_MINIMO;
        if (ferramenta === "desenho") {
          if (pontos.length === 1) pontos.push([x0 + 0.1, y0 + 0.1]);
        } else if (!moveu) {
          return;
        }
        const novo = montar(x, y, pontos);
        if (novo) aoAdicionar(novo);
        // Realce e desenho continuam ligados: é comum marcar várias coisas seguidas.
        if (ferramenta !== "desenho" && ferramenta !== "realce") aoTerminarFerramenta();
      },
    );
  };

  /* ---- Abrir uma linha ---- */
  const abrirLinha = (l: LinhaDeTexto) => {
    aoSelecionar(null);
    const c = caixas.get(l.id);
    const edicao = edicoesPorLinha.get(l.id);
    setCoresAbertas(
      edicao
        ? { fundo: edicao.corDeFundo, texto: edicao.corDoTexto }
        : c
          ? coresDaLinha(canvas.current, c, pagina.largura)
          : { fundo: { r: 1, g: 1, b: 1 }, texto: { r: 0, g: 0, b: 0 } },
    );
    setLinhaAberta(l);
  };

  const estiloDaCasca: CSSProperties = {
    width: tela.largura * zoom,
    height: tela.altura * zoom,
    ["--z" as string]: zoom,
    /* O CSS global do app liga "ss01", "ss02" e "cv11" para a fonte da interface. No
       Arial esses conjuntos trocam o desenho das letras (saíam largas e achatadas) e
       a largura deixa de bater com a do PDF. Aqui a letra precisa imitar o arquivo. */
    fontFeatureSettings: "normal",
    letterSpacing: 0,
    textRendering: "auto",
  };

  /* As camadas com objeto: a da página de agora, e as de quando a página tinha outro giro. */
  const giros = new Set<Giro>(objetos.map((o) => o.giroDaCamada));
  if (textoNovo) giros.add(textoNovo.giroDaCamada);
  if (desenhando) giros.add(desenhando.giroDaCamada);

  const naoCarregou = visivel && !!documento && desenhada === null;

  return (
    <div
      ref={casca}
      data-pagina={pagina.id}
      className="relative shrink-0 select-none bg-white shadow-[0_8px_30px_rgb(0_0_0/0.45)]"
      style={estiloDaCasca}
      onPointerDown={() => {
        if (ferramenta === "editar") aoSelecionar(null);
      }}
      onDragOver={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (!temArquivo(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const [x, y] = paraCamada(e.clientX, e.clientY, pagina.giro);
        aoSoltarArquivos(Array.from(e.dataTransfer.files), pagina.id, x, y);
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: pagina.largura * zoom,
          height: pagina.altura * zoom,
          transform: `translate(-50%, -50%) rotate(${pagina.giro}deg)`,
        }}
      >
        <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full bg-white" />
        {naoCarregou && (
          <div className="absolute inset-0 grid place-items-center text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          </div>
        )}

        {/* As linhas de texto que já estão no PDF. */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: pagina.largura,
            height: pagina.altura,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {linhas.map((l) => {
            const c = caixas.get(l.id);
            if (!c) return null;
            const edicao = edicoesPorLinha.get(l.id);
            const aberta = linhaAberta?.id === l.id;
            const remendo = !!edicao && !prontaAgora && !aberta;
            return (
              <button
                key={l.id}
                type="button"
                data-linha={l.id}
                tabIndex={ferramenta === "editar" ? 0 : -1}
                aria-label={`Editar o texto: ${edicao?.texto ?? l.texto}`}
                disabled={ferramenta !== "editar"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => abrirLinha(l)}
                style={{
                  ...estiloDaCaixa(c),
                  outlineWidth: "calc(1.5px / var(--z))",
                  ...(remendo && edicao
                    ? {
                        background: cssDe(edicao.corDeFundo),
                        color: cssDe(edicao.corDoTexto),
                        fontFamily: FONTE_CSS[l.familia],
                        fontSize: l.regiao.tamanho,
                        fontWeight: l.negrito ? 700 : 400,
                        fontStyle: l.italico ? "italic" : "normal",
                        lineHeight: `${c.acima + c.abaixo}px`,
                      }
                    : null),
                }}
                className={`block cursor-text overflow-visible whitespace-pre rounded-[1px] border-0 bg-transparent p-0 text-left outline-offset-1 ${
                  ferramenta === "editar"
                    ? "hover:bg-[color-mix(in_oklab,var(--acento)_16%,transparent)] hover:outline hover:outline-[var(--acento)] focus-visible:outline focus-visible:outline-[var(--acento)]"
                    : "pointer-events-none"
                }`}
              >
                {remendo ? edicao?.texto : null}
              </button>
            );
          })}
          {linhaAberta && coresAbertas && caixas.get(linhaAberta.id) && (
            <EditorDeLinha
              key={linhaAberta.id}
              caixa={caixas.get(linhaAberta.id)!}
              linha={linhaAberta}
              inicial={edicoesPorLinha.get(linhaAberta.id)?.texto ?? linhaAberta.texto}
              cores={coresAbertas}
              aoTerminar={(texto) => {
                const l = linhaAberta;
                setLinhaAberta(null);
                if (texto !== null) aoEditarLinha(pagina.id, l, texto, coresAbertas);
              }}
              aoDigitar={(texto) =>
                aoDigitar(
                  texto === null
                    ? null
                    : {
                        tipo: "linha",
                        paginaId: pagina.id,
                        linha: linhaAberta,
                        texto,
                        cores: coresAbertas,
                      },
                )
              }
            />
          )}
          <CamposDoFormulario
            campos={camposDaPagina_}
            valores={campos}
            ativo={ferramenta === "editar"}
            aoMudar={aoMudarCampo}
            aoDigitar={(nome, valor) =>
              aoDigitar(valor === null ? null : { tipo: "campo", nome, valor })
            }
          />
        </div>

        {/* Os objetos, cada um na camada do giro em que nasceu. */}
        {[...giros].map((g) => {
          const m = medidasNaTela(pagina, g);
          return (
            <div
              key={g}
              className="pointer-events-none absolute left-1/2 top-1/2"
              style={{
                width: m.largura * zoom,
                height: m.altura * zoom,
                transform: `translate(-50%, -50%) rotate(${-g}deg)`,
              }}
            >
              <div
                className="absolute left-0 top-0"
                style={{
                  width: m.largura,
                  height: m.altura,
                  transform: `scale(${zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                {objetos
                  .filter((o) => o.giroDaCamada === g)
                  .map((o) => {
                    const v = rascunho?.id === o.id ? { ...o, ...rascunho } : o;
                    const selecionadoAgora = selecionado === o.id;
                    const emEdicao = editandoTexto === o.id && o.tipo === "texto";
                    return (
                      <div
                        key={o.id}
                        data-objeto={o.tipo}
                        className="absolute"
                        style={{
                          left: v.x,
                          top: v.y,
                          width: v.l,
                          height: v.tipo === "texto" ? undefined : v.a,
                          minHeight: v.tipo === "texto" ? v.a : undefined,
                          pointerEvents: ferramenta === "editar" ? "auto" : "none",
                          cursor: emEdicao ? "text" : "move",
                        }}
                        onPointerDown={(e) => {
                          if (!emEdicao) iniciarMover(e, o);
                          else e.stopPropagation();
                        }}
                        onDoubleClick={() => {
                          if (o.tipo === "texto") setEditandoTexto(o.id);
                        }}
                      >
                        {emEdicao ? (
                          <CaixaDeTexto
                            o={v as ObjetoTexto}
                            aoDigitar={(texto) =>
                              aoDigitar(texto === null ? null : { tipo: "objeto", id: o.id, texto })
                            }
                            aoTerminar={(texto) => {
                              setEditandoTexto(null);
                              if (texto === null) return;
                              if (!texto.trim()) {
                                aoRemover(o.id);
                                return;
                              }
                              if (texto !== o.texto) {
                                aoAtualizar(o.id, {
                                  texto,
                                  a: alturaDoTexto({ ...(o as ObjetoTexto), texto }),
                                });
                              }
                            }}
                          />
                        ) : (
                          <DesenhoDoObjeto o={v} imagens={imagens} />
                        )}
                        {selecionadoAgora && !emEdicao && ferramenta === "editar" && (
                          <>
                            <div
                              aria-hidden
                              className="pointer-events-none absolute inset-0 outline outline-[var(--acento)]"
                              style={{ outlineWidth: "calc(1.5px / var(--z))" }}
                            />
                            {ALCAS.filter((al) => o.tipo !== "texto" || al.hy === 0).map((al) => (
                              <span
                                key={al.id}
                                data-alca={al.id}
                                onPointerDown={(e) => iniciarRedimensionar(e, o, al)}
                                className="absolute rounded-full border-white bg-[var(--acento)] shadow"
                                style={{
                                  width: "calc(11px / var(--z))",
                                  height: "calc(11px / var(--z))",
                                  borderWidth: "calc(1.5px / var(--z))",
                                  left: `${((al.hx + 1) / 2) * 100}%`,
                                  top: `${((al.hy + 1) / 2) * 100}%`,
                                  transform: "translate(-50%, -50%)",
                                  cursor: al.cursor,
                                }}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })}
                {textoNovo && textoNovo.giroDaCamada === g && (
                  <div
                    className="pointer-events-auto absolute"
                    style={{ left: textoNovo.x, top: textoNovo.y, width: textoNovo.l }}
                  >
                    <CaixaDeTexto
                      /* O estilo acompanha a barra enquanto se digita a caixa nova. */
                      o={{
                        ...textoNovo,
                        familia: estilo.familia,
                        tamanho: estilo.tamanho,
                        cor: estilo.corDoTexto,
                        negrito: estilo.negrito,
                        italico: estilo.italico,
                        alinhamento: estilo.alinhamento,
                      }}
                      aoDigitar={(texto) => {
                        if (texto === null || !texto.trim()) {
                          aoDigitar(null);
                          return;
                        }
                        const novo: ObjetoTexto = {
                          ...textoNovo,
                          texto,
                          familia: estilo.familia,
                          tamanho: estilo.tamanho,
                          cor: estilo.corDoTexto,
                          negrito: estilo.negrito,
                          italico: estilo.italico,
                          alinhamento: estilo.alinhamento,
                        };
                        aoDigitar({ tipo: "novo", objeto: { ...novo, a: alturaDoTexto(novo) } });
                      }}
                      aoTerminar={(texto) => {
                        const base = textoNovo;
                        setTextoNovo(null);
                        aoTerminarFerramenta();
                        if (!texto?.trim()) return;
                        const pronto: ObjetoTexto = {
                          ...base,
                          texto,
                          familia: estilo.familia,
                          tamanho: estilo.tamanho,
                          cor: estilo.corDoTexto,
                          negrito: estilo.negrito,
                          italico: estilo.italico,
                          alinhamento: estilo.alinhamento,
                        };
                        aoAdicionar({ ...pronto, a: alturaDoTexto(pronto) });
                      }}
                    />
                  </div>
                )}
                {desenhando && desenhando.giroDaCamada === g && (
                  <div
                    className="absolute"
                    style={{
                      left: desenhando.x,
                      top: desenhando.y,
                      width: desenhando.l,
                      height: desenhando.a,
                    }}
                  >
                    <DesenhoDoObjeto o={desenhando} imagens={imagens} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* A superfície das ferramentas: pega o gesto em qualquer ponto da página. */}
      {ferramenta !== "editar" && !textoNovo && (
        <div
          data-superficie
          className="absolute inset-0 z-30"
          style={{ cursor: ferramenta === "texto" ? "text" : "crosshair", touchAction: "none" }}
          onPointerDown={iniciarDesenho}
        />
      )}
    </div>
  );
}

/** `memo`: mexer num objeto de uma página não redesenha o React das outras cem. */
export const PaginaDoEditor = memo(PaginaDoEditorSemMemo);
