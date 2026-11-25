import { CampoData } from "@/components/campo-data";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import {
  DIAS_SEMANA,
  MESES,
  ULTIMO_DIA_DO_MES,
  ULTIMO_DIA_UTIL,
  descreverRecorrencia,
  primeiraDataDaRegra,
} from "@/lib/recorrencia";
import { freqLabels, SEM_RECORRENCIA, type Frequency } from "@/lib/fluxo-types";

/** A regra de repetição como o formulário a guarda: datas em "yyyy-MM-dd". */
export type ValorDeRecorrencia = {
  recurring: boolean;
  frequency: Frequency;
  recurringWeekdays: number[];
  recurringMonthDay: number | null;
  /** "yyyy-MM-dd", ou vazio para "sem limite". */
  recurringUntil: string;
};

/**
 * O bloco "Tarefa recorrente": a caixa, os atalhos, os dias da semana, o dia do
 * mês ou do ano, o "repetir até" e a regra por extenso.
 *
 * Morava dentro da janela da tarefa (`TaskDialog`) e saiu daqui em 25/11/2026
 * para o "Clonar tarefa" mostrar o MESMO editor, já preenchido com a regra da
 * original. Dois editores escritos à mão divergiriam no primeiro ajuste — e a
 * regra é o que decide quando a próxima ocorrência nasce.
 *
 * Controlado: quem usa guarda o estado. Cada clique manda UM `aoMudar` com tudo
 * o que mudou junto, para quem guarda tudo num objeto só não perder campo entre
 * duas atualizações.
 */
export function EditorDeRecorrencia({
  valor,
  prazo,
  aoMudar,
  aoMudarPrazo,
  aoLigar,
  comFrequencia = false,
}: {
  valor: ValorDeRecorrencia;
  /** O prazo da tarefa ("yyyy-MM-dd"): a série conta a partir dele. */
  prazo: string;
  aoMudar: (patch: Partial<ValorDeRecorrencia>) => void;
  /** "Dias úteis" e o dia do mês/ano empurram o prazo para cair na regra. */
  aoMudarPrazo: (dia: string) => void;
  /** Chamado ao ligar a recorrência — a janela da tarefa desliga o "Sem prazo" aqui. */
  aoLigar?: () => void;
  /**
   * Mostra o seletor de frequência dentro do bloco. A janela da tarefa não
   * precisa: ela tem o campo "Frequência" na grade de cima, que é o mesmo
   * controle visto de outro lugar.
   */
  comFrequencia?: boolean;
}) {
  const { recurring, frequency, recurringWeekdays, recurringMonthDay, recurringUntil } = valor;

  const ligar = (patch: Partial<ValorDeRecorrencia> = {}) => {
    aoMudar({ ...patch, recurring: true });
    aoLigar?.();
  };

  return (
    <div className="rounded-md border border-border bg-secondary/40 p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => (e.target.checked ? ligar() : aoMudar({ recurring: false }))}
        />
        Tarefa recorrente (repete automaticamente ao concluir)
      </label>
      {comFrequencia && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Frequência:</span>
          <select
            value={recurring ? frequency : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                aoMudar({ recurring: false, recurringUntil: "" });
                return;
              }
              ligar({ frequency: v as Frequency });
            }}
            className="input max-w-[13rem] py-1 text-xs"
            aria-label="Frequência"
          >
            <option value="">{SEM_RECORRENCIA}</option>
            {Object.entries(freqLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Atalhos:</span>
        {/* "Dias úteis" era `diaria` empurrando só o PRIMEIRO prazo para
            a segunda — dali em diante a série caía no sábado e no
            domingo (relato de 08/10/2026). Agora é semanal, de
            segunda a sexta, como o pack. */}
        {(
          [
            { label: "Dias úteis", freq: "semanal" as Frequency, days: 30, weekdays: true },
            { label: "Diária", freq: "diaria" as Frequency, days: 30 },
            { label: "Dia sim, dia não", freq: "alternado" as Frequency, days: 30 },
            { label: "Semanal", freq: "semanal" as Frequency, days: 90 },
            { label: "Mensal", freq: "mensal" as Frequency, days: 365 },
          ] as { label: string; freq: Frequency; days: number; weekdays?: boolean }[]
        ).map((p) => {
          const ehUteis = recurringWeekdays.join() === "1,2,3,4,5";
          const active =
            recurring && frequency === p.freq && (p.freq !== "semanal" || !!p.weekdays === ehUteis);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                const end = new Date();
                end.setDate(end.getDate() + p.days);
                const patch: Partial<ValorDeRecorrencia> = {
                  frequency: p.freq,
                  recurringUntil: dataParaIso(end),
                };
                if (p.freq === "semanal")
                  patch.recurringWeekdays = p.weekdays ? [1, 2, 3, 4, 5] : [];
                ligar(patch);
                if (p.weekdays) {
                  // `new Date("2026-09-13")` é meia-noite UTC — sábado
                  // às 21h no Brasil, e o domingo não era pulado.
                  const d = isoParaData(prazo) ?? new Date();
                  const dow = d.getDay();
                  if (dow === 0) d.setDate(d.getDate() + 1);
                  if (dow === 6) d.setDate(d.getDate() + 2);
                  aoMudarPrazo(dataParaIso(d));
                }
              }}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:border-primary/50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
        {recurring && (
          <button
            type="button"
            onClick={() => aoMudar({ recurring: false, recurringUntil: "" })}
            className="ml-auto text-[11px] text-muted-foreground hover:text-destructive"
          >
            remover recorrência
          </button>
        )}
      </div>
      {/* Especificação fina, só do tipo escolhido. Antes "mensal" não
          dizia qual dia e "semanal" não dizia quais dias — a série
          caía sempre no mesmo dia do prazo original. */}
      {recurring && frequency === "semanal" && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <span className="text-[11px] font-medium text-foreground">Repete nestes dias:</span>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {DIAS_SEMANA.map((nome, dia) => {
              const marcado = recurringWeekdays.includes(dia);
              return (
                <button
                  key={nome}
                  type="button"
                  onClick={() =>
                    aoMudar({
                      recurringWeekdays: marcado
                        ? recurringWeekdays.filter((d) => d !== dia)
                        : [...recurringWeekdays, dia].sort((a, b) => a - b),
                    })
                  }
                  aria-pressed={marcado}
                  className={`h-7 w-9 rounded-md border text-[11px] font-semibold transition ${
                    marcado
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {nome}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => aoMudar({ recurringWeekdays: [1, 2, 3, 4, 5] })}
              className="ml-1 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
            >
              Dias úteis
            </button>
          </div>
          {recurringWeekdays.length === 0 && (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Sem nenhum marcado, repete no mesmo dia da semana do prazo.
            </p>
          )}
        </div>
      )}

      {recurring && (frequency === "mensal" || frequency === "anual") && (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <span className="text-[11px] font-medium text-foreground">
            {frequency === "anual" ? "Repete todo ano em:" : "Repete no dia:"}
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {frequency === "anual" && (
              <select
                value={(isoParaData(prazo) ?? new Date()).getMonth()}
                onChange={(e) => {
                  const mes = Number(e.target.value);
                  const atual = isoParaData(prazo) ?? new Date();
                  aoMudarPrazo(
                    dataParaIso(
                      primeiraDataDaRegra("anual", recurringMonthDay ?? atual.getDate(), mes),
                    ),
                  );
                }}
                className="input max-w-40 py-1 text-xs capitalize"
                aria-label="Mês"
              >
                {MESES.map((nome, i) => (
                  <option key={nome} value={i}>
                    {nome}
                  </option>
                ))}
              </select>
            )}
            <select
              value={recurringMonthDay ?? ""}
              onChange={(e) => {
                const dia = e.target.value === "" ? null : Number(e.target.value);
                aoMudar({ recurringMonthDay: dia });
                // O prazo acompanha a regra: escolher "último dia útil"
                // com o prazo em hoje criaria a primeira no dia errado.
                if (dia !== null) {
                  const mes = (isoParaData(prazo) ?? new Date()).getMonth();
                  aoMudarPrazo(
                    dataParaIso(
                      primeiraDataDaRegra(frequency === "anual" ? "anual" : "mensal", dia, mes),
                    ),
                  );
                }
              }}
              className="input max-w-[13rem] py-1 text-xs"
              aria-label="Dia"
            >
              <option value="">Mesmo dia do prazo</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Dia {d}
                </option>
              ))}
              <option value={ULTIMO_DIA_DO_MES}>Último dia do mês</option>
              <option value={ULTIMO_DIA_UTIL}>Último dia útil do mês</option>
            </select>
            {recurringMonthDay !== null && recurringMonthDay > 28 && (
              <span className="text-[10px] text-warning">
                Meses mais curtos usam o último dia disponível.
              </span>
            )}
          </div>
        </div>
      )}

      {recurring && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Repetir até (opcional):</span>
          <CampoData
            value={recurringUntil}
            onChange={(v) => aoMudar({ recurringUntil: v })}
            placeholder="Sem limite"
            title="Repetir até"
            className="max-w-40 py-1 text-xs"
          />
          {recurringUntil && (
            <button
              type="button"
              onClick={() => aoMudar({ recurringUntil: "" })}
              className="text-muted-foreground hover:text-foreground"
            >
              limpar
            </button>
          )}
          {/* A regra por extenso vale mais que o rótulo da frequência:
              "Mensal" não conta que cai no dia 15. */}
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {descreverRecorrencia({
              recurring,
              frequency,
              recurringWeekdays,
              recurringMonthDay,
              dueDate: prazo,
            })}
          </span>
        </div>
      )}
    </div>
  );
}
