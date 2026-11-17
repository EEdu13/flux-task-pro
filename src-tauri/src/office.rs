//! Conversões pelo Office instalado no computador (11/11/2026): Word → PDF, PDF → Word,
//! Excel → PDF e PowerPoint → PDF, um arquivo por vez.
//!
//! WORD — DDE NUMA ÁREA DE TRABALHO INVISÍVEL. Nos PCs da empresa há uma conta Microsoft pessoal
//! ligada ao Windows, além da de trabalho, e o Word comandado por automação (COM) trava em tudo
//! que grava (salvar, exportar PDF, imprimir): na hora de gravar ele tenta falar com a conta
//! on-line, e a resposta nunca chega dentro da chamada de automação. À mão funciona. (Prova de
//! 11/11/2026; o usuário confirmou que os outros PCs têm a mesma combinação de contas.) Então:
//! 1. abre um Word NOVO do jeito normal — `/a` sem suplementos e sem gravar nas configurações da
//!    pessoa, `/m` sem macros automáticas, `/q` sem tela de abertura, `/n` sem documento em
//!    branco — numa área de trabalho invisível própria (`CreateDesktop`): nada do que ele mostrar
//!    aparece na tela, e nem o Word da pessoa nem o duplo clique num .docx o enxergam;
//! 2. manda os comandos por DDE, o caminho antigo do "abrir arquivo" do Windows, que o Word
//!    executa pela própria janela, como um clique (`[FileOpen]`, `[FileSaveAs]`,
//!    `[FileCloseAll 2]`, `[FileExit 2]`);
//! 3. um vigia dá OK (Enter) nos avisos ("o Word vai converter o PDF", "senha incorreta") e,
//!    quando um comando falha, lê o motivo no erro de macro (Continuar / Fim / Depurar) e clica
//!    em Fim.
//!
//! EXCEL E POWERPOINT — AUTOMAÇÃO (COM), que neles funciona (prova de 11/11/2026), chamada direto
//! daqui, sem PowerShell. A thread que conversa com eles fica na área invisível, para o que eles
//! abrirem nascer lá. O PowerPoint é um só por sessão do Windows: se a pessoa já está com ele
//! aberto, a conversão usa o dela, sem janela, e não o fecha no fim.
//!
//! EM TODOS: uma pasta temporária nova por conversão (o Word guarda o caminho que "travou" e
//! pergunta sobre ele da próxima vez); o Word entra num grupo de processos que morre com o app; o
//! que trava e passa do tempo é encerrado; o fechamento e a limpeza correm depois da resposta.
//! O Excel e o PowerPoint nascem pela automação, fora da área invisível (visto em 11/11/2026),
//! escondidos e com os avisos desligados (`DisplayAlerts`). Os erros voltam como
//! "CODIGO|detalhe", e o site traduz pelo código (`src/components/conversor/locais/office.ts`):
//! ENTRADA, SEM_OFFICE, PROTEGIDO, VAZIO, TEMPO, NAO_CONVERTEU.

use std::sync::Mutex;

/// Teto do arquivo recebido: o mesmo do conversor.
const MAXIMO_DE_BYTES: usize = 200 * 1024 * 1024;

/// Uma conversão por vez: dois Office ao mesmo tempo disputariam o computador da pessoa.
static UM_POR_VEZ: Mutex<()> = Mutex::new(());

fn erro(codigo: &str, detalhe: impl std::fmt::Display) -> String {
    format!("{codigo}|{detalhe}")
}

/// Recebe o arquivo em bytes, direto (sem a lista de números dos comandos antigos e sem o teto
/// de 12 MB deles), com o nome em `x-nome` (passado por `encodeURIComponent`) e o destino em
/// `x-para` ("pdf" ou "docx"). Devolve os bytes do arquivo convertido.
#[tauri::command]
pub async fn converter_com_office(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(dados) = request.body() else {
        return Err(erro("ENTRADA", "o arquivo não chegou em bytes"));
    };
    if dados.is_empty() {
        return Err(erro("ENTRADA", "arquivo vazio"));
    }
    if dados.len() > MAXIMO_DE_BYTES {
        return Err(erro("ENTRADA", "arquivo acima de 200 MB"));
    }
    let nome = cabecalho(&request, "x-nome")?;
    let para = cabecalho(&request, "x-para")?;
    let dados = dados.clone();
    let convertido = tauri::async_runtime::spawn_blocking(move || converter(&nome, &para, &dados))
        .await
        .map_err(|e| erro("NAO_CONVERTEU", e))??;
    Ok(tauri::ipc::Response::new(convertido))
}

fn cabecalho(request: &tauri::ipc::Request<'_>, nome: &str) -> Result<String, String> {
    request
        .headers()
        .get(nome)
        .and_then(|v| v.to_str().ok())
        .and_then(decodificar_percentual)
        .ok_or_else(|| erro("ENTRADA", format!("cabeçalho {nome} ausente ou inválido")))
}

/// "Relat%C3%B3rio.docx" → "Relatório.docx": cabeçalho só leva ASCII, então o site manda o nome
/// com `encodeURIComponent`.
pub(crate) fn decodificar_percentual(texto: &str) -> Option<String> {
    let b = texto.as_bytes();
    let mut saida = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            saida.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            saida.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(saida).ok()
}

fn extensao(nome: &str) -> String {
    std::path::Path::new(nome)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// O nome do arquivo na pasta temporária: o do original (o Office o mostra no título e o põe no
/// PDF), só com letras, números e pontuação simples — nada de colchete, que o comando DDE usa —
/// e nunca um nome reservado do Windows.
fn nome_para_a_pasta(nome: &str) -> String {
    let base = std::path::Path::new(nome)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let limpo: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '(' | ')' | ',') { c } else { '_' })
        .take(60)
        .collect();
    let limpo = limpo.trim().to_string();
    let maiusculo = limpo.to_ascii_uppercase();
    let reservado = matches!(maiusculo.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((maiusculo.starts_with("COM") || maiusculo.starts_with("LPT"))
            && maiusculo.len() == 4
            && maiusculo.ends_with(|c: char| c.is_ascii_digit()));
    if limpo.is_empty() || reservado {
        "documento".to_string()
    } else {
        limpo
    }
}

/// Quem converte cada tipo de arquivo.
#[derive(Clone, Copy)]
#[cfg_attr(not(windows), allow(dead_code))]
enum Programa {
    /// O formato do "salvar como" do Word: 17 = PDF, 16 = .docx.
    Word(u32),
    Excel,
    PowerPoint,
}

fn converter(nome: &str, para: &str, dados: &[u8]) -> Result<Vec<u8>, String> {
    let ext = extensao(nome);
    let programa = match (para, ext.as_str()) {
        ("pdf", "doc" | "docx" | "odt" | "rtf") => Programa::Word(17),
        ("docx", "pdf") => Programa::Word(16),
        ("pdf", "xls" | "xlsx" | "ods" | "csv") => Programa::Excel,
        ("pdf", "ppt" | "pptx" | "odp") => Programa::PowerPoint,
        _ => return Err(erro("ENTRADA", format!("o Office não converte .{ext} em .{para} por aqui"))),
    };
    // Arquivo do Office com senha não é um ZIP: ele vai cifrado dentro de um arquivo OLE ("D0 CF 11 E0…").
    if matches!(ext.as_str(), "docx" | "xlsx" | "pptx")
        && dados.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    {
        return Err(erro("PROTEGIDO", format!("o .{ext} está cifrado com senha")));
    }
    let _vez = UM_POR_VEZ.lock().unwrap_or_else(|e| e.into_inner());
    #[cfg(windows)]
    {
        win::converter(programa, &nome_para_a_pasta(nome), &ext, para, dados)
    }
    #[cfg(not(windows))]
    {
        let _ = (programa, dados);
        Err(erro("SEM_OFFICE", "só no Windows"))
    }
}

#[cfg(windows)]
mod win {
    use super::{erro, Programa};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::{Duration, Instant};

    /* Chamadas diretas ao Windows, sem crate, como o `tempo_ocioso_segundos` de `lib.rs`. As
       estruturas seguem o layout do C (conferido na prova de conceito, em C#). */

    pub(super) type Handle = *mut c_void;
    type Bool = i32;
    type EnumProc = unsafe extern "system" fn(Handle, isize) -> Bool;
    type RetornoDde =
        unsafe extern "system" fn(u32, u32, Handle, Handle, Handle, Handle, usize, usize) -> Handle;

    #[repr(C)]
    #[allow(dead_code)]
    struct StartupInfoW {
        cb: u32,
        lp_reserved: *mut u16,
        lp_desktop: *mut u16,
        lp_title: *mut u16,
        dw_x: u32,
        dw_y: u32,
        dw_x_size: u32,
        dw_y_size: u32,
        dw_x_count_chars: u32,
        dw_y_count_chars: u32,
        dw_fill_attribute: u32,
        dw_flags: u32,
        w_show_window: u16,
        cb_reserved2: u16,
        lp_reserved2: *mut u8,
        h_std_input: Handle,
        h_std_output: Handle,
        h_std_error: Handle,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ProcessInformation {
        h_process: Handle,
        h_thread: Handle,
        dw_process_id: u32,
        dw_thread_id: u32,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct Qos {
        length: u32,
        impersonation_level: i32,
        context_tracking_mode: u8,
        effective_only: u8,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ConvContext {
        cb: u32,
        w_flags: u32,
        w_country_id: u32,
        i_code_page: i32,
        dw_lang_id: u32,
        dw_security: u32,
        qos: Qos,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ConvInfo {
        cb: u32,
        h_user: usize,
        h_conv_partner: Handle,
        hsz_svc_partner: Handle,
        hsz_service_req: Handle,
        hsz_topic: Handle,
        hsz_item: Handle,
        w_fmt: u32,
        w_type: u32,
        w_status: u32,
        w_convst: u32,
        w_last_error: u32,
        h_conv_list: Handle,
        conv_ctxt: ConvContext,
        hwnd: Handle,
        hwnd_partner: Handle,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct LimitesBasicos {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct LimitesEstendidos {
        basicos: LimitesBasicos,
        io: [u64; 6],
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[repr(C)]
    #[allow(dead_code)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[link(name = "user32")]
    extern "system" {
        fn CreateDesktopW(
            nome: *const u16,
            dispositivo: *const u16,
            modo: *const c_void,
            flags: u32,
            acesso: u32,
            seguranca: *const c_void,
        ) -> Handle;
        fn CloseDesktop(mesa: Handle) -> Bool;
        fn SetThreadDesktop(mesa: Handle) -> Bool;
        fn EnumDesktopWindows(mesa: Handle, f: EnumProc, l: isize) -> Bool;
        fn EnumChildWindows(pai: Handle, f: EnumProc, l: isize) -> Bool;
        fn GetWindowThreadProcessId(janela: Handle, pid: *mut u32) -> u32;
        fn IsWindowVisible(janela: Handle) -> Bool;
        fn GetWindowTextW(janela: Handle, texto: *mut u16, tamanho: i32) -> i32;
        fn GetClassNameW(janela: Handle, classe: *mut u16, tamanho: i32) -> i32;
        fn PostMessageW(janela: Handle, mensagem: u32, w: usize, l: isize) -> Bool;
        fn DdeInitializeW(inst: *mut u32, retorno: RetornoDde, comandos: u32, reservado: u32) -> u32;
        fn DdeCreateStringHandleW(inst: u32, texto: *const u16, pagina: i32) -> Handle;
        fn DdeFreeStringHandle(inst: u32, hsz: Handle) -> Bool;
        fn DdeConnectList(inst: u32, servico: Handle, topico: Handle, lista: Handle, contexto: *const c_void) -> Handle;
        fn DdeQueryNextServer(lista: Handle, anterior: Handle) -> Handle;
        fn DdeQueryConvInfo(conversa: Handle, transacao: u32, info: *mut ConvInfo) -> u32;
        fn DdeClientTransaction(
            dados: *const u8,
            tamanho: u32,
            conversa: Handle,
            item: Handle,
            formato: u32,
            tipo: u32,
            espera_ms: u32,
            resultado: *mut u32,
        ) -> Handle;
        fn DdeDisconnectList(lista: Handle) -> Bool;
        fn DdeUninitialize(inst: u32) -> Bool;
        fn DdeGetLastError(inst: u32) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateProcessW(
            aplicativo: *const u16,
            linha: *mut u16,
            atributos_do_processo: *const c_void,
            atributos_da_thread: *const c_void,
            herda: Bool,
            flags: u32,
            ambiente: *const c_void,
            pasta: *const u16,
            inicio: *const StartupInfoW,
            processo: *mut ProcessInformation,
        ) -> Bool;
        fn TerminateProcess(processo: Handle, codigo: u32) -> Bool;
        fn WaitForSingleObject(objeto: Handle, ms: u32) -> u32;
        fn CloseHandle(objeto: Handle) -> Bool;
        fn OpenProcess(acesso: u32, herda: Bool, pid: u32) -> Handle;
        fn QueryFullProcessImageNameW(processo: Handle, flags: u32, nome: *mut u16, tamanho: *mut u32) -> Bool;
        fn ResumeThread(thread: Handle) -> u32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(foto: Handle, entrada: *mut ProcessEntry32W) -> Bool;
        fn Process32NextW(foto: Handle, entrada: *mut ProcessEntry32W) -> Bool;
        fn CreateJobObjectW(seguranca: *const c_void, nome: *const u16) -> Handle;
        fn SetInformationJobObject(grupo: Handle, classe: i32, info: *const c_void, tamanho: u32) -> Bool;
        fn AssignProcessToJobObject(grupo: Handle, processo: Handle) -> Bool;
    }

    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            chave: Handle,
            subchave: *const u16,
            valor: *const u16,
            flags: u32,
            tipo: *mut u32,
            dados: *mut c_void,
            tamanho: *mut u32,
        ) -> i32;
    }

    const GENERIC_ALL: u32 = 0x1000_0000;
    const STARTF_USESHOWWINDOW: u32 = 0x1;
    const SW_SHOWNORMAL: u16 = 1;
    const CREATE_SUSPENDED: u32 = 0x4;
    const APPCMD_CLIENTONLY: u32 = 0x10;
    const CP_WINUNICODE: i32 = 1200;
    const CF_UNICODETEXT: u32 = 13;
    const XTYP_EXECUTE: u32 = 0x4050;
    const QID_SYNC: u32 = 0xFFFF_FFFF;
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const BM_CLICK: u32 = 0x00F5;
    const VK_RETURN: usize = 0x0D;
    const VK_ESCAPE: usize = 0x1B;
    const WAIT_OBJECT_0: u32 = 0;
    const PROCESS_TERMINATE: u32 = 0x0001;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const RRF_RT_REG_SZ_OU_EXPAND: u32 = 0x2 | 0x4;
    const HKEY_LOCAL_MACHINE: isize = 0x8000_0002u32 as i32 as isize;
    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;

    /// As classes de janela dos avisos do Office: o clássico, o próprio do Word e o moderno.
    const AVISOS: &[&str] = &["#32770", "bosa_sdm_msword", "NUIDialog"];
    /// Mais avisos que isto numa conversão = algo preso (pedido de conta, ativação…): desiste.
    const LIMITE_DE_RESPOSTAS: u32 = 6;
    /// O que pode ser encerrado no fim, se ainda tiver janela na área invisível. O PowerPoint
    /// fica de fora: ele é um só por sessão e pode ser o da pessoa.
    const DO_OFFICE: &[&str] = &["winword.exe", "pdfreflow.exe", "ai.exe", "excel.exe"];

    static CONTADOR: AtomicU32 = AtomicU32::new(0);

    pub(super) fn largo(texto: &str) -> Vec<u16> {
        texto.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn texto_da_janela(janela: Handle) -> String {
        let mut b = [0u16; 1024];
        let n = unsafe { GetWindowTextW(janela, b.as_mut_ptr(), b.len() as i32) };
        String::from_utf16_lossy(&b[..n.max(0) as usize])
    }

    fn classe_da_janela(janela: Handle) -> String {
        let mut b = [0u16; 256];
        let n = unsafe { GetClassNameW(janela, b.as_mut_ptr(), b.len() as i32) };
        String::from_utf16_lossy(&b[..n.max(0) as usize])
    }

    pub(super) fn pid_da_janela(janela: Handle) -> u32 {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(janela, &mut pid) };
        pid
    }

    /// Ponte do `EnumWindows` do Windows para uma closure: `l` aponta para ela.
    unsafe extern "system" fn trampolim(janela: Handle, l: isize) -> Bool {
        let f = &mut *(l as *mut &mut dyn FnMut(Handle) -> bool);
        Bool::from((**f)(janela))
    }

    /// As janelas de primeiro nível da área invisível; `f` devolve `false` para parar.
    fn janelas_da_mesa(mesa: Handle, mut f: impl FnMut(Handle) -> bool) {
        let mut g: &mut dyn FnMut(Handle) -> bool = &mut f;
        unsafe { EnumDesktopWindows(mesa, trampolim, &mut g as *mut &mut dyn FnMut(Handle) -> bool as isize) };
    }

    fn janelas_filhas(pai: Handle, mut f: impl FnMut(Handle) -> bool) {
        let mut g: &mut dyn FnMut(Handle) -> bool = &mut f;
        unsafe { EnumChildWindows(pai, trampolim, &mut g as *mut &mut dyn FnMut(Handle) -> bool as isize) };
    }

    /// Enter ou Esc para o aviso e para o que há dentro dele (o aviso moderno desenha os botões
    /// numa janela interna).
    fn teclar(aviso: Handle, tecla: usize) {
        let enviar = |j: Handle| unsafe {
            PostMessageW(j, WM_KEYDOWN, tecla, 0);
            PostMessageW(j, WM_KEYUP, tecla, 0);
        };
        enviar(aviso);
        janelas_filhas(aviso, |f| {
            enviar(f);
            true
        });
    }

    /// Clica no botão cujo texto (sem o "&" do atalho) é um dos dados.
    fn clicar(aviso: Handle, textos: &[&str]) -> bool {
        let mut botao: Handle = null_mut();
        janelas_filhas(aviso, |f| {
            if classe_da_janela(f) == "Button" && textos.contains(&texto_da_janela(f).replace('&', "").as_str()) {
                botao = f;
                return false;
            }
            true
        });
        if botao.is_null() {
            return false;
        }
        unsafe { PostMessageW(botao, BM_CLICK, 0, 0) };
        true
    }

    /// O que o aviso diz, juntando os textos de dentro dele.
    fn textos_de_dentro(aviso: Handle) -> String {
        let mut partes = Vec::new();
        janelas_filhas(aviso, |f| {
            let t = texto_da_janela(f);
            if !t.trim().is_empty() && unsafe { IsWindowVisible(f) } != 0 {
                partes.push(t.replace(['\r', '\n'], " "));
            }
            true
        });
        partes.join(" | ")
    }

    /// O primeiro aviso visível na área invisível: (janela, classe, título).
    fn achar_aviso(mesa: Handle) -> Option<(Handle, String, String)> {
        let mut achado = None;
        janelas_da_mesa(mesa, |j| {
            if unsafe { IsWindowVisible(j) } == 0 {
                return true;
            }
            let classe = classe_da_janela(j);
            if !AVISOS.contains(&classe.as_str()) {
                return true;
            }
            achado = Some((j, classe, texto_da_janela(j)));
            false
        });
        achado
    }

    /// Para o registro: as janelas visíveis da área invisível, "pid [classe] 'título'".
    fn janelas_visiveis(mesa: Handle) -> String {
        let mut partes = Vec::new();
        janelas_da_mesa(mesa, |j| {
            if unsafe { IsWindowVisible(j) } != 0 {
                partes.push(format!("{} [{}] '{}'", pid_da_janela(j), classe_da_janela(j), texto_da_janela(j)));
            }
            true
        });
        if partes.is_empty() {
            "nenhuma".to_string()
        } else {
            partes.join("; ")
        }
    }

    /// O motivo de uma falha, em código: senha → PROTEGIDO; planilha sem nada → VAZIO.
    pub(super) fn classificar(motivo: &str) -> String {
        let m = motivo.to_lowercase();
        if m.contains("1312") || m.contains("senha") || m.contains("password") {
            erro("PROTEGIDO", motivo)
        } else if m.contains("nada para imprimir") || m.contains("nothing to print") {
            erro("VAZIO", motivo)
        } else {
            erro("NAO_CONVERTEU", motivo)
        }
    }

    /// Um "grupo de processos" do Windows que morre com o app: o Word aberto pela conversão entra
    /// nele e, se o app fechar no meio (ou cair), o próprio Windows o encerra — em vez de ele ficar
    /// esquecido na área invisível até o PC reiniciar. Criado uma vez e nunca fechado à mão: fecha
    /// quando o app sai, e é isso que dispara o encerramento (testado em 11/11/2026). Só o Word:
    /// ver `guardar_pid`, do Excel e do PowerPoint.
    fn grupo_que_morre_com_o_app() -> Option<Handle> {
        static GRUPO: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
        let g = *GRUPO.get_or_init(|| unsafe {
            let grupo = CreateJobObjectW(null(), null());
            if grupo.is_null() {
                return 0;
            }
            let mut limites: LimitesEstendidos = std::mem::zeroed();
            limites.basicos.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                grupo,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &limites as *const LimitesEstendidos as *const c_void,
                std::mem::size_of::<LimitesEstendidos>() as u32,
            );
            if ok == 0 {
                CloseHandle(grupo);
                return 0;
            }
            grupo as usize
        });
        (g != 0).then_some(g as Handle)
    }

    fn por_no_grupo(processo: Handle) {
        let ok = grupo_que_morre_com_o_app()
            .is_some_and(|grupo| unsafe { AssignProcessToJobObject(grupo, processo) } != 0);
        if !ok {
            log::warn!(
                "office: o processo ficou fora do grupo que morre com o app: {}",
                std::io::Error::last_os_error()
            );
        }
    }

    /// Os pids dos processos com este executável ("POWERPNT.EXE"), pela foto de processos do Windows.
    pub(super) fn pids_de(executavel: &str) -> Vec<u32> {
        const TH32CS_SNAPPROCESS: u32 = 0x2;
        let mut pids = Vec::new();
        let foto = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if foto.is_null() || foto as isize == -1 {
            return pids;
        }
        // SAFETY: estrutura do Windows zerada, com o tamanho preenchido como a API pede.
        let mut e: ProcessEntry32W = unsafe { std::mem::zeroed() };
        e.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut tem = unsafe { Process32FirstW(foto, &mut e) } != 0;
        while tem {
            let fim = e.sz_exe_file.iter().position(|&c| c == 0).unwrap_or(e.sz_exe_file.len());
            if String::from_utf16_lossy(&e.sz_exe_file[..fim]).eq_ignore_ascii_case(executavel) {
                pids.push(e.th32_process_id);
            }
            tem = unsafe { Process32NextW(foto, &mut e) } != 0;
        }
        unsafe { CloseHandle(foto) };
        pids
    }

    fn encerrar_pid(pid: u32) {
        let h = unsafe { OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, 0, pid) };
        if h.is_null() {
            return;
        }
        unsafe {
            TerminateProcess(h, 1);
            WaitForSingleObject(h, 3_000);
            CloseHandle(h);
        }
    }

    /// Quem ainda tem janela na área invisível só pode ter vindo desta conversão. Encerra só o
    /// que for do Office (`DO_OFFICE`), e nunca o próprio app, que também tem janelas ali (as do
    /// DDE e da automação).
    fn encerrar_o_que_sobrou(mesa: Handle) {
        let eu = std::process::id();
        let mut pids: Vec<u32> = Vec::new();
        janelas_da_mesa(mesa, |j| {
            let p = pid_da_janela(j);
            if p != 0 && p != eu && !pids.contains(&p) {
                pids.push(p);
            }
            true
        });
        for p in pids {
            let h = unsafe { OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, 0, p) };
            if h.is_null() {
                continue;
            }
            let mut b = [0u16; 1024];
            let mut n = b.len() as u32;
            let nome = if unsafe { QueryFullProcessImageNameW(h, 0, b.as_mut_ptr(), &mut n) } != 0 {
                String::from_utf16_lossy(&b[..n as usize]).rsplit('\\').next().unwrap_or("").to_ascii_lowercase()
            } else {
                String::new()
            };
            if DO_OFFICE.contains(&nome.as_str()) {
                log::info!("office: encerrando {nome} (pid {p}) que sobrou na área invisível");
                unsafe {
                    TerminateProcess(h, 1);
                    WaitForSingleObject(h, 3_000);
                }
            }
            unsafe { CloseHandle(h) };
        }
    }

    /// Uma área de trabalho invisível, só desta conversão. Fecha quando sai de cena.
    struct Mesa {
        handle: Handle,
        nome: String,
    }

    // SAFETY: o handle da área de trabalho vale em qualquer thread do app.
    unsafe impl Send for Mesa {}

    impl Mesa {
        fn criar(nome: &str) -> Result<Mesa, String> {
            let w = largo(nome);
            let handle = unsafe { CreateDesktopW(w.as_ptr(), null(), null(), 0, GENERIC_ALL, null()) };
            if handle.is_null() {
                return Err(erro(
                    "NAO_CONVERTEU",
                    format!("área invisível: {}", std::io::Error::last_os_error()),
                ));
            }
            Ok(Mesa { handle, nome: nome.to_string() })
        }
    }

    impl Drop for Mesa {
        fn drop(&mut self) {
            unsafe { CloseDesktop(self.handle) };
        }
    }

    /// O WINWORD.EXE instalado: o registro do "App Paths" (o mesmo que o Executar do Windows usa)
    /// e, se faltar, os lugares de sempre do Office 365.
    fn caminho_do_word() -> Option<PathBuf> {
        let subchave = largo(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe");
        for raiz in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let mut tamanho = 0u32;
            let r = unsafe {
                RegGetValueW(raiz as Handle, subchave.as_ptr(), null(), RRF_RT_REG_SZ_OU_EXPAND, null_mut(), null_mut(), &mut tamanho)
            };
            if r != 0 || tamanho < 4 {
                continue;
            }
            let mut b = vec![0u16; tamanho as usize / 2 + 1];
            let r = unsafe {
                RegGetValueW(
                    raiz as Handle,
                    subchave.as_ptr(),
                    null(),
                    RRF_RT_REG_SZ_OU_EXPAND,
                    null_mut(),
                    b.as_mut_ptr() as *mut c_void,
                    &mut tamanho,
                )
            };
            if r != 0 {
                continue;
            }
            let fim = b.iter().position(|&c| c == 0).unwrap_or(b.len());
            let caminho = PathBuf::from(String::from_utf16_lossy(&b[..fim]).trim_matches('"'));
            if caminho.is_file() {
                return Some(caminho);
            }
        }
        [
            r"C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE",
            r"C:\Program Files (x86)\Microsoft Office\root\Office16\WINWORD.EXE",
        ]
        .into_iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
    }

    /// Converte `dados` (o arquivo `base.ext`) em `base.para`, pelo programa do Office certo.
    pub fn converter(programa: Programa, base: &str, ext: &str, para: &str, dados: &[u8]) -> Result<Vec<u8>, String> {
        let raiz = std::env::temp_dir().join("conecta-office");
        limpar_sobras(&raiz);
        let agora = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let id = format!("{}-{}-{agora}", std::process::id(), CONTADOR.fetch_add(1, Ordering::Relaxed));
        let pasta = raiz.join(&id);
        std::fs::create_dir_all(&pasta).map_err(|e| erro("NAO_CONVERTEU", format!("pasta temporária: {e}")))?;
        let entrada = pasta.join(format!("{base}.{ext}"));
        let saida = pasta.join(format!("{base}.{para}"));
        if let Err(e) = std::fs::write(&entrada, dados) {
            apagar_pasta(&pasta);
            return Err(erro("NAO_CONVERTEU", format!("gravar a entrada: {e}")));
        }
        let mesa = match Mesa::criar(&format!("conecta-office-{id}")) {
            Ok(m) => m,
            Err(e) => {
                apagar_pasta(&pasta);
                return Err(e);
            }
        };
        let (feito, sessao) = match programa {
            Programa::Word(formato) => match Sessao::abrir(&mesa) {
                Ok(mut s) => {
                    log::info!("office: Word aberto na área invisível (pid {})", s.pid);
                    (s.converter(&entrada, &saida, base, formato), Some(s))
                }
                Err(e) => (Err(e), None),
            },
            Programa::Excel => (pelo_com(&mesa, Com::Excel, &entrada, &saida, ext), None),
            Programa::PowerPoint => (pelo_com(&mesa, Com::PowerPoint, &entrada, &saida, ext), None),
        };
        let resultado = feito.and_then(|()| {
            std::fs::read(&saida).map_err(|e| erro("NAO_CONVERTEU", format!("ler o convertido: {e}")))
        });
        match &resultado {
            Ok(b) => log::info!("office: convertido, {} bytes", b.len()),
            Err(e) => log::warn!("office: {e}"),
        }
        // Fechar o Office leva uns segundos: acontece depois da resposta, sem a pessoa esperar.
        let limpeza = Limpeza { sessao, mesa, pasta };
        std::thread::spawn(move || limpeza.concluir());
        resultado
    }

    /// O que sobra de uma conversão, para fechar e apagar depois de responder. A ordem dos campos
    /// importa: o Word fecha antes de a área invisível ser fechada.
    struct Limpeza {
        sessao: Option<Sessao>,
        mesa: Mesa,
        pasta: PathBuf,
    }

    impl Limpeza {
        fn concluir(mut self) {
            if let Some(s) = self.sessao.as_mut() {
                s.fechar();
            }
            self.sessao = None;
            encerrar_o_que_sobrou(self.mesa.handle);
            apagar_pasta(&self.pasta);
        }
    }

    /// Pastas de conversões antigas (de um app fechado no meio, por exemplo): fora depois de um dia.
    fn limpar_sobras(raiz: &Path) {
        let Ok(itens) = std::fs::read_dir(raiz) else { return };
        for item in itens.flatten() {
            let velha = item
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|idade| idade > Duration::from_secs(24 * 3600));
            if velha {
                let _ = std::fs::remove_dir_all(item.path());
            }
        }
    }

    /// O Office pode segurar os arquivos por um instante depois de sair.
    fn apagar_pasta(pasta: &Path) {
        for _ in 0..10 {
            if std::fs::remove_dir_all(pasta).is_ok() || !pasta.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }

    /// O arquivo gravado existe, tem conteúdo e o Office já o soltou.
    fn arquivo_pronto(caminho: &Path) -> bool {
        use std::os::windows::fs::OpenOptionsExt;
        matches!(std::fs::metadata(caminho), Ok(m) if m.len() > 0)
            && std::fs::OpenOptions::new().read(true).share_mode(0).open(caminho).is_ok()
    }

    fn resumo(comando: &str) -> &str {
        comando.split_whitespace().next().unwrap_or(comando).trim_matches(|c| c == '[' || c == ']')
    }

    /* ------------------------------- Word, por DDE ------------------------------- */

    enum Dde {
        Feito,
        SemServidor,
        Falhou(u32),
    }

    unsafe extern "system" fn retorno_vazio(
        _: u32,
        _: u32,
        _: Handle,
        _: Handle,
        _: Handle,
        _: Handle,
        _: usize,
        _: usize,
    ) -> Handle {
        null_mut()
    }

    /// Um comando DDE para o Word do processo `pid`. Roda numa thread própria, que passa para a
    /// área invisível: o DDE só alcança janelas da mesma área de trabalho.
    fn transacao_dde(mesa: Handle, pid: u32, comando: &[u16], espera_ms: u32) -> Dde {
        // SAFETY: chamadas ao Windows com ponteiros para buffers vivos durante a chamada.
        unsafe {
            if SetThreadDesktop(mesa) == 0 {
                return Dde::Falhou(0xFFFF_0001);
            }
            let mut inst = 0u32;
            if DdeInitializeW(&mut inst, retorno_vazio, APPCMD_CLIENTONLY, 0) != 0 {
                return Dde::Falhou(0xFFFF_0002);
            }
            let servico = largo("WinWord");
            let topico = largo("System");
            let hs = DdeCreateStringHandleW(inst, servico.as_ptr(), CP_WINUNICODE);
            let ht = DdeCreateStringHandleW(inst, topico.as_ptr(), CP_WINUNICODE);
            let lista = DdeConnectList(inst, hs, ht, null_mut(), null());
            let mut resposta = Dde::SemServidor;
            if !lista.is_null() {
                let mut conversa: Handle = null_mut();
                loop {
                    conversa = DdeQueryNextServer(lista, conversa);
                    if conversa.is_null() {
                        break;
                    }
                    let mut info: ConvInfo = std::mem::zeroed();
                    info.cb = std::mem::size_of::<ConvInfo>() as u32;
                    if DdeQueryConvInfo(conversa, QID_SYNC, &mut info) == 0 || pid_da_janela(info.hwnd_partner) != pid {
                        continue;
                    }
                    // O texto vai com o zero do fim, em UTF-16 (cliente e Word são Unicode).
                    let bytes: Vec<u8> = comando.iter().flat_map(|c| c.to_le_bytes()).collect();
                    let mut r = 0u32;
                    let feito = DdeClientTransaction(
                        bytes.as_ptr(),
                        bytes.len() as u32,
                        conversa,
                        null_mut(),
                        CF_UNICODETEXT,
                        XTYP_EXECUTE,
                        espera_ms,
                        &mut r,
                    );
                    resposta = if feito.is_null() { Dde::Falhou(DdeGetLastError(inst)) } else { Dde::Feito };
                    break;
                }
                DdeDisconnectList(lista);
            }
            DdeFreeStringHandle(inst, hs);
            DdeFreeStringHandle(inst, ht);
            DdeUninitialize(inst);
            resposta
        }
    }

    /// Um Word aberto numa área invisível (`mesa`, que é de quem chamou e vive mais que a sessão).
    struct Sessao {
        mesa: Handle,
        processo: Handle,
        pid: u32,
        respostas: u32,
        erro_de_comando: Option<String>,
        /// Entre o FileOpen e o FileCloseAll: o `fechar` precisa saber.
        documento_aberto: bool,
        fechada: bool,
    }

    // SAFETY: os handles do processo e da área de trabalho valem em qualquer thread do app.
    unsafe impl Send for Sessao {}

    impl Sessao {
        fn abrir(mesa: &Mesa) -> Result<Sessao, String> {
            let word = caminho_do_word()
                .ok_or_else(|| erro("SEM_OFFICE", "o Word não foi encontrado neste computador"))?;
            let mut lugar = largo(&format!("WinSta0\\{}", mesa.nome));
            // SAFETY: estrutura do Windows, toda em zero menos o que é preenchido abaixo.
            let mut inicio: StartupInfoW = unsafe { std::mem::zeroed() };
            inicio.cb = std::mem::size_of::<StartupInfoW>() as u32;
            inicio.lp_desktop = lugar.as_mut_ptr();
            inicio.dw_flags = STARTF_USESHOWWINDOW;
            inicio.w_show_window = SW_SHOWNORMAL;
            let mut linha: Vec<u16> = vec!['"' as u16];
            linha.extend(word.as_os_str().encode_wide());
            linha.extend("\" /a /m /q /n".encode_utf16());
            linha.push(0);
            let mut processo: ProcessInformation = unsafe { std::mem::zeroed() };
            // Nasce parado, para entrar no grupo que morre com o app antes de abrir qualquer filho.
            let ok = unsafe {
                CreateProcessW(
                    null(),
                    linha.as_mut_ptr(),
                    null(),
                    null(),
                    0,
                    CREATE_SUSPENDED,
                    null(),
                    null(),
                    &inicio,
                    &mut processo,
                )
            };
            if ok == 0 {
                return Err(erro(
                    "SEM_OFFICE",
                    format!("o Word não abriu: {}", std::io::Error::last_os_error()),
                ));
            }
            por_no_grupo(processo.h_process);
            unsafe {
                ResumeThread(processo.h_thread);
                CloseHandle(processo.h_thread);
            }
            Ok(Sessao {
                mesa: mesa.handle,
                processo: processo.h_process,
                pid: processo.dw_process_id,
                respostas: 0,
                erro_de_comando: None,
                documento_aberto: false,
                fechada: false,
            })
        }

        /// Abre o arquivo, grava no formato pedido e fecha o documento.
        fn converter(&mut self, entrada: &Path, saida: &Path, base: &str, formato: u32) -> Result<(), String> {
            /* A senha falsa faz o arquivo protegido falhar com "senha incorreta" em vez de pedir a
               senha; o arquivo sem senha a ignora. */
            let abrir = format!(
                "[FileOpen .Name = \"{}\", .ConfirmConversions = 0, .ReadOnly = 1, .AddToMru = 0, .PasswordDoc = \"x\"]",
                entrada.display()
            );
            self.executar(&abrir, Duration::from_secs(120))?;
            self.documento_aberto = true;
            // O DDE responde antes de o Word terminar (ou falhar): o título diz que abriu.
            let procurado = base.to_lowercase();
            if !self.esperar(Duration::from_secs(120), |s| s.titulo().to_lowercase().contains(&procurado))? {
                return Err(erro("TEMPO", "o Word não abriu o arquivo a tempo"));
            }
            let salvar = format!("[FileSaveAs .Name = \"{}\", .Format = {formato}]", saida.display());
            self.executar(&salvar, Duration::from_secs(180))?;
            /* O Word executa os comandos em fila: o FileCloseAll só roda depois que o salvar
               terminou, e solta o arquivo gravado (o .docx fica aberto depois do "salvar como"). */
            self.executar("[FileCloseAll 2]", Duration::from_secs(60))?;
            self.documento_aberto = false;
            if !self.esperar(Duration::from_secs(60), |_| arquivo_pronto(saida))? {
                return Err(erro("TEMPO", "o Word não terminou de gravar a tempo"));
            }
            Ok(())
        }

        /// Manda um comando e espera a resposta do Word, vigiando os avisos enquanto isso.
        fn executar(&mut self, comando: &str, espera: Duration) -> Result<(), String> {
            let limite = Instant::now() + espera;
            loop {
                let (tx, rx) = mpsc::channel();
                let (mesa, pid, texto) = (self.mesa as usize, self.pid, largo(comando));
                let ms = u32::try_from(espera.as_millis()).unwrap_or(u32::MAX);
                std::thread::spawn(move || {
                    let _ = tx.send(transacao_dde(mesa as Handle, pid, &texto, ms));
                });
                let resposta = loop {
                    match rx.recv_timeout(Duration::from_millis(200)) {
                        Ok(r) => break r,
                        Err(mpsc::RecvTimeoutError::Disconnected) => break Dde::Falhou(0),
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            self.vigiar()?;
                            if Instant::now() > limite + Duration::from_secs(5) {
                                return Err(erro("TEMPO", format!("o Word não respondeu ao {}", resumo(comando))));
                            }
                        }
                    }
                };
                match resposta {
                    Dde::Feito => return Ok(()),
                    // O Word ainda está abrindo: o DDE dele ainda não existe.
                    Dde::SemServidor if Instant::now() < limite => {
                        self.vigiar()?;
                        std::thread::sleep(Duration::from_millis(300));
                    }
                    Dde::SemServidor => return Err(erro("TEMPO", "o Word não ficou pronto")),
                    Dde::Falhou(codigo) => {
                        // A falha do comando chega logo depois, como erro de macro com o motivo.
                        let _ = self.assentar(Duration::from_millis(1500));
                        if let Some(motivo) = &self.erro_de_comando {
                            return Err(classificar(motivo));
                        }
                        return Err(erro("NAO_CONVERTEU", format!("DDE 0x{codigo:x} no {}", resumo(comando))));
                    }
                }
            }
        }

        /// Espera `pronto` ficar verdadeiro, vigiando os avisos. Se um comando falhou, para na hora.
        fn esperar(&mut self, ate: Duration, mut pronto: impl FnMut(&Sessao) -> bool) -> Result<bool, String> {
            let inicio = Instant::now();
            let fim = inicio + ate;
            let mut proximo_registro = inicio + Duration::from_secs(10);
            loop {
                self.vigiar()?;
                if let Some(motivo) = &self.erro_de_comando {
                    return Err(classificar(motivo));
                }
                if pronto(self) {
                    return Ok(true);
                }
                let agora = Instant::now();
                if agora >= proximo_registro || agora >= fim {
                    log::info!(
                        "office: esperando há {} s; título '{}'; janelas: {}",
                        inicio.elapsed().as_secs(),
                        self.titulo(),
                        janelas_visiveis(self.mesa)
                    );
                    proximo_registro = agora + Duration::from_secs(10);
                }
                if agora >= fim {
                    return Ok(false);
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        }

        fn assentar(&mut self, tempo: Duration) -> Result<(), String> {
            let fim = Instant::now() + tempo;
            while Instant::now() < fim {
                self.vigiar()?;
                std::thread::sleep(Duration::from_millis(150));
            }
            Ok(())
        }

        /// Olha a área invisível uma vez. Erro de macro (o comando falhou): guarda o motivo e clica
        /// em Fim. Outro aviso: Enter, que é o OK.
        fn vigiar(&mut self) -> Result<(), String> {
            if unsafe { WaitForSingleObject(self.processo, 0) } == WAIT_OBJECT_0 {
                return Err(erro("NAO_CONVERTEU", "o Word fechou no meio da conversão"));
            }
            let Some((aviso, classe, titulo)) = achar_aviso(self.mesa) else {
                return Ok(());
            };
            if classe == "#32770" && titulo == "Microsoft Visual Basic" {
                let motivo = textos_de_dentro(aviso);
                log::info!("office: o Word recusou o comando: {motivo}");
                self.erro_de_comando = Some(motivo);
                if !clicar(aviso, &["Fim", "End", "Finalizar", "Fin", "Beenden"]) {
                    teclar(aviso, VK_ESCAPE);
                }
            } else {
                self.respostas += 1;
                log::info!("office: OK no aviso '{titulo}' ({classe})");
                if self.respostas > LIMITE_DE_RESPOSTAS {
                    return Err(erro("NAO_CONVERTEU", format!("um aviso do Word não fechou ({titulo})")));
                }
                teclar(aviso, VK_RETURN);
            }
            std::thread::sleep(Duration::from_millis(400));
            Ok(())
        }

        /// Os títulos das janelas principais do Word, que trazem o nome do documento aberto. São
        /// todas: o Word tem mais de uma, e a primeira da lista pode ser uma escondida, sem título.
        fn titulo(&self) -> String {
            let mut titulos = Vec::new();
            let pid = self.pid;
            janelas_da_mesa(self.mesa, |j| {
                if pid_da_janela(j) == pid && classe_da_janela(j) == "OpusApp" {
                    titulos.push(texto_da_janela(j));
                }
                true
            });
            titulos.join(" | ")
        }

        /// Fecha o Word sem salvar nada.
        fn fechar(&mut self) {
            if self.fechada {
                return;
            }
            self.fechada = true;
            if unsafe { WaitForSingleObject(self.processo, 0) } != WAIT_OBJECT_0 {
                /* Com documento aberto, o FileExit sozinho não fez o Word sair (11/11/2026):
                   primeiro fecha os documentos. Sem documento, o FileCloseAll daria erro 509. */
                if self.documento_aberto {
                    let _ = self.executar("[FileCloseAll 2]", Duration::from_secs(10));
                }
                let _ = self.executar("[FileExit 2]", Duration::from_secs(10));
                if unsafe { WaitForSingleObject(self.processo, 10_000) } != WAIT_OBJECT_0 {
                    log::warn!("office: o Word não saiu sozinho; encerrando");
                    unsafe {
                        TerminateProcess(self.processo, 1);
                        WaitForSingleObject(self.processo, 5_000);
                    }
                }
            }
            unsafe { CloseHandle(self.processo) };
        }
    }

    impl Drop for Sessao {
        fn drop(&mut self) {
            self.fechar();
        }
    }

    /* --------------------------- Excel e PowerPoint, por COM --------------------------- */

    #[derive(Clone, Copy, PartialEq)]
    enum Com {
        Excel,
        PowerPoint,
    }

    /// Excel e PowerPoint pela automação, numa thread presa à área invisível; esta aqui vigia os
    /// avisos e o tempo.
    fn pelo_com(mesa: &Mesa, qual: Com, entrada: &Path, saida: &Path, ext: &str) -> Result<(), String> {
        let nome = if qual == Com::Excel { "Excel" } else { "PowerPoint" };
        let pid = Arc::new(AtomicU32::new(0));
        let (tx, rx) = mpsc::channel();
        let (m, e, s, p) = (mesa.handle as usize, entrada.to_path_buf(), saida.to_path_buf(), pid.clone());
        let csv = ext == "csv";
        std::thread::spawn(move || {
            let r = if unsafe { SetThreadDesktop(m as Handle) } == 0 {
                Err(erro(
                    "NAO_CONVERTEU",
                    format!("área invisível: {}", std::io::Error::last_os_error()),
                ))
            } else {
                com::na_thread(|| match qual {
                    Com::Excel => com::excel_para_pdf(&e, &s, &p, csv),
                    Com::PowerPoint => com::powerpoint_para_pdf(&e, &s, &p),
                })
            };
            let _ = tx.send(r);
        });
        let fim = Instant::now() + Duration::from_secs(180);
        let mut respostas = 0u32;
        let mut onde_nasceu_registrado = false;
        loop {
            // Para o registro: o programa aberto pela automação nasceu na área invisível?
            let p = pid.load(Ordering::Relaxed);
            if p != 0 && !onde_nasceu_registrado {
                onde_nasceu_registrado = true;
                let mut na_mesa = false;
                janelas_da_mesa(mesa.handle, |j| {
                    na_mesa = pid_da_janela(j) == p;
                    !na_mesa
                });
                log::info!(
                    "office: o {nome} (pid {p}) nasceu {}",
                    if na_mesa { "na área invisível" } else { "FORA da área invisível" }
                );
            }
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(r) => return r,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(erro("NAO_CONVERTEU", format!("o {nome} parou no meio")))
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some((aviso, classe, titulo)) = achar_aviso(mesa.handle) {
                        respostas += 1;
                        log::info!("office: OK no aviso '{titulo}' ({classe}) do {nome}");
                        if respostas <= LIMITE_DE_RESPOSTAS {
                            teclar(aviso, VK_RETURN);
                            std::thread::sleep(Duration::from_millis(400));
                        }
                    }
                    if Instant::now() > fim || respostas > LIMITE_DE_RESPOSTAS {
                        // Encerra só o que esta conversão abriu (nunca o PowerPoint da pessoa).
                        let p = pid.load(Ordering::Relaxed);
                        if p != 0 {
                            encerrar_pid(p);
                        }
                        return Err(erro("TEMPO", format!("o {nome} não respondeu a tempo")));
                    }
                }
            }
        }
    }

    /// Automação por `IDispatch` (o "late binding" do VBScript), direto nas funções do Windows.
    mod com {
        use super::{classificar, erro, largo, pid_da_janela, pids_de, Handle};
        use std::ffi::c_void;
        use std::path::Path;
        use std::ptr::{null, null_mut};
        use std::sync::atomic::{AtomicU32, Ordering};

        type HResult = i32;

        #[repr(C)]
        #[derive(Clone, Copy)]
        struct Guid {
            d1: u32,
            d2: u16,
            d3: u16,
            d4: [u8; 8],
        }

        const IID_NULL: Guid = Guid { d1: 0, d2: 0, d3: 0, d4: [0; 8] };
        const IID_IDISPATCH: Guid = Guid { d1: 0x0002_0400, d2: 0, d3: 0, d4: [0xC0, 0, 0, 0, 0, 0, 0, 0x46] };

        #[repr(C)]
        struct Vtbl {
            query_interface: unsafe extern "system" fn(*mut Dispatch, *const Guid, *mut *mut c_void) -> HResult,
            add_ref: unsafe extern "system" fn(*mut Dispatch) -> u32,
            release: unsafe extern "system" fn(*mut Dispatch) -> u32,
            get_type_info_count: unsafe extern "system" fn(*mut Dispatch, *mut u32) -> HResult,
            get_type_info: unsafe extern "system" fn(*mut Dispatch, u32, u32, *mut *mut c_void) -> HResult,
            get_ids_of_names:
                unsafe extern "system" fn(*mut Dispatch, *const Guid, *const *const u16, u32, u32, *mut i32) -> HResult,
            invoke: unsafe extern "system" fn(
                *mut Dispatch,
                i32,
                *const Guid,
                u32,
                u16,
                *mut DispParams,
                *mut Variant,
                *mut ExcepInfo,
                *mut u32,
            ) -> HResult,
        }

        #[repr(C)]
        struct Dispatch {
            vtbl: *const Vtbl,
        }

        #[repr(C)]
        struct DispParams {
            args: *mut Variant,
            nomeados: *mut i32,
            n_args: u32,
            n_nomeados: u32,
        }

        /// VARIANT de 64 bits: o tipo, três reservados e 16 bytes de valor (ponteiro, número…).
        #[repr(C)]
        #[derive(Clone, Copy)]
        struct Variant {
            vt: u16,
            r1: u16,
            r2: u16,
            r3: u16,
            dados: [u64; 2],
        }

        #[repr(C)]
        #[allow(dead_code)]
        struct ExcepInfo {
            codigo: u16,
            reservado: u16,
            fonte: *mut u16,
            descricao: *mut u16,
            ajuda: *mut u16,
            contexto: u32,
            reservado2: *mut c_void,
            adiado: *mut c_void,
            scode: i32,
        }

        #[link(name = "ole32")]
        extern "system" {
            fn CoInitializeEx(reservado: *const c_void, modo: u32) -> HResult;
            fn CoUninitialize();
            fn CLSIDFromProgID(progid: *const u16, clsid: *mut Guid) -> HResult;
            fn CoCreateInstance(clsid: *const Guid, externo: *mut c_void, contexto: u32, iid: *const Guid, objeto: *mut *mut c_void) -> HResult;
        }

        #[link(name = "oleaut32")]
        extern "system" {
            fn SysAllocString(texto: *const u16) -> *mut u16;
            fn SysFreeString(texto: *mut u16);
            fn SysStringLen(texto: *const u16) -> u32;
            fn VariantClear(v: *mut Variant) -> HResult;
            fn GetActiveObject(clsid: *const Guid, reservado: *mut c_void, objeto: *mut *mut c_void) -> HResult;
        }

        const COINIT_APARTMENTTHREADED: u32 = 0x2;
        const CLSCTX_LOCAL_SERVER: u32 = 0x4;
        const VT_EMPTY: u16 = 0;
        const VT_I4: u16 = 3;
        const VT_BSTR: u16 = 8;
        const VT_DISPATCH: u16 = 9;
        const VT_ERROR: u16 = 10;
        const VT_BOOL: u16 = 11;
        const DISPATCH_METHOD: u16 = 1;
        const DISPATCH_PROPERTYGET: u16 = 2;
        const DISPATCH_PROPERTYPUT: u16 = 4;
        const DISPID_PROPERTYPUT: i32 = -3;
        const DISP_E_PARAMNOTFOUND: u32 = 0x8002_0004;
        const LOCALE_USER_DEFAULT: u32 = 0x0400;

        /// Um argumento da automação.
        pub enum Valor {
            Inteiro(i32),
            Texto(String),
            Logico(bool),
            /// Argumento opcional que não se quer passar.
            Omitido,
        }

        fn variant_vazio() -> Variant {
            Variant { vt: VT_EMPTY, r1: 0, r2: 0, r3: 0, dados: [0; 2] }
        }

        fn para_variant(v: &Valor) -> Variant {
            let mut r = variant_vazio();
            match v {
                Valor::Inteiro(i) => {
                    r.vt = VT_I4;
                    r.dados[0] = *i as u32 as u64;
                }
                Valor::Texto(t) => {
                    r.vt = VT_BSTR;
                    let w = largo(t);
                    r.dados[0] = unsafe { SysAllocString(w.as_ptr()) } as u64;
                }
                Valor::Logico(b) => {
                    r.vt = VT_BOOL;
                    r.dados[0] = if *b { 0xFFFF } else { 0 };
                }
                Valor::Omitido => {
                    r.vt = VT_ERROR;
                    r.dados[0] = DISP_E_PARAMNOTFOUND as u64;
                }
            }
            r
        }

        fn texto_de_bstr(b: *mut u16) -> String {
            if b.is_null() {
                return String::new();
            }
            let n = unsafe { SysStringLen(b) } as usize;
            String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(b, n) })
        }

        /// O retorno de uma chamada; solta o que houver dentro quando sai de cena.
        pub struct Resposta(Variant);

        impl Drop for Resposta {
            fn drop(&mut self) {
                unsafe { VariantClear(&mut self.0) };
            }
        }

        impl Resposta {
            pub fn objeto(mut self) -> Result<Objeto, String> {
                if self.0.vt != VT_DISPATCH || self.0.dados[0] == 0 {
                    return Err("a automação não devolveu um objeto".into());
                }
                let p = self.0.dados[0] as *mut Dispatch;
                self.0.vt = VT_EMPTY; // a posse passa para o Objeto
                Ok(Objeto(p))
            }

            pub fn inteiro(&self) -> Option<i64> {
                match self.0.vt {
                    VT_I4 => Some(self.0.dados[0] as u32 as i32 as i64),
                    20 => Some(self.0.dados[0] as i64), // VT_I8
                    _ => None,
                }
            }
        }

        /// Um objeto da automação (o Excel, uma pasta de trabalho…). Solta a referência no fim.
        pub struct Objeto(*mut Dispatch);

        impl Drop for Objeto {
            fn drop(&mut self) {
                unsafe { ((*(*self.0).vtbl).release)(self.0) };
            }
        }

        impl Objeto {
            fn invocar(&self, nome: &str, tipo: u16, args: &[Valor]) -> Result<Resposta, String> {
                // SAFETY: chamadas pela tabela do IDispatch, com buffers vivos durante a chamada.
                unsafe {
                    let w = largo(nome);
                    let ptr = w.as_ptr();
                    let mut id = 0i32;
                    let vt = &*(*self.0).vtbl;
                    let hr = (vt.get_ids_of_names)(self.0, &IID_NULL, &ptr, 1, LOCALE_USER_DEFAULT, &mut id);
                    if hr < 0 {
                        return Err(format!("{nome}: não existe (0x{:08x})", hr as u32));
                    }
                    // O DISPPARAMS leva os argumentos de trás para a frente.
                    let mut valores: Vec<Variant> = args.iter().rev().map(para_variant).collect();
                    let mut put = DISPID_PROPERTYPUT;
                    let gravando = tipo == DISPATCH_PROPERTYPUT;
                    let mut params = DispParams {
                        args: if valores.is_empty() { null_mut() } else { valores.as_mut_ptr() },
                        nomeados: if gravando { &mut put } else { null_mut() },
                        n_args: valores.len() as u32,
                        n_nomeados: u32::from(gravando),
                    };
                    let mut resultado = variant_vazio();
                    let mut excecao: ExcepInfo = std::mem::zeroed();
                    let mut argumento_errado = 0u32;
                    let hr = (vt.invoke)(
                        self.0,
                        id,
                        &IID_NULL,
                        LOCALE_USER_DEFAULT,
                        tipo,
                        &mut params,
                        &mut resultado,
                        &mut excecao,
                        &mut argumento_errado,
                    );
                    for v in valores.iter_mut() {
                        VariantClear(v);
                    }
                    if hr < 0 {
                        let descricao = texto_de_bstr(excecao.descricao);
                        SysFreeString(excecao.fonte);
                        SysFreeString(excecao.descricao);
                        SysFreeString(excecao.ajuda);
                        VariantClear(&mut resultado);
                        return Err(if descricao.trim().is_empty() {
                            format!("{nome}: erro 0x{:08x}", hr as u32)
                        } else {
                            format!("{nome}: {}", descricao.trim())
                        });
                    }
                    Ok(Resposta(resultado))
                }
            }

            pub fn chamar(&self, nome: &str, args: &[Valor]) -> Result<Resposta, String> {
                self.invocar(nome, DISPATCH_METHOD | DISPATCH_PROPERTYGET, args)
            }

            pub fn ler(&self, nome: &str) -> Result<Resposta, String> {
                self.invocar(nome, DISPATCH_PROPERTYGET, &[])
            }

            pub fn gravar(&self, nome: &str, valor: Valor) -> Result<(), String> {
                self.invocar(nome, DISPATCH_PROPERTYPUT, &[valor]).map(|_| ())
            }
        }

        /// A automação numa thread: liga o COM, roda e desliga. Os objetos morrem dentro de `f`.
        pub fn na_thread(f: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
            let hr = unsafe { CoInitializeEx(null(), COINIT_APARTMENTTHREADED) };
            if hr < 0 {
                return Err(erro("NAO_CONVERTEU", format!("CoInitializeEx 0x{:08x}", hr as u32)));
            }
            let r = f();
            unsafe { CoUninitialize() };
            r
        }

        fn clsid(progid: &str) -> Result<Guid, String> {
            let mut c = IID_NULL;
            let w = largo(progid);
            if unsafe { CLSIDFromProgID(w.as_ptr(), &mut c) } < 0 {
                let programa = progid.split('.').next().unwrap_or(progid);
                return Err(erro("SEM_OFFICE", format!("o {programa} não foi encontrado neste computador")));
            }
            Ok(c)
        }

        /// Um Excel/PowerPoint pela automação (o PowerPoint, se já aberto, é o da pessoa).
        fn criar(progid: &str) -> Result<Objeto, String> {
            let c = clsid(progid)?;
            let mut p: *mut c_void = null_mut();
            let hr = unsafe { CoCreateInstance(&c, null_mut(), CLSCTX_LOCAL_SERVER, &IID_IDISPATCH, &mut p) };
            if hr < 0 || p.is_null() {
                return Err(erro("NAO_CONVERTEU", format!("{progid} não abriu (0x{:08x})", hr as u32)));
            }
            Ok(Objeto(p as *mut Dispatch))
        }

        /// O programa já está aberto na sessão (registrado como "objeto ativo")?
        fn ja_aberto(progid: &str) -> bool {
            let Ok(c) = clsid(progid) else { return false };
            let mut p: *mut c_void = null_mut();
            let hr = unsafe { GetActiveObject(&c, null_mut(), &mut p) };
            if hr < 0 || p.is_null() {
                return false;
            }
            // É um IUnknown: a tabela começa igual à do IDispatch (QueryInterface, AddRef, Release).
            let d = p as *mut Dispatch;
            unsafe { ((*(*d).vtbl).release)(d) };
            true
        }

        /// Guarda o pid do programa aberto pela conversão, para encerrar se travar. Ele NÃO entra no
        /// grupo que morre com o app: nascido pela automação, ele não pode dividir o grupo com o
        /// Word ("acesso negado", visto em 11/11/2026); e o PowerPoint pode virar o da pessoa.
        fn guardar_pid(p: u32, pid: &AtomicU32) {
            if p != 0 {
                pid.store(p, Ordering::Relaxed);
            }
        }

        pub fn excel_para_pdf(entrada: &Path, saida: &Path, pid: &AtomicU32, csv: bool) -> Result<(), String> {
            let app = criar("Excel.Application")?;
            // O Excel é um por conversão: o pid vem da janela principal dele (`Hwnd`).
            match app.ler("Hwnd").ok().and_then(|r| r.inteiro()) {
                Some(h) => guardar_pid(pid_da_janela(h as isize as Handle), pid),
                None => log::warn!("office: não achei o pid do Excel"),
            }
            let _ = app.gravar("DisplayAlerts", Valor::Logico(false));
            let _ = app.gravar("AutomationSecurity", Valor::Inteiro(3)); // macros dos arquivos desligadas
            let feito = (|| -> Result<(), String> {
                let livros = app.ler("Workbooks")?.objeto()?;
                let livro = livros
                    .chamar(
                        "Open",
                        &[
                            Valor::Texto(entrada.display().to_string()),
                            Valor::Inteiro(0),   // UpdateLinks: não atualiza vínculos com outros arquivos
                            Valor::Logico(true), // ReadOnly
                            Valor::Omitido,      // Format
                            // Password: o arquivo protegido falha na hora em vez de pedir a senha.
                            Valor::Texto("senha-falsa".into()),
                            Valor::Omitido,       // WriteResPassword
                            Valor::Logico(true),  // IgnoreReadOnlyRecommended
                            Valor::Omitido,       // Origin
                            Valor::Omitido,       // Delimiter
                            Valor::Logico(false), // Editable
                            Valor::Logico(false), // Notify
                            Valor::Omitido,       // Converter
                            Valor::Logico(false), // AddToMru
                            Valor::Logico(true),  // Local: CSV com o separador do Windows da pessoa (";")
                        ],
                    )?
                    .objeto()?;
                /* CSV não guarda largura de coluna: sem ajustar, data vira "########" no PDF. Só
                   no CSV — na planilha de verdade, vale a largura que a pessoa definiu. */
                if csv {
                    let colunas = livro.ler("ActiveSheet")?.objeto()?.ler("UsedRange")?.objeto()?.ler("Columns")?.objeto()?;
                    let _ = colunas.chamar("AutoFit", &[]);
                }
                let exportado = livro.chamar(
                    "ExportAsFixedFormat",
                    &[Valor::Inteiro(0), Valor::Texto(saida.display().to_string())], // 0 = PDF
                );
                let _ = livro.chamar("Close", &[Valor::Logico(false)]);
                exportado.map(|_| ())
            })();
            let _ = app.chamar("Quit", &[]);
            feito.map_err(|m| classificar(&m))
        }

        pub fn powerpoint_para_pdf(entrada: &Path, saida: &Path, pid: &AtomicU32) -> Result<(), String> {
            let da_pessoa = ja_aberto("PowerPoint.Application");
            let antes = pids_de("POWERPNT.EXE");
            let app = criar("PowerPoint.Application")?;
            if !da_pessoa {
                /* O PowerPoint escondido não tem janela principal para dar o pid: ele é o
                   POWERPNT.EXE que não existia antes de criar. */
                match pids_de("POWERPNT.EXE").into_iter().find(|p| !antes.contains(p)) {
                    Some(p) => guardar_pid(p, pid),
                    None => log::warn!("office: não achei o pid do PowerPoint"),
                }
                let _ = app.gravar("DisplayAlerts", Valor::Inteiro(1)); // ppAlertsNone
            }
            log::info!("office: PowerPoint {}", if da_pessoa { "da pessoa (já aberto)" } else { "aberto pela conversão" });
            // Macros do arquivo desligadas; no PowerPoint da pessoa, a configuração volta no fim.
            let seguranca = app.ler("AutomationSecurity").ok().and_then(|r| r.inteiro());
            let _ = app.gravar("AutomationSecurity", Valor::Inteiro(3));
            let feito = (|| -> Result<(), String> {
                let apresentacoes = app.ler("Presentations")?.objeto()?;
                // "arquivo::senha::": o protegido falha na hora em vez de pedir a senha; o sem senha ignora.
                let apresentacao = apresentacoes
                    .chamar(
                        "Open",
                        &[
                            Valor::Texto(format!("{}::senha-falsa::", entrada.display())),
                            Valor::Inteiro(-1), // ReadOnly
                            Valor::Inteiro(0),  // Untitled
                            Valor::Inteiro(0),  // WithWindow: sem janela
                        ],
                    )?
                    .objeto()?;
                let salvo = apresentacao.chamar("SaveAs", &[Valor::Texto(saida.display().to_string()), Valor::Inteiro(32)]); // 32 = PDF
                let _ = apresentacao.chamar("Close", &[]);
                salvo.map(|_| ())
            })();
            if let Some(s) = seguranca {
                let _ = app.gravar("AutomationSecurity", Valor::Inteiro(s as i32));
            }
            // Só fecha o PowerPoint aberto pela conversão, e só se ninguém abriu nada nele no meio.
            if !da_pessoa {
                let vazio = app
                    .ler("Presentations")
                    .and_then(|r| r.objeto())
                    .and_then(|ps| ps.ler("Count"))
                    .ok()
                    .and_then(|r| r.inteiro())
                    == Some(0);
                if vazio {
                    let _ = app.chamar("Quit", &[]);
                }
            }
            feito.map_err(|m| classificar(&m))
        }
    }
}
