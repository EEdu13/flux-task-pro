import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlarmClockOff,
  BadgeDollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Gift,
  Loader2,
  Lock,
  RotateCcw,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FluxoLayout } from "@/components/fluxo-layout";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { brl, perguntarSeSouDono } from "@/lib/use-recompensas";
import type {
  LinhaDoExtrato,
  PainelDeRecompensas,
  PessoaNoPainel,
} from "@/lib/recompensas.functions";

export const Route = createFileRoute("/recompensas")({
  head: () => ({ meta: [{ title: "Recompensas · SGL - CONECTA" }] }),
  component: RecompensasPage,
});

/* Recompensas (06/11/2026): o TESTE do Eduardo — quanto cada pessoa do TI
   ganharia no mês (teto R$ 300) pelo que concluiu no CONECTA. Só ele vê; quem
   não é o dono é mandado para o Início sem explicação. As regras moram no
   servidor (`recompensas.functions.ts`). */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function andarMes(mes: string, passo: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + passo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function RecompensasPage() {
  const navigate = useNavigate();
  const { users } = useFluxo();
  const [dono, setDono] = useState<boolean | null>(null);
  const [mes, setMes] = useState(mesAtual);
  const [painel, setPainel] = useState<PainelDeRecompensas | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    void perguntarSeSouDono().then((ok) => {
      setDono(ok);
      if (!ok) void navigate({ to: "/" });
    });
  }, [navigate]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { painelDeRecompensas } = await import("@/lib/recompensas.functions");
      setPainel(await painelDeRecompensas({ data: { mes } }));
    } catch (e) {
      toast.error("Não deu para carregar as recompensas.", { description: (e as Error)?.message });
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    if (dono) void carregar();
  }, [dono, carregar]);

  const definir = useCallback(
    async (tarefaId: string, valor: number | null) => {
      try {
        const { definirValorDaTarefa } = await import("@/lib/recompensas.functions");
        await definirValorDaTarefa({ data: { tarefaId, valor } });
        await carregar();
      } catch (e) {
        toast.error("Não deu para gravar.", { description: (e as Error)?.message });
      }
    },
    [carregar],
  );

  const ligar = useCallback(
    async (pessoaId: string, ativo: boolean) => {
      try {
        const { ligarParticipante } = await import("@/lib/recompensas.functions");
        await ligarParticipante({ data: { quem: pessoaId, ativo } });
        toast.success(ativo ? "Bonificação ligada" : "Bonificação desligada: não contabiliza");
        await carregar();
      } catch (e) {
        toast.error("Não deu para gravar.", { description: (e as Error)?.message });
      }
    },
    [carregar],
  );

  const totais = useMemo(() => {
    const p = painel?.pessoas ?? [];
    return {
      pago: p.reduce((s, x) => s + x.pago, 0),
      teto: (painel?.teto ?? 300) * p.filter((x) => x.ativo).length,
      aguardando: p.reduce((s, x) => s + x.aguardando.length, 0),
    };
  }, [painel]);

  if (dono !== true) {
    return (
      <FluxoLayout title="Recompensas">
        <div className="grid min-h-[40vh] place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </FluxoLayout>
    );
  }

  const [ano, m] = mes.split("-").map(Number);
  const noMesAtual = mes === mesAtual();

  return (
    <FluxoLayout title="Recompensas">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 md:p-6">
        {/* cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <BadgeDollarSign className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              Recompensas do time
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Teste · só você vê · ninguém é avisado quando você bonifica
            </p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setMes((x) => andarMes(x, -1))}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-36 text-center text-sm font-semibold capitalize">
              {MESES[m - 1]} de {ano}
            </span>
            <button
              type="button"
              onClick={() => setMes((x) => andarMes(x, 1))}
              disabled={noMesAtual}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
              aria-label="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* resumo */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Resumo rotulo="A pagar no mês" valor={brl(totais.pago)} destaque />
          <Resumo rotulo="Teto do time" valor={brl(totais.teto)} />
          <Resumo
            rotulo="Dias úteis"
            valor={painel ? `${painel.diasUteisAteHoje} / ${painel.diasUteis}` : "—"}
          />
          <Resumo
            rotulo="Aguardando bonificar"
            valor={String(totais.aguardando)}
            alerta={totais.aguardando > 0}
          />
        </div>

        <p className="-mt-2 text-[11px] text-muted-foreground">
          Pack: {brl(painel?.packPorDia ?? 6)} por dia útil, dividido pelos itens; atrasado não ganha.
          Suas tarefas: {brl(15)} módulo · {brl(8)} padrão · {brl(3)} rápida; atrasada vale metade.
          Tarefas deles: só contam se você bonificar ({brl(2)} · {brl(5)} · {brl(10)}).
        </p>

        {carregando && !painel ? (
          <div className="grid min-h-[30vh] place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {(painel?.pessoas ?? [])
              .slice()
              .sort((a, b) => b.pago - a.pago)
              .map((p, i) => (
                <CartaoDaPessoa
                  key={p.id}
                  pessoa={p}
                  teto={painel?.teto ?? 300}
                  posicao={i}
                  usuario={users.find((u) => u.id === p.id)}
                  onDefinir={definir}
                  onLigar={ligar}
                />
              ))}
          </div>
        )}
      </div>
    </FluxoLayout>
  );
}

function Resumo({
  rotulo,
  valor,
  destaque,
  alerta,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          destaque
            ? "text-emerald-600 dark:text-emerald-400"
            : alerta
              ? "text-amber-600 dark:text-amber-400"
              : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}

function CartaoDaPessoa({
  pessoa: p,
  teto,
  posicao,
  usuario,
  onDefinir,
  onLigar,
}: {
  pessoa: PessoaNoPainel;
  onLigar: (pessoaId: string, ativo: boolean) => Promise<void>;
  teto: number;
  posicao: number;
  usuario?: { name: string; avatar?: string; jobTitle?: string };
  onDefinir: (tarefaId: string, valor: number | null) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const pct = Math.min(100, (p.bruto / teto) * 100);
  const bateu = p.ativo && p.bruto >= teto;
  const trocar = async () => {
    setTrocando(true);
    await onLigar(p.id, !p.ativo);
    setTrocando(false);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: posicao * 0.05 }}
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition ${
        p.ativo ? "border-border" : "border-dashed border-border/80 opacity-70"
      }`}
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          nome={usuario?.name ?? p.nome}
          iniciais={usuario?.avatar ?? p.nome.slice(0, 2)}
          className="h-10 w-10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.nome}</p>
          <p className="truncate text-[11px] text-muted-foreground">{usuario?.jobTitle}</p>
        </div>
        <div className="text-right">
          <p
            className={`flex items-center justify-end gap-1 text-xl font-bold tabular-nums ${
              p.ativo ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
            }`}
          >
            {bateu && <Trophy className="h-4 w-4 text-amber-500" />}
            {brl(p.pago)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {p.ativo ? `de ${brl(teto)}` : `desligado · ganharia ${brl(Math.min(teto, p.bruto))}`}
          </p>
        </div>
        {/* liga/desliga a bonificação desta pessoa */}
        <button
          type="button"
          role="switch"
          aria-checked={p.ativo}
          disabled={trocando}
          onClick={() => void trocar()}
          title={p.ativo ? "Desligar a bonificação desta pessoa" : "Ligar a bonificação desta pessoa"}
          className={`relative ml-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${
            p.ativo ? "bg-emerald-500" : "bg-muted-foreground/30"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              p.ativo ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {/* barra até o teto */}
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className={`h-full rounded-full ${
            !p.ativo ? "bg-muted-foreground/40" : bateu ? "bg-amber-500" : "bg-emerald-500"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Parte icone={<Flame className="h-3.5 w-3.5 text-orange-500" />} rotulo="Pack" valor={p.pack} />
        <Parte icone={<BadgeDollarSign className="h-3.5 w-3.5 text-emerald-500" />} rotulo="Suas tarefas" valor={p.tarefas} />
        <Parte icone={<Gift className="h-3.5 w-3.5 text-violet-500" />} rotulo="Bonificadas" valor={p.bonus} />
        <Parte
          icone={<AlarmClockOff className="h-3.5 w-3.5 text-red-500" />}
          rotulo="Perdido (atraso)"
          valor={p.perdidoAtraso}
          negativo
        />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Em aberto valendo: <b className="text-foreground">{brl(p.emAberto)}</b></span>
        <span>Pack possível no mês: {brl(p.packPossivel)}</span>
        {p.acimaDoTeto > 0 && (
          <span className="text-amber-600 dark:text-amber-400">Acima do teto: {brl(p.acimaDoTeto)}</span>
        )}
      </div>

      {/* aguardando bonificar */}
      {p.aguardando.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <Gift className="h-3.5 w-3.5" /> Criadas por {primeiroNome(p.nome)} · aguardando bonificar ({p.aguardando.length})
          </p>
          <ul className="flex flex-col gap-1.5">
            {p.aguardando.map((l) => (
              <LinhaAguardando key={l.tarefaId} linha={l} onDefinir={onDefinir} />
            ))}
          </ul>
        </div>
      )}

      {/* extrato */}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition ${aberto ? "rotate-180" : ""}`} />
        Extrato ({p.extrato.length})
      </button>
      {aberto && (
        <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {p.extrato.length === 0 && (
            <li className="p-3 text-center text-xs text-muted-foreground">Nada concluído neste mês.</li>
          )}
          {p.extrato.map((l) => (
            <LinhaDoExtratoItem key={l.tarefaId} linha={l} onDefinir={onDefinir} />
          ))}
        </ul>
      )}
    </motion.section>
  );
}

function Parte({
  icone,
  rotulo,
  valor,
  negativo,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: number;
  negativo?: boolean;
}) {
  return (
    <div className="rounded-lg bg-secondary/50 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icone} {rotulo}
      </p>
      <p className={`mt-0.5 font-semibold tabular-nums ${negativo && valor > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
        {negativo && valor > 0 ? "− " : ""}
        {brl(valor)}
      </p>
    </div>
  );
}

const primeiroNome = (n: string) => n.split(" ")[0].charAt(0) + n.split(" ")[0].slice(1).toLowerCase();

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function LinhaAguardando({
  linha: l,
  onDefinir,
}: {
  linha: LinhaDoExtrato;
  onDefinir: (tarefaId: string, valor: number | null) => Promise<void>;
}) {
  const [gravando, setGravando] = useState(false);
  const definir = async (v: number) => {
    setGravando(true);
    await onDefinir(l.tarefaId, v);
    setGravando(false);
  };
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate" title={l.titulo}>
        {l.titulo}
      </span>
      {!l.noPrazo && <Clock className="h-3 w-3 shrink-0 text-red-500" aria-label="atrasada" />}
      <span className="shrink-0 text-[10px] text-muted-foreground">{dataCurta(l.concluidaEm)}</span>
      <div className="flex shrink-0 gap-1">
        {l.opcoes.map((v) => (
          <button
            key={v}
            type="button"
            disabled={gravando}
            onClick={() => void definir(v)}
            className="inline-flex items-center gap-0.5 rounded-md border border-emerald-500/40 px-1.5 py-0.5 font-bold text-emerald-700 transition hover:bg-emerald-500 hover:text-white disabled:opacity-50 dark:text-emerald-300"
            title={`Bonificar com ${brl(v)}`}
          >
            <BadgeDollarSign className="h-3 w-3" />
            {v}
          </button>
        ))}
        <button
          type="button"
          disabled={gravando}
          onClick={() => void definir(0)}
          className="rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-secondary"
          title="Não bonificar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function LinhaDoExtratoItem({
  linha: l,
  onDefinir,
}: {
  linha: LinhaDoExtrato;
  onDefinir: (tarefaId: string, valor: number | null) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const cor =
    l.origem === "pack" ? "text-orange-500" : l.origem === "bonus" ? "text-violet-500" : "text-emerald-500";
  const Icone = l.origem === "pack" ? Flame : l.origem === "bonus" ? Gift : BadgeDollarSign;
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <Icone className={`h-3.5 w-3.5 shrink-0 ${cor}`} />
      <span className="min-w-0 flex-1 truncate" title={l.titulo}>
        {l.titulo}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{dataCurta(l.concluidaEm)}</span>
      {!l.noPrazo && (
        <span className="shrink-0 rounded bg-red-500/10 px-1 text-[10px] font-medium text-red-600 dark:text-red-400">
          atrasou
        </span>
      )}
      {editando && l.origem !== "pack" ? (
        <div className="flex shrink-0 items-center gap-1">
          {l.opcoes.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setEditando(false);
                void onDefinir(l.tarefaId, l.origem === "tarefa" && v === l.padrao ? null : v);
              }}
              className={`rounded-md border px-1.5 py-0.5 font-bold ${
                l.base === v
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
              }`}
            >
              {v}
            </button>
          ))}
          <button
            type="button"
            title={l.origem === "bonus" ? "Tirar bonificação" : "Não contar"}
            onClick={() => {
              setEditando(false);
              void onDefinir(l.tarefaId, l.origem === "bonus" ? null : 0);
            }}
            className="rounded-md px-1 py-0.5 text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            <X className="h-3 w-3" />
          </button>
          {l.origem === "tarefa" && l.escolhido !== null && (
            <button
              type="button"
              title="Voltar ao padrão"
              onClick={() => {
                setEditando(false);
                void onDefinir(l.tarefaId, null);
              }}
              className="rounded-md px-1 py-0.5 text-muted-foreground hover:bg-secondary"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={l.origem === "pack"}
          onClick={() => setEditando(true)}
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-right font-semibold tabular-nums ${
            l.origem === "pack" ? "cursor-default" : "hover:bg-secondary"
          } ${l.ganho > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground line-through"}`}
          title={l.origem === "pack" ? undefined : "Mudar o valor"}
        >
          {brl(l.ganho)}
        </button>
      )}
    </li>
  );
}
