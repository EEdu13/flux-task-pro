import { useMemo, useState, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { ESTILO_DO_ACENTO } from "./acento";
import { CentroDaRoda, type BlocoAtivo, type BlocoEmCurso } from "./centro-da-roda";
import { NoDaRoda } from "./no-da-roda";
import type { Bloco, IdDoBloco, OrigemDaAtivacao, Realce, Trabalho } from "./tipos";

/**
 * A geometria da roda para um quadrado de `lado` pixels e `n` blocos.
 *
 * Os blocos ficam num círculo de raio 37,5% do lado, começando no alto e indo
 * no sentido do relógio. O diâmetro de cada um é o menor entre 16,5% do lado e
 * 80% do espaço que ele tem no arco: com os 15 blocos do catálogo inteiro, eles
 * encolhem e não se encostam. O miolo (onde mora o texto) é o
 * que sobra por dentro, já descontando o quanto o bloco ativo cresce.
 */
function geometria(lado: number, n: number) {
  const centro = lado / 2;
  const raio = lado * 0.375;
  const arco = (2 * Math.PI * raio) / Math.max(n, 1);
  /* Roda pequena (janela estreita, celular): blocos um pouco maiores, para o
     nome ainda caber dentro do círculo — no toque não há mouse para revelá-lo. */
  const proporcao = lado < 460 ? 0.19 : 0.165;
  const diametro = Math.round(Math.min(lado * proporcao, arco * 0.8));
  const miolo = Math.round(2 * (raio - diametro * 0.65 - 10));
  return { centro, raio, diametro, miolo };
}

/**
 * A roda de conversão (05/11/2026): os blocos num círculo, o centro dizendo o
 * que o bloco sob o mouse faz. O desenho vem da roda de rádio dos jogos de
 * mundo aberto — pedido do usuário no lugar da grade de cartões.
 *
 * Só desenha: o que cada bloco faz (escolher, soltar, cancelar) vem de quem
 * monta. O contêiner não recebe o mouse (`pointer-events-none`) e os blocos e o
 * miolo recebem de volta (`auto`), para o clique no vazio da roda chegar ao
 * fundo da paleta e fechá-la.
 *
 * Teclado: o foco entra na roda e as setas andam pelos blocos (Home e End vão
 * ao primeiro e ao último); o bloco com foco fica ativo, como com o mouse.
 */
export function RodaDeConversao({
  blocos,
  lado,
  realceDe,
  trabalhos,
  pendentes,
  aoEscolher,
  aoSoltar,
  aoCancelar,
  aoDescartarPendentes,
}: {
  blocos: readonly Bloco[];
  lado: number;
  realceDe: (bloco: Bloco) => Realce;
  trabalhos: Partial<Record<IdDoBloco, Trabalho>>;
  pendentes: File[];
  aoEscolher: (bloco: Bloco) => void;
  aoSoltar: (bloco: Bloco, arquivos: File[]) => void;
  aoCancelar: (bloco: Bloco) => void;
  aoDescartarPendentes: () => void;
}) {
  const [ativa, setAtiva] = useState<{ id: IdDoBloco; origem: OrigemDaAtivacao } | null>(null);
  const g = useMemo(() => geometria(lado, blocos.length), [lado, blocos.length]);

  /* Só desativa se o bloco que saiu ainda é o ativo: ao arrastar um arquivo, o
     `dragenter` do bloco novo chega ANTES do `dragleave` do anterior. */
  const desativar = (id: IdDoBloco) => setAtiva((a) => (a?.id === id ? null : a));

  const blocoAtivo = ativa ? blocos.find((b) => b.id === ativa.id) : undefined;
  const ativo: BlocoAtivo | null =
    ativa && blocoAtivo
      ? {
          bloco: blocoAtivo,
          origem: ativa.origem,
          realce: realceDe(blocoAtivo),
          trabalho: trabalhos[blocoAtivo.id],
        }
      : null;
  const doEstado = (estado: Trabalho["estado"]): BlocoEmCurso | null => {
    for (const b of blocos) {
      const t = trabalhos[b.id];
      if (t?.estado === estado) return { bloco: b, trabalho: t };
    }
    return null;
  };

  const aoTeclar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const alvo = e.target as HTMLElement;
    // Só quando o foco é a própria roda ou um bloco: nos botões do centro as setas são deles.
    if (alvo !== e.currentTarget && !alvo.closest("[data-no-da-roda]")) return;
    const nos = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-no-da-roda]"));
    if (nos.length === 0) return;
    const atual = nos.indexOf(alvo.closest<HTMLElement>("[data-no-da-roda]") ?? alvo);
    let proximo: number;
    if (e.key === "Home") proximo = 0;
    else if (e.key === "End") proximo = nos.length - 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown")
      proximo = atual < 0 ? 0 : (atual + 1) % nos.length;
    else proximo = atual < 0 ? nos.length - 1 : (atual - 1 + nos.length) % nos.length;
    e.preventDefault();
    nos[proximo]?.focus();
  };

  return (
    <div
      data-roda=""
      role="group"
      aria-label="Conversões disponíveis"
      tabIndex={-1}
      onKeyDown={aoTeclar}
      className="pointer-events-none relative shrink-0 outline-none"
      style={{ ...ESTILO_DO_ACENTO, width: lado, height: lado }}
    >
      {/* Um clarão suave atrás da roda, na cor de destaque: dá fundo sem desfoque. */}
      <div
        aria-hidden
        className="absolute inset-[5%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--acento) 16%, transparent) 0%, transparent 68%)",
        }}
      />
      {/* O trilho por onde os blocos andam. */}
      <div
        aria-hidden
        className="absolute rounded-full border border-white/10"
        style={{
          left: g.centro - g.raio,
          top: g.centro - g.raio,
          width: g.raio * 2,
          height: g.raio * 2,
        }}
      />

      {/* O miolo: o texto, num disco de vidro. */}
      <motion.div
        className="pointer-events-auto absolute z-[5] grid place-items-center rounded-full border border-white/10 bg-white/[0.06]"
        style={{
          left: g.centro - g.miolo / 2,
          top: g.centro - g.miolo / 2,
          width: g.miolo,
          height: g.miolo,
          padding: g.miolo * 0.07,
        }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05, duration: 0.25, ease: "easeOut" }}
      >
        <CentroDaRoda
          ativo={ativo}
          emCurso={doEstado("rodando")}
          comErro={doEstado("erro")}
          pendentes={pendentes}
          compacto={g.miolo < 250}
          aoCancelar={aoCancelar}
          aoDescartar={aoDescartarPendentes}
        />
      </motion.div>

      {blocos.map((b, i) => {
        const angulo = (i / blocos.length) * 2 * Math.PI; // 0 = alto, sentido do relógio
        const x = g.centro + g.raio * Math.sin(angulo);
        const y = g.centro - g.raio * Math.cos(angulo);
        const ehAtivo = ativa?.id === b.id;
        return (
          <motion.div
            key={b.id}
            className="pointer-events-auto absolute"
            style={{
              left: x - g.diametro / 2,
              top: y - g.diametro / 2,
              width: g.diametro,
              height: g.diametro,
              zIndex: ehAtivo ? 20 : 10,
            }}
            /* Os blocos saem do centro e abrem em leque, um depois do outro. */
            initial={{ x: g.centro - x, y: g.centro - y, scale: 0.3, opacity: 0 }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 240, damping: 22, delay: i * 0.025 }}
          >
            <NoDaRoda
              bloco={b}
              diametro={g.diametro}
              ativo={ehAtivo}
              realce={realceDe(b)}
              trabalho={trabalhos[b.id]}
              comRotulo={g.diametro >= 62}
              aoAtivar={(origem) => setAtiva({ id: b.id, origem })}
              aoDesativar={() => desativar(b.id)}
              aoEscolher={() => aoEscolher(b)}
              aoSoltar={(arquivos) => aoSoltar(b, arquivos)}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
