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
/* Teto do que aceitamos baixar da IAM antes de reduzir.
 *
 * Era 3 MB, e isso derrubava foto de gente real: a origem devolve o arquivo
 * cru do celular, e 4 MB num retrato recente é rotina. Acima do teto a imagem
 * era descartada e o 404 ficava GUARDADO por 6h — então a pessoa
 * simplesmente não tinha rosto no sistema, sem nada indicando por quê.
 *
 * Subir custa pouco: o arquivo grande é transitório, existe só entre o
 * download e o `Jimp`. O que fica no cache é sempre a miniatura de 192px,
 * na casa dos 15 KB. */
const TETO_BYTES = 12 * 1024 * 1024;
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

/**
 * Reduz a foto a um quadrado de 192px.
 *
 * Usa `sharp` (libvips, código nativo) e não mais o Jimp, por um motivo que
 * não é velocidade — embora ele também seja ~35x mais rápido aqui.
 *
 * O Jimp é JavaScript puro, e o Node tem UMA thread. Medido com a foto real de
 * 1,7 MB: 1400ms de processamento durante os quais um relógio de 10ms não
 * bateu NENHUMA vez — ou seja, 1,4 segundo em que o servidor não atendeu mais
 * nada. Como este app é sondado ~200 vezes por minuto POR PESSOA (chamadas,
 * chat, presença, cutucada), abrir uma tela com vários rostos frios enfileirava
 * segundos de silêncio para todo mundo ao mesmo tempo. Era isso que fazia o
 * sistema "ficar lerdo de uma hora para outra": as fotos esfriam a cada 6h.
 *
 * O `sharp` faz o trabalho fora da thread do JavaScript: mesma medição, 40ms e
 * o relógio batendo normalmente.
 *
 * O `.rotate()` sem argumento não gira nada por conta própria — ele aplica a
 * orientação que a câmera gravou no EXIF. Sem isso, foto tirada de lado chega
 * deitada.
 */
async function miniatura(bruto: Buffer): Promise<{ buf: Buffer; tipo: string } | null> {
  try {
    const sharp = (await import("sharp")).default;
    const buf = await sharp(bruto)
      .rotate()
      // `cover` + `centre` é o mesmo enquadramento de antes: recorta o quadrado
      // central e reduz. Encolher o retrato inteiro deixaria a pessoa minúscula.
      .resize(LADO, LADO, { fit: "cover", position: "centre" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buf, tipo: "image/jpeg" };
  } catch {
    /* Reserva em Jimp.
     *
     * O `sharp` traz binário nativo, e binário nativo é a peça que falha em
     * ambiente novo. Se ele não carregar na Railway, isto mantém os rostos
     * aparecendo — devagar, travando a thread como antes, mas aparecendo. É
     * preferível a uma tela de contatos sem ninguém. */
    try {
      const { Jimp } = await import("jimp");
      const img = await Jimp.read(bruto);
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
