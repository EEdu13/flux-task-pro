import { createFileRoute } from "@tanstack/react-router";

/**
 * Foto de perfil servida pelo NOSSO domínio, já reduzida.
 *
 * Por que existe, em vez de apontar o <img> direto para a IAM:
 *  - a origem devolve a foto crua do celular (2448x3264, ~1,6 MB). Mandar o
 *    navegador encolher isso para 64px é uma redução de 50x num passo só, e o
 *    resultado sai com blocos. Reamostrar aqui, uma vez, sai nítido;
 *  - 1,6 MB por rosto inviabiliza qualquer tela com vários (contatos, chat);
 *  - a ida à IAM (Railway, EUA) acontece uma vez por pessoa a cada 6h, não a
 *    cada carregamento de tela.
 *
 * Público de propósito: a tela de login precisa da foto ANTES de autenticar,
 * e o endpoint de origem também é público.
 */

const LADO = 192;
const TTL_MS = 6 * 3600 * 1000;
const TETO_BYTES = 3 * 1024 * 1024;
const MAX_ENTRADAS = 400;

type Entrada = { at: number; buf: Buffer | null; tipo: string };
const cache = new Map<string, Entrada>();

function guardar(nome: string, buf: Buffer | null, tipo: string) {
  // Guarda também a ausência: sem isso, cada rosto sem foto viraria uma ida à
  // IAM a cada render.
  if (cache.size > MAX_ENTRADAS) cache.clear();
  cache.set(nome, { at: Date.now(), buf, tipo });
}

function resposta(buf: Buffer, tipo: string): Response {
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": tipo,
      // Privado: é o rosto de uma pessoa, não deve ficar em cache compartilhado.
      "cache-control": "private, max-age=86400",
    },
  });
}

async function miniatura(bruto: Buffer): Promise<{ buf: Buffer; tipo: string } | null> {
  try {
    const { Jimp } = await import("jimp");
    const img = await Jimp.read(bruto);
    // Recorte quadrado central antes de reduzir — o avatar é quadrado, e
    // encolher o retrato inteiro deixaria a pessoa minúscula no meio.
    const lado = Math.min(img.bitmap.width, img.bitmap.height);
    img.crop({
      x: Math.round((img.bitmap.width - lado) / 2),
      y: Math.round((img.bitmap.height - lado) / 2),
      w: lado,
      h: lado,
    });
    img.resize({ w: LADO, h: LADO });
    const buf = await img.getBuffer("image/jpeg", { quality: 82 });
    return { buf: Buffer.from(buf), tipo: "image/jpeg" };
  } catch {
    // Formato inesperado: melhor a foto grande que foto nenhuma.
    return null;
  }
}

export const Route = createFileRoute("/api/public/foto/$nome")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caminho = new URL(request.url).pathname;
        const cru = caminho.split("/api/public/foto/")[1] ?? "";
        const nome = decodeURIComponent(cru).trim().slice(0, 120);
        if (!nome) return new Response("", { status: 404 });

        const hit = cache.get(nome);
        if (hit && Date.now() - hit.at < TTL_MS) {
          return hit.buf ? resposta(hit.buf, hit.tipo) : new Response("", { status: 404 });
        }

        const base = (process.env.IAM_URL ?? "").replace(/\/$/, "");
        if (!base) return new Response("", { status: 404 });

        let bruto: Buffer | null = null;
        let tipo = "image/jpeg";
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12_000);
          const r = await fetch(`${base}/api/foto/${encodeURIComponent(nome)}`, {
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (r.ok) {
            const ab = await r.arrayBuffer();
            if (ab.byteLength <= TETO_BYTES) {
              bruto = Buffer.from(ab);
              tipo = r.headers.get("content-type") ?? tipo;
            }
          }
        } catch {
          // Sem foto é situação normal, não erro.
        }

        if (!bruto) {
          guardar(nome, null, tipo);
          return new Response("", { status: 404 });
        }

        const pequena = await miniatura(bruto);
        const final = pequena?.buf ?? bruto;
        const finalTipo = pequena?.tipo ?? tipo;
        guardar(nome, final, finalTipo);
        return resposta(final, finalTipo);
      },
    },
  },
});
