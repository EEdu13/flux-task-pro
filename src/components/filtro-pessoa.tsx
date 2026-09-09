import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import type { User } from "@/lib/fluxo-types";

/**
 * Filtro por pessoa — compacto, com busca.
 *
 * O estado `assignee` já existia na tela de tarefas e já era aplicado no
 * filtro; o que não existia era o controle, então `setAssignee` nunca era
 * chamado e a opção era inalcançável. Isto é a peça que faltava.
 *
 * Botão estreito em vez de uma fila de avatares: a lista cresce com a empresa,
 * e uma fila fixa ou estoura a linha ou esconde justamente quem se procura. Com
 * a busca dentro, achar alguém em 6 ou em 400 custa o mesmo.
 *
 * Fechado, mostra o rosto e o primeiro nome de quem está selecionado — quem
 * volta à tela precisa enxergar o recorte ativo sem abrir nada, senão a lista
 * curta parece dado faltando.
 */
export function FiltroPessoa({
  pessoas,
  valor,
  aoEscolher,
}: {
  pessoas: User[];
  /** Id da pessoa, ou "todos". */
  valor: string;
  aoEscolher: (valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const raizRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const selecionada = pessoas.find((p) => p.id === valor);

  useEffect(() => {
    if (!aberto) return;
    // Foco na busca ao abrir: quem clicou já sabe quem procura.
    buscaRef.current?.focus();
    const aoClicarFora = (e: MouseEvent) => {
      if (!raizRef.current?.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = [...pessoas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return q ? lista.filter((p) => p.name.toLowerCase().includes(q)) : lista;
  }, [pessoas, busca]);

  const escolher = (v: string) => {
    aoEscolher(v);
    setAberto(false);
    setBusca("");
  };

  return (
    <div ref={raizRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title="Filtrar por pessoa"
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition ${
          selecionada
            ? "border-primary/50 bg-primary/10 text-foreground"
            : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
        }`}
      >
        {selecionada ? (
          <>
            <UserAvatar
              nome={selecionada.name}
              iniciais={selecionada.avatar}
              className="h-5 w-5 text-[9px]"
            />
            <span className="max-w-28 truncate">{selecionada.name.split(" ")[0]}</span>
            {/* Limpar sem abrir a lista. É `<span>` e não `<button>` de
                propósito: botão dentro de botão é HTML inválido e o navegador
                desmonta a árvore de um jeito imprevisível. */}
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar filtro de pessoa"
              onClick={(e) => {
                e.stopPropagation();
                escolher("todos");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  escolher("todos");
                }
              }}
              className="rounded p-0.5 hover:bg-secondary"
            >
              <X className="h-3 w-3" />
            </span>
          </>
        ) : (
          <>
            <UserRound className="h-3.5 w-3.5" />
            Pessoa
            <ChevronDown className="h-3 w-3 opacity-60" />
          </>
        )}
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            style={{ transformOrigin: "top left" }}
            className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
          >
            <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pessoa…"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => escolher("todos")}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-secondary"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1">Todas as pessoas</span>
                {valor === "todos" && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>

              {filtradas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => escolher(p.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-secondary"
                >
                  <UserAvatar nome={p.name} iniciais={p.avatar} className="h-6 w-6 text-[9px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    {p.jobTitle && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {p.jobTitle}
                      </span>
                    )}
                  </span>
                  {valor === p.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}

              {filtradas.length === 0 && (
                <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                  Ninguém com esse nome.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
