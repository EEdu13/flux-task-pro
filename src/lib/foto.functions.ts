import { createServerFn } from "@tanstack/react-start";
import {
  comSessao,
  comSessaoSemEntrada,
  semIdentidade,
} from "@/integrations/iam/funcao-com-sessao";

/* Foto de perfil escolhida no próprio app (Configurações → Perfil).
 *
 * Até aqui o rosto vinha só da IAM, e quem quisesse trocar não tinha onde.
 * Agora a pessoa sobe uma foto: ela vai para o Blob (`fotos/<id>-<quando>.jpg`)
 * e o endereço fica em `gestor.preferencias`, chave "foto". A rota
 * `/api/public/foto/$nome` olha essa chave antes de ir à IAM; sem ela, nada
 * muda. Remover devolve a foto da IAM.
 *
 * A chave "foto" fica FORA da lista de `salvarPreferencia` de propósito: só
 * estas funções a escrevem, e só com um endereço do nosso contêiner — ninguém
 * aponta o próprio rosto para um endereço qualquer.
 */

/** Teto do arquivo que chega. A foto de celular cru passa de 5 MB fácil. */
const MAX_BYTES = 12 * 1024 * 1024;
/** Lado do quadrado guardado: folga para a foto grande do perfil. */
const LADO = 512;

async function nomeE_FotoAtual(eu: number): Promise<{ nome: string | null; url: string | null }> {
  const { getPool, sql } = await import("@/integrations/db.server");
  const pool = await getPool();
  const r = await pool
    .request()
    .input("eu", sql.Int, eu)
    .query(
      `SELECT (SELECT nome FROM gestor.perfis WHERE pessoa_id=@eu) AS nome,
              (SELECT valor FROM gestor.preferencias WHERE pessoa_id=@eu AND chave=N'foto') AS url`,
    );
  const l = r.recordset[0] as { nome: string | null; url: string | null };
  return { nome: l?.nome ?? null, url: l?.url ?? null };
}

export const trocarMinhaFoto = createServerFn({ method: "POST" })
  .validator(
    semIdentidade((entrada: { conteudo: string }) => {
      const conteudo = typeof entrada?.conteudo === "string" ? entrada.conteudo : "";
      if (!conteudo) throw new Error("Escolha uma foto.");
      return { conteudo };
    }),
  )
  .handler(
    comSessao(async (eu, dados: { conteudo: string }) => {
      const virgula = dados.conteudo.indexOf(",");
      const base64 = dados.conteudo.startsWith("data:")
        ? dados.conteudo.slice(virgula + 1)
        : dados.conteudo;
      const bruto = Buffer.from(base64, "base64");
      if (!bruto.byteLength) throw new Error("Foto vazia.");
      if (bruto.byteLength > MAX_BYTES) throw new Error("Foto muito grande. O limite é 12 MB.");

      /* Recodificar no servidor, e não confiar no que chegou: garante que é
         imagem de verdade (um arquivo qualquer renomeado falha aqui), tira os
         metadados (EXIF tem GPS de foto de celular) e acerta a orientação. */
      let jpeg: Buffer;
      try {
        const sharp = (await import("sharp")).default;
        jpeg = await sharp(bruto)
          .rotate()
          .resize(LADO, LADO, { fit: "cover", position: "centre" })
          .jpeg({ quality: 86 })
          .toBuffer();
      } catch {
        throw new Error("Não consegui ler essa imagem. Use JPG ou PNG.");
      }

      const { nome, url: antiga } = await nomeE_FotoAtual(eu);
      const corpo = new ArrayBuffer(jpeg.byteLength);
      new Uint8Array(corpo).set(jpeg);
      // Nome novo a cada troca: nenhum cache no caminho devolve a foto velha.
      const { enviarParaOBlob, apagarDoBlob } = await import("@/integrations/blob.server");
      const url = await enviarParaOBlob(`fotos/${eu}-${Date.now()}.jpg`, corpo, "image/jpeg");

      const { getPool, sql } = await import("@/integrations/db.server");
      const pool = await getPool();
      await pool
        .request()
        .input("eu", sql.Int, eu)
        .input("url", sql.NVarChar, url)
        .query(
          `IF EXISTS (SELECT 1 FROM gestor.preferencias WHERE pessoa_id=@eu AND chave=N'foto')
             UPDATE gestor.preferencias SET valor=@url, atualizada_em=SYSDATETIMEOFFSET()
              WHERE pessoa_id=@eu AND chave=N'foto';
           ELSE
             INSERT INTO gestor.preferencias (pessoa_id, chave, valor) VALUES (@eu, N'foto', @url);`,
        );

      // A antiga só sai depois da nova estar no lugar.
      if (antiga) await apagarDoBlob(antiga);
      if (nome) {
        const { esquecerFoto } = await import("@/integrations/foto-cache.server");
        esquecerFoto(nome);
      }
      return { ok: true };
    }),
  );

export const removerMinhaFoto = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu) => {
    const { nome, url } = await nomeE_FotoAtual(eu);
    if (!url) return { ok: true };
    const { getPool, sql } = await import("@/integrations/db.server");
    const pool = await getPool();
    await pool
      .request()
      .input("eu", sql.Int, eu)
      .query(`DELETE FROM gestor.preferencias WHERE pessoa_id=@eu AND chave=N'foto'`);
    const { apagarDoBlob } = await import("@/integrations/blob.server");
    await apagarDoBlob(url);
    if (nome) {
      const { esquecerFoto } = await import("@/integrations/foto-cache.server");
      esquecerFoto(nome);
    }
    return { ok: true };
  }),
);

/** Se tenho foto própria (para a tela mostrar "Voltar à foto da IAM"). */
export const tenhoFotoPropria = createServerFn({ method: "POST" }).handler(
  comSessaoSemEntrada(async (eu) => ({ tem: !!(await nomeE_FotoAtual(eu)).url })),
);
