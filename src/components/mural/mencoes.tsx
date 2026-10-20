import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { useFluxo } from "@/lib/fluxo-store";
import { normalizarNome } from "@/lib/aniversario-hoje";
import type { User } from "@/lib/fluxo-types";

/*
 * O "@" do Mural (fase 1 no post, fase 2 também no comentário — 14/10/2026):
 * digitar "@" abre a lista de pessoas; escolher alguém escreve "@Nome" no
 * texto, e quem foi marcado recebe um aviso. Um gancho só, para o post e o
 * comentário funcionarem igual.
 */

/** O "@algo" que está sendo digitado logo antes do cursor, se houver. */
export function mencaoEmCurso(
  texto: string,
  cursor: number,
): { inicio: number; busca: string } | null {
  const antes = texto.slice(0, cursor);
  const m = /(^|\s)@([^\s@]{0,20}(?: [^\s@]{0,20})?)$/.exec(antes);
  if (!m) return null;
  return { inicio: cursor - m[2].length - 1, busca: m[2] };
}

/** Ids de quem foi marcado: quem aparece como "@Nome completo" no texto. */
export function mencionadosNoTexto(texto: string, users: User[]): string[] {
  return users
    .filter((u) => u.name.trim().length >= 3 && texto.includes(`@${u.name.trim()}`))
    .map((u) => u.id);
}

type Campo = HTMLInputElement | HTMLTextAreaElement;

/**
 * Liga um campo de texto à lista de menções. Devolve a `ref` do campo, os
 * tratadores de digitação/teclado e a lista pronta para desenhar logo abaixo
 * (ou acima, com `paraCima`) do campo — o pai precisa ser `relative`.
 */
export function useMencoes<T extends Campo>({
  texto,
  setTexto,
  max,
  paraCima = false,
}: {
  texto: string;
  setTexto: (v: string) => void;
  max: number;
  paraCima?: boolean;
}) {
  const { currentUser, users } = useFluxo();
  const campoRef = useRef<T>(null);
  const [mencao, setMencao] = useState<{ inicio: number; busca: string } | null>(null);

  const sugestoes = useMemo(() => {
    if (!mencao) return [];
    const q = normalizarNome(mencao.busca);
    return users
      .filter((u) => u.id !== currentUser.id)
      .filter((u) => {
        if (!q) return true;
        const n = normalizarNome(u.name);
        return n.startsWith(q) || n.includes(` ${q}`);
      })
      .slice(0, 6);
  }, [mencao, users, currentUser.id]);

  const escolher = (u: User) => {
    if (!mencao) return;
    const campo = campoRef.current;
    const cursor = campo?.selectionStart ?? texto.length;
    const novo = `${texto.slice(0, mencao.inicio)}@${u.name.trim()} ${texto.slice(cursor)}`;
    setTexto(novo.slice(0, max));
    setMencao(null);
    const pos = mencao.inicio + u.name.trim().length + 2;
    requestAnimationFrame(() => {
      campo?.focus();
      campo?.setSelectionRange(pos, pos);
    });
  };

  /** Chamar no onChange do campo, com o valor novo e a posição do cursor. */
  const aoMudar = (valor: string, cursor: number | null) =>
    setMencao(mencaoEmCurso(valor, cursor ?? valor.length));

  /** Chamar no onKeyDown. Devolve true se a tecla foi usada pela lista. */
  const aoTeclar = (e: KeyboardEvent): boolean => {
    if (mencao && sugestoes.length && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      escolher(sugestoes[0]);
      return true;
    }
    if (e.key === "Escape" && mencao) {
      setMencao(null);
      return true;
    }
    return false;
  };

  const fechar = () => window.setTimeout(() => setMencao(null), 150);

  const lista: ReactNode =
    mencao && sugestoes.length > 0 ? (
      <ul
        className={`absolute left-0 z-30 w-64 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg ${
          paraCima ? "bottom-full mb-1" : "mt-1"
        }`}
      >
        {sugestoes.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(u);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-secondary"
            >
              <UserAvatar nome={u.name} iniciais={u.avatar} className="h-6 w-6 text-[9px]" />
              <span className="truncate">{u.name}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return { campoRef, aoMudar, aoTeclar, fechar, lista };
}
