import honkMp3 from "@/assets/honk.mp3";
import nudgeMp3 from "@/assets/nudge.mp3";
import mensagemMp3 from "@/assets/stardew-fishing.mp3";

/* Os sons do app.
 *
 * Eram sintetizados com Web Audio, nota por nota, espalhados pelos componentes
 * que os tocavam. Agora são arquivos — mas o sintetizado continua aqui como
 * RESERVA, e não por apego: os dois caminhos esbarram na mesma política de
 * autoplay do navegador, e o arquivo tem falhas próprias que o oscilador não
 * tem (não baixou, formato recusado, decodificação falhou). Quando o arquivo
 * não vai, um bipe ainda é melhor que silêncio — porque o silêncio, aqui, é
 * indistinguível de "ninguém te chamou".
 *
 * O detalhe que manda nisso: este som toca na tela de QUEM RECEBE, que por
 * definição não clicou em nada. É o caso clássico que o navegador bloqueia.
 */

let audioCtx: AudioContext | null = null;
function contexto(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** O nudge do MSN, sintetizado: duas batidas e um chirp subindo. */
function nudgeSintetizado(): void {
  const ctx = contexto();
  if (!ctx) return;
  const now = ctx.currentTime;
  const batida = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.14);
  };
  batida(now);
  batida(now + 0.16);
  const chirp = ctx.createOscillator();
  const cg = ctx.createGain();
  chirp.type = "triangle";
  chirp.frequency.setValueAtTime(660, now + 0.34);
  chirp.frequency.exponentialRampToValueAtTime(1320, now + 0.55);
  cg.gain.setValueAtTime(0.0001, now + 0.34);
  cg.gain.exponentialRampToValueAtTime(0.25, now + 0.36);
  cg.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  chirp.connect(cg).connect(ctx.destination);
  chirp.start(now + 0.34);
  chirp.stop(now + 0.62);
}

/** Dois toques curtos subindo — reserva do som de mensagem. */
function mensagemSintetizada(): void {
  const ctx = contexto();
  if (!ctx) return;
  const now = ctx.currentTime;
  const nota = (t: number, hz: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(hz, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  };
  nota(now, 880);
  nota(now + 0.12, 1175);
}

/**
 * A sineta: um "ding" curto, duas harmônicas.
 *
 * Sintetizado e não arquivo, ao contrário dos outros dois, porque ainda não há
 * um mp3 escolhido para ele — trocar depois é substituir esta função por um
 * `preparar(...)` como os de cima, sem tocar em quem chama.
 *
 * Precisa soar DIFERENTE do som de mensagem, que é o vizinho mais próximo: o do
 * chat sobe (880 → 1175) e este desce, com a fundamental sustentada e a quinta
 * acima decaindo antes. Dois avisos que soam parecidos viram um só na cabeça de
 * quem escuta, e aí a pessoa abre o chat quando era uma tarefa.
 */
function notificacaoSintetizada(): void {
  const ctx = contexto();
  if (!ctx) return;
  const now = ctx.currentTime;
  const parcial = (hz: number, ganho: number, duracao: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(hz, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(ganho, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duracao);
    o.connect(g).connect(ctx.destination);
    o.start(now);
    o.stop(now + duracao + 0.02);
  };
  // Fundamental longa + quinta acima curta: é o que dá o timbre de sino sem
  // precisar de amostra. A quinta some primeiro e deixa a fundamental morrendo.
  parcial(988, 0.2, 0.6);
  parcial(1480, 0.09, 0.22);
}

/* Um elemento por som, reaproveitado.
   Criar um `Audio` novo a cada toque deixaria o navegador rebaixando o arquivo
   toda vez e acumularia elementos soltos. Reaproveitar exige voltar o
   `currentTime` para zero, senão o segundo toque seguido não sai — o áudio já
   está no fim e `play()` num áudio terminado não reinicia sozinho. */
function preparar(src: string, volume: number): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const a = new Audio(src);
  a.preload = "auto";
  a.volume = volume;
  return a;
}

let elNudge: HTMLAudioElement | null = null;
let elMensagem: HTMLAudioElement | null = null;
let elBuzina: HTMLAudioElement | null = null;

function tocar(el: HTMLAudioElement | null, reserva: () => void): void {
  if (!el) {
    reserva();
    return;
  }
  try {
    el.currentTime = 0;
  } catch {
    /* alguns navegadores recusam antes de ter metadados; play() ainda funciona */
  }
  const p = el.play();
  // `play()` devolve promessa em todos os navegadores atuais, mas a checagem
  // protege contra as implementações antigas que devolvem `undefined`.
  if (p && typeof p.catch === "function") p.catch(() => reserva());
}

/** Som de "chamar a atenção" (o trator). */
export function tocarNudge(): void {
  elNudge ??= preparar(nudgeMp3, 0.7);
  tocar(elNudge, nudgeSintetizado);
}

/** Som de mensagem nova no chat. */
export function tocarMensagemNova(): void {
  elMensagem ??= preparar(mensagemMp3, 0.5);
  tocar(elMensagem, mensagemSintetizada);
}

/**
 * Buzina do trator — uma vez, na hora em que ele entra na tela.
 *
 * Único som daqui SEM reserva sintetizada, e não por esquecimento: os outros
 * avisam coisas que só existem no áudio, então silêncio ali é indistinguível de
 * "ninguém te chamou". A buzina acompanha um trator de 100px atravessando a
 * tela com uma faixa — a mensagem chega inteira sem ela. Falhando o arquivo,
 * silêncio é a degradação certa; um bipe de oscilador no lugar de uma buzina
 * soaria como erro do sistema, não como o trator.
 */
export function tocarBuzina(): void {
  elBuzina ??= preparar(honkMp3, 0.6);
  tocar(elBuzina, () => {});
}

/**
 * Som da sineta (tarefa atribuída, menção, prazo, conclusão).
 *
 * Para trocar por um arquivo: ponha o mp3 em `src/assets`, importe no topo como
 * os outros e chame `tocar(elNotificacao, notificacaoSintetizada)` — o
 * sintetizado vira reserva, igual aos dois de cima.
 */
export function tocarNotificacao(): void {
  notificacaoSintetizada();
}
