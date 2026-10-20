import { useEffect, useState } from "react";
import { ehFeriadoNacional } from "@/lib/dias-uteis";

/**
 * A ofensiva do pack (19/10/2026: "é a ideia que mais faz o pessoal
 * utilizar… deixar o avatar triste, como o Duolingo"): quantos DIAS ÚTEIS
 * seguidos a pessoa fechou o pack inteiro.
 *
 * Regras (as mesmas do selo "pack fechado" do mural):
 *   - conta só dia útil (seg–sex, sem feriado nacional);
 *   - dia útil sem pack (férias, folga) não conta nem quebra;
 *   - dia com pack e alguma tarefa sem concluir até o dia do prazo QUEBRA;
 *   - hoje ainda está em jogo: fechado soma 1; aberto não quebra (ainda).
 *
 * O passado (até ontem) vem do servidor UMA vez por dia e fica guardado no
 * navegador; o dia de hoje vem da tela, que já sabe o pack de hoje.
 */

export type DiaDoPack = { dia: string; total: number; feitas: number };

/** Como cada dia da semana atual aparece na tirinha da ofensiva. */
export type SituacaoDoDia =
  "fechado" | "quebrou" | "sem-pack" | "hoje" | "futuro" | "fim-de-semana";

export type Ofensiva = {
  /** Dias úteis seguidos com o pack fechado (hoje entra se já fechou). */
  seguidos: number;
  /** A maior sequência vista nos últimos 70 dias. */
  recorde: number;
  /**
   * acesa = fechou hoje; em-risco = ainda não fechou o pack de hoje;
   * perdida = o último dia útil com pack quebrou (o avatar fica triste);
   * sem-pack = não há pack para contar.
   */
  estado: "acesa" | "em-risco" | "perdida" | "sem-pack";
  /** Seg a sex da semana atual. */
  semana: { dia: string; rotulo: string; situacao: SituacaoDoDia }[];
  carregado: boolean;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ehDiaUtil = (d: Date) => {
  const s = d.getDay();
  return s !== 0 && s !== 6 && !ehFeriadoNacional(d.getFullYear(), d.getMonth(), d.getDate());
};

const memoria = new Map<string, Promise<DiaDoPack[]>>();

/** O passado do pack, uma vez por dia (memória da aba + localStorage). */
function lerPassado(pessoaId: string): Promise<DiaDoPack[]> {
  const chave = `fluxo:ofensiva:${pessoaId}:${iso(new Date())}`;
  const naMemoria = memoria.get(chave);
  if (naMemoria) return naMemoria;
  try {
    const guardado = window.localStorage.getItem(chave);
    if (guardado) {
      const p = Promise.resolve(JSON.parse(guardado) as DiaDoPack[]);
      memoria.set(chave, p);
      return p;
    }
  } catch {
    /* sem armazenamento: busca */
  }
  const p = import("@/lib/ofensiva.functions")
    .then(({ meuPackPorDia }) => meuPackPorDia())
    .then((r) => {
      try {
        // Só a de hoje fica: as chaves dos dias anteriores saem.
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k?.startsWith(`fluxo:ofensiva:${pessoaId}:`) && k !== chave)
            window.localStorage.removeItem(k);
        }
        window.localStorage.setItem(chave, JSON.stringify(r.dias));
      } catch {
        /* sem armazenamento: fica na memória */
      }
      return r.dias;
    });
  p.catch(() => memoria.delete(chave));
  memoria.set(chave, p);
  return p;
}

/** Faz a conta a partir do passado e do pack de hoje. Pura (dá para testar). */
export function calcularOfensiva(
  passado: DiaDoPack[],
  hoje: { total: number; feitas: number },
  agora: Date = new Date(),
): Omit<Ofensiva, "carregado"> {
  const porDia = new Map(passado.map((d) => [d.dia, d]));
  const hojeIso = iso(agora);
  const fechouHoje = hoje.total > 0 && hoje.feitas >= hoje.total;

  // De ontem para trás, pelos dias úteis com pack.
  let seguidos = 0;
  let quebrouNoUltimo = false;
  let primeiro = true;
  const d = new Date(agora);
  d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 70; i++) {
    d.setDate(d.getDate() - 1);
    if (!ehDiaUtil(d)) continue;
    const p = porDia.get(iso(d));
    if (!p || p.total === 0) continue;
    if (p.feitas >= p.total) seguidos++;
    else {
      if (primeiro) quebrouNoUltimo = true;
      break;
    }
    primeiro = false;
  }
  if (fechouHoje) seguidos++;

  // O recorde: a maior corrida nos 70 dias (+ hoje).
  let recorde = 0;
  let corrida = 0;
  const r = new Date(agora);
  r.setHours(12, 0, 0, 0);
  r.setDate(r.getDate() - 70);
  for (let i = 0; i < 70; i++) {
    r.setDate(r.getDate() + 1);
    if (!ehDiaUtil(r)) continue;
    const p = porDia.get(iso(r));
    if (!p || p.total === 0) continue;
    corrida = p.feitas >= p.total ? corrida + 1 : 0;
    recorde = Math.max(recorde, corrida);
  }
  recorde = Math.max(recorde, seguidos);

  const temPack = passado.length > 0 || hoje.total > 0;
  const estado: Ofensiva["estado"] = !temPack
    ? "sem-pack"
    : fechouHoje
      ? "acesa"
      : quebrouNoUltimo && seguidos === 0
        ? "perdida"
        : // Sem pack hoje (feriado, folga): nada em jogo — a chama segue acesa.
          hoje.total === 0
          ? seguidos > 0
            ? "acesa"
            : "sem-pack"
          : "em-risco";

  // A semana atual, de segunda a sexta.
  const segunda = new Date(agora);
  segunda.setHours(12, 0, 0, 0);
  segunda.setDate(segunda.getDate() - ((segunda.getDay() + 6) % 7));
  const rotulos = ["Seg", "Ter", "Qua", "Qui", "Sex"];
  const semana = rotulos.map((rotulo, i) => {
    const dia = new Date(segunda);
    dia.setDate(segunda.getDate() + i);
    const diaIso = iso(dia);
    let situacao: SituacaoDoDia;
    if (diaIso === hojeIso) situacao = fechouHoje ? "fechado" : "hoje";
    else if (diaIso > hojeIso) situacao = "futuro";
    else if (!ehDiaUtil(dia)) situacao = "fim-de-semana";
    else {
      const p = porDia.get(diaIso);
      situacao = !p || p.total === 0 ? "sem-pack" : p.feitas >= p.total ? "fechado" : "quebrou";
    }
    return { dia: diaIso, rotulo, situacao };
  });

  return { seguidos, recorde, estado, semana };
}

/** A ofensiva de quem está olhando. `hoje` = o pack de hoje, da tela. */
export function useOfensiva(pessoaId: string, hoje: { total: number; feitas: number }): Ofensiva {
  const [passado, setPassado] = useState<DiaDoPack[] | null>(null);
  // O dia entra na conta: com a aba aberta depois da meia-noite, o ontem muda.
  const dia = new Date().toLocaleDateString("sv-SE");
  useEffect(() => {
    let vivo = true;
    lerPassado(pessoaId)
      .then((dias) => vivo && setPassado(dias))
      .catch((e: unknown) => {
        console.warn("ofensiva: não deu para ler o histórico do pack", e);
        if (vivo) setPassado([]);
      });
    return () => {
      vivo = false;
    };
  }, [pessoaId, dia]);
  const conta = calcularOfensiva(passado ?? [], hoje);
  return { ...conta, carregado: passado !== null };
}
