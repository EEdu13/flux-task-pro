/**
 * A ESTRUTURA DO DIA pelo CONECTA (Parte A da especificação de 04/11/2026).
 *
 * Os líderes das equipes administrativas mandam todo dia a estrutura do dia
 * (quem trabalhou, faltou, está de folga; onde está cada veículo) pelo app de
 * campo (PWA, `apontamento.up.railway.app`). Aqui o mesmo envio sai do CONECTA,
 * que NÃO grava no banco: o servidor chama a API do PWA com o token da IAM da
 * própria pessoa, e a regra (data, hierarquia, duplicidade, folgas) fica num
 * lugar só.
 *
 * Está pronta e ESCONDIDA. As chaves, da mais larga à mais estreita:
 *
 * - `ESTRUTURA_LIBERADA`: todo líder que o PWA reconhecer vê a tela, o card do
 *   Início e o lembrete do Pack. Com `false`, só o piloto.
 * - `PILOTO_DA_ESTRUTURA`: enquanto não está liberada, só estas pessoas (ids da
 *   IAM) abrem a estrutura, e só destas equipes. O dev (`npm run dev`) segue as
 *   mesmas regras da produção e lê o PWA de verdade (leitura em produção).
 * - `ENVIO_REAL_LIGADO`: com `false`, "Enviar" é uma SIMULAÇÃO: o servidor monta
 *   o corpo, confere tudo e responde sem chamar o PWA. Ligar só depois de
 *   conferir o corpo com o Eduardo, e o primeiro envio real é dele, na 400AC.
 *   O dev NUNCA envia de verdade, qualquer que seja a chave: o `npm run dev`
 *   usa o mesmo `.env` da produção (ver `transporte.server.ts`).
 *
 * Para liberar: `ESTRUTURA_LIBERADA = true`, o piloto desligado e a leva da
 * estrutura nas Novidades (`TELAS_DA_ESTRUTURA` em `novidades.tsx`, só para quem
 * tem estrutura; a do conversor fica guardada), no mesmo deploy.
 */
export const ESTRUTURA_LIBERADA = false;

export const PILOTO_DA_ESTRUTURA: { pessoas: readonly number[]; equipes: readonly string[] } = {
  /* Ids da IAM de quem testa em produção: o Eduardo (465, o mesmo `DONO` das Recompensas).
     Vazio = ninguém: a estrutura fica invisível em produção até alguém ser posto aqui. */
  pessoas: [465],
  equipes: ["400AC"],
};

/**
 * Quem tem o seletor de equipe, e em que equipe a tela abre para ele. Decisão do usuário,
 * 10/11/2026: o Eduardo é usuário GLOBAL na IAM (o PWA devolve todas as equipes para ele), então
 * só ele troca de equipe, e a tela abre direto na dele. Os outros veem só a própria equipe, sem
 * seletor, e são só os supervisores (a gerência não vê a aba: para ela virá outra coisa).
 */
export const QUEM_TROCA_DE_EQUIPE: Readonly<Record<number, string>> = { 465: "400AC" };

/* Ligado em 17/11/2026 (decisão do usuário) para o primeiro envio real, com o Eduardo na 400AC:
   enquanto `ESTRUTURA_LIBERADA` for `false`, só o piloto (ele, só nessa equipe) alcança o envio. */
export const ENVIO_REAL_LIGADO = true;

/**
 * Puxar pessoas e veículos SEM EQUIPE para a equipe (o espelho da retirada). Muda quem é da equipe
 * no PWA na hora. O contrato foi confirmado pelo Eduardo em 10/11/2026 (rotas, `acao`, o filtro de
 * alcance), mas o PWA ainda não confere quem pode puxar quem: a barreira é o filtro do CONECTA.
 * Com `false` o botão "Adicionar" some e o servidor recusa. Ligado junto com `ENVIO_REAL_LIGADO` em
 * 17/11/2026, para o primeiro teste real na 400AC (só o piloto alcança).
 */
export const ADICIONAR_NA_EQUIPE_LIGADO = true;

/**
 * O CONVERSOR DE ARQUIVOS (a paleta de conversão): LIBERADO para todos em 17/11/2026 (decisão do
 * usuário), antes da estrutura, que segue no piloto. A Novidade dele abre junto (`novidades.tsx`).
 * Com `false`, em produção, o conversor some de tudo (Ctrl segurado, arrastar arquivo, raio, barra
 * lateral, Ctrl+K e a opção do Ctrl em Configurações) e a janela de Novidades nem abre. No dev
 * (`npm run dev`) está sempre ligado.
 */
export const CONVERSOR_LIBERADO = true;

/** O conversor aparece para esta aba? Constante do módulo: o build de produção a resolve sozinho. */
export const CONVERSOR_ABERTO = import.meta.env.DEV || CONVERSOR_LIBERADO;

/**
 * Gerências e a 400AJ (Compras): fora por ora, decisão do Eduardo (05/11/2026).
 * O que o PWA devolver em `minhas-equipes` é filtrado por esta lista.
 */
export const EQUIPES_FORA_DA_ESTRUTURA: readonly string[] = ["400AX", "400AY", "400AZ", "400AJ"];

/**
 * Os projetos cujas equipes ADM entram na estrutura: só o 400 (o escritório da matriz). As equipes
 * ADM do 202, do 700 e do 820 ficam de fora (decisão do usuário, 10/11/2026). O código da equipe
 * começa pelo projeto ("400AD").
 */
export const PROJETOS_DA_ESTRUTURA: readonly string[] = ["400"];

/** A equipe entra na estrutura do CONECTA? Só as do projeto 400, menos as que estão fora. */
export function equipeParticipa(equipe: string): boolean {
  const codigo = equipe.trim().toUpperCase();
  if (EQUIPES_FORA_DA_ESTRUTURA.includes(codigo)) return false;
  return PROJETOS_DA_ESTRUTURA.some((p) => codigo.startsWith(p));
}
