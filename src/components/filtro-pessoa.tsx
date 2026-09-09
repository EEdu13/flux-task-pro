import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Users2 } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { sectors, type User } from "@/lib/fluxo-types";

/**
 * Filtro por pessoa em dois níveis: setores em cima, pessoas embaixo.
 *
 * Era um menu suspenso com busca. Virou um bloco aberto porque o caminho real
 * é "quero ver as tarefas de alguém do financeiro" — e escolher primeiro o
 * setor corta a lista de rostos antes de ela virar uma parede. Com a lista
 * exposta, escolher alguém é um clique, não abrir-procurar-clicar.
 *
 * Foto e não sigla: reconhecer alguém por "LP" exige decorar; o rosto se
 * reconhece sozinho. É a mesma decisão já tomada nos cartões de tarefa.
 *
 * A linha de setores só aparece quando há mais de um — para quem enxerga só o
 * próprio setor, ela seria uma fileira de um botão só, dizendo o óbvio.
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
  const [setor, setSetor] = useState<string>("todos");

  /* Só os setores que têm gente nesta lista. A lista fixa tem 17 e a maioria
     não tem ninguém aqui — botão que só sabe esvaziar a tela não é filtro. */
  const setoresPresentes = useMemo(() => {
    const ids = new Set(pessoas.map((p) => p.sector));
    return sectors.filter((s) => ids.has(s.id));
  }, [pessoas]);

  const visiveis = useMemo(() => {
    const lista = [...pessoas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return setor === "todos" ? lista : lista.filter((p) => p.sector === setor);
  }, [pessoas, setor]);

  /* Trocar de setor limpa a pessoa escolhida se ela não pertence ao novo
     recorte. Sem isto, filtrar por alguém da TI e depois clicar em Financeiro
     deixaria a tela mostrando as tarefas de uma pessoa que sumiu da lista —
     um filtro ativo e invisível, que é o pior tipo. */
  const escolherSetor = (novo: string) => {
    setSetor(novo);
    if (valor === "todos") return;
    const escolhida = pessoas.find((p) => p.id === valor);
    if (novo !== "todos" && escolhida && escolhida.sector !== novo) aoEscolher("todos");
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-2">
      {setoresPresentes.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Setor
          </span>
          <ChipSetor
            id="todos"
            rotulo="Todos"
            ativo={setor === "todos"}
            aoClicar={() => escolherSetor("todos")}
          />
          {setoresPresentes.map((s) => (
            <ChipSetor
              key={s.id}
              id={s.id}
              rotulo={s.name}
              cor={s.color}
              ativo={setor === s.id}
              aoClicar={() => escolherSetor(s.id)}
            />
          ))}
        </div>
      )}

      {/* `layout` em cada chip: quando o setor muda, quem fica desliza para a
          posição nova em vez de saltar. O AnimatePresence cuida de quem entra e
          de quem sai, e `popLayout` tira quem está saindo do fluxo na hora —
          sem isso, os que ficam só se reorganizam depois da saída terminar, e o
          movimento sai em duas etapas. */}
      <motion.div layout className="flex flex-wrap items-center gap-1.5">
        <BotaoPessoa
          rotulo="Todas as pessoas"
          ativo={valor === "todos"}
          aoClicar={() => aoEscolher("todos")}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          {visiveis.map((p) => (
            <motion.button
              key={p.id}
              layout
              type="button"
              onClick={() => aoEscolher(valor === p.id ? "todos" : p.id)}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.6 }}
              title={`${p.name}${p.jobTitle ? ` · ${p.jobTitle}` : ""}`}
              className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-colors ${
                valor === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/50"
              }`}
            >
              <UserAvatar nome={p.name} iniciais={p.avatar} className="h-6 w-6 text-[9px]" />
              <span className="max-w-32 truncate font-medium">{p.name.split(" ")[0]}</span>
              {valor === p.id && <Check className="h-3 w-3" />}
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>

      {visiveis.length === 0 && (
        <p className="py-2 text-center text-[11px] text-muted-foreground">
          Ninguém deste setor tem tarefa visível para você.
        </p>
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
      onClick={aoClicar}
      className={`relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        ativo ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {ativo && (
        // Um único fundo deslizando entre os setores — mesmo recurso do item
        // ativo da sidebar. Trocar de setor move a marca, não pisca duas.
        <motion.span
          layoutId="filtro-setor-ativo"
          className="absolute inset-0 rounded-full bg-primary"
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
      <span className="relative whitespace-nowrap">{rotulo}</span>
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
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      <Users2 className="h-3.5 w-3.5" />
      {rotulo}
    </button>
  );
}
