import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import type { CompletionEntry, Task, User } from "@/lib/fluxo-types";
import { nomeCurto } from "@/lib/nome-curto";
import { tarefaVencida } from "@/lib/prazo";
import { scoreBgClass, userScorePct } from "@/lib/score";
import {
  duracao,
  indiceDoBalde,
  resumirEntregas,
  type Balde,
  type Entrega,
  type Sessao,
} from "./analise";
import { Cartao, MiniLinha } from "./pecas";

/**
 * A tabela do time (13/10/2026): uma linha por pessoa do escopo com entregas,
 * prazo, atraso, carga aberta, horas e o placar do mês — ordenável por
 * qualquer coluna. Clicar no nome muda o escopo da tela para a pessoa.
 *
 * O placar do mês é o MESMO da Início (`userScorePct`, período "mes"), com a
 * regra de cor de sempre: 100% verde, abaixo vermelho, sem tarefa apagado.
 */

type Coluna =
  "nome" | "concluidas" | "pct" | "atraso" | "abertas" | "vencidas" | "segundos" | "score";

interface Linha {
  u: User;
  nome: string;
  concluidas: number;
  pct: number | null;
  atraso: number | null;
  abertas: number;
  vencidas: number;
  segundos: number;
  score: { pct: number; assigned: number };
  serie: number[];
}

export function TabelaDoTime({
  pessoas,
  entregas,
  tarefasEscopo,
  sessoes,
  baldes,
  tasks,
  completions,
  aoEscolher,
}: {
  pessoas: User[];
  entregas: Entrega[];
  tarefasEscopo: Task[];
  sessoes: Sessao[];
  baldes: Balde[];
  /** Listas inteiras, para o placar do mês — que tem janela própria. */
  tasks: Task[];
  completions: CompletionEntry[];
  aoEscolher: (userId: string) => void;
}) {
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({
    col: "vencidas",
    desc: true,
  });

  const linhas = useMemo<Linha[]>(() => {
    const agora = Date.now();
    return pessoas.map((u) => {
      const minhas = entregas.filter((e) => e.userId === u.id);
      const r = resumirEntregas(minhas);
      const abertas = tarefasEscopo.filter(
        (t) => t.assigneeId === u.id && t.status !== "concluida",
      );
      const serie = baldes.map(() => 0);
      for (const e of minhas) {
        const i = indiceDoBalde(baldes, e.at);
        if (i >= 0) serie[i]!++;
      }
      const sc = userScorePct(u.id, tasks, completions, new Date(), "mes");
      return {
        u,
        nome: nomeCurto(u.name),
        concluidas: r.total,
        pct: r.pctNoPrazo,
        atraso: r.atrasoMedio,
        abertas: abertas.length,
        vencidas: abertas.filter((t) => tarefaVencida(t, agora)).length,
        segundos: sessoes.filter((s) => s.userId === u.id).reduce((a, s) => a + s.seconds, 0),
        score: { pct: sc.pct, assigned: sc.assigned },
        serie,
      };
    });
  }, [pessoas, entregas, tarefasEscopo, sessoes, baldes, tasks, completions]);

  const ordenadas = useMemo(() => {
    const valor = (l: Linha): number | string => {
      if (ordem.col === "nome") return l.nome;
      if (ordem.col === "score") return l.score.assigned ? l.score.pct : -1;
      const v = l[ordem.col];
      return v ?? -1;
    };
    return [...linhas].sort((a, b) => {
      const x = valor(a);
      const y = valor(b);
      const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
      return ordem.desc ? -c : c;
    });
  }, [linhas, ordem]);

  const cab = (col: Coluna, rotulo: string, alinhar = "text-right") => (
    <th className={`px-2 pb-2 font-medium ${alinhar}`}>
      <button
        type="button"
        onClick={() =>
          setOrdem((o) => (o.col === col ? { col, desc: !o.desc } : { col, desc: col !== "nome" }))
        }
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-foreground ${
          ordem.col === col ? "text-foreground" : ""
        }`}
      >
        {rotulo}
        {ordem.col === col &&
          (ordem.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <Cartao
      titulo="Pessoa a pessoa"
      subtitulo="Clique no cabeçalho para ordenar e no nome para ver só aquela pessoa. Placar = mês corrente."
    >
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="text-left text-[10px] text-muted-foreground">
              {cab("nome", "Pessoa", "text-left")}
              {cab("concluidas", "Concluídas")}
              {cab("pct", "No prazo")}
              {cab("atraso", "Atraso médio")}
              {cab("abertas", "Abertas")}
              {cab("vencidas", "Vencidas")}
              {cab("segundos", "Tempo")}
              {cab("score", "Placar mês")}
              <th className="px-2 pb-2 text-right font-medium uppercase tracking-wider">Ritmo</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l) => (
              <tr key={l.u.id} className="border-t border-border/60 hover:bg-secondary/40">
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => aoEscolher(l.u.id)}
                    className="flex min-w-0 items-center gap-2 text-left hover:underline"
                  >
                    <UserAvatar
                      nome={l.u.name}
                      iniciais={l.u.avatar}
                      className="h-6 w-6 shrink-0 text-[9px]"
                    />
                    <span className="truncate font-medium">{l.nome}</span>
                  </button>
                </td>
                <Num>{l.concluidas}</Num>
                <Num>{l.pct == null ? "—" : `${Math.round(l.pct)}%`}</Num>
                <Num>
                  {l.atraso == null
                    ? "—"
                    : `${l.atraso.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d.u.`}
                </Num>
                <Num>{l.abertas}</Num>
                <Num className={l.vencidas > 0 ? "font-semibold text-destructive" : ""}>
                  {l.vencidas}
                </Num>
                <Num>{l.segundos > 0 ? duracao(l.segundos) : "—"}</Num>
                <td className="px-2 py-1.5 text-right">
                  <span
                    className={`inline-block min-w-[44px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums ${scoreBgClass(l.score.pct, l.score.assigned)}`}
                  >
                    {l.score.assigned ? `${Math.round(l.score.pct)}%` : "—"}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex justify-end">
                    <MiniLinha valores={l.serie} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Cartao>
  );
}

function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 text-right tabular-nums ${className}`}>{children}</td>;
}
