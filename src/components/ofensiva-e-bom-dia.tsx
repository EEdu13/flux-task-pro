import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Ofensiva } from "@/lib/ofensiva";
import type { Compromisso } from "@/lib/compromisso";

/* ————————————————— Ofensiva (19/10/2026) ————————————————— */

/**
 * A ofensiva do pack no Início, no lugar do "Seu ritmo" (pedido do usuário:
 * "remover esse ritmo e colocar a ofensiva semanal"): a chama com os dias
 * seguidos, a tirinha da semana (seg–sex) e a frase do que fazer agora.
 */
export function OfensivaSemanal({
  ofensiva,
  faltamHoje,
}: {
  ofensiva: Ofensiva;
  /** Quantas tarefas do pack de hoje ainda faltam. */
  faltamHoje: number;
}) {
  const reduzir = !!useReducedMotion();
  const { seguidos, recorde, estado, semana } = ofensiva;
  const acesa = estado === "acesa";
  const frase =
    estado === "acesa"
      ? "Pack de hoje fechado — a chama está acesa!"
      : estado === "em-risco"
        ? `Feche o pack de hoje para manter a ofensiva${faltamHoje > 0 ? ` (faltam ${faltamHoje})` : ""}.`
        : estado === "perdida"
          ? "A ofensiva apagou 😢 Feche o pack hoje para recomeçar."
          : "Marque a ★ nas tarefas do seu dia para começar uma ofensiva.";

  return (
    <div className="rounded-xl px-1">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Ofensiva do pack
        </span>
        {recorde > 0 && (
          <span className="text-[11px] text-muted-foreground">recorde {recorde} dias</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <motion.div
          className="relative grid h-16 w-16 shrink-0 place-items-center"
          animate={acesa && !reduzir ? { scale: [1, 1.08, 1] } : undefined}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <span
            className={`select-none text-5xl leading-none transition ${
              acesa ? "" : estado === "em-risco" ? "opacity-70 saturate-50" : "opacity-40 grayscale"
            }`}
            aria-hidden
          >
            🔥
          </span>
          <span
            className={`absolute -bottom-1 rounded-full px-2 text-sm font-black tabular-nums shadow ${
              acesa
                ? "bg-orange-500 text-white"
                : estado === "perdida"
                  ? "bg-slate-400 text-white"
                  : "bg-card text-orange-600 ring-1 ring-orange-400/50"
            }`}
          >
            {seguidos}
          </span>
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold leading-tight">
            {seguidos} {seguidos === 1 ? "dia seguido" : "dias seguidos"}
          </div>
          <p
            className={`text-xs ${estado === "perdida" ? "text-destructive" : estado === "em-risco" ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
          >
            {frase}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {semana.map((d) => (
          <div key={d.dia} className="flex flex-col items-center gap-1">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full text-sm ${
                d.situacao === "fechado"
                  ? "bg-orange-500 text-white shadow-sm shadow-orange-500/40"
                  : d.situacao === "quebrou"
                    ? "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
                    : d.situacao === "hoje"
                      ? "border-2 border-dashed border-orange-400 text-orange-500"
                      : "bg-secondary text-muted-foreground/50"
              }`}
              title={
                d.situacao === "fechado"
                  ? "Pack fechado"
                  : d.situacao === "quebrou"
                    ? "Pack não fechou"
                    : d.situacao === "hoje"
                      ? "Hoje — ainda dá tempo"
                      : d.situacao === "sem-pack"
                        ? "Sem pack neste dia"
                        : ""
              }
            >
              {d.situacao === "fechado"
                ? "🔥"
                : d.situacao === "quebrou"
                  ? "✕"
                  : d.situacao === "hoje"
                    ? "•"
                    : ""}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">{d.rotulo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————————————————— Bom dia (19/10/2026) ————————————————— */

export type DadosDoBomDia = {
  nome: string;
  packTotal: number;
  packFeitas: number;
  atrasadas: number;
  vencemHoje: number;
  compromissos: Compromisso[];
  aniversariantes: string[];
  ofensiva: Ofensiva;
};

/** As frases do avatar, na ordem do que mais importa. */
export function frasesDoBomDia(d: DadosDoBomDia, agora: Date = new Date()): string[] {
  const h = agora.getHours();
  const saudacao = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const emoji = h < 12 ? "☀️" : h < 18 ? "🌤️" : "🌙";
  const frases = [`${saudacao}, ${d.nome}! ${emoji}`];

  if (d.packTotal > 0) {
    const faltam = d.packTotal - d.packFeitas;
    frases.push(
      faltam === 0
        ? `Seu pack de hoje está fechado: ${d.packTotal} de ${d.packTotal}. Mandou bem! 🎉`
        : `Seu pack de hoje tem ${d.packTotal} ${d.packTotal === 1 ? "tarefa" : "tarefas"} — ${d.packFeitas === 0 ? "nenhuma feita ainda" : `${d.packFeitas} já ${d.packFeitas === 1 ? "foi" : "foram"}`}.`,
    );
  } else frases.push("Você ainda não montou o pack de hoje. Marca a ★ no que é do seu dia.");

  if (d.atrasadas > 0)
    frases.push(
      `Tem ${d.atrasadas} ${d.atrasadas === 1 ? "tarefa atrasada" : "tarefas atrasadas"} esperando você${d.vencemHoje > 0 ? ` e ${d.vencemHoje} ${d.vencemHoje === 1 ? "vence" : "vencem"} hoje` : ""}.`,
    );
  else if (d.vencemHoje > 0)
    frases.push(`${d.vencemHoje} ${d.vencemHoje === 1 ? "tarefa vence" : "tarefas vencem"} hoje.`);

  const proximos = d.compromissos
    .filter((c) => new Date(c.fim).getTime() > agora.getTime())
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  if (proximos.length > 0) {
    const p = proximos[0]!;
    const hora = new Date(p.inicio).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    frases.push(
      proximos.length === 1
        ? `Na agenda: ${p.assunto} às ${hora}. 📅`
        : `Você tem ${proximos.length} compromissos hoje — o próximo é ${p.assunto}, às ${hora}. 📅`,
    );
  }

  if (d.aniversariantes.length > 0)
    frases.push(`Hoje é aniversário de ${juntar(d.aniversariantes)}! Manda um parabéns 🎂`);

  const o = d.ofensiva;
  if (o.carregado) {
    if (o.estado === "perdida") frases.push("A ofensiva apagou ontem 😢 Bora recomeçar hoje?");
    else if (o.estado === "em-risco" && o.seguidos > 0)
      frases.push(
        `🔥 ${o.seguidos} ${o.seguidos === 1 ? "dia seguido" : "dias seguidos"} — feche o pack pra não perder!`,
      );
    else if (o.estado === "acesa" && o.seguidos > 1)
      frases.push(`🔥 ${o.seguidos} dias seguidos de pack fechado. Que constância!`);
  }
  return frases;
}

const juntar = (n: string[]) =>
  n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;

/**
 * O balão de fala do avatar do Início (19/10/2026: "colocar as informações
 * como se ele estivesse falando… vem tipo digitando"). Na primeira vez do dia
 * as frases aparecem letra a letra; depois, já prontas — digitar de novo a
 * cada volta ao Início cansaria. Com movimento reduzido, sempre prontas.
 */
export function BalaoDoBomDia({ frases, chaveDoDia }: { frases: string[]; chaveDoDia: string }) {
  const reduzir = !!useReducedMotion();
  const texto = useMemo(() => frases.join("\n"), [frases]);
  const [jaViu] = useState(() => {
    try {
      return window.localStorage.getItem(chaveDoDia) === "1";
    } catch {
      return false;
    }
  });
  const [mostrados, setMostrados] = useState(jaViu || reduzir ? Infinity : 0);

  useEffect(() => {
    if (mostrados >= texto.length) {
      try {
        window.localStorage.setItem(chaveDoDia, "1");
      } catch {
        /* sem armazenamento: digita de novo na próxima */
      }
      return;
    }
    // A primeira frase mais devagar; quebra de linha dá uma pausa, como quem pensa.
    const proximo = texto[mostrados];
    const espera = proximo === "\n" ? 380 : mostrados < frases[0]!.length ? 38 : 18;
    const id = window.setTimeout(() => setMostrados((n) => n + 1), espera);
    return () => window.clearTimeout(id);
  }, [mostrados, texto, frases, chaveDoDia]);

  const visivel = texto.slice(0, mostrados);
  const linhas = visivel.split("\n");
  const digitando = mostrados < texto.length;

  return (
    <div className="relative mt-3 max-w-md">
      <div className="relative rounded-2xl rounded-tr-sm border border-border bg-background/90 px-4 py-3 shadow-sm backdrop-blur">
        {/* o rabinho do balão, apontando para o avatar à direita */}
        <span
          aria-hidden
          className="absolute -right-2 top-4 h-4 w-4 rotate-45 border-r border-t border-border bg-background/90"
        />
        <div className="space-y-1 text-sm leading-relaxed" aria-live="polite">
          {linhas.map((l, i) => (
            <p key={i} className={i === 0 ? "font-semibold" : "text-foreground/85"}>
              {l}
              {digitando && i === linhas.length - 1 && (
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary" />
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
