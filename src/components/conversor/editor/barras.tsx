import type { ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpRight,
  Bold,
  Circle,
  Highlighter,
  ImagePlus,
  Italic,
  Minus,
  MousePointer2,
  Pencil,
  Signature,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { CORES, type Estilo, type Familia, type Ferramenta, type Objeto } from "./modelo";

/*
 * As barras do Editor de PDF (05/11/2026): as ferramentas, e a do estilo, que mostra
 * só o que serve para o que está na mão: fonte para texto, traço para desenho.
 */

function BotaoDeFerramenta({
  ativo,
  rotulo,
  dica,
  aoClicar,
  children,
}: {
  ativo?: boolean;
  rotulo: string;
  dica: string;
  aoClicar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={dica}
      aria-pressed={ativo}
      data-ferramenta={rotulo}
      className={`flex flex-col items-center gap-0.5 rounded-xl px-2.5 py-1.5 text-[10px] font-semibold transition ${
        ativo
          ? "bg-[var(--acento)] text-neutral-950 shadow-[0_6px_18px_color-mix(in_oklab,var(--acento)_30%,transparent)]"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
      {rotulo}
    </button>
  );
}

export function BarraDeFerramentas({
  ferramenta,
  aoFerramenta,
  aoImagem,
  aoAssinatura,
}: {
  ferramenta: Ferramenta;
  aoFerramenta: (f: Ferramenta) => void;
  aoImagem: () => void;
  aoAssinatura: () => void;
}) {
  const icone = "h-[18px] w-[18px]";
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Ferramentas">
      <BotaoDeFerramenta
        rotulo="Editar"
        dica="Clique num texto do PDF para editar, ou num objeto para mover"
        ativo={ferramenta === "editar"}
        aoClicar={() => aoFerramenta("editar")}
      >
        <MousePointer2 className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Texto"
        dica="Clique na página para escrever um texto novo"
        ativo={ferramenta === "texto"}
        aoClicar={() => aoFerramenta("texto")}
      >
        <Type className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta rotulo="Imagem" dica="Pôr uma imagem na página" aoClicar={aoImagem}>
        <ImagePlus className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta rotulo="Assinatura" dica="Desenhar a assinatura" aoClicar={aoAssinatura}>
        <Signature className={icone} />
      </BotaoDeFerramenta>
      <span aria-hidden className="mx-1 h-8 w-px bg-white/10" />
      <BotaoDeFerramenta
        rotulo="Realce"
        dica="Arraste sobre o que quer realçar"
        ativo={ferramenta === "realce"}
        aoClicar={() => aoFerramenta("realce")}
      >
        <Highlighter className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Desenho"
        dica="Desenhe à mão livre"
        ativo={ferramenta === "desenho"}
        aoClicar={() => aoFerramenta("desenho")}
      >
        <Pencil className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Caixa"
        dica="Arraste para desenhar um retângulo"
        ativo={ferramenta === "retangulo"}
        aoClicar={() => aoFerramenta("retangulo")}
      >
        <Square className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Círculo"
        dica="Arraste para desenhar um círculo"
        ativo={ferramenta === "elipse"}
        aoClicar={() => aoFerramenta("elipse")}
      >
        <Circle className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Linha"
        dica="Arraste para desenhar uma linha"
        ativo={ferramenta === "linha"}
        aoClicar={() => aoFerramenta("linha")}
      >
        <Minus className={icone} />
      </BotaoDeFerramenta>
      <BotaoDeFerramenta
        rotulo="Seta"
        dica="Arraste para desenhar uma seta"
        ativo={ferramenta === "seta"}
        aoClicar={() => aoFerramenta("seta")}
      >
        <ArrowUpRight className={icone} />
      </BotaoDeFerramenta>
    </div>
  );
}

function Alternar({
  ativo,
  rotulo,
  aoClicar,
  children,
}: {
  ativo: boolean;
  rotulo: string;
  aoClicar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      className={`grid h-8 w-8 place-items-center rounded-lg transition ${
        ativo ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Cores({
  atual,
  rotulo,
  cores = CORES,
  aoEscolher,
}: {
  atual: string | null;
  rotulo: string;
  cores?: readonly string[];
  aoEscolher: (cor: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={rotulo}>
      {cores.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => aoEscolher(c)}
          aria-label={`${rotulo}: ${c}`}
          aria-pressed={atual === c}
          className={`h-5 w-5 rounded-full border-2 transition ${
            atual === c
              ? "scale-110 border-[var(--acento)]"
              : "border-white/25 hover:border-white/60"
          }`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={atual ?? "#000000"}
        onChange={(e) => aoEscolher(e.target.value)}
        aria-label={`${rotulo}: outra cor`}
        title="Outra cor"
        className="h-5 w-5 cursor-pointer appearance-none rounded-full border-0 bg-transparent p-0"
      />
    </div>
  );
}

const CORES_DE_REALCE = ["#fde047", "#86efac", "#7dd3fc", "#f9a8d4"] as const;

const separador = <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />;

/** O que dizer quando não há nada na mão: a barra fica lá, com a altura de sempre. */
const DICAS: Record<Ferramenta, string> = {
  editar: "Clique num texto do PDF para editar. O que você acrescentou, arraste para mover.",
  texto: "Clique na página para escrever.",
  realce: "Arraste sobre o que quer realçar. Esc termina.",
  desenho: "Desenhe com o mouse. Esc termina.",
  retangulo: "Arraste para desenhar.",
  elipse: "Arraste para desenhar.",
  linha: "Arraste para desenhar.",
  seta: "Arraste para desenhar.",
};

/**
 * A barra tem SEMPRE a mesma altura. Quando ela só aparecia com um objeto selecionado,
 * empurrava a página para baixo no clique, e o objeto saía de baixo do mouse: o segundo
 * clique de um clique duplo já caía em outro lugar (achado no teste de 05/11/2026).
 *
 * Enquanto uma caixa de texto é digitada, clicar aqui não pode tirar o foco dela:
 * o `preventDefault` no apertar do mouse mantém o cursor onde estava.
 */
export function BarraDeEstilo({
  ferramenta,
  estilo,
  selecionado,
  aoEstilo,
  aoApagar,
}: {
  ferramenta: Ferramenta;
  estilo: Estilo;
  selecionado: Objeto | null;
  aoEstilo: (novo: Partial<Estilo>) => void;
  aoApagar: () => void;
}) {
  const tipo = selecionado?.tipo;
  const deTexto = tipo ? tipo === "texto" : ferramenta === "texto";
  const deRealce = tipo ? tipo === "realce" : ferramenta === "realce";
  const deTraco = tipo
    ? ["retangulo", "elipse", "linha", "seta", "traco"].includes(tipo)
    : ["desenho", "retangulo", "elipse", "linha", "seta"].includes(ferramenta);
  const comPreenchimento = tipo
    ? tipo === "retangulo" || tipo === "elipse"
    : ferramenta === "retangulo" || ferramenta === "elipse";

  return (
    <div
      data-barra-de-estilo
      onMouseDown={(e) => {
        // Os campos precisam do foco; o resto, não.
        if (!(e.target as HTMLElement).closest("select, input")) e.preventDefault();
      }}
      className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-white/10 bg-zinc-900/95 px-4 text-xs text-white/70"
    >
      {!deTexto && !deRealce && !deTraco && !selecionado && (
        <span className="text-white/45">{DICAS[ferramenta]}</span>
      )}
      {deTexto && (
        <>
          <select
            value={estilo.familia}
            onChange={(e) => aoEstilo({ familia: e.target.value as Familia })}
            aria-label="Fonte"
            className="h-8 rounded-lg border border-white/15 bg-white/[0.06] px-2 text-xs text-white [&>option]:text-black"
          >
            <option value="sans">Arial</option>
            <option value="serif">Times New Roman</option>
            <option value="mono">Courier</option>
          </select>
          <input
            type="number"
            min={6}
            max={96}
            value={estilo.tamanho}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 200) aoEstilo({ tamanho: v });
            }}
            aria-label="Tamanho da letra"
            className="h-8 w-14 rounded-lg border border-white/15 bg-white/[0.06] px-2 text-xs text-white"
          />
          <Alternar
            ativo={estilo.negrito}
            rotulo="Negrito"
            aoClicar={() => aoEstilo({ negrito: !estilo.negrito })}
          >
            <Bold className="h-4 w-4" />
          </Alternar>
          <Alternar
            ativo={estilo.italico}
            rotulo="Itálico"
            aoClicar={() => aoEstilo({ italico: !estilo.italico })}
          >
            <Italic className="h-4 w-4" />
          </Alternar>
          {separador}
          <Alternar
            ativo={estilo.alinhamento === "esquerda"}
            rotulo="Alinhar à esquerda"
            aoClicar={() => aoEstilo({ alinhamento: "esquerda" })}
          >
            <AlignLeft className="h-4 w-4" />
          </Alternar>
          <Alternar
            ativo={estilo.alinhamento === "centro"}
            rotulo="Centralizar"
            aoClicar={() => aoEstilo({ alinhamento: "centro" })}
          >
            <AlignCenter className="h-4 w-4" />
          </Alternar>
          <Alternar
            ativo={estilo.alinhamento === "direita"}
            rotulo="Alinhar à direita"
            aoClicar={() => aoEstilo({ alinhamento: "direita" })}
          >
            <AlignRight className="h-4 w-4" />
          </Alternar>
          {separador}
          <Cores
            atual={estilo.corDoTexto}
            rotulo="Cor do texto"
            aoEscolher={(c) => aoEstilo({ corDoTexto: c })}
          />
        </>
      )}
      {deRealce && (
        <Cores
          atual={estilo.corDoRealce}
          rotulo="Cor do realce"
          cores={CORES_DE_REALCE}
          aoEscolher={(c) => aoEstilo({ corDoRealce: c })}
        />
      )}
      {deTraco && (
        <>
          <Cores
            atual={estilo.corDoTraco}
            rotulo="Cor do traço"
            aoEscolher={(c) => aoEstilo({ corDoTraco: c })}
          />
          {separador}
          <label className="flex items-center gap-2">
            Espessura
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={estilo.espessura}
              onChange={(e) => aoEstilo({ espessura: Number(e.target.value) })}
              className="w-24 accent-[var(--acento)]"
            />
          </label>
        </>
      )}
      {comPreenchimento && (
        <>
          {separador}
          <Alternar
            ativo={estilo.preenchimento === null}
            rotulo="Sem preenchimento"
            aoClicar={() => aoEstilo({ preenchimento: null })}
          >
            <Minus className="h-4 w-4" />
          </Alternar>
          <Cores
            atual={estilo.preenchimento}
            rotulo="Preenchimento"
            aoEscolher={(c) => aoEstilo({ preenchimento: c })}
          />
        </>
      )}
      {selecionado && (
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={aoApagar}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-red-300 transition hover:bg-red-500/15"
          >
            <Trash2 className="h-3.5 w-3.5" /> Apagar
          </button>
        </>
      )}
    </div>
  );
}
