import { useState } from "react";
import { Phone, Mail, Sparkles } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";

function normalizePhone(v: string) {
  return v.replace(/[^\d+]/g, "");
}
function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidPhone(v: string) {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function OnboardingModal() {
  const { currentUser, updateCurrentUser } = useFluxo();
  const [email, setEmail] = useState(currentUser.email ?? "");
  const [phone, setPhone] = useState(currentUser.phone ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (!isValidEmail(email)) return setErr("Informe um email válido.");
    if (!isValidPhone(phone)) return setErr("Informe um telefone válido (com DDD).");
    updateCurrentUser({
      email: email.trim(),
      phone: normalizePhone(phone),
      contactCompleted: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div
          className="relative px-6 pt-6 pb-4 text-white"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.52 0.22 275) 0%, oklch(0.6 0.2 330) 100%)",
          }}
        >
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            <Sparkles className="h-3 w-3" /> Bem-vindo(a) ao Fluxo
          </div>
          <h2 className="text-xl font-semibold">Complete seu contato</h2>
          <p className="mt-1 text-sm text-white/85">
            Precisamos do seu email e WhatsApp para enviar notificações da equipe.
            Este passo é obrigatório para usar o painel.
          </p>
        </div>

        <div className="space-y-3 p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              WhatsApp / Telefone
            </label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+55 11 99999-0000"
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Usaremos para integrar as notificações via WhatsApp.
            </p>
          </div>
          {err && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {err}
            </div>
          )}
          <button
            onClick={submit}
            className="mt-2 w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            Salvar e continuar
          </button>
        </div>
      </div>
    </div>
  );
}