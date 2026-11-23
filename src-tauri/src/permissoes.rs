//! Câmera e microfone liberados para o nosso site, dentro do app (23/11/2026, versão 0.2.4).
//!
//! O app é o site numa janela do WebView2 (o motor do Edge). Quando o site pede câmera ou
//! microfone, quem pergunta à pessoa é o próprio WebView2 — e, se ela recusa, a recusa fica
//! guardada no perfil do app, que não tem barra de endereço nem cadeado para voltar atrás: a
//! pessoa ficava sem chamada, sem gravação e sem ditado, de vez. Decisão do usuário: liberar
//! direto, como fazem o Teams e o Slack. A câmera e o microfone só ligam quando a pessoa entra
//! numa chamada ou grava; o Windows mostra que estão em uso, e as chaves de privacidade do próprio
//! Windows continuam valendo.
//!
//! Duas partes, as duas só para o nosso site (outro site aberto dentro do app segue com a
//! pergunta de sempre):
//! - na abertura, grava "liberado" no perfil — isso apaga a recusa de quem já tinha recusado
//!   (com a recusa guardada, o WebView2 pode nem perguntar de novo);
//! - e responde "liberado" a cada pedido de câmera ou microfone que chegar.

/// As origens do nosso site: a de produção e, no `tauri dev`, a local.
#[cfg_attr(not(windows), allow(dead_code))]
fn origens() -> &'static [&'static str] {
    if cfg!(debug_assertions) {
        &["https://gestor-larsil.up.railway.app", "http://localhost:5199"]
    } else {
        &["https://gestor-larsil.up.railway.app"]
    }
}

/// O endereço é do nosso site? (A origem exata, ou um caminho dentro dela.)
#[cfg_attr(not(windows), allow(dead_code))]
fn eh_do_nosso_site(uri: &str) -> bool {
    origens()
        .iter()
        .any(|o| uri == *o || uri.strip_prefix(o).is_some_and(|resto| resto.starts_with('/')))
}

#[cfg(windows)]
pub fn liberar_camera_e_microfone(janela: &tauri::WebviewWindow) {
    let pedido = janela.with_webview(|webview| {
        // SAFETY: as chamadas COM rodam na thread da janela, que é onde o `with_webview` chama.
        if let Err(e) = unsafe { configurar(&webview.controller()) } {
            log::warn!("permissões: {e}");
        }
    });
    if let Err(e) = pedido {
        log::warn!("permissões: {e}");
    }
}

#[cfg(not(windows))]
pub fn liberar_camera_e_microfone(_janela: &tauri::WebviewWindow) {}

#[cfg(windows)]
unsafe fn configurar(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{PermissionRequestedEventHandler, SetPermissionStateCompletedHandler};
    use windows_core::{Interface, HSTRING, PWSTR};

    const TIPOS: [COREWEBVIEW2_PERMISSION_KIND; 2] = [
        COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    ];
    let webview = controller.CoreWebView2()?;

    // 1. O que já está guardado no perfil (WebView2 1.0.1661 em diante; o do Windows 10/11
    //    atualiza sozinho). Sem essa versão, fica só a parte 2.
    let perfil = webview
        .cast::<ICoreWebView2_13>()
        .and_then(|w| w.Profile())
        .and_then(|p| p.cast::<ICoreWebView2Profile4>());
    match perfil {
        Ok(perfil) => {
            for origem in origens() {
                for tipo in TIPOS {
                    let pronto = SetPermissionStateCompletedHandler::create(Box::new(|resultado| {
                        if resultado.is_err() {
                            log::warn!("permissões: o perfil não gravou ({resultado:?})");
                        }
                        Ok(())
                    }));
                    perfil.SetPermissionState(
                        tipo,
                        &HSTRING::from(*origem),
                        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        &pronto,
                    )?;
                }
            }
        }
        Err(e) => log::warn!("permissões: WebView2 sem o perfil novo ({e})"),
    }

    // 2. Cada pedido que chegar.
    let mut token = 0i64;
    webview.add_PermissionRequested(
        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut tipo = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut tipo)?;
            if !TIPOS.contains(&tipo) {
                return Ok(());
            }
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            if eh_do_nosso_site(&webview2_com::take_pwstr(uri)) {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        })),
        &mut token,
    )?;
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::eh_do_nosso_site;

    #[test]
    fn so_o_nosso_site() {
        assert!(eh_do_nosso_site("https://gestor-larsil.up.railway.app"));
        assert!(eh_do_nosso_site("https://gestor-larsil.up.railway.app/chamada/abc"));
        assert!(!eh_do_nosso_site("https://gestor-larsil.up.railway.app.golpe.com/"));
        assert!(!eh_do_nosso_site("https://outro-site.com/"));
        assert!(!eh_do_nosso_site("http://gestor-larsil.up.railway.app/"));
    }
}
