import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { FabricaDeMiniaturas, useMiniatura } from "@/components/rv/miniaturas";
import { AVATAR_EM_BRANCO, carregarAvataresDe, type AvatarConfig } from "@/lib/avatar-3d";
import { comChapeuDeFesta } from "@/lib/festa-de-aniversario";
import type { Role, User } from "@/lib/fluxo-types";

/*
 * A aba Equipes de Contatos (29/10/2026: "ver a equipe e os avatares de
 * todos, não conseguimos ver o avatar de todos").
 *
 * Todo mundo por setor, cada um com a foto do avatar de corpo inteiro. Não é
 * um 3D vivo por pessoa — seriam 40+ <Canvas> e o notebook trava. São FOTOS
 * tiradas pela fábrica de miniaturas do provador (um canvas escondido para a
 * página toda) e guardadas no navegador: na segunda visita aparecem na hora.
 * Quem ainda não montou o seu aparece com o boneco em branco.
 *
 * Carregado sob demanda pela página (three.js é pesado e Contatos abre sem ele).
 */

type Setor = { id: string; name: string; color: string };

const ORDEM_DO_PAPEL: Record<Role, number> = { gerente: 0, supervisor: 1, adm: 2 };

/** Sem 3D (WebGL bloqueado), a foto não derruba a aba: fica um aceno no lugar. */
class SemTresD extends Component<{ children: ReactNode }, { erro: boolean }> {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[equipes] o 3D não abriu neste computador:", (e as Error)?.message);
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return <span className="text-4xl">🙋</span>;
  }
}

function Foto({ config }: { config: AvatarConfig }) {
  const foto = useMiniatura(config, "corpo");
  if (!foto) return <div className="h-20 w-14 animate-pulse rounded-full bg-muted/60" />;
  return <img src={foto} alt="" draggable={false} className="h-full w-full object-contain" />;
}

function CartaoDaPessoa({
  user,
  config,
  semAvatar,
  cor,
  aoEscolher,
}: {
  user: User;
  config: AvatarConfig | null;
  semAvatar: boolean;
  cor: string;
  aoEscolher: (id: string) => void;
}) {
  const partes = user.name.trim().split(/\s+/);
  const nomeCurto = partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1]}` : partes[0];
  return (
    <motion.button
      type="button"
      onClick={() => aoEscolher(user.id)}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      title={`${user.name} · ver a linha de reporte`}
      className="group flex flex-col items-center rounded-xl border border-border bg-background p-2 pb-2.5 text-center shadow-sm transition hover:border-primary/50 hover:shadow-md"
    >
      <div
        className="relative grid h-32 w-full place-items-center overflow-hidden rounded-lg"
        style={{ background: `color-mix(in oklab, ${cor} 12%, transparent)` }}
      >
        {config ? (
          <SemTresD>
            <Foto config={config} />
          </SemTresD>
        ) : (
          <div className="h-20 w-14 animate-pulse rounded-full bg-muted/60" />
        )}
        {semAvatar && (
          <span className="absolute bottom-1 rounded-full bg-background/85 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            sem avatar
          </span>
        )}
      </div>
      <div className="mt-1.5 w-full truncate text-xs font-semibold">{nomeCurto}</div>
      <div className="w-full truncate text-[10px] text-muted-foreground">{user.jobTitle}</div>
    </motion.button>
  );
}

export default function EquipesComAvatar({
  users,
  setores,
  aoEscolher,
}: {
  users: User[];
  setores: Setor[];
  aoEscolher: (id: string) => void;
}) {
  const [avatares, setAvatares] = useState<Map<string, AvatarConfig | null> | null>(null);
  const ids = useMemo(() => users.map((u) => u.id).sort(), [users]);
  const chaveIds = ids.join(",");

  useEffect(() => {
    let vivo = true;
    carregarAvataresDe(ids)
      .then((m) => vivo && setAvatares(m))
      .catch((e: unknown) => {
        console.warn("equipes: não deu para carregar os avatares", e);
        if (vivo) setAvatares(new Map());
      });
    return () => {
      vivo = false;
    };
    // `chaveIds` resume `ids`: a lista nova com as mesmas pessoas não pede de novo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds]);

  const grupos = useMemo(() => {
    const porSetor = new Map<string, User[]>();
    for (const u of users) porSetor.set(u.sector, [...(porSetor.get(u.sector) ?? []), u]);
    return setores
      .filter((s) => porSetor.has(s.id))
      .map((s) => ({
        setor: s,
        pessoas: porSetor
          .get(s.id)!
          .sort(
            (a, b) =>
              ORDEM_DO_PAPEL[a.role] - ORDEM_DO_PAPEL[b.role] || a.name.localeCompare(b.name),
          ),
      }));
  }, [users, setores]);

  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
        Nenhuma pessoa com esse filtro.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pr-1">
      <FabricaDeMiniaturas />
      <div className="flex flex-col gap-6 pb-2">
        {grupos.map(({ setor, pessoas }) => (
          <section key={setor.id}>
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: setor.color }} />
              <h3 className="text-sm font-bold">{setor.name}</h3>
              <span className="text-[11px] text-muted-foreground">
                {pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5">
              {pessoas.map((u) => {
                const salvo = avatares?.get(u.id);
                const config = avatares ? comChapeuDeFesta(u.id, salvo ?? AVATAR_EM_BRANCO) : null;
                return (
                  <CartaoDaPessoa
                    key={u.id}
                    user={u}
                    config={config}
                    semAvatar={!!avatares && !salvo}
                    cor={setor.color}
                    aoEscolher={aoEscolher}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
