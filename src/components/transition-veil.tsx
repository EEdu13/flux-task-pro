import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { UserAvatar } from "@/components/user-avatar";

/**
 * Véu de transição entre a tela de login e o sistema.
 *
 * O corte seco entre as duas telas é feio porque elas não têm nada em comum —
 * uma é escura com aurora, a outra é o painel inteiro. O véu cobre, a troca
 * acontece escondida, e ele revela. De quebra, o momento morto vira confirmação
 * de quem entrou: aparece a foto e o nome da pessoa.
 *
 * Fica montado no `__root`, fora das rotas, senão desmontaria no meio da
 * navegação — que é exatamente quando ele precisa estar na tela.
 */

type Tipo = "entrada" | "saida";

interface Dados {
  tipo: Tipo;
  nome: string;
  iniciais: string;
}

const EVENTO_COBRIR = "fluxo:veu-cobrir";
const EVENTO_REVELAR = "fluxo:veu-revelar";

/**
 * Tempo do véu antes de trocarmos a tela por baixo.
 *
 * Calibrado para caber duas mensagens (a 900ms cada) sem virar espera chata.
 * Curto demais fica atropelado; longo demais irrita no décimo login do dia.
 */
const COBRIR_MS = 1900;
/** Respiro para a tela nova montar antes de reaparecer. */
const MONTAGEM_MS = 220;
/** Troca das mensagens de bastidor. */
const MENSAGEM_MS = 900;

/**
 * Mensagens de bastidor. Nenhuma descreve trabalho real — são para tornar a
 * espera simpática, então evitam prometer coisas que o sistema não está fazendo.
 */
const MENSAGENS_ENTRADA = [
  "Ajeitando as planilhas…",
  "Organizando as tarefas…",
  "Convocando a equipe…",
  "Conferindo os prazos…",
  "Separando seu pack do dia…",
  "Aquecendo o café…",
  "Alinhando as metas…",
];

const MENSAGENS_SAIDA = [
  "Guardando as planilhas…",
  "Salvando seu progresso…",
  "Fechando as salas…",
  "Apagando as luzes…",
];

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sorteia sem repetir a primeira, para não parecer sempre a mesma abertura. */
function sortearMensagens(lista: string[]): string[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
  }
  return copia;
}

/**
 * Executa `acao` escondida atrás do véu.
 *
 * Com movimento reduzido pedido pelo sistema, roda a ação direto — a animação
 * é enfeite, nunca pode ser o caminho obrigatório.
 */
export async function transicionar(dados: Dados, acao: () => void | Promise<void>) {
  if (typeof window === "undefined") {
    await acao();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await acao();
    return;
  }

  window.dispatchEvent(new CustomEvent(EVENTO_COBRIR, { detail: dados }));
  await esperar(COBRIR_MS);
  try {
    await acao();
  } finally {
    // Mesmo se a ação falhar, o véu precisa sair — senão a tela fica travada.
    await esperar(MONTAGEM_MS);
    window.dispatchEvent(new CustomEvent(EVENTO_REVELAR));
  }
}

export function TransitionVeil() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [visivel, setVisivel] = useState(false);
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const cobrir = (e: Event) => {
      const d = (e as CustomEvent<Dados>).detail;
      setDados(d);
      setMensagens(sortearMensagens(d.tipo === "saida" ? MENSAGENS_SAIDA : MENSAGENS_ENTRADA));
      setIndice(0);
      setVisivel(true);
    };
    const revelar = () => setVisivel(false);
    window.addEventListener(EVENTO_COBRIR, cobrir);
    window.addEventListener(EVENTO_REVELAR, revelar);
    return () => {
      window.removeEventListener(EVENTO_COBRIR, cobrir);
      window.removeEventListener(EVENTO_REVELAR, revelar);
    };
  }, []);

  // Roda as mensagens só enquanto o véu está na tela.
  useEffect(() => {
    if (!visivel || mensagens.length === 0) return;
    const id = window.setInterval(() => setIndice((i) => (i + 1) % mensagens.length), MENSAGEM_MS);
    return () => window.clearInterval(id);
  }, [visivel, mensagens.length]);

  const saida = dados?.tipo === "saida";

  return (
    <AnimatePresence onExitComplete={() => setDados(null)}>
      {visivel && dados && (
        <motion.div
          key="veu"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden"
          style={{ background: "var(--auth-base)" }}
          aria-hidden
        >
          {/* Mesmas manchas de aurora da tela de login: o véu parece a
              continuação dela, não uma terceira tela. */}
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ scale: 1.15, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          >
            <div
              className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-70 blur-3xl"
              style={{
                background: "radial-gradient(circle, var(--auth-deep) 0%, transparent 65%)",
              }}
            />
            <div
              className="absolute -bottom-40 -right-32 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
              style={{
                background: "radial-gradient(circle, var(--auth-glow) 0%, transparent 65%)",
              }}
            />
          </motion.div>

          {/* Anéis que pulsam a partir do avatar.
              Animam SCALE, não width/height: tamanho é propriedade de layout e
              obriga o navegador a recalcular a cada quadro — era daí que vinha
              o engasgo. Escala roda na GPU e fica lisa. */}
          {[0, 0.55].map((atraso) => (
            <motion.div
              key={atraso}
              className="pointer-events-none absolute h-24 w-24 rounded-full border will-change-transform"
              style={{ borderColor: "color-mix(in oklab, var(--auth-glow) 35%, transparent)" }}
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{ scale: 6.5, opacity: 0 }}
              transition={{
                duration: 2.2,
                ease: "easeOut",
                repeat: Infinity,
                delay: atraso,
              }}
            />
          ))}

          <div className="relative flex flex-col items-center gap-4 text-white">
            <motion.div
              initial={{ scale: saida ? 1 : 0.7, opacity: 0, y: saida ? 0 : 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: saida ? 0.9 : 1.08, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
            >
              <UserAvatar
                nome={dados.nome}
                iniciais={dados.iniciais}
                className="h-20 w-20 text-xl shadow-2xl ring-2 ring-white/25"
              />
            </motion.div>

            <motion.div
              className="text-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.4, ease: "easeOut" }}
            >
              <div className="text-lg font-semibold tracking-tight">
                {saida ? "Até logo" : "Bem-vindo"}, {dados.nome.split(" ")[0]}
              </div>
            </motion.div>

            {/* Mensagens de bastidor, trocando em rodízio. Altura fixa para a
                troca não empurrar a barra de progresso para cima e para baixo. */}
            <div className="flex h-5 items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={indice}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className="text-xs text-white/60"
                >
                  {mensagens[indice] ?? ""}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Barra de progresso indeterminada — dá ritmo à espera. */}
            <div className="mt-1 h-0.5 w-40 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full w-1/3 rounded-full"
                style={{
                  background: "linear-gradient(90deg, var(--auth-deep), var(--auth-glow))",
                }}
                animate={{ x: ["-120%", "320%"] }}
                transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
