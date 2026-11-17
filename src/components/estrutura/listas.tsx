import { Plus, Star, Truck, Users } from "lucide-react";
import { BotoesDeStatus, EtiquetaDeStatus } from "@/components/estrutura/botoes-de-status";
import {
  agruparVeiculos,
  marcaDaPessoa,
  marcaDoVeiculo,
  type Marcas,
} from "@/components/estrutura/marcas";
import {
  STATUS_PESSOA,
  STATUS_VEICULO,
  type PessoaDaEquipe,
  type VeiculoDaEquipe,
} from "@/lib/estrutura-tipos";
import { cn } from "@/lib/utils";

/*
 * As duas listas da estrutura: pessoas e veículos. Em edição cada linha tem os
 * botões de status; em leitura (dia já enviado) tem só a etiqueta com o que
 * foi guardado. A linha sem marca ganha um filete âmbar: é o que falta.
 */

function Selo({ children, forte }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        forte ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** O supervisor tem destaque próprio (violeta, com estrela): a linha ganha um fundo suave e este selo. */
function SeloDeSupervisor() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
      <Star className="h-2.5 w-2.5 fill-current" aria-hidden />
      Supervisor
    </span>
  );
}

/** PJ e estagiário aparecem como o que são; o PWA manda o tipo, e qualquer outro vira "Externo". */
function rotuloDoExterno(tipo: string): string {
  return tipo === "PJ" ? "PJ" : tipo === "ESTAGIARIO" ? "Estagiário" : "Externo";
}

/**
 * O título da lista, o total e, ao lado, o "Adicionar": puxar para a equipe quem está SEM EQUIPE
 * (o espelho do "NÃO ESTÁ NA EQUIPE", que manda para lá). Só aparece quando `aoAdicionar` vem.
 */
function Cabecalho({
  icone,
  titulo,
  total,
  rotuloDoAdicionar,
  aoAdicionar,
}: {
  icone: React.ReactNode;
  titulo: string;
  total: number;
  rotuloDoAdicionar: string;
  aoAdicionar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {icone}
        {titulo}
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {total}
        </span>
      </h2>
      {aoAdicionar && (
        <button
          type="button"
          onClick={aoAdicionar}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {rotuloDoAdicionar}
        </button>
      )}
    </div>
  );
}

export function ListaDePessoas({
  pessoas,
  marcas,
  editando,
  estava,
  euId,
  aoMarcar,
  aoAdicionar,
}: {
  pessoas: PessoaDaEquipe[];
  marcas: Marcas;
  editando: boolean;
  /** Status guardado que não é da lista: "Estava: X — marque um dos botões". */
  estava: Record<number, string>;
  euId: number | null;
  aoMarcar: (id: number, status: string) => void;
  /** Puxar para a equipe quem está sem equipe. Sem a prop, não há botão. */
  aoAdicionar?: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <Cabecalho
        icone={<Users className="h-4 w-4 text-muted-foreground" />}
        titulo="Pessoas"
        total={pessoas.length}
        rotuloDoAdicionar="Adicionar pessoa"
        aoAdicionar={aoAdicionar}
      />
      {pessoas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Esta equipe não tem pessoas cadastradas.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {pessoas.map((p) => {
            const valor = marcaDaPessoa(marcas, p.id);
            return (
              <li
                key={p.id}
                className={cn(
                  "flex flex-col gap-2 border-l-2 px-4 py-3 hover:bg-secondary/30 md:flex-row md:items-center md:justify-between md:gap-4",
                  editando && valor === null ? "border-l-amber-400" : "border-l-transparent",
                  p.supervisor && "bg-violet-500/[0.06]",
                )}
              >
                <div className="min-w-0 md:w-72 md:shrink-0 xl:w-[26rem]">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{p.nome}</span>
                    {p.supervisor && <SeloDeSupervisor />}
                    {p.externo && <Selo>{rotuloDoExterno(p.tipoExterno)}</Selo>}
                    {euId === p.id && <Selo forte>Você</Selo>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.funcao || "Sem função"}
                    {p.cpf && ` · CPF ${p.cpf}`}
                  </div>
                  {editando && estava[p.id] && (
                    <div className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Estava: {estava[p.id]}. Marque um dos botões.
                    </div>
                  )}
                </div>
                {editando ? (
                  <BotoesDeStatus
                    nome={p.nome}
                    opcoes={STATUS_PESSOA}
                    valor={valor}
                    aoEscolher={(s) => aoMarcar(p.id, s)}
                  />
                ) : (
                  <EtiquetaDeStatus status={valor} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ListaDeVeiculos({
  veiculos,
  marcas,
  editando,
  estava,
  aoMarcar,
  aoAdicionar,
}: {
  veiculos: VeiculoDaEquipe[];
  marcas: Marcas;
  editando: boolean;
  estava: Record<string, string>;
  aoMarcar: (prefixo: string, status: string) => void;
  /** Puxar para a equipe veículo que está sem equipe. Sem a prop, não há botão. */
  aoAdicionar?: () => void;
}) {
  if (veiculos.length === 0 && !aoAdicionar) return null;
  return (
    <section className="flex flex-col gap-2">
      <Cabecalho
        icone={<Truck className="h-4 w-4 text-muted-foreground" />}
        titulo="Veículos"
        total={veiculos.length}
        rotuloDoAdicionar="Adicionar veículo"
        aoAdicionar={aoAdicionar}
      />
      {veiculos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Esta equipe não tem veículos cadastrados.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {agruparVeiculos(veiculos).map((g) => (
          <div key={g.tipo} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-secondary/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.tipo}
            </div>
            <ul className="divide-y divide-border">
              {g.veiculos.map((v) => {
                const valor = marcaDoVeiculo(marcas, v.prefixo);
                const antes = estava[v.prefixo.trim().toUpperCase()];
                return (
                  <li
                    key={v.prefixo}
                    className={cn(
                      "flex flex-col gap-2 border-l-2 px-4 py-3 hover:bg-secondary/30 md:flex-row md:items-center md:justify-between md:gap-4",
                      editando && valor === null ? "border-l-amber-400" : "border-l-transparent",
                    )}
                  >
                    <div className="min-w-0 md:w-72 md:shrink-0 xl:w-[26rem]">
                      <div className="truncate text-sm font-semibold">{v.prefixo}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[v.placa, v.modelo].filter(Boolean).join(" · ") || "Sem placa"}
                      </div>
                      {editando && antes && (
                        <div className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                          Estava: {antes}. Marque um dos botões.
                        </div>
                      )}
                    </div>
                    {editando ? (
                      <BotoesDeStatus
                        nome={v.prefixo}
                        opcoes={STATUS_VEICULO}
                        valor={valor}
                        aoEscolher={(s) => aoMarcar(v.prefixo, s)}
                      />
                    ) : (
                      <EtiquetaDeStatus status={valor} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
