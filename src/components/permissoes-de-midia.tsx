import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Mic, Video } from "lucide-react";
import { versaoPeloMenos } from "@/components/conversor/ambiente";
import { isTauri } from "@/lib/desktop";
import { useMicrofone } from "@/lib/use-microfone";

/*
 * Câmera e microfone, nas Configurações (23/11/2026). Pedido do usuário: as pessoas recusavam a
 * pergunta do navegador e ela não voltava mais — e sem câmera e microfone não há chamada, gravação
 * nem ditado. Aqui a pessoa vê o que está liberado, testa cada aparelho e, se estiver bloqueado,
 * vê o caminho para liberar:
 *
 * - no navegador, a recusa fica guardada e o site não pode perguntar de novo: só a pessoa desfaz,
 *   pelo ícone à esquerda do endereço (o caminho muda de navegador para navegador);
 * - no app de mesa a partir da 0.2.4, o próprio app libera câmera e microfone para o nosso site
 *   (`src-tauri/src/permissoes.rs`); no app anterior a recusa não tem volta pela tela, e a saída é
 *   a atualização, que chega sozinha;
 * - liberado para o site e mesmo assim recusado: é a chave de privacidade do Windows (ou do Mac).
 */

/** A versão do app de mesa que libera câmera e microfone sozinha. */
const APP_QUE_LIBERA = "0.2.4";

type Onde = "navegador" | "app-antigo" | "app";
/** O que o navegador diz da permissão; "desconhecido" quando ele não conta (o Firefox). */
type Permissao = "liberado" | "bloqueado" | "perguntar" | "desconhecido";
type Aparelho = "microfone" | "camera";

/** Navegador ou app de mesa, e se o app já é o que libera sozinho. */
function useOnde(): Onde {
  const [onde, setOnde] = useState<Onde>(() => (isTauri() ? "app-antigo" : "navegador"));
  useEffect(() => {
    if (!isTauri()) return;
    let vivo = true;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (vivo && versaoPeloMenos(v, APP_QUE_LIBERA)) setOnde("app");
      })
      .catch(() => {
        /* sem resposta da versão: segue como app antigo */
      });
    return () => {
      vivo = false;
    };
  }, []);
  return onde;
}

/** A permissão do site para o aparelho, acompanhando as mudanças (o teste que libera, o cadeado). */
function usePermissao(aparelho: Aparelho): Permissao {
  const [estado, setEstado] = useState<Permissao>("desconhecido");
  useEffect(() => {
    let vivo = true;
    let status: PermissionStatus | null = null;
    const ler = () => {
      if (!vivo || !status) return;
      setEstado(
        status.state === "granted"
          ? "liberado"
          : status.state === "denied"
            ? "bloqueado"
            : "perguntar",
      );
    };
    const nome = (aparelho === "camera" ? "camera" : "microphone") as PermissionName;
    navigator.permissions
      ?.query({ name: nome })
      .then((s) => {
        status = s;
        ler();
        s.addEventListener("change", ler);
      })
      .catch(() => {
        /* o Firefox não responde por câmera e microfone: fica "desconhecido" */
      });
    return () => {
      vivo = false;
      status?.removeEventListener("change", ler);
    };
  }, [aparelho]);
  return estado;
}

/** O nome do navegador, só para escolher o passo a passo certo. */
function navegador(): "edge" | "chrome" | "safari" | "firefox" | "outro" {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "outro";
}

const ehMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function PermissoesDeMidia() {
  const onde = useOnde();
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-1 text-sm font-semibold">Câmera e microfone</h3>
      <p className="mb-4 text-[11px] text-muted-foreground">
        O CONECTA usa o microfone nas chamadas, no ditado e nas gravações, e a câmera nas chamadas e
        na sala ao vivo. Eles só ligam quando você usa um desses recursos.
        {onde === "app" && " No app de mesa, câmera e microfone já ficam liberados para o CONECTA."}
      </p>
      <div className="space-y-4">
        <CartaoDoMicrofone onde={onde} />
        <CartaoDaCamera onde={onde} />
      </div>
    </section>
  );
}

function Selo({ permissao }: { permissao: Permissao }) {
  const [texto, cor] =
    permissao === "liberado"
      ? ["Liberado", "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"]
      : permissao === "bloqueado"
        ? ["Bloqueado", "bg-destructive/15 text-destructive"]
        : permissao === "perguntar"
          ? ["Vai perguntar no primeiro uso", "bg-amber-500/15 text-amber-700 dark:text-amber-400"]
          : ["Teste para saber", "bg-secondary text-muted-foreground"];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cor}`}>{texto}</span>
  );
}

function Cartao({
  icone,
  titulo,
  permissao,
  children,
}: {
  icone: ReactNode;
  titulo: string;
  permissao: Permissao;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        {icone}
        <span className="text-sm font-medium">{titulo}</span>
        <span className="ml-auto">
          <Selo permissao={permissao} />
        </span>
      </div>
      {children}
    </div>
  );
}

const botao =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-secondary disabled:opacity-60";

/* ------------------------------- Microfone ------------------------------- */

function CartaoDoMicrofone({ onde }: { onde: Onde }) {
  const permissao = usePermissao("microfone");
  const [testando, setTestando] = useState(false);
  const { estado, leituraRef, nomeDoAparelho } = useMicrofone(testando);
  const barraRef = useRef<HTMLDivElement>(null);

  // O volume, quadro a quadro, direto no estilo da barra (sem estado: seriam 60 renders por segundo).
  useEffect(() => {
    if (estado !== "ativo") return;
    let quadro = 0;
    const desenhar = () => {
      const { analisador, onda } = leituraRef.current;
      if (analisador && onda.length > 0 && barraRef.current) {
        analisador.getByteTimeDomainData(onda);
        let soma = 0;
        for (const v of onda) soma += ((v - 128) / 128) ** 2;
        const nivel = Math.min(1, Math.sqrt(soma / onda.length) * 4);
        barraRef.current.style.width = `${Math.round(nivel * 100)}%`;
      }
      quadro = requestAnimationFrame(desenhar);
    };
    quadro = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(quadro);
  }, [estado, leituraRef]);

  const recusado = testando && estado === "negado";
  return (
    <Cartao icone={<Mic className="h-4 w-4" />} titulo="Microfone" permissao={permissao}>
      {testando && estado === "ativo" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Fale alguma coisa: a barra deve mexer.{" "}
            {nomeDoAparelho && <span className="text-foreground">({nomeDoAparelho})</span>}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              ref={barraRef}
              className="h-full w-0 rounded-full bg-emerald-500 transition-[width] duration-75"
            />
          </div>
          <button type="button" className={botao} onClick={() => setTestando(false)}>
            Parar o teste
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={botao}
          disabled={testando && estado === "pedindo"}
          onClick={() => {
            setTestando(false);
            // Um quadro depois, para o teste recomeçar mesmo se o anterior falhou.
            requestAnimationFrame(() => setTestando(true));
          }}
        >
          {testando && estado === "pedindo" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Testar o microfone
        </button>
      )}
      {testando && estado === "indisponivel" && (
        <p className="mt-2 text-xs text-destructive">
          Não deu para ligar o microfone. Confira se ele está conectado e se outro programa não está
          usando.
        </p>
      )}
      {(permissao === "bloqueado" || recusado) && (
        <ComoLiberar aparelho="microfone" onde={onde} peloSistema={permissao === "liberado"} />
      )}
    </Cartao>
  );
}

/* --------------------------------- Câmera --------------------------------- */

type EstadoDaCamera = "parada" | "pedindo" | "ativa" | "negada" | "sem-camera" | "ocupada";

function CartaoDaCamera({ onde }: { onde: Onde }) {
  const permissao = usePermissao("camera");
  const [estado, setEstado] = useState<EstadoDaCamera>("parada");
  const [nome, setNome] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fluxoRef = useRef<MediaStream | null>(null);

  const parar = () => {
    fluxoRef.current?.getTracks().forEach((t) => t.stop());
    fluxoRef.current = null;
    setEstado("parada");
  };
  // Saiu da aba com o teste ligado: solta a câmera (a luz apaga).
  useEffect(() => () => fluxoRef.current?.getTracks().forEach((t) => t.stop()), []);

  const testar = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado("sem-camera");
      return;
    }
    setEstado("pedindo");
    try {
      const fluxo = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      fluxoRef.current = fluxo;
      setNome(fluxo.getVideoTracks()[0]?.label ?? "");
      setEstado("ativa");
    } catch (e) {
      const erro = e instanceof DOMException ? e.name : "";
      setEstado(
        erro === "NotAllowedError" || erro === "SecurityError"
          ? "negada"
          : erro === "NotFoundError" || erro === "OverconstrainedError"
            ? "sem-camera"
            : "ocupada",
      );
    }
  };

  // O vídeo só existe depois que o estado vira "ativa".
  useEffect(() => {
    if (estado === "ativa" && videoRef.current && fluxoRef.current) {
      videoRef.current.srcObject = fluxoRef.current;
    }
  }, [estado]);

  return (
    <Cartao icone={<Video className="h-4 w-4" />} titulo="Câmera" permissao={permissao}>
      {estado === "ativa" ? (
        <div className="space-y-2">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full max-w-xs rounded-md bg-black object-cover"
          />
          {nome && <p className="text-xs text-muted-foreground">{nome}</p>}
          <button type="button" className={botao} onClick={parar}>
            Parar o teste
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={botao}
          disabled={estado === "pedindo"}
          onClick={() => void testar()}
        >
          {estado === "pedindo" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Testar a câmera
        </button>
      )}
      {estado === "sem-camera" && (
        <p className="mt-2 text-xs text-destructive">Nenhuma câmera encontrada neste computador.</p>
      )}
      {estado === "ocupada" && (
        <p className="mt-2 text-xs text-destructive">
          Não deu para ligar a câmera: outro programa (Teams, Zoom…) parece estar usando agora.
        </p>
      )}
      {(permissao === "bloqueado" || estado === "negada") && (
        <ComoLiberar aparelho="câmera" onde={onde} peloSistema={permissao === "liberado"} />
      )}
    </Cartao>
  );
}

/* ------------------------------ Como liberar ------------------------------ */

/**
 * O caminho para liberar. `peloSistema`: o site está liberado e mesmo assim veio a recusa — quem
 * bloqueia é a privacidade do Windows (ou do Mac).
 */
function ComoLiberar({
  aparelho,
  onde,
  peloSistema,
}: {
  aparelho: "microfone" | "câmera";
  onde: Onde;
  peloSistema: boolean;
}) {
  const Aparelho = aparelho === "microfone" ? "Microfone" : "Câmera";
  let passos: ReactNode;
  if (peloSistema || onde === "app") {
    passos = ehMac() ? (
      <>
        O Mac está bloqueando. Abra <b>Ajustes do Sistema → Privacidade e Segurança → {Aparelho}</b>{" "}
        e ligue para o navegador que você usa. Depois, feche e abra o navegador.
      </>
    ) : (
      <>
        O Windows está bloqueando. Abra{" "}
        <b>Configurações do Windows → Privacidade e segurança → {Aparelho}</b> e ligue{" "}
        <b>Acesso {aparelho === "microfone" ? "ao microfone" : "à câmera"}</b>,{" "}
        <b>Permitir que aplicativos acessem</b> e{" "}
        <b>Permitir que aplicativos da área de trabalho acessem</b>. Depois, teste de novo.
      </>
    );
  } else if (onde === "app-antigo") {
    passos = (
      <>
        No app de mesa, a recusa não tem volta por aqui — mas a versão nova do app libera câmera e
        microfone sozinha, e ela chega automaticamente: feche o app pelo ícone perto do relógio
        (botão direito → <b>Sair</b>), abra de novo e espere um minuto. O app se atualiza e reabre.
      </>
    );
  } else {
    const nav = navegador();
    passos =
      nav === "safari" ? (
        <>
          No menu <b>Safari → Ajustes → Sites → {Aparelho}</b>, escolha <b>Permitir</b> para este
          site. Depois, recarregue a página.
        </>
      ) : nav === "firefox" ? (
        <>
          Clique no ícone à esquerda do endereço, apague o bloqueio de <b>{aparelho}</b> e
          recarregue a página.
        </>
      ) : (
        <>
          Clique no ícone à esquerda do endereço (o cadeado ou os ajustes), em <b>{Aparelho}</b>{" "}
          escolha <b>Permitir</b> e recarregue a página.
        </>
      );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">
      <p className="mb-1 font-semibold">
        Como liberar {aparelho === "microfone" ? "o microfone" : "a câmera"}
      </p>
      <p className="text-muted-foreground [&_b]:text-foreground">{passos}</p>
    </div>
  );
}
