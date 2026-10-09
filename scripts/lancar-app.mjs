/*
 * Lança uma versão nova do app de mesa (Tauri) para TODO MUNDO, sem instalar
 * máquina por máquina (pedido do usuário, 09/10/2026).
 *
 *   node --env-file=.env.local scripts/lancar-app.mjs              gera e publica
 *   node --env-file=.env.local scripts/lancar-app.mjs --sem-build  só publica o que já está em target/
 *   node --env-file=.env.local scripts/lancar-app.mjs --notas "o que mudou"
 *
 * Antes: subir a versão em src-tauri/tauri.conf.json E src-tauri/Cargo.toml.
 *
 * O que acontece:
 *   1. `tauri build` com a chave de assinatura (~/.tauri/conecta-updater.key —
 *      fica SÓ nesta máquina; sem ela não se publica atualização nenhuma);
 *   2. o instalador (.exe) sobe para o Blob em app/conecta_<versão>_x64-setup.exe;
 *   3. o app/latest.json do Blob passa a apontar para ele, com a assinatura.
 * Os apps instalados (0.2.2 em diante) conferem /api/public/app/latest na
 * abertura e a cada 4 h, e se atualizam sozinhos.
 *
 * Rode a partir de uma cópia limpa do repositório (git worktree): o
 * `tauri build` roda o build do site antes, e código em obras quebra o build.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PUBLICO = "https://gestor-larsil.up.railway.app";
const args = process.argv.slice(2);
const semBuild = args.includes("--sem-build");
const notas = args.includes("--notas") ? args[args.indexOf("--notas") + 1] : "";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const versao = conf.version;
console.log(`→ versão ${versao}`);

const chave =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || join(homedir(), ".tauri", "conecta-updater.key");
if (!existsSync(chave)) {
  console.error(`✗ chave de assinatura não encontrada em ${chave}`);
  process.exit(1);
}

if (!semBuild) {
  console.log("→ tauri build (alguns minutos)…");
  const r = spawnSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY_PATH: chave,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    },
  });
  if (r.status !== 0) {
    console.error("✗ o build falhou");
    process.exit(1);
  }
}

const pasta = "src-tauri/target/release/bundle/nsis";
const exe = readdirSync(pasta).find((f) => f.endsWith(`_${versao}_x64-setup.exe`));
if (!exe || !existsSync(join(pasta, `${exe}.sig`))) {
  console.error(`✗ instalador assinado da ${versao} não encontrado em ${pasta}`);
  process.exit(1);
}
const assinatura = readFileSync(join(pasta, `${exe}.sig`), "utf8").trim();
const nomePublico = `conecta_${versao}_x64-setup.exe`;

const bruto = process.env.URL_SAAS_TOKEN;
if (!bruto) {
  console.error("✗ URL_SAAS_TOKEN ausente (rode com --env-file=.env.local)");
  process.exit(1);
}
const u = new URL(bruto);
const base = `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
const sas = u.search.slice(1);

async function subir(caminho, corpo, tipo) {
  const r = await fetch(`${base}/${caminho}?${sas}`, {
    method: "PUT",
    headers: { "x-ms-blob-type": "BlockBlob", "content-type": tipo },
    body: corpo,
  });
  if (!r.ok) throw new Error(`PUT ${caminho} → ${r.status} ${(await r.text()).slice(0, 200)}`);
}

console.log(`→ enviando ${nomePublico}…`);
await subir(`app/${nomePublico}`, readFileSync(join(pasta, exe)), "application/octet-stream");

const latest = {
  version: versao,
  notes: notas || `SGL - CONECTA ${versao}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: assinatura,
      url: `${PUBLICO}/api/public/app/baixar/${nomePublico}`,
    },
  },
};
// Por último: só depois do instalador estar lá é que os apps ficam sabendo.
await subir("app/latest.json", JSON.stringify(latest, null, 2), "application/json");
console.log(`✓ publicado. Os apps 0.2.2+ atualizam sozinhos em até 4 h (ou ao abrir).`);
console.log(`  instalador manual: ${latest.platforms["windows-x86_64"].url}`);
