import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDndContext,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type Modifier,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, useSortable, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { createPortal } from "react-dom";

/* Arrastar tarefas: Quadro, Lista, Pack e Minha visão.

   Era o arrastar nativo do navegador (`draggable` + `dataTransfer`). Ele
   funcionava, mas parecia de outra época: o que seguia o mouse era uma foto
   apagada do cartão, que não aceita estilo; nada abria espaço enquanto se
   arrastava — só uma borda colorida dizia onde ia cair, e ao soltar tudo
   pulava de uma vez; e no toque (tablet, celular) ele não funciona.

   Agora quem faz é o @dnd-kit: o cartão sobe inteiro, com sombra, os outros
   abrem espaço onde ele vai cair, e ao soltar ele pousa no lugar. As regras
   de cada tela — prioridade, colunas ordenadas por prazo, concluídas que não
   se reordenam — continuam nas telas. Aqui mora só o gesto. */

/**
 * Apertar num campo de texto ou numa lista de opções não começa arraste: ali o
 * gesto de arrastar é selecionar texto. Botão começa, como no arrastar antigo —
 * na Lista o título é um botão e ocupa quase a linha toda. O clique no botão
 * continua valendo: o arraste só começa depois de 6px.
 */
function nasceNumControle(alvo: EventTarget | null): boolean {
  return (
    alvo instanceof Element &&
    !!alvo.closest("input, textarea, select, [contenteditable], [data-sem-arraste]")
  );
}

class SensorDoMouse extends MouseSensor {
  static activators = [
    {
      eventName: "onMouseDown" as const,
      handler: ({ nativeEvent: e }: ReactMouseEvent) =>
        e.button === 0 && !nasceNumControle(e.target),
    },
  ];
}

class SensorDoToque extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent: e }: ReactTouchEvent) => !nasceNumControle(e.target),
    },
  ];
}

/* Fora do componente de propósito. O @dnd-kit refaz os "ouvintes" de cada
   cartão quando as opções mudam, e um objeto escrito dentro do componente é
   outro a cada desenho: todos os cartões recebiam ouvintes novos a cada troca
   de lugar, e nenhum `memo` segurava o redesenho. */
const MOUSE = { activationConstraint: { distance: 6 } };
const TOQUE = { activationConstraint: { delay: 200, tolerance: 8 } };
const TECLADO = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: {
    start: [KeyboardCode.Space],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
  },
};

/**
 * Mouse: começa depois de 6px, para o clique continuar abrindo a tarefa.
 * Toque: depois de segurar um instante, para o dedo continuar rolando a tela.
 * Teclado: espaço pega e solta, setas movem, Esc cancela. Enter fica livre
 * para abrir a tarefa, como o clique.
 */
export function useSensoresDoArraste() {
  return useSensors(
    useSensor(SensorDoMouse, MOUSE),
    useSensor(SensorDoToque, TOQUE),
    useSensor(KeyboardSensor, TECLADO),
  );
}

/**
 * O pouso. O cartão levantado volta a ficar reto e sem sombra enquanto desce
 * até o lugar; o lugar fica invisível até ele chegar, senão haveria dois
 * cartões iguais na tela por um instante.
 *
 * Invisível por classe (com `!important` em `styles.css`), não por `style`: no
 * Quadro o lugar é um `motion.div` com `layoutId`, e o framer reescreve a
 * opacidade dele a cada quadro que desenha — a opacidade posta à mão durava
 * até o primeiro quadro, e os dois cartões apareciam juntos.
 */
export const POUSO: DropAnimation = {
  duration: 200,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: (p) => {
    const desfazer = defaultDropAnimationSideEffects({
      className: { active: "arraste-lugar-pousando" },
    })(p);
    p.dragOverlay.node.querySelector(".arraste-levantado")?.setAttribute("data-pousando", "");
    return desfazer ?? undefined;
  },
};

/** O cartão que acompanha o mouse. O estilo mora em `styles.css`. */
export function Levantado({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`arraste-levantado ${className}`}>{children}</div>;
}

/**
 * A camada do cartão levantado vai para o `body`. Dentro da página ela herdaria
 * qualquer `transform` de um ancestral, e `position: fixed` passa a contar a
 * partir dele — o cartão apareceria longe do mouse. Só depois de montar,
 * porque no servidor não há `document`.
 */
export function NoTopo({ children }: { children: ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return montado ? createPortal(children, document.body) : null;
}

/** Nas listas, a linha só sobe e desce. */
export const soVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * As mesmas funções de um desenho para o outro, cada uma chamando a versão
 * mais nova da que recebeu. É o que deixa os cartões serem `memo`: as ações
 * que chegam da página são recriadas a cada desenho, e um `memo` com elas nas
 * props redesenharia do mesmo jeito. As chaves não podem mudar.
 */
export function useAcoesEstaveis<T extends Record<string, (...args: never[]) => unknown>>(
  acoes: T,
): T {
  const atuais = useRef(acoes);
  useLayoutEffect(() => {
    atuais.current = acoes;
  });
  const [estaveis] = useState(
    () =>
      Object.fromEntries(
        Object.keys(acoes).map((k) => [
          k,
          (...args: unknown[]) => (atuais.current[k] as (...a: unknown[]) => unknown)(...args),
        ]),
      ) as unknown as T,
  );
  return estaveis;
}

/* Leitor de tela. Sem isto o dnd-kit fala em inglês e chama a tarefa pelo id. */
const INSTRUCOES: ScreenReaderInstructions = {
  draggable:
    "Para pegar a tarefa, aperte espaço. Com ela na mão, as setas movem; espaço de novo solta, e Esc cancela.",
};

export function acessibilidadeDoArraste(nome: (id: UniqueIdentifier) => string): {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
} {
  return {
    screenReaderInstructions: INSTRUCOES,
    announcements: {
      onDragStart: ({ active }) => `Pegou ${nome(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `${nome(active.id)} sobre ${nome(over.id)}.` : undefined,
      onDragEnd: ({ active, over }) =>
        over ? `${nome(active.id)} solta sobre ${nome(over.id)}.` : `${nome(active.id)} solta.`,
      onDragCancel: ({ active }) => `Cancelado. ${nome(active.id)} voltou para onde estava.`,
    },
  };
}

/* ————— Listas: reordenar linhas ————— */

/**
 * Reordenar linhas de uma tabela (Lista, Minha visão). Aqui os vizinhos abrem
 * espaço pelo `transform` do @dnd-kit/sortable, e nada muda de verdade até
 * soltar: `aoSoltar` recebe a linha arrastada e a linha sobre a qual caiu.
 *
 * A tela não guarda qual linha está na mão — quem precisa saber é só a
 * `LinhaNaMao`, que lê do próprio dnd-kit. Guardada na tela, pegar e soltar
 * redesenhavam a tabela inteira, e com a lista cheia isso engasgava o gesto.
 */
export function useArrasteDeLinhas(aoSoltar: (id: string, sobre: string) => void) {
  const sensors = useSensoresDoArraste();
  const contexto: DndContextProps = {
    sensors,
    collisionDetection: closestCenter,
    modifiers: [soVertical],
    onDragEnd: ({ active, over }) => {
      if (over && over.id !== active.id) aoSoltar(String(active.id), String(over.id));
    },
  };
  return contexto;
}

/**
 * Para tabelas com `marcarDestino`: as linhas não se deslocam enquanto se
 * arrasta. Vai no `strategy` da `SortableContext`.
 */
export const semDeslocar: SortingStrategy = () => null;

/**
 * Uma linha que se pega inteira, como antes. Campos de texto e listas dentro
 * dela não começam arraste (ver `nasceNumControle`).
 *
 * Por padrão as outras linhas deslizam para abrir espaço, e a arrastada fica
 * só como o lugar: tingida e vazia. Com `marcarDestino`, nada desliza: um traço
 * na linha sob o ponteiro mostra onde ela vai cair, e a arrastada fica apagada
 * onde estava — o jeito das planilhas. É para tabela pesada, com campos: linha
 * de tabela deslizando obriga o navegador a recalcular a tabela inteira a cada
 * quadro da animação, e na Minha visão isso engasgava o gesto.
 */
export function LinhaArrastavel({
  id,
  desligada,
  aoAbrir,
  marcarDestino,
  className = "",
  style,
  children,
  ...resto
}: ComponentProps<"tr"> & {
  id: string;
  /** Não se arrasta nem recebe (ex.: as concluídas da Lista). */
  desligada?: boolean;
  /** Enter com a linha em foco. */
  aoAbrir?: () => void;
  /** Traço de destino em vez de deslizar. Pede `semDeslocar` na `SortableContext`. */
  marcarDestino?: boolean;
}) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
    index,
    activeIndex,
  } = useSortable({
    id,
    disabled: desligada,
    attributes: { role: "row", roleDescription: "tarefa" },
  });
  /* O traço fica onde `arrayMove` vai pôr a linha: embaixo da de destino
     quando a arrastada vem de cima, em cima quando vem de baixo. */
  const traco =
    marcarDestino && isOver && !isDragging && activeIndex >= 0
      ? `inset 0 ${activeIndex < index ? -2 : 2}px 0 var(--primary)`
      : undefined;
  const sombra = [traco, isDragging ? undefined : style?.boxShadow].filter(Boolean).join(", ");
  return (
    <tr
      ref={setNodeRef}
      {...resto}
      {...(desligada ? null : { ...attributes, ...listeners, "data-arrastavel": "" })}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (aoAbrir && e.key === "Enter" && e.target === e.currentTarget && !isDragging) aoAbrir();
      }}
      style={{
        ...(isDragging ? null : style),
        boxShadow: sombra || undefined,
        transform: marcarDestino ? undefined : CSS.Translate.toString(transform),
        transition: marcarDestino ? undefined : transition,
      }}
      className={`${className} ${
        !isDragging
          ? ""
          : marcarDestino
            ? "bg-primary/5 *:opacity-40"
            : "bg-primary/5 shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--primary)_40%,transparent)] *:opacity-0"
      }`}
    >
      {children}
    </tr>
  );
}

/**
 * A linha na mão, com a camada e o pouso. Vai dentro do `DndContext`.
 *
 * Fora da tabela ela não tem colunas, então vai o que identifica a tarefa:
 * `linha` diz, pelo id, o título e o detalhe à direita. Sem inclinar, porque
 * numa linha larga um grau e meio já tira as pontas do lugar.
 */
export function LinhaNaMao({
  linha,
}: {
  linha: (id: string) => { titulo: string; detalhe?: ReactNode } | undefined;
}) {
  const { active } = useDndContext();
  const l = active ? linha(String(active.id)) : undefined;
  return (
    <NoTopo>
      <DragOverlay dropAnimation={POUSO}>
        {l ? (
          <Levantado className="arraste-linha h-full rounded-md">
            <div className="flex h-full items-center gap-3 rounded-md border border-border bg-card px-4 text-sm">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{l.titulo}</span>
              {l.detalhe}
            </div>
          </Levantado>
        ) : null}
      </DragOverlay>
    </NoTopo>
  );
}

/* ————— Quadro: arrastar entre colunas ————— */

const PREFIXO_COLUNA = "coluna:";

/** O id com que a coluna se registra como área de soltar. */
export const idDaColuna = (coluna: string) => PREFIXO_COLUNA + coluna;
const ehColuna = (id: UniqueIdentifier) => String(id).startsWith(PREFIXO_COLUNA);

/** Os ids dos cartões de cada coluna, na ordem da tela. */
export type Arranjo<C extends string> = Record<C, string[]>;

export interface Soltura<C extends string> {
  id: string;
  de: C;
  para: C;
  /** A coluna de destino como ficou na tela, com o cartão já no lugar. */
  ids: string[];
  /** Soltou sobre outro cartão, e não sobre o próprio lugar ou a coluna. */
  sobreOutro: boolean;
}

/**
 * Arrastar cartões entre colunas, com o lugar aberto na coluna de destino.
 *
 * Enquanto se arrasta, a tela mostra `arranjo`: uma cópia dos ids por coluna em
 * que o cartão já está onde vai cair. Os outros abrem espaço porque a lista
 * muda de verdade, e quem anima o deslize é o `layout` do framer, o mesmo que
 * faz o cartão atravessar o quadro pela seta. Nada é gravado até soltar —
 * `aoSoltar` recebe o destino e a tela decide o que isso significa.
 *
 * Cada cartão precisa registrar o mesmo nó como arrastável E como área de
 * soltar (`useDraggable` + `useDroppable`), e cada coluna como área com
 * `idDaColuna`. As áreas são medidas sem o `transform` do próprio nó, então o
 * framer animando não engana a conta de onde o mouse está.
 */
export function useArrasteEntreColunas<C extends string>({
  colunas,
  atual,
  reordenavel,
  encaixar,
  aoSoltar,
}: {
  colunas: readonly C[];
  /** Como a tela está fora do arraste. */
  atual: Arranjo<C>;
  /** Se a posição dentro da coluna é escolha da pessoa. Não sendo, o cartão só troca de coluna. */
  reordenavel: (coluna: C) => boolean;
  /** Numa coluna que não se reordena à mão, onde o cartão entra: a ordenação dela. */
  encaixar: (coluna: C, ids: string[]) => string[];
  aoSoltar: (s: Soltura<C>) => void;
}) {
  const [ativo, setAtivo] = useState<string | null>(null);
  const [arranjo, setArranjo] = useState<Arranjo<C> | null>(null);
  const origem = useRef<C | null>(null);
  /* O alvo sob o ponteiro e se o ponteiro está na metade de baixo dele. Sai da
     detecção de colisão, que é onde ponteiro e áreas estão na mesma conta. */
  const alvo = useRef<{ id: UniqueIdentifier; depois: boolean } | null>(null);
  const sensors = useSensoresDoArraste();

  const exibido = arranjo ?? atual;

  const colunaDe = (a: Arranjo<C>, id: UniqueIdentifier): C | undefined => {
    const s = String(id);
    if (ehColuna(s)) return s.slice(PREFIXO_COLUNA.length) as C;
    return colunas.find((c) => a[c].includes(s));
  };

  /* Cartão antes de coluna: o ponteiro sobre um cartão está também dentro da
     coluna dele, e é o cartão que diz a posição. Fora de tudo (no vão entre
     colunas), fica o último alvo, e o lugar aberto não pisca. */
  const collisionDetection: CollisionDetection = (args) => {
    const p = args.pointerCoordinates;
    const achados = p
      ? pointerWithin(args)
      : closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => !ehColuna(c.id)),
        });
    const escolhido = achados.find((c) => !ehColuna(c.id)) ?? achados[0];
    if (!escolhido) return alvo.current ? [{ id: alvo.current.id }] : [];
    const r = args.droppableRects.get(escolhido.id);
    const y = p ? p.y : args.collisionRect.top + args.collisionRect.height / 2;
    alvo.current = { id: escolhido.id, depois: !!r && y > r.top + r.height / 2 };
    return [escolhido];
  };

  const reposicionar = (idAtivo: string) => {
    const a0 = alvo.current;
    if (!a0) return;
    setArranjo((a) => {
      if (!a) return a;
      const idAlvo = String(a0.id);
      if (idAlvo === idAtivo) return a; // sobre o próprio lugar
      const de = colunaDe(a, idAtivo);
      const para = colunaDe(a, idAlvo);
      if (!de || !para) return a;

      if (!reordenavel(para)) {
        if (de === para) return a;
        return {
          ...a,
          [de]: a[de].filter((x) => x !== idAtivo),
          [para]: encaixar(para, [...a[para], idAtivo]),
        };
      }

      const destino = a[para].filter((x) => x !== idAtivo);
      let pos: number;
      if (ehColuna(idAlvo)) {
        // No vazio da coluna: a de origem fica como está; outra recebe no fim.
        if (de === para) return a;
        pos = destino.length;
      } else {
        const i = destino.indexOf(idAlvo);
        if (i < 0) return a;
        pos = i + (a0.depois ? 1 : 0);
      }
      const novo = [...destino.slice(0, pos), idAtivo, ...destino.slice(pos)];
      if (de === para) return mesmaOrdem(novo, a[para]) ? a : { ...a, [para]: novo };
      return { ...a, [de]: a[de].filter((x) => x !== idAtivo), [para]: novo };
    });
  };

  const limpar = () => {
    setAtivo(null);
    setArranjo(null);
    origem.current = null;
    alvo.current = null;
  };

  const contexto: DndContextProps = {
    sensors,
    collisionDetection,
    onDragStart: ({ active }: DragStartEvent) => {
      const id = String(active.id);
      origem.current = colunaDe(atual, id) ?? null;
      alvo.current = null;
      setAtivo(id);
      setArranjo(Object.fromEntries(colunas.map((c) => [c, [...atual[c]]])) as Arranjo<C>);
    },
    onDragMove: ({ active }) => reposicionar(String(active.id)),
    onDragOver: ({ active }) => reposicionar(String(active.id)),
    onDragEnd: ({ active, over }: DragEndEvent) => {
      const id = String(active.id);
      const a = arranjo;
      const de = origem.current;
      limpar();
      if (!a || !de || !over) return;
      const para = colunaDe(a, id);
      if (!para) return;
      aoSoltar({
        id,
        de,
        para,
        ids: a[para],
        sobreOutro: !ehColuna(over.id) && String(over.id) !== id,
      });
    },
    onDragCancel: limpar,
  };

  return { ativo, exibido, contexto };
}

function mesmaOrdem(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Remede as áreas de soltar quando a lista muda no meio do arraste. O dnd-kit
 * só remede sozinho quando uma área entra ou sai; cartão trocando de lugar na
 * mesma coluna não é nenhum dos dois, e as contas seguiriam com as posições
 * antigas. Vai dentro do `DndContext`.
 */
export function RemedirAoMudar({ chave }: { chave: unknown }) {
  const { measureDroppableContainers, active } = useDndContext();
  useLayoutEffect(() => {
    if (active) measureDroppableContainers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  return null;
}
