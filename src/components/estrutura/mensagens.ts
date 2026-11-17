import { dataPorExtenso, horaEmBrasilia } from "@/lib/estrutura-datas";
import { motivoDaFalha } from "@/lib/estrutura-cliente";
import type { FalhaDaEstrutura } from "@/lib/estrutura-tipos";

/*
 * Os textos da estrutura do dia: erros e popups. A tela decide pelo `motivo`
 * do erro, nunca pelo texto do servidor (que nasce do PWA e pode mudar lá sem
 * ninguém avisar aqui). A exceção é `dado_recusado`, em que a mensagem do PWA
 * diz QUAL dado foi recusado, e o motivo sozinho não conta.
 */

export function mensagemDaFalha(e: unknown): string {
  const f = (e ?? {}) as FalhaDaEstrutura;
  switch (motivoDaFalha(e)) {
    case "fechada":
      return "A estrutura do dia ainda não está aberta para você.";
    case "sem_sessao":
      return "Sua sessão expirou. Entre novamente.";
    case "fora_do_alcance":
      return "Esta equipe não é sua. Escolha uma das suas.";
    case "indisponivel":
      return "O sistema de apontamento não respondeu. Tente de novo em instantes.";
    case "acesso_negado":
      return "O sistema de apontamento não reconheceu o seu acesso. Avise a TI: não dá para resolver por aqui.";
    case "sem_permissao":
      return "O sistema de apontamento recusou: esta equipe não está no alcance do seu acesso.";
    case "dia_invalido":
      return "Dia inválido.";
    case "dia_futuro":
      return "Não dá para enviar a estrutura de um dia que ainda não chegou.";
    case "madrugada":
      return "Confirme o envio antes das 4h da manhã.";
    case "lista_mudou":
      return "A lista da equipe mudou. Confira as marcas e envie de novo.";
    case "ja_enviado":
      return "Este dia já tem estrutura enviada. Para substituir, use Reenviar / corrigir.";
    case "retirada_mudou":
      return "As retiradas da equipe mudaram. Confirme de novo.";
    case "envio_em_andamento":
      return "Esta estrutura já está sendo enviada. Aguarde um instante.";
    case "dia_virou":
      return "O dia mudou enquanto você marcava. Recarregue a tela.";
    case "dado_recusado":
      return f.message || "O sistema de apontamento recusou os dados.";
    case "envio_incerto":
      return "Não deu para saber se o envio chegou. Confira o dia na barra da semana antes de enviar de novo.";
    case "adicao_desligada":
      return "Adicionar à equipe ainda não está liberado.";
    case "candidato_indisponivel":
      return "Alguém da lista já não está sem equipe: outra pessoa pode ter puxado antes. A lista foi atualizada.";
    default:
      return f.message || "Algo deu errado. Tente de novo.";
  }
}

/** "Ana", "Ana e Beto", "Ana, Beto e Caio". */
export function listaDeNomes(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/* ------------------------------- Popups ------------------------------- */

export const popupDaMadrugada = (dia: string) => ({
  titulo: "Enviar antes das 4h da manhã?",
  descricao: `Agora são ${horaEmBrasilia()}h. Confirme que a estrutura de ${dataPorExtenso(dia)} é mesmo para enviar agora.`,
  confirmar: "Enviar mesmo assim",
  cancelar: "Voltar",
});

/**
 * O reenvio é simples: o PWA preserva os lançamentos do PCP, dos ajustes e os
 * retroativos (Eduardo, 09/11/2026), então não há mais o que avisar dos outros.
 */
export const popupDoReenvio = (dia: string) => ({
  titulo: "Substituir a estrutura enviada?",
  descricao: `A estrutura de ${dataPorExtenso(dia)} já foi enviada. Enviar de novo substitui a do líder; o que o PCP, os ajustes e os retroativos lançaram é preservado.`,
  confirmar: "Substituir",
  cancelar: "Voltar",
});

/**
 * A retirada de pessoas e de veículos, num aviso só. Quem sai vai para SEM EQUIPE: a pessoa fica
 * disponível para quem a puxar; o veículo volta para o projeto, e quem estiver com ele o puxa de volta.
 */
export const popupDaRetirada = (nomes: readonly string[], veiculos: readonly string[] = []) => {
  const total = nomes.length + veiculos.length;
  const soPessoas = veiculos.length === 0;
  const soVeiculos = nomes.length === 0;
  const titulo =
    total === 1
      ? soVeiculos
        ? "Retirar o veículo da equipe?"
        : "Retirar da equipe?"
      : soPessoas
        ? `Retirar ${total} pessoas da equipe?`
        : soVeiculos
          ? `Retirar ${total} veículos da equipe?`
          : `Retirar ${total} itens da equipe?`;

  let descricao: string;
  if (soPessoas) {
    descricao =
      nomes.length === 1
        ? `${nomes[0]} será retirado(a) da sua equipe e irá para SEM EQUIPE. Confirmar?`
        : `${listaDeNomes(nomes)} serão retirados(as) da sua equipe e irão para SEM EQUIPE. Confirmar?`;
  } else if (soVeiculos) {
    descricao =
      veiculos.length === 1
        ? `${veiculos[0]} será retirado da sua equipe e voltará para o projeto, sem equipe. Quem estiver com ele pode puxar de volta. Confirmar?`
        : `${listaDeNomes(veiculos)} serão retirados da sua equipe e voltarão para o projeto, sem equipe. Quem estiver com eles pode puxar de volta. Confirmar?`;
  } else {
    descricao = `Pessoas: ${listaDeNomes(nomes)}. Veículos: ${listaDeNomes(veiculos)}. Saem da sua equipe e vão para SEM EQUIPE (os veículos voltam para o projeto). Confirmar?`;
  }
  return { titulo, descricao, confirmar: "Enviar e retirar", cancelar: "Voltar", perigo: true };
};
