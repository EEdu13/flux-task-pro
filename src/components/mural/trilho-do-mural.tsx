import { useEffect, useState, type ReactNode } from "react";
import {
  Award,
  Cake,
  CalendarDays,
  MapPin,
  Megaphone,
  Palmtree,
  Pin,
  Sparkles,
} from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { DarParabens } from "@/components/mural/dar-parabens";
import { MeuAniversario } from "@/components/mural/meu-aniversario";
import { useFluxo } from "@/lib/fluxo-store";
import { nomeCurto } from "@/lib/nome-curto";
import { dataDoEvento, diaEMes, iniciaisDe, proximoFeriado } from "@/lib/mural-cliente";
import type { PainelDoMural, PostDoMural } from "@/lib/mural.functions";

/*
 * A coluna da direita do Mural (14/10/2026): aniversariantes (hoje, esta
 * semana, este mês), tempo de casa, boas-vindas e os comunicados fixados.
 * Cada cartão some quando não tem nada para mostrar.
 *
 * Fase 3 (14/10/2026): "Próximos eventos" (os eventos do mural nos próximos
 * 30 dias, vindos do painel) e "Próximo feriado" — calculado aqui mesmo, com
 * a regra de feriados do pack e dos prazos (`dias-uteis.ts`), sem banco.
 */

/** O próximo feriado nacional, calculado uma vez ao montar. */
function ProximoFeriado() {
  const [feriado, setFeriado] = useState<Awaited<ReturnType<typeof proximoFeriado>>>(null);
  useEffect(() => {
    let vivo = true;
    proximoFeriado()
      .then((f) => vivo && setFeriado(f))
      .catch((e: unknown) => console.warn("[mural] feriado:", (e as Error)?.message));
    return () => {
      vivo = false;
    };
  }, []);
  if (!feriado) return null;
  const semana = feriado.data.toLocaleDateString("pt-BR", { weekday: "long" });
  return (
    <Cartao icone={<Palmtree className="h-3.5 w-3.5" />} titulo="Próximo feriado">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <span className="font-display text-lg font-bold leading-none">
            {feriado.data.getDate()}
          </span>
          <span className="text-[10px] font-semibold uppercase">
            {feriado.data.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{feriado.nome}</div>
          <div className="text-[11px] capitalize text-muted-foreground">
            {semana} · {feriado.emDias === 1 ? "amanhã" : `daqui a ${feriado.emDias} dias`}
          </div>
        </div>
      </div>
    </Cartao>
  );
}

function Cartao({
  icone,
  titulo,
  children,
  destaque = false,
}: {
  icone: ReactNode;
  titulo: string;
  children: ReactNode;
  destaque?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border bg-card p-4 shadow-sm ${destaque ? "border-primary/40" : "border-border"}`}
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icone}
        </span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function LinhaDePessoa({
  id,
  nome,
  detalhe,
  acao,
  apagada = false,
}: {
  id: string;
  nome: string;
  detalhe: string;
  acao?: ReactNode;
  apagada?: boolean;
}) {
  const { users } = useFluxo();
  const u = users.find((x) => x.id === id);
  return (
    <li className={`flex items-center gap-2.5 py-1.5 ${apagada ? "opacity-60" : ""}`}>
      <UserAvatar
        nome={u?.name ?? nome}
        iniciais={u?.avatar ?? iniciaisDe(nome)}
        className="h-8 w-8 text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={nome}>
          {nomeCurto(nome)}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{detalhe}</div>
      </div>
      {acao}
    </li>
  );
}

/** Lista que mostra 5 e abre o resto com "ver todos". */
function ListaRecolhida<T>({ itens, render }: { itens: T[]; render: (t: T) => ReactNode }) {
  const [todos, setTodos] = useState(false);
  const visiveis = todos ? itens : itens.slice(0, 5);
  return (
    <>
      <ul className="divide-y divide-border/60">{visiveis.map(render)}</ul>
      {itens.length > 5 && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {todos ? "Ver menos" : `Ver todos (${itens.length})`}
        </button>
      )}
    </>
  );
}

export function TrilhoDoMural({
  painel,
  fixados,
  aoSalvarAniversario,
  aoAbrirComunicado,
  aoAbrirEvento,
  parte = "tudo",
}: {
  /**
   * Em tela grande o mural tem duas laterais (19/10/2026): à esquerda o que é
   * da empresa (comunicados fixados, eventos, boas-vindas, feriado), à direita
   * o que é das pessoas (aniversários, tempo de casa). Menor, vai tudo junto.
   */
  parte?: "tudo" | "esquerda" | "direita";
  painel: PainelDoMural | null;
  fixados: PostDoMural[];
  aoSalvarAniversario: () => void;
  aoAbrirComunicado: (id: string) => void;
  aoAbrirEvento?: (id: string) => void;
}) {
  const { currentUser } = useFluxo();
  const esquerda = parte !== "direita";
  const direita = parte !== "esquerda";
  if (!painel) {
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  const naoLidos = fixados.filter(
    (p) => p.comunicado && p.autorId !== currentUser.id && !p.leitores.includes(currentUser.id),
  );
  const temAniversario = painel.hoje.length + painel.semana.length + painel.mes.length > 0;
  const hojeBR = new Date();

  return (
    <div className="space-y-4">
      {esquerda && (
        <>
          {fixados.length > 0 && (
            <Cartao
              icone={<Pin className="h-3.5 w-3.5" />}
              titulo="Comunicados fixados"
              destaque={naoLidos.length > 0}
            >
              <ul className="space-y-1.5">
                {fixados.map((p) => {
                  const pendente = naoLidos.includes(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => aoAbrirComunicado(p.id)}
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-secondary/60"
                      >
                        <Megaphone
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${pendente ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium">{p.titulo}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {pendente ? "Falta você ler" : "Lido ✓"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          )}

          {(painel.eventos ?? []).length > 0 && (
            <Cartao icone={<CalendarDays className="h-3.5 w-3.5" />} titulo="Próximos eventos">
              <ul className="space-y-1">
                {painel.eventos.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      onClick={() => aoAbrirEvento?.(ev.id)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-secondary/60"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300">
                        <span className="text-sm font-bold leading-none">
                          {new Date(ev.inicio).getDate()}
                        </span>
                        <span className="text-[9px] font-semibold uppercase">
                          {new Date(ev.inicio)
                            .toLocaleDateString("pt-BR", { month: "short" })
                            .replace(".", "")}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-medium">{ev.titulo}</span>
                        <span className="block truncate text-[11px] capitalize text-muted-foreground">
                          {dataDoEvento(ev.inicio)}
                        </span>
                        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {ev.local && (
                            <span className="inline-flex min-w-0 items-center gap-0.5 truncate">
                              <MapPin className="h-3 w-3 shrink-0" /> {ev.local}
                            </span>
                          )}
                          {ev.participantes > 0 && (
                            <span className="shrink-0">
                              {ev.participantes} {ev.participantes === 1 ? "vai" : "vão"}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          {/* Boas-vindas no meio da lateral (17/10/2026). */}
          {painel.boasVindas.length > 0 && (
            <Cartao icone={<Sparkles className="h-3.5 w-3.5" />} titulo="Boas-vindas">
              <ListaRecolhida
                itens={painel.boasVindas}
                render={(b) => {
                  const [a, m, d] = b.desde.split("-");
                  return (
                    <LinhaDePessoa
                      key={b.id}
                      id={b.id}
                      nome={b.nome}
                      detalhe={`Chegou em ${d}/${m}/${a}`}
                    />
                  );
                }}
              />
            </Cartao>
          )}

          <ProximoFeriado />
        </>
      )}
      {direita && (
        <>
          {painel.ativo && !painel.meu && (
            <Cartao
              icone={<Cake className="h-3.5 w-3.5" />}
              titulo="Conte quando é seu aniversário 🎂"
              destaque
            >
              <p className="mb-3 text-xs text-muted-foreground">
                Assim a turma lembra de você no dia (e seu avatar ganha um chapéu de festa).
              </p>
              <MeuAniversario compacto aoSalvar={aoSalvarAniversario} />
            </Cartao>
          )}

          <Cartao icone={<Cake className="h-3.5 w-3.5" />} titulo="Aniversariantes">
            {!temAniversario ? (
              <p className="text-xs text-muted-foreground">
                {painel.ativo
                  ? "Ninguém contou aniversário para este mês ainda."
                  : "Os aniversários aparecem aqui assim que o mural for ativado."}
              </p>
            ) : (
              <div className="space-y-3">
                {painel.hoje.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                      Hoje 🎉
                    </div>
                    <ul className="divide-y divide-border/60">
                      {painel.hoje.map((a) => (
                        <LinhaDePessoa
                          key={a.id}
                          id={a.id}
                          nome={a.nome}
                          detalhe="Faz aniversário hoje"
                          acao={<DarParabens pessoaId={a.id} nome={a.nome} pequeno />}
                        />
                      ))}
                    </ul>
                  </div>
                )}
                {painel.semana.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Esta semana
                    </div>
                    <ListaRecolhida
                      itens={painel.semana}
                      render={(a) => (
                        <LinhaDePessoa
                          key={a.id}
                          id={a.id}
                          nome={a.nome}
                          detalhe={diaEMes(a.dia, a.mes)}
                        />
                      )}
                    />
                  </div>
                )}
                {painel.mes.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Este mês
                    </div>
                    <ListaRecolhida
                      itens={painel.mes}
                      render={(a) => (
                        <LinhaDePessoa
                          key={a.id}
                          id={a.id}
                          nome={a.nome}
                          detalhe={diaEMes(a.dia, a.mes)}
                          apagada={a.dia < hojeBR.getDate()}
                        />
                      )}
                    />
                  </div>
                )}
              </div>
            )}
          </Cartao>

          {painel.tempoDeCasa.length > 0 && (
            <Cartao icone={<Award className="h-3.5 w-3.5" />} titulo="Tempo de casa">
              <ListaRecolhida
                itens={painel.tempoDeCasa}
                render={(t) => (
                  <LinhaDePessoa
                    key={t.id}
                    id={t.id}
                    nome={t.nome}
                    detalhe={`${t.jaFez ? "Completou" : "Completa"} ${t.anos} ${t.anos === 1 ? "ano" : "anos"} de Larsil · ${t.dia}/${String(hojeBR.getMonth() + 1).padStart(2, "0")}`}
                  />
                )}
              />
            </Cartao>
          )}
        </>
      )}
    </div>
  );
}
