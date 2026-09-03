import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { ptBR } from "react-day-picker/locale";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dataParaIso, isoParaData } from "@/lib/data-iso";
import { cn } from "@/lib/utils";

/**
 * Campo de data com calendário próprio, no lugar do <input type="date">.
 *
 * O seletor nativo do Chromium é uma janela do navegador: não aceita CSS, não
 * segue a paleta do sistema e no tema escuro aparecia branco. Aqui usamos o
 * Calendar (react-day-picker já estilizado com os tokens do tema) dentro de um
 * Popover, então ele acompanha tema e paleta como qualquer outra superfície.
 *
 * O valor entra e sai como "yyyy-MM-dd" — o mesmo formato do input nativo,
 * para as telas que já guardam a data assim não precisarem mudar nada.
 */

function rotular(iso: string, formato: "curto" | "longo"): string {
  const d = isoParaData(iso);
  if (!d) return "";
  return formato === "curto"
    ? d.toLocaleDateString("pt-BR")
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function CampoData({
  value,
  onChange,
  placeholder = "Escolher data",
  className,
  formato = "curto",
  limpavel = true,
  disabled = false,
  title,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  /** Classes do gatilho — herda o tamanho/borda de onde o campo é usado. */
  className?: string;
  formato?: "curto" | "longo";
  limpavel?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const selecionada = isoParaData(value);
  const rotulo = rotular(value, formato);

  const escolher = (d: Date | undefined) => {
    if (!d) return;
    onChange(dataParaIso(d));
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={title ?? (rotulo || placeholder)}
          aria-label={ariaLabel ?? title ?? placeholder}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 text-left outline-none transition-colors",
            "hover:border-primary/60 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/20",
            "data-[state=open]:border-primary data-[state=open]:ring-1 data-[state=open]:ring-primary/20",
            "disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !rotulo && "text-muted-foreground")}>
            {rotulo || placeholder}
          </span>
          {/* Limpar fica no gatilho, não dentro do calendário: com o popover
              fechado é o único lugar de onde dá para apagar a data. */}
          {limpavel && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar data"
              title="Limpar data"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange("");
                }
              }}
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* z-450: o PopoverContent vem com z-50 e é portalado no body, então
          dentro dos modais (que vão até z-400) o calendário abriria ATRÁS
          deles. Fica acima dos modais e abaixo do confirm (z-500) e da barra
          de título (z-9999), que precisam continuar por cima. */}
      <PopoverContent align="start" className="z-450 w-auto p-0">
        {/* startMonth/endMonth explícitos: com captionLayout="dropdown" o
            react-day-picker limita o fim ao 31/12 do ano ATUAL por padrão —
            num app de prazos isso deixaria de fora qualquer data do ano que
            vem. Damos 2 anos para trás (retroativo) e 5 para frente. */}
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selecionada}
          onSelect={escolher}
          defaultMonth={selecionada}
          startMonth={new Date(new Date().getFullYear() - 2, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          autoFocus
          captionLayout="dropdown"
          className="p-3"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
          <button
            type="button"
            onClick={() => escolher(new Date())}
            className="rounded px-2 py-1 font-medium text-primary hover:bg-primary/10"
          >
            Hoje
          </button>
          {limpavel && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setAberto(false);
              }}
              className="rounded px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
