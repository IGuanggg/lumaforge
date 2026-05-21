import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

import uvicorn


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


def wait_until_ready(url, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                if response.status < 500:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def main():
    app_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
    os.environ.setdefault("APP_RUNTIME_DIR", os.path.join(app_dir, "userdata"))
    port = find_port(os.getenv("APP_PORT", "3000"))
    url = f"http://127.0.0.1:{port}/"
    from main import app

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    if wait_until_ready(f"http://127.0.0.1:{port}/health"):
        webbrowser.open(url)
    print(f"LumaForge is running at {url}")
    print("Close this window or press Ctrl+C to stop.")
    try:
        while thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
