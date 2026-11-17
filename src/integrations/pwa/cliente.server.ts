// O cliente do PWA de apontamento: as operações que a Parte A usa. EXCLUSIVO do servidor.
// Cada uma monta a chamada, passa pelo transporte (que tem as travas de escrita) e entrega o
// corpo ao adaptador, que conhece os campos. Nada é logado aqui.

import {
  lerCobranca,
  lerDiasEnviados,
  lerFrotaDoProjeto,
  lerLinhasDoDia,
  lerMinhasEquipes,
  lerPessoas,
  lerRespostaDoEnvio,
  lerTodosOsColaboradores,
  lerVeiculos,
  liderDasPessoas,
  montarCorpoDoEnvio,
} from "./adaptadores.server";
import { ErroDaEstrutura } from "./erro";
import { SEM_EQUIPE } from "@/lib/estrutura-tipos";
import type { ClienteDoPwa } from "./tipos";
import { bruto, exigirOk } from "./transporte.server";

const q = encodeURIComponent;

/*
 * O `acao` que o PWA grava na auditoria (AUDIT_COLABORADORES e ULT_ACAO) ao trocar a equipe de
 * alguém: texto livre, até 60 caracteres, que o servidor não valida. O da retirada vem da spec de
 * 04/11/2026; o de puxar é o mesmo da tela "Ajuste de equipe" do app (Eduardo, 10/11/2026).
 */
const ACAO_RETIRAR = "estrutura-nao-equipe";
const ACAO_PUXAR = "ajuste-puxar";

export const clienteDoPwa: ClienteDoPwa = {
  async minhasEquipes(token) {
    return lerMinhasEquipes(exigirOk(await bruto("GET", "/api/estrutura/minhas-equipes", token)));
  },

  async pessoas(token, equipe) {
    return lerPessoas(
      exigirOk(await bruto("GET", `/api/colaboradores?equipe=${q(equipe)}`, token)),
    );
  },

  async veiculos(token, equipe) {
    return lerVeiculos(
      exigirOk(await bruto("GET", `/api/frota/equipe?equipe=${q(equipe)}`, token)),
    );
  },

  async diasEnviados(token, equipe, de, ate) {
    return lerDiasEnviados(
      exigirOk(
        await bruto("GET", `/api/ticket-semana?equipe=${q(equipe)}&de=${de}&ate=${ate}`, token),
      ),
    );
  },

  async linhasDoDia(token, equipe, dia) {
    return lerLinhasDoDia(
      exigirOk(await bruto("GET", `/api/ticket-estrutura?equipe=${q(equipe)}&data=${dia}`, token)),
    );
  },

  async cobranca(token, equipe) {
    // O nome do líder vem de `minhas-equipes`; se faltar, o do organograma que as pessoas trazem.
    let lider = equipe.lider;
    if (!lider) {
      lider = liderDasPessoas(
        exigirOk(await bruto("GET", `/api/colaboradores?equipe=${q(equipe.equipe)}`, token)),
      );
    }
    if (!lider) {
      throw new ErroDaEstrutura(
        "indisponivel",
        "Sem o nome do líder no organograma não dá para ler a cobrança.",
      );
    }
    return lerCobranca(
      exigirOk(
        await bruto(
          "GET",
          `/api/equipe/apontamento-status?adm=1&equipe=${q(equipe.equipe)}&lider=${q(lider)}`,
          token,
        ),
      ),
    );
  },

  async enviar(token, entrada) {
    return lerRespostaDoEnvio(
      exigirOk(await bruto("POST", "/api/ticket", token, montarCorpoDoEnvio(entrada)), true),
    );
  },

  async todosOsColaboradores(token) {
    // Sem `supervisor`: vem todo mundo, e o alcance é aplicado aqui no CONECTA (como o app faz).
    return lerTodosOsColaboradores(
      exigirOk(await bruto("GET", "/api/colaboradores/todas-equipes", token)),
    );
  },

  async frotaDoProjeto(token, projeto) {
    return lerFrotaDoProjeto(
      exigirOk(await bruto("GET", `/api/frota?projeto=${q(projeto)}`, token)),
    );
  },

  async moverParaSemEquipe(token, id, ator) {
    // Para id negativo (PJ e estagiário) o PWA responde success e não faz nada: nem chamamos.
    if (id <= 0) return;
    exigirOk(
      await bruto("PUT", `/api/colaboradores/${id}/equipe`, token, {
        novaEquipe: SEM_EQUIPE,
        ator,
        acao: ACAO_RETIRAR,
      }),
      true,
    );
  },

  async moverVeiculoParaSemEquipe(token, id) {
    // Sem equipe, o veículo "sobe para o projeto" (Eduardo, 10/11/2026): é pelo projeto que a equipe
    // certa o acha de novo em `frota?projeto=`. Confirmar no 1º teste real.
    exigirOk(
      await bruto("PUT", `/api/frota/${id}/equipe`, token, {
        novaEquipe: SEM_EQUIPE,
        novoLider: "",
      }),
      true,
    );
  },

  async adicionarPessoa(token, id, equipe, ator) {
    // Mesma rota da retirada, com a equipe de destino. `novoLider` vazio: o gatilho do banco
    // preenche líder, supervisor e coordenador pela equipe. PJ e estagiário o PWA não move.
    if (id <= 0) {
      throw new ErroDaEstrutura("dado_recusado", "PJ e estagiário não entram na equipe por aqui.");
    }
    exigirOk(
      await bruto("PUT", `/api/colaboradores/${id}/equipe`, token, {
        novaEquipe: equipe,
        novoLider: "",
        ator,
        acao: ACAO_PUXAR,
      }),
      true,
    );
  },

  async adicionarVeiculo(token, id, equipe) {
    // Com uma equipe real, o PWA puxa líder, supervisor e coordenador do organograma. Sem `ator`
    // nem `acao`: a frota não grava quem mexeu.
    exigirOk(
      await bruto("PUT", `/api/frota/${id}/equipe`, token, { novaEquipe: equipe, novoLider: "" }),
      true,
    );
  },
};
