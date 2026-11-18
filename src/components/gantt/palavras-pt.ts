/**
 * As palavras do Gantt em português do Brasil (17/11/2026).
 *
 * O SVAR só traz inglês e chinês para o Gantt, e português de Portugal para o
 * núcleo. Aqui vai a versão inteira, para o `<Locale>` do SVAR: meses e dias das
 * escalas, a semana começando na segunda (como no Portfólio) e os poucos termos
 * do Gantt que aparecem, já que o editor e o menu dele ficam desligados.
 */
export const PALAVRAS_PT = {
  lang: "pt-BR",
  calendar: {
    monthFull: [
      "Janeiro",
      "Fevereiro",
      "Março",
      "Abril",
      "Maio",
      "Junho",
      "Julho",
      "Agosto",
      "Setembro",
      "Outubro",
      "Novembro",
      "Dezembro",
    ],
    monthShort: [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ],
    dayFull: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
    dayShort: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
    hours: "Horas",
    minutes: "Minutos",
    done: "Pronto",
    clear: "Limpar",
    today: "Hoje",
    am: ["am", "AM"],
    pm: ["pm", "PM"],
    weekStart: 1,
    clockFormat: 24,
  },
  core: {
    ok: "OK",
    cancel: "Cancelar",
    select: "Selecionar",
    "No data": "Nada para mostrar",
    "Rows per page": "Linhas por página",
    "Total pages": "Total de páginas",
  },
  formats: {
    timeFormat: "%H:%i",
    dateFormat: "%d/%m/%Y",
    monthYearFormat: "%F %Y",
    yearFormat: "%Y",
  },
  gantt: {
    "Task name": "Tarefa",
    "Start date": "Início",
    "End date": "Prazo",
    Duration: "Duração",
    Task: "Tarefa",
    "Summary task": "Projeto",
    Milestone: "Marco",
    Week: "Semana",
    Q: "Trimestre",
    Delete: "Apagar",
    Save: "Salvar",
    Edit: "Editar",
  },
};
