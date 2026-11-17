import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { DndContext, type UniqueIdentifier } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Check,
  GripVertical,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { formatBytes } from "@/lib/attachments";
import { useArrasteDeLinhas } from "@/components/arraste";
import {
  aceitaArquivo,
  acceptDoSeletor,
  extensaoDe,
  LIMITE_LOCAL_BYTES,
  oQueAceita,
} from "./blocos";
import { escolherArquivos } from "./escolher-arquivos";
import { ehFalhaDeCarregamento, MENSAGEM_DE_ATUALIZACAO } from "./falha-de-carregamento";
import type { PdfAberto } from "./locais/miniaturas";
import type { LeitorDePrevias } from "./locais/previas";
import { useBloquearPrevia, useLeitorDePrevias, usePreviaLateral } from "./previa-contexto";
import { PreviaNoPainel } from "./previa-lateral";
import type {
  AbasDoExcel,
  Bloco,
  FormatoDeImagem,
  IdiomaDoOcr,
  NivelDeCompressao,
  OpcoesDoBloco,
} from "./tipos";
import {
  ATALHO_PEQUENO,
  BOTAO_CONTORNO,
  BOTAO_DISCRETO,
  BOTAO_PRINCIPAL,
  BRILHO_DO_ESCOLHIDO,
  SUPERFICIE,
} from "./visual";

/*
 * As telas intermediárias da paleta (04/11/2026): o que a pessoa decide entre
 * escolher o arquivo e converter. Carregadas sob demanda — só quem usa um
 * destes blocos baixa o dnd-kit da lista e o pdf.js das miniaturas.
 *
 * Desde 05/11/2026 têm o visual da roda: vidro escuro, texto branco, peças
 * arredondadas e a cor de destaque (`--acento`) no que está escolhido e na ação
 * principal — ver `visual.ts`. O cabeçalho (grupo, nome, "de → para") e a moldura
 * ficam em `paleta-de-conversao.tsx`; aqui mora só o miolo de cada tela.
 */

type PropsDaEtapa = {
  bloco: Bloco;
  arquivos: File[];
  aoTrocarArquivos: (arquivos: File[]) => void;
  aoVoltar: () => void;
  aoConverter: (opcoes: OpcoesDoBloco) => void;
  /** Há escolhas que fechar a tela perderia (páginas marcadas, giros): o conversor pergunta antes. */
  aoSujar?: (sujo: boolean) => void;
};

export default function Etapa(props: PropsDaEtapa) {
  switch (props.bloco.etapa) {
    case "ordenar":
      return <EtapaOrdenar {...props} />;
    case "paginas":
      return <EtapaPaginas {...props} modo="separar" />;
    case "girar":
      return <EtapaPaginas {...props} modo="girar" />;
    case "formato":
      return <EtapaFormato {...props} />;
    case "nivel":
      return <EtapaNivel {...props} />;
    case "idioma":
      return <EtapaIdioma {...props} />;
    case "abas":
      return <EtapaAbas {...props} />;
    default:
      return null;
  }
}

/* --------------------------------- Rodapé --------------------------------- */

function Rodape({
  aoVoltar,
  principal,
  desabilitado,
  aoConfirmar,
  extra,
}: {
  aoVoltar: () => void;
  principal: string;
  desabilitado?: boolean;
  aoConfirmar: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
      <button type="button" onClick={aoVoltar} className={BOTAO_DISCRETO}>
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>
      {extra}
      <button
        type="button"
        onClick={aoConfirmar}
        disabled={desabilitado}
        className={`ml-auto ${BOTAO_PRINCIPAL}`}
      >
        <Check className="h-4 w-4" /> {principal}
      </button>
    </div>
  );
}

/* ------------------------- Ordenar (Juntar, Imagens) ------------------------- */

/* Id estável por arquivo: o índice muda quando a lista é reordenada. */
const idsDosArquivos = new WeakMap<File, string>();
let proximoId = 0;
function idDoArquivo(f: File): string {
  let id = idsDosArquivos.get(f);
  if (!id) {
    id = `arquivo-${++proximoId}`;
    idsDosArquivos.set(f, id);
  }
  return id;
}

function EtapaOrdenar({ bloco, arquivos, aoTrocarArquivos, aoVoltar, aoConverter }: PropsDaEtapa) {
  const juntar = bloco.id === "juntar-pdfs";
  const minimo = juntar ? 2 : 1;
  const maximo = bloco.maximo ?? Number.POSITIVE_INFINITY;
  const [aviso, setAviso] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  /* A prévia grande de cada linha (a 1ª página do PDF, a imagem inteira) abre ao passar o
     mouse — e não abre enquanto uma linha é arrastada, que passa por cima das outras. */
  const leitor = useLeitorDePrevias();
  useBloquearPrevia(arrastando);
  const ids = arquivos.map(idDoArquivo);
  const nomeDe = (id: UniqueIdentifier) =>
    arquivos.find((f) => idDoArquivo(f) === id)?.name ?? "arquivo";

  const contexto = useArrasteDeLinhas((id, sobre) => {
    aoTrocarArquivos(arrayMove(arquivos, ids.indexOf(id), ids.indexOf(sobre)));
  });

  const adicionar = async () => {
    const escolhidos = await escolherArquivos(acceptDoSeletor(bloco), true);
    if (escolhidos.length === 0) return;
    /* As mesmas conferências de tipo e de tamanho de quando o arquivo chega ao
       bloco: sem elas, um PDF de 600 MB entrava na lista e era lido inteiro na
       memória da aba, e um arquivo do tipo errado sumia sem aviso. */
    const novos = escolhidos.filter((f) => aceitaArquivo(bloco, f) && f.size <= LIMITE_LOCAL_BYTES);
    const fora = escolhidos.length - novos.length;
    const todos = [...arquivos, ...novos];
    const avisos: string[] = [];
    if (fora > 0) {
      avisos.push(
        `${fora === 1 ? "Um arquivo ficou" : `${fora} arquivos ficaram`} de fora: aqui entram ${oQueAceita(bloco)} de até 200 MB.`,
      );
    }
    if (todos.length > maximo) {
      avisos.push(
        `No máximo ${maximo} arquivos de uma vez — os ${todos.length - maximo} últimos ficaram de fora.`,
      );
    }
    setAviso(avisos.length > 0 ? avisos.join(" ") : null);
    if (novos.length > 0) aoTrocarArquivos(todos.slice(0, maximo));
  };

  return (
    /* `data-arrastando-lista`: a paleta olha isto no Esc. O Radix escuta o Esc antes do
       dnd-kit e fecharia a paleta inteira, perdendo a lista, em vez de só cancelar o arraste
       — que é o que a instrução lida em voz alta promete ("Esc cancela"). */
    <div data-arrastando-lista={arrastando ? "" : undefined}>
      <p className="mb-3 text-sm text-white/65">
        {juntar
          ? "Arraste para pôr os PDFs na ordem em que devem ficar no arquivo final."
          : "Arraste para pôr as imagens na ordem das páginas. Cada imagem vira uma página A4."}
      </p>
      <DndContext
        {...contexto}
        onDragStart={() => setArrastando(true)}
        onDragEnd={(e) => {
          setArrastando(false);
          contexto.onDragEnd?.(e);
        }}
        onDragCancel={() => setArrastando(false)}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Para pegar o arquivo, aperte espaço. Com ele na mão, as setas movem; espaço de novo solta, e Esc cancela.",
          },
          announcements: {
            onDragStart: ({ active }) => `Pegou ${nomeDe(active.id)}.`,
            onDragOver: ({ active, over }) =>
              over ? `${nomeDe(active.id)} sobre ${nomeDe(over.id)}.` : undefined,
            onDragEnd: ({ active }) => `${nomeDe(active.id)} solto.`,
            onDragCancel: ({ active }) => `Cancelado. ${nomeDe(active.id)} voltou ao lugar.`,
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {arquivos.map((f, i) => (
              <LinhaDoArquivo
                key={ids[i]}
                id={ids[i]!}
                posicao={i + 1}
                arquivo={f}
                leitor={leitor}
                ehPdf={juntar}
                aoTirar={() => aoTrocarArquivos(arquivos.filter((x) => x !== f))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {aviso && <p className="mt-3 text-xs text-amber-300">{aviso}</p>}
      <Rodape
        aoVoltar={aoVoltar}
        principal={
          juntar
            ? `Juntar ${arquivos.length} PDFs`
            : `Gerar PDF com ${arquivos.length} ${arquivos.length === 1 ? "imagem" : "imagens"}`
        }
        desabilitado={arquivos.length < minimo}
        aoConfirmar={() => aoConverter({})}
        extra={
          arquivos.length < maximo ? (
            <button type="button" onClick={() => void adicionar()} className={BOTAO_CONTORNO}>
              <Plus className="h-4 w-4" /> Adicionar
            </button>
          ) : undefined
        }
      />
      {juntar && arquivos.length < 2 && (
        <p className="mt-3 text-xs text-white/50">Junte pelo menos dois PDFs.</p>
      )}
    </div>
  );
}

function LinhaDoArquivo({
  id,
  posicao,
  arquivo,
  leitor,
  ehPdf,
  aoTirar,
}: {
  id: string;
  posicao: number;
  arquivo: File;
  leitor: LeitorDePrevias | null;
  ehPdf: boolean;
  aoTirar: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: "arquivo" },
  });
  const previa = usePreviaLateral(id);
  return (
    <li
      ref={setNodeRef}
      {...previa.props}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        ...(isDragging
          ? { boxShadow: "0 0 0 2px var(--acento), 0 18px 44px rgb(0 0 0 / 0.5)" }
          : null),
      }}
      className={`flex items-center gap-3 px-3 py-2.5 text-sm text-white ${SUPERFICIE} ${
        isDragging ? "relative z-10 bg-white/15" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Mover ${arquivo.name}`}
        className="cursor-grab touch-none rounded-full p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span
        aria-hidden
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-white/80"
      >
        {posicao}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium" title={arquivo.name}>
        {arquivo.name}
      </span>
      <span className="shrink-0 text-xs text-white/45">{formatBytes(arquivo.size)}</span>
      <button
        type="button"
        onClick={aoTirar}
        aria-label={`Tirar ${arquivo.name} da lista`}
        className="rounded-full p-1.5 text-white/45 transition hover:bg-white/10 hover:text-red-300"
      >
        <X className="h-4 w-4" />
      </button>
      {previa.ativo && leitor && !isDragging && (
        <PreviaNoPainel
          legenda={arquivo.name}
          chave={id}
          carregar={(caixa, sinal) =>
            ehPdf
              ? leitor.primeiraPagina(arquivo, caixa, sinal)
              : leitor.imagem(arquivo, caixa, sinal)
          }
        />
      )}
    </li>
  );
}

/* ------------------------ Páginas (Separar e Girar) ------------------------ */

const LARGURA_DA_MINIATURA = 112;

function EtapaPaginas({
  arquivos,
  aoVoltar,
  aoConverter,
  aoSujar,
  modo,
}: PropsDaEtapa & { modo: "separar" | "girar" }) {
  const arquivo = arquivos[0]!;
  const [pdf, setPdf] = useState<PdfAberto | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhidas, setEscolhidas] = useState<Set<number>>(() => new Set());
  const [modoDeSeparar, setModoDeSeparar] = useState<"um-pdf" | "um-por-pagina">("um-pdf");
  const [giros, setGiros] = useState<Record<number, number>>({});
  const rolagem = useRef<HTMLDivElement>(null);
  // Páginas marcadas ou giradas: fechar a tela agora perderia esse trabalho.
  useEffect(() => {
    aoSujar?.(escolhidas.size > 0 || Object.values(giros).some((g) => g % 360 !== 0));
  }, [escolhidas, giros, aoSujar]);

  useEffect(() => {
    let vivo = true;
    let aberto: PdfAberto | null = null;
    setPdf(null);
    setErro(null);
    import("./locais/miniaturas")
      .then((m) => m.abrirPdf(arquivo))
      .then((p) => {
        aberto = p;
        if (vivo) setPdf(p);
        else p.fechar();
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setErro(
          ehFalhaDeCarregamento(e)
            ? MENSAGEM_DE_ATUALIZACAO
            : e instanceof Error
              ? e.message
              : "Não consegui abrir o PDF.",
        );
      });
    return () => {
      vivo = false;
      aberto?.fechar();
    };
  }, [arquivo]);

  const total = pdf?.paginas ?? 0;
  const indices = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  const alternar = (i: number) =>
    setEscolhidas((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const girar = (i: number, graus: 90 | -90) =>
    setGiros((g) => ({ ...g, [i]: ((((g[i] ?? 0) + graus) % 360) + 360) % 360 }));
  const girarTodas = (graus: 90 | -90) =>
    setGiros((g) =>
      Object.fromEntries(indices.map((i) => [i, ((((g[i] ?? 0) + graus) % 360) + 360) % 360])),
    );

  const giradas = Object.values(giros).filter((g) => g !== 0).length;

  const confirmar = () => {
    if (modo === "separar") {
      aoConverter({ paginas: [...escolhidas].sort((a, b) => a - b), modoDeSeparar });
    } else {
      const soGiradas = Object.fromEntries(
        Object.entries(giros).filter(([, g]) => g !== 0),
      ) as Record<number, 90 | 180 | 270>;
      aoConverter({ giros: soGiradas });
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-white/65" title={arquivo.name}>
          {modo === "separar"
            ? "Marque as páginas que vão para o novo PDF."
            : "Gire cada página nos botões dela, ou todas de uma vez."}
        </span>
        {pdf && modo === "separar" && (
          <>
            <button
              type="button"
              onClick={() => setEscolhidas(new Set(indices))}
              className={`${ATALHO_PEQUENO} text-[var(--acento)]`}
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => setEscolhidas(new Set())}
              className={`${ATALHO_PEQUENO} text-white/55 hover:text-white`}
            >
              Nenhuma
            </button>
          </>
        )}
        {pdf && modo === "girar" && (
          <>
            <button
              type="button"
              onClick={() => girarTodas(-90)}
              className={`${ATALHO_PEQUENO} text-white/55 hover:text-white`}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Todas
            </button>
            <button
              type="button"
              onClick={() => girarTodas(90)}
              className={`${ATALHO_PEQUENO} text-[var(--acento)]`}
            >
              <RotateCw className="h-3.5 w-3.5" /> Todas
            </button>
          </>
        )}
      </div>

      <div
        ref={rolagem}
        className="max-h-[48vh] min-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-3"
      >
        {erro ? (
          <p className="py-8 text-center text-sm text-red-300">{erro}</p>
        ) : !pdf ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Abrindo as páginas…
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {indices.map((i) => (
              <Miniatura
                key={i}
                pdf={pdf}
                indice={i}
                raiz={rolagem}
                modo={modo}
                escolhida={escolhidas.has(i)}
                giro={giros[i] ?? 0}
                aoAlternar={() => alternar(i)}
                aoGirar={(g) => girar(i, g)}
              />
            ))}
          </ul>
        )}
      </div>

      {modo === "separar" && pdf && (
        <fieldset className="mt-4 flex flex-wrap gap-2 text-sm">
          <legend className="sr-only">Como separar</legend>
          {(
            [
              ["um-pdf", "Um PDF só com as escolhidas"],
              ["um-por-pagina", "Um arquivo por página"],
            ] as const
          ).map(([valor, rotulo]) => (
            <label
              key={valor}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 transition ${
                modoDeSeparar === valor
                  ? "border-[var(--acento)] bg-white/10 text-white"
                  : "border-white/15 text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              <input
                type="radio"
                name="modo-de-separar"
                value={valor}
                checked={modoDeSeparar === valor}
                onChange={() => setModoDeSeparar(valor)}
                className="accent-[var(--acento)]"
              />
              {rotulo}
            </label>
          ))}
        </fieldset>
      )}

      <Rodape
        aoVoltar={aoVoltar}
        principal={
          modo === "separar"
            ? `Separar ${escolhidas.size} ${escolhidas.size === 1 ? "página" : "páginas"}`
            : giradas > 0
              ? `Salvar com ${giradas} ${giradas === 1 ? "página girada" : "páginas giradas"}`
              : "Salvar"
        }
        desabilitado={!pdf || (modo === "separar" ? escolhidas.size === 0 : giradas === 0)}
        aoConfirmar={confirmar}
      />
    </div>
  );
}

function Miniatura({
  pdf,
  indice,
  raiz,
  modo,
  escolhida,
  giro,
  aoAlternar,
  aoGirar,
}: {
  pdf: PdfAberto;
  indice: number;
  raiz: RefObject<HTMLDivElement | null>;
  modo: "separar" | "girar";
  escolhida: boolean;
  giro: number;
  aoAlternar: () => void;
  aoGirar: (graus: 90 | -90) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pronta, setPronta] = useState(false);
  const previa = usePreviaLateral(`pagina-${indice}`);

  /* Desenha quando entra na área visível (com folga), uma vez. */
  useEffect(() => {
    const alvo = canvas.current;
    if (!alvo) return;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        pdf
          .desenhar(indice, alvo, LARGURA_DA_MINIATURA)
          .then(() => setPronta(true))
          .catch(() => setPronta(true));
      },
      { root: raiz.current, rootMargin: "200px" },
    );
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [pdf, indice, raiz]);

  /* Deitada (90° ou 270°), a página fica mais larga que o quadro: encolhe um
     pouco para caber inteira. A folha segue branca: é a página do PDF. */
  const deitada = giro === 90 || giro === 270;
  const pagina = (
    <span className="relative grid h-40 w-full place-items-center overflow-hidden">
      <canvas
        ref={canvas}
        className={`rounded-sm bg-white shadow-md transition-transform duration-200 ${
          pronta ? "" : "h-36 w-28 animate-pulse bg-white/15"
        }`}
        style={{
          transform: giro ? `rotate(${giro}deg)${deitada ? " scale(0.72)" : ""}` : undefined,
        }}
      />
    </span>
  );

  /* A página grande, ao lado do painel, enquanto o mouse (ou o foco) está neste cartão. Acompanha
     o giro ao vivo, e usa a miniatura esticada até a página grande ficar pronta. */
  const paginaGrande = previa.ativo && (
    <PreviaNoPainel
      legenda={`Página ${indice + 1} de ${pdf.paginas}`}
      chave={`${indice}|${giro}`}
      miniatura={pronta ? canvas.current : null}
      giro={giro}
      carregar={(caixa, sinal) => pdf.desenharGrande(indice, caixa, giro, sinal)}
    />
  );

  if (modo === "separar") {
    return (
      <li {...previa.props}>
        <button
          type="button"
          onClick={aoAlternar}
          aria-pressed={escolhida}
          aria-label={`Página ${indice + 1}`}
          style={escolhida ? BRILHO_DO_ESCOLHIDO : undefined}
          className={`relative flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 p-2 transition ${
            escolhida
              ? "border-[var(--acento)] bg-white/10"
              : "border-transparent bg-white/[0.05] hover:border-white/20 hover:bg-white/[0.08]"
          }`}
        >
          {pagina}
          <span className="text-xs font-semibold text-white/55">{indice + 1}</span>
          {escolhida && (
            <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-[var(--acento)] text-neutral-950 shadow">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
        {paginaGrande}
      </li>
    );
  }

  return (
    <li
      {...previa.props}
      style={giro ? BRILHO_DO_ESCOLHIDO : undefined}
      className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-2 transition ${
        giro ? "border-[var(--acento)] bg-white/10" : "border-transparent bg-white/[0.05]"
      }`}
    >
      {pagina}
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => aoGirar(-90)}
          aria-label={`Girar a página ${indice + 1} para a esquerda`}
          className="rounded-full p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 text-center text-xs font-semibold text-white/55">{indice + 1}</span>
        <button
          type="button"
          onClick={() => aoGirar(90)}
          aria-label={`Girar a página ${indice + 1} para a direita`}
          className="rounded-full p-1.5 text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      </span>
      {paginaGrande}
    </li>
  );
}

/* ------------------------- Formato (Converter imagem) ------------------------- */

const FORMATOS: { id: FormatoDeImagem; rotulo: string; dica: string }[] = [
  { id: "jpg", rotulo: "JPG", dica: "Foto. É o que todo programa abre." },
  { id: "png", rotulo: "PNG", dica: "Sem perda, e guarda a transparência." },
  { id: "webp", rotulo: "WebP", dica: "Leve, mas programa antigo pode não abrir." },
];

function EtapaFormato({ arquivos, aoVoltar, aoConverter }: PropsDaEtapa) {
  const arquivo = arquivos[0]!;
  const origem = extensaoDe(arquivo.name).replace("jpeg", "jpg");
  const [formato, setFormato] = useState<FormatoDeImagem>(origem === "jpg" ? "png" : "jpg");
  const leitor = useLeitorDePrevias();
  const previa = usePreviaLateral("arquivo-do-formato");
  return (
    <div>
      <p className="mb-4 truncate text-sm text-white/65" title={arquivo.name}>
        Converter {/* A imagem inteira, ao lado do painel, ao passar o mouse no nome. */}
        <span
          {...previa.props}
          className="font-semibold text-white decoration-white/35 decoration-dotted underline-offset-4 hover:underline"
        >
          {arquivo.name}
        </span>{" "}
        para:
      </p>
      {previa.ativo && leitor && (
        <PreviaNoPainel
          legenda={arquivo.name}
          chave="arquivo-do-formato"
          carregar={(caixa, sinal) => leitor.imagem(arquivo, caixa, sinal)}
        />
      )}
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="sr-only">Formato de saída</legend>
        {FORMATOS.map((f) => {
          const igual = f.id === origem;
          const escolhido = formato === f.id;
          return (
            <label
              key={f.id}
              style={escolhido ? BRILHO_DO_ESCOLHIDO : undefined}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 transition ${
                escolhido
                  ? "border-[var(--acento)] bg-white/10"
                  : "border-white/10 bg-white/[0.06] hover:bg-white/10"
              } ${igual ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <input
                  type="radio"
                  name="formato"
                  value={f.id}
                  checked={escolhido}
                  disabled={igual}
                  onChange={() => setFormato(f.id)}
                  className="accent-[var(--acento)]"
                />
                {f.rotulo}
              </span>
              <span className="text-xs leading-snug text-white/55">
                {igual ? "É o formato que já está." : f.dica}
              </span>
            </label>
          );
        })}
      </fieldset>
      <Rodape
        aoVoltar={aoVoltar}
        principal={`Converter para ${formato.toUpperCase()}`}
        aoConfirmar={() => aoConverter({ formato })}
      />
    </div>
  );
}

/* ------------------- Escolha em cartões (nível, idioma, abas) ------------------- */

type Opcao<T extends string> = { id: T; rotulo: string; dica: string };

/**
 * A tela de uma escolha só, em cartões: o nome do arquivo (com a primeira página ao lado,
 * ao passar o mouse), as opções e o rodapé. É a do Comprimir, a do idioma do OCR e a das
 * abas do PDF → Excel.
 */
function EscolhaEmCartoes<T extends string>({
  arquivo,
  verbo,
  legenda,
  opcoes,
  inicial,
  chave,
  principal,
  aoVoltar,
  aoConfirmar,
}: {
  arquivo: File;
  /** "Comprimir", "Ler", "Converter": a primeira palavra da frase do alto. */
  verbo: string;
  legenda: string;
  opcoes: Opcao<T>[];
  inicial: T;
  chave: string;
  principal: (escolhido: T) => string;
  aoVoltar: () => void;
  aoConfirmar: (escolhido: T) => void;
}) {
  const [escolhido, setEscolhido] = useState<T>(inicial);
  const leitor = useLeitorDePrevias();
  const previa = usePreviaLateral(chave);
  return (
    <div>
      <p className="mb-4 truncate text-sm text-white/65" title={arquivo.name}>
        {verbo} {/* A primeira página, ao lado do painel, ao passar o mouse no nome. */}
        <span
          {...previa.props}
          className="font-semibold text-white decoration-white/35 decoration-dotted underline-offset-4 hover:underline"
        >
          {arquivo.name}
        </span>{" "}
        <span className="text-white/45">({formatBytes(arquivo.size)})</span>
      </p>
      {previa.ativo && leitor && (
        <PreviaNoPainel
          legenda={arquivo.name}
          chave={chave}
          carregar={(caixa, sinal) => leitor.primeiraPagina(arquivo, caixa, sinal)}
        />
      )}
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{legenda}</legend>
        {opcoes.map((o) => {
          const marcado = escolhido === o.id;
          return (
            <label
              key={o.id}
              style={marcado ? BRILHO_DO_ESCOLHIDO : undefined}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 transition ${
                marcado
                  ? "border-[var(--acento)] bg-white/10"
                  : "border-white/10 bg-white/[0.06] hover:bg-white/10"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <input
                  type="radio"
                  name={chave}
                  value={o.id}
                  checked={marcado}
                  onChange={() => setEscolhido(o.id)}
                  className="accent-[var(--acento)]"
                />
                {o.rotulo}
              </span>
              <span className="text-xs leading-snug text-white/55">{o.dica}</span>
            </label>
          );
        })}
      </fieldset>
      <Rodape
        aoVoltar={aoVoltar}
        principal={principal(escolhido)}
        aoConfirmar={() => aoConfirmar(escolhido)}
      />
    </div>
  );
}

/* ------------------------- Nível (Comprimir PDF) ------------------------- */

const NIVEIS: Opcao<NivelDeCompressao>[] = [
  {
    id: "leve",
    rotulo: "Leve",
    dica: "Mantém o texto e as páginas como estão. Regrava menores só as fotos e digitalizações de dentro.",
  },
  {
    id: "forte",
    rotulo: "Forte",
    dica: "Cada página vira uma imagem: encolhe muito, mas o texto deixa de ser selecionável e links e campos somem.",
  },
];

function EtapaNivel({ arquivos, aoVoltar, aoConverter }: PropsDaEtapa) {
  return (
    <EscolhaEmCartoes
      arquivo={arquivos[0]!}
      verbo="Comprimir"
      legenda="Quanto comprimir"
      opcoes={NIVEIS}
      inicial="leve"
      chave="arquivo-do-nivel"
      principal={(n) => (n === "forte" ? "Comprimir no Forte" : "Comprimir")}
      aoVoltar={aoVoltar}
      aoConfirmar={(n) => aoConverter({ nivelDeCompressao: n })}
    />
  );
}

/* ------------------------------ Idioma (OCR) ------------------------------ */

const IDIOMAS: Opcao<IdiomaDoOcr>[] = [
  {
    id: "por",
    rotulo: "Português",
    dica: "O jeito de sempre: lê melhor e mais rápido o documento em português.",
  },
  {
    id: "por+eng",
    rotulo: "Português e inglês",
    dica: "Para documento com termos técnicos ou trechos em inglês. Um pouco mais lento.",
  },
];

function EtapaIdioma({ arquivos, aoVoltar, aoConverter }: PropsDaEtapa) {
  return (
    <EscolhaEmCartoes
      arquivo={arquivos[0]!}
      verbo="Ler"
      legenda="Idioma do documento"
      opcoes={IDIOMAS}
      inicial="por"
      chave="arquivo-do-idioma"
      principal={() => "Ler o PDF"}
      aoVoltar={aoVoltar}
      aoConfirmar={(i) => aoConverter({ idiomaDoOcr: i })}
    />
  );
}

/* --------------------------- Abas (PDF → Excel) --------------------------- */

const ABAS: Opcao<AbasDoExcel>[] = [
  {
    id: "por-pagina",
    rotulo: "Uma aba por página",
    dica: "Cada página fica na sua aba. Bom para formulários e páginas diferentes entre si.",
  },
  {
    id: "uma-so",
    rotulo: "Tudo numa aba",
    dica: "Um relatório de várias páginas vira uma tabela só, sem o cabeçalho e o rodapé repetidos.",
  },
];

function EtapaAbas({ arquivos, aoVoltar, aoConverter }: PropsDaEtapa) {
  return (
    <EscolhaEmCartoes
      arquivo={arquivos[0]!}
      verbo="Converter"
      legenda="Como as páginas viram abas"
      opcoes={ABAS}
      inicial="por-pagina"
      chave="arquivo-das-abas"
      principal={() => "Converter para Excel"}
      aoVoltar={aoVoltar}
      aoConfirmar={(a) => aoConverter({ abasDoExcel: a })}
    />
  );
}
