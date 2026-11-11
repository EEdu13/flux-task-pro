import assert from "node:assert/strict";
import test from "node:test";
import { mesclarAtas } from "../src/lib/atas-cache.ts";

test("traz atas recuperadas depois que a pessoa entrou no sistema", () => {
  const antigas = [{ id: "ata-antiga", markdown: "antiga" }];
  const recuperadas = [
    { id: "ata-tarde", markdown: "seguranca na direcao" },
    { id: "ata-manha", markdown: "cultivar e compras" },
    ...antigas,
  ];
  assert.deepEqual(mesclarAtas(recuperadas, antigas, new Set()), recuperadas);
});

test("retira uma ata que o servidor deixou de disponibilizar", () => {
  const locais = [
    { id: "disponivel", markdown: "versao antiga" },
    { id: "removida", markdown: "conteudo removido" },
  ];
  const atuais = [{ id: "disponivel", markdown: "versao atual" }];
  assert.deepEqual(mesclarAtas(atuais, locais, new Set()), atuais);
});

test("preserva gravacao em andamento e nao duplica ids com caixas diferentes", () => {
  const locais = [
    { id: "ABC", markdown: "ata final ainda salvando" },
    { id: "NOVA", markdown: "ata nova ainda salvando" },
  ];
  const atuais = [{ id: "abc", markdown: "rascunho antigo" }];
  assert.deepEqual(mesclarAtas(atuais, locais, new Set(["abc", "nova"])), [locais[1], locais[0]]);
  assert.deepEqual(mesclarAtas(atuais, locais, new Set()), atuais);
});
