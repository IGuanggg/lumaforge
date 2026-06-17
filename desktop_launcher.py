import ctypes
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn


APP_NAME = "LumaForge"
DESKTOP_READY_TIMEOUT = 120
DESKTOP_READY_REQUEST_TIMEOUT = 4


def is_frozen():
    return bool(getattr(sys, "frozen", False))


def bundle_dir():
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def windows_known_folder(csidl):
    if not sys.platform.startswith("win"):
        return None
    try:
        buffer = ctypes.create_unicode_buffer(260)
        result = ctypes.windll.shell32.SHGetFolderPathW(None, int(csidl), None, 0, buffer)
        if result == 0 and buffer.value:
            return Path(buffer.value)
    except Exception:
        logging.exception("Failed to resolve Windows known folder %s", csidl)
    return None


def appdata_dir():
    base = windows_known_folder(0x001A) or Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming")
    return base / APP_NAME


def localappdata_dir():
    base = windows_known_folder(0x001C) or Path(os.getenv("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    return base / APP_NAME


def default_save_dir():
    base = windows_known_folder(0x0027) or (Path.home() / "Pictures")
    return base / APP_NAME


def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)
    return path


def configure_ssl_certificates():
    for env_name in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE"):
        value = os.getenv(env_name)
        if value and Path(value).is_file():
            return value

    exe_dir = Path(sys.executable).resolve().parent if is_frozen() else Path(__file__).resolve().parent
    candidates = [
        bundle_dir() / "certifi" / "cacert.pem",
        exe_dir / "_internal" / "certifi" / "cacert.pem",
        exe_dir / "certifi" / "cacert.pem",
    ]
    try:
        import certifi

        candidates.append(Path(certifi.where()))
    except Exception:
        pass

    for cert_path in candidates:
        if cert_path and cert_path.is_file():
            cert_value = str(cert_path)
            os.environ["SSL_CERT_FILE"] = cert_value
            os.environ["REQUESTS_CA_BUNDLE"] = cert_value
            return cert_value
    return ""


def copy_missing_tree(src, dst):
    if not src.exists():
        return False
    copied = False
    ensure_dir(dst)
    for item in src.iterdir():
        target = dst / item.name
        if target.exists():
            continue
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
        copied = True
    return copied

def migrate_legacy_desktop_data(runtime_dir, save_dir):
    app_dir = Path(sys.executable).resolve().parent if is_frozen() else Path(__file__).resolve().parent
    legacy_runtime = app_dir / "userdata"
    legacy_assets = app_dir / "assets"
    migrated = []
    try:
        if legacy_runtime.exists() and not any(runtime_dir.iterdir()):
            if copy_missing_tree(legacy_runtime, runtime_dir):
                migrated.append(str(legacy_runtime))
        if legacy_assets.exists() and not any(save_dir.iterdir()):
            if copy_missing_tree(legacy_assets, save_dir):
                migrated.append(str(legacy_assets))
    except Exception:
        logging.exception("Legacy desktop data migration failed")
    return migrated


def configure_desktop_environment():
    runtime_dir = ensure_dir(Path(os.getenv("APP_RUNTIME_DIR") or appdata_dir()))
    save_dir = ensure_dir(Path(os.getenv("APP_ASSETS_DIR") or default_save_dir()))
    logs_dir = ensure_dir(localappdata_dir() / "logs")
    webview_storage_dir = ensure_dir(localappdata_dir() / "webview")

    os.environ["APP_RUNTIME_DIR"] = str(runtime_dir)
    os.environ["APP_ASSETS_DIR"] = str(save_dir)
    os.environ["APP_OUTPUT_DIR"] = str(save_dir / "legacy-output")
    os.environ["APP_LOG_DIR"] = str(logs_dir)
    os.environ["APP_CACHE_DIR"] = str(localappdata_dir() / "cache")
    os.environ["APP_WEBVIEW_STORAGE_DIR"] = str(webview_storage_dir)
    os.environ.setdefault("LUMAFORGE_DESKTOP", "1")
    os.environ.setdefault("INFINITE_CANVAS_DESKTOP", "1")

    ssl_cert_file = configure_ssl_certificates()
    migrated_from = migrate_legacy_desktop_data(runtime_dir, save_dir)

    for child in ("input", "output", "thumbs", "temp"):
        ensure_dir(save_dir / child)

    return {
        "runtime_dir": runtime_dir,
        "save_dir": save_dir,
        "logs_dir": logs_dir,
        "webview_storage_dir": webview_storage_dir,
        "ssl_cert_file": ssl_cert_file,
        "migrated_from": migrated_from,
    }


def configure_logging(logs_dir, redirect_stdio):
    log_file = logs_dir / "desktop.log"
    logging.basicConfig(
        filename=str(log_file),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if redirect_stdio:
        stream = open(log_file, "a", encoding="utf-8", buffering=1)
        sys.stdout = stream
        sys.stderr = stream
    return log_file


def show_message(title, message):
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        print(f"{title}: {message}")


def force_exit(exit_code):
    if is_frozen():
        try:
            logging.shutdown()
            ctypes.windll.kernel32.ExitProcess(int(exit_code))
        except Exception:
            os._exit(exit_code)


def find_port(preferred):
    try:
        preferred = int(preferred)
    except (TypeError, ValueError):
        preferred = 3000
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if sock.connect_ex(("127.0.0.1", preferred)) != 0:
            return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_until_ready(url, timeout=DESKTOP_READY_TIMEOUT):
    deadline = time.time() + timeout
    last_error = ""
    attempts = 0
    while time.time() < deadline:
        attempts += 1
        try:
            with urllib.request.urlopen(url, timeout=DESKTOP_READY_REQUEST_TIMEOUT) as response:
                if response.status < 500:
                    logging.info("Desktop service ready after %s attempts", attempts)
                    return True, ""
        except Exception as exc:
            last_error = str(exc)
            logging.info("Desktop service not ready yet attempt=%s error=%s", attempts, last_error)
            time.sleep(0.5 if attempts < 20 else 1.0)
    return False, last_error


def resource_path(*parts):
    return bundle_dir().joinpath(*parts)


def app_dir():
    return Path(sys.executable).resolve().parent if is_frozen() else Path(__file__).resolve().parent


def find_first_existing(paths):
    for path in paths:
        if path and Path(path).exists():
            return Path(path)
    return None


def find_v21_bundle():
    roots = []
    for root in (app_dir(), bundle_dir(), Path(__file__).resolve().parent):
        if root not in roots:
            roots.append(root)

    server_names = ("server.exe", "lumaforge-server.exe", "LumaForgeServer.exe", "server")
    node_names = ("node.exe", "node")
    server_candidates = []
    node_candidates = []
    web_candidates = []

    for root in roots:
        for name in server_names:
            server_candidates.extend((root / "v21" / name, root / name))
        for name in node_names:
            node_candidates.extend((root / "node" / name, root / "nodejs" / name, root / name))
        web_candidates.extend((root / "web" / "server.js", root / "server.js"))

    server_exe = find_first_existing(server_candidates)
    node_exe = find_first_existing(node_candidates)
    web_server = find_first_existing(web_candidates)
    if not server_exe or not node_exe or not web_server:
        return None
    return {"server": server_exe, "node": node_exe, "web_server": web_server, "web_dir": web_server.parent}


def child_process_kwargs(log_file):
    kwargs = {}
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        stream = open(log_file, "a", encoding="utf-8", buffering=1)
        kwargs["stdout"] = stream
        kwargs["stderr"] = stream
    except Exception:
        pass
    return kwargs


def start_v21_processes(port, paths, log_file):
    bundle = find_v21_bundle()
    if not bundle:
        return None

    api_port = find_port(os.getenv("LUMAFORGE_API_PORT", "8080"))
    legacy_server = None
    legacy_thread = None
    legacy_port = None
    data_dir = ensure_dir(paths["runtime_dir"] / "data")
    prompt_dir = ensure_dir(data_dir / "prompts")

    env = os.environ.copy()
    env.setdefault("APP_RUNTIME_DIR", str(paths["runtime_dir"]))
    env.setdefault("APP_ASSETS_DIR", str(paths["save_dir"]))
    env.setdefault("APP_OUTPUT_DIR", str(paths["save_dir"] / "legacy-output"))
    env.setdefault("APP_LOG_DIR", str(paths["logs_dir"]))
    env.setdefault("APP_CACHE_DIR", str(localappdata_dir() / "cache"))
    env.setdefault("LUMAFORGE_DATA_DIR", str(data_dir))
    env.setdefault("PROMPT_DATA_DIR", str(prompt_dir))

    try:
        legacy_port = find_port(os.getenv("LUMAFORGE_LEGACY_PORT", "8090"))
        legacy_server, legacy_thread = start_server(legacy_port)
        env["LUMAFORGE_LEGACY_API_URL"] = f"http://127.0.0.1:{legacy_port}"
        logging.info("Started legacy compatibility API on port=%s", legacy_port)
    except Exception:
        logging.exception("Legacy compatibility API failed to start; v2.1 runtime will continue without updater proxy")

    api_env = env.copy()
    api_env["PORT"] = str(api_port)
    api_env["LUMAFORGE_APP_URL"] = f"http://127.0.0.1:{port}/"
    api_env["LUMAFORGE_API_URL"] = f"http://127.0.0.1:{api_port}"
    api_process = subprocess.Popen(
        [str(bundle["server"])],
        cwd=str(bundle["server"].parent),
        env=api_env,
        **child_process_kwargs(log_file),
    )

    web_env = env.copy()
    web_env["NODE_ENV"] = "production"
    web_env["HOSTNAME"] = "127.0.0.1"
    web_env["PORT"] = str(port)
    web_env["API_BASE_URL"] = f"http://127.0.0.1:{api_port}"
    web_env["LUMAFORGE_APP_URL"] = f"http://127.0.0.1:{port}/"
    web_process = subprocess.Popen(
        [str(bundle["node"]), str(bundle["web_server"])],
        cwd=str(bundle["web_dir"]),
        env=web_env,
        **child_process_kwargs(log_file),
    )

    logging.info(
        "Started v2.1 runtime api_pid=%s api_port=%s web_pid=%s web_port=%s legacy_port=%s",
        api_process.pid,
        api_port,
        web_process.pid,
        port,
        legacy_port,
    )
    return {
        "mode": "v21",
        "processes": [web_process, api_process],
        "legacy_server": legacy_server,
        "legacy_thread": legacy_thread,
        "app_url": f"http://127.0.0.1:{port}/",
        "ready_url": f"http://127.0.0.1:{port}/api/health",
        "legacy_ready_url": f"http://127.0.0.1:{legacy_port}/health" if legacy_port else "",
    }


def stop_v21_processes(runtime):
    if not runtime:
        return
    legacy_server = runtime.get("legacy_server")
    if legacy_server:
        legacy_server.should_exit = True
    for process in runtime.get("processes", []):
        if process and process.poll() is None:
            process.terminate()
    deadline = time.time() + 8
    for process in runtime.get("processes", []):
        if not process:
            continue
        try:
            remaining = max(0.1, deadline - time.time())
            process.wait(timeout=remaining)
        except Exception:
            if process.poll() is None:
                process.kill()
    legacy_thread = runtime.get("legacy_thread")
    if legacy_thread and legacy_thread.is_alive():
        legacy_thread.join(timeout=6)


def start_server(port):
    from main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info", log_config=None, use_colors=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="LumaForgeServer")
    thread.start()
    return server, thread


def desktop_error_html(message, log_file):
    escaped_message = str(message).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped_log = str(log_file).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f"""
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>{APP_NAME}</title>
  <style>
    body {{ margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f7f9; color:#101114; }}
    main {{ max-width:720px; margin:12vh auto; background:white; border:1px solid #e5e7eb; border-radius:18px; padding:34px; box-shadow:0 24px 70px rgba(15,23,42,.12); }}
    h1 {{ margin:0 0 12px; font-size:28px; }}
    p {{ color:#6b7280; line-height:1.7; }}
    code {{ display:block; padding:14px; border-radius:12px; background:#f3f4f6; word-break:break-all; color:#111827; }}
  </style>
</head>
<body>
  <main>
    <h1>本地服务启动失败</h1>
    <p>可能原因：端口占用、防火墙拦截、依赖损坏，或打包文件不完整。</p>
    <code>{escaped_message}</code>
    <p>日志文件：</p>
    <code>{escaped_log}</code>
  </main>
</body>
</html>
"""


def run_smoke_test(port, paths, log_file):
    server = None
    thread = None
    v21_runtime = None
    try:
        v21_runtime = start_v21_processes(port, paths, log_file)
        if v21_runtime:
            ready_url = v21_runtime["ready_url"]
        else:
            server, thread = start_server(port)
            ready_url = f"http://127.0.0.1:{port}/health"
        ready, last_error = wait_until_ready(ready_url)
        result = {"ready": ready, "port": port, "error": last_error}
        if ready:
            with urllib.request.urlopen(ready_url, timeout=3) as response:
                result["health"] = json.loads(response.read().decode("utf-8"))
            legacy_ready_url = v21_runtime.get("legacy_ready_url") if v21_runtime else ""
            if legacy_ready_url:
                legacy_ready, legacy_error = wait_until_ready(legacy_ready_url, timeout=10)
                result["legacy_ready"] = legacy_ready
                if legacy_error:
                    result["legacy_error"] = legacy_error
        print(json.dumps(result, ensure_ascii=False))
        return 0 if ready else 1
    except Exception as exc:
        logging.exception("Desktop smoke test failed")
        print(json.dumps({"ready": False, "port": port, "error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
        stop_v21_processes(v21_runtime)
        if server:
            server.should_exit = True
        if thread and thread.is_alive():
            thread.join(timeout=6)


def main():
    smoke_test = "--smoke-test" in sys.argv
    paths = configure_desktop_environment()
    log_file = configure_logging(paths["logs_dir"], redirect_stdio=is_frozen() and not smoke_test)
    port = find_port(os.getenv("APP_PORT", "3000"))
    logging.info("Desktop launcher start argv=%r smoke_test=%s frozen=%s port=%s", sys.argv, smoke_test, is_frozen(), port)
    if paths.get("ssl_cert_file"):
        logging.info("Desktop SSL certificate file: %s", paths["ssl_cert_file"])
    else:
        logging.warning("Desktop SSL certificate file was not found")
    if paths.get("migrated_from"):
        logging.info("Migrated legacy desktop data from %r", paths["migrated_from"])

    if smoke_test:
        exit_code = run_smoke_test(port, paths, log_file)
        logging.info("Desktop smoke test finished exit_code=%s", exit_code)
        force_exit(exit_code)
        return exit_code

    try:
        import webview
    except Exception as exc:
        show_message(APP_NAME, f"桌面窗口组件加载失败：{exc}\n\n请确认 pywebview / WebView2 Runtime 已安装。")
        force_exit(1)
        return 1

    server = None
    thread = None
    v21_runtime = None
    exit_code = 1
    try:
        v21_runtime = start_v21_processes(port, paths, log_file)
        if v21_runtime:
            app_url = v21_runtime["app_url"]
            ready_url = v21_runtime["ready_url"]
        else:
            server, thread = start_server(port)
            app_url = f"http://127.0.0.1:{port}/"
            ready_url = f"http://127.0.0.1:{port}/health"
        ready, last_error = wait_until_ready(ready_url)
        icon_path = resource_path("static", "logo.ico")
        if ready:
            webview.create_window(
                APP_NAME,
                app_url,
                width=1440,
                height=920,
                min_size=(1100, 720),
                background_color="#f6f7f9",
                text_select=True,
            )
        else:
            webview.create_window(
                APP_NAME,
                html=desktop_error_html(last_error or "Health check timeout", log_file),
                width=920,
                height=680,
                min_size=(760, 520),
                background_color="#f6f7f9",
                text_select=True,
            )
        webview.start(
            gui="edgechromium",
            private_mode=False,
            storage_path=str(paths["webview_storage_dir"]),
            icon=str(icon_path) if icon_path.exists() else None,
            debug=os.getenv("WEBVIEW_DEBUG", "").lower() in ("1", "true", "yes"),
        )
        exit_code = 0 if ready else 1
    finally:
        stop_v21_processes(v21_runtime)
        if server:
            server.should_exit = True
        if thread and thread.is_alive():
            thread.join(timeout=6)
    if is_frozen():
        logging.info("Desktop launcher exiting exit_code=%s", exit_code)
    force_exit(exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
