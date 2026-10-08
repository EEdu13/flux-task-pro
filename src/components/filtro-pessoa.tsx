import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Users2, X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { sectors, type User } from "@/lib/fluxo-types";
import type { SelecaoDePessoas } from "@/lib/filtro-de-pessoas";

/** "João", "João e Mayara", "João, Mayara e Paulo", "João, Mayara e mais 2". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  if (nomes.length <= 3) return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${nomes.slice(0, 2).join(", ")} e mais ${nomes.length - 2}`;
}

/**
 * Os setores de quem aparece no filtro, como chips. Fica na linha de cima,
 * junto das datas (pedido do usuário, 07/10/2026), e escolhe duas coisas: as
 * tarefas de quem é daquele setor e os rostos que o `FiltroPessoa` mostra.
 *
 * Só os setores que têm gente nesta lista — a lista fixa tem 17 e a maioria
 * não tem ninguém aqui. Com um setor só, não aparece: seria um botão dizendo
 * o óbvio.
 */
export function FiltroSetor({
  pessoas,
  setor,
  aoMudar,
}: {
  pessoas: User[];
  setor: string;
  aoMudar: (setor: string) => void;
}) {
  const presentes = useMemo(() => {
    const ids = new Set(pessoas.map((p) => p.sector));
    return sectors.filter((s) => ids.has(s.id));
  }, [pessoas]);
  if (presentes.length <= 1) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Setor"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary/40 p-0.5"
    >
      <ChipSetor id="todos" rotulo="Todos" ativo={setor === "todos"} aoClicar={() => aoMudar("todos")} />
      {presentes.map((s) => (
        <ChipSetor
          key={s.id}
          id={s.id}
          rotulo={s.name}
          cor={s.color}
          ativo={setor === s.id}
          aoClicar={() => aoMudar(s.id)}
        />
      ))}
    </div>
  );
}

/**
 * Filtro por pessoa: uma faixa de rostos. Marcar mostra só as tarefas das
 * marcadas; marca quantas quiser (pedido do usuário, 02/10/2026).
 *
 * O modo "esconder as marcadas" saiu em 07/10/2026 — não era usado e ocupava
 * a faixa. O setor escolhido no `FiltroSetor` corta os rostos; quem está
 * marcado aparece sempre, seja qual for o setor, para o filtro nunca ficar
 * ligado sem rosto para desmarcar.
 *
 * Foto e não sigla: reconhecer alguém por "LP" exige decorar; o rosto se
 * reconhece sozinho.
 */
export function FiltroPessoa({
  pessoas,
  setor,
  valor,
  aoMudar,
}: {
  pessoas: User[];
  setor: string;
  valor: SelecaoDePessoas;
  aoMudar: (valor: SelecaoDePessoas) => void;
}) {
  const marcadas = useMemo(() => new Set(valor.ids), [valor.ids]);
  const ativo = valor.ids.length > 0;

  const visiveis = useMemo(() => {
    const lista = [...pessoas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return setor === "todos"
      ? lista
      : lista.filter((p) => p.sector === setor || marcadas.has(p.id));
  }, [pessoas, setor, marcadas]);

  const alternar = (id: string) =>
    aoMudar({
      modo: "so",
      ids: marcadas.has(id) ? valor.ids.filter((x) => x !== id) : [...valor.ids, id],
    });
  const limpar = () => aoMudar({ modo: "so", ids: [] });

  const nomesMarcados = valor.ids
    .map((id) => pessoas.find((p) => p.id === id)?.name.split(" ")[0])
    .filter((n): n is string => !!n);

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-border bg-secondary/30 px-2 py-1">
      {/* `layout` em cada chip: quando o setor muda, quem fica desliza para a
          posição nova em vez de saltar. O AnimatePresence cuida de quem entra e
          de quem sai, e `popLayout` tira quem está saindo do fluxo na hora —
          sem isso, os que ficam só se reorganizam depois da saída terminar, e o
          movimento sai em duas etapas. */}
      <motion.div layout className="flex flex-1 flex-wrap items-center gap-1">
        <BotaoPessoa rotulo="Todas" ativo={!ativo} aoClicar={limpar} />
        <AnimatePresence mode="popLayout" initial={false}>
          {visiveis.map((p) => {
            const marcada = marcadas.has(p.id);
            // Com alguém marcado, quem não está fica apagado: não aparece.
            const fora = ativo && !marcada;
            return (
              <motion.button
                key={p.id}
                layout
                type="button"
                onClick={() => alternar(p.id)}
                aria-pressed={marcada}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.6 }}
                title={`${p.name}${p.jobTitle ? ` · ${p.jobTitle}` : ""}${
                  marcada ? " — marcada (clique para desmarcar)" : ""
                }`}
                className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] transition-[background-color,border-color,color,opacity] ${
                  marcada
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : `border-border bg-card text-foreground hover:border-primary/50 ${
                        fora ? "opacity-50 hover:opacity-100" : ""
                      }`
                }`}
              >
                <UserAvatar nome={p.name} iniciais={p.avatar} className="h-5 w-5 text-[8px]" />
                <span className="max-w-28 truncate font-medium">{p.name.split(" ")[0]}</span>
                {marcada && <Check className="h-3 w-3" />}
              </motion.button>
            );
          })}
        </AnimatePresence>
        {visiveis.length === 0 && (
          <span className="px-1 text-[11px] text-muted-foreground">
            Ninguém deste setor tem tarefa visível para você.
          </span>
        )}
      </motion.div>

      {ativo && (
        <button
          type="button"
          onClick={limpar}
          title={`Mostrando só as tarefas de ${listaDeNomes(nomesMarcados)}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
        >
          <X className="h-3.5 w-3.5" /> Limpar
        </button>
      )}
    </div>
  );
}

function ChipSetor({
  id,
  rotulo,
  cor,
  ativo,
  aoClicar,
}: {
  id: string;
  rotulo: string;
  cor?: string;
  ativo: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoClicar}
      className={`relative flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-xs font-medium transition-colors ${
        ativo ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {ativo && (
        // Um único fundo deslizando entre os setores — mesmo recurso do item
        // ativo da sidebar. Trocar de setor move a marca, não pisca duas.
        <motion.span
          layoutId="filtro-setor-ativo"
          className="absolute inset-0 rounded bg-primary shadow-sm"
          transition={{ type: "spring", stiffness: 400, damping: 33 }}
        />
      )}
      {cor ? (
        <span
          className="relative h-2 w-2 shrink-0 rounded-full"
          style={{ background: ativo ? "currentColor" : cor }}
        />
      ) : (
        <Users2 className="relative h-3 w-3 shrink-0" />
      )}
      <span className="relative">{rotulo}</span>
      <span className="sr-only">{id}</span>
    </button>
  );
}

function BotaoPessoa({
  rotulo,
  ativo,
  aoClicar,
}: {
  rotulo: string;
  ativo: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      <Users2 className="h-3 w-3" />
      {rotulo}
    </button>
  );
}
