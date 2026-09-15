fn main() {
  /* Os comandos do próprio app PRECISAM estar declarados aqui.

     A janela carrega o site da Railway, que para o Tauri é uma origem remota.
     Para origem remota ele só deixa chamar comando que tenha permissão na
     capability (`allow-<comando>` em capabilities/default.json) — e a
     permissão só existe se o comando for listado neste manifesto. Sem isso o
     `invoke` é recusado em silêncio: foi assim que o Ausente automático saiu na
     0.2.0 e nunca ligou, e o "abrir anexo no programa do Windows" também nunca
     funcionou no app instalado.

     Comando novo em `lib.rs` = entrada nova aqui E na capability. */
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      tauri_build::AppManifest::new().commands(&["open_attachment_file", "tempo_ocioso_segundos"]),
    ),
  )
  .expect("falha ao rodar o tauri-build");
}
