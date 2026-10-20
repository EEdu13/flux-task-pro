import { op } from "@/lib/avatar-op";

/*
 * Rosto: expressões, detalhes, barbas e óculos — opções novas do catálogo do avatar (16/10/2026: "crie pelo menos
 * mais 10 de cada, bem criativo, baseado em Roblox").
 *
 * Cada parte do avatar tem o SEU arquivo de catálogo, para mais de uma pessoa
 * (ou agente) poder ampliar o provador ao mesmo tempo sem pisar no outro.
 * `avatar-3d.ts` junta estas listas no fim das originais. Regra de ouro: os
 * valores ficam gravados nos avatares das pessoas — NUNCA renomear nem tirar
 * um valor daqui, só acrescentar no fim. `op<never>()` = lista ainda vazia.
 */

export const EXTRAS_EXPRESSAO = op(
  // Clássicos do Roblox (16/10/2026) — desenhados em rv/rosto-extras.ts.
  ["relaxado", "De boa (Chill)"],
  ["superFeliz", "Super super feliz"],
  ["orgulhoso", "Cheio de orgulho"],
  ["confere", "Confere aí (Check It)"],
  ["hesitante", "Hmm… (Err)"],
  ["bobo", "Bobeira"],
  ["convencido", "Convencido (Smug)"],
  ["dentesBrilhando", "Dentes brilhando"],
  ["chorandoDeRir", "Chorando de rir"],
  ["olhosBrilhando", "Olhos de anime"],
  ["determinado", "Determinado"],
  ["nervoso", "Nervoso"],
  ["uwu", "UwU"],
  ["pixel", "8-bit"],
  ["nocaute", "Nocauteado"],
  // Glam femininos do lote 2 (16/10/2026) — desenhados em rv/rosto-glam.ts.
  ["glamCilios", "Glam cílios poderosos"],
  ["glamRisonha", "Glam risonha"],
  ["glamBeijo", "Glam mandando beijo"],
  ["glamDiva", "Glam diva"],
  ["glamBrilho", "Glam olhar brilhante"],
);

export const EXTRAS_DETALHE = op(
  // Adesivos de rosto (16/10/2026) — desenhados em rv/rosto-extras.ts.
  ["sardasNariz", "Sardas no nariz"],
  ["sardasBlush", "Sardas e blush"],
  ["bochechaCoracao", "Bochechas de coração"],
  ["coradoAnime", "Corado de anime"],
  ["estrelinhas", "Adesivos de estrela"],
  ["brilhinhos", "Brilhinhos"],
  ["glitter", "Glitter"],
  ["curativo", "Curativo"],
  ["cicatriz", "Cicatriz"],
  ["lagrima", "Lagrimazinha"],
  ["pintasCharme", "Pintinhas charmosas"],
  ["pinturaBrasil", "Pintura do Brasil"],
  ["pinturaTigre", "Pintura de tigre"],
  ["pinturaGuerra", "Pintura de guerra"],
);

export const EXTRAS_BARBA = op(
  // Barbas novas (16/10/2026) — desenhadas no adesivo, em rv/rosto-extras.ts.
  ["porFazer", "Por fazer"],
  ["degrade", "Degradê"],
  ["contorno", "Contorno do queixo"],
  ["suicas", "Suíças"],
  ["lapis", "Bigode fininho"],
  ["guidao", "Bigode guidão"],
  ["ferradura", "Bigode ferradura"],
  ["mosca", "Mosquinha"],
  ["cavanhaqueBode", "Cavanhaque de bode"],
  ["ancora", "Âncora"],
  ["trancada", "Trançada"],
  ["volumosa", "Volumosa"],
  ["viking", "Viking"],
);

export const EXTRAS_OCULOS = op(
  // Óculos novos (16/10/2026) — desenhados em rv/rosto-extras.ts.
  ["redondoDourado", "Redondo dourado"],
  ["nerd", "Nerd aro grosso"],
  ["gatinho", "Gatinho"],
  ["coracao", "Coração"],
  ["estrela", "Estrela"],
  ["espelhado", "Aviador espelhado"],
  ["esportivo", "Esportivo"],
  ["tresD", "3D"],
  ["pixel", "Pixel (deal with it)"],
  ["monoculo", "Monóculo"],
  ["viseira", "Viseira futurista"],
  ["protecao", "Óculos de proteção (EPI)"],
);

/** Rostos femininos novos (glam maquiados do lote 2, 16/10/2026). */
export const EXPRESSOES_FEMININAS_EXTRAS: ReadonlySet<string> = new Set<string>([
  "glamCilios",
  "glamRisonha",
  "glamBeijo",
  "glamDiva",
  "glamBrilho",
]);
