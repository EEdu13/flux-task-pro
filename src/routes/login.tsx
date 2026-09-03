import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Palette as PaletteIcon,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import larsilSimbolo from "@/assets/bolabranca.png";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels } from "@/lib/fluxo-types";
import { paletteOptions, usePalette } from "@/lib/use-theme";
import {
  iamLogin,
  iamStatus,
  type PerfilFuncional,
} from "@/integrations/iam/auth.functions";
import { iniciaisDoNome, papeisParaRole, type IamUsuario } from "@/integrations/iam/types";
import { chaveDaFoto, guardarNome, nomeConhecido } from "@/integrations/iam/nome-cache";
import { FirstAccessModal } from "@/components/first-access-modal";
import { transicionar } from "@/components/transition-veil";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar · Fluxo" },
      {
        name: "description",
        content:
          "SGL - CONECTA: o ambiente completo da Larsil para organizar tarefas, conectar equipes e transformar trabalho em resultado.",
      },
    ],
  }),
  // Descobre no servidor se a integração com a IAM está ligada. Enquanto
  // IAM_ENABLED=0, a tela antiga (seleção de perfil) continua valendo.
  loader: async () => await iamStatus(),
  component: LoginPage,
});

function LoginPage() {
  const { habilitado } = Route.useLoaderData();
  const { isAuthenticated } = useFluxo();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

  // Marca o documento inteiro como superfície de login enquanto esta tela
  // existe. Sem isso o fundo escuro fica preso no <div> abaixo e a calha da
  // barra de rolagem — pintada pelo <html> — sai clara junto com o tema.
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.add("fluxo-auth");
    return () => raiz.classList.remove("fluxo-auth");
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[var(--auth-base)] text-white">
      <Aurora />
      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-16 lg:py-0">
        <Marca />
        <div className="relative">
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-70 blur-md"
            style={{
              background:
                "linear-gradient(135deg, var(--auth-deep) 0%, var(--auth-glow) 100%)",
            }}
          />
          {habilitado ? <FormIam /> : <FormDemo />}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Login real (IAM) ----------------------------- */

function FormIam() {
  const { loginFromIam } = useFluxo();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [erro, setErro] = useState<{ texto: string; inativo: boolean } | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [primeiroAcesso, setPrimeiroAcesso] = useState<{
    usuario: IamUsuario;
    perfil: PerfilFuncional | null;
  } | null>(null);

  const entrar = (u: IamUsuario, avisarTelefone: boolean, perfil: PerfilFuncional | null) => {
    // Guarda login → nome completo. É isso que faz a foto CERTA aparecer já na
    // digitação no próximo acesso desta máquina: a IAM indexa foto por nome, e
    // o login cru pode cair num registro antigo.
    guardarNome(login, u.nome);

    void transicionar({ tipo: "entrada", nome: u.nome, iniciais: iniciaisDoNome(u.nome) }, () => {
      entrarNoSistema(u, avisarTelefone, perfil);
    });
  };

  const entrarNoSistema = (
    u: IamUsuario,
    avisarTelefone: boolean,
    perfil: PerfilFuncional | null,
  ) => {
    loginFromIam({
      id: u.id,
      nome: u.nome,
      // O papel vem da hierarquia real quando ela é conhecida; os `papeis` da
      // IAM são só a reserva para quem não está nas tabelas de colaboradores.
      role: perfil?.role ?? papeisParaRole(u.papeis ?? [], u.admin),
      avatar: iniciaisDoNome(u.nome),
      papeis: u.papeis ?? [],
      email: u.email,
      telefone: u.telefone,
      funcao: perfil?.funcao,
      setorId: perfil?.setorId,
      supervisorNome: perfil?.supervisorNome,
    });
    if (avisarTelefone) {
      toast.warning("Seu telefone não está cadastrado", {
        description: "Sem ele as notificações por WhatsApp não chegam. Avise a TI.",
        duration: 8000,
      });
    }
    navigate({ to: "/" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setEntrando(true);
    try {
      const r = await iamLogin({ data: { login: login.trim(), senha } });
      if (!r.ok) {
        setErro({ texto: r.erro, inativo: r.motivo === "inativo" });
        return;
      }
      // §1 do contrato: senha provisória bloqueia o sistema até o primeiro acesso.
      if (r.senhaProvisoria) {
        setPrimeiroAcesso({ usuario: r.usuario, perfil: r.perfil });
        return;
      }
      entrar(r.usuario, r.precisaTelefone, r.perfil);
    } catch (err) {
      setErro({ texto: (err as Error)?.message ?? "Não foi possível entrar.", inativo: false });
    } finally {
      setEntrando(false);
    }
  };

  return (
    <>
      <form
        onSubmit={submit}
        className="relative rounded-2xl border border-white/10 bg-[color-mix(in_oklab,var(--auth-base)_88%,white)]/90 p-8 backdrop-blur-xl"
      >
        <Cabecalho subtitulo="Acesso corporativo Larsil" login={login} />

        <label
          htmlFor="iam-login"
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/60"
        >
          Usuário
        </label>
        <div className="mb-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2.5 focus-within:border-white/30">
          <UserIcon className="h-4 w-4 text-white/40" />
          <input
            id="iam-login"
            value={login}
            autoFocus
            autoComplete="username"
            onChange={(e) => setLogin(e.target.value)}
            placeholder="nome.sobrenome"
            className="flex-1 bg-transparent text-sm placeholder:text-white/30 focus:outline-none"
          />
        </div>

        <label
          htmlFor="iam-senha"
          className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/60"
        >
          Senha
        </label>
        <div className="mb-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2.5 focus-within:border-white/30">
          <Lock className="h-4 w-4 text-white/40" />
          <input
            id="iam-senha"
            type={senhaVisivel ? "text" : "password"}
            value={senha}
            autoComplete="current-password"
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
            className="flex-1 bg-transparent text-sm placeholder:text-white/30 focus:outline-none"
          />
          {/* Botão próprio: o nativo do Edge some ao perder o foco e não aceita estilo. */}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setSenhaVisivel((v) => !v)}
            aria-label={senhaVisivel ? "Ocultar senha" : "Mostrar senha"}
            className="text-white/70 transition hover:text-white"
          >
            {senhaVisivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {erro && (
          <div
            role="alert"
            className={`mb-4 rounded-md px-3 py-2 text-xs ${
              erro.inativo
                ? "border border-amber-400/30 bg-amber-400/10 text-amber-200"
                : "border border-red-400/30 bg-red-400/10 text-red-200"
            }`}
          >
            {erro.texto}
          </div>
        )}

        <button
          type="submit"
          disabled={entrando || !login.trim() || !senha}
          className="group flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{
            background:
              "linear-gradient(135deg, var(--auth-deep) 0%, var(--auth-glow) 100%)",
          }}
        >
          {entrando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Entrando…
            </>
          ) : (
            <>
              Entrar
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        {/* O símbolo da Larsil no lugar do escudo genérico que estava aqui.

            A frase fala dos "outros sistemas da empresa", e a marca ao lado é
            justamente o que responde qual empresa — vira informação, onde o
            escudo era só enfeite de segurança.

            Só o símbolo, sem o escrito: nesta altura a palavra "FLORESTAL"
            teria menos de dois pixels e viraria sujeira. O `bolabranca.png` é
            quadrado (650x644) e já vem em branco puro, então cai certo num
            slot de ícone sem precisar de recorte nem filtro. */}
        <p className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] text-white/50">
          <img src={larsilSimbolo} alt="" aria-hidden className="h-4 w-4 opacity-80" />
          Mesmo usuário e senha dos outros sistemas da empresa.
        </p>
      </form>

      {primeiroAcesso && (
        <FirstAccessModal
          nome={primeiroAcesso.usuario.nome}
          emailInicial={primeiroAcesso.usuario.email}
          onConcluido={() => entrar(primeiroAcesso.usuario, false, primeiroAcesso.perfil)}
        />
      )}
    </>
  );
}

/* --------------------- Login antigo (enquanto IAM_ENABLED=0) --------------------- */

function FormDemo() {
  const { users, login } = useFluxo();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(users[0]?.id ?? "u1");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      login(selected);
      navigate({ to: "/" });
    }, 400);
  };

  const user = users.find((u) => u.id === selected) ?? users[0]!;

  return (
    <form
      onSubmit={submit}
      className="relative rounded-2xl border border-white/10 bg-[color-mix(in_oklab,var(--auth-base)_88%,white)]/90 p-8 backdrop-blur-xl"
    >
      <Cabecalho subtitulo="Workspace Larsil" />

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/60">
        Perfil de acesso
      </label>
      <div className="mb-4 max-h-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-1">
        {users.map((u) => {
          const active = selected === u.id;
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => setSelected(u.id)}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition ${
                active ? "bg-white/10 ring-1 ring-white/20" : "hover:bg-white/[0.04]"
              }`}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold"
                style={{
                  background:
                    "linear-gradient(135deg, var(--auth-deep) 0%, var(--auth-glow) 100%)",
                }}
              >
                {u.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate">{u.name}</div>
                <div className="truncate text-[10px] text-white/50">
                  {roleLabels[u.role]} · {u.jobTitle}
                </div>
              </div>
              {active && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "var(--auth-glow)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/60">
        Senha
      </label>
      <input
        type="password"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        placeholder="••••••••"
        className="mb-4 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2.5 text-sm placeholder:text-white/30 focus:border-white/30 focus:outline-none"
      />

      <button
        type="submit"
        disabled={loading}
        className="group flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-white transition disabled:opacity-70"
        style={{
          background: "linear-gradient(135deg, var(--auth-deep) 0%, var(--auth-glow) 100%)",
        }}
      >
        {loading ? "Autenticando…" : `Entrar como ${user.name.split(" ")[0]}`}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </button>

      <p className="mt-4 text-center text-[11px] text-white/50">
        Modo demonstração — qualquer senha é aceita.
      </p>
    </form>
  );
}

/* --------------------------------- Compartilhado --------------------------------- */

/**
 * Primeiro nome para a saudação. Prefere o nome real, se já conhecido de um
 * login anterior nesta máquina; senão deduz do que foi digitado.
 */
function primeiroNomeDoLogin(login: string): string {
  const base = nomeConhecido(login) ?? login;
  const bruto = base.trim().split(/[._\s-]+/)[0] ?? "";
  if (!bruto) return "";
  return bruto.charAt(0).toUpperCase() + bruto.slice(1).toLowerCase();
}

/**
 * Busca a foto da pessoa a partir do que ela digitou no usuário.
 *
 * A chave não é o login cru: é o nome completo, quando já conhecido de um login
 * anterior nesta máquina (ver `nome-cache`). A IAM guarda a foto por nome, e
 * quem tem registro duplicado só recebe a foto atual pelo nome completo.
 *
 * Passa pelo nosso proxy, que devolve a miniatura de 192px em vez da foto crua
 * de 1,6 MB. 404 aqui é caso normal — quem não tem foto cai nas iniciais.
 */
function useFotoDoLogin(login: string) {
  const [candidato, setCandidato] = useState<string | null>(null);

  useEffect(() => {
    // Espera a pessoa parar de digitar; abaixo de 3 letras não vale a consulta.
    const t = window.setTimeout(() => {
      const chave = chaveDaFoto(login);
      setCandidato(chave ? `/api/public/foto/${encodeURIComponent(chave)}` : null);
    }, 250);
    return () => window.clearTimeout(t);
  }, [login]);

  return candidato;
}

function Cabecalho({ subtitulo, login = "" }: { subtitulo: string; login?: string }) {
  const candidato = useFotoDoLogin(login);
  const [fotoOk, setFotoOk] = useState<string | null>(null);
  const jaComemorou = useRef<string | null>(null);

  // Some a foto assim que o candidato muda: nunca mostrar o rosto de A
  // enquanto já se digita o usuário de B.
  useEffect(() => {
    setFotoOk(null);
  }, [candidato]);

  const nome = fotoOk ? primeiroNomeDoLogin(login) : "";

  return (
    <div className="mb-6 flex items-center gap-3">
      {/* Sonda invisível: carrega a imagem para saber se a pessoa existe. */}
      {candidato && (
        <img
          src={candidato}
          alt=""
          aria-hidden
          className="hidden"
          onLoad={() => setFotoOk(candidato)}
          onError={() => setFotoOk(null)}
        />
      )}

      {fotoOk ? (
        <img
          src={fotoOk}
          alt={`Foto de ${nome}`}
          className="fluxo-avatar-pop h-16 w-16 shrink-0 rounded-xl object-cover ring-2 ring-white/25 shadow-lg"
          onAnimationEnd={(e) => {
            if (jaComemorou.current === fotoOk) return;
            jaComemorou.current = fotoOk;
            const r = e.currentTarget.getBoundingClientRect();
            void import("@/components/celebration").then((m) =>
              m.celebrateAt(r.left + r.width / 2, r.top + r.height / 2),
            );
          }}
        />
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold transition-all"
          style={{
            background:
              "linear-gradient(135deg, var(--auth-deep) 0%, var(--auth-glow) 100%)",
          }}
        >
          F
        </div>
      )}

      <div className="min-w-0">
        <div className="truncate text-lg font-semibold">
          {nome ? `Olá, ${nome}` : "Entrar no Fluxo"}
        </div>
        <div className="truncate text-xs text-white/60">{subtitulo}</div>
      </div>

      <SeletorPaleta />
    </div>
  );
}

/**
 * Escolha de paleta na própria tela de entrada.
 *
 * Vale a pena aqui, e não só em Configurações, porque o login inteiro é feito
 * das cores da paleta: `--auth-base`, `--auth-glow` e `--auth-deep` derivam de
 * `--sidebar` e `--sidebar-primary`, que as oito paletas redefinem. Ou seja, o
 * fundo, as auroras, a borda acesa do card e o gradiente do CONECTA trocam ao
 * vivo — cada bolinha é uma pré-visualização da tela inteira, não uma amostra
 * de cor solta.
 */
function SeletorPaleta() {
  const { palette, setPalette } = usePalette();

  /* Abrir é estado do React, não `:hover` do CSS, por dois motivos.
     Primeiro, o `aria-expanded` precisa dizer a verdade — com a abertura só no
     CSS ele mentiria para quem usa leitor de tela. Segundo, `:hover` não existe
     em toque: aqui o foco abre junto (onFocus/onBlur do React sobem dos filhos,
     porque por baixo são focusin/focusout), então tocar no botão também abre. */

  /* Dois estados, e não um, porque "o ponteiro está em cima" e "quero que
     continue aberto" são coisas diferentes.

     Com um só, escolher uma paleta fechava a fila na cara da pessoa: a troca
     passa por `startViewTransition`, que cobre a tela com a foto do antes
     enquanto anima. Durante esses milissegundos o ponteiro deixa de acertar a
     cápsula, o navegador dispara `mouseleave`, e a fila fechava — justo quando
     a pessoa quer testar a próxima cor e comparar.

     Agora escolher uma paleta trava a fila aberta. Ela só fecha por vontade
     explícita: clique fora, Esc, ou o próprio botão da paleta de novo. */
  const [sobre, setSobre] = useState(false);
  const [fixado, setFixado] = useState(false);
  const aberto = sobre || fixado;

  const caixa = useRef<HTMLDivElement>(null);

  /* Só existe enquanto está travado — fechado ou aberto por hover, não há nada
     para desfazer, e ouvir o documento à toa tem custo. */
  useEffect(() => {
    if (!fixado) return;

    const cliqueFora = (e: PointerEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setFixado(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setFixado(false);
      // Também zera o hover: sem isto, quem apertou Esc com o ponteiro parado
      // em cima veria a fila continuar aberta e acharia que a tecla falhou.
      setSobre(false);
    };

    document.addEventListener("pointerdown", cliqueFora);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", cliqueFora);
      document.removeEventListener("keydown", escape);
    };
  }, [fixado]);

  return (
    <div
      /* `ml-auto` empurra para o canto direito do cabeçalho, e o `items-center`
         da linha alinha com o texto sozinho — sem posição absoluta e sem
         número nenhum para acertar na mão. */
      ref={caixa}
      className="ml-auto flex shrink-0 items-center rounded-full border border-white/10 bg-white/4 p-1 transition-colors duration-200 hover:border-white/20 hover:bg-white/8"
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      onFocus={() => setSobre(true)}
      /* Só fecha quando o foco sai do conjunto inteiro; pular de uma bolinha
         para a vizinha passa por aqui e fecharia a lista no meio do caminho. */
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(false);
      }}
    >
      {/* De 0fr para 1fr, em COLUNA: a fila abre até a largura que ela mesma
          tem, sem ninguém precisar saber quanto isso dá em pixel. Um
          `max-width` chutado ou passaria do tamanho (e a animação terminaria
          antes do fim, com um tranco) ou ficaria curto e cortaria a última
          bolinha — e quebraria de novo no dia em que a nona paleta entrar.

          Abre para a ESQUERDA porque o botão está encostado na quina direita
          do card: para baixo ele cobriria o campo de usuário, e para a direita
          não há para onde ir. */}
      <div
        className={`grid transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none ${
          aberto ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {/* O `p-1.5` NÃO é respiro estético, é o que impede o recorte.

              O `overflow-hidden` do pai é o que faz a animação de largura
              funcionar, e ele corta em cima, embaixo e nos lados tudo o que
              passa da borda. Duas coisas passam: o anel da paleta ativa, que
              vai 3.5px para fora da bolinha, e o `scale` do hover.

              A conta da folga necessária é o anel JÁ ESCALADO, porque
              `transform` amplia a sombra junto com o elemento:
              1.10 × (8 + 3.5) − 8 = 4.65px. Os 6px daqui cobrem com sobra.

              Como o recorte é no pai, a folga tem que estar aqui dentro: um
              padding no pai empurraria a borda de corte junto e não resolveria
              nada. */}
          <ul
            className={`flex items-center gap-1.5 p-1.5 transition-opacity duration-200 motion-reduce:transition-none ${
              aberto ? "opacity-100" : "opacity-0"
            }`}
          >
            {paletteOptions.map((p) => {
              const ativa = p.id === palette;
              return (
                <li key={p.id} className="flex">
                  <button
                    type="button"
                    onClick={() => {
                      setPalette(p.id);
                      // Trava aberta: quem trocou de cor quase sempre quer ver
                      // a próxima e comparar.
                      setFixado(true);
                    }}
                    /* `tabIndex={-1}` quando fechado: sem isto o Tab entraria
                       numa fila invisível de oito botões e o foco sumiria da
                       tela. */
                    tabIndex={aberto ? 0 : -1}
                    aria-label={p.name}
                    aria-pressed={ativa}
                    title={p.name}
                    className="block h-4 w-4 rounded-full transition duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    style={{
                      /* O tom profundo e o vivo da mesma paleta, na diagonal:
                         uma bolinha de cor só não distingue Forest de Lagoon,
                         que têm claridade parecida e se separam justamente
                         pelo contraste interno. */
                      backgroundImage: `linear-gradient(135deg, ${p.swatch[1]} 0%, ${p.swatch[2]} 100%)`,
                      /* Anel da ativa escrito à mão em vez de `ring-offset`:
                         a folga do Tailwind é pintada na cor de offset, que por
                         padrão é branca — ela engordaria o anel em vez de abrir
                         o vão. A folga aqui sai na cor do CARD (que é o
                         --auth-base clareado em 12%, não o --auth-base puro do
                         fundo da página), então ela lê como um recorte. */
                      boxShadow: ativa
                        ? "0 0 0 2px color-mix(in oklab, var(--auth-base) 88%, white), 0 0 0 3.5px rgba(255,255,255,0.9)"
                        : undefined,
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <button
        type="button"
        /* Destravar zera o hover junto, senão o clique para fechar não teria
           efeito nenhum enquanto o ponteiro ainda estivesse sobre o botão —
           que é exatamente onde ele está no instante do clique. */
        onClick={() => {
          if (fixado) {
            setFixado(false);
            setSobre(false);
          } else {
            setFixado(true);
          }
        }}
        aria-expanded={aberto}
        title="Trocar a paleta de cores"
        aria-label="Trocar a paleta de cores"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <PaletteIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--auth-deep) 0%, transparent 65%)" }}
      />
      <div
        className="absolute -bottom-40 -right-32 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--auth-glow) 0%, transparent 65%)" }}
      />
      <div
        className="absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--auth-glow) 60%, var(--auth-base)) 0%, transparent 60%)" }}
      />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

function Marca() {
  return (
    <div className="space-y-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs backdrop-blur">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Task OS · v2.0</span>
      </div>
      <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
        SGL -{" "}
        {/* A logo é o "O" de CONECTA. Ela volta a ser LETRA, não ornamento:
            redonda, no lugar de uma letra redonda — o mesmo trabalho que fazia
            no título antigo, agora dentro da palavra.

            `alt="O"` não é preguiça: para quem usa leitor de tela a imagem
            precisa valer o que ela substitui, e aqui ela substitui uma letra.
            Assim o título continua sendo lido como "SGL - CONECTA".

            As medidas em `em` e não em pixel: a logo acompanha sozinha o salto
            de text-5xl para text-6xl e qualquer mudança futura de corpo.

            Os números saem da própria fonte, lidos da tabela OS/2 do arquivo
            woff2 da Sora: unitsPerEm 1000, altura de caixa alta 730 — ou seja,
            0.730em exatos. Vale igual aqui: CONECTA é tudo em caixa alta, e a
            imagem tem os dois "C" ao lado como referência de altura.

            A logo fica um fio acima disso, em 0.76em. Letra redonda precisa
            passar da linha das letras retas para PARECER do mesmo tamanho: é o
            "overshoot" que todo desenhista de tipo aplica no O, no C e no G.
            Cortada na altura exata da caixa alta, ela pareceria menor que os
            "C" vizinhos. Os 4% aqui são um pouco mais que os 1 a 3% de um "O"
            de texto, e de propósito — o desenho da marca tem vazados internos,
            o que a faz pesar menos que um glifo maciço do mesmo tamanho.

            O -0.015em de alinhamento é metade da sobra: assim ela se reparte
            entre acima da caixa alta e abaixo da linha de base, como no desenho
            de um "O" de verdade. Sem isso a imagem sentaria com a base na linha
            e toda a sobra iria para cima.

            A margem de 0.056em existe porque uma LETRA carrega folga embutida e
            uma IMAGEM não. Todo glifo reserva um vão de cada lado (o
            "sidebearing") — é ele que impede as letras de se encostarem. O
            bolabranca.png não tem nada disso: a marca sangra nas quatro bordas
            do arquivo (medido: 650x644, caixa pintada 650x644, zero de folga),
            então ela colava no "C" anterior.

            O valor sai da própria Sora, lido do hmtx do woff2: o "O" tem
            advance 865 e lsb 56 em unitsPerEm 1000 — 0.056em de folga de cada
            lado. De quebra a conta fecha: 865 − 56 − 56 = 753, ou seja, a
            largura PINTADA do "O" é 0.753em, praticamente os 0.76em da imagem.
            O tamanho já estava certo; faltava só o vão.

            Simétrico de propósito. A sensação de que o lado esquerdo é mais
            apertado vem do desenho da fonte, não daqui: o "N" que vem depois
            tem lsb de 106 (0.106em), quase o dobro do "O", enquanto o "C" que
            vem antes fecha com bem menos. Um "O" de verdade ali sofreria a
            mesma diferença — é o espacejamento que o desenhista quis para
            "CON".

            Ela fica DENTRO do span do gradiente de propósito: `bg-clip-text`
            recorta o fundo do próprio span e não toca em elementos filhos, então
            o degradê continua atravessando o "C" e o "NECTA" como se a palavra
            fosse inteira, e a marca passa branca e acesa por cima dele. */}
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: "linear-gradient(90deg, var(--auth-deep), var(--auth-glow))",
          }}
        >
          C
          <img
            src={larsilSimbolo}
            alt="O"
            className="inline-block"
            style={{
              height: "0.76em",
              width: "0.76em",
              verticalAlign: "-0.015em",
              margin: "0 0.056em",
              filter:
                "drop-shadow(0 0 10px color-mix(in oklab, var(--auth-glow) 55%, transparent)) drop-shadow(0 0 26px color-mix(in oklab, var(--auth-glow) 28%, transparent))",
            }}
          />
          NECTA
        </span>
      </h1>
      <p className="max-w-lg text-sm leading-relaxed text-white/70">
        O ambiente completo da Larsil para organizar tarefas, conectar equipes e transformar
        trabalho em resultado.
      </p>
      <ul className="grid max-w-md grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: Zap, label: "Rápido" },
          { icon: ShieldCheck, label: "Seguro" },
          { icon: Users, label: "Colaborativo" },
        ].map((f) => (
          <li
            key={f.label}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs backdrop-blur"
          >
            <f.icon className="h-3.5 w-3.5 text-white/80" />
            {f.label}
          </li>
        ))}
      </ul>

      {/* Assinatura da empresa.

          Fica por último, e isso é a decisão principal: esta tela vende o
          Fluxo — o título é o herói. A Larsil é quem assina, não quem se
          anuncia. Na ordem de leitura, o último lugar é exatamente o peso
          que uma assinatura tem.

          Também é de propósito que não esteja dentro do cartão de login.
          Logo de empresa colada em campo de senha é a composição que todo
          phishing imita; manter a marca longe da área de credencial é hábito
          barato e que não custa nada aqui.

          Texto e não marca: o símbolo já aparece duas vezes nesta tela, sobre
          o título e no rodapé do cartão. Uma terceira imagem da mesma coisa
          viraria repetição; a linha de direitos faz um trabalho que nenhuma
          delas fazia.

          O ano sai do relógio em vez de estar escrito. Rodapé com ano fixo
          envelhece no dia 1º de janeiro, e ninguém lembra de voltar aqui. */}
      <p className="pt-2 text-[11px] text-white/40">
        © {new Date().getFullYear()} Larsil · Todos os direitos reservados
      </p>
    </div>
  );
}
