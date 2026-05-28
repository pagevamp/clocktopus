use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager,
};
use std::sync::Mutex;
use std::time::Duration;

/// Dashboard HTTP port. Override via CLOCKTOPUS_PORT env var if 4001 is busy.
/// Must match the port the CLI binds (see lib/constants.ts on the TS side).
fn dashboard_port() -> u16 {
    std::env::var("CLOCKTOPUS_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(4001)
}

fn dashboard_url() -> String {
    format!("http://localhost:{}", dashboard_port())
}

/// Candidate absolute paths for the `bun` binary, in priority order.
/// GUI apps don't inherit the user's shell PATH, so we probe known locations.
fn bun_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.bun/bin/bun"),
        "/opt/homebrew/bin/bun".to_string(),
        "/usr/local/bin/bun".to_string(),
    ]
}

/// Absolute path to the globally-installed `clocktopus` binary. We only support
/// installing it via `bun i -g`, which always lands it in `~/.bun/bin`.
fn clocktopus_candidates(home: &str) -> Vec<String> {
    vec![format!("{home}/.bun/bin/clocktopus")]
}

/// Return the first candidate for which `exists` is true. Injecting the
/// existence check keeps this pure and unit-testable.
fn first_matching<F: Fn(&str) -> bool>(candidates: &[String], exists: F) -> Option<String> {
    candidates.iter().find(|p| exists(p)).cloned()
}

/// Tracks the server child process spawned by the "Start Server" button,
/// so the app can stop it via tray menu and reap it on quit.
#[derive(Default)]
struct ServerChild(Mutex<Option<std::process::Child>>);

fn kill_server_child(state: &ServerChild) {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Kill any process listening on the dashboard port, regardless of origin.
/// Used for the user-initiated "Stop Server" action — handles cases where
/// the server was started outside this app (terminal, PM2, prior session).
fn kill_server_by_port() {
    let port = dashboard_port();
    let cmd = format!(
        "pids=$(lsof -ti tcp:{port} -sTCP:LISTEN 2>/dev/null); \
         [ -n \"$pids\" ] && kill -TERM $pids 2>/dev/null; \
         sleep 1; \
         pids=$(lsof -ti tcp:{port} -sTCP:LISTEN 2>/dev/null); \
         [ -n \"$pids\" ] && kill -KILL $pids 2>/dev/null; \
         true",
    );
    let _ = std::process::Command::new("sh").args(["-c", &cmd]).status();
}
use tauri_plugin_positioner::{Position, WindowExt};
#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{WebviewWindowExt as NSPanelWebviewWindowExt, ManagerExt, cocoa::appkit::NSWindowCollectionBehavior};

/// Decode the embedded PNG into raw RGBA bytes and dimensions
fn decode_png(bytes: &[u8]) -> (Vec<u8>, u32, u32) {
    let cursor = std::io::Cursor::new(bytes);
    let decoder = png::Decoder::new(cursor);
    let mut reader = decoder.read_info().expect("failed to read PNG");
    let mut buf = vec![0u8; reader.output_buffer_size().expect("failed to get buffer size")];
    let info = reader.next_frame(&mut buf).expect("failed to decode PNG");
    buf.truncate(info.buffer_size());

    let rgba = if info.color_type == png::ColorType::Rgb {
        let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
        for chunk in buf.chunks(3) {
            out.extend_from_slice(chunk);
            out.push(255);
        }
        out
    } else {
        buf
    };

    (rgba, info.width, info.height)
}

/// Recolor all visible pixels, preserving alpha
fn recolor(rgba: &[u8], r: u8, g: u8, b: u8) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for pixel in out.chunks_exact_mut(4) {
        if pixel[3] > 0 {
            pixel[0] = r;
            pixel[1] = g;
            pixel[2] = b;
        }
    }
    out
}

/// Format an elapsed millisecond count as `H:MM:SS`.
/// Hours are unpadded; minutes and seconds are zero-padded to 2 digits.
/// Negative input clamps to `0:00:00`.
fn format_elapsed(ms: i64) -> String {
    let total_secs = if ms < 0 { 0 } else { ms / 1000 };
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    format!("{}:{:02}:{:02}", hours, minutes, seconds)
}

/// Parse an RFC 3339 timestamp (e.g. `2026-04-17T10:30:00Z` or with offset) to Unix millis.
/// Returns `None` if the string cannot be parsed.
fn parse_start_to_ms(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Maximum character count (not bytes) before a description is trimmed with an ellipsis.
const DESC_MAX_CHARS: usize = 30;

/// Pick a display label for the tray title.
/// Jira ticket wins when present and non-empty. Otherwise trim the description
/// to `DESC_MAX_CHARS` characters, appending `…` when trimmed.
/// Returns `None` when neither source yields a usable string.
fn format_label(jira: Option<&str>, desc: Option<&str>) -> Option<String> {
    if let Some(j) = jira {
        if !j.is_empty() {
            return Some(j.to_string());
        }
    }
    if let Some(d) = desc {
        if !d.is_empty() {
            if d.chars().count() <= DESC_MAX_CHARS {
                return Some(d.to_string());
            }
            let head: String = d.chars().take(DESC_MAX_CHARS - 1).collect();
            return Some(format!("{}…", head));
        }
    }
    None
}

#[tauri::command]
fn check_server() -> bool {
    reqwest::blocking::Client::new()
        .get(&dashboard_url())
        .timeout(Duration::from_secs(2))
        .send()
        .is_ok()
}

#[tauri::command]
fn check_clocktopus_installed() -> bool {
    // GUI apps on macOS don't inherit user shell PATH; probe known paths on disk.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = clocktopus_candidates(&home);
    first_matching(&candidates, |p| std::path::Path::new(p).exists()).is_some()
}

#[tauri::command]
fn check_bun_installed() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = bun_candidates(&home);
    first_matching(&candidates, |p| std::path::Path::new(p).exists()).is_some()
}

#[tauri::command]
fn install_bun() -> Result<(), String> {
    // Official installer; lands the binary at ~/.bun/bin/bun. curl-piped scripts
    // carry no quarantine xattr, so the result runs without Gatekeeper prompts.
    // Capture output so a failure surfaces in the Setup UI instead of vanishing
    // to the GUI app's invisible stderr.
    let output = std::process::Command::new("sh")
        .args(["-c", "curl -fsSL https://bun.sh/install | bash"])
        .output()
        .map_err(|e| format!("failed to launch installer: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "bun install failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn run_bun_install_clocktopus(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    let home = std::env::var("HOME").unwrap_or_default();
    let bun = first_matching(&bun_candidates(&home), |p| std::path::Path::new(p).exists())
        .ok_or_else(|| "bun not found".to_string())?;
    // `--trust` runs lifecycle scripts (clocktopus postinstall, native rebuilds)
    // that shell out to bun/bunx. GUI apps don't inherit the shell PATH, so
    // inject ~/.bun/bin like spawn_server does — without it the first install
    // can fail.
    let bun_bin = format!("{home}/.bun/bin");
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{bun_bin}:{current_path}");

    let mut child = std::process::Command::new(&bun)
        .args(["i", "-g", "clocktopus", "--trust"])
        .env("PATH", new_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch bun: {e}"))?;

    // Stream stdout on a background thread so we don't block on it before
    // joining stderr below.
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.cloned();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(a) = &app_clone {
                    let _ = a.emit("update://log", line);
                }
            }
        });
    }

    let mut stderr_buf = String::new();
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            stderr_buf.push_str(&line);
            stderr_buf.push('\n');
            if let Some(a) = app {
                let _ = a.emit("update://log", line);
            }
        }
    }

    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("clocktopus install failed: {}", stderr_buf.trim()))
    }
}

#[tauri::command]
fn install_clocktopus() -> Result<(), String> {
    run_bun_install_clocktopus(None)
}

#[tauri::command]
fn update_clocktopus(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServerChild>,
) -> Result<(), String> {
    kill_server_child(&state);
    kill_server_by_port();
    run_bun_install_clocktopus(Some(&app))?;
    spawn_server(&state);
    Ok(())
}

#[tauri::command]
async fn download_desktop_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let home = std::env::var("HOME").unwrap_or_default();
    let downloads = std::path::PathBuf::from(home).join("Downloads");
    if !downloads.exists() {
        std::fs::create_dir_all(&downloads).map_err(|e| format!("mkdir Downloads: {e}"))?;
    }
    // Filename = URL path's basename, stripped of query/fragment. Fall back to a
    // generic name when the URL ends in a slash or has no usable tail.
    let path_only = url.split(|c| c == '?' || c == '#').next().unwrap_or(&url);
    let filename = path_only
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or("clocktopus.dmg")
        .to_string();
    let dest = downloads.join(&filename);
    let tmp = downloads.join(format!("{filename}.partial"));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("http error: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("read chunk: {e}")
        })?;
        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("write chunk: {e}")
        })?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "desktop-update://progress",
            serde_json::json!({ "downloaded": downloaded, "total": total }),
        );
    }
    file.flush().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("flush tmp: {e}")
    })?;
    drop(file);
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename: {e}")
    })?;

    // Reveal in Finder.
    let _ = std::process::Command::new("open")
        .args(["-R", dest.to_str().unwrap_or("")])
        .spawn();

    Ok(dest.to_string_lossy().into_owned())
}

fn spawn_server(state: &ServerChild) {
    // Resolve clocktopus binary directly — GUI apps lack shell PATH.
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = clocktopus_candidates(&home);
    let Some(bin) = first_matching(&candidates, |p| std::path::Path::new(p).exists()) else {
        return;
    };
    // bun shebang in the installed bin needs bun on PATH; inject ~/.bun/bin.
    let bun_bin = format!("{}/.bun/bin", home);
    let current_path = std::env::var("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", bun_bin, current_path);
    if let Ok(child) = std::process::Command::new(&bin)
        .arg("dash")
        .env("PATH", new_path)
        .env("CLOCKTOPUS_PORT", dashboard_port().to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        *state.0.lock().unwrap() = Some(child);
    }
}

#[tauri::command]
fn start_server(state: tauri::State<'_, ServerChild>) {
    spawn_server(&state);
}

#[tauri::command]
fn stop_server(app: tauri::AppHandle, state: tauri::State<'_, ServerChild>) {
    kill_server_child(&state);
    kill_server_by_port();
    navigate_to_error(&app);
}

fn navigate_to_error(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.navigate("clocktopus://localhost/error".parse().unwrap());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let error_html: String = format!("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>*{{margin:0;padding:0;box-sizing:border-box}}:root{{--bg:#1a1d23;--fg:#e1e4e8;--sub:#8b949e;--btn:#238636;--btn-h:#2ea043;--err:#f85149}}@media(prefers-color-scheme:light){{:root{{--bg:#f6f8fa;--fg:#1f2328;--sub:#656d76;--btn:#1a7f37;--btn-h:#2da44e;--err:#cf222e}}}}body{{font-family:-apple-system,sans-serif;background:var(--bg);display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;color:var(--fg);padding:1rem}}h2{{margin-bottom:.4rem;font-size:1.1rem}}p{{color:var(--sub);font-size:.875rem}}button{{margin-top:1.1rem;padding:.55rem 1.4rem;background:var(--btn);border:none;border-radius:8px;color:white;font-size:.9rem;font-weight:500;cursor:pointer}}button:hover:not(:disabled){{background:var(--btn-h)}}button:disabled{{opacity:.5;cursor:not-allowed}}#msg{{font-size:.8rem;color:var(--sub);margin-top:.65rem;min-height:1.1em}}#msg.err{{color:var(--err)}}#cmd{{display:none;margin-top:.6rem;font-family:ui-monospace,monospace;font-size:.72rem;background:rgba(128,128,128,.15);padding:.4rem .5rem;border-radius:6px;color:var(--fg);user-select:all;cursor:copy;word-break:break-all}}</style></head><body oncontextmenu=\"return false;\"><div><h2 id=\"t\">Set up Clocktopus</h2><p id=\"sub\">Install prerequisites to continue.</p><button id=\"b\">Set up Clocktopus</button><div id=\"msg\"></div><div id=\"cmd\"></div></div><script>const DASH_URL='{url}';const invoke=window.__TAURI__.core.invoke;const t=document.getElementById('t'),sub=document.getElementById('sub'),b=document.getElementById('b'),m=document.getElementById('msg'),cmd=document.getElementById('cmd');const sleep=ms=>new Promise(r=>setTimeout(r,ms));function setMsg(text,isErr){{m.textContent=text;m.className=isErr?'err':'';}}function showCmd(text){{if(text){{cmd.textContent=text;cmd.style.display='block';}}else{{cmd.style.display='none';}}}}cmd.onclick=()=>{{navigator.clipboard&&navigator.clipboard.writeText(cmd.textContent);}};async function waitFor(check,label){{setMsg(label,false);for(let i=0;i<120;i++){{if(await invoke(check))return true;await sleep(1500);}}return false;}}function fail(step,err,manual){{setMsg((err||'Step failed')+'',true);showCmd(manual);b.disabled=false;b.textContent='Retry';b.onclick=run;}}async function run(){{b.disabled=true;showCmd('');try{{if(!await invoke('check_bun_installed')){{t.textContent='Installing bun';sub.textContent='Downloading the bun runtime…';b.textContent='Installing bun…';await invoke('install_bun');if(!await waitFor('check_bun_installed','Installing bun…'))return fail('bun','bun install timed out','curl -fsSL https://bun.sh/install | bash');}}if(!await invoke('check_clocktopus_installed')){{t.textContent='Installing Clocktopus';sub.textContent='Installing the Clocktopus CLI…';b.textContent='Installing Clocktopus…';await invoke('install_clocktopus');if(!await waitFor('check_clocktopus_installed','Installing Clocktopus…'))return fail('cli','Clocktopus install timed out','bun i -g clocktopus --trust');}}t.textContent='Starting Clocktopus';sub.textContent='Launching the server…';b.textContent='Starting…';await invoke('start_server');if(!await waitFor('check_server','Waiting for server…'))return fail('server','Server did not start','clocktopus dash');setMsg('',false);location.href=DASH_URL;}}catch(e){{fail('error',(e&&e.toString)?e.toString():'Unexpected error',null);}}}}b.onclick=run;async function init(){{if(await invoke('check_bun_installed')&&await invoke('check_clocktopus_installed')){{t.textContent='Server not running';sub.textContent='Start the Clocktopus server to continue.';b.textContent='Start Server';}}}}init();</script></body></html>", url = dashboard_url());

    let loading_html: String = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#1a1d23;--fg:#e1e4e8;--sub:#8b949e;--accent:#d29922}@media(prefers-color-scheme:light){:root{--bg:#f6f8fa;--fg:#1f2328;--sub:#656d76;--accent:#bf8700}}body{font-family:-apple-system,sans-serif;background:var(--bg);display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;color:var(--fg)}.sp{width:32px;height:32px;border:3px solid rgba(128,128,128,.25);border-top-color:var(--accent);border-radius:50%;animation:sp .8s linear infinite;margin:0 auto .9rem}@keyframes sp{to{transform:rotate(360deg)}}h2{font-size:1rem;font-weight:500}p{color:var(--sub);font-size:.8rem;margin-top:.35rem}</style></head><body oncontextmenu=\"return false;\"><div><div class=\"sp\"></div><h2>Starting Clocktopus</h2><p>Launching server…</p></div></body></html>".to_string();

    let mut builder = tauri::Builder::default()
        .manage(ServerChild::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![start_server, stop_server, check_server, check_bun_installed, install_bun, check_clocktopus_installed, install_clocktopus, update_clocktopus, download_desktop_update])
        .register_uri_scheme_protocol("clocktopus", move |_app, request| {
            let body = if request.uri().path() == "/loading" {
                loading_html.as_bytes().to_vec()
            } else {
                error_html.as_bytes().to_vec()
            };
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .status(200)
                .body(body)
                .unwrap()
        })
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            {
                // Accessory policy: no dock icon, no Cmd+Tab entry, no app activation on show
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);

                // 4th arg = corner radius for the vibrancy backdrop. Matches
                // the macOS popover/sheet look since window is transparent +
                // decorations: false.
                apply_vibrancy(&window, NSVisualEffectMaterial::Popover, None, Some(12.0))
                    .map_err(|e| e.to_string())?;

                // Swizzle NSWindow -> NSPanel to enable non-activating show (no Space switch)
                let panel = window.to_panel().map_err(|e| format!("to_panel failed: {:?}", e))?;

                // NSWindowStyleMaskNonActivatingPanel: panel cannot activate the app on show
                const NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL: i32 = 1 << 7;
                panel.set_style_mask(NS_WINDOW_STYLE_MASK_NON_ACTIVATING_PANEL);

                // NSFloatWindowLevel: above normal windows, doesn't cover menu bar
                const NS_FLOAT_WINDOW_LEVEL: i32 = 4;
                panel.set_level(NS_FLOAT_WINDOW_LEVEL);

                // Appear on all spaces including full-screen app spaces
                #[allow(deprecated)]
                panel.set_collection_behaviour(
                    NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                        | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
                );
            }

            let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let stop_timer = MenuItem::with_id(app, "stop-timer", "Stop Timer", false, None::<&str>)?;
            let stop_server_item = MenuItem::with_id(app, "stop-server", "Stop Server", false, None::<&str>)?;
            let update_cli = MenuItem::with_id(app, "update-cli", "Update CLI", false, None::<&str>)?;
            let update_desktop = MenuItem::with_id(app, "update-desktop", "Update desktop", false, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show, &stop_timer, &sep1, &stop_server_item, &update_cli, &update_desktop, &sep2, &quit],
            )?;

            // Idle icon: black template — macOS auto-adapts white/black
            let (raw, w, h) = decode_png(include_bytes!("../icons/32x32.png"));
            let idle_rgba = recolor(&raw, 0, 0, 0);
            let icon = Image::new_owned(idle_rgba.clone(), w, h);

            // Pull productName from config so dev builds show "Clocktopus Dev"
            // in the tray tooltip without needing two binaries.
            let product_name = app
                .config()
                .product_name
                .clone()
                .unwrap_or_else(|| "Clocktopus".to_string());
            let product_name_active = format!("{} - Timer running", product_name);

            let tray = TrayIconBuilder::with_id(TrayIconId::new("main-tray"))
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip(product_name.clone())
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.move_window(Position::TrayCenter);
                        }
                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = app.get_webview_panel("main") {
                            panel.show();
                        }
                        #[cfg(not(target_os = "macos"))]
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                        }
                    }
                    "stop-timer" => {
                        let url = format!("{}/api/timer/stop", dashboard_url());
                        std::thread::spawn(move || {
                            let _ = reqwest::blocking::Client::new()
                                .post(&url)
                                .timeout(Duration::from_secs(5))
                                .send();
                        });
                    }
                    "stop-server" => {
                        let state = app.state::<ServerChild>();
                        kill_server_child(&state);
                        kill_server_by_port();
                        navigate_to_error(app);
                    }
                    "update-cli" | "update-desktop" => {
                        if let Some(win) = app.get_webview_window("main") {
                            if let Ok(url) = dashboard_url().parse() {
                                let _ = win.navigate(url);
                            }
                        }
                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = app.get_webview_panel("main") {
                            panel.show();
                        }
                        #[cfg(not(target_os = "macos"))]
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                        }
                    }
                    "quit" => {
                        kill_server_child(&app.state::<ServerChild>());
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = tray.app_handle().get_webview_panel("main") {
                            if panel.is_visible() {
                                panel.order_out(None);
                            } else if let Some(win) = tray.app_handle().get_webview_window("main") {
                                let _ = win.move_window(Position::TrayCenter);
                                panel.show();
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.move_window(Position::TrayCenter);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Synchronous server check: if server down at startup, auto-spawn it
            // when clocktopus is installed and show a loading page. The poller
            // below detects server-up and navigates to the dashboard URL.
            let server_up_initially = reqwest::blocking::Client::new()
                .get(&dashboard_url())
                .timeout(Duration::from_secs(2))
                .send()
                .is_ok();
            if server_up_initially {
                // tauri.conf.json frontendDist is fixed at build time. Navigate
                // explicitly so a custom CLOCKTOPUS_PORT is honored at runtime.
                let _ = window.navigate(dashboard_url().parse().unwrap());
            } else if check_clocktopus_installed() {
                spawn_server(&app.state::<ServerChild>());
                let _ = window.navigate("clocktopus://localhost/loading".parse().unwrap());
            } else {
                let _ = window.navigate("clocktopus://localhost/error".parse().unwrap());
            }

            // Hide popup on close or focus loss (click outside to dismiss)
            let app_handle_for_event = app.handle().clone();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = app_handle_for_event.get_webview_panel("main") {
                            panel.order_out(None);
                        }
                        #[cfg(not(target_os = "macos"))]
                        let _ = window_clone.hide();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        #[cfg(target_os = "macos")]
                        if let Ok(panel) = app_handle_for_event.get_webview_panel("main") {
                            panel.order_out(None);
                        }
                        #[cfg(not(target_os = "macos"))]
                        let _ = window_clone.hide();
                    }
                    _ => {}
                }
                #[cfg(target_os = "macos")]
                let _ = &window_clone;
            });

            // Active icon: separate logo for timer running
            let (active_raw, _, _) = decode_png(include_bytes!("../icons/32x32-active.png"));
            let active_rgba = recolor(&active_raw, 0, 0, 0);

            let stop_timer_for_thread = stop_timer.clone();
            let stop_server_for_thread = stop_server_item.clone();
            let active_url = format!("{}/api/timer/active", dashboard_url());
            let monitor_status_url = format!("{}/api/monitor/status", dashboard_url());
            let dash_url_for_thread = dashboard_url();
            let window_for_thread = window.clone();
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                let mut is_active: bool = false;
                let mut monitor_on: bool = false;
                let mut icon_active: bool = false;
                let mut start_ms: Option<i64> = None;
                let mut description: Option<String> = None;
                let mut tick: u32 = 0;
                let mut last_server_up: Option<bool> = None;

                loop {
                    // Poll on first iteration and every 5th tick after
                    if tick % 5 == 0 {
                        let send_result = client
                            .get(&active_url)
                            .timeout(Duration::from_secs(3))
                            .send();
                        let server_up = send_result.is_ok();
                        if last_server_up != Some(server_up) {
                            let _ = stop_server_for_thread.set_enabled(server_up);
                            let target = if server_up {
                                dash_url_for_thread.clone()
                            } else {
                                "clocktopus://localhost/error".to_string()
                            };
                            if let Ok(parsed) = target.parse() {
                                let _ = window_for_thread.navigate(parsed);
                            }
                            last_server_up = Some(server_up);
                        }
                        let response = send_result
                            .and_then(|r| r.text())
                            .ok()
                            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());

                        if let Some(json) = response {
                            let new_active = json.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
                            let new_start_ms = json
                                .get("start")
                                .and_then(|v| v.as_str())
                                .and_then(parse_start_to_ms);
                            let new_description = json
                                .get("description")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());

                            if new_active != is_active {
                                is_active = new_active;
                                let _ = stop_timer_for_thread.set_enabled(new_active);
                            }

                            start_ms = if new_active { new_start_ms } else { None };
                            if new_active {
                                description = new_description;
                            } else {
                                description = None;
                            }
                        }
                        // On request/parse failure: leave is_active and start_ms unchanged

                        // Poll monitor status — when the idle monitor daemon is on,
                        // surface the active icon even without an explicit timer so
                        // the user has a visual cue that auto-tracking is armed.
                        monitor_on = client
                            .get(&monitor_status_url)
                            .timeout(Duration::from_secs(3))
                            .send()
                            .and_then(|r| r.text())
                            .ok()
                            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                            .and_then(|json| json.get("running").and_then(|v| v.as_bool()))
                            .unwrap_or(monitor_on);

                        let desired_icon_active = is_active || monitor_on;
                        if desired_icon_active != icon_active {
                            icon_active = desired_icon_active;
                            let rgba = if icon_active { &active_rgba } else { &idle_rgba };
                            let img = Image::new_owned(rgba.clone(), w, h);
                            let _ = tray.set_icon(Some(img));
                            let _ = tray.set_icon_as_template(true);
                            let _ = tray.set_tooltip(Some(if icon_active {
                                product_name_active.as_str()
                            } else {
                                product_name.as_str()
                            }));
                        }
                    }

                    // Drive the title every tick
                    if is_active {
                        if let Some(start) = start_ms {
                            let now_ms = chrono::Utc::now().timestamp_millis();
                            let elapsed = now_ms - start;
                            let elapsed_str = format_elapsed(elapsed);
                            let label = format_label(None, description.as_deref());
                            let title = match label {
                                Some(l) => format!("{} {}", elapsed_str, l),
                                None => elapsed_str,
                            };
                            let _ = tray.set_title(Some(&title));
                        } else {
                            let _ = tray.set_title(Some(""));
                        }
                    } else {
                        let _ = tray.set_title(Some(""));
                    }

                    tick = tick.wrapping_add(1);
                    std::thread::sleep(Duration::from_secs(1));
                }
            });

            // Background poller: check for CLI / desktop updates every 6 hours.
            // Updates the corresponding tray menu item text + enabled state.
            let update_cli_handle = update_cli.clone();
            let update_desktop_handle = update_desktop.clone();
            let update_dash_url = dashboard_url();
            let desktop_current = app.package_info().version.to_string();
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                let cli_url = format!("{}/api/version", update_dash_url);
                let desktop_url = format!(
                    "{}/api/desktop-version?currentDesktopVersion={}",
                    update_dash_url, desktop_current
                );
                loop {
                    // CLI version
                    let cli_body: Option<serde_json::Value> = client
                        .get(&cli_url)
                        .timeout(Duration::from_secs(5))
                        .send()
                        .ok()
                        .and_then(|r| r.text().ok())
                        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
                    if let Some(body) = cli_body {
                        let avail = body
                            .get("updateAvailable")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let latest = body
                            .get("latest")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if avail && !latest.is_empty() {
                            let _ = update_cli_handle
                                .set_text(format!("Update CLI to v{latest}"));
                            let _ = update_cli_handle.set_enabled(true);
                        } else {
                            let _ = update_cli_handle.set_text("Update CLI");
                            let _ = update_cli_handle.set_enabled(false);
                        }
                    }
                    // Desktop version
                    let desktop_body: Option<serde_json::Value> = client
                        .get(&desktop_url)
                        .timeout(Duration::from_secs(5))
                        .send()
                        .ok()
                        .and_then(|r| r.text().ok())
                        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
                    if let Some(body) = desktop_body {
                        let avail = body
                            .get("updateAvailable")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let latest = body
                            .get("latest")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if avail && !latest.is_empty() {
                            let _ = update_desktop_handle
                                .set_text(format!("Update desktop to v{latest}"));
                            let _ = update_desktop_handle.set_enabled(true);
                        } else {
                            let _ = update_desktop_handle.set_text("Update desktop");
                            let _ = update_desktop_handle.set_enabled(false);
                        }
                    }
                    std::thread::sleep(Duration::from_secs(6 * 60 * 60));
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_elapsed_zero() {
        assert_eq!(format_elapsed(0), "0:00:00");
    }

    #[test]
    fn format_elapsed_seconds() {
        assert_eq!(format_elapsed(5_000), "0:00:05");
    }

    #[test]
    fn format_elapsed_minutes() {
        assert_eq!(format_elapsed(83_000), "0:01:23");
    }

    #[test]
    fn format_elapsed_hours() {
        assert_eq!(format_elapsed(5_025_000), "1:23:45");
    }

    #[test]
    fn format_elapsed_twelve_hours() {
        assert_eq!(format_elapsed(43_200_000), "12:00:00");
    }

    #[test]
    fn format_elapsed_negative_clamps_to_zero() {
        assert_eq!(format_elapsed(-1_000), "0:00:00");
    }

    #[test]
    fn parse_start_to_ms_utc_z() {
        let ms = parse_start_to_ms("2026-04-17T10:30:00Z").unwrap();
        assert_eq!(ms, 1_776_421_800_000);
    }

    #[test]
    fn parse_start_to_ms_with_offset() {
        let ms = parse_start_to_ms("2026-04-17T16:15:00+05:45").unwrap();
        // Same instant as 10:30:00Z
        assert_eq!(ms, 1_776_421_800_000);
    }

    #[test]
    fn parse_start_to_ms_with_fractional() {
        let ms = parse_start_to_ms("2026-04-17T10:30:00.500Z").unwrap();
        assert_eq!(ms, 1_776_421_800_500);
    }

    #[test]
    fn parse_start_to_ms_invalid() {
        assert!(parse_start_to_ms("not-a-date").is_none());
        assert!(parse_start_to_ms("").is_none());
    }

    #[test]
    fn format_label_jira_only() {
        assert_eq!(format_label(Some("JIRA-123"), None), Some("JIRA-123".to_string()));
    }

    #[test]
    fn format_label_description_short() {
        assert_eq!(
            format_label(None, Some("Refactor auth middleware")),
            Some("Refactor auth middleware".to_string()),
        );
    }

    #[test]
    fn format_label_description_exactly_30() {
        let desc = "a".repeat(30);
        assert_eq!(format_label(None, Some(&desc)), Some(desc.clone()));
    }

    #[test]
    fn format_label_description_truncates_at_31() {
        let desc = "a".repeat(31);
        let result = format_label(None, Some(&desc)).unwrap();
        assert_eq!(result.chars().count(), 30);
        assert!(result.ends_with('…'));
        assert_eq!(result, format!("{}…", "a".repeat(29)));
    }

    #[test]
    fn format_label_jira_wins_over_description() {
        assert_eq!(
            format_label(Some("JIRA-123"), Some("some description")),
            Some("JIRA-123".to_string()),
        );
    }

    #[test]
    fn format_label_empty_strings_are_none() {
        assert_eq!(format_label(Some(""), Some("")), None);
        assert_eq!(format_label(None, Some("")), None);
        assert_eq!(format_label(Some(""), None), None);
    }

    #[test]
    fn format_label_both_none_is_none() {
        assert_eq!(format_label(None, None), None);
    }

    #[test]
    fn format_label_multibyte_description() {
        // 31 emoji characters — each is multi-byte in UTF-8 but one char.
        let desc = "🐙".repeat(31);
        let result = format_label(None, Some(&desc)).unwrap();
        assert_eq!(result.chars().count(), 30);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn bun_candidates_includes_home_and_system_paths() {
        let c = bun_candidates("/Users/alice");
        assert_eq!(c[0], "/Users/alice/.bun/bin/bun");
        assert!(c.contains(&"/opt/homebrew/bin/bun".to_string()));
        assert!(c.contains(&"/usr/local/bin/bun".to_string()));
    }

    #[test]
    fn clocktopus_candidates_is_bun_global_only() {
        let c = clocktopus_candidates("/Users/alice");
        assert_eq!(c, vec!["/Users/alice/.bun/bin/clocktopus".to_string()]);
    }

    #[test]
    fn first_matching_returns_first_existing() {
        let cands = vec!["/a".to_string(), "/b".to_string(), "/c".to_string()];
        let got = first_matching(&cands, |p| p == "/b" || p == "/c");
        assert_eq!(got, Some("/b".to_string()));
    }

    #[test]
    fn first_matching_returns_none_when_no_match() {
        let cands = vec!["/a".to_string(), "/b".to_string()];
        let got = first_matching(&cands, |_| false);
        assert_eq!(got, None);
    }
}
