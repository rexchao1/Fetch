// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Latch's own dev server already owns 8080 (vite.config.ts's fixed
/// live-preview contract). This just needs a port nothing else on the user's
/// machine is likely to be holding.
const SERVER_PORT: u16 = 47821;

struct ServerProcess(Mutex<Option<Child>>);

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Spawn the bundled Nitro `node-server` build (`npm run build`,
/// bundled into the app under `resources/output`). PGLite covers the
/// database with nothing configured, so no env beyond host/port is needed.
///
/// A GUI-launched app (double-clicked, not run from a terminal) gets macOS's
/// bare default `PATH`, which does not include a version-manager-installed
/// `node` (mise, nvm, …) — only an interactive shell sources the profile that
/// adds it. Running `node` through the user's login shell picks that up the
/// same way a terminal would; passing the entry path as `$0` (rather than
/// interpolating it into the command string) keeps a space in the path safe.
fn spawn_server(resource_dir: PathBuf) -> std::io::Result<Child> {
    let entry = resource_dir.join("output").join("server").join("index.mjs");
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    Command::new(shell)
        .arg("-l")
        .arg("-c")
        .arg("exec node \"$0\"")
        .arg(entry)
        .env("PORT", SERVER_PORT.to_string())
        .env("HOST", "127.0.0.1")
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
}

fn main() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            // `tauri dev` runs `npm run dev` as its beforeDevCommand and the
            // window loads that directly — nothing to spawn here. Only a
            // release build carries the bundled server as a resource.
            let url = if cfg!(debug_assertions) {
                "http://localhost:8080".to_string()
            } else {
                let resource_dir = app.path().resource_dir()?;
                let child = spawn_server(resource_dir)
                    .expect("failed to start the bundled Latch server");
                if !wait_for_server(SERVER_PORT, Duration::from_secs(15)) {
                    panic!("Latch server did not come up on port {SERVER_PORT}");
                }
                app.state::<ServerProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .replace(child);
                format!("http://127.0.0.1:{SERVER_PORT}")
            };

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("Latch")
                .inner_size(1280.0, 860.0)
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Quitting via Cmd+Q / the Dock menu fires ExitRequested at the
            // app level, not a per-window CloseRequested — catching only the
            // window event left the bundled server running after quit.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(mut child) = app_handle
                    .state::<ServerProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        });
}
