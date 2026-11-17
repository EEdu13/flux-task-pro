import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as EventoDeTecla,
  type PointerEvent as EventoDePonteiro,
} from "react";
import type { CampoDaPagina } from "./campos";
import type { ValorDeCampo } from "./modelo";

/*
 * Os campos de formulário de uma página no Editor de PDF (12/11/2026): uma caixa de verdade por
 * cima de cada campo do PDF, no mesmo lugar (lido pelo pdf.js), para preencher. O valor vai para
 * o estado do Editor (o desfazer vale), e salvar o põe no próprio campo
 * (`locais/editor/formulario.ts`). O canvas não pinta os campos — o pdf.js os deixa para uma
 * camada própria —, então é a caixa que mostra o valor.
 */

const FUNDO: CSSProperties = {
  // Opaco: o pdf.js ainda pinta no canvas a aparência ANTIGA do campo, e ela não pode aparecer por baixo.
  background: "#e8f0fe",
  border: "calc(1px / var(--z)) solid rgba(37, 99, 235, 0.45)",
  color: "#111827",
  // A página é branca: os controles nativos no esquema claro, mesmo com o Editor escuro.
  colorScheme: "light",
  fontFamily: 'Arial, Helvetica, "Liberation Sans", sans-serif',
};

function CampoDeTexto({
  c,
  valor,
  ativo,
  aoMudar,
  aoDigitar,
}: {
  c: CampoDaPagina;
  valor: string;
  ativo: boolean;
  aoMudar: (v: string) => void;
  aoDigitar: (v: string | null) => void;
}) {
  const [texto, setTexto] = useState(valor);
  const focado = useRef(false);
  // Desfazer muda o valor por fora: a caixa acompanha, menos com o cursor dentro.
  useEffect(() => {
    if (!focado.current) setTexto(valor);
  }, [valor]);
  const confirmar = () => {
    aoDigitar(null);
    if (texto !== valor) aoMudar(texto);
  };
  const props = {
    value: texto,
    "aria-label": `Campo ${c.nome}`,
    maxLength: c.maximo,
    readOnly: c.somenteLeitura,
    tabIndex: ativo ? 0 : -1,
    onFocus: () => {
      focado.current = true;
    },
    onBlur: () => {
      focado.current = false;
      confirmar();
    },
    onChange: (e: { target: { value: string } }) => {
      setTexto(e.target.value);
      aoDigitar(e.target.value);
    },
    onKeyDown: (e: EventoDeTecla) => {
      // Ctrl+S grava o que foi digitado e deixa subir: quem salva é o atalho do Editor.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        confirmar();
        return;
      }
      e.stopPropagation();
      if (e.key === "Enter" && !c.multilinha) (e.currentTarget as HTMLElement).blur();
    },
    onPointerDown: (e: EventoDePonteiro) => e.stopPropagation(),
    style: {
      ...FUNDO,
      position: "absolute",
      left: c.x,
      top: c.y,
      width: c.l,
      height: c.a,
      padding: "0 2px",
      fontSize: c.multilinha ? 10 : Math.max(6, Math.min(c.a * 0.7, 12)),
      pointerEvents: ativo ? "auto" : "none",
      resize: "none",
    } as CSSProperties,
  };
  return c.multilinha ? <textarea {...props} /> : <input type="text" {...props} />;
}

export function CamposDoFormulario({
  campos,
  valores,
  ativo,
  aoMudar,
  aoDigitar,
}: {
  campos: readonly CampoDaPagina[];
  valores: Readonly<Record<string, ValorDeCampo>>;
  /** Só com a ferramenta de editar: com as outras, a página recebe o gesto. */
  ativo: boolean;
  aoMudar: (nome: string, valor: ValorDeCampo) => void;
  aoDigitar: (nome: string, valor: string | null) => void;
}) {
  return (
    <>
      {campos.map((c, i) => {
        const valor = valores[c.nome] ?? c.inicial;
        const chave = `${c.nome}#${i}`;
        const caixa: CSSProperties = {
          position: "absolute",
          left: c.x,
          top: c.y,
          width: c.l,
          height: c.a,
          pointerEvents: ativo ? "auto" : "none",
        };
        if (c.tipo === "texto") {
          return (
            <CampoDeTexto
              key={chave}
              c={c}
              valor={String(valor)}
              ativo={ativo}
              aoMudar={(v) => aoMudar(c.nome, v)}
              aoDigitar={(v) => aoDigitar(c.nome, v)}
            />
          );
        }
        if (c.tipo === "marcar" || c.tipo === "opcao") {
          const marcado = c.tipo === "marcar" ? valor === true : valor === c.valorDoBotao;
          return (
            <input
              key={chave}
              type={c.tipo === "marcar" ? "checkbox" : "radio"}
              name={c.tipo === "opcao" ? `campo-${c.nome}` : undefined}
              aria-label={`Campo ${c.nome}`}
              checked={marcado}
              disabled={c.somenteLeitura}
              tabIndex={ativo ? 0 : -1}
              onChange={() =>
                aoMudar(c.nome, c.tipo === "marcar" ? !marcado : (c.valorDoBotao ?? ""))
              }
              onPointerDown={(e) => e.stopPropagation()}
              style={{ ...caixa, margin: 0, accentColor: "#2563eb", colorScheme: "light" }}
            />
          );
        }
        return (
          <select
            key={chave}
            aria-label={`Campo ${c.nome}`}
            value={String(valor)}
            disabled={c.somenteLeitura}
            tabIndex={ativo ? 0 : -1}
            onChange={(e) => aoMudar(c.nome, e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ ...FUNDO, ...caixa, fontSize: Math.max(6, Math.min(c.a * 0.7, 12)) }}
          >
            {!(c.opcoes ?? []).includes(String(valor)) && (
              <option value={String(valor)}>{String(valor)}</option>
            )}
            {(c.opcoes ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}
