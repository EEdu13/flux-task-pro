/*
 * som.ts — o "plim" de quando OUTRA pessoa entra na fila de mãos.
 *
 * Por que oscilador e não arquivo: é um sinal curto e discreto (não pode competir com a voz de
 * quem está falando), não precisa baixar nada e não falha por formato. O AudioContext vem de
 * fora (o integrador cria no clique de "Entrar"), porque só um contexto nascido de gesto do
 * usuário toca sem ser bloqueado pela política de autoplay.
 */
export function tocarPlim(ctx: AudioContext): void {
  try {
    if (ctx.state === "closed") return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const agora = ctx.currentTime;
    const saida = ctx.createGain();
    saida.gain.value = 0.18;
    saida.connect(ctx.destination);
    // Duas notas (mi6 → si6) com envelope de sino: ataque de 8 ms e queda exponencial.
    const nota = (freq: number, inicio: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, inicio);
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.exponentialRampToValueAtTime(1, inicio + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
      o.connect(g).connect(saida);
      o.start(inicio);
      o.stop(inicio + dur + 0.02);
    };
    nota(1318.5, agora, 0.22);
    nota(1975.5, agora + 0.09, 0.32);
    setTimeout(() => saida.disconnect(), 600);
  } catch (e) {
    // Som é enfeite: se o contexto estiver em estado estranho, a fila continua funcionando.
    console.warn("[rv-gesto] plim falhou:", e);
  }
}
