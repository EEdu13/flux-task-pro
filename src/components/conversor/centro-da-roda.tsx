import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useAmbienteDoConversor } from "./ambiente";
import { oQueAceita, porQueNaoServe } from "./blocos";
import { Transicao } from "./transicao";
import type { Bloco, OrigemDaAtivacao, Realce, Trabalho } from "./tipos";

export type BlocoAtivo = {
  bloco: Bloco;
  origem: OrigemDaAtivacao;
  realce: Realce;
  trabalho?: Trabalho;
};

export type BlocoEmCurso = { bloco: Bloco; trabalho: Trabalho };

/**
 * O que o centro da roda diz (05/11/2026), por ordem de importância:
 *
 * 1. o bloco ativo (mouse, foco ou arquivo por cima): o grupo, o nome, a
 *    transição "de → para" e o que fazer — é o papel do título da música no
 *    meio da roda de rádio;
 * 2. com nada ativo, o que está convertendo, com o "Cancelar" — o mouse sai do
 *    bloco em direção ao centro, então o botão precisa estar aqui;
 * 3. um erro, que fica até a pessoa tentar de novo;
 * 4. o arquivo que chegou pela faixa do arrastar, esperando um bloco;
 * 5. o convite de sempre.
 *
 * Cada estado entra com um fade curto (a troca é por `key`), sem saída: o
 * mouse cruza vários blocos em pouco tempo, e esperar o anterior sair deixaria
 * o centro sempre um passo atrás.
 */
export function CentroDaRoda({
  ativo,
  emCurso,
  comErro,
  pendentes,
  compacto,
  aoCancelar,
  aoDescartar,
}: {
  ativo: BlocoAtivo | null;
  emCurso: BlocoEmCurso | null;
  comErro: BlocoEmCurso | null;
  pendentes: File[];
  /** Roda pequena (janela estreita): só o essencial. */
  compacto: boolean;
  aoCancelar: (bloco: Bloco) => void;
  aoDescartar: () => void;
}) {
  const chave = ativo
    ? `bloco-${ativo.bloco.id}-${ativo.origem}`
    : emCurso
      ? `curso-${emCurso.bloco.id}`
      : comErro
        ? `erro-${comErro.bloco.id}`
        : pendentes.length > 0
          ? "pendentes"
          : "inicio";

  return (
    <motion.div
      key={chave}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      className="flex w-full flex-col items-center gap-2 text-center text-white"
      aria-live="polite"
    >
      {ativo ? (
        <ConteudoDoBloco
          ativo={ativo}
          pendentes={pendentes}
          compacto={compacto}
          aoCancelar={aoCancelar}
        />
      ) : emCurso ? (
        <>
          <Sobretitulo>Convertendo</Sobretitulo>
          <Titulo compacto={compacto}>{emCurso.bloco.rotulo}</Titulo>
          <Andamento trabalho={emCurso.trabalho} aoCancelar={() => aoCancelar(emCurso.bloco)} />
        </>
      ) : comErro ? (
        <>
          <Sobretitulo>Não deu certo</Sobretitulo>
          <Titulo compacto={compacto}>{comErro.bloco.rotulo}</Titulo>
          <p
            className={`text-balance leading-snug text-red-300 ${compacto ? "text-xs" : "text-sm"}`}
            role="alert"
          >
            {comErro.trabalho.erro}
          </p>
        </>
      ) : pendentes.length > 0 ? (
        <>
          <Sobretitulo>Arquivo recebido</Sobretitulo>
          {/* Nome de arquivo é comprido: sempre no tamanho menor, e cortado em duas linhas. */}
          <Titulo compacto>
            {pendentes.length === 1 ? pendentes[0]!.name : `${pendentes.length} arquivos`}
          </Titulo>
          {!compacto && (
            <p className="text-balance text-sm text-white/70">
              O que você quer fazer com ele? Escolha um bloco aceso.
            </p>
          )}
          <button
            type="button"
            onClick={aoDescartar}
            className="mt-1 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 transition hover:bg-white/15"
          >
            Descartar
          </button>
        </>
      ) : (
        <>
          <Sobretitulo>Conversor</Sobretitulo>
          <Titulo compacto={compacto}>Converter arquivo</Titulo>
          <p className="text-balance text-sm text-white/70">
            {compacto
              ? "Toque num bloco para escolher o arquivo."
              : "Passe o mouse num bloco para ver o que ele faz."}
          </p>
          {!compacto && (
            <p className="text-balance text-xs text-white/45">
              Solte o arquivo em cima de um bloco, ou clique para escolher nas pastas.
            </p>
          )}
        </>
      )}
    </motion.div>
  );
}

/* ------------------------------- Pedaços ------------------------------- */

function Sobretitulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">{children}</p>
  );
}

function Titulo({ children, compacto }: { children: ReactNode; compacto: boolean }) {
  return (
    <h2
      className="line-clamp-2 max-w-full text-balance break-words font-bold leading-[1.1] tracking-tight text-white"
      style={{ fontSize: compacto ? 20 : 28 }}
    >
      {children}
    </h2>
  );
}

function Andamento({ trabalho, aoCancelar }: { trabalho: Trabalho; aoCancelar: () => void }) {
  const pct = Math.round(trabalho.progresso * 100);
  return (
    <div className="mt-1 flex w-full max-w-[15rem] flex-col items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-[var(--acento)] transition-[width] duration-300"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="text-xs text-white/70">Convertendo… {pct}%</p>
      <button
        type="button"
        onClick={aoCancelar}
        className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 transition hover:bg-white/15"
      >
        Cancelar
      </button>
    </div>
  );
}

function ConteudoDoBloco({
  ativo,
  pendentes,
  compacto,
  aoCancelar,
}: {
  ativo: BlocoAtivo;
  pendentes: File[];
  compacto: boolean;
  aoCancelar: (bloco: Bloco) => void;
}) {
  const { bloco, origem, realce, trabalho } = ativo;
  const motivo = porQueNaoServe(bloco, useAmbienteDoConversor());

  /* A frase de baixo, a mais importante primeiro. */
  let frase: ReactNode;
  if (motivo) {
    frase = motivo.frase;
  } else if (trabalho?.estado === "rodando") {
    frase = null; // o `Andamento` cuida
  } else if (trabalho?.estado === "erro") {
    frase = <span className="text-red-300">{trabalho.erro}</span>;
  } else if (realce === "nao") {
    frase = `Este bloco aceita: ${oQueAceita(bloco)}.`;
  } else if (origem === "arraste") {
    frase = "Solte para converter.";
  } else if (pendentes.length > 0 && realce === "sim") {
    frase = "Clique para converter o arquivo recebido.";
  } else {
    frase = "Clique para escolher o arquivo, ou solte-o aqui.";
  }

  /* Roda pequena: o convite de sempre ("Clique para escolher…") some, para o
     texto caber no miolo; o que muda o que a pessoa faz (erro, recusa, "em
     breve", solte aqui) continua. */
  const dizAlgoImportante =
    motivo !== null ||
    trabalho?.estado === "erro" ||
    realce === "nao" ||
    origem === "arraste" ||
    (pendentes.length > 0 && realce === "sim");

  return (
    <>
      <Sobretitulo>{bloco.grupo}</Sobretitulo>
      <Titulo compacto={compacto}>{bloco.rotulo}</Titulo>
      <Transicao de={bloco.de} para={bloco.para} compacto={compacto} />
      {trabalho?.estado === "rodando" ? (
        <Andamento trabalho={trabalho} aoCancelar={() => aoCancelar(bloco)} />
      ) : (
        (!compacto || dizAlgoImportante) && (
          <p
            className={`text-balance leading-snug text-white/75 ${compacto ? "text-xs" : "text-sm"}`}
            role={trabalho?.estado === "erro" ? "alert" : undefined}
          >
            {frase}
          </p>
        )
      )}
      {!compacto && (
        <p className="text-xs text-white/45">
          {bloco.soNoApp ? "No seu computador, pelo Office" : "No seu computador"}
          {bloco.varios && bloco.maximo ? ` · até ${bloco.maximo} arquivos` : ""}
        </p>
      )}
      {/* O que se perde no caminho, antes de soltar ou escolher o arquivo (12/11/2026). */}
      {!compacto && !motivo && trabalho?.estado !== "rodando" && (
        <p className="max-w-[17rem] text-balance text-[11px] leading-snug text-amber-200/80">
          {bloco.atencao}
        </p>
      )}
    </>
  );
}
