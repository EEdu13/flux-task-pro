import { Fragment, useMemo, type ReactNode } from "react";
import type { User } from "@/lib/fluxo-types";

/*
 * O texto de um post do Mural (14/10/2026): quebras de linha respeitadas,
 * endereços viram link e "@Nome" de alguém do app fica destacado.
 *
 * Nada de HTML vindo do banco: o texto é quebrado em pedaços e cada pedaço
 * vira um nó do React — não há como um post injetar marcação na tela.
 */

const URL_RE = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tira a pontuação que costuma colar no fim de um link ("veja www.x.com."). */
function separarPontuacao(url: string): [string, string] {
  const m = /[.,;:!?)\]]+$/.exec(url);
  return m ? [url.slice(0, m.index), m[0]] : [url, ""];
}

export function TextoDoPost({
  texto,
  users,
  className,
}: {
  texto: string;
  users: User[];
  className?: string;
}) {
  // Só os nomes que aparecem com @ neste texto entram no padrão.
  const mencaoRe = useMemo(() => {
    const nomes = users
      .map((u) => u.name.trim())
      .filter((n) => n.length >= 3 && texto.includes(`@${n}`))
      .sort((a, b) => b.length - a.length)
      .map(escaparRegex);
    return nomes.length ? new RegExp(`@(${nomes.join("|")})`, "g") : null;
  }, [texto, users]);

  const pedacos = useMemo(() => {
    const saida: ReactNode[] = [];
    let chave = 0;
    const comMencoes = (trecho: string) => {
      if (!mencaoRe || !trecho.includes("@")) {
        saida.push(<Fragment key={chave++}>{trecho}</Fragment>);
        return;
      }
      let ultimo = 0;
      for (const m of trecho.matchAll(mencaoRe)) {
        const i = m.index ?? 0;
        if (i > ultimo) saida.push(<Fragment key={chave++}>{trecho.slice(ultimo, i)}</Fragment>);
        saida.push(
          <span key={chave++} className="rounded bg-primary/10 px-0.5 font-semibold text-primary">
            {m[0]}
          </span>,
        );
        ultimo = i + m[0].length;
      }
      if (ultimo < trecho.length)
        saida.push(<Fragment key={chave++}>{trecho.slice(ultimo)}</Fragment>);
    };

    let ultimo = 0;
    for (const m of texto.matchAll(URL_RE)) {
      const i = m.index ?? 0;
      const [url, resto] = separarPontuacao(m[0]);
      if (i > ultimo) comMencoes(texto.slice(ultimo, i));
      const href = url.startsWith("http") ? url : `https://${url}`;
      saida.push(
        <a
          key={chave++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-primary underline underline-offset-2 hover:brightness-110"
        >
          {url}
        </a>,
      );
      if (resto) saida.push(<Fragment key={chave++}>{resto}</Fragment>);
      ultimo = i + m[0].length;
    }
    if (ultimo < texto.length) comMencoes(texto.slice(ultimo));
    return saida;
  }, [texto, mencaoRe]);

  if (!texto) return null;
  return <div className={`whitespace-pre-wrap break-words ${className ?? ""}`}>{pedacos}</div>;
}
