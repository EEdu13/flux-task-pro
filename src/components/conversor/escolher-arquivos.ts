/**
 * "Clique no bloco e escolha nas pastas" (04/11/2026): o seletor de arquivos
 * do sistema. Precisa ser chamado direto do clique — o navegador só abre o
 * seletor com um gesto da pessoa, por isso nada de `await` antes do `click()`.
 *
 * Cancelar o seletor devolve lista vazia (o evento `cancel` existe no Chrome e
 * no Edge, que é o motor do app de mesa).
 */
export function escolherArquivos(accept: string, varios: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = varios;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}
