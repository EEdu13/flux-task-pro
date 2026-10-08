import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Tag } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { minhasEtiquetas } from "@/lib/tarefa-satelites.functions";
import { ETIQUETA_DE_PROJETO, chaveDaEtiqueta, comCerquilha } from "@/lib/etiquetas-do-projeto";
import { semAcento } from "@/lib/texto-busca";

/** Uma tag desta pessoa, e em quantas das tarefas que ela criou está. */
type TagConhecida = { chave: string; nome: string; n: number };

/* A última lista de cada pessoa, guardada entre uma abertura e outra do campo:
   ela aparece na hora e se atualiza por trás, em vez de esperar o servidor a
   cada tarefa aberta. */
let guardadas: { pessoa: string; tags: { nome: string; n: number }[] } | null = null;

/**
 * As tags DESTA pessoa: as que ela criou e as que ela usa nas tarefas que
 * criou — ver `minhasEtiquetas`. Antes vinham de todas as tarefas que ela
 * enxerga, e a lista se enchia com as tags dos colegas do setor.
 *
 * Ficam de fora as que o servidor põe sozinho nas subtarefas de projeto
 * ("projeto" e o nome do projeto, ver `etiquetasDoProjeto`): escolhê-las numa
 * tarefa avulsa a faria parecer parte de um projeto.
 */
function useMinhasTags(): TagConhecida[] {
  const { currentUser, projects } = useFluxo();
  const [doServidor, setDoServidor] = useState(() =>
    guardadas?.pessoa === currentUser.id ? guardadas.tags : [],
  );
  useEffect(() => {
    let vivo = true;
    minhasEtiquetas()
      .then((r) => {
        guardadas = { pessoa: currentUser.id, tags: r.etiquetas };
        if (vivo) setDoServidor(r.etiquetas);
      })
      .catch(() => {
        /* Fica a lista guardada; sem nenhuma, o campo é o de antes, sem sugestão. */
      });
    return () => {
      vivo = false;
    };
  }, [currentUser.id]);

  return useMemo(() => {
    const deProjeto = new Set([
      ETIQUETA_DE_PROJETO,
      ...projects.map((p) => chaveDaEtiqueta(p.name)),
    ]);
    return doServidor
      .map((t) => ({
        chave: chaveDaEtiqueta(t.nome),
        nome: t.nome.replace(/^#+/, "").trim(),
        n: t.n,
      }))
      .filter((t) => t.chave && !deProjeto.has(t.chave));
  }, [doServidor, projects]);
}

/** O trecho entre vírgulas onde está o cursor: é a tag sendo escrita. */
function trechoNoCursor(valor: string, cursor: number) {
  const inicio = cursor > 0 ? valor.lastIndexOf(",", cursor - 1) + 1 : 0;
  const virgula = valor.indexOf(",", cursor);
  const fim = virgula === -1 ? valor.length : virgula;
  return { inicio, fim, termo: valor.slice(inicio, fim).trim() };
}

type Posicao = { top?: number; bottom?: number; left: number; width: number };

/**
 * O campo de tags, com as tags da pessoa numa lista suspensa — o visual do
 * filtro de tags de Minhas tarefas. Escrever continua livre: tag nova é só
 * digitar e separar por vírgula. A lista serve para reaproveitar a tag que a
 * pessoa já tem em vez de criar outra grafia dela ("Aguardando Rodrigo",
 * "aguardando rodrigo", "Aguard. Rodrigo").
 *
 * O valor continua sendo o texto separado por vírgula de sempre: quem usa o
 * campo só troca o `<input>` por este.
 *
 * A lista sai num portal, como as outras da grade: dentro da tabela, que rola
 * de lado, ela seria cortada na borda. Esc com a lista aberta fecha só a lista;
 * a janela da tarefa e a grade cedem o Esc a um `combobox` expandido.
 */
export function CampoDeTags({
  valor,
  aoMudar,
  placeholder,
  className = "input",
  compacto = false,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  placeholder?: string;
  className?: string;
  /** Linhas menores, para a grade de criação. */
  compacto?: boolean;
}) {
  const conhecidas = useMinhasTags();
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const listaId = useId();
  const [focado, setFocado] = useState(false);
  /** Fechada pelo Esc: volta a abrir quando a pessoa digita. */
  const [fechada, setFechada] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [ativa, setAtiva] = useState(-1);
  const [pos, setPos] = useState<Posicao | null>(null);

  const { inicio, fim, termo } = trechoNoCursor(valor, Math.min(cursor, valor.length));
  const chaveDoTermo = chaveDaEtiqueta(termo);
  const procura = semAcento(termo.replace(/^#+/, ""));

  /* As que combinam com o que está sendo escrito: a igual ao texto na frente
     (Enter não pode trocar "Aguardando" por "Aguardando Rodrigo" só porque a
     segunda é mais usada), depois as que começam com ele e as que só o contêm.
     As que já estão em outro trecho do campo não voltam à lista. */
  const opcoes = useMemo(() => {
    const noCampo = new Set(
      `${valor.slice(0, inicio)},${valor.slice(fim)}`
        .split(",")
        .map(chaveDaEtiqueta)
        .filter(Boolean),
    );
    const livres = conhecidas.filter((t) => !noCampo.has(t.chave));
    if (!procura) return livres;
    const iguais: TagConhecida[] = [];
    const comecam: TagConhecida[] = [];
    const contem: TagConhecida[] = [];
    for (const t of livres) {
      const nome = semAcento(t.nome);
      if (nome === procura) iguais.push(t);
      else if (nome.startsWith(procura)) comecam.push(t);
      else if (nome.includes(procura)) contem.push(t);
    }
    return [...iguais, ...comecam, ...contem];
  }, [conhecidas, valor, inicio, fim, procura]);

  const nova = !!chaveDoTermo && !conhecidas.some((t) => t.chave === chaveDoTermo);
  const aberta = focado && !fechada && (opcoes.length > 0 || nova);

  // Com texto digitado, a primeira da lista já vem marcada: Enter a escolhe.
  useEffect(() => {
    setAtiva(procura ? 0 : -1);
  }, [procura]);

  /* A lista acompanha o campo: abre embaixo dele, ou em cima quando não cabe,
     e se reposiciona quando algo por baixo rola. */
  useLayoutEffect(() => {
    if (!aberta) return;
    const posicionar = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      // Cabeçalho, as seis linhas e o aviso de tag nova — ver a lista abaixo.
      const altura = compacto ? 250 : 300;
      const paraCima = r.bottom + altura > window.innerHeight && r.top > altura;
      const width = Math.max(r.width, 240);
      setPos({
        ...(paraCima ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
      });
    };
    posicionar();
    const aoRolar = (e: Event) => {
      if (listaRef.current?.contains(e.target as Node)) return;
      posicionar();
    };
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", posicionar);
    return () => {
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", posicionar);
    };
  }, [aberta, compacto]);

  // A marcada pelas setas fica sempre à vista na lista.
  useEffect(() => {
    if (ativa < 0) return;
    listaRef.current
      ?.querySelector(`[data-indice="${ativa}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [ativa]);

  /** Troca o trecho em edição pela tag escolhida e deixa o cursor pronto para a próxima. */
  const escolher = (nome: string) => {
    const antes = valor.slice(0, inicio).replace(/\s+$/, "");
    const depois = valor.slice(fim);
    const prefixo = antes ? `${antes} ` : "";
    const novo = `${prefixo}${nome}${depois || ", "}`;
    const posCursor = prefixo.length + nome.length + (depois ? 0 : 2);
    aoMudar(novo);
    setFechada(false);
    setCursor(posCursor);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(posCursor, posCursor));
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (!aberta) {
      // Seta para baixo reabre a lista fechada pelo Esc.
      if (e.key === "ArrowDown" && opcoes.length > 0) {
        e.preventDefault();
        setFechada(false);
        setAtiva(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setAtiva((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setAtiva((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      const o = opcoes[ativa];
      if (!o) return;
      e.preventDefault();
      e.stopPropagation();
      escolher(o.nome);
    } else if (e.key === "Tab" && !e.shiftKey && procura) {
      /* Tab completa, como no autocompletar de qualquer editor (pedido do
         usuário, 08/10/2026): "#aguar" + Tab vira "#Aguardando Rodrigo". Só
         com algo digitado — com o trecho vazio, Tab segue para o próximo
         campo, como sempre. */
      const o = opcoes[Math.max(ativa, 0)];
      if (!o) return;
      e.preventDefault();
      e.stopPropagation();
      escolher(o.nome);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setFechada(true);
    }
  };

  const lembrarCursor = (el: HTMLInputElement) => setCursor(el.selectionStart ?? el.value.length);

  return (
    <>
      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => {
          aoMudar(e.target.value);
          lembrarCursor(e.target);
          setFechada(false);
        }}
        onSelect={(e) => lembrarCursor(e.currentTarget)}
        onFocus={(e) => {
          setFocado(true);
          lembrarCursor(e.currentTarget);
        }}
        onBlur={() => {
          setFocado(false);
          setFechada(false);
        }}
        onKeyDown={aoTeclar}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={aberta}
        aria-controls={listaId}
        aria-activedescendant={aberta && opcoes[ativa] ? `${listaId}-${ativa}` : undefined}
        className={className}
      />
      {aberta &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          /* O mousedown não tira o foco do campo: sem isto, clicar numa tag
             desfocava o campo, a lista sumia e o clique não chegava a ela. */
          <div
            ref={listaRef}
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-450 overflow-hidden rounded-lg border border-primary/30 bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/10"
            style={pos}
          >
            {opcoes.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-3 py-1.5 text-[11px] font-semibold text-foreground">
                  <Tag className="h-3.5 w-3.5 text-primary" />
                  Suas tags
                  <span className="ml-auto font-normal text-muted-foreground">
                    ↑↓, Enter ou Tab escolhem
                  </span>
                </div>
                {/* Seis linhas e uma ponta da sétima, para se ver que rola: a
                    lista inteira descia até o rodapé e ficava atrás do acesso
                    rápido. A altura de cada linha é fixa para a conta fechar. */}
                <div
                  id={listaId}
                  role="listbox"
                  aria-label="Suas tags"
                  className={`overflow-y-auto p-1 ${compacto ? "max-h-47" : "max-h-60"}`}
                >
                  {opcoes.map((o, i) => (
                    <div
                      key={o.chave}
                      id={`${listaId}-${i}`}
                      data-indice={i}
                      role="option"
                      aria-selected={i === ativa}
                      onMouseEnter={() => setAtiva(i)}
                      onClick={() => escolher(o.nome)}
                      className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-foreground ${
                        compacto ? "h-7 text-xs" : "h-9 text-sm"
                      } ${i === ativa ? "bg-primary/15 font-medium" : "hover:bg-secondary"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{comCerquilha(o.nome)}</span>
                      {/* Zero é tag que a pessoa criou e não usa em tarefa
                          nenhuma agora: um "0" pareceria tag de tarefa excluída. */}
                      {o.n > 0 && (
                        <span
                          title={`Em ${o.n} tarefa${o.n > 1 ? "s" : ""} criada${o.n > 1 ? "s" : ""} por você`}
                          className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-4 tabular-nums ${
                            i === ativa
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-foreground/80"
                          }`}
                        >
                          {o.n}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {nova && (
              <div
                className={`flex items-center gap-1.5 bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground ${
                  opcoes.length > 0 ? "border-t border-border" : ""
                }`}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 truncate">
                  Tag nova:{" "}
                  <span className="font-semibold text-foreground">{comCerquilha(termo)}</span> —
                  separe com vírgula
                </span>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
