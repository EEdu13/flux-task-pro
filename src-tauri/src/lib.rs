use std::io::Write;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

/// Extensões seguras para abrir com o handler do SO — imagens e documentos.
/// Deliberadamente NÃO inclui executáveis/scripts (exe, bat, cmd, ps1, vbs, js,
/// hta, msi, lnk, html, svg…), que poderiam rodar código ao serem "abertos".
const ALLOWED_EXTS: &[&str] = &[
    // imagens
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic",
    // documentos
    "pdf", "txt", "csv", "md", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "odp",
];

/// Limite defensivo do tamanho do anexo recebido do frontend (o app já limita
/// uploads a 3 MB; aqui damos folga mas evitamos payloads absurdos).
const MAX_ATTACHMENT_BYTES: usize = 12 * 1024 * 1024;

/// Grava o anexo num arquivo temporário e abre com o app padrão do Windows
/// (visualizador de imagens, PDF, etc.). Assim o usuário vê a evidência fora do app.
///
/// Segurança: o `name` vem do frontend e pode ter origem em outro usuário
/// (projeto compartilhado, inbox do WhatsApp). Por isso validamos extensão
/// contra uma allowlist e recusamos nomes perigosos antes de gravar/abrir —
/// sem isso, um anexo `.exe`/`.bat` abriria e executaria via ShellExecute.
#[tauri::command]
fn open_attachment_file(name: String, data: Vec<u8>) -> Result<(), String> {
    if data.is_empty() {
        return Err("arquivo vazio".into());
    }
    if data.len() > MAX_ATTACHMENT_BYTES {
        return Err("arquivo muito grande".into());
    }

    // Sanitiza o nome: remove separadores de caminho e qualquer caractere
    // fora de [alfanumérico . - _ espaço], impedindo path traversal e injeção
    // no cmd (os args já vão separados, mas mantemos a higiene).
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let file_name = safe.trim().to_string();

    // Recusa nomes vazios, ocultos ou de navegação de diretório.
    if file_name.is_empty() || file_name == "." || file_name == ".." || file_name.starts_with('.') {
        return Err("nome de arquivo inválido".into());
    }

    // Exige extensão conhecida e segura.
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some(e) if ALLOWED_EXTS.contains(&e) => {}
        _ => return Err("tipo de arquivo não permitido".into()),
    }

    let mut dir = std::env::temp_dir();
    dir.push("fluxo-anexos");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut path = dir;
    path.push(&file_name);

    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    drop(f);

    open_path_os(&path).map_err(|e| e.to_string())
}

fn open_path_os(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance DEVE ser o primeiro plugin registrado.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![open_attachment_file])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // --- Ícone na bandeja (system tray) ---
            let show = MenuItem::with_id(app, "show", "Abrir Fluxo", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Fluxo Task Pro")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Fechar a janela (X) NÃO sai do app: minimiza pra bandeja.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
