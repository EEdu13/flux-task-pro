/**
 * As duas lembranças dos "Cards por IA" neste navegador: se a pessoa já leu o
 * aviso de privacidade (`rv:cards-ia:aceito`) e se quer os cards ligados ao
 * entrar (`rv:cards-ia`, desligado por padrão). Fora do componente do aviso
 * para o Fast Refresh continuar funcionando nele.
 */

const CHAVE_ACEITO = "rv:cards-ia:aceito";
const CHAVE_LIGADO = "rv:cards-ia";

/* localStorage pode não existir (servidor) ou recusar (modo privado, cota):
   na dúvida, pergunta de novo e começa desligado. */
export function cardsIaJaAceito(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_ACEITO) === "1";
  } catch {
    return false;
  }
}

export function marcarCardsIaAceito() {
  try {
    window.localStorage.setItem(CHAVE_ACEITO, "1");
  } catch {
    /* sem armazenamento: o aviso volta na próxima vez, o que é o lado seguro */
  }
}

/** Preferência de ligar os cards ao entrar. Desligada por padrão. */
export function lerPreferenciaCardsIa(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_LIGADO) === "1" && cardsIaJaAceito();
  } catch {
    return false;
  }
}

export function salvarPreferenciaCardsIa(ligado: boolean) {
  try {
    window.localStorage.setItem(CHAVE_LIGADO, ligado ? "1" : "0");
  } catch {
    /* preferência é conveniência: perder não quebra nada */
  }
}
