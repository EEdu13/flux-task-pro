import { Component, useEffect, useState, type ReactNode } from "react";
import { FabricaDeMiniaturas, useMiniatura } from "@/components/rv/miniaturas";
import { AVATAR_EM_BRANCO, carregarAvataresDe, type AvatarConfig } from "@/lib/avatar-3d";
import { comChapeuDeFesta } from "@/lib/festa-de-aniversario";

/*
 * O avatar de quem conquistou, comemorando, no canto do cartão de conquista
 * do Mural (17/10/2026: "uma imagem do avatar nesse canto sobrando do card,
 * ele feliz comemorando porque concluiu a tarefa").
 *
 * Não é um 3D vivo por cartão — seria um <Canvas> por post. É uma FOTO do
 * boneco com os braços para cima, tirada pela fábrica de miniaturas do
 * provador (um canvas escondido para a página inteira) e guardada no
 * navegador: na segunda visita ela aparece na hora. Quem ainda não montou o
 * seu comemora com o boneco em branco.
 *
 * Carregado sob demanda pelo cartão (three.js é pesado e o Mural abre sem ele).
 */
/**
 * Sem 3D (computador sem WebGL, placa de vídeo bloqueada pela política da
 * empresa), a foto do boneco não pode derrubar a tela em volta: ela aparece no
 * Mural, no confete do aniversário e nas novidades — os dois últimos abrem
 * sozinhos no login. No lugar dela fica um aceno.
 */
class SemTresD extends Component<{ className?: string; children: ReactNode }, { erro: boolean }> {
  state = { erro: false };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[avatar] o 3D não abriu neste computador:", (e as Error)?.message);
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className={`grid place-items-center ${this.props.className ?? ""}`} aria-hidden>
        <span className="text-5xl">🙋</span>
      </div>
    );
  }
}

export default function AvatarComemorando(props: { pessoa: string; className?: string }) {
  return (
    <SemTresD className={props.className}>
      <AvatarComemorandoEm3D {...props} />
    </SemTresD>
  );
}

function AvatarComemorandoEm3D({ pessoa, className }: { pessoa: string; className?: string }) {
  const [config, setConfig] = useState<AvatarConfig | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarAvataresDe([pessoa])
      .then((m) => vivo && setConfig(comChapeuDeFesta(pessoa, m.get(pessoa) ?? AVATAR_EM_BRANCO)))
      .catch((e: unknown) => {
        console.warn("mural: não deu para carregar o avatar", e);
        if (vivo) setConfig(AVATAR_EM_BRANCO);
      });
    return () => {
      vivo = false;
    };
  }, [pessoa]);

  return (
    <>
      <FabricaDeMiniaturas />
      {config && <Foto config={config} className={className} />}
    </>
  );
}

function Foto({ config, className }: { config: AvatarConfig; className?: string }) {
  const foto = useMiniatura(config, "corpo", "comemorar");
  if (!foto) return null;
  return (
    <img
      src={foto}
      alt=""
      aria-hidden
      draggable={false}
      className={`pointer-events-none select-none object-contain drop-shadow-md animate-in fade-in zoom-in-90 duration-500 ${className ?? ""}`}
    />
  );
}

/**
 * O time inteiro abraçado (19/10/2026: "o time inteiro bateu 100%, coloca os
 * avatares se abraçando, unidos"): uma foto de cada um com a pose de grupo
 * (braços abertos para os lados), lado a lado e encavaladas — o braço de um
 * cai por cima do ombro do vizinho. Até 5 pessoas; o resto vira "+N".
 */
export function GrupoAbracado(props: { pessoas: string[]; className?: string }) {
  return (
    <SemTresD className={props.className}>
      <GrupoAbracadoEm3D {...props} />
    </SemTresD>
  );
}

function GrupoAbracadoEm3D({ pessoas, className }: { pessoas: string[]; className?: string }) {
  const visiveis = pessoas.slice(0, 5);
  const chave = visiveis.join(",");
  const [configs, setConfigs] = useState<AvatarConfig[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const ids = chave ? chave.split(",") : [];
    carregarAvataresDe(ids)
      .then(
        (m) =>
          vivo && setConfigs(ids.map((id) => comChapeuDeFesta(id, m.get(id) ?? AVATAR_EM_BRANCO))),
      )
      .catch((e: unknown) => {
        console.warn("mural: não deu para carregar os avatares do time", e);
        if (vivo) setConfigs(ids.map(() => AVATAR_EM_BRANCO));
      });
    return () => {
      vivo = false;
    };
  }, [chave]);
  const resto = pessoas.length - visiveis.length;
  return (
    <div className={`relative flex items-end justify-center ${className ?? ""}`}>
      <FabricaDeMiniaturas />
      {configs?.map((c, i) => (
        <FotoDoGrupo
          key={i}
          config={c}
          // o do meio na frente; os das pontas, um pouco atrás
          z={10 - Math.abs(i - (configs.length - 1) / 2) * 2}
          primeiro={i === 0}
        />
      ))}
      {resto > 0 && (
        <span className="absolute -right-1 bottom-2 z-20 rounded-full bg-white/90 px-2 py-0.5 text-xs font-bold text-slate-700 shadow">
          +{resto}
        </span>
      )}
    </div>
  );
}

function FotoDoGrupo({
  config,
  z,
  primeiro,
}: {
  config: AvatarConfig;
  z: number;
  primeiro: boolean;
}) {
  const foto = useMiniatura(config, "corpo", "grupo");
  return (
    <div
      className={`relative h-40 w-40 shrink-0 ${primeiro ? "" : "-ml-[78px]"}`}
      style={{ zIndex: Math.round(z) }}
    >
      {foto ? (
        <img
          src={foto}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none h-full w-full select-none object-contain drop-shadow-md animate-in fade-in zoom-in-90 duration-500"
        />
      ) : (
        <span className="absolute inset-x-6 bottom-2 top-6 animate-pulse rounded-2xl bg-white/40" />
      )}
    </div>
  );
}
