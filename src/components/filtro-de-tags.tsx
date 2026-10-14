import { useState } from "react";
import { Check, ChevronDown, Search, Tag, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { comCerquilha } from "@/lib/etiquetas-do-projeto";
import { semAcento } from "@/lib/texto-busca";

/** As etiquetas marcadas no filtro (pela `chaveDaEtiqueta`) e o "Sem tags". */
export type SelecaoDeTags = { semTags: boolean; tags: string[] };

export const SEM_SELECAO_DE_TAGS: SelecaoDeTags = { semTags: false, tags: [] };

/**
 * O filtro de etiquetas: uma área que abre a lista de todas as etiquetas, com
 * "Sem tags" no topo. Marca quantas quiser; basta a tarefa ter uma delas.
 *
 * Voltou em 13/10/2026 (pedido do usuário), na linha das datas, com a busca
 * sempre à vista: a lista de setores virou suspensa e abriu o espaço.
 *
 * O gatilho mostra o que está marcado, para o filtro nunca ficar ligado sem
 * ninguém ver — o erro que a busca tinha no Meu pack.
 */
export function FiltroDeTags({
  opcoes,
  semTagsN,
  valor,
  aoMudar,
  className = "",
}: {
  opcoes: { chave: string; nome: string; n: number }[];
  semTagsN: number;
  valor: SelecaoDeTags;
  aoMudar: (v: SelecaoDeTags) => void;
  className?: string;
}) {
  const [procura, setProcura] = useState("");
  const marcadas = new Set(valor.tags);
  const ativo = valor.semTags || marcadas.size > 0;
  const nomeDe = new Map(opcoes.map((o) => [o.chave, o.nome]));
  const rotulos = [
    ...(valor.semTags ? ["Sem tags"] : []),
    ...valor.tags.map((chave) => comCerquilha(nomeDe.get(chave) ?? chave)),
  ];
  const termo = semAcento(procura);
  const listadas = termo ? opcoes.filter((o) => semAcento(o.nome).includes(termo)) : opcoes;

  const alternar = (chave: string) =>
    aoMudar({
      ...valor,
      tags: marcadas.has(chave) ? valor.tags.filter((k) => k !== chave) : [...valor.tags, chave],
    });

  return (
    <Popover onOpenChange={(aberto) => !aberto && setProcura("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ativo ? `Filtro de tags: ${rotulos.join(", ")}` : "Filtrar por tag"}
          className={`input flex items-center gap-1.5 py-1.5 text-left ${ativo ? "border-primary/60" : ""} ${className}`}
        >
          <Tag
            className={`h-3.5 w-3.5 shrink-0 ${ativo ? "text-primary" : "text-muted-foreground"}`}
          />
          {ativo ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {rotulos.slice(0, 2).map((r, i) => (
                <span
                  key={`${i}-${r}`}
                  className="max-w-32 truncate rounded bg-primary/15 px-1.5 text-[11px] font-medium leading-5 text-primary"
                >
                  {r}
                </span>
              ))}
              {rotulos.length > 2 && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  +{rotulos.length - 2}
                </span>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">Filtrar por tag</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Mais contraste que o padrão do popover: no tema escuro o painel se
          confundia com a página por trás, e a letra miúda cansava.
          `z-140` põe o painel acima do balão do chat e do acesso rápido
          (120 e 130), que antes o cobriam no canto de baixo. */}
      <PopoverContent
        align="end"
        className="z-140 w-80 overflow-hidden border-primary/30 p-0 shadow-2xl ring-1 ring-black/10"
      >
        <div className="flex items-start gap-2 border-b border-border bg-secondary/60 px-3 py-2.5">
          <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-semibold text-foreground">Filtrar por tag</div>
            <div className="text-xs text-muted-foreground">
              Mostra as tarefas com qualquer uma das marcadas.
            </div>
          </div>
        </div>
        {opcoes.length > 0 && (
          <div className="relative border-b border-border px-2.5 py-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={procura}
              onChange={(e) => setProcura(e.target.value)}
              autoFocus
              placeholder="Procurar tag…"
              aria-label="Procurar tag"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        {/* Umas seis linhas e a ponta da seguinte, para se ver que rola
            (pedido do usuário, 02/10/2026): a lista inteira descia até o
            rodapé. Cada linha tem 40px, e "Sem tags" vem com o traço embaixo. */}
        <div className="max-h-68 overflow-y-auto p-1.5">
          {!termo && (
            <>
              <OpcaoDeTag
                rotulo="Sem tags"
                n={semTagsN}
                marcada={valor.semTags}
                aoAlternar={() => aoMudar({ ...valor, semTags: !valor.semTags })}
              />
              <div className="mx-1 my-1.5 h-px bg-border" />
            </>
          )}
          {listadas.map((o) => (
            <OpcaoDeTag
              key={o.chave}
              rotulo={comCerquilha(o.nome)}
              n={o.n}
              marcada={marcadas.has(o.chave)}
              aoAlternar={() => alternar(o.chave)}
            />
          ))}
          {listadas.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {termo ? "Nenhuma tag com esse nome." : "Nenhuma tarefa daqui tem tag."}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {ativo
              ? `${rotulos.length} marcada${rotulos.length > 1 ? "s" : ""}`
              : "Nenhuma marcada"}
          </span>
          <button
            type="button"
            onClick={() => aoMudar(SEM_SELECAO_DE_TAGS)}
            disabled={!ativo}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Limpar filtros
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Uma linha do filtro de etiquetas: a caixa, o nome e quantas tarefas. */
function OpcaoDeTag({
  rotulo,
  n,
  marcada,
  aoAlternar,
}: {
  rotulo: string;
  n: number;
  marcada: boolean;
  aoAlternar: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcada}
      onClick={aoAlternar}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition ${
        marcada ? "bg-primary/15 font-medium" : "hover:bg-secondary"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] ${
          marcada ? "border-primary bg-primary text-primary-foreground" : "border-foreground/45"
        }`}
      >
        {marcada && <Check className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
      <span
        className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${
          marcada ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80"
        }`}
      >
        {n}
      </span>
    </button>
  );
}
