/**
 * Junta as frases de uma pessoa num bloco de áudio só (19/10/2026).
 *
 * A transcrição frase a frase errava por falta de contexto: o modelo ouvia
 * três segundos soltos e às vezes "completava" com o que ninguém disse. Num
 * bloco de ~40 s de fala da mesma pessoa ele ouve o raciocínio inteiro.
 *
 * O silêncio fica de fora de propósito — é no silêncio que esses modelos mais
 * inventam. Cada frase já vem cortada nas pausas (`segmentador-de-fala.ts`);
 * aqui elas são emendadas com um respiro curto entre uma e outra.
 *
 * Sai em WAV 16 kHz mono: é o que a transcrição lê melhor, e emendar áudio
 * comprimido (cada frase é um WebM com cabeçalho próprio) não dá sem
 * decodificar. ~32 KB por segundo de fala.
 */

const TAXA = 16_000;
const RESPIRO_S = 0.3;

async function decodificar(trecho: Blob): Promise<Float32Array | null> {
  try {
    // O contexto offline a 16 kHz já devolve o áudio reamostrado.
    const ctx = new OfflineAudioContext(1, 1, TAXA);
    const buf = await ctx.decodeAudioData(await trecho.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const canal = buf.getChannelData(c);
      for (let i = 0; i < buf.length; i++) mono[i]! += canal[i]! / buf.numberOfChannels;
    }
    return mono;
  } catch (e) {
    // Uma frase que não decodifica não derruba o bloco; só ela fica de fora.
    console.warn("[ata] frase não decodificou:", (e as Error)?.message);
    return null;
  }
}

function emWav(amostras: Float32Array): Blob {
  const dados = new DataView(new ArrayBuffer(44 + amostras.length * 2));
  const texto = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) dados.setUint8(pos + i, s.charCodeAt(i));
  };
  texto(0, "RIFF");
  dados.setUint32(4, 36 + amostras.length * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  dados.setUint32(16, 16, true);
  dados.setUint16(20, 1, true); // PCM
  dados.setUint16(22, 1, true); // mono
  dados.setUint32(24, TAXA, true);
  dados.setUint32(28, TAXA * 2, true);
  dados.setUint16(32, 2, true);
  dados.setUint16(34, 16, true);
  texto(36, "data");
  dados.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) {
    const v = Math.max(-1, Math.min(1, amostras[i]!));
    dados.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([dados.buffer], { type: "audio/wav" });
}

/** As frases, na ordem, num WAV só. null quando nenhuma decodificou. */
export async function juntarEmWav(trechos: Blob[]): Promise<Blob | null> {
  const partes = (await Promise.all(trechos.map(decodificar))).filter(
    (p): p is Float32Array => !!p && p.length > 0,
  );
  if (!partes.length) return null;
  const respiro = Math.round(TAXA * RESPIRO_S);
  const total = partes.reduce((s, p) => s + p.length, 0) + respiro * (partes.length - 1);
  const tudo = new Float32Array(total);
  let pos = 0;
  partes.forEach((p, i) => {
    tudo.set(p, pos);
    pos += p.length + (i < partes.length - 1 ? respiro : 0);
  });
  return emWav(tudo);
}
