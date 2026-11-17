import { lazy, Suspense, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import { ESTILO_DO_ACENTO } from "./acento";
import { LimiteDeErro } from "./limite-de-erro";
import { PreviaLateral } from "./previa-lateral";
import { RodaDeConversao } from "./roda-de-conversao";
import { temArquivo } from "./so-arquivo";
import { Transicao } from "./transicao";
import type { Bloco, IdDoBloco, OpcoesDoBloco, Realce, TelaDaPaleta, Trabalho } from "./tipos";
import { useLadoDaRoda } from "./use-lado-da-roda";

/* As telas intermediárias carregam só quando um bloco precisa delas. */
const Etapa = lazy(() => import("./etapas"));
const EditorDePdf = lazy(() => import("./editor/editor-pdf"));

/**
 * Empurra o painel para a esquerda em tela de notebook, para sobrar 34rem à
 * direita: é onde a prévia lateral abre (05/11/2026). Sem isto, em 1366 px a
 * página aparecia com 259 px de largura, ilegível. Em tela larga o painel fica
 * no centro, e a margem da esquerda nunca passa de 1rem.
 *
 * A reserva é fixa, e não só quando a prévia abre: o painel andando no meio do
 * gesto tiraria a miniatura de baixo do mouse.
 */
const RESERVA_PARA_A_PREVIA =
  "max(0px, min(calc(68rem - 100vw + min(94vw, 46rem)), calc(100vw - min(94vw, 46rem) - 2rem)))";

/**
 * A paleta de conversão (04/11/2026): o modal que abre segurando o Ctrl, pelo
 * raio, pela barra lateral ou pelo Ctrl+K. Desde 05/11/2026 ela é uma RODA —
 * os blocos num círculo, o centro dizendo o que o bloco sob o mouse faz —, e
 * a tela intermediária de alguns blocos (ordenar, páginas, girar, formato)
 * entra no lugar dela, num painel.
 *
 * O fundo é um véu escuro com degradê, SEM `backdrop-blur`: o desfoque sobre a
 * tela inteira era refeito a cada quadro das animações e travava notebook de
 * escritório (a mesma decisão da agenda do dia, em `agenda-do-dia.tsx`).
 *
 * Camada `z-[445]`: acima do diálogo da tarefa (`z-420`, `task-dialog.tsx`) e
 * do modo foco (`z-440`, `focus-overlay.tsx`), abaixo do alerta de compromisso
 * (`z-455`) e da confirmação (`z-500`, `confirm-dialog.tsx`). O Esc com uma
 * confirmação aberta por cima é dela, não da paleta.
 *
 * O conteúdo do diálogo ocupa a tela inteira e é transparente: clicar no vazio
 * (fora dos blocos e do painel) cai nele e fecha. O mesmo vale para soltar um
 * arquivo no vazio: ele vira "arquivo recebido", à espera de um bloco.
 */
export function PaletaDeConversao({
  aberto,
  aoFechar,
  aoSujarEtapa,
  tela,
  blocos,
  realceDe,
  trabalhos,
  pendentes,
  aoEscolher,
  aoSoltar,
  aoCancelar,
  aoDescartarPendentes,
  aoReceberArquivos,
  aoTrocarArquivos,
  aoVoltar,
  aoConverter,
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** A tela intermediária avisa quando a pessoa já escolheu algo (páginas, giros) que fechar perderia. */
  aoSujarEtapa: (sujo: boolean) => void;
  tela: TelaDaPaleta;
  blocos: readonly Bloco[];
  realceDe: (bloco: Bloco) => Realce;
  trabalhos: Partial<Record<IdDoBloco, Trabalho>>;
  /** Arquivos soltos fora dos blocos, esperando a pessoa escolher o que fazer. */
  pendentes: File[];
  aoEscolher: (bloco: Bloco) => void;
  aoSoltar: (bloco: Bloco, arquivos: File[]) => void;
  aoCancelar: (bloco: Bloco) => void;
  aoDescartarPendentes: () => void;
  /** Arquivos soltos no vazio da paleta. */
  aoReceberArquivos: (arquivos: File[]) => void;
  aoTrocarArquivos: (arquivos: File[]) => void;
  aoVoltar: () => void;
  aoConverter: (bloco: Bloco, arquivos: File[], opcoes: OpcoesDoBloco) => void;
}) {
  const lado = useLadoDaRoda();
  const conteudo = useRef<HTMLDivElement>(null);
  const blocoDaEtapa =
    tela.tipo === "etapa" ? blocos.find((b) => b.id === tela.blocoId) : undefined;
  const naEtapa = tela.tipo === "etapa" && !!blocoDaEtapa;
  const IconeDoBloco = blocoDaEtapa?.icone;

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={conteudo}
          className="fixed inset-0 z-[445] flex items-center justify-center outline-none"
          onEscapeKeyDown={(e) => {
            // A confirmação ou o alerta de compromisso por cima: o Esc é deles.
            if (document.querySelector('[role="alertdialog"]')) e.preventDefault();
            // Arrastando um arquivo na lista de ordenar: o Esc cancela o arraste, e não a paleta.
            if (document.querySelector("[data-arrastando-lista]")) e.preventDefault();
            // No Editor de PDF o Esc é dele: cancela a ferramenta, e pergunta antes de perder o trabalho.
            if (document.querySelector("[data-editor-pdf]")) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            /* Para o Radix, tudo fora do diálogo é "clicar fora" e fecha. Um aviso ou a
               confirmação por cima não são: fechavam junto, e no Editor de PDF isso perdia
               todo o trabalho sem perguntar. O Editor só sai pela pergunta de salvar. */
            const alvo = e.detail.originalEvent.target;
            const porCima =
              alvo instanceof Element &&
              !!alvo.closest('[data-sonner-toaster], [role="alertdialog"]');
            if (porCima || document.querySelector("[data-editor-pdf]")) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            // Sem isto o foco iria para o primeiro bloco, que já abriria "ativo".
            const roda = conteudo.current?.querySelector<HTMLElement>("[data-roda]");
            if (!roda) return;
            e.preventDefault();
            roda.focus({ preventScroll: true });
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) aoFechar();
          }}
          onDragOver={(e) => {
            if (!temArquivo(e) || e.defaultPrevented) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = naEtapa ? "none" : "copy";
          }}
          onDrop={(e) => {
            if (!temArquivo(e) || e.defaultPrevented) return;
            e.preventDefault();
            if (!naEtapa) aoReceberArquivos(Array.from(e.dataTransfer.files));
          }}
        >
          {/* O véu: mais escuro nas bordas, para o olho ir ao centro. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at center, rgb(0 0 0 / 0.64) 0%, rgb(0 0 0 / 0.82) 60%, rgb(0 0 0 / 0.92) 100%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          />

          <AnimatePresence mode="wait">
            {naEtapa && blocoDaEtapa?.etapa === "editar" && tela.tipo === "etapa" ? (
              <motion.div
                key="editor"
                className="absolute inset-0"
                style={ESTILO_DO_ACENTO}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <DialogPrimitive.Title className="sr-only">
                  {blocoDaEtapa.rotulo}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {blocoDaEtapa.dica}
                </DialogPrimitive.Description>
                <LimiteDeErro aoVoltar={aoVoltar}>
                  <Suspense
                    fallback={
                      <p className="grid h-full place-items-center bg-zinc-950 text-sm text-white/60">
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Preparando o editor…
                        </span>
                      </p>
                    }
                  >
                    <EditorDePdf
                      bloco={blocoDaEtapa}
                      arquivo={tela.arquivos[0]!}
                      aoVoltar={aoVoltar}
                      aoFechar={aoFechar}
                    />
                  </Suspense>
                </LimiteDeErro>
              </motion.div>
            ) : naEtapa && blocoDaEtapa && tela.tipo === "etapa" ? (
              <motion.div
                key="etapa"
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
                style={{ ...ESTILO_DO_ACENTO, marginRight: RESERVA_PARA_A_PREVIA }}
                className="relative flex max-h-[88vh] w-[min(94vw,46rem)] flex-col"
              >
                {/* A casca não recorta nada: a moldura do painel (que recorta os cantos) fica dentro
                    dela, e a prévia lateral — que passa da borda do painel — fica ao lado. */}
                <PreviaLateral>
                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-white/15 bg-zinc-900/95 text-white shadow-[0_30px_90px_rgb(0_0_0/0.6)]">
                    {/* O clarão suave no alto, na cor de destaque: o mesmo que fica atrás da roda. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-0 h-44"
                      style={{
                        background:
                          "radial-gradient(ellipse at 50% 0%, color-mix(in oklab, var(--acento) 18%, transparent), transparent 70%)",
                      }}
                    />
                    <div className="relative flex items-start gap-4 px-6 pb-4 pt-6">
                      {/* O ícone do bloco escolhido, num círculo com o aro de destaque — o bloco ativo da roda. */}
                      <span
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[var(--acento)] bg-white/10 text-white"
                        style={{
                          boxShadow:
                            "0 0 0 3px color-mix(in oklab, var(--acento) 30%, transparent), 0 10px 30px color-mix(in oklab, var(--acento) 35%, transparent)",
                        }}
                      >
                        {IconeDoBloco && (
                          <IconeDoBloco className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">
                          {blocoDaEtapa.grupo}
                        </p>
                        <DialogPrimitive.Title className="text-2xl font-bold leading-tight tracking-tight text-white">
                          {blocoDaEtapa.rotulo}
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="sr-only">
                          {blocoDaEtapa.dica}
                        </DialogPrimitive.Description>
                        <div className="mt-2.5">
                          <Transicao
                            de={blocoDaEtapa.de}
                            para={blocoDaEtapa.para}
                            alinhar="inicio"
                          />
                        </div>
                        {/* O que se perde no caminho, antes de converter (12/11/2026). */}
                        <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-snug text-amber-200/85">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span>{blocoDaEtapa.atencao}</span>
                        </p>
                      </div>
                      <kbd className="mt-1 hidden rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70 sm:inline">
                        Esc
                      </kbd>
                      <DialogPrimitive.Close
                        className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
                        aria-label="Fechar o conversor"
                      >
                        <X className="h-5 w-5" />
                      </DialogPrimitive.Close>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                      <LimiteDeErro aoVoltar={aoVoltar}>
                        <Suspense
                          fallback={
                            <p className="flex items-center justify-center gap-2 py-10 text-sm text-white/60">
                              <Loader2 className="h-4 w-4 animate-spin" /> Preparando…
                            </p>
                          }
                        >
                          <Etapa
                            bloco={blocoDaEtapa}
                            arquivos={tela.arquivos}
                            aoTrocarArquivos={aoTrocarArquivos}
                            aoVoltar={aoVoltar}
                            aoSujar={aoSujarEtapa}
                            aoConverter={(opcoes) =>
                              aoConverter(blocoDaEtapa, tela.arquivos, opcoes)
                            }
                          />
                        </Suspense>
                      </LimiteDeErro>
                    </div>
                  </div>
                </PreviaLateral>
              </motion.div>
            ) : (
              <motion.div
                key="roda"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={ESTILO_DO_ACENTO}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <DialogPrimitive.Title className="sr-only">Converter arquivo</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  Solte o arquivo num bloco, ou clique para escolher nas pastas.
                </DialogPrimitive.Description>

                <RodaDeConversao
                  blocos={blocos}
                  lado={lado}
                  realceDe={realceDe}
                  trabalhos={trabalhos}
                  pendentes={pendentes}
                  aoEscolher={aoEscolher}
                  aoSoltar={aoSoltar}
                  aoCancelar={aoCancelar}
                  aoDescartarPendentes={aoDescartarPendentes}
                />

                {/* `--titlebar-h` é a barra de título do app de mesa; no navegador não existe. */}
                <DialogPrimitive.Close
                  className="pointer-events-auto absolute right-4 rounded-full p-2 text-white/70 transition hover:bg-white/15 hover:text-white"
                  style={{ top: "calc(var(--titlebar-h, 0px) + 1rem)" }}
                  aria-label="Fechar o conversor"
                >
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>

                <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap text-xs text-white/55">
                  <span className="flex items-center gap-1.5">
                    <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/80">
                      Esc
                    </kbd>
                    fechar
                  </span>
                  <span aria-hidden className="hidden sm:inline">
                    ·
                  </span>
                  <span className="hidden items-center gap-1.5 sm:flex">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--acento)]" aria-hidden />
                    Tudo roda no seu computador: o arquivo não sai daqui
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
