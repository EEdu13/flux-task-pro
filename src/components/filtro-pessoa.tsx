import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Eye, EyeOff, Users2, X } from "lucide-react";
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
 * Filtro por pessoa em dois níveis: setores em cima, pessoas embaixo.
 *
 * Era um menu suspenso com busca. Virou um bloco aberto porque o caminho real
 * é "quero ver as tarefas de alguém do financeiro" — e escolher primeiro o
 * setor corta a lista de rostos antes de ela virar uma parede. Com a lista
 * exposta, escolher alguém é um clique, não abrir-procurar-clicar.
 *
 * Marca quantas pessoas quiser (pedido do usuário, 02/10/2026): "só o que o
 * João e a Mayara fizeram", ou o contrário, "todo mundo menos os dois". O modo
 * fica no seletor de cima, e o rosto marcado mostra qual vale — cheio quando
 * entra, riscado quando sai.
 *
 * Foto e não sigla: reconhecer alguém por "LP" exige decorar; o rosto se
 * reconhece sozinho. É a mesma decisão já tomada nos cartões de tarefa.
 *
 * A linha de setores só aparece quando há mais de um — para quem enxerga só o
 * próprio setor, ela seria uma fileira de um botão só, dizendo o óbvio. Ela só
 * escolhe que rostos aparecem; quem filtra as tarefas são os rostos marcados.
 */
export function FiltroPessoa({
  pessoas,
  valor,
  aoMudar,
}: {
  pessoas: User[];
  valor: SelecaoDePessoas;
  aoMudar: (valor: SelecaoDePessoas) => void;
}) {
  const [setor, setSetor] = useState<string>("todos");
  const marcadas = useMemo(() => new Set(valor.ids), [valor.ids]);
  const ativo = valor.ids.length > 0;
  const esconde = valor.modo === "exceto";

  /* Só os setores que têm gente nesta lista. A lista fixa tem 17 e a maioria
     não tem ninguém aqui — botão que só sabe esvaziar a tela não é filtro. */
  const setoresPresentes = useMemo(() => {
    const ids = new Set(pessoas.map((p) => p.sector));
    return sectors.filter((s) => ids.has(s.id));
  }, [pessoas]);

  /* Quem está marcado aparece sempre, seja qual for o setor escolhido em cima.
     Antes, trocar de setor desmarcava a pessoa de fora dele; com várias
     marcadas isso apagaria escolhas sem aviso. Mantê-las à vista evita o
     contrário, que é pior: um filtro ligado que ninguém vê. */
  const visiveis = useMemo(() => {
    const lista = [...pessoas].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return setor === "todos"
      ? lista
      : lista.filter((p) => p.sector === setor || marcadas.has(p.id));
  }, [pessoas, setor, marcadas]);

  const alternar = (id: string) =>
    aoMudar({
      ...valor,
      ids: marcadas.has(id) ? valor.ids.filter((x) => x !== id) : [...valor.ids, id],
    });

  const nomesMarcados = valor.ids
    .map((id) => pessoas.find((p) => p.id === id)?.name.split(" ")[0])
    .filter((n): n is string => !!n);

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
            aoClicar={() => setSetor("todos")}
          />
          {setoresPresentes.map((s) => (
            <ChipSetor
              key={s.id}
              id={s.id}
              rotulo={s.name}
              cor={s.color}
              ativo={setor === s.id}
              aoClicar={() => setSetor(s.id)}
            />
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SeletorDeModo modo={valor.modo} aoMudar={(modo) => aoMudar({ ...valor, modo })} />
        <span className="min-w-0 text-[11px] text-muted-foreground">
          {ativo ? (
            <>
              {esconde ? "Escondendo as tarefas de " : "Mostrando só as tarefas de "}
              <span className="font-semibold text-foreground">{listaDeNomes(nomesMarcados)}</span>
            </>
          ) : (
            "Marque uma ou mais pessoas abaixo."
          )}
        </span>
        {ativo && (
          <button
            type="button"
            onClick={() => aoMudar({ ...valor, ids: [] })}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
          >
            <X className="h-3.5 w-3.5" /> Limpar pessoas
          </button>
        )}
      </div>

      {/* `layout` em cada chip: quando o setor muda, quem fica desliza para a
          posição nova em vez de saltar. O AnimatePresence cuida de quem entra e
          de quem sai, e `popLayout` tira quem está saindo do fluxo na hora —
          sem isso, os que ficam só se reorganizam depois da saída terminar, e o
          movimento sai em duas etapas. */}
      <motion.div layout className="flex flex-wrap items-center gap-1.5">
        <BotaoPessoa
          rotulo="Todas as pessoas"
          ativo={!ativo}
          aoClicar={() => aoMudar({ ...valor, ids: [] })}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          {visiveis.map((p) => {
            const marcada = marcadas.has(p.id);
            /* Quem a tela não mostra fica apagado: os não marcados no "só as
               marcadas", e os marcados no "esconder". */
            const fora = ativo && (esconde ? marcada : !marcada);
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
                  marcada
                    ? esconde
                      ? " — escondida (clique para mostrar)"
                      : " — marcada (clique para desmarcar)"
                    : ""
                }`}
                className={`flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs transition-[background-color,border-color,color,opacity] ${
                  marcada
                    ? esconde
                      ? "border-destructive/60 bg-destructive/10 text-destructive"
                      : "border-primary bg-primary text-primary-foreground shadow-sm"
                    : `border-border bg-card text-foreground hover:border-primary/50 ${
                        fora ? "opacity-50 hover:opacity-100" : ""
                      }`
                }`}
              >
                <span className={marcada && esconde ? "opacity-60 grayscale" : ""}>
                  <UserAvatar nome={p.name} iniciais={p.avatar} className="h-6 w-6 text-[9px]" />
                </span>
                <span
                  className={`max-w-32 truncate font-medium ${marcada && esconde ? "line-through" : ""}`}
                >
                  {p.name.split(" ")[0]}
                </span>
                {marcada &&
                  (esconde ? <EyeOff className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
              </motion.button>
            );
          })}
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

/**
 * "Só as marcadas" ou "Esconder as marcadas", num trilho com a marca que
 * desliza — o mesmo recurso dos chips de setor e do item ativo da sidebar.
 */
function SeletorDeModo({
  modo,
  aoMudar,
}: {
  modo: SelecaoDePessoas["modo"];
  aoMudar: (modo: SelecaoDePessoas["modo"]) => void;
}) {
  const opcoes = [
    { id: "so" as const, rotulo: "Só as marcadas", Icone: Eye },
    { id: "exceto" as const, rotulo: "Esconder as marcadas", Icone: EyeOff },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="O que fazer com as pessoas marcadas"
      className="inline-flex shrink-0 rounded-full border border-border bg-card p-0.5"
    >
      {opcoes.map(({ id, rotulo, Icone }) => {
        const ativo = modo === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => aoMudar(id)}
            className={`relative flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              ativo
                ? id === "exceto"
                  ? "text-destructive-foreground"
                  : "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {ativo && (
              <motion.span
                layoutId="filtro-pessoa-modo"
                className={`absolute inset-0 rounded-full ${
                  id === "exceto" ? "bg-destructive" : "bg-primary"
                }`}
                transition={{ type: "spring", stiffness: 400, damping: 33 }}
              />
            )}
            <Icone className="relative h-3.5 w-3.5 shrink-0" />
            <span className="relative whitespace-nowrap">{rotulo}</span>
          </button>
        );
      })}
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
