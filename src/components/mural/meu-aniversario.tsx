import { useEffect, useState } from "react";
import { Cake, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { confirmar } from "@/components/confirm-dialog";
import { recarregarAniversariosDeHoje } from "@/lib/aniversario-hoje";
import {
  NOMES_DOS_MESES,
  carregarPainelDoMural,
  ehErroDeMuralInativo,
  esquecerPainelDoMural,
  MSG_MURAL_INATIVO,
} from "@/lib/mural-cliente";

/*
 * "Meu aniversário" (Mural, 14/10/2026). A data vem do cadastro do RH
 * (dbo.COLABORADORES.DATA_NASCIMENTO, preenchida em 14/10/2026) — só dia e
 * mês; o ano nunca aparece. Aqui a pessoa só decide se aparece no mural, e
 * corrige a data se o RH estiver errado. Quem não está no cadastro do RH
 * (externos) conta o seu à mão, como antes.
 *
 * Duas formas: o cartão de Configurações e o convite compacto do mural
 * ("Conte quando é seu aniversário 🎂").
 */

const maxDoMes = (mes: number) => (mes === 2 ? 29 : [4, 6, 9, 11].includes(mes) ? 30 : 31);

export function MeuAniversario({
  compacto = false,
  aoSalvar,
}: {
  compacto?: boolean;
  aoSalvar?: () => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo] = useState(true);
  // A escolha da própria pessoa (exceção ao RH); null = segue o cadastro do RH.
  const [salvo, setSalvo] = useState<{ dia: number; mes: number; mostrar: boolean } | null>(null);
  const [rh, setRh] = useState<{ dia: number; mes: number } | null>(null);
  const [corrigindo, setCorrigindo] = useState(false);
  const [dia, setDia] = useState(0);
  const [mes, setMes] = useState(0);
  const [mostrar, setMostrar] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    carregarPainelDoMural()
      .then((p) => {
        if (!vivo) return;
        setAtivo(p.ativo);
        setRh(p.meuRH);
        setSalvo(p.meu?.origem === "manual" ? p.meu : null);
        if (p.meu) {
          setDia(p.meu.dia);
          setMes(p.meu.mes);
          setMostrar(p.meu.mostrar);
        }
      })
      .catch((e: unknown) => {
        if (vivo && ehErroDeMuralInativo(e)) setAtivo(false);
      })
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const valido = mes >= 1 && dia >= 1 && dia <= maxDoMes(mes);
  const mudou = !salvo || salvo.dia !== dia || salvo.mes !== mes || salvo.mostrar !== mostrar;

  const salvar = async (
    escolha: { dia: number; mes: number; mostrar: boolean } = { dia, mes, mostrar },
  ) => {
    if (salvando) return;
    if (!(escolha.mes >= 1 && escolha.dia >= 1 && escolha.dia <= maxDoMes(escolha.mes))) return;
    setSalvando(true);
    try {
      const { salvarMeuAniversario } = await import("@/lib/mural.functions");
      await salvarMeuAniversario({ data: escolha });
      setSalvo(escolha);
      setDia(escolha.dia);
      setMes(escolha.mes);
      setMostrar(escolha.mostrar);
      esquecerPainelDoMural();
      recarregarAniversariosDeHoje();
      toast.success(
        escolha.mostrar
          ? "Anotado! O mural vai lembrar do seu dia 🎂"
          : "Anotado, sem aparecer no mural.",
      );
      aoSalvar?.();
    } catch (e) {
      toast.error(ehErroDeMuralInativo(e) ? MSG_MURAL_INATIVO : "Não foi possível salvar agora.");
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async () => {
    const ok = await confirmar(
      rh
        ? {
            titulo: "Voltar para a data do RH?",
            descricao: "A sua correção sai e o mural volta a usar a data do cadastro do RH.",
            confirmar: "Voltar",
          }
        : {
            titulo: "Tirar seu aniversário?",
            descricao: "O mural deixa de mostrar a data. Você pode contar de novo quando quiser.",
            confirmar: "Tirar",
            perigo: true,
          },
    );
    if (!ok) return;
    setSalvando(true);
    try {
      const { salvarMeuAniversario } = await import("@/lib/mural.functions");
      await salvarMeuAniversario({ data: { apagar: true } });
      setSalvo(null);
      setCorrigindo(false);
      setDia(rh?.dia ?? 0);
      setMes(rh?.mes ?? 0);
      setMostrar(true);
      esquecerPainelDoMural();
      recarregarAniversariosDeHoje();
      aoSalvar?.();
    } catch {
      toast.error("Não foi possível tirar agora.");
    } finally {
      setSalvando(false);
    }
  };

  const seletores = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Dia"
        className="input w-auto"
        value={dia || ""}
        onChange={(e) => setDia(Number(e.target.value))}
        disabled={!ativo || salvando}
      >
        <option value="" disabled>
          Dia
        </option>
        {Array.from({ length: mes ? maxDoMes(mes) : 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        aria-label="Mês"
        className="input w-auto"
        value={mes || ""}
        onChange={(e) => {
          const m = Number(e.target.value);
          setMes(m);
          if (dia > maxDoMes(m)) setDia(maxDoMes(m));
        }}
        disabled={!ativo || salvando}
      >
        <option value="" disabled>
          Mês
        </option>
        {NOMES_DOS_MESES.map((n, i) => (
          <option key={n} value={i + 1}>
            {n.charAt(0).toUpperCase() + n.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );

  const botaoSalvar = (
    <button
      type="button"
      onClick={() => void salvar()}
      disabled={!ativo || !valido || !mudou || salvando}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
    >
      {salvando ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Save className="h-3.5 w-3.5" />
      )}
      Salvar
    </button>
  );

  if (compacto) {
    return (
      <div className="space-y-2">
        {seletores}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">Só dia e mês. Sem ano.</span>
          {botaoSalvar}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Cake className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Meu aniversário</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Só o dia e o mês — o ano não aparece. No dia, o mural avisa a turma e seu avatar ganha
            um chapeuzinho de festa.
          </p>
        </div>
      </div>

      {carregando ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </div>
      ) : !ativo ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {MSG_MURAL_INATIVO} Volte daqui a pouco.
        </p>
      ) : rh && !salvo && !corrigindo ? (
        /* A data do RH, pronta: só escolher se aparece. */
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-xl font-bold">
              🎂 {rh.dia} de {NOMES_DOS_MESES[rh.mes - 1]}
            </span>
            <span className="text-[11px] text-muted-foreground">do cadastro do RH</span>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked
              onChange={() => void salvar({ ...rh, mostrar: false })}
              disabled={salvando}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Mostrar no mural
          </label>
          <button
            type="button"
            onClick={() => setCorrigindo(true)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Data errada? Corrigir
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rh && (
            <p className="text-[11px] text-muted-foreground">
              No cadastro do RH: {rh.dia} de {NOMES_DOS_MESES[rh.mes - 1]}.
            </p>
          )}
          {seletores}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mostrar}
              onChange={(e) => setMostrar(e.target.checked)}
              disabled={salvando}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            Mostrar no mural
          </label>
          <div className="flex items-center justify-between gap-2">
            {salvo ? (
              <button
                type="button"
                onClick={() => void apagar()}
                disabled={salvando}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
              >
                {rh ? "Voltar para a data do RH" : "Tirar meu aniversário"}
              </button>
            ) : corrigindo ? (
              <button
                type="button"
                onClick={() => setCorrigindo(false)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Cancelar
              </button>
            ) : (
              <span />
            )}
            {botaoSalvar}
          </div>
        </div>
      )}
    </section>
  );
}
