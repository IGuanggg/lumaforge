import asyncio
import hashlib
import hmac
import html
import gzip
import json
import os
import re
import secrets
import shutil
import smtplib
import sqlite3
import tempfile
import time
from contextlib import asynccontextmanager
from email.message import EmailMessage
from typing import Dict, Any

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.getenv("CLOUD_CONFIG_DB", os.path.join(DATA_DIR, "cloud_config.db"))
AVATAR_DIR = os.path.join(DATA_DIR, "avatars")
AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_TYPES = {
    "image/jpeg": ("jpg", b"\xff\xd8"),
    "image/png": ("png", b"\x89PNG\r\n\x1a\n"),
    "image/webp": ("webp", b"RIFF"),
    "image/gif": ("gif", b"GIF"),
}
TOKEN_TTL_SECONDS = int(os.getenv("CLOUD_TOKEN_TTL_SECONDS", str(30 * 24 * 60 * 60)))
RESET_TOKEN_TTL_SECONDS = int(os.getenv("CLOUD_RESET_TOKEN_TTL_SECONDS", str(30 * 60)))
EMAIL_TOKEN_TTL_SECONDS = int(os.getenv("CLOUD_EMAIL_TOKEN_TTL_SECONDS", str(24 * 60 * 60)))
CLOUD_APP_VERSION = os.getenv("CLOUD_APP_VERSION", "1.0.5").strip() or "1.0.5"
CLOUD_PUBLIC_URL = os.getenv("CLOUD_PUBLIC_URL", "").strip().rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USERNAME or "no-reply@infinite-canvas.local").strip()
SMTP_TLS = os.getenv("SMTP_TLS", "1").strip().lower() not in {"0", "false", "no"}
EMAIL_DEV_MODE = os.getenv("CLOUD_EMAIL_DEV_MODE", "").strip().lower() in {"1", "true", "yes"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ADMIN_SESSION_COOKIE = "ic_cloud_admin"
ADMIN_CSRF_COOKIE = "ic_cloud_admin_csrf"
ADMIN_SESSION_TTL_SECONDS = int(os.getenv("CLOUD_ADMIN_SESSION_TTL_SECONDS", str(7 * 24 * 60 * 60)))
INITIAL_ADMIN_USERNAME = os.getenv("CLOUD_ADMIN_USERNAME", "admin").strip() or "admin"
INITIAL_ADMIN_PASSWORD = os.getenv("CLOUD_ADMIN_PASSWORD", "admin")
CONFIG_MAX_BYTES = int(os.getenv("CLOUD_CONFIG_MAX_BYTES", str(1024 * 1024)))
RATE_LIMIT_BUCKETS = {}
BACKUP_PROVIDER_IDS = {"custom_s3", "cloudflare_r2", "aliyun_oss", "aws_s3", "minio"}
BACKUP_ADDRESSING_STYLES = {"auto", "path", "virtual"}
CLOUD_BACKUP_AUTO_INTERVAL_SECONDS = int(os.getenv("CLOUD_BACKUP_AUTO_INTERVAL_SECONDS", str(60 * 60)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_upgrade_safety_snapshot()
    init_db()
    backup_task = asyncio.create_task(auto_backup_loop())
    try:
        yield
    finally:
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Infinite Canvas Cloud Config", lifespan=lifespan)


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#111111"/>
  <text x="32" y="41" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="900" fill="#ffffff">IC</text>
  <rect x="24" y="19" width="4" height="26" rx="2" fill="#3b82f6"/>
  <rect x="40" y="19" width="4" height="26" rx="2" fill="#f59e0b"/>
</svg>"""


@app.get("/favicon.svg", include_in_schema=False)
def favicon_svg():
    return Response(content=FAVICON_SVG, media_type="image/svg+xml")


class AuthPayload(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=200)


class ConfigPayload(BaseModel):
    config: Dict[str, Any]


class ProfilePayload(BaseModel):
    email: str = Field(default="", max_length=200)
    display_name: str = Field(default="", max_length=80)
    avatar_url: str = Field(default="", max_length=2048)


class PasswordPayload(BaseModel):
    current_password: str = Field(min_length=6, max_length=200)
    new_password: str = Field(min_length=6, max_length=200)


class EmailPayload(BaseModel):
    email: str = Field(min_length=3, max_length=200)


class TokenPayload(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ResetPasswordPayload(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=6, max_length=200)


class AdminLoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class AdminPasswordPayload(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    username: str = Field(min_length=1, max_length=80)
    new_password: str = Field(min_length=8, max_length=200)


class AdminSettingsPayload(BaseModel):
    cloud_public_url: str = Field(default="", max_length=2048)
    smtp_host: str = Field(default="", max_length=300)
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = Field(default="", max_length=300)
    smtp_password: str = Field(default="", max_length=1000)
    smtp_from: str = Field(default="", max_length=300)
    smtp_tls: bool = True
    cloud_email_dev_mode: bool = False
    cloud_token_ttl_seconds: int = Field(default=30 * 24 * 60 * 60, ge=3600, le=365 * 24 * 60 * 60)
    cloud_reset_token_ttl_seconds: int = Field(default=30 * 60, ge=300, le=24 * 60 * 60)
    cloud_email_token_ttl_seconds: int = Field(default=24 * 60 * 60, ge=3600, le=7 * 24 * 60 * 60)


class AdminUserPasswordPayload(BaseModel):
    new_password: str = Field(min_length=6, max_length=200)


class BackupSettingsPayload(BaseModel):
    provider: str = Field(default="custom_s3", max_length=80)
    endpoint: str = Field(default="", max_length=500)
    region: str = Field(default="auto", max_length=120)
    addressing_style: str = Field(default="auto", max_length=20)
    bucket: str = Field(default="", max_length=200)
    prefix: str = Field(default="infinite-canvas/backups", max_length=300)
    access_key_id: str = Field(default="", max_length=500)
    secret_access_key: str = Field(default="", max_length=1000)
    encryption_passphrase: str = Field(default="", max_length=1000)
    retention_count: int = Field(default=14, ge=1, le=200)
    auto_interval_seconds: int = Field(default=3600, ge=0, le=7 * 24 * 60 * 60)


class BackupObjectPayload(BaseModel):
    object_key: str = Field(min_length=1, max_length=1024)
    confirm: bool = False


class MediaExistsPayload(BaseModel):
    hashes: list[str] = Field(default_factory=list)


class MediaPrunePayload(BaseModel):
    keep_hashes: list[str] = Field(default_factory=list)
    confirm: bool = False


def now_ms():
    return int(time.time() * 1000)


def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_upgrade_safety_snapshot():
    if not os.path.exists(DB_PATH):
        return
    snapshot = f"{DB_PATH}.before-upgrade-{CLOUD_APP_VERSION}"
    if os.path.exists(snapshot):
        return
    try:
        shutil.copy2(DB_PATH, snapshot)
        print(f"[cloud-db] created upgrade safety snapshot: {snapshot}")
    except Exception as exc:
        print(f"[cloud-db] upgrade safety snapshot failed: {exc}")


def detect_avatar_type(content: bytes, content_type: str = "") -> tuple[str, str]:
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    candidates = [declared] if declared in AVATAR_TYPES else list(AVATAR_TYPES)
    for mime in candidates:
        ext, signature = AVATAR_TYPES[mime]
        if mime == "image/webp":
            if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
                return mime, ext
        elif content.startswith(signature):
            return mime, ext
    raise HTTPException(status_code=400, detail="头像只支持 JPG、PNG、WebP 或 GIF")


def avatar_public_url(request: Request, filename: str) -> str:
    base_url = setting_value("cloud_public_url").strip().rstrip("/")
    if not base_url:
        base_url = str(request.base_url).rstrip("/")
    return f"{base_url}/avatars/{filename}"


def remove_owned_avatar(user_id: int, avatar_url: str):
    filename = os.path.basename((avatar_url or "").split("?", 1)[0])
    if not re.match(rf"^user-{user_id}-[a-f0-9]{{16}}\.(jpg|png|webp|gif)$", filename):
        return
    try:
        os.remove(os.path.join(AVATAR_DIR, filename))
    except OSError:
        pass


DEFAULT_APP_SETTINGS = {
    "cloud_public_url": CLOUD_PUBLIC_URL,
    "smtp_host": SMTP_HOST,
    "smtp_port": str(SMTP_PORT),
    "smtp_username": SMTP_USERNAME,
    "smtp_password": SMTP_PASSWORD,
    "smtp_from": SMTP_FROM,
    "smtp_tls": "1" if SMTP_TLS else "0",
    "cloud_email_dev_mode": "1" if EMAIL_DEV_MODE else "0",
    "cloud_token_ttl_seconds": str(TOKEN_TTL_SECONDS),
    "cloud_reset_token_ttl_seconds": str(RESET_TOKEN_TTL_SECONDS),
    "cloud_email_token_ttl_seconds": str(EMAIL_TOKEN_TTL_SECONDS),
    "backup_provider": os.getenv("CLOUD_BACKUP_PROVIDER", "custom_s3"),
    "backup_endpoint": os.getenv("CLOUD_BACKUP_ENDPOINT", "").strip(),
    "backup_region": os.getenv("CLOUD_BACKUP_REGION", "auto").strip() or "auto",
    "backup_addressing_style": os.getenv("CLOUD_BACKUP_ADDRESSING_STYLE", "auto").strip() or "auto",
    "backup_bucket": os.getenv("CLOUD_BACKUP_BUCKET", "").strip(),
    "backup_prefix": os.getenv("CLOUD_BACKUP_PREFIX", "infinite-canvas/backups").strip(),
    "backup_access_key_id": os.getenv("CLOUD_BACKUP_ACCESS_KEY_ID", "").strip(),
    "backup_secret_access_key": os.getenv("CLOUD_BACKUP_SECRET_ACCESS_KEY", ""),
    "backup_encryption_passphrase": os.getenv("CLOUD_BACKUP_ENCRYPTION_PASSPHRASE", ""),
    "backup_retention_count": os.getenv("CLOUD_BACKUP_RETENTION_COUNT", "14"),
    "backup_auto_interval_seconds": os.getenv("CLOUD_BACKUP_AUTO_INTERVAL_SECONDS", str(CLOUD_BACKUP_AUTO_INTERVAL_SECONDS)),
}


def load_app_settings() -> dict:
    settings = dict(DEFAULT_APP_SETTINGS)
    try:
        with db() as conn:
            rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
        for row in rows:
            settings[row["key"]] = row["value"]
    except sqlite3.Error:
        pass
    return settings


def setting_value(key: str) -> str:
    return str(load_app_settings().get(key, DEFAULT_APP_SETTINGS.get(key, "")) or "")


def setting_int(key: str, default: int) -> int:
    try:
        return int(setting_value(key) or default)
    except (TypeError, ValueError):
        return default


def setting_bool(key: str, default: bool = False) -> bool:
    value = setting_value(key).strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def save_app_settings(values: dict):
    ts = now_ms()
    with db() as conn:
        for key, value in values.items():
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, str(value or ""), ts),
            )


def client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()[:80]
    return (request.client.host if request.client else "unknown")[:80]


def rate_limit(request: Request, bucket: str, identifier: str = "", limit: int = 10, window_seconds: int = 300):
    now = time.time()
    ident = re.sub(r"\s+", "", (identifier or "").lower())[:200]
    key = f"{bucket}:{client_ip(request)}:{ident}"
    window_start = now - window_seconds
    hits = [hit for hit in RATE_LIMIT_BUCKETS.get(key, []) if hit >= window_start]
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    hits.append(now)
    RATE_LIMIT_BUCKETS[key] = hits


def init_db():
    os.makedirs(AVATAR_DIR, exist_ok=True)
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                email_verified INTEGER NOT NULL DEFAULT 0,
                display_name TEXT NOT NULL DEFAULT '',
                avatar_url TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            )
            """
        )
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "display_name" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        if "avatar_url" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
        if "email_verified" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS email_verifications (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_resets (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_configs (
                user_id INTEGER PRIMARY KEY,
                config_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_media (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                media_type TEXT NOT NULL DEFAULT 'file',
                content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                size_bytes INTEGER NOT NULL DEFAULT 0,
                width INTEGER NOT NULL DEFAULT 0,
                height INTEGER NOT NULL DEFAULT 0,
                object_key TEXT NOT NULL,
                public_url TEXT NOT NULL DEFAULT '',
                source_type TEXT NOT NULL DEFAULT '',
                prompt TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id),
                UNIQUE(user_id, sha256)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_media_user_updated ON user_media(user_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_media_user_sha ON user_media(user_id, sha256)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                admin_id INTEGER NOT NULL,
                csrf_hash TEXT NOT NULL DEFAULT '',
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(admin_id) REFERENCES admin_users(id)
            )
            """
        )
        admin_session_columns = {row["name"] for row in conn.execute("PRAGMA table_info(admin_sessions)").fetchall()}
        if "csrf_hash" not in admin_session_columns:
            conn.execute("ALTER TABLE admin_sessions ADD COLUMN csrf_hash TEXT NOT NULL DEFAULT ''")
        conn.execute("DELETE FROM admin_sessions WHERE csrf_hash = ''")
        admin_count = conn.execute("SELECT COUNT(*) AS c FROM admin_users").fetchone()["c"]
        if not admin_count:
            salt = secrets.token_hex(16)
            ts = now_ms()
            conn.execute(
                """
                INSERT INTO admin_users (username, password_hash, salt, must_change_password, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    INITIAL_ADMIN_USERNAME,
                    hash_password(INITIAL_ADMIN_PASSWORD, salt),
                    salt,
                    1 if INITIAL_ADMIN_PASSWORD == "admin" else 0,
                    ts,
                    ts,
                ),
            )


def normalize_email(email: str) -> str:
    value = (email or "").strip().lower()
    if not EMAIL_RE.match(value):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")
    return value


def hash_password(password: str, salt: str) -> str:
    raw = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return raw.hex()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def render_simple_result_page(title: str, message: str) -> str:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
body{{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fb;color:#15171d;display:grid;place-items:center;min-height:100vh}}
.card{{width:min(520px,calc(100vw - 32px));background:white;border:1px solid #e6e8ee;border-radius:14px;padding:28px;box-shadow:0 18px 50px rgba(15,23,42,.08)}}
h1{{margin:0 0 12px;font-size:26px}}
p{{margin:0 0 20px;color:#666;line-height:1.6}}
a{{display:inline-flex;background:#111;color:white;text-decoration:none;border-radius:10px;padding:11px 16px;font-weight:800}}
</style>
</head>
<body>
<div class="card">
<h1>{html.escape(title)}</h1>
<p>{html.escape(message)}</p>
<a href="/">返回云端后台</a>
</div>
</body>
</html>"""


def confirm_email_token(email: str, token: str):
    """公共邮箱验证逻辑，供 POST API 和 GET 页面复用。"""
    email = normalize_email(email)
    token = token.strip()
    if not re.fullmatch(r"\d{6}", token):
        raise HTTPException(status_code=400, detail="验证码格式不正确，应为 6 位数字")
    token_hash = hash_token(token)
    ts = now_ms()
    with db() as conn:
        row = conn.execute(
            """
            SELECT email_verifications.user_id, email_verifications.expires_at, email_verifications.used_at, users.email
            FROM email_verifications
            JOIN users ON users.id = email_verifications.user_id
            WHERE email_verifications.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if not row or row["email"] != email or int(row["used_at"]) or int(row["expires_at"]) < ts:
            raise HTTPException(status_code=400, detail="验证码无效或已过期")
        conn.execute("UPDATE email_verifications SET used_at = ? WHERE token_hash = ?", (ts, token_hash))
        conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (int(row["user_id"]),))


def normalize_admin_username(username: str) -> str:
    value = re.sub(r"\s+", "", (username or "").strip())
    if not value:
        raise HTTPException(status_code=400, detail="管理员账号不能为空")
    return value[:80]


def issue_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    ts = now_ms()
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (hash_token(token), user_id, ts + setting_int("cloud_token_ttl_seconds", TOKEN_TTL_SECONDS) * 1000, ts),
        )
    return token


def issue_admin_session(admin_id: int, response: Response) -> str:
    token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    ts = now_ms()
    with db() as conn:
        conn.execute(
            "INSERT INTO admin_sessions (token_hash, admin_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (hash_token(token), admin_id, hash_token(csrf_token), ts + ADMIN_SESSION_TTL_SECONDS * 1000, ts),
        )
    public_url = setting_value("cloud_public_url").strip().rstrip("/")
    secure_cookie = public_url.startswith("https://")
    response.set_cookie(
        ADMIN_SESSION_COOKIE,
        token,
        max_age=ADMIN_SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=secure_cookie,
    )
    response.set_cookie(
        ADMIN_CSRF_COOKIE,
        csrf_token,
        max_age=ADMIN_SESSION_TTL_SECONDS,
        httponly=False,
        samesite="lax",
        secure=secure_cookie,
    )
    return token


def clear_admin_session_cookies(response: Response):
    response.delete_cookie(ADMIN_SESSION_COOKIE)
    response.delete_cookie(ADMIN_CSRF_COOKIE)


def get_admin_from_request(request: Request):
    token = request.cookies.get(ADMIN_SESSION_COOKIE, "").strip()
    if not token:
        return None
    token_hash = hash_token(token)
    ts = now_ms()
    with db() as conn:
        row = conn.execute(
            """
            SELECT admin_users.id, admin_users.username, admin_users.must_change_password,
                   admin_sessions.expires_at, admin_sessions.csrf_hash
            FROM admin_sessions
            JOIN admin_users ON admin_users.id = admin_sessions.admin_id
            WHERE admin_sessions.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if row and int(row["expires_at"]) < ts:
            conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
            row = None
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "username": row["username"],
        "must_change_password": bool(row["must_change_password"]),
        "csrf_hash": row["csrf_hash"] or "",
    }


def require_admin(request: Request, csrf: bool = False):
    admin = get_admin_from_request(request)
    if not admin:
        raise HTTPException(status_code=401, detail="请先登录管理员控制台")
    if csrf:
        header_token = request.headers.get("x-csrf-token", "").strip()
        cookie_token = request.cookies.get(ADMIN_CSRF_COOKIE, "").strip()
        if not header_token or not cookie_token or not hmac.compare_digest(header_token, cookie_token):
            raise HTTPException(status_code=403, detail="CSRF token invalid")
        if not admin.get("csrf_hash") or not hmac.compare_digest(hash_token(header_token), admin["csrf_hash"]):
            raise HTTPException(status_code=403, detail="CSRF token invalid")
    return admin


def issue_one_time_token(table: str, user_id: int, ttl_seconds: int) -> str:
    if table not in {"email_verifications", "password_resets"}:
        raise ValueError("invalid token table")
    ts = now_ms()
    with db() as conn:
        # 清理该用户旧的未使用验证码，避免多个同时有效
        conn.execute(
            f"UPDATE {table} SET used_at = ? WHERE user_id = ? AND used_at = 0",
            (ts, user_id),
        )
        for _ in range(10):
            token = f"{secrets.randbelow(1000000):06d}"
            token_hash = hash_token(token)
            try:
                conn.execute(
                    f"INSERT INTO {table} (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                    (token_hash, user_id, ts + ttl_seconds * 1000, ts),
                )
                return token
            except sqlite3.IntegrityError:
                continue
    raise HTTPException(status_code=500, detail="验证码生成失败，请重试")


def send_email(to_email: str, subject: str, text: str) -> bool:
    smtp_host = setting_value("smtp_host").strip()
    smtp_port = setting_int("smtp_port", SMTP_PORT)
    smtp_username = setting_value("smtp_username").strip()
    smtp_password = setting_value("smtp_password")
    smtp_from = setting_value("smtp_from").strip() or smtp_username or "no-reply@infinite-canvas.local"
    smtp_tls = setting_bool("smtp_tls", SMTP_TLS)
    email_dev_mode = setting_bool("cloud_email_dev_mode", EMAIL_DEV_MODE)
    if not smtp_host:
        if email_dev_mode:
            print(f"[cloud-email] SMTP_HOST is not set. To: {to_email}; Subject: {subject}; Body:\n{text}")
        else:
            print(f"[cloud-email] SMTP_HOST is not set. To: {to_email}; Subject: {subject}")
        return False
    msg = EmailMessage()
    msg["From"] = smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            if smtp_tls:
                smtp.starttls()
            if smtp_username:
                smtp.login(smtp_username, smtp_password)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        print(f"[cloud-email] send failed. To: {to_email}; Subject: {subject}; Error: {exc}")
        return False


def send_verification_email(user_id: int, email: str) -> dict:
    token = issue_one_time_token("email_verifications", user_id, setting_int("cloud_email_token_ttl_seconds", EMAIL_TOKEN_TTL_SECONDS))
    public_url = setting_value("cloud_public_url").strip().rstrip("/")
    verify_url = f"{public_url}/verify-email?email={email}&token={token}" if public_url else ""
    body = "请验证你的 Infinite Canvas 云端账号邮箱。\n\n"
    body += f"验证码：{token}\n"
    if verify_url:
        body += f"\n也可以点击下面链接完成验证：\n{verify_url}\n"
    sent = send_email(email, "验证 Infinite Canvas 云端邮箱", body)
    result = {"email_sent": sent}
    if setting_bool("cloud_email_dev_mode", EMAIL_DEV_MODE):
        result["dev_token"] = token
    return result


def send_password_reset_email(user_id: int, email: str) -> dict:
    reset_ttl = setting_int("cloud_reset_token_ttl_seconds", RESET_TOKEN_TTL_SECONDS)
    token = issue_one_time_token("password_resets", user_id, reset_ttl)
    body = "你正在重置 Infinite Canvas 云端账号密码。\n\n"
    body += f"重置验证码：{token}\n"
    body += f"有效期：{reset_ttl // 60} 分钟。\n"
    body += "\n请在前端页面输入此验证码完成密码重置。\n"
    sent = send_email(email, "重置 Infinite Canvas 云端密码", body)
    result = {"email_sent": sent}
    if setting_bool("cloud_email_dev_mode", EMAIL_DEV_MODE):
        result["dev_token"] = token
    return result


def user_response(user_id: int, email: str, display_name: str = "", avatar_url: str = "", email_verified: int = 0) -> dict:
    return {
        "token": issue_token(user_id),
        "email": email,
        "email_verified": bool(email_verified),
        "display_name": display_name or "",
        "avatar_url": avatar_url or "",
    }


def dashboard_counts() -> dict:
    with db() as conn:
        users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        verified = conn.execute("SELECT COUNT(*) AS c FROM users WHERE email_verified = 1").fetchone()["c"]
        configs = conn.execute("SELECT COUNT(*) AS c FROM user_configs").fetchone()["c"]
        sessions = conn.execute(
            "SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?",
            (now_ms(),),
        ).fetchone()["c"]
    return {
        "users": users,
        "verified": verified,
        "configs": configs,
        "sessions": sessions,
    }


def public_config_status() -> dict:
    smtp_host = setting_value("smtp_host").strip()
    public_url = setting_value("cloud_public_url").strip().rstrip("/")
    dev_mode = setting_bool("cloud_email_dev_mode", EMAIL_DEV_MODE)
    return {
        "version": CLOUD_APP_VERSION,
        "database": "已挂载" if DB_PATH else "未配置",
        "smtp": "已配置" if smtp_host else "未配置",
        "smtp_configured": bool(smtp_host),
        "public_url": public_url or "未配置",
        "public_url_configured": bool(public_url),
        "dev_mode": "已开启" if dev_mode else "已关闭",
        "dev_mode_enabled": dev_mode,
        "token_ttl_days": max(1, setting_int("cloud_token_ttl_seconds", TOKEN_TTL_SECONDS) // 86400),
        "reset_ttl_minutes": max(1, setting_int("cloud_reset_token_ttl_seconds", RESET_TOKEN_TTL_SECONDS) // 60),
    }


def public_admin_settings() -> dict:
    settings = load_app_settings()
    return {
        "cloud_public_url": settings.get("cloud_public_url", ""),
        "smtp_host": settings.get("smtp_host", ""),
        "smtp_port": setting_int("smtp_port", SMTP_PORT),
        "smtp_username": settings.get("smtp_username", ""),
        "smtp_from": settings.get("smtp_from", ""),
        "smtp_tls": setting_bool("smtp_tls", SMTP_TLS),
        "smtp_password_set": bool(settings.get("smtp_password", "")),
        "cloud_email_dev_mode": setting_bool("cloud_email_dev_mode", EMAIL_DEV_MODE),
        "cloud_token_ttl_seconds": setting_int("cloud_token_ttl_seconds", TOKEN_TTL_SECONDS),
        "cloud_reset_token_ttl_seconds": setting_int("cloud_reset_token_ttl_seconds", RESET_TOKEN_TTL_SECONDS),
        "cloud_email_token_ttl_seconds": setting_int("cloud_email_token_ttl_seconds", EMAIL_TOKEN_TTL_SECONDS),
    }


def normalize_backup_prefix(prefix: str) -> str:
    value = re.sub(r"/+", "/", (prefix or "").strip().replace("\\", "/")).strip("/")
    return value or "infinite-canvas/backups"


def normalize_backup_provider(provider: str) -> str:
    value = (provider or "custom_s3").strip().lower()
    return value if value in BACKUP_PROVIDER_IDS else "custom_s3"


def normalize_backup_region(provider: str, region: str, endpoint: str = "") -> str:
    value = (region or "").strip()
    if value:
        return value
    if provider == "cloudflare_r2":
        return "auto"
    match = re.search(r"oss-([a-z0-9-]+)\.aliyuncs\.com", endpoint or "", re.I)
    if provider == "aliyun_oss" and match:
        return match.group(1)
    return "auto"


def normalize_backup_endpoint(provider: str, endpoint: str, region: str) -> str:
    value = (endpoint or "").strip().rstrip("/")
    if not value:
        if provider == "aliyun_oss" and region and region != "auto":
            return f"https://oss-{region}.aliyuncs.com"
        return ""
    if not re.match(r"^https?://", value, re.I):
        if provider == "cloudflare_r2" and "." not in value and "/" not in value:
            value = f"{value}.r2.cloudflarestorage.com"
        value = "https://" + value
    return value.rstrip("/")


def normalize_backup_addressing_style(provider: str, addressing_style: str) -> str:
    value = (addressing_style or "auto").strip().lower()
    if value not in BACKUP_ADDRESSING_STYLES:
        value = "auto"
    if value == "auto":
        if provider == "cloudflare_r2":
            return "path"
        if provider == "aliyun_oss":
            return "virtual"
    return value


def public_backup_settings() -> dict:
    settings = load_app_settings()
    provider = normalize_backup_provider(settings.get("backup_provider", "custom_s3"))
    region = normalize_backup_region(provider, settings.get("backup_region", "auto"), settings.get("backup_endpoint", ""))
    endpoint = normalize_backup_endpoint(provider, settings.get("backup_endpoint", ""), region)
    return {
        "provider": provider,
        "endpoint": endpoint,
        "region": region,
        "addressing_style": normalize_backup_addressing_style(provider, settings.get("backup_addressing_style", "auto")),
        "bucket": settings.get("backup_bucket", ""),
        "prefix": normalize_backup_prefix(settings.get("backup_prefix", "infinite-canvas/backups")),
        "access_key_id": settings.get("backup_access_key_id", ""),
        "secret_access_key_set": bool(settings.get("backup_secret_access_key", "")),
        "encryption_passphrase_set": bool(settings.get("backup_encryption_passphrase", "")),
        "retention_count": setting_int("backup_retention_count", 14),
        "auto_interval_seconds": setting_int("backup_auto_interval_seconds", CLOUD_BACKUP_AUTO_INTERVAL_SECONDS),
    }


def private_backup_settings() -> dict:
    settings = load_app_settings()
    return {
        **public_backup_settings(),
        "secret_access_key": settings.get("backup_secret_access_key", ""),
        "encryption_passphrase": settings.get("backup_encryption_passphrase", ""),
    }


def require_backup_settings() -> dict:
    settings = private_backup_settings()
    missing = []
    for key, label in (
        ("endpoint", "Endpoint"),
        ("bucket", "Bucket"),
        ("access_key_id", "Access Key"),
        ("secret_access_key", "Secret Key"),
        ("encryption_passphrase", "加密密码"),
    ):
        if not str(settings.get(key) or "").strip():
            missing.append(label)
    if missing:
        raise HTTPException(status_code=400, detail="请先填写云备份配置：" + "、".join(missing))
    return settings


def backup_deps():
    try:
        import boto3
        from botocore.client import Config
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="云备份依赖未安装，请重新构建 Docker 镜像") from exc
    return boto3, Config, AESGCM, PBKDF2HMAC, hashes


def backup_s3_client(settings: dict):
    boto3, Config, *_ = backup_deps()
    addressing_style = normalize_backup_addressing_style(settings.get("provider", ""), settings.get("addressing_style", "auto"))
    return boto3.client(
        "s3",
        endpoint_url=settings["endpoint"].strip().rstrip("/"),
        region_name=(settings.get("region") or "auto").strip() or "auto",
        aws_access_key_id=settings["access_key_id"].strip(),
        aws_secret_access_key=settings["secret_access_key"],
        config=Config(signature_version="s3v4", s3={"addressing_style": addressing_style}),
    )


def backup_key(filename: str, settings: dict) -> str:
    prefix = normalize_backup_prefix(settings.get("prefix", ""))
    return f"{prefix}/{filename}" if prefix else filename


def media_backup_prefix(settings: dict) -> str:
    prefix = normalize_backup_prefix(settings.get("prefix", "infinite-canvas/backups"))
    if prefix.endswith("/backups"):
        prefix = prefix[:-len("/backups")]
    return f"{prefix}/media".strip("/")


def media_object_key(user_id: int, sha256: str, filename: str, settings: dict) -> str:
    ext = os.path.splitext(filename or "")[1].lower()[:16]
    safe_ext = ext if re.match(r"^\.[a-z0-9]+$", ext) else ""
    prefix = media_backup_prefix(settings)
    return f"{prefix}/user-{user_id}/{sha256[:2]}/{sha256}{safe_ext}"


def media_public_url(object_key: str, settings: dict) -> str:
    # R2/S3 private buckets do not guarantee public URLs. Keep the object key as the stable cloud locator.
    return f"r2://{settings.get('bucket', '')}/{object_key}"


def media_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "sha256": row["sha256"],
        "title": row["title"],
        "type": row["media_type"],
        "content_type": row["content_type"],
        "size_bytes": int(row["size_bytes"] or 0),
        "width": int(row["width"] or 0),
        "height": int(row["height"] or 0),
        "object_key": row["object_key"],
        "cloud_url": row["public_url"],
        "updated_at": int(row["updated_at"] or 0),
    }


def encrypt_backup_blob(data: bytes, passphrase: str) -> bytes:
    _, _, AESGCM, PBKDF2HMAC, hashes = backup_deps()
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000)
    key = kdf.derive(passphrase.encode("utf-8"))
    encrypted = AESGCM(key).encrypt(nonce, data, None)
    return b"ICB1" + salt + nonce + encrypted


def decrypt_backup_blob(blob: bytes, passphrase: str) -> bytes:
    if len(blob) < 32 or blob[:4] != b"ICB1":
        raise HTTPException(status_code=400, detail="备份文件格式不正确")
    _, _, AESGCM, PBKDF2HMAC, hashes = backup_deps()
    salt = blob[4:20]
    nonce = blob[20:32]
    encrypted = blob[32:]
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390000)
    key = kdf.derive(passphrase.encode("utf-8"))
    try:
        return AESGCM(key).decrypt(nonce, encrypted, None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="备份解密失败，请确认当前填写的加密密码和创建该备份时完全一致") from exc


def create_sqlite_backup_bytes() -> bytes:
    if not os.path.exists(DB_PATH):
        raise HTTPException(status_code=404, detail="数据库文件不存在")
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="cloud-db-", suffix=".sqlite", delete=False) as tmp:
            temp_path = tmp.name
        source = sqlite3.connect(DB_PATH)
        target = sqlite3.connect(temp_path)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        with open(temp_path, "rb") as f:
            return f.read()
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def validate_sqlite_backup_bytes(data: bytes) -> str:
    temp_path = ""
    try:
        restore_dir = os.path.dirname(DB_PATH) or "."
        os.makedirs(restore_dir, exist_ok=True)
        with tempfile.NamedTemporaryFile(prefix="cloud-restore-", suffix=".sqlite", dir=restore_dir, delete=False) as tmp:
            temp_path = tmp.name
            tmp.write(data)
        conn = sqlite3.connect(temp_path)
        try:
            result = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise HTTPException(status_code=400, detail=f"备份数据库校验失败：{result}")
            needed = {"users", "admin_users", "user_configs", "app_settings"}
            existing = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if not needed.issubset(existing):
                raise HTTPException(status_code=400, detail="备份数据库缺少必要表，已拒绝恢复")
        finally:
            conn.close()
        return temp_path
    except Exception:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def create_backup_package(encrypt: bool = True) -> tuple[bytes, str, bool]:
    raw = create_sqlite_backup_bytes()
    compressed = gzip.compress(raw, compresslevel=9)
    timestamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    if encrypt:
        passphrase = private_backup_settings().get("encryption_passphrase", "")
        if not passphrase:
            raise HTTPException(status_code=400, detail="请先设置备份加密密码，再导出加密备份")
        return (
            encrypt_backup_blob(compressed, passphrase),
            f"infinite-canvas-backup-{timestamp}.sqlite.gz.enc",
            True,
        )
    return compressed, f"infinite-canvas-backup-{timestamp}.sqlite.gz", False


def decode_backup_package(blob: bytes) -> bytes:
    data = blob
    if data[:4] == b"ICB1":
        passphrase = private_backup_settings().get("encryption_passphrase", "")
        if not passphrase:
            raise HTTPException(status_code=400, detail="这是加密备份，请先在云备份配置里填写相同的加密密码")
        data = decrypt_backup_blob(data, passphrase)
    try:
        return gzip.decompress(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="备份解压失败，请确认文件是 .sqlite.gz 或 .sqlite.gz.enc") from exc


def restore_sqlite_backup_bytes(raw: bytes) -> str:
    restored_temp = validate_sqlite_backup_bytes(raw)
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    safety_backup = f"{DB_PATH}.before-restore-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}"
    try:
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, safety_backup)
        os.replace(restored_temp, DB_PATH)
        return safety_backup
    except Exception:
        if restored_temp and os.path.exists(restored_temp):
            os.remove(restored_temp)
        raise


def list_backup_objects(settings: dict, limit: int = 100) -> list:
    client = backup_s3_client(settings)
    prefix = normalize_backup_prefix(settings.get("prefix", ""))
    try:
        response = client.list_objects_v2(Bucket=settings["bucket"], Prefix=prefix, MaxKeys=min(max(limit, 1), 1000))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"读取云备份列表失败：{exc}") from exc
    items = []
    for obj in response.get("Contents", []) or []:
        key = obj.get("Key", "")
        if not key.endswith(".sqlite.gz.enc"):
            continue
        items.append(
            {
                "key": key,
                "size": int(obj.get("Size", 0)),
                "last_modified": obj.get("LastModified").isoformat() if obj.get("LastModified") else "",
                "etag": str(obj.get("ETag", "")).strip('"'),
            }
        )
    items.sort(key=lambda item: item["last_modified"], reverse=True)
    return items


def prune_backup_objects(settings: dict):
    retention = max(1, int(settings.get("retention_count") or 14))
    items = list_backup_objects(settings, limit=1000)
    if len(items) <= retention:
        return []
    client = backup_s3_client(settings)
    deleted = []
    for item in items[retention:]:
        client.delete_object(Bucket=settings["bucket"], Key=item["key"])
        deleted.append(item["key"])
    return deleted


def run_backup_to_object_storage() -> dict:
    settings = require_backup_settings()
    encrypted, filename, _ = create_backup_package(encrypt=True)
    key = backup_key(filename, settings)
    client = backup_s3_client(settings)
    try:
        client.put_object(
            Bucket=settings["bucket"],
            Key=key,
            Body=encrypted,
            ContentType="application/octet-stream",
            Metadata={"app": "infinite-canvas", "format": "sqlite-gzip-aesgcm"},
        )
        deleted = prune_backup_objects(settings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"涓婁紶浜戝浠藉け璐ワ細{exc}") from exc
    return {"ok": True, "key": key, "size": len(encrypted), "deleted": deleted}


async def auto_backup_loop():
    await asyncio.sleep(30)
    while True:
        interval = max(0, setting_int("backup_auto_interval_seconds", CLOUD_BACKUP_AUTO_INTERVAL_SECONDS))
        if interval <= 0:
            await asyncio.sleep(60)
            continue
        try:
            result = await asyncio.to_thread(run_backup_to_object_storage)
            print(f"[cloud-backup] auto backup ok: {result.get('key')} ({result.get('size')} bytes)")
        except HTTPException as exc:
            print(f"[cloud-backup] auto backup skipped: {exc.detail}")
        except Exception as exc:
            print(f"[cloud-backup] auto backup failed: {exc}")
        await asyncio.sleep(interval)


def mask_sensitive_config(value):
    if isinstance(value, dict):
        masked = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(token in key_text for token in ("api_key", "apikey", "password", "secret", "token")):
                masked[key] = "***"
            else:
                masked[key] = mask_sensitive_config(item)
        return masked
    if isinstance(value, list):
        return [mask_sensitive_config(item) for item in value]
    return value


def pill(label: str, tone: str = "") -> str:
    cls = f"pill {tone}".strip()
    return f'<span class="{cls}">{html.escape(label)}</span>'


def render_dashboard_html() -> str:
    counts = dashboard_counts()
    status = public_config_status()
    smtp_tone = "ok" if SMTP_HOST else "warn"
    url_tone = "ok" if CLOUD_PUBLIC_URL else "warn"
    dev_tone = "warn" if EMAIL_DEV_MODE else "ok"
    generated_at = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    features = [
        ("账号注册 / 登录", "邮箱和密码注册，密码使用 PBKDF2 + 独立盐值存储。"),
        ("邮箱验证", "注册后生成一次性邮箱验证码，可在安全页重新发送和确认。"),
        ("忘记密码", "通过邮件验证码重置密码，重置后自动清理该用户旧登录 token。"),
        ("云端配置存储", "每个账号保存一份当前配置，用于登录后下载/上传同步。"),
        ("个人资料", "支持邮箱、昵称、头像 URL 更新，改邮箱后会重新进入待验证状态。"),
        ("自建云端接入", "Docker 用户可部署自己的云端 API，前端高级选项填入该地址。"),
        ("持久化数据", "SQLite 数据库挂载到 Docker volume，备份 cloud-data 即可。"),
        ("健康检查", "提供 /health 给 Docker、反向代理或监控系统探活。"),
    ]
    endpoints = [
        ("GET", "/health", "服务健康检查"),
        ("POST", "/api/auth/register", "注册账号并发送验证邮件"),
        ("POST", "/api/auth/login", "登录并返回 token"),
        ("POST", "/api/auth/email/verify/request", "重新发送邮箱验证"),
        ("POST", "/api/auth/email/verify/confirm", "确认邮箱验证码"),
        ("POST", "/api/auth/password/forgot", "发送密码重置邮件"),
        ("POST", "/api/auth/password/reset", "使用验证码重置密码"),
        ("GET", "/api/me", "读取当前账号资料"),
        ("PUT", "/api/me", "更新资料和绑定邮箱"),
        ("POST", "/api/me/password", "登录后修改密码"),
        ("GET", "/api/configs/current", "下载当前用户云端配置"),
        ("PUT", "/api/configs/current", "上传当前用户云端配置"),
    ]
    feature_html = "\n".join(
        f"""
        <article class="card">
          <div class="card-title">{html.escape(title)}</div>
          <p>{html.escape(desc)}</p>
        </article>
        """
        for title, desc in features
    )
    endpoint_html = "\n".join(
        f"""
        <div class="endpoint-row">
          <span class="method">{html.escape(method)}</span>
          <code>{html.escape(path)}</code>
          <span>{html.escape(desc)}</span>
        </div>
        """
        for method, path, desc in endpoints
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Infinite Canvas Cloud</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root {{
      --bg:#ffffff;
      --stage-bg:#fcfcfc;
      --panel:#ffffff;
      --border:#f2f2f2;
      --text:#121212;
      --muted:#8f8f8f;
      --hover:#fafafa;
      --ok:#0f766e;
      --warn:#b45309;
      --shadow:rgba(0,0,0,.04);
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg:#0f141d;
        --stage-bg:#111722;
        --panel:#151c28;
        --border:#242d3b;
        --text:#e5e9f0;
        --muted:#8f9aab;
        --hover:#171d29;
        --ok:#5eead4;
        --warn:#fbbf24;
        --shadow:rgba(0,0,0,.3);
      }}
    }}
    * {{ box-sizing:border-box; }}
    body {{
      margin:0;
      min-height:100vh;
      background:var(--bg);
      color:var(--text);
      font-family:Inter, "Space Grotesk", "Segoe UI", Arial, sans-serif;
      letter-spacing:0;
    }}
    .shell {{
      min-height:100vh;
      background:linear-gradient(180deg, var(--bg), var(--stage-bg));
      padding:28px;
    }}
    .wrap {{
      max-width:1120px;
      margin:0 auto;
    }}
    .topbar {{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:16px;
      padding:12px 0 22px;
      border-bottom:1px solid var(--border);
    }}
    .brand {{
      display:flex;
      align-items:center;
      gap:12px;
      min-width:0;
    }}
    .logo {{
      width:38px;
      height:38px;
      border-radius:8px;
      display:grid;
      place-items:center;
      background:var(--text);
      color:var(--bg);
      font-weight:900;
    }}
    h1 {{
      margin:0;
      font-size:22px;
      line-height:1.15;
      font-weight:900;
    }}
    .sub {{
      margin-top:4px;
      color:var(--muted);
      font-size:13px;
    }}
    .status-line {{
      display:flex;
      flex-wrap:wrap;
      justify-content:flex-end;
      gap:8px;
    }}
    .pill {{
      min-height:28px;
      display:inline-flex;
      align-items:center;
      border:1px solid var(--border);
      border-radius:8px;
      padding:0 10px;
      color:var(--muted);
      background:var(--panel);
      font-size:12px;
      font-weight:800;
    }}
    .pill.ok {{ color:var(--ok); }}
    .pill.warn {{ color:var(--warn); }}
    .hero {{
      display:grid;
      grid-template-columns:1.35fr .65fr;
      gap:14px;
      margin-top:20px;
    }}
    .panel, .card {{
      background:var(--panel);
      border:1px solid var(--border);
      border-radius:8px;
      box-shadow:0 12px 38px var(--shadow);
    }}
    .panel {{
      padding:18px;
    }}
    .section-title {{
      margin:0 0 12px;
      font-size:13px;
      font-weight:900;
      color:var(--muted);
    }}
    .metrics {{
      display:grid;
      grid-template-columns:repeat(4, minmax(0, 1fr));
      gap:10px;
    }}
    .metric {{
      padding:14px;
      border:1px solid var(--border);
      border-radius:8px;
      background:var(--hover);
    }}
    .num {{
      font-size:26px;
      font-weight:900;
      line-height:1;
    }}
    .label {{
      margin-top:8px;
      color:var(--muted);
      font-size:12px;
      font-weight:800;
    }}
    .config-list {{
      display:flex;
      flex-direction:column;
      gap:10px;
    }}
    .config-row {{
      display:flex;
      justify-content:space-between;
      gap:14px;
      padding-bottom:10px;
      border-bottom:1px solid var(--border);
      font-size:13px;
    }}
    .config-row:last-child {{ border-bottom:0; padding-bottom:0; }}
    .config-row span:first-child {{ color:var(--muted); font-weight:800; }}
    .config-row span:last-child {{ text-align:right; font-weight:850; overflow-wrap:anywhere; }}
    .grid {{
      display:grid;
      grid-template-columns:repeat(4, minmax(0, 1fr));
      gap:10px;
      margin-top:14px;
    }}
    .card {{
      padding:14px;
      box-shadow:none;
    }}
    .card-title {{
      font-size:13px;
      font-weight:900;
      margin-bottom:8px;
    }}
    .card p {{
      margin:0;
      color:var(--muted);
      font-size:12px;
      line-height:1.55;
    }}
    .endpoint-table {{
      display:flex;
      flex-direction:column;
      gap:0;
      overflow:hidden;
      border:1px solid var(--border);
      border-radius:8px;
    }}
    .endpoint-row {{
      display:grid;
      grid-template-columns:72px minmax(220px, .8fr) 1fr;
      gap:12px;
      align-items:center;
      padding:11px 12px;
      border-bottom:1px solid var(--border);
      font-size:13px;
    }}
    .endpoint-row:last-child {{ border-bottom:0; }}
    .endpoint-row:hover {{ background:var(--hover); }}
    .method {{
      font-size:11px;
      font-weight:900;
      color:var(--muted);
    }}
    code {{
      color:var(--text);
      font-family:"SFMono-Regular", Consolas, monospace;
      font-size:12px;
      overflow-wrap:anywhere;
    }}
    .footer {{
      margin:18px 0 4px;
      color:var(--muted);
      font-size:12px;
      text-align:right;
    }}
    @media (max-width:900px) {{
      .shell {{ padding:18px; }}
      .topbar, .hero {{ grid-template-columns:1fr; flex-direction:column; align-items:flex-start; }}
      .status-line {{ justify-content:flex-start; }}
      .metrics, .grid {{ grid-template-columns:repeat(2, minmax(0, 1fr)); }}
      .endpoint-row {{ grid-template-columns:64px 1fr; }}
      .endpoint-row span:last-child {{ grid-column:2; color:var(--muted); }}
    }}
    @media (max-width:560px) {{
      .metrics, .grid {{ grid-template-columns:1fr; }}
      .endpoint-row {{ grid-template-columns:1fr; gap:6px; }}
      .endpoint-row span:last-child {{ grid-column:auto; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <div class="wrap">
      <header class="topbar">
        <div class="brand">
          <div class="logo">IC</div>
          <div>
            <h1>Infinite Canvas Cloud</h1>
            <div class="sub">账号、邮箱验证、密码找回与配置同步后端</div>
          </div>
        </div>
        <div class="status-line">
          {pill("服务在线", "ok")}
          {pill("SMTP " + status["smtp"], smtp_tone)}
          {pill("Public URL " + status["public_url"], url_tone)}
          {pill("Dev Mode " + status["dev_mode"], dev_tone)}
          {pill("v" + status["version"], "ok")}
        </div>
      </header>

      <section class="hero">
        <div class="panel">
          <h2 class="section-title">运行概览</h2>
          <div class="metrics">
            <div class="metric"><div class="num">{counts["users"]}</div><div class="label">注册用户</div></div>
            <div class="metric"><div class="num">{counts["verified"]}</div><div class="label">已验证邮箱</div></div>
            <div class="metric"><div class="num">{counts["configs"]}</div><div class="label">云端配置</div></div>
            <div class="metric"><div class="num">{counts["sessions"]}</div><div class="label">有效登录</div></div>
          </div>
        </div>
        <div class="panel">
          <h2 class="section-title">部署状态</h2>
          <div class="config-list">
            <div class="config-row"><span>数据库</span><span>{html.escape(status["database"])}</span></div>
            <div class="config-row"><span>邮箱服务</span><span>{html.escape(status["smtp"])}</span></div>
            <div class="config-row"><span>登录有效期</span><span>{status["token_ttl_days"]} 天</span></div>
            <div class="config-row"><span>重置有效期</span><span>{status["reset_ttl_minutes"]} 分钟</span></div>
          </div>
        </div>
      </section>

      <section class="panel" style="margin-top:14px">
        <h2 class="section-title">功能清单</h2>
        <div class="grid">{feature_html}</div>
      </section>

      <section class="panel" style="margin-top:14px">
        <h2 class="section-title">API 能力</h2>
        <div class="endpoint-table">{endpoint_html}</div>
      </section>

      <div class="footer">Generated at {html.escape(generated_at)}</div>
    </div>
  </main>
</body>
</html>"""


def render_admin_login_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Infinite Canvas Cloud Admin</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root{--bg:#fff;--stage:#fcfcfc;--panel:#fff;--border:#f2f2f2;--text:#121212;--muted:#8f8f8f;--hover:#fafafa;--danger:#b91c1c;--shadow:rgba(0,0,0,.04)}
    @media (prefers-color-scheme:dark){:root{--bg:#0f141d;--stage:#111722;--panel:#151c28;--border:#242d3b;--text:#e5e9f0;--muted:#8f9aab;--hover:#171d29;--danger:#fca5a5;--shadow:rgba(0,0,0,.3)}}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:linear-gradient(180deg,var(--bg),var(--stage));color:var(--text);font-family:Inter,"Space Grotesk","Segoe UI",Arial,sans-serif;letter-spacing:0}
    .shell{min-height:100vh;display:grid;place-items:center;padding:24px}
    .panel{width:min(440px,calc(100vw - 40px));background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 18px 50px var(--shadow);padding:18px}
    .brand{display:flex;gap:12px;align-items:center;margin-bottom:18px}
    .logo{width:38px;height:38px;border-radius:8px;display:grid;place-items:center;background:var(--text);color:var(--bg);font-weight:900}
    h1{margin:0;font-size:20px;line-height:1.15;font-weight:900}
    .sub{margin-top:4px;color:var(--muted);font-size:13px}
    label{display:flex;flex-direction:column;gap:7px;margin-top:12px;color:var(--muted);font-size:11px;font-weight:850}
    input{height:40px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);padding:0 12px;font-size:14px;outline:none}
    input:focus{border-color:var(--text)}
    .actions{display:flex;gap:10px;margin-top:16px}
    button{height:38px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);padding:0 14px;font-weight:850;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease}
    button:hover{background:var(--hover);transform:translateY(-1px)}
    button.primary{background:var(--text);color:var(--bg);border-color:var(--text)}
    .note{margin-top:14px;color:var(--muted);font-size:12px;line-height:1.55}
    .status{min-height:20px;margin-top:12px;color:var(--danger);font-size:12px;font-weight:800}
  </style>
</head>
<body>
  <main class="shell">
    <section class="panel">
      <div class="brand">
        <div class="logo">IC</div>
        <div>
          <h1>Cloud Admin</h1>
          <div class="sub">登录后管理云端部署状态</div>
        </div>
      </div>
      <label>管理员账号<input id="username" autocomplete="username" placeholder="请输入账号"></label>
      <label>管理员密码<input id="password" type="password" autocomplete="current-password" placeholder="请输入密码"></label>
      <div class="actions">
        <button class="primary" type="button" onclick="login()">登录</button>
      </div>
      <div class="note">请使用管理员账号登录。首次部署请先通过环境变量设置管理员密码。</div>
      <div id="status" class="status"></div>
    </section>
  </main>
  <script>
    async function login(){
      const status=document.getElementById('status');
      status.textContent='正在登录...';
      try{
        const res=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});
        const data=await res.json().catch(()=>({}));
        if(!res.ok) throw new Error(data.detail||'登录失败');
        location.reload();
      }catch(e){status.textContent=e.message||String(e)}
    }
    password.addEventListener('keydown',e=>{if(e.key==='Enter') login()});
  </script>
</body>
</html>"""


def render_admin_console_html(admin: dict) -> str:
    counts = dashboard_counts()
    status = public_config_status()
    settings = public_admin_settings()
    backup = public_backup_settings()
    must_change = bool(admin.get("must_change_password"))
    warning = "首次部署必须修改默认管理员账号和密码。" if must_change else "管理员账号已完成初始化。"
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Infinite Canvas Cloud Admin</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <style>
    :root{{--bg:#fff;--stage:#fcfcfc;--panel:#fff;--border:#f2f2f2;--text:#121212;--muted:#8f8f8f;--hover:#fafafa;--ok:#0f766e;--warn:#b45309;--danger:#b91c1c;--shadow:rgba(0,0,0,.04)}}
    @media (prefers-color-scheme:dark){{:root{{--bg:#0f141d;--stage:#111722;--panel:#151c28;--border:#242d3b;--text:#e5e9f0;--muted:#8f9aab;--hover:#171d29;--ok:#5eead4;--warn:#fbbf24;--danger:#fca5a5;--shadow:rgba(0,0,0,.3)}}}}
    *{{box-sizing:border-box}}
    body{{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:Inter,"Space Grotesk","Segoe UI",Arial,sans-serif;letter-spacing:0}}
    .shell{{min-height:100vh;display:grid;grid-template-columns:64px 1fr;background:linear-gradient(180deg,var(--bg),var(--stage))}}
    .sidebar{{position:sticky;top:0;z-index:20;width:64px;height:100vh;border-right:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 10px;overflow:hidden;transition:width .3s cubic-bezier(.3,0,0,1)}}
    .sidebar:hover,.sidebar.is-expanded{{width:190px;box-shadow:16px 0 36px var(--shadow)}}
    .nav-pill{{width:44px;height:36px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--muted);display:flex;align-items:center;justify-content:center;font-weight:900;cursor:pointer;overflow:hidden;gap:0;flex-shrink:0;transition:width .3s cubic-bezier(.3,0,0,1) .5s,gap .3s cubic-bezier(.3,0,0,1) .5s,transform .18s ease,background .18s ease,color .18s ease,border-color .18s ease}}
    .sidebar:hover .nav-pill,.sidebar.is-expanded .nav-pill{{width:170px;gap:8px;transition-delay:0s}}
    .nav-pill:hover{{background:var(--hover);color:var(--text);border-color:var(--border);transform:translateY(-1px)}}
    .nav-pill.active{{background:var(--text);color:var(--bg);border-color:var(--text)}}
    .nav-pill svg{{width:16px;height:16px;flex:0 0 auto}}
    .nav-label{{opacity:0;max-width:0;font-size:12px;font-weight:850;white-space:nowrap;overflow:hidden;transition:opacity .3s .5s,max-width .3s cubic-bezier(.3,0,0,1) .5s}}
    .sidebar:hover .nav-label,.sidebar.is-expanded .nav-label{{opacity:1;max-width:120px;transition-delay:.15s}}
    .spacer{{flex:1}}
    .content{{padding:28px;min-width:0}}
    .wrap{{max-width:1180px;margin:0 auto}}
    .topbar{{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--border)}}
    .brand{{display:flex;align-items:center;gap:12px;min-width:0}}
    .logo{{width:38px;height:38px;border-radius:8px;display:grid;place-items:center;background:var(--text);color:var(--bg);font-weight:900}}
    h1{{margin:0;font-size:22px;line-height:1.15;font-weight:900}}
    .sub{{margin-top:4px;color:var(--muted);font-size:13px}}
    .pill{{min-height:28px;display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:8px;padding:0 10px;color:var(--muted);background:var(--panel);font-size:12px;font-weight:850}}
    .ok{{color:var(--ok)}}.warn{{color:var(--warn)}}.danger{{color:var(--danger)}}
    .section{{display:none;margin-top:16px}}.section.active{{display:block}}
    .panel,.card{{background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 12px 38px var(--shadow)}}
    .panel{{padding:18px}}
    .section-title{{margin:0 0 12px;color:var(--muted);font-size:13px;font-weight:900}}
    .metrics{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}
    .metric{{padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--hover)}}
    .num{{font-size:26px;font-weight:900;line-height:1}}.label{{margin-top:8px;color:var(--muted);font-size:12px;font-weight:850}}
    .grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}
    .card{{padding:14px;box-shadow:none}}.card-title{{font-size:13px;font-weight:900;margin-bottom:8px}}.card p{{margin:0;color:var(--muted);font-size:12px;line-height:1.55}}
    .rows{{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:8px;overflow:hidden}}
    .row{{display:grid;grid-template-columns:72px minmax(220px,.8fr) 1fr;gap:12px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--border);font-size:13px}}
    .row:last-child{{border-bottom:0}}.row:hover{{background:var(--hover)}}code{{font-family:Consolas,monospace;font-size:12px;overflow-wrap:anywhere}}
    .form{{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px}}label{{display:flex;flex-direction:column;gap:7px;color:var(--muted);font-size:11px;font-weight:850}}label.full{{grid-column:1/-1}}
    input,select{{height:40px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);padding:0 12px;font-size:14px;outline:none}}input:focus,select:focus{{border-color:var(--text)}}
    pre{{max-height:360px;overflow:auto;margin:0;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--text);font-family:Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}}
    .split{{display:grid;grid-template-columns:minmax(260px,.8fr) 1fr;gap:14px}}
    .muted{{color:var(--muted)}}
    .actions{{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}}button{{height:38px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);padding:0 14px;font-weight:850;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease}}button:hover{{background:var(--hover);transform:translateY(-1px)}}button.primary{{background:var(--text);color:var(--bg);border-color:var(--text)}}
    .notice{{margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--hover);color:var(--warn);font-size:13px;font-weight:850}}
    .status{{min-height:20px;margin-top:12px;color:var(--muted);font-size:12px;font-weight:800}}
    @media(max-width:900px){{.content{{padding:18px}}.metrics,.grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}.row{{grid-template-columns:64px 1fr}}.row span:last-child{{grid-column:2;color:var(--muted)}}}}
    @media(max-width:560px){{.metrics,.grid,.form{{grid-template-columns:1fr}}.row{{grid-template-columns:1fr;gap:6px}}.row span:last-child{{grid-column:auto}}}}
  </style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar" aria-label="后台导航" onmouseenter="expandSidebar(true)" onmouseleave="expandSidebar(false)">
      <button class="nav-pill active" data-tab="overview" onclick="showTab('overview')" title="运行概览">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"></path><path d="M7 14l4-4 3 3 5-6"></path></svg>
        <span class="nav-label">运行概览</span>
      </button>
      <button class="nav-pill" data-tab="features" onclick="showTab('features')" title="功能清单">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
        <span class="nav-label">功能清单</span>
      </button>
      <button class="nav-pill" data-tab="users" onclick="showTab('users')" title="用户管理">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <span class="nav-label">用户管理</span>
      </button>
      <button class="nav-pill" data-tab="api" onclick="showTab('api')" title="API 能力">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"></path><path d="M8 6l-6 6 6 6"></path></svg>
        <span class="nav-label">API 能力</span>
      </button>
      <button class="nav-pill" data-tab="settings" onclick="showTab('settings')" title="系统配置">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>
        <span class="nav-label">系统配置</span>
      </button>
      <button class="nav-pill" data-tab="backup" onclick="showTab('backup')" title="云备份">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16l-4-4-4 4"></path><path d="M12 12v9"></path><path d="M20.4 18.5A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 16.3"></path></svg>
        <span class="nav-label">云备份</span>
      </button>
      <button class="nav-pill" data-tab="admin" onclick="showTab('admin')" title="管理员账户">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg>
        <span class="nav-label">管理员账户</span>
      </button>
      <div class="spacer"></div>
      <button class="nav-pill" onclick="logout()" title="退出登录">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>
        <span class="nav-label">退出登录</span>
      </button>
    </aside>
    <section class="content">
      <div class="wrap">
        <header class="topbar">
          <div class="brand"><div class="logo">IC</div><div><h1>Infinite Canvas Cloud</h1><div class="sub">当前管理员：{html.escape(admin["username"])}</div></div></div>
          <div>{pill("服务在线","ok")} {pill("SMTP " + status["smtp"], "ok" if status["smtp_configured"] else "warn")} {pill("Dev Mode " + status["dev_mode"], "warn" if status["dev_mode_enabled"] else "ok")} {pill("v" + status["version"], "ok")}</div>
        </header>

        <section id="tab-overview" class="section active">
          {f'<div class="notice">{html.escape(warning)}</div>' if must_change else ''}
          <div class="panel"><h2 class="section-title">运行概览</h2><div class="metrics">
            <div class="metric"><div class="num">{counts["users"]}</div><div class="label">注册用户</div></div>
            <div class="metric"><div class="num">{counts["verified"]}</div><div class="label">已验证邮箱</div></div>
            <div class="metric"><div class="num">{counts["configs"]}</div><div class="label">云端配置</div></div>
            <div class="metric"><div class="num">{counts["sessions"]}</div><div class="label">有效登录</div></div>
          </div></div>
          <div class="panel" style="margin-top:14px"><h2 class="section-title">部署状态</h2><div class="grid">
            <article class="card"><div class="card-title">数据库</div><p>{html.escape(status["database"])}</p></article>
            <article class="card"><div class="card-title">邮件服务</div><p>{html.escape(status["smtp"])}</p></article>
            <article class="card"><div class="card-title">Public URL</div><p>{html.escape(status["public_url"])}</p></article>
            <article class="card"><div class="card-title">重置有效期</div><p>{status["reset_ttl_minutes"]} 分钟</p></article>
          </div></div>
        </section>

        <section id="tab-features" class="section">
          <div class="panel"><h2 class="section-title">功能清单</h2><div class="grid">
            <article class="card"><div class="card-title">账号注册 / 登录</div><p>邮箱密码注册登录，密码使用 PBKDF2 + salt 存储。</p></article>
            <article class="card"><div class="card-title">邮箱验证</div><p>注册后生成验证码，可重新发送并确认。</p></article>
            <article class="card"><div class="card-title">忘记密码</div><p>邮件验证码重置密码，重置后清理旧 token。</p></article>
            <article class="card"><div class="card-title">云端配置同步</div><p>每个账号保存自己的配置，支持上传和下载。</p></article>
            <article class="card"><div class="card-title">个人资料</div><p>支持邮箱、昵称、头像 URL 更新。</p></article>
            <article class="card"><div class="card-title">自建云端</div><p>Docker 用户可部署自己的云端 API。</p></article>
            <article class="card"><div class="card-title">持久化存储</div><p>SQLite 数据挂载在 cloud-data。</p></article>
            <article class="card"><div class="card-title">管理员控制台</div><p>控制台需要管理员登录，可修改管理员密码。</p></article>
          </div></div>
        </section>

        <section id="tab-api" class="section">
          <div class="panel"><h2 class="section-title">API 能力</h2><div class="rows">
            <div class="row"><span>GET</span><code>/health</code><span>服务健康检查</span></div>
            <div class="row"><span>POST</span><code>/api/auth/register</code><span>注册账号并发送验证邮件</span></div>
            <div class="row"><span>POST</span><code>/api/auth/login</code><span>登录并返回 token</span></div>
            <div class="row"><span>POST</span><code>/api/auth/email/verify/request</code><span>重新发送邮箱验证</span></div>
            <div class="row"><span>POST</span><code>/api/auth/email/verify/confirm</code><span>确认邮箱验证码</span></div>
            <div class="row"><span>POST</span><code>/api/auth/password/forgot</code><span>发送密码重置邮件</span></div>
            <div class="row"><span>POST</span><code>/api/auth/password/reset</code><span>使用验证码重置密码</span></div>
            <div class="row"><span>GET</span><code>/api/me</code><span>读取当前账号资料</span></div>
            <div class="row"><span>PUT</span><code>/api/me</code><span>更新资料和绑定邮箱</span></div>
            <div class="row"><span>GET</span><code>/api/configs/current</code><span>下载当前用户云端配置</span></div>
            <div class="row"><span>PUT</span><code>/api/configs/current</code><span>上传当前用户云端配置</span></div>
          </div></div>
        </section>

        <section id="tab-users" class="section">
          <div class="split">
            <div class="panel">
              <h2 class="section-title">注册用户</h2>
              <div class="actions"><button onclick="loadUsers()">刷新用户</button></div>
              <div id="usersList" class="rows" style="margin-top:12px"></div>
              <div id="usersStatus" class="status">点击用户可查看账户资料和云端配置。</div>
            </div>
            <div id="userDetailPanel" class="panel" hidden>
              <h2 class="section-title">用户详情</h2>
              <div id="userMeta" class="rows"></div>
              <div class="form" style="margin-top:14px">
                <label class="full">重置用户密码<input id="userResetPassword" type="password" autocomplete="new-password" placeholder="输入新密码，不能查看原密码"></label>
              </div>
              <div class="actions"><button class="primary" onclick="resetSelectedUserPassword()">重置密码</button></div>
              <div id="userPasswordStatus" class="status">用户密码为哈希存储，后台不能查看明文。</div>
              <h2 class="section-title" style="margin-top:18px">云端配置</h2>
              <pre id="userConfigJson">暂无配置</pre>
            </div>
          </div>
        </section>

        <section id="tab-settings" class="section">
          <div class="panel">
            <h2 class="section-title">系统配置</h2>
            <div class="form">
              <label class="full">云端公开地址<input id="settingPublicUrl" value="{html.escape(settings["cloud_public_url"])}" placeholder="https://cloud.your-domain.com"></label>
              <label>SMTP Host<input id="settingSmtpHost" value="{html.escape(settings["smtp_host"])}" placeholder="smtp.example.com"></label>
              <label>SMTP Port<input id="settingSmtpPort" type="number" value="{settings["smtp_port"]}"></label>
              <label>SMTP Username<input id="settingSmtpUsername" value="{html.escape(settings["smtp_username"])}" autocomplete="username"></label>
              <label>SMTP Password<input id="settingSmtpPassword" type="password" autocomplete="new-password" placeholder="{'已设置，留空则不修改' if settings['smtp_password_set'] else '请输入邮箱应用专用密码'}"></label>
              <label class="full">SMTP From<input id="settingSmtpFrom" value="{html.escape(settings["smtp_from"])}" placeholder="Infinite Canvas <your@email.com>"></label>
              <label>登录 Token 有效期（秒）<input id="settingTokenTtl" type="number" value="{settings["cloud_token_ttl_seconds"]}"></label>
              <label>重置密码有效期（秒）<input id="settingResetTtl" type="number" value="{settings["cloud_reset_token_ttl_seconds"]}"></label>
              <label>邮箱验证有效期（秒）<input id="settingEmailTtl" type="number" value="{settings["cloud_email_token_ttl_seconds"]}"></label>
              <label>SMTP TLS
                <select id="settingSmtpTls">
                  <option value="1" {'selected' if settings["smtp_tls"] else ''}>开启</option>
                  <option value="0" {'' if settings["smtp_tls"] else 'selected'}>关闭</option>
                </select>
              </label>
              <label>开发模式
                <select id="settingDevMode">
                  <option value="0" {'' if settings["cloud_email_dev_mode"] else 'selected'}>关闭</option>
                  <option value="1" {'selected' if settings["cloud_email_dev_mode"] else ''}>开启</option>
                </select>
              </label>
            </div>
            <div class="actions"><button class="primary" onclick="saveSettings()">保存系统配置</button></div>
            <div id="settingsStatus" class="status">配置保存后立即生效；SMTP 密码不会在页面回显。</div>
          </div>
        </section>

        <section id="tab-backup" class="section">
          <div class="split">
            <div class="panel">
              <h2 class="section-title">云备份目标</h2>
              <div class="form">
                <label>服务商
                  <select id="backupProvider" onchange="syncBackupProviderDefaults(true)">
                    <option value="custom_s3" {'selected' if backup["provider"] == 'custom_s3' else ''}>自定义 S3</option>
                    <option value="cloudflare_r2" {'selected' if backup["provider"] == 'cloudflare_r2' else ''}>Cloudflare R2</option>
                    <option value="aliyun_oss" {'selected' if backup["provider"] == 'aliyun_oss' else ''}>阿里云 OSS</option>
                    <option value="aws_s3" {'selected' if backup["provider"] == 'aws_s3' else ''}>AWS S3</option>
                    <option value="minio" {'selected' if backup["provider"] == 'minio' else ''}>MinIO</option>
                  </select>
                </label>
                <label>Region<input id="backupRegion" value="{html.escape(backup["region"])}" placeholder="auto / cn-hangzhou"></label>
                <label class="full">Endpoint<input id="backupEndpoint" value="{html.escape(backup["endpoint"])}" placeholder="https://xxxx.r2.cloudflarestorage.com 或 https://oss-cn-hangzhou.aliyuncs.com"></label>
                <label>寻址方式
                  <select id="backupAddressingStyle">
                    <option value="auto" {'selected' if backup["addressing_style"] == 'auto' else ''}>自动</option>
                    <option value="path" {'selected' if backup["addressing_style"] == 'path' else ''}>Path style</option>
                    <option value="virtual" {'selected' if backup["addressing_style"] == 'virtual' else ''}>Virtual hosted</option>
                  </select>
                </label>
                <label>Bucket<input id="backupBucket" value="{html.escape(backup["bucket"])}" placeholder="your-bucket"></label>
                <label>备份路径前缀<input id="backupPrefix" value="{html.escape(backup["prefix"])}" placeholder="infinite-canvas/backups"></label>
                <label>Access Key<input id="backupAccessKey" value="{html.escape(backup["access_key_id"])}" autocomplete="username"></label>
                <label>Secret Key<input id="backupSecretKey" type="password" autocomplete="new-password" placeholder="{'已设置，留空则不修改' if backup['secret_access_key_set'] else '请输入 Secret Key'}"></label>
                <label>加密密码<input id="backupPassphrase" type="password" autocomplete="new-password" placeholder="{'已设置，留空则不修改' if backup['encryption_passphrase_set'] else '用于加密备份文件'}"></label>
                <label>保留份数<input id="backupRetention" type="number" value="{backup["retention_count"]}" min="1" max="200"></label>
                <label>自动备份间隔（秒）<input id="backupAutoInterval" type="number" value="{backup["auto_interval_seconds"]}" min="0" max="604800"></label>
              </div>
              <div class="actions">
                <button class="primary" onclick="saveBackupSettings()">保存备份配置</button>
                <button onclick="testBackup()">测试连接</button>
                <button onclick="runBackup()">同步云备份</button>
                <button onclick="exportLocalBackup()">导出本地备份</button>
                <button onclick="chooseRestoreFile()">导入并恢复</button>
              </div>
              <input id="restoreBackupFile" type="file" accept=".enc,.gz,.sqlite" style="display:none" onchange="restoreLocalBackupFile(this.files && this.files[0])">
              <div id="backupStatus" class="status">备份文件会先压缩并 AES-GCM 加密，再上传到对象存储。</div>
            </div>
            <div class="panel">
              <h2 class="section-title">备份记录</h2>
              <div class="actions"><button onclick="loadBackups()">刷新列表</button></div>
              <div id="backupList" class="rows" style="margin-top:12px"></div>
              <div class="status">恢复会先在本地创建安全快照，再替换当前 SQLite 数据库。</div>
            </div>
          </div>
        </section>

        <section id="tab-admin" class="section">
          <div class="panel">
            <h2 class="section-title">管理员账号</h2>
            <div class="form">
              <label>当前密码<input id="currentPassword" type="password" autocomplete="current-password"></label>
              <label>管理员账号<input id="newUsername" value="{html.escape(admin["username"])}" autocomplete="username"></label>
              <label class="full">新密码<input id="newPassword" type="password" autocomplete="new-password" placeholder="至少 8 位"></label>
            </div>
            <div class="actions"><button class="primary" onclick="saveAdmin()">保存管理员账号</button></div>
            <div id="adminStatus" class="status">建议部署后立即修改默认 admin / admin。</div>
          </div>
        </section>
      </div>
    </section>
  </main>
  <script>
    function showTab(name){{
      document.querySelectorAll('.section').forEach(el=>el.classList.toggle('active',el.id==='tab-'+name));
      document.querySelectorAll('.nav-pill[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
      if(name==='users') loadUsers();
      if(name==='backup') loadBackups();
    }}
    function expandSidebar(show){{document.querySelector('.sidebar')?.classList.toggle('is-expanded',!!show);}}
    function escapeText(value){{return String(value??'').replace(/[&<>"']/g,s=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[s]));}}
    function formatTime(ms){{return ms?new Date(ms).toLocaleString():'-';}}
    function cookieValue(name){{
      return document.cookie.split('; ').find(row=>row.startsWith(name+'='))?.split('=').slice(1).join('=')||'';
    }}
    function csrfHeaders(){{
      return {{'Content-Type':'application/json','X-CSRF-Token':decodeURIComponent(cookieValue('{ADMIN_CSRF_COOKIE}'))}};
    }}
    const BACKUP_PROVIDER_HINTS={{
      custom_s3:{{region:'auto',addressing_style:'path',endpoint:'',hint:'自定义 S3 兼容服务：填写完整 Endpoint、Bucket 和访问密钥。'}},
      cloudflare_r2:{{region:'auto',addressing_style:'path',endpoint:'https://<account_id>.r2.cloudflarestorage.com',hint:'Cloudflare R2：Endpoint 可直接填 account id，保存时会补成 https://<account_id>.r2.cloudflarestorage.com。'}},
      aliyun_oss:{{region:'cn-hangzhou',addressing_style:'virtual',endpoint:'https://oss-cn-hangzhou.aliyuncs.com',hint:'阿里云 OSS：建议使用所在地域 Endpoint，例如 https://oss-cn-hangzhou.aliyuncs.com。'}},
      aws_s3:{{region:'us-east-1',addressing_style:'auto',endpoint:'https://s3.amazonaws.com',hint:'AWS S3：通常可使用 https://s3.<region>.amazonaws.com 或 https://s3.amazonaws.com。'}},
      minio:{{region:'us-east-1',addressing_style:'path',endpoint:'http://127.0.0.1:9000',hint:'MinIO：一般使用 Path style，Endpoint 填 MinIO 服务地址。'}}
    }};
    function syncBackupProviderDefaults(force=false){{
      const preset=BACKUP_PROVIDER_HINTS[backupProvider?.value]||BACKUP_PROVIDER_HINTS.custom_s3;
      if(force || !backupRegion.value.trim() || backupRegion.value.trim()==='auto') backupRegion.value=preset.region;
      if(force || !backupAddressingStyle.value || backupAddressingStyle.value==='auto') backupAddressingStyle.value=preset.addressing_style;
      if(force && (!backupEndpoint.value.trim() || backupEndpoint.value.includes('<account_id>') || backupEndpoint.value.includes('oss-cn-hangzhou'))) backupEndpoint.value=preset.endpoint;
      backupEndpoint.placeholder=preset.endpoint||'https://s3-compatible.example.com';
      backupStatus.textContent=preset.hint;
    }}
    let selectedUserId=null;
    async function loadUsers(){{
      const list=document.getElementById('usersList');
      const status=document.getElementById('usersStatus');
      if(!list) return;
      status.textContent='正在读取用户...';
      try{{
        const res=await fetch('/admin/users');
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'读取用户失败');
        if(!data.users?.length){{
          list.innerHTML='<div class="row"><span>-</span><code>暂无用户</code><span></span></div>';
        }}else{{
          list.innerHTML=data.users.map(user=>`
            <div class="row" style="cursor:pointer" onclick="openUserDetail(${{user.id}})">
              <span>#${{user.id}}</span>
              <code>${{escapeText(user.email)}}</code>
              <span>${{user.email_verified?'已验证':'未验证'}} · ${{user.has_config?'有配置':'无配置'}}</span>
            </div>
          `).join('');
        }}
        status.textContent=`共 ${{data.users?.length||0}} 个用户。`;
      }}catch(e){{
        status.textContent=e.message||String(e);
      }}
    }}
    async function openUserDetail(id){{
      selectedUserId=id;
      const panel=document.getElementById('userDetailPanel');
      const meta=document.getElementById('userMeta');
      const config=document.getElementById('userConfigJson');
      const pwdStatus=document.getElementById('userPasswordStatus');
      panel.hidden=false;
      meta.innerHTML='<div class="row"><span>-</span><code>正在读取...</code><span></span></div>';
      config.textContent='正在读取配置...';
      pwdStatus.textContent='用户密码为哈希存储，后台不能查看明文。';
      try{{
        const res=await fetch(`/admin/users/${{id}}`);
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'读取用户详情失败');
        const user=data.user;
        meta.innerHTML=`
          <div class="row"><span>ID</span><code>${{user.id}}</code><span></span></div>
          <div class="row"><span>邮箱</span><code>${{escapeText(user.email)}}</code><span>${{user.email_verified?'已验证':'未验证'}}</span></div>
          <div class="row"><span>昵称</span><code>${{escapeText(user.display_name||'-')}}</code><span></span></div>
          <div class="row"><span>头像</span><code>${{escapeText(user.avatar_url||'-')}}</code><span></span></div>
          <div class="row"><span>创建</span><code>${{formatTime(user.created_at)}}</code><span></span></div>
          <div class="row"><span>密码</span><code>已加密存储</code><span>不能查看明文，可重置</span></div>
          <div class="row"><span>配置</span><code>${{data.config_updated_at?formatTime(data.config_updated_at):'暂无'}}</code><span>${{data.has_config?'已保存':'未保存'}}</span></div>
        `;
        config.textContent=data.has_config?JSON.stringify(data.config,null,2):'暂无配置';
      }}catch(e){{
        meta.innerHTML=`<div class="row"><span>错误</span><code>${{escapeText(e.message||String(e))}}</code><span></span></div>`;
        config.textContent='读取失败';
      }}
    }}
    async function resetSelectedUserPassword(){{
      const status=document.getElementById('userPasswordStatus');
      const input=document.getElementById('userResetPassword');
      if(!selectedUserId){{status.textContent='请先选择用户';return;}}
      if(!input.value){{status.textContent='请输入新密码';return;}}
      status.textContent='正在重置用户密码...';
      try{{
        const res=await fetch(`/admin/users/${{selectedUserId}}/password`,{{method:'POST',headers:csrfHeaders(),body:JSON.stringify({{new_password:input.value}})}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'重置失败');
        input.value='';
        status.textContent='用户密码已重置，旧登录状态已失效。';
      }}catch(e){{status.textContent=e.message||String(e);}}
    }}
    async function saveAdmin(){{
      const status=document.getElementById('adminStatus');
      status.textContent='正在保存...';
      try{{
        const res=await fetch('/admin/password',{{method:'POST',headers:csrfHeaders(),body:JSON.stringify({{current_password:currentPassword.value,username:newUsername.value,new_password:newPassword.value}})}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'保存失败');
        status.textContent='管理员账号已更新，正在返回登录页，请使用新账号密码登录。';
        currentPassword.value='';newPassword.value='';
        setTimeout(()=>{{location.href='/';}},1000);
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    async function saveSettings(){{
      const status=document.getElementById('settingsStatus');
      status.textContent='正在保存...';
      const payload={{
        cloud_public_url:settingPublicUrl.value.trim(),
        smtp_host:settingSmtpHost.value.trim(),
        smtp_port:Number(settingSmtpPort.value||587),
        smtp_username:settingSmtpUsername.value.trim(),
        smtp_password:settingSmtpPassword.value,
        smtp_from:settingSmtpFrom.value.trim(),
        smtp_tls:settingSmtpTls.value==='1',
        cloud_email_dev_mode:settingDevMode.value==='1',
        cloud_token_ttl_seconds:Number(settingTokenTtl.value||2592000),
        cloud_reset_token_ttl_seconds:Number(settingResetTtl.value||1800),
        cloud_email_token_ttl_seconds:Number(settingEmailTtl.value||86400)
      }};
      try{{
        const res=await fetch('/admin/settings',{{method:'POST',headers:csrfHeaders(),body:JSON.stringify(payload)}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'保存失败');
        settingSmtpPassword.value='';
        settingSmtpPassword.placeholder=data.settings.smtp_password_set?'已设置，留空则不修改':'请输入邮箱应用专用密码';
        status.textContent='系统配置已保存并立即生效。';
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    function backupPayload(){{
      return {{
        provider:backupProvider.value,
        endpoint:backupEndpoint.value.trim(),
        region:backupRegion.value.trim()||'auto',
        addressing_style:backupAddressingStyle.value||'auto',
        bucket:backupBucket.value.trim(),
        prefix:backupPrefix.value.trim()||'infinite-canvas/backups',
        access_key_id:backupAccessKey.value.trim(),
        secret_access_key:backupSecretKey.value,
        encryption_passphrase:backupPassphrase.value,
        retention_count:Number(backupRetention.value||14),
        auto_interval_seconds:Number(backupAutoInterval.value||3600)
      }};
    }}
    async function saveBackupSettings(){{
      const status=document.getElementById('backupStatus');
      status.textContent='正在保存备份配置...';
      try{{
        const res=await fetch('/admin/backup/settings',{{method:'POST',headers:csrfHeaders(),body:JSON.stringify(backupPayload())}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'保存失败');
        backupProvider.value=data.settings.provider||backupProvider.value;
        backupEndpoint.value=data.settings.endpoint||backupEndpoint.value;
        backupRegion.value=data.settings.region||backupRegion.value;
        backupAddressingStyle.value=data.settings.addressing_style||backupAddressingStyle.value;
        backupSecretKey.value='';backupPassphrase.value='';
        backupSecretKey.placeholder=data.settings.secret_access_key_set?'已设置，留空则不修改':'请输入 Secret Key';
        backupPassphrase.placeholder=data.settings.encryption_passphrase_set?'已设置，留空则不修改':'用于加密备份文件';
        status.textContent='备份配置已保存。';
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    async function testBackup(){{
      const status=document.getElementById('backupStatus');
      status.textContent='正在测试连接...';
      try{{
        const res=await fetch('/admin/backup/test',{{method:'POST',headers:csrfHeaders()}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'测试失败');
        status.textContent=`连接成功，当前可见备份 ${{data.count||0}} 份。`;
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    async function runBackup(){{
      const status=document.getElementById('backupStatus');
      status.textContent='正在创建并同步加密备份到云端...';
      try{{
        const res=await fetch('/admin/backup/run',{{method:'POST',headers:csrfHeaders()}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'备份失败');
        status.textContent=`云备份同步完成：${{data.key}}`;
        loadBackups();
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    function exportLocalBackup(){{
      window.location.href='/admin/backup/export';
    }}
    function chooseRestoreFile(){{
      document.getElementById('restoreBackupFile')?.click();
    }}
    async function readBackupResponse(res, fallback){{
      const text=await res.text();
      let data={{}};
      if(text){{
        try{{data=JSON.parse(text);}}
        catch(e){{data={{detail:text.slice(0,500)}};}}
      }}
      if(!res.ok) throw new Error(data.detail||fallback);
      return data;
    }}
    async function restoreLocalBackupFile(file){{
      if(!file) return;
      if(!confirm('导入恢复会替换当前数据库。系统会先创建本地安全快照，确定继续吗？')) return;
      const status=document.getElementById('backupStatus');
      status.textContent='正在上传并恢复本地备份...';
      try{{
        const form=new FormData();
        form.append('file',file);
        const headers={{'X-CSRF-Token':decodeURIComponent(cookieValue('{ADMIN_CSRF_COOKIE}'))}};
        const res=await fetch('/admin/backup/import',{{method:'POST',headers,body:form}});
        const data=await readBackupResponse(res,'导入恢复失败');
        status.textContent=`恢复完成，本地安全快照：${{data.safety_backup||'-'}}。正在返回登录页...`;
        setTimeout(()=>{{location.href='/';}},1000);
      }}catch(e){{status.textContent=e.message||String(e)}}
      finally{{const input=document.getElementById('restoreBackupFile'); if(input) input.value='';}}
    }}
    async function loadBackups(){{
      const list=document.getElementById('backupList');
      if(!list) return;
      list.innerHTML='<div class="row"><span>-</span><code>正在读取...</code><span></span></div>';
      try{{
        const res=await fetch('/admin/backup/list');
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'读取备份列表失败');
        if(!data.backups?.length){{
          list.innerHTML='<div class="row"><span>-</span><code>暂无备份</code><span></span></div>';
          return;
        }}
        list.innerHTML=data.backups.map(item=>`
          <div class="row">
            <span>${{Math.ceil((item.size||0)/1024)}} KB</span>
            <code>${{escapeText(item.key)}}</code>
            <span>
              ${{escapeText(item.last_modified||'-')}}
              <button onclick="restoreBackup(decodeURIComponent('${{encodeURIComponent(item.key)}}'))">恢复</button>
              <button onclick="downloadCloudBackup(decodeURIComponent('${{encodeURIComponent(item.key)}}'))">下载</button>
              <button onclick="deleteBackup(decodeURIComponent('${{encodeURIComponent(item.key)}}'))">删除</button>
            </span>
          </div>
        `).join('');
      }}catch(e){{
        list.innerHTML=`<div class="row"><span>错误</span><code>${{escapeText(e.message||String(e))}}</code><span></span></div>`;
      }}
    }}
    function downloadCloudBackup(key){{
      window.location.href=`/admin/backup/download?object_key=${{encodeURIComponent(key)}}`;
    }}
    async function restoreBackup(key){{
      if(!confirm('恢复会替换当前数据库。系统会先创建本地安全快照，确定继续吗？')) return;
      const status=document.getElementById('backupStatus');
      status.textContent='正在下载、解密并恢复备份...';
      try{{
        const res=await fetch('/admin/backup/restore',{{method:'POST',headers:csrfHeaders(),body:JSON.stringify({{object_key:key,confirm:true}})}});
        const data=await readBackupResponse(res,'恢复失败');
        status.textContent=`恢复完成，本地安全快照：${{data.safety_backup||'-'}}。正在返回登录页...`;
        setTimeout(()=>{{location.href='/';}},1000);
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    async function deleteBackup(key){{
      if(!confirm('确定删除这份云端备份吗？')) return;
      const status=document.getElementById('backupStatus');
      status.textContent='正在删除备份...';
      try{{
        const res=await fetch('/admin/backup/delete',{{method:'POST',headers:csrfHeaders(),body:JSON.stringify({{object_key:key,confirm:true}})}});
        const data=await res.json().catch(()=>({{}}));
        if(!res.ok) throw new Error(data.detail||'删除失败');
        status.textContent='备份已删除。';
        loadBackups();
      }}catch(e){{status.textContent=e.message||String(e)}}
    }}
    syncBackupProviderDefaults(false);
    async function logout(){{await fetch('/admin/logout',{{method:'POST',headers:{{'X-CSRF-Token':decodeURIComponent(cookieValue('{ADMIN_CSRF_COOKIE}'))}}}});location.reload();}}
  </script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    admin = get_admin_from_request(request)
    if not admin:
        return HTMLResponse(render_admin_login_html())
    return HTMLResponse(render_admin_console_html(admin))


@app.post("/admin/login")
def admin_login(payload: AdminLoginPayload, request: Request, response: Response):
    username = normalize_admin_username(payload.username)
    rate_limit(request, "admin_login", username, limit=8, window_seconds=300)
    with db() as conn:
        row = conn.execute("SELECT * FROM admin_users WHERE username = ?", (username,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="管理员账号或密码不正确")
    expected = hash_password(payload.password, row["salt"])
    if not hmac.compare_digest(expected, row["password_hash"]):
        raise HTTPException(status_code=401, detail="管理员账号或密码不正确")
    issue_admin_session(int(row["id"]), response)
    return {"ok": True, "username": row["username"], "must_change_password": bool(row["must_change_password"])}


@app.post("/admin/logout")
def admin_logout(request: Request, response: Response):
    require_admin(request, csrf=True)
    token = request.cookies.get(ADMIN_SESSION_COOKIE, "").strip()
    if token:
        with db() as conn:
            conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (hash_token(token),))
    clear_admin_session_cookies(response)
    return {"ok": True}


@app.get("/admin/status")
def admin_status(request: Request):
    admin = require_admin(request)
    return {
        "logged_in": True,
        "id": admin["id"],
        "username": admin["username"],
        "must_change_password": admin["must_change_password"],
    }


@app.get("/admin/settings")
def admin_get_settings(request: Request):
    require_admin(request)
    return public_admin_settings()


@app.post("/admin/settings")
def admin_save_settings(payload: AdminSettingsPayload, request: Request):
    require_admin(request, csrf=True)
    public_url = payload.cloud_public_url.strip().rstrip("/")
    if public_url and not re.match(r"^https?://", public_url):
        raise HTTPException(status_code=400, detail="云端公开地址需要以 http:// 或 https:// 开头")
    current = load_app_settings()
    smtp_password = payload.smtp_password if payload.smtp_password else current.get("smtp_password", "")
    save_app_settings(
        {
            "cloud_public_url": public_url,
            "smtp_host": payload.smtp_host.strip(),
            "smtp_port": str(payload.smtp_port),
            "smtp_username": payload.smtp_username.strip(),
            "smtp_password": smtp_password,
            "smtp_from": payload.smtp_from.strip(),
            "smtp_tls": "1" if payload.smtp_tls else "0",
            "cloud_email_dev_mode": "1" if payload.cloud_email_dev_mode else "0",
            "cloud_token_ttl_seconds": str(payload.cloud_token_ttl_seconds),
            "cloud_reset_token_ttl_seconds": str(payload.cloud_reset_token_ttl_seconds),
            "cloud_email_token_ttl_seconds": str(payload.cloud_email_token_ttl_seconds),
        }
    )
    return {"ok": True, "settings": public_admin_settings(), "status": public_config_status()}


@app.get("/admin/backup/settings")
def admin_backup_get_settings(request: Request):
    require_admin(request)
    return public_backup_settings()


@app.post("/admin/backup/settings")
def admin_backup_save_settings(payload: BackupSettingsPayload, request: Request):
    require_admin(request, csrf=True)
    provider = normalize_backup_provider(payload.provider)
    region = normalize_backup_region(provider, payload.region, payload.endpoint)
    endpoint = normalize_backup_endpoint(provider, payload.endpoint, region)
    addressing_style = normalize_backup_addressing_style(provider, payload.addressing_style)
    if endpoint and not re.match(r"^https?://", endpoint):
        raise HTTPException(status_code=400, detail="Endpoint 需要以 http:// 或 https:// 开头")
    if provider == "cloudflare_r2" and endpoint and "r2.cloudflarestorage.com" not in endpoint:
        raise HTTPException(status_code=400, detail="Cloudflare R2 Endpoint 通常形如 https://<account_id>.r2.cloudflarestorage.com")
    if provider == "aliyun_oss" and endpoint and ".aliyuncs.com" not in endpoint:
        raise HTTPException(status_code=400, detail="阿里云 OSS Endpoint 通常形如 https://oss-cn-hangzhou.aliyuncs.com")
    current = load_app_settings()
    secret = payload.secret_access_key if payload.secret_access_key else current.get("backup_secret_access_key", "")
    passphrase = payload.encryption_passphrase if payload.encryption_passphrase else current.get("backup_encryption_passphrase", "")
    save_app_settings(
        {
            "backup_provider": provider,
            "backup_endpoint": endpoint,
            "backup_region": region,
            "backup_addressing_style": addressing_style,
            "backup_bucket": payload.bucket.strip(),
            "backup_prefix": normalize_backup_prefix(payload.prefix),
            "backup_access_key_id": payload.access_key_id.strip(),
            "backup_secret_access_key": secret,
            "backup_encryption_passphrase": passphrase,
            "backup_retention_count": str(payload.retention_count),
            "backup_auto_interval_seconds": str(payload.auto_interval_seconds),
        }
    )
    return {"ok": True, "settings": public_backup_settings()}


@app.post("/admin/backup/test")
def admin_backup_test(request: Request):
    require_admin(request, csrf=True)
    settings = require_backup_settings()
    try:
        backups = list_backup_objects(settings, limit=20)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"云备份连接失败：{exc}") from exc
    return {"ok": True, "count": len(backups), "settings": public_backup_settings()}


@app.get("/admin/backup/list")
def admin_backup_list(request: Request):
    require_admin(request)
    settings = require_backup_settings()
    return {"backups": list_backup_objects(settings, limit=200), "settings": public_backup_settings()}


@app.get("/admin/backup/export")
def admin_backup_export(request: Request, encrypted: bool = Query(default=True)):
    require_admin(request)
    blob, filename, is_encrypted = create_backup_package(encrypt=encrypted)
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Backup-Encrypted": "1" if is_encrypted else "0",
        },
    )


@app.post("/admin/backup/import")
async def admin_backup_import(request: Request, response: Response, file: UploadFile = File(...)):
    require_admin(request, csrf=True)
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="备份文件为空")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="备份文件太大，最大支持 50MB")
    try:
        raw = decode_backup_package(content)
        safety_backup = restore_sqlite_backup_bytes(raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"导入恢复失败：{type(exc).__name__}: {exc}") from exc
    clear_admin_session_cookies(response)
    return {"ok": True, "safety_backup": safety_backup, "logout_required": True}


@app.get("/admin/backup/download")
def admin_backup_download(request: Request, object_key: str = Query(min_length=1, max_length=1024)):
    require_admin(request)
    settings = require_backup_settings()
    client = backup_s3_client(settings)
    try:
        response = client.get_object(Bucket=settings["bucket"], Key=object_key)
        blob = response["Body"].read()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"下载云备份失败：{exc}") from exc
    filename = os.path.basename(object_key) or "infinite-canvas-backup.sqlite.gz.enc"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/admin/backup/run")
def admin_backup_run(request: Request):
    require_admin(request, csrf=True)
    settings = require_backup_settings()
    encrypted, filename, _ = create_backup_package(encrypt=True)
    key = backup_key(filename, settings)
    client = backup_s3_client(settings)
    try:
        client.put_object(
            Bucket=settings["bucket"],
            Key=key,
            Body=encrypted,
            ContentType="application/octet-stream",
            Metadata={"app": "infinite-canvas", "format": "sqlite-gzip-aesgcm"},
        )
        deleted = prune_backup_objects(settings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"上传云备份失败：{exc}") from exc
    return {"ok": True, "key": key, "size": len(encrypted), "deleted": deleted}


@app.post("/admin/backup/restore")
def admin_backup_restore(payload: BackupObjectPayload, request: Request, response: Response):
    require_admin(request, csrf=True)
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="恢复数据库需要二次确认")
    settings = require_backup_settings()
    client = backup_s3_client(settings)
    try:
        response = client.get_object(Bucket=settings["bucket"], Key=payload.object_key)
        encrypted = response["Body"].read()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"下载云备份失败：{exc}") from exc
    try:
        raw = decode_backup_package(encrypted)
        safety_backup = restore_sqlite_backup_bytes(raw)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"恢复备份失败：{type(exc).__name__}: {exc}") from exc
    clear_admin_session_cookies(response)
    return {"ok": True, "safety_backup": safety_backup, "logout_required": True}


@app.post("/admin/backup/delete")
def admin_backup_delete(payload: BackupObjectPayload, request: Request):
    require_admin(request, csrf=True)
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="删除云端备份需要二次确认")
    settings = require_backup_settings()
    client = backup_s3_client(settings)
    try:
        client.delete_object(Bucket=settings["bucket"], Key=payload.object_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"删除云备份失败：{exc}") from exc
    return {"ok": True}


@app.get("/admin/users")
def admin_list_users(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default="", max_length=200),
):
    require_admin(request)
    search_value = (search or "").strip()
    where_sql = ""
    params = []
    if search_value:
        where_sql = "WHERE users.email LIKE ? OR users.display_name LIKE ?"
        like_value = f"%{search_value}%"
        params.extend([like_value, like_value])
    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM users {where_sql}", params).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT users.id, users.email, users.display_name, users.avatar_url, users.email_verified, users.created_at,
                   user_configs.updated_at AS config_updated_at
            FROM users
            LEFT JOIN user_configs ON user_configs.user_id = users.id
            {where_sql}
            ORDER BY users.created_at DESC
            LIMIT ? OFFSET ?
            """
            ,
            (*params, limit, offset),
        ).fetchall()
    users = [
        {
            "id": int(row["id"]),
            "email": row["email"],
            "display_name": row["display_name"],
            "avatar_url": row["avatar_url"],
            "email_verified": bool(row["email_verified"]),
            "created_at": int(row["created_at"]),
            "has_config": row["config_updated_at"] is not None,
            "config_updated_at": int(row["config_updated_at"] or 0),
            "password_status": "hashed",
        }
        for row in rows
    ]
    return {"users": users, "total": int(total), "limit": limit, "offset": offset}


@app.get("/admin/users/{user_id}")
def admin_user_detail(user_id: int, request: Request):
    require_admin(request)
    with db() as conn:
        user = conn.execute(
            """
            SELECT id, email, display_name, avatar_url, email_verified, created_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
        config_row = conn.execute(
            "SELECT config_json, updated_at FROM user_configs WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    config = None
    config_updated_at = 0
    if config_row:
        try:
            config = mask_sensitive_config(json.loads(config_row["config_json"]))
        except Exception:
            config = {"error": "配置 JSON 解析失败"}
        config_updated_at = int(config_row["updated_at"])
    return {
        "user": {
            "id": int(user["id"]),
            "email": user["email"],
            "display_name": user["display_name"],
            "avatar_url": user["avatar_url"],
            "email_verified": bool(user["email_verified"]),
            "created_at": int(user["created_at"]),
            "password_status": "hashed",
            "password_visible": False,
        },
        "has_config": config is not None,
        "config_updated_at": config_updated_at,
        "config": config,
    }


@app.post("/admin/users/{user_id}/password")
def admin_reset_user_password(user_id: int, payload: AdminUserPasswordPayload, request: Request):
    require_admin(request, csrf=True)
    salt = secrets.token_hex(16)
    password_hash = hash_password(payload.new_password, salt)
    with db() as conn:
        row = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user_id),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"ok": True}


@app.post("/admin/password")
def admin_change_password(payload: AdminPasswordPayload, request: Request, response: Response):
    admin = require_admin(request, csrf=True)
    username = normalize_admin_username(payload.username)
    with db() as conn:
        row = conn.execute("SELECT * FROM admin_users WHERE id = ?", (admin["id"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="管理员不存在")
        expected = hash_password(payload.current_password, row["salt"])
        if not hmac.compare_digest(expected, row["password_hash"]):
            raise HTTPException(status_code=401, detail="当前密码不正确")
        salt = secrets.token_hex(16)
        password_hash = hash_password(payload.new_password, salt)
        try:
            conn.execute(
                """
                UPDATE admin_users
                SET username = ?, password_hash = ?, salt = ?, must_change_password = 0, updated_at = ?
                WHERE id = ?
                """,
                (username, password_hash, salt, now_ms(), admin["id"]),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="这个管理员账号已存在") from exc
        conn.execute("DELETE FROM admin_sessions WHERE admin_id = ?", (admin["id"],))
    clear_admin_session_cookies(response)
    return {"ok": True, "username": username, "logout_required": True}


@app.post("/api/auth/register")
def register(payload: AuthPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "register", email, limit=10, window_seconds=3600)
    salt = secrets.token_hex(16)
    password_hash = hash_password(payload.password, salt)
    try:
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO users (email, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                (email, password_hash, salt, now_ms()),
            )
            user_id = int(cur.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="这个邮箱已经注册过") from exc
    verification = send_verification_email(user_id, email)
    return {**user_response(user_id, email), **verification}


@app.post("/api/auth/login")
def login(payload: AuthPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "user_login", email, limit=10, window_seconds=300)
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    expected = hash_password(payload.password, row["salt"])
    if not hmac.compare_digest(expected, row["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    return user_response(int(row["id"]), email, row["display_name"], row["avatar_url"], row["email_verified"])


@app.post("/api/auth/email/verify/request")
def request_email_verify(payload: EmailPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "email_verify", email, limit=3, window_seconds=600)
    result = {}
    with db() as conn:
        row = conn.execute("SELECT id, email_verified FROM users WHERE email = ?", (email,)).fetchone()
    if row and not int(row["email_verified"]):
        result = send_verification_email(int(row["id"]), email)
    return {"ok": True, **result}


@app.post("/api/auth/email/verify/confirm")
def confirm_email_verify(payload: TokenPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "email_verify_confirm", email, limit=10, window_seconds=300)
    confirm_email_token(email, payload.token)
    return {"ok": True}


@app.get("/verify-email", response_class=HTMLResponse)
def verify_email_page(email: str = "", token: str = "", request: Request = None):
    email = (email or "").strip().lower()
    token = (token or "").strip()
    if not email or not token:
        return HTMLResponse(render_simple_result_page("邮箱验证失败", "缺少邮箱或验证码。"), status_code=400)
    try:
        rate_limit(request, "email_verify_confirm", email, limit=10, window_seconds=300)
        confirm_email_token(email, token)
        return HTMLResponse(render_simple_result_page("邮箱验证成功", "你的邮箱已经验证，可以回到 Infinite Canvas 登录。"))
    except HTTPException as exc:
        return HTMLResponse(render_simple_result_page("邮箱验证失败", str(exc.detail)), status_code=400)


@app.post("/api/auth/password/forgot")
def forgot_password(payload: EmailPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "forgot_password", email, limit=3, window_seconds=600)
    result = {"email_sent": False}
    with db() as conn:
        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        result = send_password_reset_email(int(row["id"]), email)
    return {"ok": True, **result}


@app.post("/api/auth/password/reset")
def reset_password(payload: ResetPasswordPayload, request: Request):
    email = normalize_email(payload.email)
    rate_limit(request, "reset_password", email, limit=10, window_seconds=300)
    token_hash = hash_token(payload.token.strip())
    ts = now_ms()
    with db() as conn:
        row = conn.execute(
            """
            SELECT password_resets.user_id, password_resets.expires_at, password_resets.used_at, users.email
            FROM password_resets
            JOIN users ON users.id = password_resets.user_id
            WHERE password_resets.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if not row or row["email"] != email or int(row["used_at"]) or int(row["expires_at"]) < ts:
            raise HTTPException(status_code=400, detail="重置验证码无效或已过期")
        salt = secrets.token_hex(16)
        password_hash = hash_password(payload.new_password, salt)
        user_id = int(row["user_id"])
        conn.execute("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", (ts, token_hash))
        conn.execute("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?", (password_hash, salt, user_id))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return {"ok": True}


def current_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少登录 token")
    token = authorization.removeprefix("Bearer ").strip()
    token_hash = hash_token(token)
    ts = now_ms()
    with db() as conn:
        row = conn.execute(
            """
            SELECT users.id, users.email, users.email_verified, users.display_name, users.avatar_url, sessions.expires_at
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
        if row and int(row["expires_at"]) < ts:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            row = None
    if not row:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return {
        "id": int(row["id"]),
        "email": row["email"],
        "email_verified": bool(row["email_verified"]),
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"],
        "session_token_hash": token_hash,
    }


@app.get("/health")
def health():
    return {"status": "ok", "version": CLOUD_APP_VERSION}


@app.get("/version")
def version():
    return {"name": "infinite-canvas-cloud", "version": CLOUD_APP_VERSION}


@app.get("/avatars/{filename}")
def get_avatar(filename: str):
    if not re.match(r"^user-\d+-[a-f0-9]{16}\.(jpg|png|webp|gif)$", filename):
        raise HTTPException(status_code=404, detail="头像不存在")
    path = os.path.join(AVATAR_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="头像不存在")
    ext = filename.rsplit(".", 1)[-1].lower()
    media_type = {
        "jpg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
    }.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media_type)


@app.get("/api/me")
def get_me(user=Depends(current_user)):
    return {
        "email": user["email"],
        "email_verified": bool(user.get("email_verified")),
        "display_name": user.get("display_name") or "",
        "avatar_url": user.get("avatar_url") or "",
    }


@app.put("/api/me")
def update_me(payload: ProfilePayload, user=Depends(current_user)):
    email = normalize_email(payload.email) if payload.email else user["email"]
    display_name = re.sub(r"\s+", " ", (payload.display_name or "").strip())[:80]
    avatar_url = (payload.avatar_url or "").strip()
    email_changed = email != user["email"]
    if avatar_url and not re.match(r"^https?://", avatar_url):
        raise HTTPException(status_code=400, detail="头像地址需要以 http:// 或 https:// 开头")
    try:
        with db() as conn:
            conn.execute(
                "UPDATE users SET email = ?, email_verified = ?, display_name = ?, avatar_url = ? WHERE id = ?",
                (email, 0 if email_changed else int(user.get("email_verified", 0)), display_name, avatar_url, user["id"]),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="这个邮箱已经被绑定") from exc
    if email_changed:
        send_verification_email(user["id"], email)
    return {"email": email, "email_verified": not email_changed and bool(user.get("email_verified")), "display_name": display_name, "avatar_url": avatar_url}


@app.post("/api/me/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...), user=Depends(current_user)):
    content = await file.read(AVATAR_MAX_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="请选择头像文件")
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="头像文件不能超过 5MB")
    mime, ext = detect_avatar_type(content, file.content_type or "")
    os.makedirs(AVATAR_DIR, exist_ok=True)
    filename = f"user-{user['id']}-{secrets.token_hex(8)}.{ext}"
    path = os.path.join(AVATAR_DIR, filename)
    with open(path, "wb") as fh:
        fh.write(content)
    avatar_url = avatar_public_url(request, filename)
    with db() as conn:
        row = conn.execute("SELECT avatar_url FROM users WHERE id = ?", (user["id"],)).fetchone()
        conn.execute("UPDATE users SET avatar_url = ? WHERE id = ?", (avatar_url, user["id"]))
    if row:
        remove_owned_avatar(user["id"], row["avatar_url"])
    return {
        "email": user["email"],
        "email_verified": bool(user.get("email_verified")),
        "display_name": user.get("display_name") or "",
        "avatar_url": avatar_url,
        "content_type": mime,
    }


@app.post("/api/me/password")
def change_password(payload: PasswordPayload, user=Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT password_hash, salt FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="用户不存在")
        expected = hash_password(payload.current_password, row["salt"])
        if not hmac.compare_digest(expected, row["password_hash"]):
            raise HTTPException(status_code=401, detail="当前密码不正确")
        salt = secrets.token_hex(16)
        password_hash = hash_password(payload.new_password, salt)
        conn.execute(
            "UPDATE users SET password_hash = ?, salt = ? WHERE id = ?",
            (password_hash, salt, user["id"]),
        )
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
            (user["id"], user["session_token_hash"]),
        )
    return {"ok": True}


@app.get("/api/configs/current")
def get_config(user=Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT config_json, updated_at FROM user_configs WHERE user_id = ?", (user["id"],)).fetchone()
    if not row:
        return {"config": None, "updated_at": 0}
    return {"config": json.loads(row["config_json"]), "updated_at": row["updated_at"]}


@app.put("/api/configs/current")
def put_config(payload: ConfigPayload, user=Depends(current_user)):
    config_json = json.dumps(payload.config, ensure_ascii=False, separators=(",", ":"))
    config_size = len(config_json.encode("utf-8"))
    if config_size > CONFIG_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"配置太大，最大允许 {CONFIG_MAX_BYTES} bytes")
    ts = now_ms()
    with db() as conn:
        conn.execute(
            """
            INSERT INTO user_configs (user_id, config_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
            """,
            (user["id"], config_json, ts),
        )
    return {"ok": True, "updated_at": ts}


@app.get("/api/media/status")
def media_status(user=Depends(current_user)):
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM user_media WHERE user_id = ?", (user["id"],)).fetchone()["c"]
        size = conn.execute("SELECT COALESCE(SUM(size_bytes), 0) AS s FROM user_media WHERE user_id = ?", (user["id"],)).fetchone()["s"]
        rows = conn.execute(
            """
            SELECT media_type, COUNT(*) AS c, COALESCE(SUM(size_bytes), 0) AS s
            FROM user_media
            WHERE user_id = ?
            GROUP BY media_type
            """,
            (user["id"],),
        ).fetchall()
    by_type = {row["media_type"]: {"count": int(row["c"] or 0), "size_bytes": int(row["s"] or 0)} for row in rows}
    return {
        "ok": True,
        "total": int(total or 0),
        "size_bytes": int(size or 0),
        "by_type": by_type,
        "r2_free_hint": {"storage_bytes": 10 * 1024 * 1024 * 1024, "class_a_monthly": 1_000_000, "class_b_monthly": 10_000_000},
    }


@app.post("/api/media/exists")
def media_exists(payload: MediaExistsPayload, user=Depends(current_user)):
    hashes = [str(x).strip().lower() for x in payload.hashes if re.match(r"^[a-f0-9]{64}$", str(x).strip().lower())]
    if not hashes:
        return {"items": {}}
    found = {}
    with db() as conn:
        for i in range(0, len(hashes), 400):
            chunk = hashes[i:i + 400]
            placeholders = ",".join(["?"] * len(chunk))
            rows = conn.execute(
                f"SELECT * FROM user_media WHERE user_id = ? AND sha256 IN ({placeholders})",
                (user["id"], *chunk),
            ).fetchall()
            found.update({row["sha256"]: media_row_to_dict(row) for row in rows})
    return {"items": found}


@app.post("/api/media/upload")
async def media_upload(request: Request, file: UploadFile = File(...), metadata: str = "", user=Depends(current_user)):
    settings = require_backup_settings()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    sha = hashlib.sha256(raw).hexdigest()
    meta = {}
    if metadata:
        try:
            meta = json.loads(metadata)
        except Exception:
            meta = {}
    title = str(meta.get("title") or file.filename or sha)[:300]
    media_type = str(meta.get("type") or "file")[:40]
    if media_type not in {"image", "video", "file"}:
        media_type = "file"
    content_type = (file.content_type or meta.get("content_type") or "application/octet-stream").split(";", 1)[0].strip()
    width = int(meta.get("width") or 0)
    height = int(meta.get("height") or 0)
    existing = None
    with db() as conn:
        existing = conn.execute("SELECT * FROM user_media WHERE user_id = ? AND sha256 = ?", (user["id"], sha)).fetchone()
    if existing:
        return {"ok": True, "skipped": True, "item": media_row_to_dict(existing)}

    object_key = media_object_key(user["id"], sha, file.filename or title, settings)
    client = backup_s3_client(settings)
    try:
        client.put_object(
            Bucket=settings["bucket"],
            Key=object_key,
            Body=raw,
            ContentType=content_type,
            Metadata={
                "user_id": str(user["id"]),
                "sha256": sha,
                "title": title.encode("utf-8", "ignore").decode("utf-8")[:120],
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"upload to object storage failed: {exc}") from exc

    ts = now_ms()
    media_id = sha[:20]
    public_url = media_public_url(object_key, settings)
    with db() as conn:
        conn.execute(
            """
            INSERT INTO user_media (
                id, user_id, sha256, title, media_type, content_type, size_bytes, width, height,
                object_key, public_url, source_type, prompt, model, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, sha256) DO UPDATE SET
                title=excluded.title,
                media_type=excluded.media_type,
                content_type=excluded.content_type,
                size_bytes=excluded.size_bytes,
                width=excluded.width,
                height=excluded.height,
                object_key=excluded.object_key,
                public_url=excluded.public_url,
                source_type=excluded.source_type,
                prompt=excluded.prompt,
                model=excluded.model,
                updated_at=excluded.updated_at
            """,
            (
                media_id, user["id"], sha, title, media_type, content_type, len(raw), width, height,
                object_key, public_url, str(meta.get("source_type") or "")[:80],
                str(meta.get("prompt") or "")[:4000], str(meta.get("model") or "")[:300], ts, ts,
            ),
        )
        row = conn.execute("SELECT * FROM user_media WHERE user_id = ? AND sha256 = ?", (user["id"], sha)).fetchone()
    return {"ok": True, "skipped": False, "item": media_row_to_dict(row)}


@app.post("/api/media/prune")
def media_prune(payload: MediaPrunePayload, user=Depends(current_user)):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="confirm required")
    keep = {str(x).strip().lower() for x in payload.keep_hashes if re.match(r"^[a-f0-9]{64}$", str(x).strip().lower())}
    settings = require_backup_settings()
    client = backup_s3_client(settings)
    deleted = []
    with db() as conn:
        rows = conn.execute("SELECT * FROM user_media WHERE user_id = ?", (user["id"],)).fetchall()
        for row in rows:
            if row["sha256"] in keep:
                continue
            try:
                client.delete_object(Bucket=settings["bucket"], Key=row["object_key"])
            except Exception:
                pass
            conn.execute("DELETE FROM user_media WHERE user_id = ? AND sha256 = ?", (user["id"], row["sha256"]))
            deleted.append(row["sha256"])
    return {"ok": True, "deleted": len(deleted), "hashes": deleted}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("CLOUD_CONFIG_PORT", "8787")))

