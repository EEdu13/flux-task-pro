// Server functions de autenticação. Este arquivo VAI para o bundle do cliente,
// então tudo que é servidor entra por import dinâmico dentro do handler —
// mesma convenção do resto do projeto.
import { createServerFn } from "@tanstack/react-start";
import { erroSenha } from "@/lib/politica-senha";
import type { IamSessao, IamUsuario } from "./types";

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Só dígitos. A IAM devolve telefone em formatos variados. */
const digitos = (v: unknown) => (typeof v === "string" ? v.replace(/\D+/g, "") : "");

/** Cargo, setor e chefia — vindos das tabelas de colaboradores, não da IAM. */
export interface PerfilFuncional {
  funcao: string;
  setorId: string;
  role: "gerente" | "supervisor" | "adm";
  supervisorNome: string | null;
  coordenadorNome: string | null;
}

export type LoginResposta =
  | ({ ok: true; perfil: PerfilFuncional | null } & IamSessao)
  | { ok: false; erro: string; motivo: "credenciais" | "inativo" | "indisponivel" | "inesperado" };

/** A tela de login precisa saber qual modo mostrar antes de desenhar. */
export const iamStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { iamHabilitado } = await import("./client.server");
  return { habilitado: iamHabilitado() };
});

export const iamLogin = createServerFn({ method: "POST" })
  .validator((input: { login: string; senha: string }) => {
    const login = texto(input?.login, 120);
    const senha = typeof input?.senha === "string" ? input.senha.slice(0, 200) : "";
    if (!login || !senha) throw new Error("Informe usuário e senha");
    return { login, senha };
  })
  .handler(async ({ data }): Promise<LoginResposta> => {
    const { iamLoginRequest, iamRegistrarAcesso } = await import("./client.server");
    const { definirSessao } = await import("./session.server");
    const { IamError } = await import("./types");

    try {
      const { token, usuario, senhaProvisoria } = await iamLoginRequest(data.login, data.senha);

      // O token fica só aqui: vai para o cookie httpOnly e não volta ao navegador.
      definirSessao(token);
      iamRegistrarAcesso(token);

      /* O registro local do Fluxo, separado do aviso à IAM logo acima.
         São coisas diferentes: `iamRegistrarAcesso` avisa a IAM que este
         sistema foi usado (contrato §1.5, dispara e esquece); isto aqui é o
         histórico que a PRÓPRIA PESSOA pode consultar em Configurações —
         quando entrou, de que dispositivo. É aguardado, não disparado e
         esquecido, porque marcar o dispositivo escreve um cookie, e cookie só
         se escreve enquanto a resposta ainda está sendo montada. */
      const { registrarAcesso } = await import("@/lib/acesso.server");
      await registrarAcesso(Number(usuario.id), true);

      // Cargo, setor e chefia não vêm da IAM — são das tabelas de colaboradores.
      // Falhar aqui não pode impedir o login: sem perfil, a pessoa entra mesmo assim.
      let perfil: PerfilFuncional | null = null;
      try {
        const col = await import("./colaborador.server");
        const dados = await col.buscarColaborador(usuario.cpf, usuario.nome);
        if (dados) {
          perfil = {
            funcao: dados.funcao ?? "",
            setorId: col.setorParaId(dados.setor),
            role: col.papelPelaHierarquia(dados.nome, await col.chefiaAlguem(dados.nome)),
            // Chefe direto já resolvido: nunca a própria pessoa. Ver chefeDireto().
            supervisorNome: col.chefeDireto(dados),
            coordenadorNome: dados.coordenador || null,
          };

          /* Guarda setor, papel e chefe no perfil do Fluxo.
             É o único ponto do sistema em que esses três são escritos, e ele
             está aqui de propósito: aqui existe a resposta da IAM e das tabelas
             de colaborador. Depois do login essa informação some, e quem
             precisar dela — `listarTarefas`, por exemplo — só teria o id
             numérico da sessão.

             Aceitar papel vindo do navegador refaria o buraco do item 1:
             qualquer pessoa se declararia gerente e leria as tarefas da empresa
             inteira. Por isso a gravação nasce daqui, e a função que grava não
             é uma rota. */
          try {
            const { registrarPerfilFuncional } = await import("@/lib/perfil.functions");
            await registrarPerfilFuncional(Number(usuario.id), {
              setorId: perfil.setorId,
              papel: perfil.role,
              supervisorNome: perfil.supervisorNome,
            });
          } catch (e) {
            // Mesma regra do bloco acima: não impedir o login. Sem estes
            // campos a pessoa cai na visibilidade mais restrita, que é segura.
            console.warn("[iam] perfil não gravou no Fluxo:", (e as Error)?.message);
          }
        }
      } catch (e) {
        console.warn("[iam] perfil funcional indisponível:", (e as Error)?.message);
      }

      return {
        ok: true,
        usuario,
        senhaProvisoria,
        precisaTelefone: digitos(usuario.telefone).length < 10,
        perfil,
      };
    } catch (e) {
      // Sem `usuario.id` aqui — a IAM recusou antes de dizer quem tentou.
      // `pessoa_id` fica nulo, e é exatamente para isso que a coluna aceita
      // nulo: "alguém tentou, não sei quem".
      const motivo = e instanceof IamError ? e.motivo : "inesperado";
      const { registrarAcesso } = await import("@/lib/acesso.server");
      await registrarAcesso(null, false, motivo);

      if (e instanceof IamError) return { ok: false, erro: e.message, motivo: e.motivo };
      return { ok: false, erro: "Não foi possível entrar.", motivo: "inesperado" };
    }
  });

export type OnboardingResposta = { ok: true } | { ok: false; erro: string };

export const iamOnboarding = createServerFn({ method: "POST" })
  .validator((input: { novaSenha: string; telefone: string; email?: string }) => {
    const novaSenha = typeof input?.novaSenha === "string" ? input.novaSenha : "";
    const telefone = digitos(input?.telefone);
    const email = texto(input?.email, 120);
    // O portão de verdade: a tela mostra os requisitos, mas quem chamar a
    // server function direto não passa pela tela.
    const problema = erroSenha(novaSenha);
    if (problema) throw new Error(problema);
    if (telefone.length < 10) throw new Error("Telefone inválido. Inclua DDD + número.");
    return { novaSenha, telefone, email };
  })
  .handler(async ({ data }): Promise<OnboardingResposta> => {
    const { iamOnboardingRequest } = await import("./client.server");
    const { lerSessao } = await import("./session.server");
    const { IamError } = await import("./types");

    const token = lerSessao();
    if (!token) return { ok: false, erro: "Sessão expirada. Entre novamente." };

    try {
      // O Agendador manda com DDI; seguimos igual para o WhatsApp casar.
      const telefone = data.telefone.startsWith("55") ? data.telefone : `55${data.telefone}`;
      await iamOnboardingRequest(token, {
        novaSenha: data.novaSenha,
        telefone,
        email: data.email,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof IamError) return { ok: false, erro: e.message };
      return { ok: false, erro: "Não foi possível concluir o primeiro acesso." };
    }
  });

export type MeResposta =
  | { autenticado: false }
  | {
      autenticado: true;
      usuarioId: number;
      papeis: string[];
      permissoes: string[];
      escopos: { tipo: string; valor: string }[];
      global: boolean;
      /** Idade do cache do /resolve em segundos — abre esta rota para depurar permissão. */
      cacheSegundos: number;
    };

/** Quem está logado + permissões. É daqui que o front monta menu e abas. */
export const iamMe = createServerFn({ method: "GET" }).handler(async (): Promise<MeResposta> => {
  const { iamResolve, iamCacheIdade, iamHabilitado } = await import("./client.server");
  const { lerSessao } = await import("./session.server");

  if (!iamHabilitado()) return { autenticado: false };
  const token = lerSessao();
  if (!token) return { autenticado: false };

  try {
    const idade = iamCacheIdade(token);
    const dados = await iamResolve(token);
    return {
      autenticado: true,
      usuarioId: dados.usuarioId,
      papeis: dados.papeis,
      permissoes: dados.permissoes,
      escopos: dados.escopos,
      global: dados.global,
      cacheSegundos: idade,
    };
  } catch {
    return { autenticado: false };
  }
});

export const iamLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { iamEsqueceToken } = await import("./client.server");
  const { lerSessao, limparSessao } = await import("./session.server");
  const token = lerSessao();
  if (token) iamEsqueceToken(token);
  limparSessao();
  return { ok: true };
});

export type { IamUsuario };
