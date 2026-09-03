import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { iamOnboarding } from "@/integrations/iam/auth.functions";
import { phoneValidator } from "@/components/onboarding-modal";
import { mascararTelefone } from "@/lib/telefone";
import { TravaScroll } from "@/components/trava-scroll";
import { MIN_SENHA, avaliarSenha, erroSenha } from "@/lib/politica-senha";

/**
 * Primeiro acesso (§4 do contrato da IAM): a senha provisória vira definitiva e,
 * de quebra, é onde recolhemos o telefone que faz o WhatsApp funcionar.
 *
 * Os textos espelham de propósito a tela de primeiro acesso da própria IAM:
 * quem chega aqui acabou de passar por lá, e reconhecer o mesmo formulário
 * poupa a dúvida de estar cadastrando outra senha, num outro lugar. Mesma
 * decisão que o Agendador tomou.
 */


/**
 * Lista de requisitos que abre enquanto o campo de senha está em foco.
 *
 * Fica escondida no resto do tempo de propósito: cumprida a regra, ela só
 * ocuparia espaço no formulário. A altura é animada para o painel não empurrar
 * os campos de baixo num salto ao abrir.
 */
function RequisitosSenha({ senha }: { senha: string }) {
  const requisitos = avaliarSenha(senha);
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { type: "spring", stiffness: 400, damping: 38, mass: 0.7 },
        opacity: { duration: 0.15 },
      }}
      className="overflow-hidden"
    >
      <ul className="mt-1.5 space-y-1 rounded-md border border-border bg-secondary/40 px-3 py-2">
        {requisitos.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-1.5 text-[11px] transition-colors ${
              r.ok ? "text-success" : "text-muted-foreground"
            }`}
          >
            {r.ok ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Circle className="h-3 w-3 shrink-0 opacity-50" />
            )}
            {r.rotulo}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function CampoSenha({
  id,
  label,
  valor,
  onChange,
  placeholder,
  autoFocus,
  onFocusDentro,
  onSairDoCampo,
}: {
  id: string;
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  onFocusDentro?: () => void;
  /** Só dispara quando o foco sai do grupo — o olho de mostrar senha não conta. */
  onSairDoCampo?: () => void;
}) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div
        onFocus={onFocusDentro}
        onBlur={(e) => {
          // O botão do olho vive dentro deste mesmo grupo: sem checar o
          // relatedTarget, clicar nele recolheria o painel.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onSairDoCampo?.();
        }}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring"
      >
        <input
          id={id}
          type={visivel ? "text" : "password"}
          value={valor}
          autoFocus={autoFocus}
          maxLength={100}
          autoComplete="new-password"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          className="text-muted-foreground transition hover:text-foreground"
        >
          {visivel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function FirstAccessModal({
  nome,
  emailInicial,
  onConcluido,
}: {
  nome: string;
  emailInicial?: string | null;
  onConcluido: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState(emailInicial ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [senhaFocada, setSenhaFocada] = useState(false);

  const senhasDivergem = senha2.length > 0 && senha !== senha2;
  const senhasConferem = senha2.length > 0 && senha === senha2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    const problemaSenha = erroSenha(senha);
    if (problemaSenha) {
      // Reabre a lista: o erro diz o que falta, e ali embaixo mostra qual item.
      setSenhaFocada(true);
      return setErro(problemaSenha);
    }
    if (senha !== senha2) return setErro("As senhas não conferem.");
    const fone = telefone.replace(/\D/g, "");
    if (!phoneValidator.isValidPhone(fone)) {
      return setErro("Informe um telefone real com DDD. Números repetidos não são aceitos.");
    }
    if (email.trim() && !phoneValidator.isValidEmail(email.trim())) {
      return setErro("O e-mail informado não parece válido.");
    }

    setSalvando(true);
    try {
      const r = await iamOnboarding({
        data: { novaSenha: senha, telefone: fone, email: email.trim() },
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      onConcluido();
    } catch (err) {
      setErro((err as Error)?.message ?? "Não foi possível concluir o primeiro acesso.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur">
      <TravaScroll />
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Cores em .fluxo-cabecalho-primario (styles.css): o degradê é
            derivado da paleta em uso, não mais verde cravado aqui. */}
        <div className="fluxo-cabecalho-primario px-6 pt-6 pb-4">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            <ShieldCheck className="h-3 w-3" /> Primeiro acesso
          </div>
          <h2 className="text-xl font-semibold">Olá, {nome.split(" ")[0]}</h2>
          <p className="mt-1 text-sm opacity-85">
            Para sua segurança, defina uma nova senha. Confirme também seus dados de contato
            empresarial — ajuda a TI a manter tudo atualizado.
          </p>
        </div>

        <form onSubmit={submit} noValidate className="space-y-3 p-6">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Lembre dessa senha: ela será usada em <strong>outros sistemas</strong> da empresa.
            </span>
          </div>

          <div>
            <CampoSenha
              id="fa-senha"
              label="Nova senha *"
              valor={senha}
              onChange={setSenha}
              placeholder={`mínimo ${MIN_SENHA} caracteres`}
              autoFocus
              onFocusDentro={() => setSenhaFocada(true)}
              onSairDoCampo={() => setSenhaFocada(false)}
            />
            <AnimatePresence initial={false}>
              {senhaFocada && <RequisitosSenha senha={senha} />}
            </AnimatePresence>
          </div>
          <div>
            <CampoSenha
              id="fa-senha2"
              label="Confirmar senha *"
              valor={senha2}
              onChange={setSenha2}
              placeholder="repita a senha"
            />
            {senhasDivergem && (
              <p role="alert" className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                <Circle className="h-3 w-3 shrink-0" /> As senhas não coincidem
              </p>
            )}
            {/* Antes só existia o aviso de erro: quem acertava ficava sem
                confirmação nenhuma de que tinha acertado. */}
            {senhasConferem && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
                <Check className="h-3 w-3 shrink-0" /> As senhas coincidem
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="fa-fone"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Telefone empresarial *
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <input
                id="fa-fone"
                type="tel"
                value={telefone}
                autoComplete="tel"
                onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                placeholder="(00) 00000-0000"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Usado para as notificações via WhatsApp.
            </p>
          </div>

          <div>
            <label
              htmlFor="fa-email"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              E-mail empresarial <span className="text-muted-foreground/70">(opcional)</span>
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                id="fa-email"
                type="email"
                value={email}
                autoComplete="email"
                maxLength={120}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome.sobrenome@larsil.com.br"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </div>

          {erro && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={salvando}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-70"
          >
            {salvando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Concluir e entrar
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
