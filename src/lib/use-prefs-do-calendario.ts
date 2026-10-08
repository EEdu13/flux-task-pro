import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O jeito de cada um ver o calendário: a cor que destaca as próprias tarefas,
 * se as reservas de sala aparecem e os dias pintados.
 *
 * Fica no banco (`gestor.preferencias`), para valer no app e no navegador, e
 * numa cópia local, para a tela já abrir pintada em vez de piscar na cor
 * padrão até o servidor responder.
 *
 * O "fundo do calendário inteiro" saiu em 07/10/2026: o pedido era pintar UM
 * dia ("deixar o dia 10 laranja para eu lembrar"), não a grade toda.
 */
export type PrefsDoCalendario = {
  /** Cor das minhas tarefas ("#rrggbb"); `null` = a cor principal do tema. */
  minhas: string | null;
  ocultarSalas: boolean;
  /** Dias pintados: "yyyy-MM-dd" → uma das `CORES_DO_DIA`. */
  dias: Record<string, string>;
};

/** As cores de pintar um dia. Fixas, porque o dia é gravado pelo índice. */
export const CORES_DO_DIA = [
  "#2563eb",
  "#0d9488",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
] as const;

const PADRAO: PrefsDoCalendario = { minhas: null, ocultarSalas: false, dias: {} };

const HEX = /^#[0-9a-f]{6}$/i;

/* A coluna do banco guarda 400 caracteres. Os dias vão numa chave própria,
   curtos: "261010:4" (aammdd:cor), uns 40 dias. O que passou há mais de um
   mês é descartado ao gravar, e no aperto saem os mais antigos. */
const LIMITE = 400;
const GUARDA_DIAS_PASSADOS = 31;

function lerPrefs(texto: string | null | undefined): Omit<PrefsDoCalendario, "dias"> | null {
  if (!texto) return null;
  try {
    const v = JSON.parse(texto) as Partial<PrefsDoCalendario>;
    return {
      minhas: typeof v.minhas === "string" && HEX.test(v.minhas) ? v.minhas : null,
      ocultarSalas: v.ocultarSalas === true,
    };
  } catch {
    return null;
  }
}

function lerDias(texto: string | null | undefined): Record<string, string> {
  const dias: Record<string, string> = {};
  for (const item of (texto ?? "").split(",")) {
    const m = /^(\d{2})(\d{2})(\d{2}):(\d)$/.exec(item.trim());
    const cor = m ? CORES_DO_DIA[Number(m[4])] : undefined;
    if (m && cor) dias[`20${m[1]}-${m[2]}-${m[3]}`] = cor;
  }
  return dias;
}

function escreverDias(dias: Record<string, string>, agora = new Date()): string {
  const corte = new Date(agora);
  corte.setDate(corte.getDate() - GUARDA_DIAS_PASSADOS);
  const p = (n: number) => String(n).padStart(2, "0");
  const corteIso = `${corte.getFullYear()}-${p(corte.getMonth() + 1)}-${p(corte.getDate())}`;
  const itens = Object.entries(dias)
    .filter(([iso]) => iso >= corteIso)
    .sort(([a], [b]) => (a < b ? 1 : -1)) // mais novos primeiro: são os que ficam
    .map(([iso, cor]) => {
      const i = CORES_DO_DIA.indexOf(cor as (typeof CORES_DO_DIA)[number]);
      return i < 0 ? null : `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}:${i}`;
    })
    .filter((x): x is string => !!x);
  let texto = "";
  for (const item of itens) {
    const proximo = texto ? `${texto},${item}` : item;
    if (proximo.length > LIMITE) break;
    texto = proximo;
  }
  return texto;
}

const chaveLocal = (pessoaId: string) => `fluxo:calendario:${pessoaId}`;

type Copia = { prefs: string; dias: string };

export function usePrefsDoCalendario(pessoaId: string) {
  const [prefs, setPrefs] = useState<PrefsDoCalendario>(PADRAO);
  /** Mudou aqui antes de o servidor responder: a resposta não pode desfazer. */
  const mexeu = useRef(false);

  useEffect(() => {
    mexeu.current = false;
    let local: PrefsDoCalendario | null = null;
    try {
      const bruto = localStorage.getItem(chaveLocal(pessoaId));
      const copia = bruto ? (JSON.parse(bruto) as Partial<Copia>) : null;
      const base = lerPrefs(copia?.prefs);
      if (base) local = { ...base, dias: lerDias(copia?.dias) };
    } catch {
      /* armazenamento bloqueado ou cópia antiga: fica o padrão */
    }
    setPrefs(local ?? PADRAO);
    let vivo = true;
    import("@/lib/perfil.functions")
      .then((m) => m.minhasPreferencias())
      .then((todas) => {
        const base = lerPrefs(todas.calendario) ?? { minhas: null, ocultarSalas: false };
        if (vivo && !mexeu.current) setPrefs({ ...base, dias: lerDias(todas.calendario_dias) });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [pessoaId]);

  /* A gravação espera a pessoa parar: o seletor de cor muda a cada pixel
     arrastado, e cada mudança seria uma ida ao servidor. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const atual = useRef(prefs);
  atual.current = prefs;
  const mudar = useCallback(
    (parte: Partial<PrefsDoCalendario>) => {
      mexeu.current = true;
      const nova = { ...atual.current, ...parte };
      atual.current = nova;
      setPrefs(nova);
      const textoPrefs = JSON.stringify({ minhas: nova.minhas, ocultarSalas: nova.ocultarSalas });
      const textoDias = escreverDias(nova.dias);
      try {
        localStorage.setItem(
          chaveLocal(pessoaId),
          JSON.stringify({ prefs: textoPrefs, dias: textoDias } satisfies Copia),
        );
      } catch {
        /* sem cópia local, o banco ainda guarda */
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void import("@/lib/perfil.functions").then(async (m) => {
          await m.salvarPreferencia({ data: { chave: "calendario", valor: textoPrefs } });
          /* Sem dia pintado não há o que gravar, e o servidor recusa valor
             vazio: grava-se um marcador que `lerDias` ignora. */
          await m.salvarPreferencia({
            data: { chave: "calendario_dias", valor: textoDias || "-" },
          });
        }).catch(() => {});
      }, 600);
    },
    [pessoaId],
  );

  /** Pinta o dia ("yyyy-MM-dd") com uma das `CORES_DO_DIA`, ou tira a cor. */
  const pintarDia = useCallback(
    (iso: string, cor: string | null) => {
      const dias = { ...atual.current.dias };
      if (cor) dias[iso] = cor;
      else delete dias[iso];
      mudar({ dias });
    },
    [mudar],
  );

  return [prefs, mudar, pintarDia] as const;
}
