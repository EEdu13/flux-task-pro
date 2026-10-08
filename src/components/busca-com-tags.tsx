import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Tag } from "lucide-react";
import { semAcento } from "@/lib/texto-busca";

export type TagDaBusca = { nome: string; n: number };

/**
 * O campo de busca que completa etiquetas: digitou "#", abre a lista das
 * etiquetas que existem; ↑↓ escolhem, Tab ou Enter completam (pedido do
 * usuário, 08/10/2026). Fora de um "#", é um campo de texto comum.
 *
 * A etiqueta em edição é o trecho entre o último "#" antes do cursor e o
 * cursor — pode ter espaço, porque há etiqueta de duas palavras
 * ("#Aguardando Rodrigo").
 */
export function BuscaComTags({
  valor,
  aoMudar,
  tags,
  placeholder,
  sufixo,
  className = "",
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  tags: TagDaBusca[];
  placeholder?: string;
  /** Texto miúdo à direita, dentro do campo (a contagem de tarefas). */
  sufixo?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listaId = useId();
  const [cursor, setCursor] = useState(0);
  const [focado, setFocado] = useState(false);
  const [fechada, setFechada] = useState(false);
  const [ativa, setAtiva] = useState(0);

  const ate = Math.min(cursor, valor.length);
  const cerquilha = valor.lastIndexOf("#", ate - 1);
  const termo = cerquilha >= 0 ? valor.slice(cerquilha + 1, ate) : null;

  const opcoes = useMemo(() => {
    if (termo === null) return [];
    const procura = semAcento(termo);
    const comecam: TagDaBusca[] = [];
    const contem: TagDaBusca[] = [];
    for (const t of tags) {
      const nome = semAcento(t.nome);
      if (nome === procura) continue; // já está escrita inteira
      if (nome.startsWith(procura)) comecam.push(t);
      else if (procura && nome.includes(procura)) contem.push(t);
    }
    return [...comecam, ...contem].slice(0, 8);
  }, [tags, termo]);

  const aberta = focado && !fechada && opcoes.length > 0;

  useEffect(() => setAtiva(0), [termo]);

  const escolher = (nome: string) => {
    const antes = valor.slice(0, cerquilha);
    const depois = valor.slice(ate).replace(/^\S*/, ""); // o resto da palavra cortada sai
    const inserido = `#${nome} `;
    const novo = `${antes}${inserido}${depois.replace(/^\s+/, "")}`;
    const pos = antes.length + inserido.length;
    aoMudar(novo);
    setCursor(pos);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
  };

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!aberta) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtiva((i) => Math.min(i + 1, opcoes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtiva((i) => Math.max(i - 1, 0));
    } else if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
      const o = opcoes[ativa];
      if (!o) return;
      e.preventDefault();
      escolher(o.nome);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setFechada(true);
    }
  };

  const lembrar = (el: HTMLInputElement) => setCursor(el.selectionStart ?? el.value.length);

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => {
          aoMudar(e.target.value);
          lembrar(e.target);
          setFechada(false);
        }}
        onSelect={(e) => lembrar(e.currentTarget)}
        onFocus={(e) => {
          setFocado(true);
          lembrar(e.currentTarget);
        }}
        onBlur={() => setFocado(false)}
        onKeyDown={aoTeclar}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={aberta}
        aria-controls={listaId}
        className="input w-full py-1.5 pr-20"
      />
      {sufixo && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
          {sufixo}
        </span>
      )}
      {aberta && (
        /* mousedown sem tirar o foco: senão o campo desfoca, a lista some e o
           clique não chega a ela. */
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-primary/30 bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center gap-1.5 border-b border-border bg-secondary/60 px-3 py-1.5 text-[11px] font-semibold">
            <Tag className="h-3.5 w-3.5 text-primary" />
            Tags
            <span className="ml-auto font-normal text-muted-foreground">↑↓ e Tab completam</span>
          </div>
          <div id={listaId} role="listbox" className="p-1">
            {opcoes.map((o, i) => (
              <div
                key={o.nome}
                role="option"
                aria-selected={i === ativa}
                onMouseEnter={() => setAtiva(i)}
                onClick={() => escolher(o.nome)}
                className={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm ${
                  i === ativa ? "bg-primary/15 font-medium" : "hover:bg-secondary"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">#{o.nome}</span>
                <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[11px] tabular-nums text-foreground/80">
                  {o.n}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
