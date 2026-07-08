import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bell,
  LogOut,
  Mail,
  Moon,
  Palette,
  Phone,
  Save,
  Sun,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels, sectors } from "@/lib/fluxo-types";
import { useTheme } from "@/lib/use-theme";
import { phoneValidator } from "@/components/onboarding-modal";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações · Fluxo" },
      { name: "description", content: "Ajuste seu perfil, contato, aparência e preferências do painel." },
    ],
  }),
  component: SettingsPage,
});

type Tab = "perfil" | "aparencia" | "notificacoes" | "conta";

function SettingsPage() {
  const { currentUser, updateCurrentUser, logout, users } = useFluxo();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("perfil");
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email ?? "");
  const [phone, setPhone] = useState(currentUser.phone ?? "");
  const [jobTitle, setJobTitle] = useState(currentUser.jobTitle);
  const [sector, setSector] = useState(currentUser.sector);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [notif, setNotif] = useState({
    email: true,
    whatsapp: !!currentUser.phone,
    push: true,
    weeklyDigest: true,
  });

  const savePerfil = () => {
    setErr(null);
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (trimmedEmail && !phoneValidator.isValidEmail(trimmedEmail)) {
      setErr("Informe um email válido.");
      return;
    }
    if (trimmedPhone && !phoneValidator.isValidPhone(trimmedPhone)) {
      setErr("Telefone inválido. Evite números repetidos como 11111111111.");
      return;
    }
    updateCurrentUser({
      name: name.trim(),
      email: trimmedEmail,
      phone: trimmedPhone ? phoneValidator.normalizePhone(trimmedPhone) : "",
      jobTitle: jobTitle.trim(),
      sector,
      contactCompleted: !!(trimmedEmail && trimmedPhone),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const doLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  const tabs: { id: Tab; label: string; icon: typeof UserIcon }[] = [
    { id: "perfil", label: "Perfil e contato", icon: UserIcon },
    { id: "aparencia", label: "Aparência", icon: Palette },
    { id: "notificacoes", label: "Notificações", icon: Bell },
    { id: "conta", label: "Conta", icon: LogOut },
  ];

  return (
    <FluxoLayout title="Configurações" breadcrumb="Preferências">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </aside>

        <div className="min-w-0 space-y-6">
          {tab === "perfil" && (
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {currentUser.avatar}
                </div>
                <div>
                  <div className="text-sm font-semibold">{currentUser.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {roleLabels[currentUser.role]}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Cargo">
                  <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                </Field>
                <Field label="Setor">
                  <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}>
                    {sectors.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Papel">
                  <input className="input" value={roleLabels[currentUser.role]} disabled />
                </Field>
                <Field label="Email de contato">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 bg-transparent text-sm focus:outline-none"
                      placeholder="voce@empresa.com"
                    />
                  </div>
                </Field>
                <Field label="WhatsApp / Telefone">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="flex-1 bg-transparent text-sm focus:outline-none"
                      placeholder="+55 11 99999-0000"
                    />
                  </div>
                </Field>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="text-[11px]">
                  {err ? (
                    <span className="text-destructive">{err}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Email e telefone serão usados para notificações e integração com WhatsApp.
                    </span>
                  )}
                </div>
                <button
                  onClick={savePerfil}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110"
                >
                  <Save className="h-4 w-4" /> {saved ? "Salvo!" : "Salvar alterações"}
                </button>
              </div>
            </section>
          )}

          {tab === "aparencia" && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h3 className="mb-1 text-sm font-semibold">Tema</h3>
              <p className="mb-4 text-[11px] text-muted-foreground">
                Escolha entre modo claro e escuro. A preferência é salva neste dispositivo.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["light", "dark"] as const).map((t) => {
                  const active = theme === t;
                  const Icon = t === "dark" ? Moon : Sun;
                  return (
                    <button
                      key={t}
                      onClick={() => {
                        if (theme !== t) toggle();
                      }}
                      className={`flex items-center gap-3 rounded-lg border p-4 text-left text-sm transition ${
                        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-md ${
                          active ? "bg-primary text-primary-foreground" : "bg-secondary"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium">{t === "dark" ? "Escuro" : "Claro"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t === "dark" ? "Melhor à noite" : "Ideal para o dia"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {tab === "notificacoes" && (
            <section className="rounded-lg border border-border bg-card p-6">
              <h3 className="mb-1 text-sm font-semibold">Canais de notificação</h3>
              <p className="mb-4 text-[11px] text-muted-foreground">
                Onde você quer receber avisos de tarefas atribuídas, prazos e menções.
              </p>
              <ul className="divide-y divide-border">
                {[
                  { key: "push" as const, label: "Notificações no painel", desc: "Alertas em tempo real dentro do Fluxo." },
                  { key: "email" as const, label: "Email", desc: currentUser.email || "Preencha o email no perfil." },
                  { key: "whatsapp" as const, label: "WhatsApp", desc: currentUser.phone || "Preencha o telefone no perfil." },
                  { key: "weeklyDigest" as const, label: "Resumo semanal", desc: "Toda segunda pela manhã." },
                ].map((row) => (
                  <li key={row.key} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium">{row.label}</div>
                      <div className="text-[11px] text-muted-foreground">{row.desc}</div>
                    </div>
                    <button
                      onClick={() => setNotif((n) => ({ ...n, [row.key]: !n[row.key] }))}
                      className={`relative h-5 w-9 rounded-full transition ${
                        notif[row.key] ? "bg-primary" : "bg-secondary"
                      }`}
                      aria-label={row.label}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                          notif[row.key] ? "left-4" : "left-0.5"
                        }`}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "conta" && (
            <section className="space-y-4">
              <div className="rounded-lg border border-border bg-card p-6">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4" /> Equipe
                </h3>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  {users.length} membros ativos no workspace.
                </p>
                <button
                  onClick={() => navigate({ to: "/equipe" })}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
                >
                  Gerenciar equipe
                </button>
              </div>
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
                <h3 className="mb-1 text-sm font-semibold text-destructive">Zona sensível</h3>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Encerre sua sessão neste dispositivo. Você precisará entrar novamente.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={doLogout}
                    className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:brightness-110"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Sair da conta
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Isto vai apagar todos os dados locais deste demo. Continuar?")) {
                        localStorage.clear();
                        location.reload();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Redefinir dados locais
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </FluxoLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}