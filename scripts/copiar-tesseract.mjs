// O OCR do conversor (tesseract.js) servido pelo NOSSO domínio, sem CDN (11/11/2026): copia o
// worker, o motor e o português de node_modules para public/tesseract/, que fica fora do git.
// Roda sozinho antes do dev e do build ("predev" e "prebuild" no package.json).
//
// - Só as 3 variantes LSTM do motor: o português "best_int" é só o modelo LSTM, e o OCR roda
//   nesse modo (`OEM.LSTM_ONLY` em `locais/ocr.ts`). O worker escolhe a variante que o
//   processador suporta (relaxed SIMD, SIMD ou nenhuma); cada computador baixa uma só.
// - O nome do idioma tem de ser exatamente "por.traineddata.gz": o Tesseract monta o endereço
//   juntando a pasta com o nome. O inglês (12/11/2026) vai junto, para a opção "Português e
//   inglês"; só baixa quem a escolhe.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const modulos = join(raiz, "node_modules");
const destino = join(raiz, "public", "tesseract");

mkdirSync(join(destino, "core"), { recursive: true });
mkdirSync(join(destino, "lang"), { recursive: true });

copyFileSync(
  join(modulos, "tesseract.js", "dist", "worker.min.js"),
  join(destino, "worker.min.js"),
);

const pastaDoMotor = join(modulos, "tesseract.js-core");
const motores = readdirSync(pastaDoMotor).filter((n) =>
  /^tesseract-core.*-lstm\.wasm\.js$/.test(n),
);
if (motores.length === 0)
  throw new Error("tesseract.js-core sem as variantes -lstm: a versão mudou?");
for (const nome of motores) copyFileSync(join(pastaDoMotor, nome), join(destino, "core", nome));

for (const idioma of ["por", "eng"]) {
  copyFileSync(
    join(modulos, "@tesseract.js-data", idioma, "4.0.0_best_int", `${idioma}.traineddata.gz`),
    join(destino, "lang", `${idioma}.traineddata.gz`),
  );
}

console.log(`OCR: worker, ${motores.length} motores, português e inglês em public/tesseract/`);
