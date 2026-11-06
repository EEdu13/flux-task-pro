import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { UserAvatar } from "@/components/user-avatar";
import { formatRelative } from "@/lib/use-theme";
import { AVATAR_EM_BRANCO, carregarAvataresDe, type AvatarConfig } from "@/lib/avatar-3d";

/* O mesmo boneco do Início, dando tchauzinho com carinha feliz (06/11/2026:
   "em vez de ficar pulando, dar tchau, igual no começo"). É um 3D vivo — um
   <Canvas> por pessoa do pódio, só três por post — carregado sob demanda. */
const AvatarAcenando = lazy(() =>
  import("@/components/avatar-acenando").then((m) => ({ default: m.AvatarAcenando })),
);

/*
 * Banner do ranking "Conecta em números" no Mural (06/11/2026).
 *
 * Pedido do Eduardo: "os avatares nos pódios, animados, felizes, caindo
 * confetes neles; do lado os nomes do 4 ao 10; e um clique para baixar a lista
 * completa" (o botão de baixar é o anexo PDF do post — ver `ArquivosDoPost`).
 *
 * Os dados vêm do próprio texto do post, uma linha por colocação:
 *     1º Nome da Pessoa — 541
 * e a pessoa é achada entre os homenageados pelo nome. Assim o post continua
 * legível em qualquer versão antiga da tela (ela mostra o texto puro), e não
 * precisa de coluna nova no banco.
 */

type Colocado = { pos: number; nome: string; valor: string; id: string | null };

const LINHA = /^\s*(\d{1,2})\s*[ºo°]\s+(.+?)\s+[—–-]\s+([\d.]+)\s*$/;

const norma = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function lerRanking(texto: string, homenageados: string[], nomeDe: (id: string) => string) {
  const linhas = texto.split(/\r?\n/);
  const colocados: Colocado[] = [];
  const antes: string[] = [];
  const depois: string[] = [];
  for (const l of linhas) {
    const m = LINHA.exec(l);
    if (m) {
      const nome = m[2].trim();
      const id = homenageados.find((h) => norma(nomeDe(h)) === norma(nome)) ?? null;
      colocados.push({ pos: Number(m[1]), nome, valor: m[3], id });
    } else if (l.trim()) {
      (colocados.length ? depois : antes).push(l.trim());
    }
  }
  colocados.sort((a, b) => a.pos - b.pos);
  return { colocados, intro: antes.join(" "), fecho: depois.join(" ") };
}

const curto = (nome: string) => {
  const p = nome.split(" ").filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return p.length > 1 ? `${cap(p[0])} ${cap(p[p.length - 1])}` : cap(p[0] ?? "");
};

const iniciais = (nome: string) =>
  nome
    .split(" ")
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

/* ————————————————————————— confete ————————————————————————— */

const CORES = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444", "#14b8a6", "#facc15"];

function Confete() {
  const reduzir = useReducedMotion();
  const pecas = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        i,
        x: Math.random() * 100,
        atraso: Math.random() * 4,
        dur: 3.2 + Math.random() * 2.6,
        giro: (Math.random() - 0.5) * 720,
        deriva: (Math.random() - 0.5) * 60,
        w: 5 + Math.random() * 5,
        h: 8 + Math.random() * 6,
        cor: CORES[i % CORES.length],
        redondo: i % 4 === 0,
      })),
    [],
  );
  if (reduzir) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pecas.map((p) => (
        <motion.span
          key={p.i}
          className="absolute top-0"
          style={{
            left: `${p.x}%`,
            width: p.w,
            height: p.redondo ? p.w : p.h,
            background: p.cor,
            borderRadius: p.redondo ? "50%" : 2,
          }}
          initial={{ y: -20, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: 320, x: p.deriva, rotate: p.giro, opacity: [0, 1, 1, 0] }}
          transition={{ duration: p.dur, delay: p.atraso, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </div>
  );
}

/* ————————————————————————— pódio ————————————————————————— */

const DEGRAUS = {
  1: { altura: "h-24", cor: "from-amber-300 to-amber-500", tam: "h-44", atraso: 0 },
  2: { altura: "h-16", cor: "from-slate-300 to-slate-400", tam: "h-40", atraso: 1300 },
  3: { altura: "h-11", cor: "from-orange-300 to-orange-500", tam: "h-40", atraso: 2600 },
} as const;

/* ————————————————————————— avatar ————————————————————————— */

/** O avatar 3D da pessoa, acenando feliz; começa defasado para os três não acenarem juntos. */
function AvatarNoPodio({
  pessoa,
  atraso,
  className,
}: {
  pessoa: string;
  atraso: number;
  className?: string;
}) {
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  const [comecar, setComecar] = useState(atraso === 0);
  useEffect(() => {
    let vivo = true;
    carregarAvataresDe([pessoa])
      .then((m) => vivo && setConfig(m.get(pessoa) ?? AVATAR_EM_BRANCO))
      .catch(() => vivo && setConfig(AVATAR_EM_BRANCO));
    const t = atraso ? window.setTimeout(() => vivo && setComecar(true), atraso) : 0;
    return () => {
      vivo = false;
      if (t) window.clearTimeout(t);
    };
  }, [pessoa, atraso]);
  if (!config || !comecar) return null;
  return <AvatarAcenando config={config} humor="feliz" repetirAcenoMs={4200} className={className} />;
}

function NoPodio({ c, users }: { c: Colocado; users: { id: string; avatar?: string }[] }) {
  const d = DEGRAUS[c.pos as 1 | 2 | 3];
  const reduzir = useReducedMotion();
  const u = c.id ? users.find((x) => x.id === c.id) : undefined;
  return (
    <div className="flex w-[30%] min-w-0 flex-col items-center">
      {/* o boneco dando tchauzinho feliz em cima do degrau */}
      <div className={`relative w-full ${d.tam}`}>
        {c.id && !reduzir ? (
          <SoNoNavegador>
            <Suspense fallback={<IniciaisGrandes nome={c.nome} />}>
              <AvatarNoPodio pessoa={c.id} atraso={d.atraso} className="h-full w-full" />
            </Suspense>
          </SoNoNavegador>
        ) : (
          <IniciaisGrandes nome={c.nome} iniciaisProntas={u?.avatar} />
        )}
      </div>
      <p className="mt-1 w-full truncate text-center text-[12px] font-bold leading-tight" title={c.nome}>
        {curto(c.nome)}
      </p>
      <p className="text-[11px] font-semibold text-foreground/60 tabular-nums">{c.valor} tarefas</p>
      <div
        className={`mt-1 grid w-full place-items-center rounded-t-lg bg-gradient-to-b ${d.cor} ${d.altura} text-2xl font-black text-white shadow-inner`}
      >
        {c.pos}
      </div>
    </div>
  );
}

function IniciaisGrandes({ nome, iniciaisProntas }: { nome: string; iniciaisProntas?: string }) {
  return (
    <div className="grid h-full w-full place-items-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground shadow-md">
        {iniciaisProntas ?? iniciais(nome)}
      </span>
    </div>
  );
}

function SoNoNavegador({ children }: { children: ReactNode }) {
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);
  return pronto ? <>{children}</> : null;
}

/* ————————————————————————— o banner ————————————————————————— */

export function BannerDoRanking({
  titulo,
  texto,
  homenageados,
  users,
  nomeDe,
  criadoEm,
  menu,
}: {
  titulo: string | null;
  texto: string;
  homenageados: string[];
  users: { id: string; avatar?: string }[];
  nomeDe: (id: string) => string;
  criadoEm: string;
  menu: ReactNode;
}) {
  const { colocados, intro, fecho } = lerRanking(texto, homenageados, nomeDe);
  const podio = [2, 1, 3]
    .map((p) => colocados.find((c) => c.pos === p))
    .filter((c): c is Colocado => !!c);
  const resto = colocados.filter((c) => c.pos > 3);

  return (
    <div className="relative -mx-4 -mt-4 overflow-hidden bg-gradient-to-br from-teal-200 via-emerald-100 to-amber-100 px-5 pb-5 pt-4 dark:from-teal-500/25 dark:via-emerald-500/10 dark:to-transparent">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(circle,rgba(255,255,255,0.9)_1.5px,transparent_1.6px)] [background-size:22px_22px] dark:opacity-10"
      />

      <div className="relative flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-sm backdrop-blur dark:bg-black/30">
          <span aria-hidden>🏅</span> Conecta em números
        </span>
        <span className="text-[11px] font-medium text-foreground/60">
          CONECTA ·{" "}
          <time dateTime={criadoEm} title={new Date(criadoEm).toLocaleString("pt-BR")}>
            {formatRelative(criadoEm)}
          </time>
        </span>
        <span className="ml-auto">{menu}</span>
      </div>

      {titulo && (
        <h3 className="relative mt-3 font-display text-xl font-extrabold leading-snug tracking-tight">
          {titulo}
        </h3>
      )}
      {intro && <p className="relative mt-1 text-sm leading-relaxed text-foreground/80">{intro}</p>}

      <div className="relative mt-4 grid gap-4 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* pódio com confete */}
        <div className="relative rounded-xl bg-white/45 px-2 pt-3 dark:bg-white/5">
          <Confete />
          <div className="relative flex items-end justify-center gap-2">
            {podio.map((c) => (
              <NoPodio key={c.pos} c={c} users={users} />
            ))}
          </div>
        </div>

        {/* 4º ao 10º */}
        {resto.length > 0 && (
          <ol className="flex flex-col justify-center gap-1">
            {resto.map((c, i) => {
              const u = c.id ? users.find((x) => x.id === c.id) : undefined;
              return (
                <motion.li
                  key={c.pos}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.07 }}
                  className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 shadow-sm dark:bg-white/5"
                >
                  <span className="w-6 shrink-0 text-center text-xs font-black text-foreground/50">
                    {c.pos}º
                  </span>
                  <UserAvatar
                    nome={c.nome}
                    iniciais={u?.avatar ?? iniciais(c.nome)}
                    className="h-7 w-7 shrink-0 text-[10px]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={c.nome}>
                    {curto(c.nome)}
                  </span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-teal-700 dark:text-teal-300">
                    {c.valor}
                  </span>
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>

      {fecho && <p className="relative mt-3 text-sm font-medium text-foreground/80">{fecho}</p>}
    </div>
  );
}
