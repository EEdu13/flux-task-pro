import { useState } from "react";
import { CalendarRange, Check, ChevronDown, FolderKanban, X } from "lucide-react";
import { CampoData } from "@/components/campo-data";
import { FiltroPessoa, FiltroSetor } from "@/components/filtro-pessoa";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import type { User } from "@/lib/fluxo-types";
import {
  DIAS_DE_CONCLUIDAS,
  FILTROS_VAZIOS,
  filtraTarefas,
  somarDias,
  type FiltrosDoGantt,
  type PeriodoDoGantt,
  type ProjetoParaGantt,
  type SituacaoDoFiltro,
} from "./montar-gantt";

/**
 * Os filtros do Gantt (Módulo 6, 18/11/2026): setor, pessoa, projeto, situação e período.
 * Somam entre si; a regra está em `filtrarGantt` (puro, testado). Setor e pessoa usam os
 * filtros que a casa já tem em Minhas tarefas e no Calendário (`filtro-pessoa.tsx`).
 */

const SITUACOES: { id: SituacaoDoFiltro; rotulo: string }[] = [
  { id: "pendente", rotulo: "A fazer" },
  { id: "andamento", rotulo: "Em andamento" },
  { id: "atrasada", rotulo: "Atrasada" },
  { id: "concluida", rotulo: "Concluída" },
];

const GATILHO =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-xs font-medium transition hover:bg-secondary";

const DIA_E_MES = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
const curto = (iso: string) => {
  const d = isoParaData(iso);
  return d ? DIA_E_MES.format(d) : "…";
};

/** Os atalhos do período, contados a partir de hoje. */
function atalhos(): { rotulo: string; periodo: PeriodoDoGantt }[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimDoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const intervalo = (de: Date, ate: Date): PeriodoDoGantt => ({
    tipo: "intervalo",
    de: dataParaIso(de),
    ate: dataParaIso(ate),
  });
  return [
    { rotulo: "Este mês", periodo: intervalo(inicioDoMes, fimDoMes) },
    { rotulo: "Próximos 30 dias", periodo: intervalo(hoje, somarDias(hoje, 30)) },
    { rotulo: "Últimos 30 dias", periodo: intervalo(somarDias(hoje, -30), hoje) },
  ];
}

function rotuloDoPeriodo(p: PeriodoDoGantt, geral: boolean): string {
  if (p.tipo === "tudo") return "Tudo, inclusive concluídas antigas";
  if (p.tipo === "intervalo") return `${curto(p.de)} a ${curto(p.ate)}`;
  return geral ? `Abertas e concluídas há até ${DIAS_DE_CONCLUIDAS} dias` : "Todas as tarefas";
}

function OpcaoDaLista({
  rotulo,
  ativo,
  aoClicar,
  cor,
}: {
  rotulo: string;
  ativo: boolean;
  aoClicar: () => void;
  cor?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={ativo}
      onClick={aoClicar}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-secondary ${
        ativo ? "font-semibold text-foreground" : "text-muted-foreground"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          ativo ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
      >
        {ativo && <Check className="h-3 w-3" />}
      </span>
      {cor !== undefined && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} />
      )}
      <span className="truncate">{rotulo}</span>
    </button>
  );
}

function FiltroDeProjetos({
  projetos,
  marcados,
  aoMudar,
}: {
  projetos: readonly ProjetoParaGantt[];
  marcados: readonly string[];
  aoMudar: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  if (projetos.length <= 1) return null;
  const conjunto = new Set(marcados);
  const nomes = projetos.filter((p) => conjunto.has(p.id)).map((p) => p.name);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${GATILHO} ${marcados.length ? "border-primary/60 text-foreground" : "border-border text-muted-foreground"}`}
        >
          <FolderKanban className="h-3.5 w-3.5" />
          <span className="max-w-40 truncate">
            {nomes.length === 0
              ? "Todos os projetos"
              : nomes.length === 1
                ? nomes[0]
                : `${nomes.length} projetos`}
          </span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-140 w-64 p-1.5">
        <div role="menu" aria-label="Projetos" className="max-h-72 overflow-y-auto">
          <OpcaoDaLista
            rotulo="Todos os projetos"
            ativo={marcados.length === 0}
            aoClicar={() => aoMudar([])}
          />
          {projetos.map((p) => (
            <OpcaoDaLista
              key={p.id}
              rotulo={p.name}
              cor={p.color ?? "var(--primary)"}
              ativo={conjunto.has(p.id)}
              aoClicar={() =>
                aoMudar(
                  conjunto.has(p.id) ? marcados.filter((x) => x !== p.id) : [...marcados, p.id],
                )
              }
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FiltroDePeriodo({
  periodo,
  geral,
  aoMudar,
}: {
  periodo: PeriodoDoGantt;
  geral: boolean;
  aoMudar: (p: PeriodoDoGantt) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const escolher = (p: PeriodoDoGantt) => {
    aoMudar(p);
    setAberto(false);
  };
  const de = periodo.tipo === "intervalo" ? periodo.de : "";
  const ate = periodo.tipo === "intervalo" ? periodo.ate : "";
  /* Apagou as duas datas: volta ao padrão (um intervalo vazio esconderia as sem prazo à toa). */
  const datas = (novoDe: string, novoAte: string) =>
    aoMudar(
      novoDe || novoAte ? { tipo: "intervalo", de: novoDe, ate: novoAte } : { tipo: "padrao" },
    );
  const mesmo = (a: PeriodoDoGantt, b: PeriodoDoGantt) => JSON.stringify(a) === JSON.stringify(b);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${GATILHO} ${periodo.tipo !== "padrao" ? "border-primary/60 text-foreground" : "border-border text-muted-foreground"}`}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          <span className="max-w-56 truncate">{rotuloDoPeriodo(periodo, geral)}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-140 w-72 p-1.5">
        <div role="menu" aria-label="Período">
          <OpcaoDaLista
            rotulo={rotuloDoPeriodo({ tipo: "padrao" }, geral)}
            ativo={periodo.tipo === "padrao"}
            aoClicar={() => escolher({ tipo: "padrao" })}
          />
          {geral && (
            <OpcaoDaLista
              rotulo={rotuloDoPeriodo({ tipo: "tudo" }, geral)}
              ativo={periodo.tipo === "tudo"}
              aoClicar={() => escolher({ tipo: "tudo" })}
            />
          )}
          {atalhos().map((a) => (
            <OpcaoDaLista
              key={a.rotulo}
              rotulo={a.rotulo}
              ativo={mesmo(periodo, a.periodo)}
              aoClicar={() => escolher(a.periodo)}
            />
          ))}
        </div>
        <div className="mt-1.5 border-t border-border px-2 pb-1 pt-2">
          <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
            Escolher as datas
          </p>
          <div className="flex items-center gap-1.5 text-xs">
            <CampoData
              value={de}
              onChange={(v) => datas(v, ate)}
              placeholder="De"
              aria-label="De"
              className="h-8 flex-1"
            />
            <span className="text-muted-foreground">a</span>
            <CampoData
              value={ate}
              onChange={(v) => datas(de, v)}
              placeholder="Até"
              aria-label="Até"
              className="h-8 flex-1"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BarraDeFiltros({
  filtros,
  aoMudar,
  pessoas,
  projetos,
  mostrando,
  total,
}: {
  filtros: FiltrosDoGantt;
  aoMudar: (f: FiltrosDoGantt) => void;
  /** Quem é responsável por alguma tarefa do Gantt (os rostos do filtro). */
  pessoas: User[];
  /** Os projetos da visão geral; `null` na aba de um projeto. */
  projetos: readonly ProjetoParaGantt[] | null;
  mostrando: number;
  total: number;
}) {
  const mudar = (parte: Partial<FiltrosDoGantt>) => aoMudar({ ...filtros, ...parte });
  const marcadas = new Set(filtros.situacoes);
  const algum =
    filtraTarefas(filtros) || filtros.periodo.tipo !== "padrao" || filtros.pessoas.length > 0;
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FiltroSetor
          pessoas={pessoas}
          setor={filtros.setor}
          aoMudar={(setor) => mudar({ setor })}
        />
        {projetos && (
          <FiltroDeProjetos
            projetos={projetos}
            marcados={filtros.projetos}
            aoMudar={(ids) => mudar({ projetos: ids })}
          />
        )}
        <div
          className="inline-flex rounded-lg bg-secondary/60 p-0.5"
          role="group"
          aria-label="Situação"
        >
          {SITUACOES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={marcadas.has(s.id)}
              onClick={() =>
                mudar({
                  situacoes: marcadas.has(s.id)
                    ? filtros.situacoes.filter((x) => x !== s.id)
                    : [...filtros.situacoes, s.id],
                })
              }
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                marcadas.has(s.id)
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`fluxo-gantt-legenda ${s.id}`} />
              {s.rotulo}
            </button>
          ))}
        </div>
        <FiltroDePeriodo
          periodo={filtros.periodo}
          geral={projetos !== null}
          aoMudar={(periodo) => mudar({ periodo })}
        />
        {algum && (
          <button
            type="button"
            onClick={() => aoMudar(FILTROS_VAZIOS)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {mostrando === total
            ? `${total} ${total === 1 ? "tarefa" : "tarefas"}`
            : `Mostrando ${mostrando} de ${total} tarefas`}
        </span>
      </div>
      {pessoas.length > 1 && (
        <FiltroPessoa
          pessoas={pessoas}
          setor={filtros.setor}
          valor={{ modo: "so", ids: [...filtros.pessoas] }}
          aoMudar={(v) => mudar({ pessoas: v.ids })}
        />
      )}
    </div>
  );
}
