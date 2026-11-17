import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Minus,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { confirmar, escolher } from "@/components/confirm-dialog";
import { entregar } from "../entregar";
import { escolherArquivos } from "../escolher-arquivos";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "../falha-de-carregamento";
import { bytesDe, canvasParaBlob, liberarCanvas } from "../locais/arquivos";
import type { PedidoDeEdicao } from "../locais/editor/aplicar";
import { DocumentoAberto } from "../locais/editor/documento";
import { cabeNaFontePadrao } from "../locais/editor/fontes";
import { sobreOFormulario, type SobreOFormulario } from "../locais/editor/formulario";
import type { LinhaDeTexto } from "../locais/editor/linhas";
import type { ResumoDaTroca, Rgb } from "../locais/editor/pagina";
import { decodificarImagem, desenharImagem, ehHeic } from "../locais/imagem";
import { temArquivo } from "../so-arquivo";
import { ErroDeConversao, type Bloco } from "../tipos";
import { BOTAO_CONTORNO, BOTAO_PRINCIPAL } from "../visual";
import { QuadroDeAssinatura } from "./assinatura";
import { BarraDeEstilo, BarraDeFerramentas } from "./barras";
import { ColunaDePaginas } from "./coluna-de-paginas";
import {
  alturaDoTexto,
  chaveDaEdicao,
  comPendente,
  ESTILO_INICIAL,
  medidasNaTela,
  novoId,
  somarGiro,
  type EdicaoNoEstado,
  type Estilo,
  type EstadoDoEditor,
  type Ferramenta,
  type ImagemGuardada,
  type Objeto,
  type ObjetoTexto,
  type PaginaDoEditor as Pagina,
  type Pendente,
  type ValorDeCampo,
} from "./modelo";
import { PaginaDoEditor } from "./pagina-do-editor";
import {
  apagarRascunho,
  chaveDoArquivo,
  guardarRascunho,
  lerRascunho,
  limparVencidos,
  type ImagemDoRascunho,
  type RascunhoAchado,
} from "./rascunho";

/*
 * O Editor de PDF (05/11/2026): uma tela inteira dentro do conversor, com o visual da
 * roda. Edita o que está escrito, acrescenta texto, imagem, assinatura, realce e
 * desenho, e organiza as páginas. Roda no computador da pessoa: o PDF não sai dele.
 *
 * Ao contrário dos outros blocos, salvar NÃO volta para a roda: o Editor fica aberto
 * e a conversão roda aqui dentro. Se algo falhar, a pessoa não perde o que fez, e
 * pode salvar de novo e seguir editando.
 */

const HISTORICO_MAXIMO = 100;
const ZOOM_MINIMO = 0.3;
const ZOOM_MAXIMO = 4;
/** Lado maior de uma imagem dentro do PDF: nítida impressa em A4, sem inflar o arquivo. */
const LADO_DA_IMAGEM = 2400;

/** Mudanças do mesmo gesto, com menos que isto entre elas, contam como um passo só no desfazer. */
const AGRUPAR_POR_MS = 800;

type Historico = {
  passado: readonly EstadoDoEditor[];
  presente: EstadoDoEditor;
  futuro: readonly EstadoDoEditor[];
  /** O gesto em curso: arrastar a espessura mudaria dezenas de vezes por segundo. */
  grupo: { chave: string; em: number } | null;
};

function paginasDe(doc: DocumentoAberto, documento: number): Pagina[] {
  return doc.tamanhos.map((t, indice) => ({
    id: novoId("pag"),
    documento,
    indice,
    largura: t.largura,
    altura: t.altura,
    giro: 0,
  }));
}

function frasesDoErro(e: unknown): string {
  if (e instanceof ErroDeConversao) return e.message;
  if (ehFalhaDeCarregamento(e)) return MENSAGEM_DE_ATUALIZACAO;
  return "Não foi possível abrir este PDF.";
}

/* ---------------------------------- Abrir ------------------------------------ */

export default function EditorDePdf({
  bloco,
  arquivo,
  aoVoltar,
  aoFechar,
}: {
  bloco: Bloco;
  arquivo: File;
  aoVoltar: () => void;
  aoFechar: () => void;
}) {
  const [documento, setDocumento] = useState<DocumentoAberto | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let aberto: DocumentoAberto | null = null;
    setDocumento(null);
    setErro(null);
    DocumentoAberto.abrir(arquivo)
      .then(async (d) => {
        aberto = d;
        // Confere já no começo: PDF com bloqueio de cópia abre no pdf.js, mas não salva.
        await d.pdfLib();
        if (vivo) setDocumento(d);
        else d.fechar();
      })
      .catch((e: unknown) => {
        aberto?.fechar();
        aberto = null;
        if (vivo) setErro(frasesDoErro(e));
      });
    return () => {
      vivo = false;
      aberto?.fechar();
    };
  }, [arquivo]);

  if (!documento) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-zinc-950 text-white">
        {erro ? (
          <div className="max-w-md text-center" role="alert">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-300" aria-hidden />
            <p className="text-sm text-white/80">{erro}</p>
            <button type="button" onClick={aoVoltar} className={`mt-5 ${BOTAO_CONTORNO}`}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          </div>
        ) : (
          <div className="text-center">
            <p className="flex items-center justify-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Abrindo “{arquivo.name}”…
            </p>
            {/* PDF grande demora: quem escolheu o arquivo errado não fica preso aqui. */}
            <button type="button" onClick={aoVoltar} className={`mt-5 ${BOTAO_CONTORNO}`}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <EditorAberto
      bloco={bloco}
      arquivo={arquivo}
      principal={documento}
      aoVoltar={aoVoltar}
      aoFechar={aoFechar}
    />
  );
}

/* ---------------------------------- Editor ----------------------------------- */

function EditorAberto({
  bloco,
  arquivo,
  principal,
  aoVoltar,
  aoFechar,
}: {
  bloco: Bloco;
  arquivo: File;
  principal: DocumentoAberto;
  aoVoltar: () => void;
  aoFechar: () => void;
}) {
  const [historico, setHistorico] = useState<Historico>(() => ({
    passado: [],
    presente: { paginas: paginasDe(principal, 0), objetos: [], edicoes: {} },
    futuro: [],
    grupo: null,
  }));
  const estado = historico.presente;
  const [documentos, setDocumentos] = useState<readonly DocumentoAberto[]>([principal]);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("editar");
  const [estilo, setEstilo] = useState<Estilo>(ESTILO_INICIAL);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [paginaAtual, setPaginaAtual] = useState<string | null>(estado.paginas[0]?.id ?? null);
  const [assinando, setAssinando] = useState(false);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<EstadoDoEditor>(estado);
  const [resumos, setResumos] = useState<Readonly<Record<string, ResumoDaTroca>>>({});
  const [linhasPorPagina, setLinhasPorPagina] = useState<Readonly<Record<string, number>>>({});
  const imagens = useRef(new Map<string, ImagemGuardada>());
  const rolagem = useRef<HTMLElement>(null);
  const alterado = estado !== salvoEm;

  const aplicar = useCallback((f: (e: EstadoDoEditor) => EstadoDoEditor, grupo?: string) => {
    setHistorico((h) => {
      const novo = f(h.presente);
      if (novo === h.presente) return h;
      const agora = Date.now();
      if (grupo && h.grupo?.chave === grupo && agora - h.grupo.em < AGRUPAR_POR_MS) {
        return { ...h, presente: novo, futuro: [], grupo: { chave: grupo, em: agora } };
      }
      return {
        passado: [...h.passado.slice(-(HISTORICO_MAXIMO - 1)), h.presente],
        presente: novo,
        futuro: [],
        grupo: grupo ? { chave: grupo, em: agora } : null,
      };
    });
  }, []);
  const desfazer = useCallback(() => {
    setHistorico((h) => {
      const anterior = h.passado[h.passado.length - 1];
      if (!anterior) return h;
      return {
        passado: h.passado.slice(0, -1),
        presente: anterior,
        futuro: [h.presente, ...h.futuro],
        grupo: null,
      };
    });
    setSelecionado(null);
  }, []);
  const refazer = useCallback(() => {
    setHistorico((h) => {
      const proximo = h.futuro[0];
      if (!proximo) return h;
      return {
        passado: [...h.passado, h.presente],
        presente: proximo,
        futuro: h.futuro.slice(1),
        grupo: null,
      };
    });
    setSelecionado(null);
  }, []);

  /* A primeira medida: a página cabe na largura, sem passar de 150%. */
  useLayoutEffect(() => {
    const largura = rolagem.current?.clientWidth ?? 900;
    const maior = Math.max(...principal.tamanhos.map((t) => t.largura), 1);
    setZoom(Math.min(1.5, Math.max(ZOOM_MINIMO, (largura - 64) / maior)));
  }, [principal]);

  /* Soltar os documentos e as imagens só quando o Editor fecha DE VERDADE. Em modo dev o
     StrictMode do React desmonta e remonta na hora, para testar: fechar o PDF aí derrubava
     a tela logo depois de abrir (relato do usuário, 05/11/2026). Por isso a limpeza espera a
     volta do relógio, e a remontagem a cancela. */
  const documentosAtuais = useRef(documentos);
  useEffect(() => {
    documentosAtuais.current = documentos;
  }, [documentos]);
  const limpeza = useRef(0);
  const montado = useRef(false);
  useEffect(() => {
    montado.current = true;
    window.clearTimeout(limpeza.current);
    const guardadas = imagens.current;
    return () => {
      montado.current = false;
      limpeza.current = window.setTimeout(() => {
        for (const d of documentosAtuais.current) d.fechar();
        for (const i of guardadas.values()) URL.revokeObjectURL(i.url);
      }, 0);
    };
  }, []);

  /* ---- Rascunho (12/11/2026) ----
     O que a pessoa fez fica guardado no navegador enquanto ela edita (`rascunho.ts`): um F5 ou
     a aba fechada não perdem o trabalho, e reabrir o mesmo PDF oferece continuar. O aviso de
     sair e o rascunho contam também o que está sendo digitado num campo aberto (`pendente`),
     que ainda não entrou no estado. A gravação mora mais abaixo, junto do sair. */
  const chaveDoRascunho = useRef<string | null>(null);
  /** A procura pelo rascunho antigo terminou: antes disso, nada é gravado nem apagado. */
  const consultado = useRef(false);
  const pendente = useRef<Pendente | null>(null);
  const [achado, setAchado] = useState<RascunhoAchado | null>(null);
  const achadoAgora = useRef<RascunhoAchado | null>(null);
  achadoAgora.current = achado;
  const agendarRascunho = useRef<() => void>(() => {});
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const chave = await chaveDoArquivo(principal.bytes);
        if (!vivo) return;
        chaveDoRascunho.current = chave;
        void limparVencidos().catch(() => {});
        const r = await lerRascunho(chave);
        if (!vivo) return;
        if (r) setAchado(r);
        achadoAgora.current = r;
        consultado.current = true;
        agendarRascunho.current();
      } catch (e) {
        console.warn("[editor de PDF] rascunho indisponível", e);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [principal]);
  const esquecerRascunho = useCallback(() => {
    const chave = chaveDoRascunho.current;
    if (chave) void apagarRascunho(chave).catch(() => {});
  }, []);
  const aoDigitar = useCallback((p: Pendente | null) => {
    pendente.current = p;
    agendarRascunho.current();
  }, []);

  /* ---- Formulário (12/11/2026) ---- */
  const [formulario, setFormulario] = useState<SobreOFormulario | null>(null);
  const [travarFormulario, setTravarFormulario] = useState(false);
  const travarAgora = useRef(travarFormulario);
  travarAgora.current = travarFormulario;
  useEffect(() => {
    let vivo = true;
    principal.pdfLib().then(
      (lib) => {
        if (vivo) setFormulario(sobreOFormulario(lib));
      },
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [principal]);
  const aoMudarCampo = useCallback(
    (nome: string, valor: ValorDeCampo) =>
      aplicar((e) => ({ ...e, campos: { ...e.campos, [nome]: valor } }), `campo:${nome}`),
    [aplicar],
  );

  /* ---- Objetos ---- */
  const aoAdicionar = useCallback(
    (o: Objeto) => {
      aplicar((e) => ({ ...e, objetos: [...e.objetos, o] }));
      setSelecionado(o.tipo === "traco" || o.tipo === "realce" ? null : o.id);
    },
    [aplicar],
  );
  const aoAtualizar = useCallback(
    (id: string, novo: Partial<Objeto>, grupo?: string) =>
      aplicar(
        (e) => ({
          ...e,
          objetos: e.objetos.map((o) => (o.id === id ? ({ ...o, ...novo } as Objeto) : o)),
        }),
        grupo,
      ),
    [aplicar],
  );
  const aoRemover = useCallback(
    (id: string) => {
      aplicar((e) => ({ ...e, objetos: e.objetos.filter((o) => o.id !== id) }));
      setSelecionado((s) => (s === id ? null : s));
    },
    [aplicar],
  );

  const objetoSelecionado = useMemo(
    () => estado.objetos.find((o) => o.id === selecionado) ?? null,
    [estado.objetos, selecionado],
  );

  /* A barra mostra o estilo do que está selecionado, e mudar a barra muda o objeto. */
  const estiloVisivel = useMemo<Estilo>(() => {
    const o = objetoSelecionado;
    if (!o) return estilo;
    if (o.tipo === "texto") {
      return {
        ...estilo,
        familia: o.familia,
        tamanho: o.tamanho,
        corDoTexto: o.cor,
        negrito: o.negrito,
        italico: o.italico,
        alinhamento: o.alinhamento,
      };
    }
    if (o.tipo === "realce") return { ...estilo, corDoRealce: o.cor };
    if (o.tipo === "imagem") return estilo;
    return {
      ...estilo,
      corDoTraco: o.cor,
      espessura: o.espessura,
      preenchimento: "preenchimento" in o ? o.preenchimento : estilo.preenchimento,
    };
  }, [estilo, objetoSelecionado]);

  const aoEstilo = (novo: Partial<Estilo>) => {
    setEstilo((e) => ({ ...e, ...novo }));
    const o = objetoSelecionado;
    if (!o) return;
    // Arrastar a cor ou a espessura é um gesto só: não pode encher o histórico.
    const grupo = `estilo:${o.id}`;
    if (o.tipo === "texto") {
      const t: ObjetoTexto = {
        ...o,
        familia: novo.familia ?? o.familia,
        tamanho: novo.tamanho ?? o.tamanho,
        cor: novo.corDoTexto ?? o.cor,
        negrito: novo.negrito ?? o.negrito,
        italico: novo.italico ?? o.italico,
        alinhamento: novo.alinhamento ?? o.alinhamento,
      };
      aoAtualizar(o.id, { ...t, a: alturaDoTexto(t) }, grupo);
    } else if (o.tipo === "realce") {
      if (novo.corDoRealce) aoAtualizar(o.id, { cor: novo.corDoRealce }, grupo);
    } else if (o.tipo !== "imagem") {
      const m: { cor?: string; espessura?: number; preenchimento?: string | null } = {};
      if (novo.corDoTraco) m.cor = novo.corDoTraco;
      if (novo.espessura !== undefined) m.espessura = novo.espessura;
      if ("preenchimento" in novo && "preenchimento" in o) m.preenchimento = novo.preenchimento;
      aoAtualizar(o.id, m as Partial<Objeto>, grupo);
    }
  };

  /* ---- Linhas do PDF ---- */
  const aoEditarLinha = useCallback(
    (paginaId: string, linha: LinhaDeTexto, texto: string, cores: { fundo: Rgb; texto: Rgb }) => {
      aplicar((e) => {
        const chave = chaveDaEdicao(paginaId, linha.id);
        const atual = e.edicoes[chave];
        if ((atual?.texto ?? linha.texto) === texto) return e;
        const edicoes = { ...e.edicoes };
        if (texto === linha.texto) {
          // Voltou ao que era: não há o que trocar.
          delete edicoes[chave];
        } else {
          const nova: EdicaoNoEstado = {
            paginaId,
            linha,
            texto,
            corDeFundo: cores.fundo,
            corDoTexto: cores.texto,
          };
          edicoes[chave] = nova;
        }
        return { ...e, edicoes };
      });
    },
    [aplicar],
  );

  const aoResumo = useCallback((paginaId: string, r: ResumoDaTroca | null) => {
    setResumos((atual) => {
      if (!r && !atual[paginaId]) return atual;
      const novo = { ...atual };
      if (r) novo[paginaId] = r;
      else delete novo[paginaId];
      return novo;
    });
  }, []);
  const aoContarLinhas = useCallback((paginaId: string, n: number) => {
    setLinhasPorPagina((a) => (a[paginaId] === n ? a : { ...a, [paginaId]: n }));
  }, []);
  const aoTerminarFerramenta = useCallback(() => setFerramenta("editar"), []);

  /* ---- Imagens ---- */
  const guardarImagem = async (arquivoDaImagem: File): Promise<ImagemGuardada> => {
    const bitmap = await decodificarImagem(arquivoDaImagem);
    try {
      const comFundo = !(
        arquivoDaImagem.type === "image/png" ||
        arquivoDaImagem.type === "image/webp" ||
        /\.(png|webp)$/i.test(arquivoDaImagem.name)
      );
      const canvas = desenharImagem(bitmap, LADO_DA_IMAGEM, comFundo || ehHeic(arquivoDaImagem));
      const tipo = comFundo ? "jpg" : "png";
      const blob = await canvasParaBlob(
        canvas,
        tipo === "png" ? "image/png" : "image/jpeg",
        tipo === "png" ? undefined : 0.9,
      );
      const guardada: ImagemGuardada = {
        bytes: await bytesDe(blob),
        tipo,
        largura: canvas.width,
        altura: canvas.height,
        url: URL.createObjectURL(blob),
      };
      liberarCanvas(canvas);
      return guardada;
    } finally {
      bitmap.close();
    }
  };

  const estadoAtual = useRef(estado);
  const paginaAtualRef = useRef(paginaAtual);
  useEffect(() => {
    estadoAtual.current = estado;
    paginaAtualRef.current = paginaAtual;
  });

  const porImagem = useCallback(
    async (arquivoDaImagem: File, onde?: { paginaId: string; x: number; y: number }) => {
      try {
        const guardada = await guardarImagem(arquivoDaImagem);
        const id = novoId("img");
        imagens.current.set(id, guardada);
        const paginas = estadoAtual.current.paginas;
        const p =
          paginas.find((x) => x.id === (onde?.paginaId ?? paginaAtualRef.current)) ?? paginas[0];
        if (!p) return;
        const m = medidasNaTela(p, p.giro);
        // Entra com no máximo metade da página; a assinatura, com um terço.
        const fator = arquivoDaImagem.name === "assinatura.png" ? 0.33 : 0.5;
        const escala = Math.min(
          (m.largura * fator) / guardada.largura,
          (m.altura * fator) / guardada.altura,
          1,
        );
        const l = guardada.largura * escala;
        const a = guardada.altura * escala;
        aoAdicionar({
          id: novoId("obj"),
          paginaId: p.id,
          giroDaCamada: p.giro,
          tipo: "imagem",
          imagemId: id,
          x: onde ? onde.x - l / 2 : (m.largura - l) / 2,
          y: onde ? onde.y - a / 2 : (m.altura - a) / 2,
          l,
          a,
        });
        setFerramenta("editar");
      } catch (e) {
        toast.error(e instanceof ErroDeConversao ? e.message : "Não consegui usar esta imagem.");
      }
    },
    [aoAdicionar],
  );

  const escolherImagem = () => {
    void escolherArquivos("image/png,image/jpeg,image/webp,.heic,.heif", false).then((a) => {
      if (a[0]) void porImagem(a[0]);
    });
  };

  const aoSoltarArquivos = useCallback(
    (arquivos: File[], paginaId: string, x: number, y: number) => {
      const imagem = arquivos.find(
        (a) => a.type.startsWith("image/") || /\.(heic|heif)$/i.test(a.name),
      );
      if (imagem) void porImagem(imagem, { paginaId, x, y });
      else
        toast.info(
          "Aqui entram imagens. Para trazer páginas de outro PDF, use a coluna da esquerda.",
        );
    },
    [porImagem],
  );

  /* Colar uma imagem (um print, por exemplo). */
  useEffect(() => {
    const colar = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest?.("input, textarea")) return;
      const imagem = Array.from(e.clipboardData?.files ?? []).find((a) =>
        a.type.startsWith("image/"),
      );
      if (imagem) {
        e.preventDefault();
        void porImagem(imagem);
      }
    };
    window.addEventListener("paste", colar);
    return () => window.removeEventListener("paste", colar);
  }, [porImagem]);

  /* ---- Páginas ---- */
  const irPara = useCallback((id: string) => {
    setPaginaAtual(id);
    rolagem.current
      ?.querySelector(`[data-pagina="${id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const aoScroll = useRef(0);
  const atualizarPaginaAtual = () => {
    cancelAnimationFrame(aoScroll.current);
    aoScroll.current = requestAnimationFrame(() => {
      const raiz = rolagem.current;
      if (!raiz) return;
      const caixa = raiz.getBoundingClientRect();
      const meio = caixa.top + caixa.height / 2;
      let melhor: string | null = null;
      let menor = Number.POSITIVE_INFINITY;
      for (const el of raiz.querySelectorAll<HTMLElement>("[data-pagina]")) {
        const r = el.getBoundingClientRect();
        const d =
          meio >= r.top && meio <= r.bottom
            ? 0
            : Math.min(Math.abs(meio - r.top), Math.abs(meio - r.bottom));
        if (d < menor) {
          menor = d;
          melhor = el.dataset.pagina ?? null;
        }
      }
      if (melhor) setPaginaAtual(melhor);
    });
  };

  const inserirBranca = useCallback(() => {
    aplicar((e) => {
      const i = e.paginas.findIndex((p) => p.id === paginaAtualRef.current);
      const base = e.paginas[i] ?? e.paginas[0];
      const m = base ? medidasNaTela(base, base.giro) : { largura: 595.28, altura: 841.89 };
      const nova: Pagina = {
        id: novoId("pag"),
        documento: null,
        indice: 0,
        largura: m.largura,
        altura: m.altura,
        giro: 0,
      };
      const paginas = [...e.paginas];
      paginas.splice(i + 1, 0, nova);
      return { ...e, paginas };
    });
  }, [aplicar]);

  const importar = useCallback(() => {
    void escolherArquivos("application/pdf,.pdf", false).then(async (a) => {
      const f = a[0];
      if (!f) return;
      let d: DocumentoAberto | null = null;
      try {
        d = await DocumentoAberto.abrir(f);
        await d.pdfLib();
        if (!montado.current) {
          // O Editor fechou enquanto o arquivo abria.
          d.fechar();
          return;
        }
        const novas = paginasDe(d, documentosAtuais.current.length);
        documentosAtuais.current = [...documentosAtuais.current, d];
        setDocumentos(documentosAtuais.current);
        aplicar((e) => ({ ...e, paginas: [...e.paginas, ...novas] }));
        toast.success(
          novas.length === 1
            ? "1 página entrou no fim do documento."
            : `${novas.length} páginas entraram no fim do documento.`,
        );
      } catch (e) {
        // PDF com bloqueio abre no pdf.js e só falha no pdf-lib: o aberto precisa ser solto.
        d?.fechar();
        toast.error(frasesDoErro(e));
      }
    });
  }, [aplicar]);

  const reordenarPaginas = useCallback(
    (ids: string[]) =>
      aplicar((e) => ({
        ...e,
        paginas: ids.map((id) => e.paginas.find((p) => p.id === id)!).filter(Boolean),
      })),
    [aplicar],
  );
  const girarPagina = useCallback(
    (id: string) =>
      aplicar((e) => ({
        ...e,
        paginas: e.paginas.map((p) => (p.id === id ? { ...p, giro: somarGiro(p.giro, 90) } : p)),
      })),
    [aplicar],
  );
  const apagarPagina = useCallback(
    (id: string) => {
      const lista = estadoAtual.current.paginas;
      if (paginaAtualRef.current === id && lista.length > 1) {
        // Uma imagem colada agora cairia na página errada se a "atual" fosse a apagada.
        const i = lista.findIndex((p) => p.id === id);
        const vizinha = lista[i + 1] ?? lista[i - 1];
        if (vizinha) setPaginaAtual(vizinha.id);
      }
      aplicar((e) =>
        e.paginas.length <= 1 ? e : { ...e, paginas: e.paginas.filter((p) => p.id !== id) },
      );
      setSelecionado(null);
    },
    [aplicar],
  );

  const duplicar = useCallback(
    (id: string) => {
      aplicar((e) => {
        const i = e.paginas.findIndex((p) => p.id === id);
        const original = e.paginas[i];
        if (!original) return e;
        const copia: Pagina = { ...original, id: novoId("pag") };
        const paginas = [...e.paginas];
        paginas.splice(i + 1, 0, copia);
        const objetos = [
          ...e.objetos,
          ...e.objetos
            .filter((o) => o.paginaId === id)
            .map((o) => ({ ...o, id: novoId("obj"), paginaId: copia.id })),
        ];
        const edicoes = { ...e.edicoes };
        for (const ed of Object.values(e.edicoes)) {
          if (ed.paginaId === id) {
            edicoes[chaveDaEdicao(copia.id, ed.linha.id)] = { ...ed, paginaId: copia.id };
          }
        }
        return { ...e, paginas, objetos, edicoes };
      });
    },
    [aplicar],
  );

  /* ---- Salvar ---- */
  const salvandoAgora = useRef(false);
  /* O que o salvar vai causar e a pessoa precisa saber antes (12/11/2026): os avisos fortes do
     rodapé (assinatura digital, linha coberta, letra sem suporte, formulário XFA) e o travar do
     formulário. A pergunta volta só se a lista mudar desde a última vez que ela confirmou. */
  const avisosAoSalvar = useRef<{ textos: string[]; perigo: boolean }>({
    textos: [],
    perigo: false,
  });
  const confirmadoAoSalvar = useRef<string | null>(null);
  const perguntandoAoSalvar = useRef(false);
  const salvar = useCallback(async (): Promise<boolean> => {
    if (salvandoAgora.current || perguntandoAoSalvar.current) return false;
    const { textos, perigo } = avisosAoSalvar.current;
    const chave = textos.join("|");
    if (textos.length > 0 && chave !== confirmadoAoSalvar.current) {
      perguntandoAoSalvar.current = true;
      const seguir = await confirmar({
        titulo: "Antes de salvar",
        descricao: textos.map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(" "),
        confirmar: "Salvar assim",
        cancelar: "Voltar e revisar",
        perigo,
      }).finally(() => {
        perguntandoAoSalvar.current = false;
      });
      if (!seguir) return false;
      confirmadoAoSalvar.current = chave;
    }
    salvandoAgora.current = true;
    const atual = estadoAtual.current;
    const pedido: PedidoDeEdicao = {
      estado: atual,
      documentos: documentosAtuais.current,
      imagens: imagens.current,
      travarFormulario: travarAgora.current,
    };
    setErro(null);
    setSalvando(0);
    try {
      const resultado = await bloco.executar(
        [arquivo],
        { edicao: pedido },
        {
          /* De 2 em 2%: atualizar a cada página redesenhava a tela inteira centenas de
             vezes, e salvar um PDF de 300 páginas levava 9 segundos. */
          progresso: (f) => setSalvando((s) => (s === null ? s : f === 1 || f - s >= 0.02 ? f : s)),
        },
      );
      if (!(await entregar(resultado))) {
        setErro("O arquivo não foi salvo: veja o aviso. O que você fez continua aqui.");
        return false;
      }
      setSalvoEm(atual);
      // Salvo: o rascunho não serve mais (se a pessoa seguir editando, nasce outro).
      if (estadoAtual.current === atual && !pendente.current) esquecerRascunho();
      return true;
    } catch (e) {
      console.warn("[editor de PDF] não salvou", e);
      setErro(
        e instanceof ErroDeConversao
          ? e.message
          : ehFalhaDeCarregamento(e)
            ? MENSAGEM_DE_ATUALIZACAO
            : "Não foi possível salvar o PDF. O que você fez continua aqui: tente de novo.",
      );
      return false;
    } finally {
      salvandoAgora.current = false;
      setSalvando(null);
    }
  }, [arquivo, bloco, esquecerRascunho]);

  /* ---- Sair ---- */
  const salvoEmRef = useRef(salvoEm);
  useEffect(() => {
    salvoEmRef.current = salvoEm;
  }, [salvoEm]);
  const saindo = useRef(false);
  const sair = useCallback(
    async (depois: () => void) => {
      if (saindo.current) return;
      if (estadoAtual.current === salvoEmRef.current) {
        depois();
        return;
      }
      saindo.current = true;
      const resposta = await escolher({
        titulo: "Salvar as alterações?",
        descricao: "O que você fez neste PDF se perde se sair sem salvar.",
        confirmar: "Salvar e sair",
        alternativa: "Sair sem salvar",
        cancelar: "Continuar editando",
      });
      saindo.current = false;
      if (resposta === "alternativa") {
        esquecerRascunho();
        depois();
      }
      if (resposta === "sim" && (await salvar())) depois();
    },
    [salvar, esquecerRascunho],
  );

  /* ---- Rascunho: gravar ----
     Pouco depois de cada mudança (e na hora, ao fechar a aba). Nada mudou desde o último
     salvar: o rascunho sai. Enquanto a pessoa não decide sobre um rascunho achado, nada é
     gravado por cima dele. */
  const gravados = useRef(new Set<string>());
  const guardarAgora = useCallback(() => {
    const chave = chaveDoRascunho.current;
    if (!chave || !consultado.current || achadoAgora.current) return;
    const sujo = estadoAtual.current !== salvoEmRef.current || pendente.current !== null;
    if (!sujo) {
      // Tudo como no último salvar (ou desfeito até lá): nenhum rascunho fica para trás.
      esquecerRascunho();
      gravados.current.clear();
      return;
    }
    const estadoComPendente = comPendente(estadoAtual.current, pendente.current);
    const usadas = [
      ...new Set(
        estadoComPendente.objetos.flatMap((o) => (o.tipo === "imagem" ? [o.imagemId] : [])),
      ),
    ];
    const imagensNovas: [string, ImagemDoRascunho][] = [];
    for (const id of usadas) {
      const im = imagens.current.get(id);
      if (!im || gravados.current.has(`img:${id}`)) continue;
      imagensNovas.push([
        id,
        { bytes: im.bytes, tipo: im.tipo, largura: im.largura, altura: im.altura },
      ]);
    }
    const docs = documentosAtuais.current;
    const extrasNovos: [number, { nome: string; bytes: Uint8Array }][] = [];
    for (let i = 1; i < docs.length; i++) {
      if (!gravados.current.has(`pdf:${i}`))
        extrasNovos.push([i, { nome: docs[i]!.nome, bytes: docs[i]!.bytes }]);
    }
    void guardarRascunho(
      {
        chave,
        nome: principal.nome,
        quando: Date.now(),
        estado: estadoComPendente,
        imagens: usadas,
        extras: docs.slice(1).map((d) => d.nome),
      },
      imagensNovas,
      extrasNovos,
    ).then(
      () => {
        for (const [id] of imagensNovas) gravados.current.add(`img:${id}`);
        for (const [i] of extrasNovos) gravados.current.add(`pdf:${i}`);
      },
      (e: unknown) => console.warn("[editor de PDF] não gravei o rascunho", e),
    );
  }, [esquecerRascunho, principal]);
  const esperaDoRascunho = useRef(0);
  agendarRascunho.current = () => {
    window.clearTimeout(esperaDoRascunho.current);
    esperaDoRascunho.current = window.setTimeout(guardarAgora, 700);
  };
  useEffect(() => {
    agendarRascunho.current();
  }, [estado, documentos, salvoEm, achado]);
  useEffect(() => () => window.clearTimeout(esperaDoRascunho.current), []);

  /* Fechar a aba (ou F5) com trabalho por salvar: grava o rascunho já e o navegador pergunta. */
  useEffect(() => {
    const perguntar = (e: BeforeUnloadEvent) => {
      if (estadoAtual.current === salvoEmRef.current && pendente.current === null) return;
      guardarAgora();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", perguntar);
    window.addEventListener("pagehide", guardarAgora);
    return () => {
      window.removeEventListener("beforeunload", perguntar);
      window.removeEventListener("pagehide", guardarAgora);
    };
  }, [guardarAgora]);

  /** Continuar de onde parou: os PDFs de fora, as imagens e o estado do rascunho achado. */
  const continuarRascunho = useCallback(async () => {
    const r = achadoAgora.current;
    if (!r) return;
    try {
      const extras = await Promise.all(
        r.extras.map((e) =>
          DocumentoAberto.abrir(
            new File([e.bytes as BlobPart], e.nome, { type: "application/pdf" }),
          ),
        ),
      );
      for (const [id, im] of r.imagens) {
        const url = URL.createObjectURL(
          new Blob([im.bytes as BlobPart], {
            type: im.tipo === "png" ? "image/png" : "image/jpeg",
          }),
        );
        imagens.current.set(id, { ...im, url });
        gravados.current.add(`img:${id}`);
      }
      extras.forEach((_, i) => gravados.current.add(`pdf:${i + 1}`));
      documentosAtuais.current = [principal, ...extras];
      setDocumentos(documentosAtuais.current);
      setHistorico({ passado: [], presente: r.rascunho.estado, futuro: [], grupo: null });
      setPaginaAtual(r.rascunho.estado.paginas[0]?.id ?? null);
      setSelecionado(null);
      setAchado(null);
    } catch (e) {
      console.warn("[editor de PDF] o rascunho não abriu", e);
      toast.error("Não deu para continuar a edição anterior.", {
        description: "O PDF está aberto como estava. A edição anterior foi descartada.",
      });
      esquecerRascunho();
      setAchado(null);
    }
  }, [principal, esquecerRascunho]);

  /* ---- Teclado ----
     Na fase de subida, no `document`: os campos de texto tratam as teclas deles antes
     e param por ali. O que chega aqui não vai adiante, e os atalhos do app que está
     por baixo (Ctrl+K, por exemplo) não disparam com o Editor aberto. */
  const estadoDoTeclado = useRef({ selecionado, ferramenta, objetoSelecionado, sair, aoVoltar });
  useEffect(() => {
    estadoDoTeclado.current = { selecionado, ferramenta, objetoSelecionado, sair, aoVoltar };
  });
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"]')) return;
      if (document.querySelector("[data-quadro-assinatura]")) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const alvo = e.target as HTMLElement | null;
      const naColuna = !!document.querySelector("[data-editor-pdf] [data-arrastando-lista]");
      /* Onde se digita, as teclas são do campo. O controle de cor, de espessura ou de fonte só
         fica com o foco depois do clique: o Ctrl+Z e o Esc continuam valendo ali. */
      const noCampo = !!alvo?.closest?.('textarea, input:not([type="range"]):not([type="color"])');
      const noControle = !!alvo?.closest?.('select, input[type="range"], input[type="color"]');
      const agora = estadoDoTeclado.current;
      e.stopPropagation();

      if (ctrl && k === "s") {
        e.preventDefault();
        // Depois da volta do relógio: um campo aberto acabou de gravar o que foi digitado.
        if (!e.repeat) window.setTimeout(() => void salvar(), 0);
        return;
      }
      if (noCampo) return;
      if (naColuna) return;
      if (ctrl && k === "z" && !e.shiftKey) {
        e.preventDefault();
        desfazer();
        return;
      }
      if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        refazer();
        return;
      }
      if (ctrl && (k === "=" || k === "+")) {
        e.preventDefault();
        setZoom((z) => Math.min(ZOOM_MAXIMO, z * 1.2));
        return;
      }
      if (ctrl && k === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(ZOOM_MINIMO, z / 1.2));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (agora.selecionado) setSelecionado(null);
        else if (agora.ferramenta !== "editar") setFerramenta("editar");
        else void agora.sair(agora.aoVoltar);
        return;
      }
      // As setas e o Delete, com o foco num controle, são dele (a seta muda a espessura).
      if (noControle) return;
      const o = agora.objetoSelecionado;
      if (!o) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        aoRemover(o.id);
        return;
      }
      const passo = e.shiftKey ? 10 : 1;
      const deslocamento: Record<string, [number, number]> = {
        arrowleft: [-passo, 0],
        arrowright: [passo, 0],
        arrowup: [0, -passo],
        arrowdown: [0, passo],
      };
      const d = deslocamento[k];
      if (d) {
        e.preventDefault();
        const pagina = estadoAtual.current.paginas.find((p) => p.id === o.paginaId);
        const teta = (((pagina?.giro ?? 0) - o.giroDaCamada) * Math.PI) / 180;
        const dx = Math.round(d[0] * Math.cos(teta) + d[1] * Math.sin(teta));
        const dy = Math.round(-d[0] * Math.sin(teta) + d[1] * Math.cos(teta));
        aoAtualizar(o.id, { x: o.x + dx, y: o.y + dy });
      }
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aoAtualizar, aoRemover, desfazer, refazer, salvar]);

  /* Ctrl + rodinha: zoom, em vez do zoom da página inteira do navegador. */
  useEffect(() => {
    const raiz = rolagem.current;
    if (!raiz) return;
    const rodar = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) =>
        Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))),
      );
    };
    raiz.addEventListener("wheel", rodar, { passive: false });
    return () => raiz.removeEventListener("wheel", rodar);
  }, []);

  /* ---- Avisos ---- */
  const avisos = useMemo(() => {
    const lista: { texto: string; forte: boolean }[] = [];
    let cobertas = 0;
    let letras = 0;
    const sem = new Set<string>();
    const vivas = new Set(estado.paginas.map((p) => p.id));
    for (const [id, r] of Object.entries(resumos)) {
      if (!vivas.has(id)) continue;
      cobertas += r.cobertas;
      letras += r.letrasEmOutraFonte;
      for (const s of r.semSuporte) sem.add(s);
    }
    for (const o of estado.objetos) {
      if (o.tipo !== "texto" || !vivas.has(o.paginaId)) continue;
      for (const ch of o.texto.normalize("NFC")) {
        if (ch !== "\n" && ch !== "\r" && ch !== "\t" && !cabeNaFontePadrao(ch)) sem.add(ch);
      }
    }
    if (cobertas > 0) {
      lista.push({
        forte: true,
        texto:
          cobertas === 1
            ? "1 linha não dava para trocar direto e foi coberta: o texto antigo continua no arquivo, por baixo, e dá para copiá-lo."
            : `${cobertas} linhas não davam para trocar direto e foram cobertas: o texto antigo continua no arquivo, por baixo, e dá para copiá-lo.`,
      });
    }
    if (sem.size > 0) {
      lista.push({
        forte: true,
        texto: `Sem suporte, saem como “?”: ${[...sem].join(" ")}`,
      });
    }
    if (letras > 0) {
      lista.push({
        forte: false,
        texto:
          letras === 1
            ? "1 letra não existe na fonte deste PDF e saiu numa fonte parecida."
            : `${letras} letras não existem na fonte deste PDF e saíram numa fonte parecida.`,
      });
    }
    if (formulario?.assinado) {
      lista.push({
        forte: true,
        texto:
          "Este PDF tem assinatura digital: salvar com qualquer mudança invalida a assinatura.",
      });
    }
    if (formulario?.xfa) {
      lista.push({
        forte: true,
        texto:
          formulario.campos > 0
            ? "Formulário XFA (Adobe LiveCycle): preenchido aqui, ele passa a ser um formulário comum."
            : "Formulário XFA (Adobe LiveCycle): o Editor não preenche este tipo. Use o Adobe Reader.",
      });
    }
    return lista;
  }, [resumos, estado.paginas, estado.objetos, formulario]);
  avisosAoSalvar.current = {
    textos: [
      ...avisos.filter((a) => a.forte).map((a) => a.texto),
      ...(travarFormulario
        ? [
            "Travar o formulário é definitivo: os campos viram parte da página e ninguém mais os altera.",
          ]
        : []),
    ],
    perigo: !!formulario?.assinado || travarFormulario,
  };

  const numeroDaAtual =
    Math.max(
      0,
      estado.paginas.findIndex((p) => p.id === paginaAtual),
    ) + 1;
  const atual = estado.paginas.find((p) => p.id === paginaAtual);
  const semTexto =
    !!atual &&
    atual.documento !== null &&
    linhasPorPagina[atual.id] === 0 &&
    ferramenta === "editar";
  const objetosPorPagina = useMemo(() => {
    const m = new Map<string, Objeto[]>();
    for (const o of estado.objetos) {
      const l = m.get(o.paginaId);
      if (l) l.push(o);
      else m.set(o.paginaId, [o]);
    }
    return m;
  }, [estado.objetos]);
  const edicoesPorPagina = useMemo(() => {
    const m = new Map<string, EdicaoNoEstado[]>();
    for (const e of Object.values(estado.edicoes)) {
      const l = m.get(e.paginaId);
      if (l) l.push(e);
      else m.set(e.paginaId, [e]);
    }
    return m;
  }, [estado.edicoes]);

  return (
    <div
      data-editor-pdf
      className="absolute inset-0 flex flex-col bg-zinc-950 text-white [html.tauri-app_&]:pt-[var(--titlebar-h)]"
      onDragOver={(e) => {
        // Soltar fora de uma página não pode abrir o arquivo na janela.
        if (temArquivo(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "none";
        }
      }}
      onDrop={(e) => {
        if (temArquivo(e)) e.preventDefault();
      }}
    >
      <header className="flex items-center gap-3 border-b border-white/10 bg-zinc-900/95 px-3 py-2">
        <button
          type="button"
          onClick={() => void sair(aoVoltar)}
          aria-label="Voltar para a roda"
          title="Voltar para a roda"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="hidden w-44 min-w-0 flex-col lg:flex">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
            Editar PDF
          </span>
          <span className="truncate text-sm font-semibold" title={arquivo.name}>
            {arquivo.name}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 justify-center overflow-x-auto">
          <BarraDeFerramentas
            ferramenta={ferramenta}
            aoFerramenta={(f) => {
              setFerramenta(f);
              setSelecionado(null);
            }}
            aoImagem={escolherImagem}
            aoAssinatura={() => setAssinando(true)}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={desfazer}
            disabled={historico.passado.length === 0}
            aria-label="Desfazer"
            title="Desfazer (Ctrl+Z)"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={refazer}
            disabled={historico.futuro.length === 0}
            aria-label="Refazer"
            title="Refazer (Ctrl+Y)"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <span aria-hidden className="mx-1 h-6 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MINIMO, z / 1.2))}
            aria-label="Diminuir o zoom"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-11 text-center text-xs font-semibold tabular-nums text-white/70">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAXIMO, z * 1.2))}
            aria-label="Aumentar o zoom"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span aria-hidden className="mx-1 h-6 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando !== null}
            className={BOTAO_PRINCIPAL}
            title="Salvar (Ctrl+S)"
          >
            {salvando !== null ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {Math.round(salvando * 100)}%
              </>
            ) : (
              <>
                <Check className="h-4 w-4" /> Salvar
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => void sair(aoFechar)}
            aria-label="Fechar o conversor"
            className="ml-1 rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <BarraDeEstilo
        ferramenta={ferramenta}
        estilo={estiloVisivel}
        selecionado={objetoSelecionado}
        aoEstilo={aoEstilo}
        aoApagar={() => {
          if (selecionado) aoRemover(selecionado);
        }}
      />

      {achado && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-amber-300/30 bg-amber-400/15 px-4 py-2 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <span className="min-w-0 flex-1 text-white/85">
            Há uma edição deste PDF que não foi salva, de{" "}
            {new Date(achado.rascunho.quando).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Continuar de onde parou?
          </span>
          <button
            type="button"
            onClick={() => void continuarRascunho()}
            className={BOTAO_PRINCIPAL}
          >
            Continuar de onde parou
          </button>
          <button
            type="button"
            onClick={() => {
              esquecerRascunho();
              setAchado(null);
            }}
            className={BOTAO_CONTORNO}
          >
            Descartar
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <ColunaDePaginas
          paginas={estado.paginas}
          documentos={documentos}
          atual={paginaAtual}
          aoIr={irPara}
          aoReordenar={reordenarPaginas}
          aoGirar={girarPagina}
          aoDuplicar={duplicar}
          aoApagar={apagarPagina}
          aoInserirBranca={inserirBranca}
          aoImportar={importar}
        />
        <main
          ref={rolagem}
          onScroll={atualizarPaginaAtual}
          className="min-w-0 flex-1 overflow-auto bg-black/40"
          aria-label="Páginas do PDF"
        >
          <div className="flex min-w-fit flex-col items-center gap-5 px-8 py-6">
            {estado.paginas.map((p) => (
              <PaginaDoEditor
                key={p.id}
                pagina={p}
                documento={p.documento === null ? null : (documentos[p.documento] ?? null)}
                zoom={zoom}
                ferramenta={ferramenta}
                estilo={estilo}
                objetos={objetosPorPagina.get(p.id) ?? NENHUM_OBJETO}
                edicoes={edicoesPorPagina.get(p.id) ?? NENHUMA_EDICAO}
                imagens={imagens.current}
                selecionado={objetoSelecionado?.paginaId === p.id ? selecionado : null}
                raiz={rolagem}
                aoSelecionar={setSelecionado}
                aoAdicionar={aoAdicionar}
                aoAtualizar={aoAtualizar}
                aoRemover={aoRemover}
                aoEditarLinha={aoEditarLinha}
                aoTerminarFerramenta={aoTerminarFerramenta}
                aoSoltarArquivos={aoSoltarArquivos}
                aoResumo={aoResumo}
                aoContarLinhas={aoContarLinhas}
                campos={estado.campos ?? NENHUM_CAMPO}
                aoMudarCampo={aoMudarCampo}
                aoDigitar={aoDigitar}
              />
            ))}
          </div>
        </main>
      </div>

      <footer className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-zinc-900/95 px-4 py-1.5 text-xs text-white/55">
        <span className="tabular-nums">
          Página {numeroDaAtual} de {estado.paginas.length}
        </span>
        {semTexto && (
          <span className="text-white/70">
            {formulario && formulario.campos > 0
              ? "Esta página não tem texto para editar. Os campos do formulário se preenchem clicando neles."
              : "Esta página não tem texto para editar (parece escaneada). Dá para escrever por cima com a ferramenta Texto."}
          </span>
        )}
        {avisos.map((a) => (
          <span key={a.texto} className={a.forte ? "text-amber-300" : "text-white/70"}>
            {a.texto}
          </span>
        ))}
        {erro && (
          <span role="alert" className="font-semibold text-red-300">
            {erro}
          </span>
        )}
        <span className="flex-1" />
        {!!formulario && formulario.campos > 0 && (
          <label
            className="flex cursor-pointer items-center gap-1.5 text-white/70"
            title="Os campos viram parte da página: ninguém mais altera o que foi preenchido."
          >
            <input
              type="checkbox"
              checked={travarFormulario}
              onChange={(e) => setTravarFormulario(e.target.checked)}
              className="accent-[var(--acento)]"
            />
            Travar o formulário ao salvar
          </label>
        )}
        <span className={alterado ? "text-white/70" : "text-white/40"}>
          {alterado ? "Alterações por salvar" : "Tudo salvo"}
        </span>
      </footer>

      {assinando && (
        <QuadroDeAssinatura
          aoFechar={() => setAssinando(false)}
          aoUsar={(a) => {
            setAssinando(false);
            void porImagem(a);
          }}
        />
      )}
    </div>
  );
}

/* Sempre o mesmo vazio: uma lista nova a cada desenho derrubaria o `memo` das páginas. */
const NENHUM_OBJETO: readonly Objeto[] = [];
const NENHUMA_EDICAO: readonly EdicaoNoEstado[] = [];
const NENHUM_CAMPO: Readonly<Record<string, ValorDeCampo>> = {};
