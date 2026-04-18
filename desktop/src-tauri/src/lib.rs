#![allow(unexpected_cfgs)]
#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Manager,
};
use std::time::Duration;
use tauri_plugin_positioner::{Position, WindowExt};
#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

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
        .get("http://localhost:4001")
        .timeout(Duration::from_secs(2))
        .send()
        .is_ok()
}

#[tauri::command]
fn check_clocktopus_installed() -> bool {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    std::process::Command::new(&shell)
        .args(["-l", "-c", "which clocktopus"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn install_clocktopus() {
    let home = std::env::var("HOME").unwrap_or_default();
    let bun = format!("{}/.bun/bin/bun", home);
    std::process::Command::new(&bun)
        .args(["i", "-g", "clocktopus", "--trust"])
        .spawn()
        .ok();
}

#[tauri::command]
fn start_server() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    std::process::Command::new(&shell)
        .args(["-l", "-c", "clocktopus dash"])
        .spawn()
        .ok();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let error_html: &'static str = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>*{margin:0;padding:0;box-sizing:border-box}:root{--bg:#1a1d23;--fg:#e1e4e8;--sub:#8b949e;--btn:#238636;--btn-h:#2ea043}@media(prefers-color-scheme:light){:root{--bg:#f6f8fa;--fg:#1f2328;--sub:#656d76;--btn:#1a7f37;--btn-h:#2da44e}}body{font-family:-apple-system,sans-serif;background:var(--bg);display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;color:var(--fg)}h2{margin-bottom:.4rem;font-size:1.1rem}p{color:var(--sub);font-size:.875rem}button{margin-top:1.1rem;padding:.55rem 1.4rem;background:var(--btn);border:none;border-radius:8px;color:white;font-size:.9rem;font-weight:500;cursor:pointer}button:hover:not(:disabled){background:var(--btn-h)}button:disabled{opacity:.5;cursor:not-allowed}#msg{font-size:.8rem;color:var(--sub);margin-top:.65rem;min-height:1.1em}</style></head><body><div><h2 id=\"t\">Server not running</h2><p id=\"sub\">Start the Clocktopus server to continue.</p><button id=\"b\">Start Server</button><div id=\"msg\"></div></div><script>const invoke=window.__TAURI__.core.invoke;async function init(){const ok=await invoke('check_clocktopus_installed');if(!ok){document.getElementById('t').textContent='Clocktopus not installed';document.getElementById('sub').textContent='Install the Clocktopus CLI to continue.';document.getElementById('b').textContent='Install Clocktopus';document.getElementById('b').onclick=doInstall;}else{document.getElementById('b').onclick=doStart;}}async function doInstall(){const b=document.getElementById('b'),m=document.getElementById('msg');b.disabled=true;b.textContent='Installing\u{2026}';await invoke('install_clocktopus');m.textContent='Installing Clocktopus\u{2026}';const t=setInterval(async()=>{if(await invoke('check_clocktopus_installed')){clearInterval(t);m.textContent='';document.getElementById('t').textContent='Server not running';document.getElementById('sub').textContent='Start the Clocktopus server to continue.';b.textContent='Start Server';b.disabled=false;b.onclick=doStart;}},1500);}async function doStart(){const b=document.getElementById('b'),m=document.getElementById('msg');b.disabled=true;b.textContent='Starting\u{2026}';await invoke('start_server');m.textContent='Waiting for server\u{2026}';const t=setInterval(async()=>{if(await invoke('check_server')){clearInterval(t);location.href='http://localhost:4001';}},1500);}init();</script></body></html>";

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![start_server, check_server, check_clocktopus_installed, install_clocktopus])
        .register_uri_scheme_protocol("clocktopus", move |_app, _request| {
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .status(200)
                .body(error_html.as_bytes().to_vec())
                .unwrap()
        })
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "macos")]
            {
                apply_vibrancy(&window, NSVisualEffectMaterial::Popover, None, None)
                    .map_err(|e| e.to_string())?;

                // CanJoinAllSpaces(1) | FullScreenAuxiliary(256) | IgnoresCycle(64)
                // FullScreenAuxiliary lets the popup appear over full-screen apps without switching Space
                if let Ok(ptr) = window.ns_window() {
                    use objc::runtime::Object;
                    let ns_win = ptr as *mut Object;
                    let behavior: usize = (1 << 0) | (1 << 8) | (1 << 6);
                    unsafe { let _: () = msg_send![ns_win, setCollectionBehavior: behavior]; }
                }
            }

            let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let stop_timer = MenuItem::with_id(app, "stop-timer", "Stop Timer", false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &stop_timer, &sep, &quit])?;

            // Idle icon: black template — macOS auto-adapts white/black
            let (raw, w, h) = decode_png(include_bytes!("../icons/32x32.png"));
            let idle_rgba = recolor(&raw, 0, 0, 0);
            let icon = Image::new_owned(idle_rgba.clone(), w, h);

            let tray = TrayIconBuilder::with_id(TrayIconId::new("main-tray"))
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Clocktopus")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.move_window(Position::TrayCenter);
                            let _ = win.show();
                        }
                    }
                    "stop-timer" => {
                        std::thread::spawn(|| {
                            let _ = reqwest::blocking::Client::new()
                                .post("http://localhost:4001/api/timer/stop")
                                .timeout(Duration::from_secs(5))
                                .send();
                        });
                    }
                    "quit" => {
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

            // Show error page if server is not running
            let window_for_check = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                let server_up = reqwest::blocking::Client::new()
                    .get("http://localhost:4001")
                    .timeout(Duration::from_secs(3))
                    .send()
                    .is_ok();

                if !server_up {
                    let _ = window_for_check.navigate("clocktopus://localhost/error".parse().unwrap());
                    let _ = window_for_check.show();
                }
            });

            // Hide window on close or focus loss
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window_clone.hide();
                    }
                    _ => {}
                }
            });

            // Active icon: separate logo for timer running
            let (active_raw, _, _) = decode_png(include_bytes!("../icons/32x32-active.png"));
            let active_rgba = recolor(&active_raw, 0, 0, 0);

            let stop_timer_for_thread = stop_timer.clone();
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                let mut is_active: bool = false;
                let mut start_ms: Option<i64> = None;
                let mut description: Option<String> = None;
                let mut tick: u32 = 0;

                loop {
                    // Poll on first iteration and every 5th tick after
                    if tick % 5 == 0 {
                        let response = client
                            .get("http://localhost:4001/api/timer/active")
                            .timeout(Duration::from_secs(3))
                            .send()
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

                                let rgba = if new_active { &active_rgba } else { &idle_rgba };
                                let img = Image::new_owned(rgba.clone(), w, h);
                                let _ = tray.set_icon(Some(img));
                                let _ = tray.set_icon_as_template(true);

                                let _ = tray.set_tooltip(Some(if new_active {
                                    "Clocktopus - Timer running"
                                } else {
                                    "Clocktopus"
                                }));

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
}
