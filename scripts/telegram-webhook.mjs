#!/usr/bin/env node
/**
 * Registra e inspeciona o webhook do bot no Telegram.
 *
 *   npm run telegram:webhook -- me
 *   npm run telegram:webhook -- info
 *   npm run telegram:webhook -- set https://seu-app.up.railway.app/api/public/telegram-webhook
 *   npm run telegram:webhook -- set <url> --descartar-pendentes
 *   npm run telegram:webhook -- delete
 *
 * É JavaScript puro e não importa nada do src/ de propósito: precisa rodar sem
 * build, contra qualquer ambiente, inclusive de uma máquina que não é a que
 * hospeda o app. A duplicação com client.server.ts é pequena e consciente.
 *
 * O token e o segredo NUNCA são impressos. A URL da API carrega o token, então
 * ela também não aparece em erro nenhum.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SEGREDO = process.env.TELEGRAM_WEBHOOK_SECRET;

const ATUALIZACOES_ACEITAS = ["message", "callback_query"];

function sair(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!TOKEN) sair("TELEGRAM_BOT_TOKEN não encontrado. Rode via `npm run telegram:webhook`.");

async function chamar(metodo, corpo) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) {
    sair(`${metodo} falhou: ${json.description ?? res.status}`);
  }
  return json.result;
}

function quando(epoch) {
  return epoch ? new Date(epoch * 1000).toLocaleString("pt-BR") : "—";
}

async function comandoMe() {
  const bot = await chamar("getMe");
  console.log(`\n  Bot        @${bot.username}`);
  console.log(`  Nome       ${bot.first_name}`);
  console.log(`  Id         ${bot.id}`);
  console.log(`  Em grupos  ${bot.can_join_groups ? "permitido" : "bloqueado"}\n`);
}

async function comandoInfo() {
  const w = await chamar("getWebhookInfo");
  console.log(`\n  URL          ${w.url || "(nenhum webhook registrado)"}`);
  console.log(`  Pendentes    ${w.pending_update_count ?? 0}`);
  console.log(`  Assinaturas  ${(w.allowed_updates ?? ["(todas)"]).join(", ")}`);
  if (w.ip_address) console.log(`  IP resolvido ${w.ip_address}`);
  if (w.last_error_message) {
    console.log(`\n  Último erro  ${quando(w.last_error_date)}`);
    console.log(`               ${w.last_error_message}`);
  } else if (w.url) {
    console.log(`  Último erro  nenhum`);
  }
  console.log();
}

async function comandoSet(url, descartarPendentes) {
  if (!SEGREDO) sair("TELEGRAM_WEBHOOK_SECRET não encontrado — o webhook recusaria o Telegram.");
  if (!url) sair("Informe a URL. Ex.: set https://app.exemplo.com/api/public/telegram-webhook");
  if (!url.startsWith("https://")) sair("O Telegram só entrega em HTTPS.");

  await chamar("setWebhook", {
    url,
    secret_token: SEGREDO,
    allowed_updates: ATUALIZACOES_ACEITAS,
    drop_pending_updates: descartarPendentes,
  });

  console.log(`\n  Webhook registrado.`);
  console.log(`  URL          ${url}`);
  console.log(`  Segredo      enviado (${SEGREDO.length} caracteres)`);
  console.log(`  Assinaturas  ${ATUALIZACOES_ACEITAS.join(", ")}`);
  if (descartarPendentes) console.log(`  Pendentes    descartados`);
  console.log(`\n  Confira com: npm run telegram:webhook -- info\n`);
}

async function comandoDelete(descartarPendentes) {
  await chamar("deleteWebhook", { drop_pending_updates: descartarPendentes });
  console.log(`\n  Webhook removido. O bot para de receber até um novo set.\n`);
}

const [, , comando, ...resto] = process.argv;
const descartar = resto.includes("--descartar-pendentes");
const posicional = resto.find((a) => !a.startsWith("--"));

switch (comando) {
  case "me":
    await comandoMe();
    break;
  case "info":
    await comandoInfo();
    break;
  case "set":
    await comandoSet(posicional, descartar);
    break;
  case "delete":
    await comandoDelete(descartar);
    break;
  default:
    console.log(`
  Uso: npm run telegram:webhook -- <comando>

    me                     confirma que o token vale e mostra o @ do bot
    info                   estado atual do webhook e último erro de entrega
    set <url>              registra o webhook com o segredo do .env
    delete                 remove o registro

  Opção:
    --descartar-pendentes  joga fora a fila acumulada (vale em set e delete)
`);
    process.exit(comando ? 1 : 0);
}
