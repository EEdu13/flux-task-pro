/*
 * urls-mediapipe.ts — TODOS os endereços do reconhecimento de gestos, num lugar só.
 *
 * Por que CDN e não npm: a especificação proíbe mexer no package.json nesta etapa, e o
 * @mediapipe/tasks-vision que está no node_modules não está declarado. O worker carrega o
 * pacote .cjs da mesma versão (0.10.14) pela jsDelivr e os modelos .task do Google Storage
 * (~5,8 MB o corpo e ~8,4 MB as mãos, mais ~10 MB do WASM: "~25 MB só na 1ª vez" — depois
 * o navegador serve do cache HTTP).
 *
 * Offline / app de mesa (Tauri): copiar node_modules/@mediapipe/tasks-vision/{vision_bundle.cjs,
 * wasm/} e os dois .task para public/mediapipe/ e definir VITE_RV_MEDIAPIPE_BASE=/mediapipe
 * (os modelos passam a sair da mesma base). Conferir ANTES no tauri.conf (não editado aqui,
 * é arquivo de produção):
 *   - CSP: worker-src blob: ; script-src e connect-src liberando a CDN (ou a base local);
 *     o WASM pede 'wasm-unsafe-eval' em script-src;
 *   - permissão de câmera do WebView2 (o Windows pergunta uma vez por app; se o usuário negou,
 *     Configurações → Privacidade → Câmera).
 */

export interface UrlsDoMediapipe {
  /** vision_bundle.cjs — entra no worker clássico por importScripts. */
  bundle: string;
  /** Pasta do vision_wasm_internal.{js,wasm} (FilesetResolver.forVisionTasks). */
  wasm: string;
  /** PoseLandmarker lite (float16). */
  pose: string;
  /** GestureRecognizer (float16) — só carregado quando uma mão passa do peito. */
  gestos: string;
}

const VERSAO = "0.10.14";
const BASE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSAO}`;
const MODELO_POSE =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MODELO_GESTOS =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

/**
 * As URLs ABSOLUTAS (o worker nasce de um Blob: um caminho relativo como "/mediapipe" não
 * resolveria lá dentro). Com VITE_RV_MEDIAPIPE_BASE definida, os modelos saem da mesma base.
 */
export function urlsDoMediapipe(): UrlsDoMediapipe {
  const configurada = (import.meta.env.VITE_RV_MEDIAPIPE_BASE as string | undefined)?.trim();
  const origem = typeof location !== "undefined" ? location.href : "http://localhost/";
  const base = new URL((configurada || BASE_CDN).replace(/\/+$/, ""), origem).href;
  return {
    bundle: `${base}/vision_bundle.cjs`,
    wasm: `${base}/wasm`,
    pose: configurada ? `${base}/pose_landmarker_lite.task` : MODELO_POSE,
    gestos: configurada ? `${base}/gesture_recognizer.task` : MODELO_GESTOS,
  };
}
