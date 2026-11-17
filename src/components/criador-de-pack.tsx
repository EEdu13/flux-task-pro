import { useRef, useState } from "react";
import { Clock, CornerDownLeft, ListPlus, Plus, Repeat, Trash2, X } from "lucide-react";

import { CampoDeTags } from "@/components/campo-de-tags";
import {
  PRIORIDADES_DO_PACK,
  chaveDoTitulo,
  edicaoDe,
  linhasDoPack,
  novoItemDePack,
  patchDaEdicao,
  type EdicaoDeItem,
  type ItemDePack,
} from "@/lib/item-de-pack";
import type { Priority, Task } from "@/lib/fluxo-types";

/* Criar item do pack do jeito de criar tarefa (pedido do usuário, 13/10/2026:
   "criação do pack tem que ser parecido com a tarefa, fácil de criar ali").

   Antes era uma caixa de texto, uma linha por tarefa, e tudo entrava como
   prioridade média, sem horário. Agora é uma linha de tarefa: o título, Enter
   acrescenta e o cursor fica pronto para o próximo, e ao lado os mesmos
   controles da grade de criação — horário, prioridade, tags e a repetição.
   Colar várias linhas continua criando vários itens, com uma prévia antes. */

/** Os botões Alta/Média/Baixa, compactos. */
export function EscolhaDePrioridade({
  valor,
  aoMudar,
}: {
  valor: Priority;
  aoMudar: (p: Priority) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border" role="radiogroup">
      {PRIORIDADES_DO_PACK.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={valor === p.id}
          onClick={() => aoMudar(p.id)}
          className={`border-r border-border px-2 py-1 text-[11px] font-semibold transition last:border-r-0 ${
            valor === p.id ? p.cor : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Liga e desliga "volta todo dia útil". */
export function BotaoRepetir({
  valor,
  aoMudar,
  compacto = false,
}: {
  valor: boolean;
  aoMudar: (v: boolean) => void;
  compacto?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={valor}
      onClick={() => aoMudar(!valor)}
      title={
        valor
          ? "Volta todo dia útil (seg a sex, sem feriado). Clique para ser só hoje."
          : "Só hoje. Clique para voltar todo dia útil."
      }
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
        valor
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-secondary"
      }`}
    >
      <Repeat className="h-3 w-3" />
      {compacto ? (valor ? "Dia útil" : "Só hoje") : valor ? "Todo dia útil" : "Só hoje"}
    </button>
  );
}

/**
 * A linha de criação. Enter acrescenta o item e devolve o cursor ao título;
 * horário, prioridade, tags e repetição valem para o item e continuam
 * escolhidos para o seguinte (o horário volta a vazio — cada compromisso tem o
 * seu). Colar uma lista abre a prévia dos itens antes de criar.
 *
 * `existentes`: títulos já no pack, para avisar antes de repetir um item.
 */
export function CriadorDePack({
  aoAdicionar,
  existentes = [],
  autoFocus = false,
  placeholder = "O que precisa ser feito hoje? Enter adiciona",
}: {
  aoAdicionar: (itens: ItemDePack[]) => void;
  existentes?: string[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const tituloRef = useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = useState("");
  const [horario, setHorario] = useState("");
  const [prioridade, setPrioridade] = useState<Priority>("media");
  const [tags, setTags] = useState("");
  const [repetir, setRepetir] = useState(true);
  /** Linhas coladas aguardando confirmação. */
  const [colados, setColados] = useState<string[] | null>(null);

  const jaExistem = new Set(existentes.map(chaveDoTitulo));
  const repetido = titulo.trim() !== "" && jaExistem.has(chaveDoTitulo(titulo));
  const base = { horario, prioridade, tags, repetir };

  const adicionar = () => {
    const t = titulo.trim();
    if (!t) return;
    aoAdicionar([novoItemDePack(t, base)]);
    setTitulo("");
    setHorario("");
    tituloRef.current?.focus();
  };

  const confirmarColagem = () => {
    if (!colados?.length) return;
    // Na colagem o horário não vale: seria o mesmo para todos os itens.
    aoAdicionar(colados.map((l) => novoItemDePack(l, { ...base, horario: "" })));
    setColados(null);
    setTitulo("");
    tituloRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={tituloRef}
          autoFocus={autoFocus}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              adicionar();
            }
          }}
          onPaste={(e) => {
            const linhas = linhasDoPack(e.clipboardData.getData("text"));
            if (linhas.length < 2) return;
            e.preventDefault();
            setColados(linhas);
          }}
          placeholder={placeholder}
          aria-label="Título do item do pack"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={!titulo.trim()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
          title="Adicionar (Enter)"
        >
          <CornerDownLeft className="h-3 w-3" /> Adicionar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
            horario ? "border-primary/50 bg-primary/10 text-primary" : "border-border"
          }`}
          title="Horário (opcional). Sem ele, vence no fim do dia."
        >
          <Clock className="h-3 w-3" />
          <input
            type="time"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
            aria-label="Horário"
            className="w-[5.5rem] bg-transparent text-[11px] outline-none"
          />
          {horario && (
            <button
              type="button"
              onClick={() => setHorario("")}
              className="rounded p-0.5 hover:bg-secondary"
              title="Sem horário"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </label>
        <EscolhaDePrioridade valor={prioridade} aoMudar={setPrioridade} />
        <BotaoRepetir valor={repetir} aoMudar={setRepetir} />
        <div className="min-w-[10rem] flex-1">
          <CampoDeTags
            valor={tags}
            aoMudar={setTags}
            compacto
            placeholder="#tags, separadas por vírgula"
            className="h-7 w-full rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
          />
        </div>
      </div>

      {repetido && <p className="text-[11px] text-warning">Este item já está no pack de hoje.</p>}

      {colados ? (
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <ListPlus className="h-3.5 w-3.5 text-primary" />
            {colados.length} itens colados
          </div>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {colados.map((l, i) => (
              <li
                key={`${i}-${l}`}
                className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">{l}</span>
                {jaExistem.has(chaveDoTitulo(l)) && (
                  <span className="shrink-0 text-[10px] font-semibold text-warning">já existe</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const resto = colados.filter((_, j) => j !== i);
                    setColados(resto.length ? resto : null);
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Tirar da lista"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Entram com a prioridade, as tags e a repetição escolhidas acima, sem horário.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setColados(null)}
              className="rounded-md border border-border px-3 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmarColagem}
              className="rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:brightness-110"
            >
              Adicionar {colados.length} itens
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Dica: cole uma lista (uma linha por item) no campo para criar vários de uma vez.
        </p>
      )}
    </div>
  );
}

/**
 * Os itens montados antes de enviar: cada um editável (título, horário,
 * prioridade, repetição) e removível. As tags aparecem como fichas — um campo
 * de tags por linha buscaria a lista no servidor uma vez por item.
 */
export function RascunhoDePack({
  itens,
  aoMudar,
  duplicados,
}: {
  itens: ItemDePack[];
  aoMudar: (itens: ItemDePack[]) => void;
  /** Por item: quem já tem esse título no pack de hoje. */
  duplicados?: (item: ItemDePack) => string[];
}) {
  const mudar = (chave: string, patch: Partial<ItemDePack>) =>
    aoMudar(itens.map((i) => (i.chave === chave ? { ...i, ...patch } : i)));
  const ciclo: Priority[] = ["media", "alta", "baixa"];

  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((item) => {
        const prio = PRIORIDADES_DO_PACK.find((p) => p.id === item.prioridade)!;
        const quem = duplicados?.(item) ?? [];
        const tags = [
          ...(item.etiquetasExtras ?? []),
          ...item.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ];
        return (
          <li
            key={item.chave}
            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5"
          >
            <input
              value={item.titulo}
              onChange={(e) => mudar(item.chave, { titulo: e.target.value })}
              aria-label="Título"
              className="h-7 min-w-[10rem] flex-1 rounded bg-transparent px-1 text-sm outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary"
            />
            <input
              type="time"
              value={item.horario}
              onChange={(e) => mudar(item.chave, { horario: e.target.value })}
              aria-label="Horário"
              title="Horário (opcional)"
              className="h-7 w-[5.75rem] rounded border border-border bg-transparent px-1 text-[11px] outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() =>
                mudar(item.chave, {
                  prioridade: ciclo[(ciclo.indexOf(item.prioridade) + 1) % ciclo.length],
                })
              }
              title="Prioridade — clique para trocar"
              className={`h-7 rounded-md border px-2 text-[11px] font-semibold ${prio.cor}`}
            >
              {prio.label}
            </button>
            <BotaoRepetir
              valor={item.repetir}
              aoMudar={(v) => mudar(item.chave, { repetir: v })}
              compacto
            />
            <button
              type="button"
              onClick={() => aoMudar(itens.filter((i) => i.chave !== item.chave))}
              className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Tirar do pack"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {(tags.length > 0 || quem.length > 0) && (
              <div className="flex w-full flex-wrap items-center gap-1 pl-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    #{t.replace(/^#+/, "")}
                  </span>
                ))}
                {quem.length > 0 && (
                  <span className="text-[10px] font-semibold text-warning">
                    Já no pack de {quem.join(", ")} — não será repetido
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A linha de EDIÇÃO de um item que já está no pack (09/11/2026): o mesmo desenho do rascunho,
 * sobre uma tarefa gravada. Texto, horário, prioridade e repetição; a lixeira tira do pack;
 * "Mais opções" abre a janela completa da tarefa. Enter salva e Esc cancela.
 *
 * Salvar entrega só o que MUDOU (`patchDaEdicao`): quem chama grava com `updateTask`. Mudar a
 * repetição também grava os dias da semana, e eles só existem na tarefa depois de "hidratada"
 * (`hidratarTarefa`, que quem abre a edição chama): até lá o Salvar espera.
 */
export function EdicaoDoItemDoPack({
  tarefa,
  compacto = false,
  aoSalvar,
  aoCancelar,
  aoExcluir,
  aoMaisOpcoes,
}: {
  tarefa: Task;
  /** No cartão estreito da equipe: o texto ocupa a linha inteira e o resto desce. */
  compacto?: boolean;
  aoSalvar: (patch: Partial<Task>) => void;
  aoCancelar: () => void;
  aoExcluir?: () => void;
  aoMaisOpcoes?: () => void;
}) {
  const [edicao, setEdicao] = useState<EdicaoDeItem>(() => edicaoDe(tarefa));
  const mudar = (patch: Partial<EdicaoDeItem>) => setEdicao((e) => ({ ...e, ...patch }));
  const ciclo: Priority[] = ["media", "alta", "baixa"];
  const prio = PRIORIDADES_DO_PACK.find((p) => p.id === edicao.prioridade)!;
  const patch = patchDaEdicao(tarefa, edicao);
  const esperando = edicao.repetir !== tarefa.recurring && !tarefa.satellitesLoaded;
  const semTitulo = edicao.titulo.trim() === "";

  const salvar = () => {
    if (esperando || semTitulo) return;
    // Nada mudou: salvar é só fechar.
    if (!patch) aoCancelar();
    else aoSalvar(patch);
  };

  return (
    <div
      role="group"
      aria-label="Editar item do pack"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          aoCancelar();
        } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          salvar();
        }
      }}
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/40 bg-background px-2 py-1.5"
    >
      <input
        autoFocus
        value={edicao.titulo}
        maxLength={200}
        onChange={(e) => mudar({ titulo: e.target.value })}
        aria-label="Título"
        className={`h-7 rounded bg-transparent px-1 text-sm outline-none focus:bg-primary/5 focus:ring-1 focus:ring-primary ${
          compacto ? "w-full basis-full" : "min-w-[10rem] flex-1"
        }`}
      />
      <input
        type="time"
        value={edicao.horario}
        onChange={(e) => mudar({ horario: e.target.value })}
        aria-label="Horário"
        title="Horário (opcional)"
        className="h-7 w-[5.75rem] rounded border border-border bg-transparent px-1 text-[11px] outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={() =>
          mudar({ prioridade: ciclo[(ciclo.indexOf(edicao.prioridade) + 1) % ciclo.length] })
        }
        title="Prioridade — clique para trocar"
        className={`h-7 rounded-md border px-2 text-[11px] font-semibold ${prio.cor}`}
      >
        {prio.label}
      </button>
      <BotaoRepetir valor={edicao.repetir} aoMudar={(v) => mudar({ repetir: v })} compacto />
      <span className="ml-auto flex items-center gap-1.5">
        {aoMaisOpcoes && (
          <button
            type="button"
            onClick={aoMaisOpcoes}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Abre a janela completa da tarefa"
          >
            Mais opções
          </button>
        )}
        {aoExcluir && (
          <button
            type="button"
            onClick={aoExcluir}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Tirar do pack"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={aoCancelar}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={esperando || semTitulo}
          title={esperando ? "Carregando os dias da repetição…" : undefined}
          className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Salvar
        </button>
      </span>
    </div>
  );
}
