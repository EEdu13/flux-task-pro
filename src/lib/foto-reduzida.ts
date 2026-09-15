/**
 * Reduz uma foto antes de subir.
 *
 * A foto do projeto aparece como miniatura de 16px nos cartões e no máximo
 * 240px ampliada. Uma foto de celular tem 4000px e 3-5 MB: subir o original
 * faria cada cartão do quadro baixar megabytes para desenhar um círculo, e
 * esbarraria no limite de 5 MB do anexo. 640px em JPEG cobre a ampliação com
 * folga em tela de alta densidade e fica na casa dos 60-120 KB.
 */
export async function reduzirFoto(
  arquivo: File,
  lado = 640,
): Promise<{ name: string; type: string; dataUrl: string }> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");

  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("Não foi possível ler a imagem."));
      i.src = url;
    });
    const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Não foi possível preparar a imagem.");
    // Fundo branco: PNG com transparência viraria preto no JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const base = arquivo.name.replace(/\.[^.]+$/, "") || "foto";
    return { name: `${base}.jpg`, type: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", 0.86) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
