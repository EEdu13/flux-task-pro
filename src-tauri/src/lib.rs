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

/// Valida o anexo que veio do frontend e devolve o nome seguro para gravar.
///
/// Segurança: o `name` vem do frontend e pode ter origem em outro usuário
/// (projeto compartilhado, inbox do WhatsApp). Por isso validamos extensão
/// contra uma allowlist e recusamos nomes perigosos antes de gravar/abrir —
/// sem isso, um anexo `.exe`/`.bat` abriria e executaria via ShellExecute.
fn nome_seguro(name: &str, data: &[u8]) -> Result<String, String> {
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
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') { c } else { '_' })
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
        Some(e) if ALLOWED_EXTS.contains(&e) => Ok(file_name),
        _ => Err("tipo de arquivo não permitido".into()),
    }
}

/// Grava o anexo num arquivo temporário e abre com o app padrão do Windows
/// (visualizador de imagens, PDF, etc.). Assim o usuário vê a evidência fora do app.
#[tauri::command]
fn open_attachment_file(name: String, data: Vec<u8>) -> Result<(), String> {
    let file_name = nome_seguro(&name, &data)?;

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

/// Baixa o anexo para a pasta Downloads do usuário e devolve o caminho completo,
/// para a tela avisar onde ele foi parar (pedido do usuário, 09/10/2026: o
/// arquivo ia para Downloads sem ninguém dizer).
///
/// Nunca sobrescreve: se já existe "planilha.xlsx", grava "planilha (1).xlsx",
/// como o navegador faz.
#[tauri::command]
fn save_attachment_file(app: tauri::AppHandle, name: String, data: Vec<u8>) -> Result<String, String> {
    let file_name = nome_seguro(&name, &data)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let base = std::path::Path::new(&file_name);
    let stem = base.file_stem().and_then(|s| s.to_str()).unwrap_or("arquivo").to_string();
    let ext = base.extension().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let mut path = dir.join(&file_name);
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
        if n > 999 {
            return Err("muitos arquivos com o mesmo nome em Downloads".into());
        }
    }

    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Abre o Explorer com o arquivo baixado selecionado ("Mostrar na pasta").
/// Só aceita caminho dentro de Downloads: o comando é chamado pelo site, e não
/// deve virar um jeito de abrir pasta qualquer do computador.
#[tauri::command]
fn show_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let alvo = std::path::PathBuf::from(&path);
    let dentro = match (alvo.canonicalize(), downloads.canonicalize()) {
        (Ok(a), Ok(d)) => a.starts_with(&d),
        _ => false,
    };
    if !dentro {
        return Err("caminho fora da pasta Downloads".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // `raw_arg`: o Explorer não entende o /select com as aspas que o Rust
        // põe sozinho em volta de argumento com espaço.
        std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", alvo.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let pasta = alvo.parent().unwrap_or(&downloads).to_path_buf();
        open_path_os(&pasta).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn open_path_os(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        /* CREATE_NO_WINDOW: sem isto cada anexo aberto piscava uma janela preta
           de terminal (o `cmd` que chama o `start`) — relato de 09/10/2026. */
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
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

/// Segundos desde o último movimento de mouse ou tecla em QUALQUER programa.
///
/// É o que decide o "Ausente" automático do chat. O WebView só enxerga o mouse
/// dentro da própria janela: quem passasse meia hora no Excel com o app aberto
/// atrás seria dado como ausente estando no computador. O Windows sabe da
/// última entrada do usuário na sessão inteira (`GetLastInputInfo`), e tela
/// bloqueada conta como parada, porque ninguém mexe na sessão.
///
/// Chamada direta à API, sem crate: são duas funções e uma struct, e uma
/// dependência nova só para isso pesaria mais que o código.
#[tauri::command]
fn tempo_ocioso_segundos() -> u64 {
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            dw_time: u32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTickCount() -> u32;
        }
        let mut info = LastInputInfo {
            cb_size: std::mem::size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return 0;
        }
        // `wrapping_sub`: o contador de ms dá a volta a cada ~49 dias ligado.
        let agora = unsafe { GetTickCount() };
        (agora.wrapping_sub(info.dw_time) / 1000) as u64
    }
    #[cfg(not(target_os = "windows"))]
    {
        0
    }
}

/* ————————————————— Atualização automática —————————————————
 *
 * Pedido do usuário, 09/10/2026: "tem que atualizar sozinho — imagina
 * instalar em mais de 30 máquinas". A partir da 0.2.2 o app confere sozinho
 * se há versão nova (o `latest.json` servido pelo próprio site, ver
 * `api/public/app`), baixa, confere a assinatura e instala.
 *
 * Quando instalar sem atrapalhar ninguém:
 *   - na abertura do app (a pessoa acabou de entrar): instala na hora;
 *   - nas conferências seguintes (a cada 4 h): baixa e só instala quando a
 *     pessoa estiver parada há 15 min — o instalador fecha o app, e fechar no
 *     meio de uma chamada derrubaria a reunião.
 */
const ESPERA_INICIAL_S: u64 = 20;
const INTERVALO_S: u64 = 4 * 3600;
const OCIOSO_PARA_INSTALAR_S: u64 = 15 * 60;

fn iniciar_atualizador(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(ESPERA_INICIAL_S));
        let mut primeira = true;
        loop {
            let app2 = app.clone();
            let r = tauri::async_runtime::block_on(async move { conferir_e_instalar(&app2, primeira).await });
            if let Err(e) = r {
                log::warn!("atualizador: {e}");
            }
            primeira = false;
            std::thread::sleep(std::time::Duration::from_secs(INTERVALO_S));
        }
    });
}

async fn conferir_e_instalar(app: &tauri::AppHandle, na_abertura: bool) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let atualizador = app.updater().map_err(|e| e.to_string())?;
    let Some(versao) = atualizador.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    log::info!("atualizador: versão {} disponível", versao.version);
    let bytes = versao.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    if !na_abertura {
        // Espera a pessoa largar o computador (mesma medida do "Ausente").
        while tempo_ocioso_segundos() < OCIOSO_PARA_INSTALAR_S {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    }
    versao.install(bytes).map_err(|e| e.to_string())?;
    // No Windows o instalador já fecha o app; nos outros sistemas, reinicia.
    app.restart();
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_attachment_file,
            save_attachment_file,
            show_in_folder,
            tempo_ocioso_segundos
        ])
        .setup(|app| {
            // Atualização automática (só no app de verdade, não no `tauri dev`).
            if !cfg!(debug_assertions) {
                iniciar_atualizador(app.handle().clone());
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // --- Ícone na bandeja (system tray) ---
            let show = MenuItem::with_id(app, "show", "Abrir SGL - CONECTA", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("SGL - CONECTA")
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
