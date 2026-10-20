import { Navigate, createFileRoute } from "@tanstack/react-router";
import { MEU_MES_LIBERADO } from "@/lib/meu-mes-liberado";
import { Gift, Play } from "lucide-react";
import { motion } from "framer-motion";
import { FluxoLayout } from "@/components/fluxo-layout";
import { abrirWrapped, mesAnteriorEmBrasilia } from "@/components/wrapped/porta-do-wrapped";
import { useFluxo } from "@/lib/fluxo-store";

export const Route = createFileRoute("/meu-mes")({
  head: () => ({ meta: [{ title: "Meu mês · SGL - CONECTA" }] }),
  component: MeuMes,
});

/*
 * "Meu mês" (19/10/2026: "coloque pra rever, e coloque um mensal, bem legal
 * igual Spotify"): a estante das retrospectivas. O mês que acabou em
 * destaque, os anteriores como capas de disco, e o mês corrente "até agora".
 * Clicar abre o Wrapped daquele mês (a mesma sequência que abre sozinha no
 * dia 1º às 6h30). Nenhuma consulta aqui: cada mês só vai ao banco quando é
 * aberto.
 */

const NOMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Uma capa por mês: gradiente e emoji do mês. */
const CAPAS: { fundo: string; emoji: string }[] = [
  { fundo: "from-sky-400 via-cyan-400 to-emerald-300", emoji: "🎆" },
  { fundo: "from-fuchsia-500 via-pink-500 to-amber-300", emoji: "🎭" },
  { fundo: "from-emerald-500 via-lime-400 to-yellow-300", emoji: "🍃" },
  { fundo: "from-amber-400 via-orange-500 to-rose-500", emoji: "🍂" },
  { fundo: "from-rose-400 via-pink-500 to-violet-500", emoji: "🌷" },
  { fundo: "from-orange-400 via-red-500 to-yellow-400", emoji: "🔥" },
  { fundo: "from-indigo-500 via-sky-500 to-cyan-300", emoji: "❄️" },
  { fundo: "from-violet-600 via-purple-500 to-pink-400", emoji: "🌬️" },
  { fundo: "from-yellow-300 via-lime-400 to-emerald-500", emoji: "🌻" },
  { fundo: "from-pink-500 via-rose-400 to-orange-300", emoji: "🎀" },
  { fundo: "from-teal-500 via-emerald-500 to-lime-400", emoji: "🌳" },
  { fundo: "from-red-500 via-rose-500 to-amber-300", emoji: "🎄" },
];

/** "2026-09" → { ano, mes (0–11) }. */
const partes = (aaaamm: string) => {
  const [a, m] = aaaamm.split("-").map(Number);
  return { ano: a!, mes: m! - 1 };
};
const mesesAntes = (aaaamm: string, n: number) => {
  const { ano, mes } = partes(aaaamm);
  const d = new Date(Date.UTC(ano, mes - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

function MeuMes() {
  // Escondido até o lançamento; `?previa=1` mostra mesmo assim.
  const previa =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("previa") === "1";
  if (!MEU_MES_LIBERADO && !previa) return <Navigate to="/" />;
  return <MeuMesLiberado />;
}

function MeuMesLiberado() {
  const { currentUser } = useFluxo();
  const ultimo = mesAnteriorEmBrasilia();
  const atual = mesesAntes(ultimo, -1);
  const anteriores = Array.from({ length: 5 }, (_, i) => mesesAntes(ultimo, i + 1));
  const destaque = partes(ultimo);
  const capa = CAPAS[destaque.mes]!;
  const primeiro = currentUser.name.split(" ")[0] ?? currentUser.name;

  return (
    <FluxoLayout title="Meu mês">
      <div className="mx-auto w-full max-w-[1400px] space-y-8">
        {/* O mês que acabou, em destaque */}
        <motion.button
          type="button"
          onClick={() => abrirWrapped(ultimo)}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.01 }}
          className={`group relative w-full overflow-hidden rounded-3xl bg-gradient-to-br ${capa.fundo} p-8 text-left text-white shadow-xl md:p-12`}
        >
          <span
            aria-hidden
            className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/15"
          />
          <span
            aria-hidden
            className="absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-black/10"
          />
          <span
            aria-hidden
            className="absolute right-10 top-1/2 hidden -translate-y-1/2 select-none text-[160px] leading-none drop-shadow-xl md:block"
          >
            {capa.emoji}
          </span>
          <div className="relative max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em]">
              <Gift className="h-3.5 w-3.5" /> Retrospectiva CONECTA
            </div>
            <h1 className="mt-4 font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
              Seu {NOMES[destaque.mes]!.toLowerCase()}
              <br />
              chegou, {primeiro.charAt(0) + primeiro.slice(1).toLowerCase()}.
            </h1>
            <p className="mt-4 max-w-md text-base font-medium text-white/85">
              As tarefas, os packs, as horas e quem você ajudou — contado como história.
            </p>
            <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-900 shadow-lg transition group-hover:scale-105">
              <Play className="h-4 w-4 fill-current" /> Ver meu {NOMES[destaque.mes]!.toLowerCase()}
            </span>
          </div>
        </motion.button>

        {/* Os outros meses, como capas de disco */}
        <section>
          <h2 className="mb-3 font-display text-xl font-bold tracking-tight">Seus meses</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Capa mes={atual} rotulo="Até agora" parcial />
            {anteriores.map((m) => (
              <Capa key={m} mes={m} />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Todo dia 1º, às 6h30, a retrospectiva do mês que passou abre sozinha. Aqui você revê
            quando quiser.
          </p>
        </section>
      </div>
    </FluxoLayout>
  );
}

function Capa({
  mes,
  rotulo,
  parcial = false,
}: {
  mes: string;
  rotulo?: string;
  parcial?: boolean;
}) {
  const { ano, mes: m } = partes(mes);
  const capa = CAPAS[m]!;
  return (
    <motion.button
      type="button"
      onClick={() => abrirWrapped(mes)}
      whileHover={{ y: -4 }}
      className="group text-left"
    >
      <div
        className={`relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br ${capa.fundo} p-4 text-white shadow-md transition group-hover:shadow-xl`}
      >
        <span aria-hidden className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15" />
        <span className="relative text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
          {parcial ? "Em andamento" : "Retrospectiva"}
        </span>
        <div className="absolute bottom-3 left-4 right-4">
          <div className="select-none text-4xl leading-none drop-shadow">{capa.emoji}</div>
          <div className="mt-1 font-display text-2xl font-black leading-none tracking-tight">
            {NOMES[m]}
          </div>
        </div>
        {/* o "play" verde que aparece ao passar o mouse, como no Spotify */}
        <span className="absolute bottom-3 right-3 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-emerald-500 text-white opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold">{rotulo ?? NOMES[m]}</div>
      <div className="text-xs text-muted-foreground">{ano}</div>
    </motion.button>
  );
}
