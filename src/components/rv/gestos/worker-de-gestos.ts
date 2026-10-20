/*
 * worker-de-gestos.ts — o código do Web Worker que roda o MediaPipe, como TEXTO.
 *
 * Por que worker: o detect do corpo leva 25–40 ms por quadro; na thread da página isso
 * travaria a sala 3D (60 qps) a cada quadro da câmera. No worker a página só gasta o
 * createImageBitmap e a heurística (< 1 ms).
 *
 * Por que CLÁSSICO e de Blob (sem `type: "module"`): o carregador do WASM do MediaPipe
 * (vision_wasm_internal.js) entra por importScripts() quando não há document; num worker
 * "module" importScripts não existe e a carga quebra (provado na bancada gestos-teste/worker.js).
 * O pacote .cjs entra com um `exports`/`module` falsos, baixado por fetch e reembalado num Blob
 * text/javascript (a CDN o serve como "application/node" e o importScripts recusaria). O próprio
 * worker nasce de Blob para não precisar de arquivo em public/ nem de configuração do Vite.
 *
 * Regras do laço: a página manda UM quadro por vez e espera a resposta — por isso TODA
 * mensagem "quadro" recebe exatamente uma "resultado" (mesmo em falha), e o bitmap é sempre
 * fechado aqui. O GestureRecognizer é criado logo após o corpo (antes do "pronto") e roda
 * sob demanda: só nos quadros em que a página pede mãos.
 *
 * Atenção ao editar: é um template string — nada de crase nem "${" lá dentro.
 */
export const CODIGO_DO_WORKER = `
"use strict";
self.exports = {};
self.module = { exports: self.exports };

// O WASM do MediaPipe escreve INFO/WARNING do TFLite por console.error ("Created TensorFlow
// Lite XNNPACK delegate…"): não é erro, e poluiria o console da reunião. Rebaixa para debug.
var erroOriginal = console.error.bind(console);
console.error = function () {
  var primeiro = String(arguments[0] || "");
  if (/^(INFO|WARNING|I0000|W0000)[: ]|gl_context|Graph successfully|Created TensorFlow/.test(primeiro)) {
    console.debug.apply(console, arguments);
    return;
  }
  erroOriginal.apply(console, arguments);
};

var visao = null;
var arquivos = null;
var pose = null;
var gestos = null;
var carregandoGestos = false;
var delegatePreferido = "GPU";
var urls = null;
// Troca automática GPU → CPU quando a "GPU" é lenta (WebGL emulado): ms dos primeiros quadros.
var amostrasGpu = [];
var trocandoParaCpu = false;

// WebGL por software (SwiftShader, llvmpipe, "Microsoft Basic Render"): o delegate GPU roda,
// mas a ~1 s por quadro — a CPU (WASM/XNNPACK) faz o mesmo em ~30–40 ms.
function webglDeSoftware() {
  try {
    var c = new OffscreenCanvas(1, 1);
    var gl = c.getContext("webgl2");
    if (!gl) return true;
    var ext = gl.getExtension("WEBGL_debug_renderer_info");
    var r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
  } catch (e) {
    return true;
  }
}

function medianaDe(v) {
  var o = v.slice().sort(function (a, b) {
    return a - b;
  });
  return o[o.length >> 1];
}

// Depois do aquecimento, se a GPU passa de 150 ms por quadro, recria o corpo em CPU. O modelo
// velho segue respondendo até o novo ficar pronto (o laço da página não para).
function talvezTrocarParaCpu(ms) {
  if (delegatePreferido !== "GPU" || trocandoParaCpu) return;
  amostrasGpu.push(ms);
  if (amostrasGpu.length < 10) return;
  var recentes = amostrasGpu.slice(4);
  amostrasGpu = [];
  if (medianaDe(recentes) <= 150) {
    delegatePreferido = "GPU-ok";
    return;
  }
  trocandoParaCpu = true;
  criar(visao.PoseLandmarker, urls.pose, { runningMode: "VIDEO", numPoses: 1 }, "CPU")
    .then(function (r) {
      var velho = pose;
      pose = r.tarefa;
      delegatePreferido = "CPU";
      try {
        if (velho) velho.close();
      } catch (x) {}
      self.postMessage({ tipo: "pronto", delegate: "CPU" });
    })
    .catch(function (e) {
      delegatePreferido = "GPU-ok";
      self.postMessage({ tipo: "aviso", mensagem: "Não consegui trocar para CPU: " + texto(e) });
    });
}

function texto(e) {
  return String((e && e.message) || e);
}

function pontos(lista) {
  var saida = new Array(lista.length);
  for (var i = 0; i < lista.length; i++) {
    var p = lista[i];
    saida[i] = { x: p.x, y: p.y, z: p.z, visibility: p.visibility };
  }
  return saida;
}

// GPU primeiro (WebGL2 num OffscreenCanvas); se falhar, CPU (WASM/XNNPACK). Devolve qual valeu.
async function criar(Classe, modelo, extras, preferido) {
  var ordem = preferido === "GPU" ? ["GPU", "CPU"] : ["CPU"];
  var ultimoErro = null;
  for (var i = 0; i < ordem.length; i++) {
    try {
      var opcoes = Object.assign({ baseOptions: { modelAssetPath: modelo, delegate: ordem[i] } }, extras);
      var tarefa = await Classe.createFromOptions(arquivos, opcoes);
      return { tarefa: tarefa, delegate: ordem[i] };
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

function carregarGestos() {
  if (gestos || carregandoGestos || !visao) return Promise.resolve();
  carregandoGestos = true;
  var d = delegatePreferido === "CPU" ? "CPU" : "GPU";
  return criar(visao.GestureRecognizer, urls.gestos, { runningMode: "VIDEO", numHands: 2 }, d)
    .then(function (r) {
      gestos = r.tarefa;
    })
    .catch(function (e) {
      // Sem mãos ainda há mão levantada, aceno e palmas (vêm do corpo): segue sem joinha/coração.
      self.postMessage({ tipo: "aviso", mensagem: "Reconhecedor de mãos não carregou: " + texto(e) });
    });
}

self.onmessage = async function (e) {
  var m = e.data;
  if (m.tipo === "iniciar") {
    try {
      urls = m.urls;
      // A jsDelivr serve .cjs como "application/node" (com nosniff), e importScripts recusa
      // MIME que não seja JavaScript. Então baixa o texto e reembala num Blob text/javascript.
      var resp = await fetch(urls.bundle);
      if (!resp.ok) throw new Error("HTTP " + resp.status + " em " + urls.bundle);
      var urlDoPacote = URL.createObjectURL(new Blob([await resp.text()], { type: "text/javascript" }));
      try {
        importScripts(urlDoPacote);
      } finally {
        URL.revokeObjectURL(urlDoPacote);
      }
      visao = self.module.exports;
      arquivos = await visao.FilesetResolver.forVisionTasks(urls.wasm);
      var preferido = webglDeSoftware() ? "CPU" : "GPU";
      var r = await criar(visao.PoseLandmarker, urls.pose, { runningMode: "VIDEO", numPoses: 1 }, preferido);
      pose = r.tarefa;
      delegatePreferido = r.delegate;
      // O reconhecedor de mãos RODA sob demanda (4 qps, só com a mão acima do peito), mas é
      // CRIADO antes do "pronto": a criação trava este worker por ~1 s (grafo do WASM) e, se
      // caísse na hora em que a pessoa ergue a mão, atrasaria a trava da fila em segundos.
      await carregarGestos();
      self.postMessage({ tipo: "pronto", delegate: r.delegate });
    } catch (err) {
      self.postMessage({ tipo: "erro", mensagem: texto(err) });
    }
    return;
  }
  if (m.tipo === "quadro") {
    var bmp = m.bmp;
    try {
      if (!pose) {
        self.postMessage({ tipo: "resultado", t: m.t, ms: 0, pose: null, falha: "sem modelo" });
        return;
      }
      var a = performance.now();
      var rp = pose.detectForVideo(bmp, m.t);
      var msPose = performance.now() - a;
      talvezTrocarParaCpu(msPose);
      var maos;
      var nomes;
      if (m.comMao) {
        if (gestos) {
          var g = gestos.recognizeForVideo(bmp, m.t);
          maos = [];
          nomes = [];
          for (var i = 0; i < g.landmarks.length; i++) {
            var top = g.gestures && g.gestures[i] && g.gestures[i][0];
            var gesto = top ? { nome: top.categoryName, score: top.score } : null;
            maos.push({ pontos: pontos(g.landmarks[i]), gesto: gesto });
            nomes.push(gesto ? gesto.nome : null);
          }
        } else {
          carregarGestos();
        }
      }
      self.postMessage({
        tipo: "resultado",
        t: m.t,
        ms: performance.now() - a,
        msPose: msPose,
        pose: rp.landmarks && rp.landmarks[0] ? pontos(rp.landmarks[0]) : null,
        maos: maos,
        gestosDeMao: nomes,
      });
    } catch (err) {
      self.postMessage({ tipo: "resultado", t: m.t, ms: 0, pose: null, falha: texto(err) });
    } finally {
      try {
        bmp.close();
      } catch (x) {}
    }
    return;
  }
  if (m.tipo === "parar") {
    try {
      if (pose) pose.close();
      if (gestos) gestos.close();
    } catch (x) {}
    pose = null;
    gestos = null;
    self.close();
  }
};
`;

/** Cria o worker (clássico, de Blob). A URL do Blob é revogada assim que o worker nasce. */
export function criarWorkerDeGestos(): Worker {
  const url = URL.createObjectURL(new Blob([CODIGO_DO_WORKER], { type: "text/javascript" }));
  try {
    return new Worker(url);
  } finally {
    // O navegador já leu o script ao construir o Worker; revogar evita vazar o Blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
