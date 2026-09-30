// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Fetch's own dev server already owns 8080 (vite.config.ts's fixed)
/// live-preview contract). This just needs a port nothing else on the user's
/// machine is likely to be holding.
const SERVER_PORT: u16 = 47821;

/// Passed by the login item so a launch at login starts in the menu bar
/// without opening the window.
const HIDDEN_ARG: &str = "--hidden";

const LOGIN_AGENT_LABEL: &str = "com.rexchao.fetch";

struct ServerProcess(Mutex<Option<Child>>);

/// Ask `/api/health` whether the server on the port is the one we started.
/// A leftover server from an older launch answers with a different instance
/// id (or none), so an upgrade never ends up showing the stale build.
fn health_matches(port: u16, instance: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    let _ = stream.read_to_string(&mut body);
    body.contains(instance)
}

fn wait_for_server(child: &mut Child, instance: &str, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            if TcpStream::connect(("127.0.0.1", SERVER_PORT)).is_ok() {
                return Err(format!(
                    "Another program is using port {SERVER_PORT}. If an older copy of Fetch is \
                     still running, quit it (or restart your Mac) and open Fetch again."
                ));
            }
            return Err(format!("Fetch's server stopped right after starting ({status})."));
        }
        if health_matches(SERVER_PORT, instance) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err("Fetch's server did not start within 20 seconds.".to_string())
}

/// The Node binary bundled next to the app's executable (`externalBin` in
/// tauri.conf.json, copied in by scripts/prepare-node.sh at build time).
fn bundled_node() -> Option<PathBuf> {
    let node = std::env::current_exe().ok()?.parent()?.join("node");
    node.is_file().then_some(node)
}

/// Spawn the bundled Nitro `node-server` build (`npm run build`, bundled
/// into the app under `resources/output`) on the bundled Node.
///
/// Without a bundled Node (an older build layout), fall back to the user's
/// own: a GUI-launched app gets macOS's bare default `PATH`, which does not
/// include a version-manager-installed `node` (mise, nvm, …), so run it
/// through the login shell, passing the entry path as `$0` so a space in the
/// path is safe.
fn spawn_server(resource_dir: &Path, data_dir: &Path, instance: &str) -> std::io::Result<Child> {
    let entry = resource_dir.join("output").join("server").join("index.mjs");
    let mut command = match bundled_node() {
        Some(node) => {
            let mut command = Command::new(node);
            command.arg(&entry);
            command
        }
        None => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
            let mut command = Command::new(shell);
            command.arg("-l").arg("-c").arg("exec node \"$0\"").arg(&entry);
            command
        }
    };
    command
        .env("PORT", SERVER_PORT.to_string())
        .env("HOST", "127.0.0.1")
        .env("FETCH_INSTANCE", instance)
        .env("FETCH_DATA_DIR", data_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
}

/// A native alert, then quit. Better than a crash with no message.
fn fail(message: &str) -> ! {
    let script = format!(
        "display alert \"Fetch couldn't start\" message \"{}\" as critical",
        message.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let _ = Command::new("/usr/bin/osascript").arg("-e").arg(script).status();
    std::process::exit(1);
}

fn instance_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("fetch-{}-{nanos:x}", std::process::id())
}

fn login_agent_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/LaunchAgents")
            .join(format!("{LOGIN_AGENT_LABEL}.plist")),
    )
}

/// The `.app` bundle this executable lives in (…/Fetch.app/Contents/MacOS/fetch).
fn app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?.to_path_buf();
    (bundle.extension().and_then(|e| e.to_str()) == Some("app")).then_some(bundle)
}

fn login_item_enabled() -> bool {
    login_agent_path().is_some_and(|path| path.is_file())
}

/// Open at Login, as a per-user LaunchAgent that opens this bundle hidden.
fn set_login_item(enabled: bool) -> Result<(), String> {
    let path = login_agent_path().ok_or("no home folder")?;
    if !enabled {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    let bundle = app_bundle().ok_or("Fetch is not running from an app bundle")?;
    let escape = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LOGIN_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>{}</string>
    <string>--args</string>
    <string>{HIDDEN_ARG}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        escape(&bundle.to_string_lossy())
    );
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, plist).map_err(|e| e.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Fetch", true, None::<&str>)?;
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Open at Login",
        !cfg!(debug_assertions),
        login_item_enabled(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Fetch", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &login, &separator, &quit])?;

    let login_item = login.clone();
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Fetch")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "login" => {
                let want = login_item.is_checked().unwrap_or(false);
                if set_login_item(want).is_err() {
                    let _ = login_item.set_checked(login_item_enabled());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    let start_hidden = std::env::args().any(|arg| arg == HIDDEN_ARG);

    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(move |app| {
            // `tauri dev` runs `npm run dev` as its beforeDevCommand and the
            // window loads that directly — nothing to spawn here. Only a
            // release build carries the bundled server as a resource.
            let url = if cfg!(debug_assertions) {
                "http://127.0.0.1:8080".to_string()
            } else {
                let resource_dir = app.path().resource_dir()?;
                let data_dir = app.path().app_data_dir()?;
                let _ = std::fs::create_dir_all(&data_dir);
                let instance = instance_id();
                let mut child = match spawn_server(&resource_dir, &data_dir, &instance) {
                    Ok(child) => child,
                    Err(error) => fail(&format!("Fetch's server could not be launched: {error}")),
                };
                if let Err(reason) = wait_for_server(&mut child, &instance, Duration::from_secs(20)) {
                    let _ = child.kill();
                    fail(&reason);
                }
                app.state::<ServerProcess>().0.lock().unwrap().replace(child);
                format!("http://127.0.0.1:{SERVER_PORT}")
            };

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Fetch")
                .inner_size(1280.0, 860.0)
                .visible(!start_hidden)
                .build()?;

            build_tray(app.handle())?;
            Ok(())
        })
        // Closing the window keeps Fetch in the menu bar, so Jellyfin's
        // streams keep working. Quit from the menu bar icon or with Cmd+Q.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(app_handle),
            // Quitting via Cmd+Q / the Dock menu / the tray fires
            // ExitRequested or Exit at the app level; the bundled server
            // must go with it.
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                if let Some(mut child) = app_handle.state::<ServerProcess>().0.lock().unwrap().take()
                {
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
