/*
 * A camada 2D ÚNICA sobre o Canvas: por pessoa, o crachá (com o chip IA), o
 * selo de mudo, o selo de gesto e o balão do card.
 *
 * O React só monta o conteúdo; quem posiciona é o Projetor (dentro do Canvas),
 * escrevendo transform/display direto nos elementos registrados. Por isso os
 * grupos nascem com display:none — sem piscar no canto (0,0) antes do 1º quadro.
 *
 * A camada é pointer-events:none; só o balão/chip recebe o mouse (hover
 * expande, clique abre a aba Cards).
 *
 * Quem está fora do quadro pelos lados fica com o crachá preso na borda
 * (`data-fora="esq|dir"`, escrito pelo Projetor): o CSS põe a seta e mostra o
 * "💬" quando a pessoa tem balão — o balão em si não tem para onde apontar.
 */
import { MicOff } from "lucide-react";
import {
  type CardNaSala,
  LIMIAR_DO_BALAO,
  type NaMesa,
  type TipoVisivel,
  VISUAL_DO_GESTO,
  gestoDoAvatar,
} from "./tipos";
import { BalaoDeCard } from "./balao-de-card";
import type { RegistroDaCamada } from "./projetor";

/**
 * O balão de uma pessoa: o card MAIS NOVO dela com relevância suficiente para
 * a cabeça (por tipo). Os outros vivos dela viram o "+N". Eu nunca tenho
 * balão (os meus ficam na bandeja do integrador).
 */
export function balaoDaPessoa(
  p: Pick<NaMesa, "eu" | "cards">,
): { item: CardNaSala; extras: number } | null {
  if (p.eu || !p.cards.length) return null;
  for (let i = p.cards.length - 1; i >= 0; i--) {
    const c = p.cards[i];
    if (c.card.tipo === "nada") continue;
    const limiar = LIMIAR_DO_BALAO[c.card.tipo as TipoVisivel] ?? 1;
    if (c.card.relevancia >= limiar) return { item: c, extras: p.cards.length - 1 };
  }
  return null;
}

function SeloDeMudo({ eu, semMicrofone }: { eu: boolean; semMicrofone: boolean }) {
  const classe = "rv-mudo" + (eu ? " rv-meu" : "") + (semMicrofone ? " rv-sem-microfone" : "");
  const rotulo = semMicrofone ? "sem microfone" : eu ? "você está no mudo" : "no mudo";
  return (
    <span className={classe} role="img" aria-label={rotulo} title={rotulo}>
      <MicOff size={eu ? 18 : 14} strokeWidth={2.4} />
    </span>
  );
}

function SeloDeGesto({ p }: { p: NaMesa }) {
  const gesto = gestoDoAvatar(p.mao, p.momentaneo);
  if (!gesto) return null;
  const { emoji, frase } = VISUAL_DO_GESTO[gesto];
  const primeiro = p.posicaoNaFila === 1 && !p.momentaneo;
  // A key reinicia o "pulo + 3 pulsos" quando o gesto muda (e só então).
  return (
    <span
      key={gesto}
      className={"rv-gesto" + (primeiro ? " rv-primeiro" : "")}
      role="img"
      aria-label={`${p.eu ? "Você" : p.nome} ${frase}`}
    >
      {emoji}
      {p.posicaoNaFila !== null && !p.momentaneo && (
        <span className="rv-gesto-fila">{p.posicaoNaFila}</span>
      )}
    </span>
  );
}

export function CamadaSobreCabecas({
  pessoas,
  registro,
  aoAbrirCard,
}: {
  pessoas: NaMesa[];
  registro: RegistroDaCamada;
  aoAbrirCard: (id: string) => void;
}) {
  return (
    <div className="rv-camada" aria-live="off">
      {pessoas.map((p) => {
        const balao = balaoDaPessoa(p);
        const falandoDeVerdade = p.falando && !p.mudo;
        return (
          <div
            key={p.id}
            ref={registro.ref("grp:" + p.id)}
            className="rv-grupo"
            data-rv-grupo={p.id}
            style={{ display: "none" }}
          >
            <div ref={registro.ref("cab:" + p.id)} className="rv-linha-cabeca">
              {!p.eu && (
                <span className={"rv-cracha" + (falandoDeVerdade ? " rv-falando" : "")}>
                  <span className="rv-seta-fora rv-seta-esq" aria-hidden>
                    ◀
                  </span>
                  {p.nome}
                  {p.iaOuvindo && (
                    <span className="rv-chip-ia" aria-label="Cards por IA ligados">
                      IA
                    </span>
                  )}
                  {balao && (
                    <span className="rv-tem-balao" role="img" aria-label="tem card novo">
                      💬
                    </span>
                  )}
                  <span className="rv-seta-fora rv-seta-dir" aria-hidden>
                    ▶
                  </span>
                </span>
              )}
              {p.eu && p.iaOuvindo && (
                <span className="rv-chip-ia rv-solto" aria-label="Cards por IA ligados">
                  IA
                </span>
              )}
              {p.mudo && <SeloDeMudo eu={p.eu} semMicrofone={p.semMicrofone} />}
              <SeloDeGesto p={p} />
            </div>
            {balao && (
              <div ref={registro.ref("bal:" + p.id)} className="rv-balao" data-modo="completo">
                <BalaoDeCard
                  key={balao.item.id}
                  item={balao.item}
                  extras={balao.extras}
                  refDoModo={(modo) => registro.ref(`var:${p.id}:${modo}`)}
                  aoAbrir={() => aoAbrirCard(balao.item.id)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
