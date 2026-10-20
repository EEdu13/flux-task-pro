import { Navigate, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Glasses, Mic, MicOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { getLiveKitToken } from "@/lib/livekit-token.functions";
import {
  AVATAR_PADRAO,
  carregarMeuAvatar,
  salvarMeuAvatar,
  type AvatarConfig,
} from "@/lib/avatar-3d";
import { EditorDeAvatar } from "@/components/rv/editor-de-avatar";
import { useSalaAoVivo } from "@/components/rv/sala-ao-vivo/use-sala-ao-vivo";
import { SalaAoVivo } from "@/components/rv/sala-ao-vivo/sala-ao-vivo";
import { CabecalhoRv } from "@/components/rv/sala-ao-vivo/cabecalho";
import { primeiroNome } from "@/integrations/iam/types";

export const Route = createFileRoute("/realidade-virtual")({
  head: () => ({ meta: [{ title: "Realidade Virtual · SGL - CONECTA" }] }),
  component: RealidadeVirtualPage,
});

/** A sala do LiveKit desta experiência — uma só, por enquanto (protótipo). */
const SALA = "realidade-virtual";

type Fase = "carregando" | "editor" | "antessala";

/**
 * Realidade Virtual — protótipo local (08/10/2026; sala imersiva em 10/10/2026).
 *
 * Uma sala de reunião em 3D: cada pessoa entra com o avatar que montou, senta à mesa, fala pelo
 * áudio do LiveKit (o mesmo das salas de hoje) e pode pôr a tela no telão. Na sala: selo de mudo
 * na cabeça, "Cards por IA" (a fala vira balão para todos) e "Gestos pela câmera" (levantar a mão
 * entra na fila e avisa a sala). Nada disto passa pelo banco além de salvar o avatar uma vez.
 *
 * Esta rota só cuida das fases de FORA da sala (carregando, editor, antessala) e do token; a sala
 * conectada mora em `components/rv/sala-ao-vivo/`.
 */
/* Fora do ar por enquanto (decisão de 20/10/2026): quem digitar o endereço
   volta para o Início. `?previa=1` abre mesmo assim, para teste. */
function RealidadeVirtualPage() {
  const previa =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("previa") === "1";
  if (!previa) return <Navigate to="/" />;
  return <RealidadeVirtualLiberada />;
}

function RealidadeVirtualLiberada() {
  const { currentUser } = useFluxo();
  const [fase, setFase] = useState<Fase>("carregando");
  const [meuAvatar, setMeuAvatar] = useState<AvatarConfig>(AVATAR_PADRAO);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [montado, setMontado] = useState(false);
  const meuNome = primeiroNome(currentUser.name);

  // Editor aberto com a reunião em curso: cards e câmera dos gestos pausam (ver o hook).
  const sala = useSalaAoVivo({ meuId: currentUser.id, meuNome, meuAvatar, pausado: editando });
  const naSala = sala.fase === "na-sala";

  // O 3D só no navegador: o servidor não tem WebGL.
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    let vivo = true;
    carregarMeuAvatar()
      .then((a) => {
        if (!vivo) return;
        if (a) {
          setMeuAvatar(a);
          setFase("antessala");
        } else setFase("editor");
      })
      .catch(() => vivo && setFase("editor"));
    return () => {
      vivo = false;
    };
  }, []);

  const salvar = async (a: AvatarConfig) => {
    setSalvando(true);
    try {
      await salvarMeuAvatar(a);
      // Já na sala, o hook manda o avatar novo para todos assim que ele muda.
      setMeuAvatar(a);
      setEditando(false);
      if (fase === "editor") setFase("antessala");
    } catch {
      toast.error("Não foi possível salvar o avatar");
    } finally {
      setSalvando(false);
    }
  };

  const entrar = async () => {
    // No clique: o AudioContext precisa nascer de um gesto da pessoa (política de autoplay).
    sala.prepararAudio();
    try {
      const { token, url } = await getLiveKitToken({
        data: { roomName: SALA, identity: currentUser.id, name: currentUser.name },
      });
      await sala.entrar(url, token);
    } catch (e) {
      toast.error("Não foi possível entrar na sala", { description: (e as Error)?.message });
    }
  };

  const conectando = sala.fase === "conectando";

  return (
    <FluxoLayout title="Realidade Virtual" breadcrumb="Salas Online">
      <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-2">
        {!(montado && naSala && !editando) && <CabecalhoRv />}

        {fase === "carregando" && (
          <div className="grid h-[60vh] place-items-center text-sm text-muted-foreground">
            Carregando…
          </div>
        )}

        {montado && naSala && editando && (
          <EditandoNaSala
            micLigado={sala.micLigado}
            semMicrofone={sala.semMicrofone}
            pausouAlgo={sala.cards.ligado || sala.gestos.ligado}
            aoAlternarMic={() => void sala.alternarMic()}
          />
        )}

        {montado && (fase === "editor" || editando) && (
          <EditorDeAvatar
            inicial={meuAvatar}
            nome={meuNome}
            salvando={salvando}
            aoSalvar={(a) => void salvar(a)}
            aoCancelar={fase === "editor" ? undefined : () => setEditando(false)}
          />
        )}

        {montado && !editando && fase === "antessala" && !naSala && (
          <div className="grid place-items-center rounded-2xl border border-border bg-card px-6 py-12 text-center">
            <div className="max-w-md space-y-3">
              <div className="text-5xl">🥽</div>
              <h2 className="text-lg font-semibold">Pronto para entrar?</h2>
              <p className="text-sm text-muted-foreground">
                Você senta à mesa com o seu avatar. Os outros te ouvem pelo microfone e veem quando
                você fala. Dá para mostrar a sua tela no telão, levantar a mão (tecla L ou pela
                câmera) e ligar os cards por IA.
              </p>
              <div className="flex justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditando(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm hover:bg-secondary"
                >
                  <Pencil className="h-4 w-4" /> Editar avatar
                </button>
                <button
                  type="button"
                  disabled={conectando}
                  onClick={() => void entrar()}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60"
                >
                  <Glasses className="h-4 w-4" /> {conectando ? "Entrando…" : "Entrar na sala"}
                </button>
              </div>
            </div>
          </div>
        )}

        {montado && naSala && !editando && (
          <SalaAoVivo sala={sala} aoEditarAvatar={() => setEditando(true)} />
        )}
      </div>
    </FluxoLayout>
  );
}

/**
 * Faixa sobre o editor quando ele é aberto DENTRO da reunião: a pessoa continua na sala e com o
 * microfone como estava. Sem isto, a tela da sala (selo da IA, barra, mudo) some e ela não sabe
 * que ainda está sendo ouvida — por isso o botão de mudo vem junto.
 */
function EditandoNaSala({
  micLigado,
  semMicrofone,
  pausouAlgo,
  aoAlternarMic,
}: {
  micLigado: boolean;
  semMicrofone: boolean;
  pausouAlgo: boolean;
  aoAlternarMic: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-[13px]"
    >
      <span className="font-semibold">Você continua na reunião.</span>
      <span className="text-muted-foreground">
        {semMicrofone
          ? "Sem microfone: os outros não te ouvem."
          : micLigado
            ? "Os outros ainda te ouvem."
            : "Você está no mudo."}
        {pausouAlgo && " Cards por IA e gestos pausados enquanto edita o avatar."}
      </span>
      {!semMicrofone && (
        <button
          type="button"
          onClick={aoAlternarMic}
          className={`ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white ${
            micLigado ? "bg-[#166534] hover:bg-[#15803d]" : "bg-[#dc2626] hover:bg-[#b91c1c]"
          }`}
        >
          {micLigado ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          {micLigado ? "Fechar o microfone" : "Abrir o microfone"}
        </button>
      )}
    </div>
  );
}
