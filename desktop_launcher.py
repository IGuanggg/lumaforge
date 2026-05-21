import ctypes
import json
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

import uvicorn


APP_NAME = "LumaForge"


def is_frozen():
    return bool(getattr(sys, "frozen", False))


def bundle_dir():
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def appdata_dir():
    base = os.getenv("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / APP_NAME


def localappdata_dir():
    base = os.getenv("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / APP_NAME


def default_save_dir():
    return Path.home() / "Pictures" / APP_NAME


def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)
    return path


def configure_desktop_environment():
    runtime_dir = ensure_dir(Path(os.getenv("APP_RUNTIME_DIR") or appdata_dir()))
    save_dir = ensure_dir(Path(os.getenv("APP_ASSETS_DIR") or default_save_dir()))
    logs_dir = ensure_dir(localappdata_dir() / "logs")
    webview_storage_dir = ensure_dir(localappdata_dir() / "webview")

    os.environ.setdefault("APP_RUNTIME_DIR", str(runtime_dir))
    os.environ.setdefault("APP_ASSETS_DIR", str(save_dir))
    os.environ.setdefault("APP_OUTPUT_DIR", str(save_dir / "legacy-output"))
    os.environ.setdefault("APP_LOG_DIR", str(logs_dir))
    os.environ.setdefault("APP_CACHE_DIR", str(localappdata_dir() / "cache"))
    os.environ.setdefault("LUMAFORGE_DESKTOP", "1")
    os.environ.setdefault("INFINITE_CANVAS_DESKTOP", "1")

    for child in ("input", "output", "thumbs", "temp"):
        ensure_dir(save_dir / child)

    return {
        "runtime_dir": runtime_dir,
        "save_dir": save_dir,
        "logs_dir": logs_dir,
        "webview_storage_dir": webview_storage_dir,
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


def wait_until_ready(url, timeout=35):
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                if response.status < 500:
                    return True, ""
        except Exception as exc:
            last_error = str(exc)
            time.sleep(0.25)
    return False, last_error


def resource_path(*parts):
    return bundle_dir().joinpath(*parts)


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


def run_smoke_test(port):
    server = None
    thread = None
    try:
        server, thread = start_server(port)
        ready, last_error = wait_until_ready(f"http://127.0.0.1:{port}/health")
        result = {"ready": ready, "port": port, "error": last_error}
        if ready:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as response:
                result["health"] = json.loads(response.read().decode("utf-8"))
        print(json.dumps(result, ensure_ascii=False))
        return 0 if ready else 1
    except Exception as exc:
        logging.exception("Desktop smoke test failed")
        print(json.dumps({"ready": False, "port": port, "error": str(exc)}, ensure_ascii=False))
        return 1
    finally:
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

    if smoke_test:
        exit_code = run_smoke_test(port)
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
    exit_code = 1
    try:
        server, thread = start_server(port)
        ready, last_error = wait_until_ready(f"http://127.0.0.1:{port}/health")
        icon_path = resource_path("static", "logo.ico")
        if ready:
            webview.create_window(
                APP_NAME,
                f"http://127.0.0.1:{port}/",
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
