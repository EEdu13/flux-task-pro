import { Suspense, lazy, useMemo, useState } from "react";
import { DoorOpen, Map as MapaIcone, MessageCircle, Network, Users, X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { useChat } from "@/lib/chat-store";
import type { User } from "@/lib/fluxo-types";
import { INFO_DO_ESTADO } from "@/lib/estado-do-chat";
import { rotuloDoAte, statusTiraDaMesa } from "@/lib/status-personalizado";
import { COR_DA_SITUACAO, type Situacao } from "./moveis";
import { GERENCIAS, type PessoaNoAndar, type SetorDoAndar } from "./andar";
import type { FocoDoAndar } from "./andar-3d";

/*
 * O "Escritório 3D" dos Contatos: o ANDAR inteiro (18/10/2026) — todas as
 * salas dos setores, as gerências coladas nos setores de cada gerente e o
 * refeitório. Por cima do 3D: ir para uma sala, ver o andar todo, a contagem
 * por situação e o cartão de quem foi clicado (conversar, entrar na sala
 * dele, ver na hierarquia e — gerente — ver a área dele).
 *
 * O 3D (three.js) só carrega quando esta vista abre.
 */
const Andar3D = lazy(() => import("./andar-3d"));

type Setor = { id: string; name: string; color: string; total: number };

export function EscritorioDoSetor({
  users,
  setores,
  setorInicial,
  aoVerHierarquia,
}: {
  users: User[];
  setores: Setor[];
  /** O setor que abre em foco; "" = o andar todo. */
  setorInicial: string;
  aoVerHierarquia: (id: string) => void;
}) {
  const { situacaoDe, statusDe, openChat } = useChat();
  const [foco, setFoco] = useState<FocoDoAndar>(() =>
    setorInicial ? { tipo: "sala", id: setorInicial, n: 0 } : { tipo: "andar", n: 0 },
  );
  const irPara = (f: { tipo: "andar" } | { tipo: "sala" | "area" | "pessoa"; id: string }) =>
    setFoco({ ...f, n: Date.now() } as FocoDoAndar);
  const [escolhido, setEscolhido] = useState<string | null>(null);

  /* As pessoas com a situação do chat. A chave muda só quando alguém muda de
     situação (a presença é consultada a cada 10 s): o andar não se remonta à toa.

     (19/10/2026) Com o status personalizado: quem está em campo, de férias ou
     de atestado entra como "offline" — a mesa fica vazia, com o nome e o
     status no chip, e a pessoa não vai para o refeitório (que é do ausente).
     O status entra na chave só para o chip se atualizar; as peças paradas do
     andar (`Estatico`) seguem dependendo só da situação. */
  const lista: PessoaNoAndar[] = users.map((u) => {
    const st = statusDe(u.id);
    const status = st ? { emoji: st.emoji, texto: st.texto } : undefined;
    return {
      id: u.id,
      nome: u.name,
      cargo: u.jobTitle,
      role: u.role,
      setor: u.sector,
      supervisorId: u.supervisorId,
      supervisorNome: u.supervisorNome,
      situacao: (statusTiraDaMesa(status) ? "offline" : situacaoDe(u.id)) as Situacao,
      status,
    };
  });
  const chave = lista
    .map(
      (p) =>
        `${p.id}:${p.situacao}:${p.setor}:${p.role}:${p.status ? p.status.emoji + p.status.texto : ""}`,
    )
    .join("|");
  const pessoas = useMemo(() => lista, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  const setoresDoAndar: SetorDoAndar[] = useMemo(
    () => setores.map((s) => ({ id: s.id, nome: s.name, cor: s.color })),
    [setores],
  );

  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { disponivel: 0, ocupado: 0, ausente: 0, offline: 0 };
    let fora = 0;
    for (const p of pessoas) {
      // Em campo/férias/atestado não é "offline" na contagem: tem a própria.
      if (statusTiraDaMesa(p.status)) fora++;
      else c[p.situacao]++;
    }
    return { ...c, fora };
  }, [pessoas]);

  const quem = escolhido ? users.find((u) => u.id === escolhido) : null;
  const situacaoDoEscolhido = quem ? (situacaoDe(quem.id) as Situacao) : null;
  const statusDoEscolhido = quem ? statusDe(quem.id) : null;

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-xl bg-gradient-to-b from-slate-100 via-slate-50 to-stone-200 dark:from-slate-800 dark:via-slate-900 dark:to-stone-900">
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Montando o escritório…
          </div>
        }
      >
        <Andar3D
          setores={setoresDoAndar}
          pessoas={pessoas}
          foco={foco}
          aoEscolherPessoa={setEscolhido}
        />
      </Suspense>

      {/* navegação e contagem, no alto */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => irPara({ tipo: "andar" })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-sm font-semibold shadow-sm backdrop-blur hover:bg-secondary"
          >
            <MapaIcone className="h-4 w-4" /> Andar todo
          </button>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("g:")) irPara({ tipo: "area", id: v });
              else if (v) irPara({ tipo: "sala", id: v });
            }}
            className="rounded-lg border border-border bg-card/95 px-3 py-1.5 text-sm font-semibold shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Ir para"
          >
            <option value="">Ir para…</option>
            <optgroup label="Entrada e diretoria">
              <option value="recepcao">🛎️ Recepção</option>
              <option value="diretoria">🏛️ Diretoria</option>
              <option value="reuniao-1">📅 Sala de reunião 1</option>
              <option value="reuniao-2">📅 Sala de reunião 2</option>
              <option value="refeitorio">☕ Refeitório</option>
            </optgroup>
            <optgroup label="Gerências (com os setores)">
              {GERENCIAS.map((g) => (
                <option key={g.chave} value={`g:${g.chave}`}>
                  {g.titulo}
                </option>
              ))}
            </optgroup>
            <optgroup label="Setores">
              {setores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.total})
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["disponivel", "ocupado", "ausente", "offline"] as const).map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: COR_DA_SITUACAO[s] }} />
              {contagem[s]}{" "}
              {s === "disponivel"
                ? "trabalhando"
                : s === "ocupado"
                  ? "ocupado"
                  : s === "ausente"
                    ? "no refeitório"
                    : "offline"}
            </span>
          ))}
          {contagem.fora > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur"
              title="Pelo status: em campo, de férias ou de atestado"
            >
              🚜 {contagem.fora} fora do escritório
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/80 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
        Clique numa sala para entrar · arraste para girar · roda do mouse para aproximar · botão
        direito para mover
      </div>

      {/* o cartão de quem foi clicado */}
      {quem && situacaoDoEscolhido && (
        <div className="absolute bottom-3 right-3 w-72 rounded-xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => setEscolhido(null)}
            aria-label="Fechar"
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-2.5 pr-5">
            <UserAvatar nome={quem.name} iniciais={quem.avatar} className="h-10 w-10 text-xs" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{quem.name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{quem.jobTitle}</div>
              <div
                className={`text-[11px] font-semibold ${INFO_DO_ESTADO[situacaoDoEscolhido].texto}`}
              >
                ● {INFO_DO_ESTADO[situacaoDoEscolhido].rotulo}
              </div>
            </div>
          </div>
          {statusDoEscolhido && (
            <div
              className="mt-2 flex items-center gap-2 rounded-lg bg-secondary/60 px-2 py-1.5 text-xs"
              title="Status personalizado"
            >
              <span className="text-base leading-none">{statusDoEscolhido.emoji || "💬"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{statusDoEscolhido.texto}</span>
                {statusDoEscolhido.ate && (
                  <span className="block text-[10px] text-muted-foreground">
                    {rotuloDoAte(statusDoEscolhido.ate)}
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => openChat(quem.id)}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110"
            >
              <MessageCircle className="h-3.5 w-3.5" /> Conversar
            </button>
            <button
              type="button"
              onClick={() => irPara({ tipo: "pessoa", id: quem.id })}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <DoorOpen className="h-3.5 w-3.5" /> Entrar na sala
            </button>
            <button
              type="button"
              onClick={() => aoVerHierarquia(quem.id)}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              <Network className="h-3.5 w-3.5" /> Hierarquia
            </button>
            {quem.role === "gerente" && (
              <button
                type="button"
                onClick={() => irPara({ tipo: "area", id: quem.id })}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-400/60 bg-amber-400/10 px-2 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-400/20 dark:text-amber-300"
              >
                <Users className="h-3.5 w-3.5" /> Ver a área
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
