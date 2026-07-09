export interface DepartmentRoom {
  name: string;
  label: string;
  desc: string;
  sector?: string;
}

export const DEPARTMENT_ROOMS: DepartmentRoom[] = [
  { name: "financeiro", label: "Financeiro", desc: "Sala do time financeiro", sector: "financeiro" },
  { name: "controladoria", label: "Controladoria", desc: "Sala da controladoria", sector: "controladoria" },
  { name: "ti", label: "TI", desc: "Sala de Tecnologia da Informação", sector: "ti" },
  { name: "rh", label: "RH", desc: "Sala de Recursos Humanos", sector: "rh" },
  { name: "dho", label: "DHO", desc: "Desenvolvimento Humano e Organizacional", sector: "dho" },
  { name: "pcp", label: "PCP", desc: "Planejamento e Controle da Produção", sector: "pcp" },
  { name: "suprimentos", label: "Suprimentos", desc: "Sala de suprimentos e compras", sector: "suprimentos" },
  { name: "diretoria", label: "Diretoria", desc: "Sala da diretoria", sector: "diretoria" },
];