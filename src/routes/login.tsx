import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Sparkles, ShieldCheck, Zap, Users } from "lucide-react";
import { useFluxo } from "@/lib/fluxo-store";
import { roleLabels } from "@/lib/fluxo-types";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar · Fluxo" },
      { name: "description", content: "Acesse o painel Fluxo — gestão de tarefas de alto desempenho." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { users, login, isAuthenticated } = useFluxo();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(users[0]?.id ?? "u1");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate({ to: "/" });
  }, [isAuthenticated, navigate]);

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
    <div className="relative min-h-screen w-full overflow-hidden bg-[oklch(0.14_0.02_155)] text-white">
      {/* Aurora background */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.44 0.09 150) 0%, transparent 65%)" }}
        />
        <div
          className="absolute -bottom-40 -right-32 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.83 0.15 120) 0%, transparent 65%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.55 0.09 180) 0%, transparent 60%)" }}
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

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-16 lg:py-0">
        {/* Left — brand */}
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Task OS · v2.0</span>
          </div>
          <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
            O sistema operacional
            <br />
            das equipes de{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, oklch(0.55 0.10 150), oklch(0.83 0.15 120))",
              }}
            >
              alto desempenho
            </span>
            .
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-white/70">
            Metas diárias, semanais e mensais. Score em tempo real, notificações
            inteligentes e um painel que respira produtividade. Bem-vindo ao Fluxo.
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
        </div>

        {/* Right — auth card */}
        <div className="relative">
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-70 blur-md"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.44 0.09 150) 0%, oklch(0.83 0.15 120) 100%)",
            }}
          />
          <form
            onSubmit={submit}
            className="relative rounded-2xl border border-white/10 bg-[oklch(0.18_0.025_155)]/90 p-8 backdrop-blur-xl"
          >
            <div className="mb-6 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.44 0.09 150) 0%, oklch(0.83 0.15 120) 100%)",
                }}
              >
                F
              </div>
              <div>
                <div className="text-lg font-semibold">Entrar no Fluxo</div>
                <div className="text-xs text-white/60">Workspace Acme</div>
              </div>
            </div>

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
                          "linear-gradient(135deg, oklch(0.44 0.09 150) 0%, oklch(0.83 0.15 120) 100%)",
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
                        style={{ background: "oklch(0.83 0.15 120)" }}
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
                background:
                  "linear-gradient(135deg, oklch(0.44 0.09 150) 0%, oklch(0.83 0.15 120) 100%)",
              }}
            >
              {loading ? "Autenticando…" : `Entrar como ${user.name.split(" ")[0]}`}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>

            <p className="mt-4 text-center text-[11px] text-white/50">
              Modo demonstração — qualquer senha é aceita.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}