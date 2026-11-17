//! Salvar em Downloads um arquivo grande, em pedaços (12/11/2026).
//!
//! O `save_attachment_file` recebe o arquivo como lista de números no JSON e para em 12 MB: um
//! PDF grande do conversor, um vídeo anexado ou a gravação de uma reunião não cabiam — e no app o
//! link de download do navegador não serve, porque o WebView2 o ignora. Aqui o arquivo chega em
//! BYTES, sem JSON, e em PEDAÇOS de até 16 MB, um por chamada e na ordem. O app escreve numa
//! pasta temporária própria e, no último pedaço, leva o arquivo para Downloads com o nome de
//! verdade, sem sobrescrever outro ("planilha (1).xlsx"), e devolve o caminho. Nem o site nem o
//! app seguram o arquivo inteiro na memória.
//!
//! O `save_attachment_file` continua: é por ele que o site fala com o app antigo.
//!
//! Cabeçalhos de cada chamada:
//! - `x-envio`: o id do envio, escolhido pelo site (letras, números e `-`);
//! - `x-parte`: 0, 1, 2… na ordem;
//! - no pedaço 0, `x-nome` (com `encodeURIComponent`) e `x-total` (o tamanho do arquivo, em bytes);
//! - `x-fim: 1` no último pedaço, que devolve o caminho; os outros devolvem "";
//! - `x-cancelar: 1` para desistir: o que já tinha chegado é apagado.
//!
//! Tetos: 200 MB para documento e imagem (o mesmo do conversor) e 4 GB para áudio e vídeo,
//! porque a gravação de uma reunião longa, com tela, passa fácil de 200 MB.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use tauri::Manager;

const TETO_DOCUMENTO: u64 = 200 * 1024 * 1024;
const TETO_MIDIA: u64 = 4 * 1024 * 1024 * 1024;
const MIDIA: &[&str] = &["webm", "mp4", "mov", "m4a", "mp3", "ogg", "wav"];

/// O site manda 8 MB por pedaço; isto é só a defesa contra um pedido absurdo.
const MAXIMO_DO_PEDACO: usize = 16 * 1024 * 1024;

/// Envio parado há mais que isto (a aba fechou no meio) é descartado.
const ESQUECIDO_APOS: Duration = Duration::from_secs(30 * 60);

/// Sobra de um envio que o app não chegou a fechar (o computador desligou no meio).
const SOBRA_APOS: Duration = Duration::from_secs(24 * 3600);

struct Envio {
    arquivo: std::fs::File,
    parcial: PathBuf,
    nome: String,
    total: u64,
    escritos: u64,
    proxima: u32,
    mexido: Instant,
}

fn envios() -> &'static Mutex<HashMap<String, Envio>> {
    static ENVIOS: OnceLock<Mutex<HashMap<String, Envio>>> = OnceLock::new();
    ENVIOS.get_or_init(Default::default)
}

fn cabecalho(request: &tauri::ipc::Request<'_>, nome: &str) -> Option<String> {
    request
        .headers()
        .get(nome)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

fn teto(nome: &str) -> u64 {
    let ext = std::path::Path::new(nome)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if MIDIA.contains(&ext.as_str()) {
        TETO_MIDIA
    } else {
        TETO_DOCUMENTO
    }
}

/// Fecha e apaga o que já tinha chegado. O arquivo precisa estar fechado antes: o Windows não
/// apaga arquivo aberto.
fn descartar(envio: Envio) {
    let Envio { arquivo, parcial, .. } = envio;
    drop(arquivo);
    let _ = std::fs::remove_file(parcial);
}

/// A pasta dos pedaços em andamento, já sem as sobras de mais de um dia.
fn pasta_dos_parciais() -> Result<PathBuf, String> {
    let pasta = std::env::temp_dir().join("conecta-salvar");
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    if let Ok(itens) = std::fs::read_dir(&pasta) {
        for item in itens.flatten() {
            let velho = item
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|quando| SystemTime::now().duration_since(quando).ok())
                .is_some_and(|idade| idade > SOBRA_APOS);
            if velho {
                let _ = std::fs::remove_file(item.path());
            }
        }
    }
    Ok(pasta)
}

/// Escreve um pedaço. `Ok(true)` = era o último e o arquivo chegou inteiro.
fn escrever(envio: &mut Envio, parte: u32, dados: &[u8], fim: bool) -> Result<bool, String> {
    if parte != envio.proxima {
        return Err("pedaço fora de ordem".into());
    }
    if envio.escritos + dados.len() as u64 > envio.total {
        return Err("o arquivo passou do tamanho anunciado".into());
    }
    envio.arquivo.write_all(dados).map_err(|e| e.to_string())?;
    envio.escritos += dados.len() as u64;
    envio.proxima += 1;
    envio.mexido = Instant::now();
    if !fim {
        return Ok(false);
    }
    if envio.escritos != envio.total {
        return Err("o arquivo chegou incompleto".into());
    }
    Ok(true)
}

/// Leva o arquivo pronto para Downloads, com um nome que ainda não existe lá.
fn concluir(app: &tauri::AppHandle, envio: Envio) -> Result<String, String> {
    let Envio { arquivo, parcial, nome, .. } = envio;
    let gravado = arquivo.sync_all();
    drop(arquivo);
    if let Err(e) = gravado {
        let _ = std::fs::remove_file(&parcial);
        return Err(e.to_string());
    }
    let pasta = match app.path().download_dir() {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_file(&parcial);
            return Err(e.to_string());
        }
    };
    let destino = match std::fs::create_dir_all(&pasta)
        .map_err(|e| e.to_string())
        .and_then(|_| crate::reservar_caminho_livre(&pasta, &nome))
    {
        Ok(d) => d,
        Err(e) => {
            let _ = std::fs::remove_file(&parcial);
            return Err(e);
        }
    };
    // O nome reservado é um arquivo vazio nosso: o `rename` o substitui. Se Downloads estiver
    // em outra unidade de disco, o `rename` não atravessa, e aí vai por cópia.
    if std::fs::rename(&parcial, &destino).is_err() {
        let copiado = std::fs::copy(&parcial, &destino);
        let _ = std::fs::remove_file(&parcial);
        if let Err(e) = copiado {
            let _ = std::fs::remove_file(&destino);
            return Err(e.to_string());
        }
    }
    Ok(destino.to_string_lossy().into_owned())
}

/// Recebe um pedaço do arquivo (ver o começo deste módulo). Devolve o caminho em Downloads no
/// último pedaço e "" nos outros.
#[tauri::command]
pub async fn salvar_arquivo(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let id = cabecalho(&request, "x-envio").unwrap_or_default();
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("envio inválido".into());
    }
    let mut envios = envios().lock().map_err(|_| "o salvamento travou".to_string())?;

    // Envio esquecido (a aba fechou no meio) sai da memória e do disco.
    let agora = Instant::now();
    let vencidos: Vec<String> = envios
        .iter()
        .filter(|(_, e)| agora.duration_since(e.mexido) >= ESQUECIDO_APOS)
        .map(|(k, _)| k.clone())
        .collect();
    for k in vencidos {
        if let Some(e) = envios.remove(&k) {
            descartar(e);
        }
    }

    if cabecalho(&request, "x-cancelar").as_deref() == Some("1") {
        if let Some(e) = envios.remove(&id) {
            descartar(e);
        }
        return Ok(String::new());
    }

    let tauri::ipc::InvokeBody::Raw(dados) = request.body() else {
        return Err("o pedaço não chegou em bytes".into());
    };
    if dados.len() > MAXIMO_DO_PEDACO {
        return Err("pedaço grande demais".into());
    }
    let parte: u32 = cabecalho(&request, "x-parte")
        .and_then(|v| v.parse().ok())
        .ok_or("cabeçalho x-parte ausente")?;
    let fim = cabecalho(&request, "x-fim").as_deref() == Some("1");

    if parte == 0 {
        // Recomeço do mesmo envio: o que tinha chegado não vale mais.
        if let Some(e) = envios.remove(&id) {
            descartar(e);
        }
        let nome = cabecalho(&request, "x-nome")
            .and_then(|v| crate::office::decodificar_percentual(&v))
            .ok_or("cabeçalho x-nome ausente")?;
        let nome = crate::nome_valido(&nome)?;
        let total: u64 = cabecalho(&request, "x-total")
            .and_then(|v| v.parse().ok())
            .ok_or("cabeçalho x-total ausente")?;
        if total == 0 {
            return Err("arquivo vazio".into());
        }
        if total > teto(&nome) {
            return Err("arquivo muito grande".into());
        }
        let parcial = pasta_dos_parciais()?.join(format!("{id}.parcial"));
        let arquivo = std::fs::File::create(&parcial).map_err(|e| e.to_string())?;
        envios.insert(
            id.clone(),
            Envio { arquivo, parcial, nome, total, escritos: 0, proxima: 0, mexido: agora },
        );
    }

    let resultado = match envios.get_mut(&id) {
        Some(envio) => escrever(envio, parte, dados, fim),
        None => return Err("envio desconhecido: comece pelo pedaço 0".into()),
    };
    match resultado {
        Ok(false) => Ok(String::new()),
        Ok(true) => match envios.remove(&id) {
            Some(envio) => concluir(&app, envio),
            None => Err("envio desconhecido".into()),
        },
        Err(e) => {
            if let Some(envio) = envios.remove(&id) {
                descartar(envio);
            }
            Err(e)
        }
    }
}
