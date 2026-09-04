import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  Laptop,
  Loader2,
  LogOut,
  Mail,
  Moon,
  Palette,
  Phone,
  PowerOff,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
  User as UserIcon,
  Users,
} from "lucide-react";
import { FluxoLayout } from "@/components/fluxo-layout";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels, sectors } from "@/lib/fluxo-types";
import { useTheme, usePalette, paletteOptions } from "@/lib/use-theme";
import { phoneValidator } from "@/components/onboarding-modal";
import { purgeAllRooms } from "@/lib/livekit-token.functions";
import {
  desktopBringToFront,
  desktopSelfTest,
  isTauri,
  showIncomingCallWindow,
} from "@/lib/desktop";
import { triggerTractor } from "@/components/tractor-banner";
import { UserAvatar } from "@/components/user-avatar";
import { formatarTelefone, mascararTelefone, telefoneParaGuardar } from "@/lib/telefone";
import { transicionar } from "@/components/transition-veil";
import { confirmar } from "@/components/confirm-dialog";
import { useAcaoPendente } from "@/lib/use-acao-pendente";
import { toast } from "sonner";
import { motion } from "framer-motion";

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
  const { theme, setTheme } = useTheme();
  const { palette, setPalette } = usePalette();
  const navigate = useNavigate();
  // Fechar salas fala com o LiveKit nos EUA: sem estado de pendência o botão
  // fica parado por segundos e aceita clique repetido.
  const { pendente: fechandoSalas, executar: fecharSalas } = useAcaoPendente();

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
      // Guarda com DDI: é o formato que o WhatsApp precisa e o que a empresa usa.
      phone: trimmedPhone ? telefoneParaGuardar(trimmedPhone) : "",
      jobTitle: jobTitle.trim(),
      sector,
      contactCompleted: !!(trimmedEmail && trimmedPhone),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const doLogout = () =>
    void transicionar(
      { tipo: "saida", nome: currentUser.name, iniciais: currentUser.avatar },
      () => {
        logout();
        navigate({ to: "/login" });
      },
    );

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
                className={`relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                {/* Mesmo truque do menu lateral: um fundo só, que desliza. */}
                {active && (
                  <motion.span
                    layoutId="config-aba-ativa"
                    className="absolute inset-0 rounded-md bg-secondary"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <t.icon className="relative h-4 w-4" />
                <span className="relative">{t.label}</span>
              </button>
            );
          })}
        </aside>

        {/* A chave é a aba: trocar remonta e reexecuta a entrada, dando a
            sensação de conteúdo novo chegando em vez de troca seca. */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0 space-y-6"
        >
          {tab === "perfil" && (
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-3">
                <UserAvatar
                  nome={currentUser.name}
                  iniciais={currentUser.avatar}
                  className="h-12 w-12 text-sm"
                />
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
                      value={mascararTelefone(phone)}
                      maxLength={15}
                      onChange={(e) => setPhone(mascararTelefone(e.target.value))}
                      className="flex-1 bg-transparent text-sm focus:outline-none"
                      placeholder="(00) 00000-0000"
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
                      // `setTheme(t)` diz o alvo em vez de pedir uma inversão.
                      // Com `toggle()` o botão dependia de `theme` estar atual
                      // para acertar o destino; aqui "Claro" significa claro,
                      // independente do que o componente pensa que está valendo.
                      onClick={() => setTheme(t)}
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
              <div className="mt-6 border-t border-border pt-6">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Palette className="h-4 w-4" /> Paleta de cores
                </h3>
                <p className="mb-4 text-[11px] text-muted-foreground">
                  Escolha a identidade visual do seu Fluxo. Vale para claro e escuro, e é salva neste dispositivo.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {paletteOptions.map((p) => {
                    const active = palette === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPalette(p.id)}
                        className={`flex items-center gap-3 rounded-lg border p-4 text-left text-sm transition ${
                          active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border">
                          {p.swatch.map((c, i) => (
                            <div key={i} className="flex-1" style={{ background: c }} />
                          ))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            {active && (
                              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                                Ativa
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{p.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 border-t border-border pt-6">
                <TractorControl />
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
                  { key: "whatsapp" as const, label: "WhatsApp", desc: formatarTelefone(currentUser.phone) || "Preencha o telefone no perfil." },
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

              <AcessosEDispositivos />

              <DesktopDiagnostics />

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
                    disabled={fechandoSalas}
                    onClick={() =>
                      fecharSalas(async () => {
                        const ok = await confirmar({
                          titulo: "Fechar todas as salas?",
                          descricao:
                            "Todo mundo que estiver em chamada agora será desconectado na hora, sem aviso prévio. Não dá para desfazer.",
                          confirmar: "Fechar todas",
                          perigo: true,
                        });
                        if (!ok) return;
                        try {
                          const r = await purgeAllRooms();
                          const n = r.deleted.length;
                          toast.success(
                            n === 0
                              ? "Nenhuma sala estava aberta"
                              : `${n} sala${n > 1 ? "s" : ""} fechada${n > 1 ? "s" : ""}`,
                          );
                        } catch {
                          toast.error("Não foi possível fechar as salas", {
                            description: "Verifique a conexão e tente de novo.",
                          });
                        }
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {fechandoSalas ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PowerOff className="h-3.5 w-3.5" />
                    )}
                    {fechandoSalas ? "Fechando…" : "Fechar todas as salas"}
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirmar({
                        titulo: "Redefinir dados locais?",
                        descricao:
                          "Apaga tema, paleta, preferências e rascunhos guardados neste computador. Suas tarefas no servidor não são afetadas. A página recarrega em seguida.",
                        confirmar: "Apagar e recarregar",
                        perigo: true,
                      });
                      if (!ok) return;
                      localStorage.clear();
                      location.reload();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Redefinir dados locais
                  </button>
                </div>
              </div>
            </section>
          )}
        </motion.div>
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
/**
 * Diagnóstico do app desktop — permite testar as sobreposições nativas
 * numa máquina só, sem precisar de duas pontas.
 */
/**
 * Onde a pessoa vê o próprio histórico de entrada.
 *
 * As duas tabelas por trás disto passaram meses sendo criadas e nunca
 * escritas. Agora todo login grava — e esta seção existe para que o registro
 * não fique só acumulando sem ninguém nunca poder olhar. É leitura da própria
 * pessoa: ver os próprios acessos não é gerência, e a consulta no servidor
 * nem aceita pedir os de outra.
 */
function AcessosEDispositivos() {
  const [acessos, setAcessos] = useState<
    { em: string; ip: string | null; sucesso: boolean; motivo: string | null }[]
  >([]);
  const [dispositivos, setDispositivos] = useState<
    {
      id: string;
      apelido: string | null;
      primeiroAcesso: string;
      ultimoAcesso: string;
      esteAparelho: boolean;
    }[]
  >([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const api = await import("@/lib/acesso.functions");
      const [a, d] = await Promise.all([api.meusAcessos(), api.meusDispositivos()]);
      setAcessos(a.acessos);
      setDispositivos(d.dispositivos);
      setErro(false);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvarApelido = async () => {
    if (!editando) return;
    const { id, texto } = editando;
    setEditando(null);
    try {
      const { renomearDispositivo } = await import("@/lib/acesso.functions");
      await renomearDispositivo({ data: { id, apelido: texto } });
      setDispositivos((ds) => ds.map((d) => (d.id === id ? { ...d, apelido: texto || null } : d)));
    } catch {
      toast.error("Não foi possível renomear");
    }
  };

  const quando = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" /> Acessos e dispositivos
      </h3>
      <p className="mb-4 text-[11px] text-muted-foreground">
        Quando e de onde sua conta entrou no Fluxo. Se aparecer algo que não foi você, troque a
        senha e avise a TI.
      </p>

      {carregando && <p className="text-xs text-muted-foreground">Carregando…</p>}
      {erro && !carregando && (
        <p className="text-xs text-muted-foreground">Não foi possível carregar agora.</p>
      )}

      {!carregando && !erro && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Dispositivos
            </div>
            {dispositivos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum registrado ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {dispositivos.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
                  >
                    <Laptop className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {editando?.id === d.id ? (
                      <>
                        <input
                          autoFocus
                          value={editando.texto}
                          onChange={(e) => setEditando({ id: d.id, texto: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void salvarApelido();
                            if (e.key === "Escape") setEditando(null);
                          }}
                          placeholder="Notebook do escritório"
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 outline-none focus:border-primary"
                        />
                        <button
                          onClick={() => void salvarApelido()}
                          className="rounded p-1 text-primary hover:bg-secondary"
                          title="Salvar nome"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditando({ id: d.id, texto: d.apelido ?? "" })}
                          className="min-w-0 truncate text-left font-medium hover:text-primary"
                          title="Clique para dar um nome"
                        >
                          {d.apelido ?? "Dispositivo sem nome"}
                        </button>
                        {d.esteAparelho && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            este aparelho
                          </span>
                        )}
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          último acesso {quando(d.ultimoAcesso)}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Últimas entradas
            </div>
            {acessos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nada registrado ainda.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {acessos.map((a, i) => (
                  <li
                    key={`${a.em}-${i}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.sucesso ? "bg-emerald-500" : "bg-destructive"
                      }`}
                    />
                    <span className="tabular-nums">{quando(a.em)}</span>
                    <span className="text-muted-foreground">{a.ip ?? "—"}</span>
                    {!a.sucesso && (
                      <span className="text-destructive">
                        falhou{a.motivo ? ` · ${a.motivo}` : ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopDiagnostics() {
  const { currentUser } = useFluxo();
  const [result, setResult] = useState<string>("");
  const nativo = isTauri();
  const { pendente: testando, executar: testar } = useAcaoPendente();

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        Diagnóstico do app desktop
      </h3>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Testa as sobreposições nativas sem precisar de outra pessoa ligando.
      </p>

      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Modo nativo:</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            nativo ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
          }`}
        >
          {nativo ? "Ativo" : "Inativo (rodando como página web)"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={testando}
          onClick={() => testar(async () => setResult(await desktopSelfTest()))}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {testando && <Loader2 className="h-3 w-3 animate-spin" />}
          {testando ? "Testando…" : "Testar notificação e piscar"}
        </button>
        <button
          onClick={() =>
            void showIncomingCallWindow({
              callId: "teste",
              caller: "Chamada de teste",
              roomLabel: "Sala de teste",
              userId: currentUser.id,
              remote: false,
            })
          }
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Testar card de chamada
        </button>
        <button
          onClick={() => {
            setResult("Minimizando… a janela deve voltar sozinha em 4s.");
            void (async () => {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().minimize();
              setTimeout(() => void desktopBringToFront(), 4000);
            })();
          }}
          disabled={!nativo}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-40"
        >
          Testar trazer pra frente
        </button>
      </div>

      {result && (
        <p className="mt-3 rounded-md bg-secondary/60 p-2 text-[11px] text-foreground">{result}</p>
      )}
    </div>
  );
}

/** Aciona o trator da Larsil puxando a faixa (o timer automático vem depois). */
function TractorControl() {
  const [message, setMessage] = useState("Hora da pausa — beba água! 💧");
  const [dur, setDur] = useState(16);
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">🚜 Trator da Larsil</h3>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Um trator atravessa a tela puxando uma faixa com a sua mensagem. Depois a gente
        configura de quanto em quanto tempo ele passa sozinho.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Mensagem da faixa</span>
          <input
            className="input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ex.: Hora da pausa — beba água! 💧"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Duração</span>
          {/* Largura pelo conteúdo, não em número fixo. O `w-28` daqui valia
              112px, e a opção mais longa ("Bem lento (34s)") precisa de ~150
              contando o padding e a seta — por isso até "Normal (16s)" saía
              cortado. `min-w-fit` manda o campo caber na opção mais larga,
              seja ela qual for: se alguém acrescentar uma duração amanhã, ele
              se ajusta sozinho em vez de cortar de novo.

              No celular a linha vira coluna e o `width: 100%` do .input volta
              a mandar, então o campo continua ocupando a largura toda como os
              outros — o min-width só age quando sobra espaço. */}
          <select
            className="input min-w-fit"
            value={dur}
            onChange={(e) => setDur(Number(e.target.value))}
          >
            <option value={10}>Rápido (10s)</option>
            <option value={16}>Normal (16s)</option>
            <option value={24}>Lento (24s)</option>
            <option value={34}>Bem lento (34s)</option>
          </select>
        </label>
        <button
          onClick={() => triggerTractor({ message, durationSec: dur })}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
        >
          Passar o trator agora
        </button>
      </div>
    </div>
  );
}
