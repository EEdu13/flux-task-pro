/**
 * Atalhos da grade de criação de tarefas — fonte única.
 *
 * O cabeçalho do modal e o rodapé do painel descreviam os atalhos cada um por
 * conta própria, e diziam coisas OPOSTAS: o cabeçalho prometia "Tab para próxima
 * linha, Enter para criar todas" enquanto o código faz o contrário (Enter avança
 * a linha, Tab vai para a descrição, e Enter nunca cria nada). Quem abria a tela
 * lia a instrução errada primeiro.
 *
 * Fica em módulo separado porque exportar constante do mesmo arquivo que exporta
 * componentes derruba o fast refresh dele.
 */
export const ATALHOS_GRADE: { tecla: string; acao: string }[] = [
  { tecla: "Enter", acao: "próxima linha" },
  { tecla: "Tab", acao: "descrição" },
  { tecla: "@", acao: "acompanhar" },
  { tecla: "↑↓", acao: "navega" },
];
