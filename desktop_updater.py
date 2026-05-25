import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


PROTECT_NAMES = {
    "API",
    "assets",
    "cache",
    "cloud-data",
    "data",
    "logs",
    "output",
    "releases",
    "updates",
    "userdata",
}


def wait_for_pid(pid: int, timeout: int = 90):
    if pid <= 0:
        return
    if not sys.platform.startswith("win"):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except OSError:
                return
            time.sleep(0.5)
        return
    import ctypes

    SYNCHRONIZE = 0x00100000
    WAIT_TIMEOUT = 0x00000102
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(SYNCHRONIZE, False, int(pid))
    if not handle:
        return
    try:
        kernel32.WaitForSingleObject(handle, int(timeout * 1000))
    finally:
        kernel32.CloseHandle(handle)


def safe_extract_zip(zip_path: str, dest_dir: str):
    dest_abs = os.path.abspath(dest_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or name.startswith("\\"):
                raise RuntimeError(f"Unsafe absolute path in update package: {info.filename}")
            if len(name) >= 2 and name[1] == ":":
                raise RuntimeError(f"Unsafe drive path in update package: {info.filename}")
            if ".." in name.split("/"):
                raise RuntimeError(f"Unsafe traversal path in update package: {info.filename}")
            target = os.path.abspath(os.path.join(dest_dir, name))
            if not (target == dest_abs or target.startswith(dest_abs + os.sep)):
                raise RuntimeError(f"Unsafe extraction target: {info.filename}")
        zf.extractall(dest_dir)


def detect_package_root(staging_dir: str):
    direct_markers = [
        os.path.join(staging_dir, "LumaForge.exe"),
        os.path.join(staging_dir, "_internal"),
        os.path.join(staging_dir, "static"),
        os.path.join(staging_dir, "main.py"),
    ]
    if any(os.path.exists(path) for path in direct_markers):
        return staging_dir
    children = [os.path.join(staging_dir, name) for name in os.listdir(staging_dir)]
    dirs = [path for path in children if os.path.isdir(path)]
    if len(dirs) == 1:
        sub = dirs[0]
        sub_markers = [
            os.path.join(sub, "LumaForge.exe"),
            os.path.join(sub, "_internal"),
            os.path.join(sub, "static"),
            os.path.join(sub, "main.py"),
        ]
        if any(os.path.exists(path) for path in sub_markers):
            return sub
    return ""


def remove_path(path: str):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.exists(path):
        os.remove(path)


def copy_entry(src: str, dst: str):
    if os.path.isdir(src) and not os.path.islink(src):
        if os.path.exists(dst):
            remove_path(dst)
        shutil.copytree(src, dst)
    else:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def replace_app(package_root: str, app_dir: str):
    app_abs = os.path.abspath(app_dir)
    package_abs = os.path.abspath(package_root)
    if app_abs == package_abs or package_abs.startswith(app_abs + os.sep):
        raise RuntimeError("Update package is inside app directory; refusing to replace in-place.")

    backup_dir = os.path.join(os.path.dirname(app_abs), f"LumaForge.backup-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(backup_dir, exist_ok=True)
    replaced = []
    try:
        for name in os.listdir(package_root):
            if name in PROTECT_NAMES:
                continue
            src = os.path.join(package_root, name)
            dst = os.path.join(app_dir, name)
            if os.path.exists(dst):
                shutil.move(dst, os.path.join(backup_dir, name))
            copy_entry(src, dst)
            replaced.append(name)
    except Exception:
        for name in os.listdir(backup_dir):
            dst = os.path.join(app_dir, name)
            if os.path.exists(dst):
                remove_path(dst)
            shutil.move(os.path.join(backup_dir, name), dst)
        raise
    return backup_dir, replaced


def write_state(path: str, payload: dict):
    if not path:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def restart_app(exe_path: str):
    if not exe_path or not os.path.isfile(exe_path):
        return
    try:
        subprocess.Popen([exe_path], cwd=os.path.dirname(exe_path), close_fds=True)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="LumaForge desktop updater")
    parser.add_argument("--pid", type=int, default=0)
    parser.add_argument("--package", required=True)
    parser.add_argument("--app-dir", required=True)
    parser.add_argument("--exe", default="")
    parser.add_argument("--state", default="")
    parser.add_argument("--version", default="")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()

    state = {
        "ok": False,
        "phase": "waiting_for_exit",
        "target_version": args.version,
        "package": args.package,
        "app_dir": args.app_dir,
        "started_at": int(time.time() * 1000),
    }
    write_state(args.state, state)
    try:
        wait_for_pid(args.pid)
        state["phase"] = "extracting"
        write_state(args.state, state)
        staging = tempfile.mkdtemp(prefix="lumaforge-update-")
        try:
            safe_extract_zip(args.package, staging)
            root = detect_package_root(staging)
            if not root:
                raise RuntimeError("Update package does not contain a recognizable LumaForge app root.")
            state["phase"] = "replacing"
            write_state(args.state, state)
            backup_dir, replaced = replace_app(root, args.app_dir)
            state.update({
                "ok": True,
                "phase": "done",
                "installed": True,
                "installed_at": int(time.time() * 1000),
                "backup_dir": backup_dir,
                "replaced": replaced,
                "restart_required": False,
            })
        finally:
            shutil.rmtree(staging, ignore_errors=True)
    except Exception as exc:
        state.update({
            "ok": False,
            "phase": "failed",
            "installed": False,
            "error": str(exc),
            "failed_at": int(time.time() * 1000),
        })
        # Try rollback if backup exists
        backup_dir = state.get("backup_dir")
        if backup_dir and os.path.isdir(backup_dir):
            try:
                for name in os.listdir(backup_dir):
                    src = os.path.join(backup_dir, name)
                    dst = os.path.join(args.app_dir, name)
                    if os.path.exists(dst):
                        remove_path(dst)
                    copy_entry(src, dst)
                state["phase"] = "rollback"
                state["rollback"] = True
            except Exception as rb_exc:
                state["rollback_error"] = str(rb_exc)
    write_state(args.state, state)
    if state.get("ok") and args.restart:
        restart_app(args.exe)
    return 0 if state.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
