import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useFluxo } from "@/lib/fluxo-store";
import { fazAniversarioHojeId } from "@/lib/aniversario-hoje";
import { useAniversariosDeHoje } from "@/lib/festa-de-aniversario";

/*
 * O aniversário de quem abre o app (19/10/2026, "chuva de confete"): na
 * primeira vez do dia, a tela enche de confete e aparece o cartão com o
 * avatar comemorando (de chapéu de festa, que fica 24h). O botão leva aos
 * recados — os comentários no cartão de aniversário do mural, onde o time
 * deixa os parabéns. Uma vez por dia (localStorage).
 *
 * Para ver sem ser aniversário: `?aniversario=1` na URL.
 */

const AvatarComemorando = lazy(() => import("@/components/mural/avatar-comemorando"));
const CORES = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

export function ConfeteDeAniversario() {
  const { currentUser } = useFluxo();
  const versao = useAniversariosDeHoje();
  const navigate = useNavigate();
  const reduzir = !!useReducedMotion();
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!currentUser?.id) return;
    const teste = new URLSearchParams(window.location.search).get("aniversario") === "1";
    if (!teste && !fazAniversarioHojeId(currentUser.id)) return;
    const chave = `fluxo:aniversario-visto:${currentUser.id}:${new Date().toLocaleDateString("sv-SE")}`;
    try {
      if (!teste && window.localStorage.getItem(chave)) return;
    } catch {
      /* sem armazenamento: mostra mesmo assim */
    }
    // Marca como visto só quando aparece: se a tela recomeçar antes, mostra depois.
    const id = window.setTimeout(() => {
      try {
        if (!teste) window.localStorage.setItem(chave, "1");
      } catch {
        /* ok */
      }
      setAberto(true);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [currentUser?.id, versao]);

  const pedacos = useMemo(
    () =>
      Array.from({ length: reduzir ? 0 : 90 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        cor: CORES[i % CORES.length]!,
        largura: 6 + Math.random() * 8,
        altura: 10 + Math.random() * 10,
        atraso: Math.random() * 2.5,
        duracao: 3 + Math.random() * 2.5,
        giro: (Math.random() - 0.5) * 900,
        deriva: (Math.random() - 0.5) * 160,
        redondo: i % 4 === 0,
      })),
    [reduzir],
  );

  const primeiro = (currentUser?.name ?? "").split(" ")[0] ?? "";
  const nome = primeiro.charAt(0) + primeiro.slice(1).toLowerCase();

  return (
    <AnimatePresence>
      {aberto && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[480] grid place-items-center overflow-hidden bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setAberto(false)}
        >
          {pedacos.map((p) => (
            <motion.span
              key={p.id}
              className="pointer-events-none absolute top-0"
              style={{
                left: `${p.x}%`,
                width: p.largura,
                height: p.redondo ? p.largura : p.altura,
                background: p.cor,
                borderRadius: p.redondo ? "9999px" : 2,
              }}
              initial={{ y: "-10vh", x: 0, rotate: 0, opacity: 1 }}
              animate={{ y: "110vh", x: p.deriva, rotate: p.giro }}
              transition={{
                duration: p.duracao,
                delay: p.atraso,
                ease: "easeIn",
                repeat: 2,
                repeatDelay: Math.random(),
              }}
            />
          ))}

          <motion.div
            initial={{ scale: 0.6, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 240, damping: 16, delay: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md overflow-hidden rounded-3xl bg-gradient-to-br from-fuchsia-500 via-pink-500 to-amber-400 p-6 text-center text-white shadow-2xl"
          >
            <span
              aria-hidden
              className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-white/15"
            />
            <span
              aria-hidden
              className="absolute -bottom-12 -right-8 h-44 w-44 rounded-full bg-white/10"
            />
            <div className="relative mx-auto h-44 w-44">
              <Suspense
                fallback={<div className="grid h-full place-items-center text-7xl">🎂</div>}
              >
                <AvatarComemorando pessoa={currentUser.id} className="h-44 w-44" />
              </Suspense>
            </div>
            <h2 className="relative font-display text-3xl font-black leading-tight">
              Feliz aniversário, {nome}! 🎂
            </h2>
            <p className="relative mt-2 text-sm font-medium text-white/90">
              Hoje o dia é seu. Seu avatar está de chapéu de festa até amanhã — e o time já pode
              deixar recados para você no mural.
            </p>
            <div className="relative mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAberto(false);
                  void navigate({ to: "/mural" });
                }}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-black text-pink-600 shadow-lg transition hover:scale-105"
              >
                Ver meus recados 💌
              </button>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-full bg-white/20 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/30"
              >
                Obrigado! 🎉
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
