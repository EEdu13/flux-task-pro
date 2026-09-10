#!/usr/bin/env node
/**
 * Dispara o resumo do dia no Telegram.
 *
 *   npm run telegram:diario              (da sua máquina, contra o APP_URL)
 *   npm run telegram:diario -- --forcar  (reenvia mesmo se já saiu hoje)
 *
 * É o start command do serviço de cron na Railway. Ele NÃO monta o resumo —
 * quem faz isso é o servidor, em `/api/public/telegram-diario`. Aqui só bate na
 * porta, porque o agendador precisa de um processo que comece, faça uma coisa e
 * TERMINE: é assim que a Railway sabe que a execução acabou.
 *
 * JavaScript puro, sem importar nada do src/, igual ao `telegram-webhook.mjs` e
 * pelo mesmo motivo: precisa rodar sem build, contra qualquer ambiente.
 *
 * O código de saída importa mais do que parece. Sair 0 quando o servidor
 * respondeu 401 faria o painel do cron mostrar verde para sempre enquanto
 * ninguém recebe resumo nenhum — a falha mais cara é a que se parece com
 * sucesso. Qualquer resposta fora do 2xx sai diferente de zero.
 */

const BASE = (process.env.APP_URL ?? "https://gestor-larsil.up.railway.app").replace(/\/+$/, "");
const CHAVE = process.env.ADMIN_API_KEY;

function sair(msg, codigo = 1) {
  console.error(`\n  ${msg}\n`);
  process.exit(codigo);
}

if (!CHAVE) {
  sair("ADMIN_API_KEY não encontrada. No cron da Railway, referencie a do serviço do app.");
}

const forcar = process.argv.includes("--forcar");
const url = `${BASE}/api/public/telegram-diario${forcar ? "?forcar=1" : ""}`;

/* Trinta segundos. O resumo percorre uma pessoa por vez e fala com o Telegram
   em cada uma, então demora mais que uma rota comum — mas um pedido que nunca
   responde seguraria o container do cron para sempre, e a Railway pularia a
   execução do dia seguinte por achar que esta ainda está rodando. */
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 30_000);

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "x-fluxo-admin-key": CHAVE },
    signal: ctrl.signal,
  });
} catch (e) {
  // A URL não carrega segredo, então pode aparecer no erro.
  sair(`Não foi possível falar com ${BASE}: ${e.name === "AbortError" ? "tempo esgotado" : e.message}`);
} finally {
  clearTimeout(timer);
}

const corpo = await res.json().catch(() => ({}));

if (!res.ok) {
  const dica =
    res.status === 401
      ? " (a ADMIN_API_KEY daqui não é a mesma do servidor)"
      : res.status === 404
        ? " (a rota não existe nesse ambiente — falta deploy?)"
        : "";
  sair(`O servidor respondeu ${res.status}${dica}: ${corpo.erro ?? ""}`);
}

if (corpo.jaEnviadoHoje) {
  console.log(`\n  Resumo de ${corpo.dia} já havia saído. Use --forcar para reenviar.\n`);
  process.exit(0);
}

console.log(`\n  Resumo de ${corpo.dia} disparado.`);
console.log(`  Enviados     ${corpo.enviados}`);
console.log(`  Sem tarefa   ${corpo.pulados} (não recebem nada, de propósito)`);
console.log(`  Falhas       ${corpo.falhas}\n`);

/* Falha em UMA pessoa não derruba o resumo das outras, então isto não é erro de
   execução — mas também não pode passar despercebido. Sai 0 e deixa o número no
   log, que é onde ele se acumula visível se virar rotina. */
process.exit(0);
