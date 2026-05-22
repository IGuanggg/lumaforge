import json
import uuid
import base64
import urllib.parse
import os
import re
import random
import time
import shutil
import asyncio
import logging
import secrets
import zipfile
import sys
import sqlite3
import hashlib
import subprocess
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
from threading import Lock, RLock
import httpx
from PIL import Image
from io import BytesIO
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("lumaforge")
APP_DISPLAY_NAME = os.getenv("APP_DISPLAY_NAME", "光绘工坊").strip() or "光绘工坊"
APP_BRAND_NAME = os.getenv("APP_BRAND_NAME", "LumaForge").strip() or "LumaForge"
APP_REPOSITORY_NAME = os.getenv("APP_REPOSITORY_NAME", "lumaforge").strip() or "lumaforge"
APP_VERSION = os.getenv("APP_VERSION", "2.0.2")
APP_BUILD_ID = os.getenv("APP_BUILD_ID", "20260522-202-goals1")
APP_UPDATE_CHECK_URL = os.getenv("APP_UPDATE_CHECK_URL", "https://api.github.com/repos/IGuanggg/lumaforge/releases/latest").strip()

QUIET_ACCESS_PATHS = {
    "/api/queue_status",
    "/api/canvases",
    "/api/canvases/trash",
}
QUIET_ACCESS_PREFIXES = (
    "/api/canvases/",
)

class QuietAccessLogFilter(logging.Filter):
    def filter(self, record):
        args = record.args if isinstance(record.args, tuple) else ()
        if len(args) >= 3:
            path = str(args[2]).split("?", 1)[0]
            status = int(args[4]) if len(args) >= 5 and str(args[4]).isdigit() else 0
            quiet_dynamic = any(path.startswith(prefix) and path.endswith("/meta") for prefix in QUIET_ACCESS_PREFIXES)
            if (path in QUIET_ACCESS_PATHS or quiet_dynamic) and status < 400:
                return False
        message = record.getMessage()
        if any(f'"GET {path}' in message and '" 200' in message for path in QUIET_ACCESS_PATHS):
            return False
        if 'GET /api/canvases/' in message and '/meta' in message and '" 200' in message:
            return False
        return True

logging.getLogger("uvicorn.access").addFilter(QuietAccessLogFilter())

# --- 本地鉴权：localhost 免认证，远程需 Bearer token ---
AUTH_TOKEN = (
    os.getenv("APP_ACCESS_TOKEN")
    or os.getenv("ACCESS_TOKEN")
    or secrets.token_urlsafe(32)
)
AUTH_COOKIE_NAME = "ic_app_access"
LOCALHOST_IPS = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
PUBLIC_PATHS = {
    "/health",
    "/login.html",
    "/api/local-auth/status",
    "/api/local-auth/login",
}

class LocalAuthRequest(BaseModel):
    identity: str = Field(default="", max_length=120)
    access_code: str = Field(min_length=1, max_length=500)

# --- WebSocket 状态管理器 ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_connections: Dict[str, WebSocket] = {}
        self.connection_clients: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, client_id: str = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_clients[websocket] = client_id or f"anon-{id(websocket)}"
        if client_id:
            self.user_connections[client_id] = websocket
        logger.info("WS Connected. Total: %d, Online: %d", len(self.active_connections), self.online_count())
        await self.broadcast_count()

    async def disconnect(self, websocket: WebSocket, client_id: str = None):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        self.connection_clients.pop(websocket, None)
        if client_id and self.user_connections.get(client_id) is websocket:
            del self.user_connections[client_id]
        logger.info(f"WS Disconnected. Total: {len(self.active_connections)}, Online: {self.online_count()}")
        await self.broadcast_count()

    def online_count(self):
        visible_clients = {
            client_id for client_id in self.connection_clients.values()
            if client_id and not str(client_id).startswith("canvas_")
        }
        return len(visible_clients)

    async def broadcast_count(self):
        count = self.online_count()
        data = json.dumps({"type": "stats", "online_count": count})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.warning(f"Broadcast error: {e}")
                self.active_connections.remove(connection)

    async def broadcast_new_image(self, image_data: dict):
        data = json.dumps({"type": "new_image", "data": image_data})
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.warning(f"Broadcast image error: {e}")
                self.active_connections.remove(connection)

    async def broadcast_canvas_updated(self, canvas_id: str, updated_at: int, client_id: str = ""):
        data = json.dumps({
            "type": "canvas_updated",
            "canvas_id": canvas_id,
            "updated_at": updated_at,
            "client_id": client_id or "",
        })
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.error(f"Broadcast canvas error: {e}")
                self.active_connections.remove(connection)

    async def send_personal_message(self, message: dict, client_id: str):
        ws = self.user_connections.get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Personal message error for {client_id}: {e}")

manager = ConnectionManager()
GLOBAL_HTTP_CLIENT: httpx.AsyncClient = None
CANVAS_TASK_MAX_AGE = 3600  # seconds


async def _cleanup_canvas_tasks():
    while True:
        await asyncio.sleep(300)
        now = time.time()
        with CANVAS_TASK_LOCK:
            expired = [k for k, v in CANVAS_TASKS.items() if now - v.get("created_at", 0) > CANVAS_TASK_MAX_AGE]
            for k in expired:
                del CANVAS_TASKS[k]
        if expired:
            logger.info("Cleaned up %d expired canvas tasks", len(expired))


@asynccontextmanager
async def lifespan(app):
    global GLOBAL_HTTP_CLIENT, CLOUD_MEDIA_PERIODIC_TASK
    GLOBAL_HTTP_CLIENT = httpx.AsyncClient(timeout=httpx.Timeout(connect=20.0, read=120.0, write=60.0, pool=20.0), follow_redirects=True)
    cleanup_task = asyncio.create_task(_cleanup_canvas_tasks())
    CLOUD_MEDIA_PERIODIC_TASK = asyncio.create_task(_cloud_media_periodic_sync())
    schedule_cloud_media_sync()
    logger.info("=" * 50)
    logger.info("  Remote access token: %s", AUTH_TOKEN)
    logger.info("  (localhost access is unrestricted)")
    logger.info("=" * 50)
    yield
    cleanup_task.cancel()
    if CLOUD_MEDIA_PERIODIC_TASK:
        CLOUD_MEDIA_PERIODIC_TASK.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    if CLOUD_MEDIA_PERIODIC_TASK:
        try:
            await CLOUD_MEDIA_PERIODIC_TASK
        except asyncio.CancelledError:
            pass
    for ws in list(manager.active_connections):
        try:
            await ws.close()
        except Exception:
            pass
    await GLOBAL_HTTP_CLIENT.aclose()
    GLOBAL_HTTP_CLIENT = None
    logger.info("Server shutdown complete")


app = FastAPI(lifespan=lifespan)

ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_PATHS:
        return await call_next(request)
    client_host = getattr(request.client, "host", "") or ""
    if client_host in LOCALHOST_IPS:
        return await call_next(request)
    auth = request.headers.get("authorization", "")
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME, "")
    if secrets.compare_digest(auth, f"Bearer {AUTH_TOKEN}") or secrets.compare_digest(cookie_token, AUTH_TOKEN):
        return await call_next(request)
    accepts_html = "text/html" in request.headers.get("accept", "")
    if accepts_html and request.method == "GET":
        next_url = urllib.parse.quote(str(request.url.path) or "/", safe="")
        return RedirectResponse(url=f"/login.html?next={next_url}", status_code=303)
    return JSONResponse(status_code=401, content={"detail": "请先登录主应用。访问码见服务端控制台，或通过 APP_ACCESS_TOKEN 环境变量固定。"})


@app.get("/api/local-auth/status")
async def local_auth_status(request: Request):
    client_host = getattr(request.client, "host", "") or ""
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME, "")
    authenticated = (
        client_host in LOCALHOST_IPS
        or secrets.compare_digest(cookie_token, AUTH_TOKEN)
        or secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {AUTH_TOKEN}")
    )
    return {"authenticated": authenticated, "localhost": client_host in LOCALHOST_IPS}


@app.post("/api/local-auth/login")
async def local_auth_login(payload: LocalAuthRequest):
    if not secrets.compare_digest(payload.access_code, AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="访问码不正确")
    response = JSONResponse({"ok": True, "identity": payload.identity.strip()})
    response.set_cookie(
        AUTH_COOKIE_NAME,
        AUTH_TOKEN,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=30 * 24 * 60 * 60,
        path="/",
    )
    return response


@app.post("/api/local-auth/logout")
async def local_auth_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return response


@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    client_host = getattr(websocket.client, "host", "") or ""
    cookie_token = websocket.cookies.get(AUTH_COOKIE_NAME, "")
    if client_host not in LOCALHOST_IPS and not secrets.compare_digest(cookie_token, AUTH_TOKEN):
        await websocket.close(code=1008)
        return
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        await manager.disconnect(websocket, client_id)
    except Exception as e:
        logger.error(f"WS Error: {e}")
        await manager.disconnect(websocket, client_id)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "online_count": manager.online_count(),
        "comfyui_backends": len(COMFYUI_INSTANCES),
    }


# --- 配置区域 ---

CLIENT_ID = str(uuid.uuid4())
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BUNDLE_DIR = getattr(sys, "_MEIPASS", BASE_DIR)
RUNTIME_DIR = os.path.abspath(os.getenv("APP_RUNTIME_DIR") or os.getenv("INFINITE_CANVAS_HOME") or BASE_DIR)
API_ENV_FILE = os.path.join(RUNTIME_DIR, "API", ".env")

def load_env_file_from_path(path):
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as e:
        logger.error(f"加载 API/.env 失败: {e}")

load_env_file_from_path(API_ENV_FILE)

WORKFLOW_SOURCE_DIR = os.path.join(BUNDLE_DIR, "workflows")
WORKFLOW_DIR = os.path.abspath(os.getenv("APP_WORKFLOW_DIR") or os.path.join(RUNTIME_DIR, "workflows"))
WORKFLOW_PATH = os.path.join(WORKFLOW_DIR, "Z-Image.json")
STATIC_DIR = os.path.join(BUNDLE_DIR, "static")
OUTPUT_DIR = os.path.abspath(os.getenv("APP_OUTPUT_DIR") or os.path.join(RUNTIME_DIR, "output"))
ASSETS_DIR = os.path.abspath(os.getenv("APP_ASSETS_DIR") or os.path.join(RUNTIME_DIR, "assets"))
OUTPUT_INPUT_DIR = os.path.abspath(os.getenv("APP_ASSET_INPUT_DIR") or os.path.join(ASSETS_DIR, "input"))
OUTPUT_OUTPUT_DIR = os.path.abspath(os.getenv("APP_ASSET_OUTPUT_DIR") or os.path.join(ASSETS_DIR, "output"))
ASSET_THUMB_DIR = os.path.abspath(os.getenv("APP_ASSET_THUMBS_DIR") or os.path.join(ASSETS_DIR, "thumbs"))
ASSET_LIBRARY_DIR = os.path.abspath(os.getenv("APP_ASSET_LIBRARY_DIR") or os.path.join(ASSETS_DIR, "library"))
APP_LOG_DIR = os.path.abspath(os.getenv("APP_LOG_DIR") or os.path.join(RUNTIME_DIR, "logs"))
APP_CACHE_DIR = os.path.abspath(os.getenv("APP_CACHE_DIR") or os.path.join(RUNTIME_DIR, "cache"))
UPDATE_DIR = os.path.join(RUNTIME_DIR, "updates")
UPDATE_DOWNLOADS_DIR = os.path.join(UPDATE_DIR, "downloads")
UPDATE_STAGING_DIR = os.path.join(UPDATE_DIR, "staging")
UPDATE_BACKUPS_DIR = os.path.join(UPDATE_DIR, "backups")
HISTORY_FILE = os.path.join(RUNTIME_DIR, "history.json")
DATA_DIR = os.path.join(RUNTIME_DIR, "data")
UPDATE_STATE_FILE = os.path.join(DATA_DIR, "update_state.json")
ASSET_DB_FILE = os.path.join(DATA_DIR, "assets.db")
CONVERSATION_DIR = os.path.join(DATA_DIR, "conversations")
CANVAS_DIR = os.path.join(DATA_DIR, "canvases")
API_PROVIDERS_FILE = os.path.join(DATA_DIR, "api_providers.json")
GLOBAL_CONFIG_FILE = os.path.join(RUNTIME_DIR, "global_config.json")
CLOUD_SESSION_FILE = os.path.join(DATA_DIR, "cloud_session.json")
CLOUD_SYNC_BASE_URL = os.getenv("CLOUD_SYNC_BASE_URL", "https://image-cloud.0909106.xyz").strip().rstrip("/")
CLOUD_AVATAR_MAX_BYTES = 5 * 1024 * 1024
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

QUEUE = []
QUEUE_LOCK = asyncio.Lock()
HISTORY_LOCK = Lock()
ASSET_LOCK = RLock()
GLOBAL_CONFIG_LOCK = Lock()
CONVERSATION_LOCK = Lock()
CANVAS_LOCK = Lock()
LOAD_LOCK = Lock()
CLOUD_MEDIA_SYNC_TASK = None
CLOUD_MEDIA_PERIODIC_TASK = None
CLOUD_MEDIA_LAST_RESULT = {}
CLOUD_CONFIG_SYNC_TASK = None
NEXT_TASK_ID = 1

PROVIDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{2,40}$")

def load_env_file():
    if not os.path.exists(API_ENV_FILE):
        return
    try:
        with open(API_ENV_FILE, 'r', encoding='utf-8-sig') as f:
            for raw_line in f.read().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except Exception as e:
        logger.error(f"加载 API/.env 失败: {e}")

load_env_file()

COMFYUI_INSTANCES = [s.strip() for s in os.getenv("COMFYUI_INSTANCES", "127.0.0.1:8188").split(",") if s.strip()]
COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]

AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
MODELSCOPE_CHAT_BASE_URL = "https://api-inference.modelscope.cn/v1"
MODELSCOPE_DEFAULT_IMAGE_MODELS = [
    "Tongyi-MAI/Z-Image-Turbo",
    "Qwen/Qwen-Image-2512",
    "Qwen/Qwen-Image-Edit-2511",
    "black-forest-labs/FLUX.2-klein-9B",
]
MODELSCOPE_DEFAULT_CHAT_MODELS = [
    "Qwen/Qwen3-235B-A22B",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "MiniMax/MiniMax-M2.7:MiniMax",
]
_MODELSCOPE_CONFIGURED_CHAT_MODELS = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_MODELSCOPE_CONFIGURED_CHAT_MODELS] if m]))
MODELSCOPE_DEFAULT_IMAGE_MODEL = MODELSCOPE_DEFAULT_IMAGE_MODELS[0]
MODELSCOPE_DEFAULT_CHAT_MODEL = "Qwen/Qwen3-235B-A22B"
MODELSCOPE_DEFAULT_LORAS = [
    {
        "id": "Daniel8152/film",
        "name": "Z-Image Film",
        "target_model": "Tongyi-MAI/Z-Image-Turbo",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Qwen-Image-2512-Film",
        "name": "Qwen Image 2512 Film",
        "target_model": "Qwen/Qwen-Image-2512",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
    {
        "id": "Daniel8152/Klein-enhance",
        "name": "Klein enhance",
        "target_model": "black-forest-labs/FLUX.2-klein-9B",
        "strength": 0.8,
        "enabled": True,
        "note": "",
    },
]
MODELSCOPE_DEFAULTS_VERSION = 3
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gpt-image-2")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful assistant.")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "30"))
AI_REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "120"))
IMAGE_POLL_INTERVAL = float(os.getenv("IMAGE_POLL_INTERVAL", "2"))
IMAGE_TASK_TIMEOUT = float(os.getenv("IMAGE_TASK_TIMEOUT", str(AI_REQUEST_TIMEOUT)))
COMFYUI_HISTORY_TIMEOUT = int(float(os.getenv("COMFYUI_HISTORY_TIMEOUT", "1800")))
APIMART_IMAGE_TASK_TIMEOUT = float(os.getenv("APIMART_IMAGE_TASK_TIMEOUT", "1800"))
APIMART_IMAGE_POLL_INTERVAL = float(os.getenv("APIMART_IMAGE_POLL_INTERVAL", "5"))
APIMART_IMAGE_INITIAL_POLL_DELAY = float(os.getenv("APIMART_IMAGE_INITIAL_POLL_DELAY", "10"))
VIDEO_POLL_TIMEOUT = float(os.getenv("VIDEO_POLL_TIMEOUT", "1800"))
ONLINE_IMAGE_PROMPT_MAX_LENGTH = int(os.getenv("ONLINE_IMAGE_PROMPT_MAX_LENGTH", "20000"))
VIDEO_PROMPT_MAX_LENGTH = int(os.getenv("VIDEO_PROMPT_MAX_LENGTH", "4000"))
LLM_MESSAGE_MAX_LENGTH = int(os.getenv("LLM_MESSAGE_MAX_LENGTH", "20000"))
WORKFLOW_NAME_MAX_LENGTH = 200
MODEL_NAME_MAX_LENGTH = 200
PROVIDER_ID_MAX_LENGTH = 40
URL_MAX_LENGTH = 2048
TITLE_MAX_LENGTH = 500
CLIENT_ID_MAX_LENGTH = 100
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))

FIELD_LABELS = {
    "prompt": "提示词",
    "message": "文本",
    "system_prompt": "系统提示词",
}

def friendly_validation_error(errors):
    parts = []
    for err in errors or []:
        loc = [str(item) for item in err.get("loc", []) if item != "body"]
        field = loc[-1] if loc else ""
        label = FIELD_LABELS.get(field, field or "请求参数")
        ctx = err.get("ctx") or {}
        limit = ctx.get("limit_value") or ctx.get("max_length") or ctx.get("min_length")
        err_type = str(err.get("type") or "")
        msg = str(err.get("msg") or "")
        if "max_length" in err_type or "at most" in msg:
            parts.append(f"{label}过长：当前内容超过后端上限 {limit} 个字符。请拆分为多个提示词节点，或先用 LLM 节点压缩后再生成。")
        elif "min_length" in err_type:
            parts.append(f"{label}不能为空。")
        else:
            parts.append(f"{label}格式不正确：{msg}")
    return "\n".join(parts) or "请求参数不正确。"

@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": friendly_validation_error(exc.errors()), "errors": exc.errors()},
    )

def model_list(env_name, primary, defaults):
    configured = os.getenv(env_name, "")
    configured_values = [item.strip() for item in configured.split(",") if item.strip()]
    values = configured_values or [primary, *defaults]
    deduped = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped

def reload_env_globals():
    """保存 API 设置后，将 os.environ 里最新的值同步回模块级全局变量，
    避免保存后需要重启才能生效。"""
    global MODELSCOPE_API_KEY, AI_API_KEY, AI_BASE_URL
    global IMAGE_MODELS, CHAT_MODELS, VIDEO_MODELS, MODELSCOPE_CHAT_MODELS
    MODELSCOPE_API_KEY = os.getenv("MODELSCOPE_API_KEY", "")
    AI_API_KEY = os.getenv("COMFLY_API_KEY", "")
    AI_BASE_URL = os.getenv("COMFLY_BASE_URL", "https://ai.comfly.chat").rstrip("/")
    IMAGE_MODELS = model_list("IMAGE_MODELS", os.getenv("IMAGE_MODEL", IMAGE_MODEL), ["nano-banana-pro"])
    CHAT_MODELS = model_list("CHAT_MODELS", os.getenv("CHAT_MODEL", CHAT_MODEL), ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
    VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
        "veo2", "veo2-fast", "veo2-pro",
        "veo3", "veo3-fast", "veo3-pro",
        "veo3.1", "veo3.1-fast", "veo3.1-pro",
        "sora-2", "sora-2-pro",
        "wan2.6-t2v", "wan2.6-i2v",
        "wan2.5-t2v-preview", "wan2.5-i2v-preview",
        "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
        "doubao-seedance-1-5-pro-251215",
        "doubao-seedance-1-0-pro-250528",
        "doubao-seedance-1-0-lite-t2v-250428",
        "doubao-seedance-1-0-lite-i2v-250428",
    ])
    _configured = [m.strip() for m in os.getenv("MODELSCOPE_CHAT_MODELS", "").split(",") if m.strip()]
    MODELSCOPE_CHAT_MODELS = list(dict.fromkeys([m for m in [*MODELSCOPE_DEFAULT_CHAT_MODELS, *_configured] if m]))

CHAT_MODELS = model_list("CHAT_MODELS", CHAT_MODEL, ["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"])
IMAGE_MODELS = model_list("IMAGE_MODELS", IMAGE_MODEL, ["nano-banana-pro"])
VIDEO_MODELS = model_list("VIDEO_MODELS", "veo3-fast", [
    # —— Veo 系列 ——
    "veo2", "veo2-fast", "veo2-pro",
    "veo3", "veo3-fast", "veo3-pro",
    "veo3.1", "veo3.1-fast", "veo3.1-pro",
    # —— Sora ——
    "sora-2", "sora-2-pro",
    # —— 阿里 通义万相 ——
    "wan2.6-t2v", "wan2.6-i2v",
    "wan2.5-t2v-preview", "wan2.5-i2v-preview",
    "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
    # —— 火山 豆包 Seedance ——
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-lite-i2v-250428",
])

def provider_key_env(provider_id):
    if provider_id == "comfly":
        return "COMFLY_API_KEY"
    if provider_id == "modelscope":
        return "MODELSCOPE_API_KEY"
    return f"API_PROVIDER_{re.sub(r'[^A-Za-z0-9]', '_', provider_id).upper()}_KEY"

def mask_secret(value):
    if not value:
        return ""
    tail = value[-4:] if len(value) > 4 else value
    return f"••••••••{tail}"

def default_api_providers():
    # 只保留 ModelScope 为强制默认平台，其他平台均可自定义增删
    return [
        {
            "id": "modelscope",
            "name": "ModelScope",
            "base_url": MODELSCOPE_CHAT_BASE_URL,
            "enabled": True,
            "primary": False,
            "image_models": MODELSCOPE_DEFAULT_IMAGE_MODELS,
            "chat_models": MODELSCOPE_CHAT_MODELS,
            "video_models": [],
            "ms_loras": MODELSCOPE_DEFAULT_LORAS,
            "ms_defaults_version": MODELSCOPE_DEFAULTS_VERSION,
        },
    ]

def merge_default_api_providers(providers):
    merged = [dict(item) for item in providers]
    # 只强制保留 modelscope（不再强制 comfly）
    ms_default = next((d for d in default_api_providers() if d["id"] == "modelscope"), None)
    if ms_default:
        current = next((item for item in merged if item.get("id") == "modelscope"), None)
        if not current:
            merged.append(ms_default)
        else:
            if not current.get("base_url"):
                current["base_url"] = ms_default["base_url"]
            seeded_version = int(current.get("ms_defaults_version") or 0)
            if seeded_version < MODELSCOPE_DEFAULTS_VERSION:
                image_models = model_list_from_values([*MODELSCOPE_DEFAULT_IMAGE_MODELS, *(current.get("image_models") or [])])
                chat_models = model_list_from_values([*MODELSCOPE_DEFAULT_CHAT_MODELS, *(current.get("chat_models") or [])])
                loras = normalize_ms_loras([*MODELSCOPE_DEFAULT_LORAS, *(current.get("ms_loras") or [])])
                current["image_models"] = image_models
                current["chat_models"] = chat_models
                current["ms_loras"] = loras
                current["ms_defaults_version"] = MODELSCOPE_DEFAULTS_VERSION
    return merged

def model_list_from_values(values):
    deduped = []
    for value in values or []:
        item = str(value or "").strip()
        if item and item not in deduped:
            selected_model(item, item)
            deduped.append(item)
    return deduped

def normalize_ms_loras(values):
    normalized = []
    seen = set()
    for raw in values or []:
        if not isinstance(raw, dict):
            continue
        lora_id = str(raw.get("id") or "").strip()
        if not lora_id:
            continue
        target_model = str(raw.get("target_model") or raw.get("model") or "").strip()
        if not target_model:
            continue
        key = (target_model, lora_id)
        if key in seen:
            continue
        seen.add(key)
        try:
            strength = float(raw.get("strength", raw.get("default_strength", 0.8)))
        except Exception:
            strength = 0.8
        strength = max(0.0, min(2.0, strength))
        name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())[:80]
        normalized.append({
            "id": lora_id[:180],
            "name": name or lora_id,
            "target_model": target_model[:180],
            "strength": strength,
            "enabled": bool(raw.get("enabled", True)),
            "note": str(raw.get("note") or "").strip()[:300],
        })
    return normalized

def normalize_provider(item):
    provider_id = str(item.get("id") or "").strip().lower()
    if not PROVIDER_ID_RE.fullmatch(provider_id):
        raise HTTPException(status_code=400, detail=f"API 平台 ID 不合法：{provider_id or '(empty)'}")
    name = re.sub(r"\s+", " ", str(item.get("name") or provider_id).strip())[:60] or provider_id
    base_url = str(item.get("base_url") or "").strip().rstrip("/")
    if base_url and not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail=f"{name} 的 Base URL 需要以 http:// 或 https:// 开头")
    protocol = str(item.get("protocol") or "openai").strip().lower()
    if protocol not in {"openai", "apimart"}:
        protocol = "openai"
    return {
        "id": provider_id,
        "name": name,
        "base_url": base_url,
        "protocol": protocol,
        "enabled": bool(item.get("enabled", True)),
        "primary": bool(item.get("primary", False)),
        "image_models": model_list_from_values(item.get("image_models") or []),
        "chat_models": model_list_from_values(item.get("chat_models") or []),
        "video_models": model_list_from_values(item.get("video_models") or []),
        "ms_loras": normalize_ms_loras(item.get("ms_loras") or []),
        "ms_defaults_version": int(item.get("ms_defaults_version") or 0),
    }

def load_api_providers():
    defaults = default_api_providers()
    if not os.path.exists(API_PROVIDERS_FILE):
        return defaults
    try:
        with open(API_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        providers = [normalize_provider(item) for item in raw if isinstance(item, dict)]
        return merge_default_api_providers(providers or defaults)
    except Exception as e:
        logger.error(f"加载 API 平台配置失败: {e}")
        return defaults

def save_api_providers(providers):
    os.makedirs(DATA_DIR, exist_ok=True)
    with GLOBAL_CONFIG_LOCK:
        with open(API_PROVIDERS_FILE, "w", encoding="utf-8") as f:
            json.dump(providers, f, ensure_ascii=False, indent=2)

def load_cloud_session():
    if not os.path.exists(CLOUD_SESSION_FILE):
        return {}
    try:
        with open(CLOUD_SESSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception as e:
        logger.warning("加载云同步登录状态失败: %s", e)
    return {}

def save_cloud_session(session):
    os.makedirs(DATA_DIR, exist_ok=True)
    with GLOBAL_CONFIG_LOCK:
        with open(CLOUD_SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump(session or {}, f, ensure_ascii=False, indent=2)

def cloud_auth_header(session):
    token = (session or {}).get("token", "")
    if not token:
        raise HTTPException(status_code=401, detail="尚未登录云端账户")
    return {"Authorization": f"Bearer {token}"}

def cloud_base_url(session):
    base_url = str((session or {}).get("base_url") or CLOUD_SYNC_BASE_URL).strip().rstrip("/")
    if not base_url or not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="云端服务地址未配置，请在后端设置 CLOUD_SYNC_BASE_URL")
    return base_url

async def upload_cloud_config(include_secrets=True):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    config = build_cloud_config(include_secrets=True)
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.put(
                f"{base_url}/api/configs/current",
                headers=cloud_auth_header(session),
                json={"config": config},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "Cloud config upload failed") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot connect to cloud service: {exc}") from exc
    session["updated_at"] = now_ms()
    save_cloud_session(session)
    return {"ok": True, "cloud": data}

async def run_cloud_config_auto_sync(delay: float = 8.0):
    global CLOUD_CONFIG_SYNC_TASK
    try:
        await asyncio.sleep(delay)
        session = load_cloud_session()
        if not session.get("token"):
            return
        await upload_cloud_config(include_secrets=True)
    except HTTPException as exc:
        logger.info("Auto cloud config sync skipped: %s", exc.detail)
    except Exception as exc:
        logger.warning("Auto cloud config sync failed: %s", exc)
    finally:
        CLOUD_CONFIG_SYNC_TASK = None

def schedule_cloud_config_sync():
    global CLOUD_CONFIG_SYNC_TASK
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if CLOUD_CONFIG_SYNC_TASK and not CLOUD_CONFIG_SYNC_TASK.done():
        return
    CLOUD_CONFIG_SYNC_TASK = loop.create_task(run_cloud_config_auto_sync())

def cloud_synced_env_defaults():
    return {
        "COMFYUI_INSTANCES": "127.0.0.1:8188",
        "COMFLY_BASE_URL": "https://ai.comfly.chat",
        "IMAGE_MODELS": ",".join(["gpt-image-2", "nano-banana-pro"]),
        "CHAT_MODELS": ",".join(["gpt-4o-mini", "gemini-3.1-flash-image-preview-2k"]),
        "VIDEO_MODELS": ",".join([
            "veo2", "veo2-fast", "veo2-pro",
            "veo3", "veo3-fast", "veo3-pro",
            "veo3.1", "veo3.1-fast", "veo3.1-pro",
            "sora-2", "sora-2-pro",
            "wan2.6-t2v", "wan2.6-i2v",
            "wan2.5-t2v-preview", "wan2.5-i2v-preview",
            "wan2.2-t2v-plus", "wan2.2-i2v-plus", "wan2.2-i2v-flash",
            "doubao-seedance-2-0-260128",
            "doubao-seedance-2-0-fast-260128",
            "doubao-seedance-1-5-pro-251215",
            "doubao-seedance-1-0-pro-250528",
            "doubao-seedance-1-0-lite-t2v-250428",
            "doubao-seedance-1-0-lite-i2v-250428",
        ]),
        "MODELSCOPE_CHAT_MODELS": ",".join(MODELSCOPE_DEFAULT_CHAT_MODELS),
    }

def cloud_synced_api_key_env_keys(providers=None):
    keys = {"MODELSCOPE_API_KEY", "COMFLY_API_KEY"}
    for provider in providers or []:
        pid = str((provider or {}).get("id") or "").strip()
        if pid:
            keys.add(provider_key_env(pid))
    if os.path.exists(API_ENV_FILE):
        try:
            with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
                for raw_line in f.read().splitlines():
                    if "=" not in raw_line:
                        continue
                    key = raw_line.split("=", 1)[0].strip()
                    if key.startswith("API_PROVIDER_") and key.endswith("_KEY"):
                        keys.add(key)
        except Exception as exc:
            logger.warning("Scan API key env keys failed: %s", exc)
    return keys

def reset_local_cloud_synced_config():
    existing_providers = load_api_providers()
    save_api_providers(default_api_providers())
    env_updates = cloud_synced_env_defaults()
    for key in cloud_synced_api_key_env_keys(existing_providers):
        env_updates[key] = ""
    update_env_values(env_updates)
    reload_env_globals()
    global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
    with LOAD_LOCK:
        COMFYUI_INSTANCES = ["127.0.0.1:8188"]
        COMFYUI_ADDRESS = COMFYUI_INSTANCES[0]
        BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}
    return {
        "providers": [public_provider(p) for p in load_api_providers()],
        "comfyui_instances": COMFYUI_INSTANCES,
    }

def build_cloud_config(include_secrets=False):
    providers = load_api_providers()
    env_values = {
        "COMFYUI_INSTANCES": ",".join(COMFYUI_INSTANCES),
        "COMFLY_BASE_URL": AI_BASE_URL,
        "IMAGE_MODELS": ",".join(IMAGE_MODELS),
        "CHAT_MODELS": ",".join(CHAT_MODELS),
        "VIDEO_MODELS": ",".join(VIDEO_MODELS),
        "MODELSCOPE_CHAT_MODELS": ",".join(MODELSCOPE_CHAT_MODELS),
    }
    config = {
        "version": 2,
        "exported_at": now_ms(),
        "api_providers": providers,
        "env": env_values,
        "canvases": export_cloud_canvases(),
    }
    if include_secrets:
        api_keys = {}
        for provider in providers:
            pid = provider.get("id")
            key = os.getenv(provider_key_env(pid), "") if pid else ""
            if key:
                api_keys[pid] = key
        config["api_keys"] = api_keys
    return config

def apply_cloud_config(config):
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="云端配置格式不正确")
    raw_providers = config.get("api_providers") or []
    providers = [normalize_provider(item) for item in raw_providers if isinstance(item, dict)]
    if providers:
        save_api_providers(merge_default_api_providers(providers))
    env_updates = {}
    raw_env = config.get("env") or {}
    allowed_env_keys = {
        "COMFYUI_INSTANCES",
        "COMFLY_BASE_URL",
        "IMAGE_MODELS",
        "CHAT_MODELS",
        "VIDEO_MODELS",
        "MODELSCOPE_CHAT_MODELS",
    }
    for key in allowed_env_keys:
        if key in raw_env:
            env_updates[key] = str(raw_env.get(key) or "")
    for provider_id, api_key in (config.get("api_keys") or {}).items():
        pid = str(provider_id or "").strip().lower()
        if PROVIDER_ID_RE.fullmatch(pid):
            env_updates[provider_key_env(pid)] = str(api_key or "")
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()
        if "COMFYUI_INSTANCES" in env_updates:
            cleaned = [s.strip() for s in env_updates["COMFYUI_INSTANCES"].split(",") if s.strip()]
            if cleaned:
                global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
                with LOAD_LOCK:
                    COMFYUI_INSTANCES = cleaned
                    COMFYUI_ADDRESS = cleaned[0]
                    BACKEND_LOCAL_LOAD = {addr: BACKEND_LOCAL_LOAD.get(addr, 0) for addr in cleaned}
    canvas_result = import_cloud_canvases(config.get("canvases") or [])
    return {"providers": [public_provider(p) for p in load_api_providers()], "comfyui_instances": COMFYUI_INSTANCES, "canvases": canvas_result}

async def try_apply_cloud_config_from_account(session):
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.get(
                f"{base_url}/api/configs/current",
                headers=cloud_auth_header(session),
            )
        if response.status_code == 404:
            return {"downloaded": False, "missing": True}
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        return {"downloaded": False, "error": detail or "Cloud config download failed"}
    except httpx.HTTPError as exc:
        return {"downloaded": False, "error": f"Cannot connect to cloud service: {exc}"}
    config = data.get("config")
    if not config:
        return {"downloaded": False, "missing": True}
    applied = apply_cloud_config(config)
    return {"downloaded": True, "cloud_updated_at": data.get("updated_at", 0), "applied": applied}

def public_provider(provider):
    key = os.getenv(provider_key_env(provider["id"]), "")
    return {
        **provider,
        "has_key": bool(key),
        "key_preview": mask_secret(key),
    }

def classify_model_id(mid: str) -> str:
    lc = mid.lower()
    video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
    if any(k in lc for k in video_keys):
        return "video"
    image_keys = ["image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein"]
    if any(k in lc for k in image_keys):
        return "image"
    return "chat"

def get_primary_provider_id(providers=None):
    """返回当前首选 provider 的 id；优先 primary=True 的，否则取第一个非 modelscope 的，再次取第一个。"""
    providers = providers if providers is not None else load_api_providers()
    primary = next((p for p in providers if p.get("primary") and p.get("enabled", True)), None)
    if primary:
        return primary["id"]
    non_ms = next((p for p in providers if p["id"] != "modelscope" and p.get("enabled", True)), None)
    if non_ms:
        return non_ms["id"]
    return providers[0]["id"] if providers else "modelscope"

def get_api_provider(provider_id="comfly"):
    providers = load_api_providers()
    target = (provider_id or "").strip().lower()
    # 兼容旧的 "comfly" 硬编码：若 comfly 不存在或未指定，回退到首选 provider
    if not target or not any(p["id"] == target for p in providers):
        target = get_primary_provider_id(providers)
    provider = next((p for p in providers if p["id"] == target), None)
    if not provider:
        raise HTTPException(status_code=400, detail=f"未找到 API 平台：{target}")
    if not provider.get("enabled", True):
        raise HTTPException(status_code=400, detail=f"API 平台已禁用：{provider.get('name') or target}")
    return provider

def env_quote(value):
    text = str(value or "")
    if not text or re.search(r"\s|#|['\"]", text):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text

def update_env_values(updates):
    os.makedirs(os.path.dirname(API_ENV_FILE), exist_ok=True)
    lines = []
    if os.path.exists(API_ENV_FILE):
        with open(API_ENV_FILE, "r", encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    seen = set()
    next_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            next_lines.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in updates:
            next_lines.append(f"{key}={env_quote(updates[key])}")
            os.environ[key] = str(updates[key] or "")
            seen.add(key)
        else:
            next_lines.append(line)
    for key, value in updates.items():
        if key not in seen:
            next_lines.append(f"{key}={env_quote(value)}")
            os.environ[key] = str(value or "")
    with open(API_ENV_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(next_lines).rstrip() + "\n")

BACKEND_LOCAL_LOAD = {addr: 0 for addr in COMFYUI_INSTANCES}

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(OUTPUT_INPUT_DIR, exist_ok=True)
os.makedirs(OUTPUT_OUTPUT_DIR, exist_ok=True)
os.makedirs(ASSET_THUMB_DIR, exist_ok=True)
os.makedirs(ASSET_LIBRARY_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(WORKFLOW_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CONVERSATION_DIR, exist_ok=True)
os.makedirs(CANVAS_DIR, exist_ok=True)

if os.path.abspath(WORKFLOW_SOURCE_DIR) != os.path.abspath(WORKFLOW_DIR) and os.path.isdir(WORKFLOW_SOURCE_DIR):
    for root, _, files in os.walk(WORKFLOW_SOURCE_DIR):
        rel_root = os.path.relpath(root, WORKFLOW_SOURCE_DIR)
        target_root = WORKFLOW_DIR if rel_root == "." else os.path.join(WORKFLOW_DIR, rel_root)
        os.makedirs(target_root, exist_ok=True)
        for filename in files:
            source_path = os.path.join(root, filename)
            target_path = os.path.join(target_root, filename)
            if not os.path.exists(target_path):
                shutil.copy2(source_path, target_path)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# --- Local asset library ---

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}

def asset_db():
    conn = sqlite3.connect(ASSET_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_asset_library():
    with ASSET_LOCK:
        with asset_db() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    type TEXT NOT NULL,
                    category_id TEXT DEFAULT 'inbox',
                    local_url TEXT NOT NULL UNIQUE,
                    local_path TEXT NOT NULL,
                    thumb_url TEXT DEFAULT '',
                    source_url TEXT DEFAULT '',
                    source_type TEXT DEFAULT '',
                    prompt TEXT DEFAULT '',
                    model TEXT DEFAULT '',
                    width INTEGER DEFAULT 0,
                    height INTEGER DEFAULT 0,
                    duration REAL DEFAULT 0,
                    tags TEXT DEFAULT '[]',
                    favorite INTEGER DEFAULT 0,
                    sha256 TEXT DEFAULT '',
                    size_bytes INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_assets_type_created ON assets(type, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_assets_favorite_created ON assets(favorite, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);

                CREATE TABLE IF NOT EXISTS prompt_snippets (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tags TEXT DEFAULT '[]',
                    favorite INTEGER DEFAULT 0,
                    usage_count INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_prompt_snippets_favorite ON prompt_snippets(favorite, updated_at DESC);

                CREATE TABLE IF NOT EXISTS asset_deletions (
                    sha256 TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    local_path TEXT DEFAULT '',
                    cloud_key TEXT DEFAULT '',
                    deleted_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS asset_library_categories (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
            """)
            existing = {row["name"] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
            for column, ddl in {
                "cloud_key": "ALTER TABLE assets ADD COLUMN cloud_key TEXT DEFAULT ''",
                "cloud_url": "ALTER TABLE assets ADD COLUMN cloud_url TEXT DEFAULT ''",
                "cloud_synced_at": "ALTER TABLE assets ADD COLUMN cloud_synced_at REAL DEFAULT 0",
                "cloud_error": "ALTER TABLE assets ADD COLUMN cloud_error TEXT DEFAULT ''",
                "category_id": "ALTER TABLE assets ADD COLUMN category_id TEXT DEFAULT 'inbox'",
            }.items():
                if column not in existing:
                    conn.execute(ddl)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_category_created ON assets(category_id, created_at DESC)")
            ensure_default_asset_library_categories(conn)


DEFAULT_ASSET_LIBRARY_CATEGORIES = (
    {"id": "inbox", "name": "默认", "type": "image"},
    {"id": "characters", "name": "角色", "type": "image"},
    {"id": "scenes", "name": "场景", "type": "image"},
    {"id": "workflows", "name": "工作流", "type": "workflow"},
)


def ensure_default_asset_library_categories(conn):
    now = time.time()
    for category in DEFAULT_ASSET_LIBRARY_CATEGORIES:
        exists = conn.execute(
            "SELECT id FROM asset_library_categories WHERE id = ?",
            (category["id"],),
        ).fetchone()
        if not exists:
            conn.execute(
                """
                INSERT INTO asset_library_categories (id, name, type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    category["id"],
                    category["name"],
                    category["type"],
                    now,
                    now,
                ),
            )
    # 让旧资产默认进“默认”文件夹，避免升级后看不见
    conn.execute(
        "UPDATE assets SET category_id = 'inbox' WHERE COALESCE(category_id, '') = ''"
    )


def asset_library_url_for(filename):
    return f"/assets/library/{filename}"


def sanitize_asset_name(name, fallback="asset"):
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(name or fallback)).strip()
    return name[:120] or fallback


def asset_library_category_row_to_dict(row, items=None):
    data = dict(row)
    data["items"] = items or []
    return data


def asset_library_item_from_asset_row(row):
    if not row:
        return None
    title = (row["title"] or "").strip() or os.path.basename(row["local_path"] or row["local_url"] or "asset")
    return {
        "id": row["id"],
        "name": title,
        "url": row["local_url"] or row["thumb_url"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "type": row["type"],
        "category_id": row["category_id"] or "",
        "favorite": bool(row["favorite"]),
    }


def load_asset_library():
    with ASSET_LOCK:
        with asset_db() as conn:
            ensure_default_asset_library_categories(conn)
            categories = conn.execute(
                "SELECT * FROM asset_library_categories ORDER BY CASE WHEN id = 'inbox' THEN 0 ELSE 1 END, created_at ASC"
            ).fetchall()
            library_categories = []
            for category in categories:
                rows = conn.execute(
                    """
                    SELECT * FROM assets
                    WHERE COALESCE(category_id, '') = ?
                    ORDER BY created_at DESC
                    """,
                    (category["id"],),
                ).fetchall()
                items = [asset_library_item_from_asset_row(row) for row in rows if row]
                library_categories.append(asset_library_category_row_to_dict(category, items))
            return {
                "updated_at": now_ms(),
                "categories": library_categories,
            }

def json_list(value):
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        try:
            data = json.loads(value)
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
        except Exception:
            return [x.strip() for x in value.split(",") if x.strip()]
    return []

def asset_type_for_path(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    return "file"

def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def image_dimensions(path):
    try:
        with Image.open(path) as img:
            return img.size
    except Exception:
        return (0, 0)

def make_asset_thumbnail(asset_id, path):
    if asset_type_for_path(path) != "image":
        return ""
    thumb_name = f"{asset_id}.jpg"
    thumb_path = os.path.join(ASSET_THUMB_DIR, thumb_name)
    try:
        with Image.open(path) as img:
            img.load()
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                rgba = img.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.thumbnail((480, 480), Image.LANCZOS)
            img.save(thumb_path, "JPEG", quality=82, optimize=True)
        return output_url_for(thumb_name, "thumbs")
    except Exception as e:
        logger.warning("Asset thumbnail failed for %s: %s", path, e)
        return ""

def asset_row_to_dict(row):
    data = dict(row)
    data["tags"] = json_list(data.get("tags"))
    data["favorite"] = bool(data.get("favorite"))
    return data

def index_local_asset(local_url, *, source_type="", prompt="", model="", source_url="", tags=None, favorite=False, created_at=None, category_id=""):
    path = output_file_from_url(local_url)
    if not path or not os.path.isfile(path):
        return None
    try:
        digest = file_sha256(path)
        asset_id = uuid.uuid4().hex[:20]
        kind = asset_type_for_path(path)
        width, height = image_dimensions(path) if kind == "image" else (0, 0)
        thumb_url = make_asset_thumbnail(asset_id, path)
        now = time.time()
        created = float(created_at or now)
        title = os.path.basename(path)
        size_bytes = os.path.getsize(path)
        tag_json = json.dumps(json_list(tags), ensure_ascii=False)
        category_value = str(category_id or "inbox").strip() or "inbox"
        with ASSET_LOCK:
            with asset_db() as conn:
                conn.execute(
                    """
                    INSERT INTO assets (
                        id, title, type, category_id, local_url, local_path, thumb_url, source_url, source_type,
                        prompt, model, width, height, tags, favorite, sha256, size_bytes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(local_url) DO UPDATE SET
                        title=excluded.title,
                        type=excluded.type,
                        category_id=COALESCE(NULLIF(excluded.category_id, ''), assets.category_id),
                        local_path=excluded.local_path,
                        thumb_url=COALESCE(NULLIF(excluded.thumb_url, ''), assets.thumb_url),
                        source_url=COALESCE(NULLIF(excluded.source_url, ''), assets.source_url),
                        source_type=COALESCE(NULLIF(excluded.source_type, ''), assets.source_type),
                        prompt=COALESCE(NULLIF(excluded.prompt, ''), assets.prompt),
                        model=COALESCE(NULLIF(excluded.model, ''), assets.model),
                        width=excluded.width,
                        height=excluded.height,
                        tags=CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE assets.tags END,
                        favorite=CASE WHEN excluded.favorite = 1 THEN 1 ELSE assets.favorite END,
                        sha256=excluded.sha256,
                        size_bytes=excluded.size_bytes,
                        updated_at=excluded.updated_at
                    """,
                    (
                        asset_id, title, kind, category_value, local_url, path, thumb_url, source_url, source_type,
                        prompt or "", model or "", width, height, tag_json, 1 if favorite else 0,
                        digest, size_bytes, created, now,
                    ),
                )
                row = conn.execute("SELECT * FROM assets WHERE local_url = ?", (local_url,)).fetchone()
                item = asset_row_to_dict(row) if row else None
                if digest:
                    conn.execute("DELETE FROM asset_deletions WHERE sha256 = ?", (digest,))
        if item:
            schedule_cloud_media_sync()
        return item
    except Exception as e:
        logger.warning("Index asset failed for %s: %s", local_url, e)
        return None

def index_history_record_assets(record):
    if not isinstance(record, dict):
        return []
    urls = []
    for key in ("images", "videos", "outputs"):
        value = record.get(key)
        if isinstance(value, list):
            urls.extend([x for x in value if isinstance(x, str)])
    for key in ("url", "video", "video_url"):
        value = record.get(key)
        if isinstance(value, str):
            urls.append(value)
    indexed = []
    seen = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        item = index_local_asset(
            url,
            source_type=str(record.get("type") or ""),
            prompt=str(record.get("prompt") or ""),
            model=str(record.get("model") or record.get("workflow_json") or ""),
            created_at=record.get("timestamp"),
        )
        if item:
            indexed.append(item)
    return indexed

init_asset_library()

# --- Pydantic 模型 ---

class GenerateRequest(BaseModel):
    prompt: str = Field(default="", max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    width: int = 1024
    height: int = 1024
    workflow_json: str = Field(default="Z-Image.json", max_length=WORKFLOW_NAME_MAX_LENGTH)
    params: Dict[str, Any] = {}
    type: str = Field(default="zimage", max_length=50)
    client_id: str = Field(default="", max_length=CLIENT_ID_MAX_LENGTH)
    convert_to_jpg: bool = False

class DeleteHistoryRequest(BaseModel):
    timestamp: float

class AssetUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    tags: Optional[List[str]] = None
    favorite: Optional[bool] = None

class AssetBulkDeleteRequest(BaseModel):
    ids: List[str] = []
    delete_file: bool = False

class DownloadUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=5000)
    filename: str = Field(default="", max_length=220)

class CanvasAssetsDownloadRequest(BaseModel):
    urls: List[str] = []
    filename: str = Field(default="canvas-assets.zip", max_length=220)

class PromptSnippetRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    tags: List[str] = []
    favorite: bool = False


class AssetLibraryCategoryRequest(BaseModel):
    name: str = Field(default="新文件夹", max_length=120)
    type: str = Field(default="image", max_length=20)


class AssetLibraryAddRequest(BaseModel):
    category_id: str = Field(default="", max_length=80)
    url: str = Field(default="", max_length=5000)
    name: str = Field(default="", max_length=220)


class AssetLibraryRenameRequest(BaseModel):
    name: str = Field(default="", max_length=120)

class TokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=500)

class CloudGenRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    api_key: str = Field(default="", max_length=200)
    model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    resolution: str = Field(default="1024x1024", max_length=20)
    type: str = Field(default="zimage", max_length=50)
    image_urls: List[str] = []
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CloudPollRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=100)
    api_key: str = Field(default="", max_length=200)
    client_id: Optional[str] = None

class AIReference(BaseModel):
    url: str = ""
    name: str = ""
    role: str = ""

class OnlineImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    provider_id: str = Field(default="comfly", max_length=PROVIDER_ID_MAX_LENGTH)
    model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    size: str = "1024x1024"
    quality: str = "auto"
    reference_images: List[AIReference] = []

class AIEnhanceRequest(OnlineImageRequest):
    pass

CANVAS_TASKS: Dict[str, Dict[str, Any]] = {}
CANVAS_TASK_LOCK = Lock()

class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=VIDEO_PROMPT_MAX_LENGTH)
    provider_id: str = Field(default="comfly", max_length=PROVIDER_ID_MAX_LENGTH)
    model: str = Field(default="veo3-fast", max_length=MODEL_NAME_MAX_LENGTH)
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[AIReference] = []
    videos: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False
    return_last_frame: bool = False
    generate_audio: bool = False

class ApiProviderPayload(BaseModel):
    id: str = Field(default="", max_length=PROVIDER_ID_MAX_LENGTH)
    name: str = Field(default="", max_length=TITLE_MAX_LENGTH)
    base_url: str = Field(default="", max_length=URL_MAX_LENGTH)
    protocol: str = Field(default="openai", max_length=20)
    enabled: bool = True
    primary: bool = False
    image_models: List[str] = []
    chat_models: List[str] = []
    video_models: List[str] = []
    ms_loras: List[Dict[str, Any]] = []
    ms_defaults_version: int = 0
    api_key: Optional[str] = None

class CloudAuthRequest(BaseModel):
    base_url: str = Field(default="", max_length=URL_MAX_LENGTH)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=200)

class CloudUploadRequest(BaseModel):
    include_secrets: bool = False

class CloudMediaSyncRequest(BaseModel):
    missing_only: bool = True
    retry_failed: bool = True
    delete_remote_missing: bool = False
    limit: int = Field(default=500, ge=1, le=5000)

class CloudMediaRestoreRequest(BaseModel):
    missing_only: bool = True
    include_deleted: bool = False
    limit: int = Field(default=500, ge=1, le=5000)

class CloudProfileRequest(BaseModel):
    email: str = Field(default="", max_length=200)
    display_name: str = Field(default="", max_length=80)
    avatar_url: str = Field(default="", max_length=URL_MAX_LENGTH)

class CloudPasswordRequest(BaseModel):
    current_password: str = Field(min_length=6, max_length=200)
    new_password: str = Field(min_length=6, max_length=200)

class CloudPasswordForgotRequest(BaseModel):
    base_url: str = Field(default="", max_length=URL_MAX_LENGTH)
    email: str = Field(min_length=3, max_length=200)

class CloudPasswordResetRequest(BaseModel):
    base_url: str = Field(default="", max_length=URL_MAX_LENGTH)
    email: str = Field(min_length=3, max_length=200)
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    new_password: str = Field(min_length=6, max_length=200)

class CloudEmailVerifyConfirmRequest(BaseModel):
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

class AppOpenPathRequest(BaseModel):
    target: str = Field(max_length=40)

class AppPathSelectRequest(BaseModel):
    target: str = Field(max_length=40)

class AppPathUpdateRequest(BaseModel):
    target: str = Field(max_length=40)
    path: str = Field(min_length=1, max_length=1000)

class AppUpdateSettingsRequest(BaseModel):
    update_check_url: str = Field(default="", max_length=1000)

class ChatRequest(BaseModel):
    conversation_id: str = Field(default="", max_length=CLIENT_ID_MAX_LENGTH)
    message: str = Field(min_length=1, max_length=LLM_MESSAGE_MAX_LENGTH)
    model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    image_model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    mode: str = Field(default="chat", max_length=20)
    size: str = "1024x1024"
    quality: str = "auto"
    reference_images: List[AIReference] = []
    provider: str = Field(default="comfly", max_length=PROVIDER_ID_MAX_LENGTH)
    ms_model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)

class MsGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=ONLINE_IMAGE_PROMPT_MAX_LENGTH)
    api_key: str = Field(default="", max_length=200)
    model: str = Field(default="black-forest-labs/FLUX.2-klein-9B", max_length=MODEL_NAME_MAX_LENGTH)
    image_urls: List[str] = []
    width: int = 0
    height: int = 0
    size: str = ""
    loras: Optional[Any] = None
    client_id: Optional[str] = None

class CanvasLLMRequest(BaseModel):
    message: str = Field(min_length=1, max_length=LLM_MESSAGE_MAX_LENGTH)
    system_prompt: str = Field(default="You are a helpful assistant.", max_length=LLM_MESSAGE_MAX_LENGTH)
    model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    messages: List[Dict[str, Any]] = []
    provider: str = Field(default="comfly", max_length=PROVIDER_ID_MAX_LENGTH)
    ms_model: str = Field(default="", max_length=MODEL_NAME_MAX_LENGTH)
    images: List[str] = []   # 可以是 /output/*.png、/assets/*.png 本地路径 或 http(s) URL 或 data URL

class ConversationCreateRequest(BaseModel):
    title: str = Field(default="新对话", max_length=TITLE_MAX_LENGTH)

class CanvasCreateRequest(BaseModel):
    title: str = Field(default="未命名画布", max_length=TITLE_MAX_LENGTH)
    icon: str = "🧩"

    kind: str = Field(default="classic", max_length=20)

class CanvasSaveRequest(BaseModel):
    title: str = Field(default="未命名画布", max_length=TITLE_MAX_LENGTH)
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    viewport: Dict[str, Any] = {}
    logs: List[Dict[str, Any]] = []
    settings: Dict[str, Any] = {}
    client_id: str = Field(default="", max_length=CLIENT_ID_MAX_LENGTH)
    base_updated_at: int = 0

# --- 负载均衡 ---

async def check_images_exist(backend_addr, images):
    if not images:
        return True
    client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=2)
    own_client = GLOBAL_HTTP_CLIENT is None
    try:
        for img in images:
            try:
                url = f"http://{backend_addr}/view?filename={urllib.parse.quote(img)}&type=input"
                r = await client.get(url, timeout=0.5)
                if r.status_code != 200:
                    return False
            except Exception:
                return False
        return True
    finally:
        if own_client:
            await client.aclose()

async def get_best_backend(required_images: List[str] = None):
    best_backend = COMFYUI_INSTANCES[0]
    min_queue_size = float('inf')
    candidates_with_images = []
    candidates_others = []
    backend_stats = {}
    client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=2)
    own_client = GLOBAL_HTTP_CLIENT is None
    try:
        for addr in COMFYUI_INSTANCES:
            try:
                response = await client.get(f"http://{addr}/queue", timeout=1)
                data = response.json()
                remote_load = len(data.get('queue_running', [])) + len(data.get('queue_pending', []))
                with LOAD_LOCK:
                    local_load = BACKEND_LOCAL_LOAD.get(addr, 0)
                effective_load = max(remote_load, local_load)
                has_images = await check_images_exist(addr, required_images)
                backend_stats[addr] = {"load": effective_load, "has_images": has_images}
                if has_images:
                    candidates_with_images.append(addr)
                else:
                    candidates_others.append(addr)
            except Exception as e:
                logger.warning("Backend %s unreachable: %s", addr, e)
                continue

        target_candidates = candidates_with_images if candidates_with_images else candidates_others
        if not target_candidates:
            return candidates_others[0] if candidates_others else COMFYUI_INSTANCES[0]

        for addr in target_candidates:
            load = backend_stats[addr]["load"]
            if load < min_queue_size:
                min_queue_size = load
                best_backend = addr
    finally:
        if own_client:
            await client.aclose()

    return best_backend

# --- 辅助工具 ---

def comfy_output_extension(item):
    filename = str((item or {}).get("filename") or "")
    ext = os.path.splitext(filename)[1].lower()
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov", ".m4v", ".gif"}:
        return ext
    fmt = str((item or {}).get("format") or "").lower()
    if "webm" in fmt:
        return ".webm"
    if "quicktime" in fmt or "mov" in fmt:
        return ".mov"
    if "mp4" in fmt or "h264" in fmt or "video" in fmt:
        return ".mp4"
    return ".png"

def is_video_output_item(item):
    ext = comfy_output_extension(item)
    fmt = str((item or {}).get("format") or "").lower()
    return ext in {".mp4", ".webm", ".mov", ".m4v"} or "video" in fmt

async def download_comfy_output(comfy_address, item, prefix="studio_"):
    ext = comfy_output_extension(item)
    filename = f"{prefix}{uuid.uuid4().hex[:10]}{ext}"
    local_path = output_path_for(filename, "output")
    subfolder = urllib.parse.quote(str(item.get("subfolder") or ""))
    file_type = urllib.parse.quote(str(item.get("type") or "output"))
    comfy_url_path = f"/view?filename={urllib.parse.quote(str(item['filename']))}&subfolder={subfolder}&type={file_type}"
    full_url = f"http://{comfy_address}{comfy_url_path}"
    try:
        client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=60)
        own_client = GLOBAL_HTTP_CLIENT is None
        try:
            response = await client.get(full_url)
            response.raise_for_status()
            with open(local_path, 'wb') as out_file:
                out_file.write(response.content)
        finally:
            if own_client:
                await client.aclose()
        return output_url_for(filename, "output")
    except Exception as e:
        logger.error("下载 ComfyUI 输出失败: %s", e)
        if comfy_url_path.startswith("/view"):
            return comfy_url_path.replace("/view", "/api/view", 1)
        return full_url

def save_to_history(record):
    with HISTORY_LOCK:
        history = []
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except Exception as e:
                logger.error(f"History load error: {e}")
        if "timestamp" not in record:
            record["timestamp"] = time.time()
        history.insert(0, record)
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(history[:5000], f, ensure_ascii=False, indent=4)
    index_history_record_assets(record)

async def get_comfy_history(comfy_address, prompt_id):
    try:
        client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=10)
        own_client = GLOBAL_HTTP_CLIENT is None
        try:
            response = await client.get(f"http://{comfy_address}/history/{prompt_id}")
            return response.json()
        finally:
            if own_client:
                await client.aclose()
    except Exception:
        return {}

def safe_user_id(user_id, request: Request):
    candidate = (user_id or "").strip()
    if not candidate and request.client:
        candidate = f"ip-{request.client.host}"
    if not candidate:
        candidate = "anonymous"
    candidate = re.sub(r"[^a-zA-Z0-9_.-]", "-", candidate)[:80].strip(".-")
    return candidate or "anonymous"

def user_dir(user_id):
    path = os.path.join(CONVERSATION_DIR, user_id)
    os.makedirs(path, exist_ok=True)
    return path

def conversation_path(user_id, conversation_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", conversation_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的对话 ID")
    return os.path.join(user_dir(user_id), f"{cleaned}.json")

def now_ms():
    return int(time.time() * 1000)

def save_conversation(user_id, conversation):
    with CONVERSATION_LOCK:
        path = conversation_path(user_id, conversation["id"])
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(conversation, f, ensure_ascii=False, indent=2)

def new_conversation(user_id, title="新对话"):
    timestamp = now_ms()
    conversation = {
        "id": uuid.uuid4().hex,
        "title": (title or "新对话")[:80],
        "created_at": timestamp,
        "updated_at": timestamp,
        "messages": [],
    }
    save_conversation(user_id, conversation)
    return conversation

def load_conversation(user_id, conversation_id):
    path = conversation_path(user_id, conversation_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="对话不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def list_conversations(user_id):
    records = []
    for filename in os.listdir(user_dir(user_id)):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(user_dir(user_id), filename)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        messages = data.get("messages", [])
        last_message = next((m for m in reversed(messages) if m.get("role") != "system"), None)
        records.append({
            "id": data.get("id"),
            "title": data.get("title", "新对话"),
            "created_at": data.get("created_at", 0),
            "updated_at": data.get("updated_at", 0),
            "last_message": (last_message or {}).get("content", ""),
        })
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)

def canvas_path(canvas_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", canvas_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的画布 ID")
    return os.path.join(CANVAS_DIR, f"{cleaned}.json")

def save_canvas(canvas):
    canvas["updated_at"] = now_ms()
    with CANVAS_LOCK:
        with open(canvas_path(canvas["id"]), 'w', encoding='utf-8') as f:
            json.dump(canvas, f, ensure_ascii=False, indent=2)
    schedule_cloud_config_sync()

def normalize_canvas_kind(kind="classic"):
    return "smart" if str(kind or "").strip().lower() == "smart" else "classic"

def new_canvas(title="未命名画布", icon="layers", kind="classic"):
    timestamp = now_ms()
    canvas_kind = normalize_canvas_kind(kind)
    canvas = {
        "id": uuid.uuid4().hex,
        "title": (title or ("智能画布" if canvas_kind == "smart" else "未命名画布"))[:80],
        "icon": (icon or ("sparkles" if canvas_kind == "smart" else "🧩"))[:32],
        "kind": canvas_kind,
        "created_at": timestamp,
        "updated_at": timestamp,
        "nodes": [],
        "connections": [],
        "viewport": {"x": 0, "y": 0, "scale": 1},
    }
    save_canvas(canvas)
    return canvas

def load_canvas(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        canvas = json.load(f)
    if canvas.get("deleted_at"):
        raise HTTPException(status_code=404, detail="画布已在回收站")
    return canvas

def load_canvas_any(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def canvas_record(data):
    return {
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": normalize_canvas_kind(data.get("kind")),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "deleted_at": data.get("deleted_at", 0),
        "node_count": len(data.get("nodes", [])),
    }

def cleanup_expired_canvas_trash():
    cutoff = now_ms() - CANVAS_TRASH_RETENTION_MS
    with CANVAS_LOCK:
        for filename in os.listdir(CANVAS_DIR):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(CANVAS_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                deleted_at = int(data.get("deleted_at") or 0)
                if deleted_at and deleted_at < cutoff:
                    os.remove(path)
            except Exception:
                continue

def iter_canvas_records(include_deleted=False):
    cleanup_expired_canvas_trash()
    records = []
    for filename in os.listdir(CANVAS_DIR):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(CANVAS_DIR, filename), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        is_deleted = bool(data.get("deleted_at"))
        if include_deleted != is_deleted:
            continue
        records.append(canvas_record(data))
    return records

def list_canvases():
    records = iter_canvas_records(include_deleted=False)
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)

def list_deleted_canvases():
    records = iter_canvas_records(include_deleted=True)
    return sorted(records, key=lambda item: item["deleted_at"], reverse=True)

def export_cloud_canvases(limit=200):
    cleanup_expired_canvas_trash()
    docs = []
    with CANVAS_LOCK:
        for filename in os.listdir(CANVAS_DIR):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(CANVAS_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception:
                continue
            cid = str(data.get("id") or "").strip()
            if not re.fullmatch(r"[a-zA-Z0-9_-]{8,80}", cid):
                continue
            docs.append(data)
    docs.sort(key=lambda item: int(item.get("updated_at") or item.get("created_at") or 0), reverse=True)
    return docs[:max(1, min(int(limit or 200), 500))]

def import_cloud_canvases(items):
    if not isinstance(items, list):
        return {"imported": 0, "skipped": 0}
    imported = 0
    skipped = 0
    with CANVAS_LOCK:
        for raw in items[:500]:
            if not isinstance(raw, dict):
                skipped += 1
                continue
            cid = str(raw.get("id") or "").strip()
            if not re.fullmatch(r"[a-zA-Z0-9_-]{8,80}", cid):
                skipped += 1
                continue
            data = dict(raw)
            data["id"] = cid
            data["title"] = str(data.get("title") or "未命名画布")[:80]
            data["icon"] = str(data.get("icon") or "layers")[:16]
            data["nodes"] = data.get("nodes") if isinstance(data.get("nodes"), list) else []
            data["connections"] = data.get("connections") if isinstance(data.get("connections"), list) else []
            data["viewport"] = data.get("viewport") if isinstance(data.get("viewport"), dict) else {"x": 0, "y": 0, "scale": 1}
            data["created_at"] = int(data.get("created_at") or data.get("updated_at") or now_ms())
            data["updated_at"] = int(data.get("updated_at") or data["created_at"])
            path = canvas_path(cid)
            local_updated = 0
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        local_updated = int((json.load(f) or {}).get("updated_at") or 0)
                except Exception:
                    local_updated = 0
            if local_updated and local_updated > int(data.get("updated_at") or 0):
                skipped += 1
                continue
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            imported += 1
    return {"imported": imported, "skipped": skipped}

def display_title(text):
    title = re.sub(r"\s+", " ", text or "").strip()
    return title[:24] or "新对话"

def resolve_chat_provider(provider: str, model: str, ms_model: str):
    if provider == "modelscope":
        if not MODELSCOPE_API_KEY:
            raise HTTPException(status_code=400, detail="未配置 MODELSCOPE_API_KEY，请在 API/.env 中填写。")
        base = MODELSCOPE_CHAT_BASE_URL
        hdrs = {"Authorization": f"Bearer {MODELSCOPE_API_KEY}", "Content-Type": "application/json"}
        mdl = selected_model(ms_model or model, MODELSCOPE_CHAT_MODELS[0] if MODELSCOPE_CHAT_MODELS else "MiniMax/MiniMax-M2.7")
        return base, hdrs, mdl
    api_provider = get_api_provider(provider or "")
    base_root = (api_provider.get("base_url") or AI_BASE_URL).rstrip("/")
    if not base_root:
        raise HTTPException(status_code=400, detail=f"{api_provider.get('name') or api_provider['id']} 未配置 Base URL")
    base = base_root if base_root.endswith("/v1") else base_root + "/v1"
    hdrs = api_headers(provider=api_provider)
    default_model = (api_provider.get("chat_models") or [CHAT_MODEL])[0]
    mdl = selected_model(model, default_model)
    return base, hdrs, mdl

def api_headers(json_body=True, provider=None):
    if provider:
        key_env = provider_key_env(provider["id"])
        api_key = os.getenv(key_env, "")
        provider_name = provider.get("name") or provider["id"]
        if not api_key:
            raise HTTPException(status_code=400, detail=f"未配置 {provider_name} 的 API Key，请在 API 平台管理中填写。")
    else:
        api_key = AI_API_KEY
        if not api_key:
            raise HTTPException(status_code=400, detail="未配置 COMFLY_API_KEY，请在 API/.env 中填写。")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {api_key}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers

def selected_model(requested, fallback):
    model = (requested or fallback).strip()
    if not model:
        raise HTTPException(status_code=400, detail="模型名称不能为空")
    if len(model) > 120 or not re.fullmatch(r"[a-zA-Z0-9_.:/+-]+", model):
        raise HTTPException(status_code=400, detail=f"模型名称不合法：{model}")
    return model

def modelscope_size(value, fallback="1024x1024"):
    size = str(value or fallback).strip().lower().replace("*", "x")
    if re.fullmatch(r"\d{2,5}x\d{2,5}", size):
        return size
    raise HTTPException(status_code=400, detail=f"ModelScope size 格式不正确：{value or fallback}，应为 WxH，例如 1024x1024")

def unwrap_apimart_response(raw):
    """APIMart 将标准 OpenAI 响应包在 {"code":200,"data":{...}} 里；如果检测到就解包。"""
    if isinstance(raw, dict) and "data" in raw and isinstance(raw.get("data"), dict) and "choices" not in raw:
        return raw["data"]
    return raw

def text_from_chat_response(data):
    data = unwrap_apimart_response(data)
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "\n".join(part for part in parts if part)
    return str(content)

def text_delta_from_chat_chunk(data):
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("content") or "")
        return "".join(parts)
    return str(content) if content else ""

def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

def _looks_like_image_url(value):
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not text:
        return False
    if text.startswith(("http://", "https://", "/output/", "/assets/", "data:image/")):
        return True
    clean = urllib.parse.urlparse(text).path.lower()
    return os.path.splitext(clean)[1] in IMAGE_EXTENSIONS

def _extract_image_candidate(value, depth=0):
    if depth > 8 or value is None:
        return None
    if isinstance(value, str):
        if value.startswith("data:image/") and ";base64," in value:
            return {"type": "b64", "value": value.split(";base64,", 1)[1]}
        return {"type": "url", "value": value} if _looks_like_image_url(value) else None
    if isinstance(value, list):
        for item in value:
            found = _extract_image_candidate(item, depth + 1)
            if found:
                return found
        return None
    if not isinstance(value, dict):
        return None
    for key in ("b64_json", "base64", "image_base64"):
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            return {"type": "b64", "value": item}
    for key in ("url", "image_url", "imageUrl", "output_url", "outputUrl", "file_url", "fileUrl"):
        found = _extract_image_candidate(value.get(key), depth + 1)
        if found:
            return found
    for key in ("images", "image", "output_images", "outputs", "output", "data", "result", "results"):
        found = _extract_image_candidate(value.get(key), depth + 1)
        if found:
            return found
    return None

def extract_image(data):
    found = _extract_image_candidate(data)
    if found:
        return found
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="生图接口已返回，但没有识别到图片 URL 或 base64 数据")
    if isinstance(data.get("data"), dict) and isinstance(data["data"].get("result"), dict):
        data = data["data"]
    if isinstance(data.get("result"), dict):
        result_images = data["result"].get("images") or []
        if result_images:
            first = result_images[0]
            url = first.get("url")
            if isinstance(url, list) and url:
                return {"type": "url", "value": url[0]}
            if isinstance(url, str) and url:
                return {"type": "url", "value": url}
    if isinstance(data.get("data"), dict) and isinstance(data["data"].get("data"), dict):
        data = data["data"]["data"]
    images = data.get("data") or []
    if not images:
        raise HTTPException(status_code=502, detail="生图接口没有返回图片数据")
    first = images[0]
    if first.get("url"):
        return {"type": "url", "value": first["url"]}
    if first.get("b64_json"):
        return {"type": "b64", "value": first["b64_json"]}
    raise HTTPException(status_code=502, detail="无法识别生图接口返回格式")

def extract_task_id(data):
    if not isinstance(data, dict):
        return None
    for key in ("task_id", "taskId", "task", "job_id", "jobId", "generation_id", "generationId"):
        if data.get(key):
            return str(data[key])
    if data.get("task_id"):
        return str(data["task_id"])
    status = str(data.get("status") or data.get("task_status") or data.get("state") or "").lower()
    id_value = str(data.get("id") or "").strip()
    if id_value and (id_value.lower().startswith(("task", "job", "generation")) or status in {"queued", "pending", "running", "processing", "submitted", "in_progress"}):
        return str(data["id"])
    nested = data.get("data")
    if isinstance(nested, list) and nested:
        first = nested[0]
        if isinstance(first, dict):
            return extract_task_id(first)
    if isinstance(nested, dict):
        return extract_task_id(nested)
    return None

def provider_protocol(provider):
    return str((provider or {}).get("protocol") or "openai").strip().lower()

def is_apimart_provider(provider):
    base_url = str((provider or {}).get("base_url") or "").lower()
    return provider_protocol(provider) == "apimart" or "apimart.ai" in base_url

async def wait_for_image_task(client, task_id, provider=None):
    base_url = (provider.get("base_url") if provider else AI_BASE_URL).rstrip("/")
    is_apimart = is_apimart_provider(provider)
    if is_apimart:
        task_url = f"{base_url}/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/tasks/{task_id}"
    else:
        task_url = f"{base_url}/images/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/images/tasks/{task_id}"
    timeout = APIMART_IMAGE_TASK_TIMEOUT if is_apimart else IMAGE_TASK_TIMEOUT
    interval = APIMART_IMAGE_POLL_INTERVAL if is_apimart else IMAGE_POLL_INTERVAL
    initial_delay = APIMART_IMAGE_INITIAL_POLL_DELAY if is_apimart else 0
    deadline = time.monotonic() + timeout
    last_payload = {}
    while time.monotonic() < deadline:
        if initial_delay:
            await asyncio.sleep(min(initial_delay, max(0.0, deadline - time.monotonic())))
            initial_delay = 0
            if time.monotonic() >= deadline:
                break
        response = await client.get(task_url, headers=api_headers(provider=provider))
        response.raise_for_status()
        last_payload = response.json()
        task_data = last_payload.get("data") if isinstance(last_payload.get("data"), dict) else last_payload
        status = str(task_data.get("status", "")).upper()
        if status in {"SUCCESS", "SUCCEEDED", "COMPLETED", "DONE", "FINISHED"}:
            return last_payload
        if status in {"FAILURE", "FAILED", "ERROR"}:
            error = task_data.get("error") if isinstance(task_data.get("error"), dict) else {}
            reason = task_data.get("fail_reason") or error.get("message") or last_payload.get("message") or "生图任务失败"
            raise HTTPException(status_code=502, detail=f"生图任务失败：{reason}")
        await asyncio.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    raise HTTPException(status_code=504, detail=f"生图任务超时（已等待 {int(timeout)} 秒），task_id={task_id}")

def output_storage(category="output"):
    if category == "input":
        return (OUTPUT_INPUT_DIR, "input")
    if category == "thumbs":
        return (ASSET_THUMB_DIR, "thumbs")
    return (OUTPUT_OUTPUT_DIR, "output")

def output_url_for(filename, category="output"):
    _, subdir = output_storage(category)
    return f"/assets/{subdir}/{filename}"

def output_path_for(filename, category="output"):
    folder, _ = output_storage(category)
    return os.path.join(folder, filename)

def output_file_from_url(url):
    if isinstance(url, dict):
        url = url.get("url", "")
    if not url:
        return None
    if isinstance(url, str) and url.lower().startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(url)
        url = parsed.path or ""
    if not (url.startswith("/output/") or url.startswith("/assets/")):
        return None
    clean = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/assets/"):
        root = ASSETS_DIR
        rel = clean[len("/assets/"):]
    else:
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    rel = rel.lstrip("/")
    if not rel:
        return None
    path = os.path.abspath(os.path.join(root, rel))
    output_root = os.path.abspath(root)
    if os.path.commonpath([output_root, path]) != output_root or not os.path.exists(path):
        return None
    return path

def content_type_for_path(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in [".mp4", ".m4v"]:
        return "video/mp4"
    if ext == ".webm":
        return "video/webm"
    if ext == ".mov":
        return "video/quicktime"
    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"
    if ext == ".webp":
        return "image/webp"
    return "image/png"

def safe_download_filename(name: str, fallback: str = "download"):
    raw = urllib.parse.unquote(str(name or "").strip()) or fallback
    raw = os.path.basename(raw.replace("\\", "/")).strip(" .")
    raw = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", raw)
    return (raw[:180].strip(" .") or fallback)

def filename_from_url(url: str, fallback: str = "download"):
    try:
        parsed = urllib.parse.urlparse(str(url or ""))
        name = os.path.basename(urllib.parse.unquote(parsed.path or ""))
        return safe_download_filename(name, fallback)
    except Exception:
        return fallback

def content_type_for_filename(name: str):
    return content_type_for_path(name or "")

async def bytes_from_download_url(url: str):
    value = str(url or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="下载地址为空")
    local_path = output_file_from_url(value)
    if local_path:
        with open(local_path, "rb") as fh:
            return os.path.basename(local_path), fh.read(), content_type_for_path(local_path)
    if value.startswith("data:"):
        try:
            header, payload = value.split(",", 1)
            content_type = header.split(";", 1)[0].replace("data:", "") or "application/octet-stream"
            raw = base64.b64decode(payload) if ";base64" in header.lower() else urllib.parse.unquote_to_bytes(payload)
            return "image.png", raw, content_type
        except Exception as exc:
            raise HTTPException(status_code=400, detail="data URL 无法解析") from exc
    if value.lower().startswith(("http://", "https://")):
        try:
            timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                response = await client.get(value)
                response.raise_for_status()
                content_type = response.headers.get("content-type", "application/octet-stream").split(";")[0].strip() or "application/octet-stream"
                return filename_from_url(str(response.url), "download"), response.content, content_type
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail="远程文件下载失败") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"远程文件下载失败：{exc}") from exc
    raise HTTPException(status_code=400, detail="只支持本地 /assets、/output、data URL 或 http(s) 地址")

def convert_output_to_jpg(url, quality=88):
    path = output_file_from_url(url)
    if not path:
        return url
    root, ext = os.path.splitext(path)
    if ext.lower() in [".jpg", ".jpeg"]:
        return url
    jpg_path = f"{root}.jpg"
    try:
        with Image.open(path) as img:
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
                img = bg
            else:
                img = img.convert("RGB")
            img.save(jpg_path, "JPEG", quality=quality, optimize=True)
        try:
            root = ASSETS_DIR if os.path.commonpath([os.path.abspath(ASSETS_DIR), os.path.abspath(jpg_path)]) == os.path.abspath(ASSETS_DIR) else OUTPUT_DIR
        except ValueError:
            root = OUTPUT_DIR
        rel = os.path.relpath(jpg_path, root).replace("\\", "/")
        prefix = "/assets" if root == ASSETS_DIR else "/output"
        return f"{prefix}/{rel}"
    except Exception as e:
        logger.error(f"转换 JPG 失败: {e}")
        return url

def reference_to_data_url(ref, max_size=None):
    """把本地输出文件转为 data URL（base64）。max_size 限制最长边像素，避免 payload 过大。"""
    path = output_file_from_url(ref.get("url", ""))
    if not path:
        return ref.get("url", "")
    if max_size:
        try:
            with Image.open(path) as img:
                img.load()
                w, h = img.size
                if max(w, h) > max_size:
                    img.thumbnail((max_size, max_size), Image.LANCZOS)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGB")
                buf = BytesIO()
                fmt = "PNG" if img.mode == "RGBA" else "JPEG"
                img.save(buf, format=fmt, quality=88 if fmt == "JPEG" else None)
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png" if fmt == "PNG" else "image/jpeg"
                return f"data:{mime};base64,{encoded}"
        except Exception as e:
            logger.error(f"reference resize failed, fallback to raw: {e}")
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    return f"data:{content_type_for_path(path)};base64,{encoded}"

def compress_data_url_image(value, max_size=1536, jpeg_quality=88):
    if not isinstance(value, str) or not value.startswith("data:image/") or ";base64," not in value:
        return value
    header, encoded = value.split(";base64,", 1)
    try:
        raw = base64.b64decode(encoded)
        with Image.open(BytesIO(raw)) as img:
            img.load()
            if max_size and max(img.size) > max_size:
                img.thumbnail((max_size, max_size), Image.LANCZOS)
            has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
            if has_alpha:
                if img.mode != "RGBA":
                    img = img.convert("RGBA")
                fmt, mime = "PNG", "image/png"
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                fmt, mime = "JPEG", "image/jpeg"
            buf = BytesIO()
            if fmt == "JPEG":
                img.save(buf, format=fmt, quality=jpeg_quality, optimize=True)
            else:
                img.save(buf, format=fmt, optimize=True)
            return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"
    except Exception as e:
        logger.error(f"data url image compress failed, fallback to raw: {e}")
        return value

def modelscope_image_url(value, max_size=1536):
    if not value:
        return value
    if isinstance(value, str) and (value.startswith("/output/") or value.startswith("/assets/")):
        return reference_to_data_url({"url": value}, max_size=max_size)
    if isinstance(value, str) and value.startswith("data:image/"):
        return compress_data_url_image(value, max_size=max_size)
    return value

def valid_video_image_input(value: str) -> bool:
    if not isinstance(value, str):
        return False
    value = value.strip()
    return (
        value.startswith("http://") or
        value.startswith("https://") or
        value.startswith("asset://") or
        (value.startswith("data:image/") and ";base64," in value)
    )

def valid_apimart_video_image_input(value: str) -> bool:
    if not isinstance(value, str):
        return False
    value = value.strip()
    return value.startswith("http://") or value.startswith("https://") or value.startswith("asset://")

def is_apimart_veo31_model(model: str) -> bool:
    return str(model or "").strip().lower().startswith("veo3.1")

def apimart_veo31_model(model: str) -> str:
    value = str(model or "").strip().lower()
    aliases = {
        "veo3.1": "veo3.1-fast",
        "veo3.1-pro": "veo3.1-quality",
        "veo3.1-preview": "veo3.1-fast",
    }
    value = aliases.get(value, value or "veo3.1-fast")
    allowed = {"veo3.1-fast", "veo3.1-quality", "veo3.1-lite"}
    return value if value in allowed else "veo3.1-fast"

def apimart_veo31_aspect(aspect: str) -> str:
    value = str(aspect or "16:9").strip()
    return value if value in {"16:9", "9:16"} else "16:9"

def apimart_veo31_resolution(resolution: str) -> str:
    value = str(resolution or "").strip().lower()
    aliases = {"": "720p", "auto": "720p", "480p": "720p", "780p": "720p", "1080": "1080p", "4k": "4k"}
    value = aliases.get(value, value)
    return value if value in {"720p", "1080p", "4k"} else "720p"

def apimart_upload_file_payload(path: str):
    max_bytes = 9_500_000
    size = os.path.getsize(path)
    if size <= max_bytes:
        with open(path, "rb") as fh:
            return os.path.basename(path), fh.read(), content_type_for_path(path)
    with Image.open(path) as img:
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        quality = 92
        while quality >= 62:
            buf = BytesIO()
            bg.save(buf, format="JPEG", quality=quality, optimize=True)
            data = buf.getvalue()
            if len(data) <= max_bytes:
                name = os.path.splitext(os.path.basename(path))[0] + ".jpg"
                return name, data, "image/jpeg"
            quality -= 8
    raise ValueError("image is over 10MB after compression")

def invalid_video_image_preview(value: str) -> str:
    text = str(value or "")
    if text.startswith("data:"):
        return text.split(";base64,", 1)[0] + ";base64,..."
    return text[:120]

def extract_apimart_asset_url(payload):
    if isinstance(payload, list):
        for item in payload:
            found = extract_apimart_asset_url(item)
            if found:
                return found
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("url", "asset_url", "assetUrl", "uri", "file_url", "fileUrl"):
        value = str(payload.get(key) or "").strip()
        if valid_apimart_video_image_input(value):
            return value
    for key in ("asset_id", "assetId", "file_id", "fileId", "id"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value if value.startswith("asset://") else f"asset://{value}"
    for key in ("data", "file", "asset", "result"):
        found = extract_apimart_asset_url(payload.get(key))
        if found:
            return found
    return ""

async def upload_image_for_apimart(client, provider, ref_url: str) -> str:
    ref_url = str(ref_url or "").strip()
    if not ref_url:
        return ref_url
    if ref_url.startswith("http://") or ref_url.startswith("https://") or ref_url.startswith("asset://"):
        return ref_url
    if ref_url.startswith("data:"):
        return ""
    path = output_file_from_url(ref_url)
    if not path:
        return ""
    try:
        base_url = video_api_root(provider)
        upload_url = f"{base_url}/v1/uploads/images"
        filename, content, ct = apimart_upload_file_payload(path)
        files = {"file": (filename, content, ct)}
        resp = await client.post(upload_url, headers=api_headers(json_body=False, provider=provider), files=files, timeout=60)
        if resp.status_code in (200, 201):
            rj = resp.json()
            url = extract_apimart_asset_url(rj)
            if valid_apimart_video_image_input(url):
                return url
            logger.error("APIMart upload response has no usable asset/url: %s", str(rj)[:300])
        logger.error("APIMart upload failed (%s): %s", resp.status_code, resp.text[:300])
    except Exception as e:
        logger.error("APIMart upload exception: %s", e)
    return ""

async def save_ai_image_to_output(image_data, prefix="online_", category="output"):
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.png"
    path = output_path_for(filename, category)
    if image_data["type"] == "b64":
        with open(path, "wb") as f:
            f.write(base64.b64decode(image_data["value"]))
        return output_url_for(filename, category)
    value = image_data["value"]
    if value.startswith("/output/") or value.startswith("/assets/"):
        return value
    try:
        timeout = httpx.Timeout(connect=20.0, read=300.0, write=60.0, pool=20.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(value)
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "")
            if "jpeg" in content_type or "jpg" in content_type:
                filename = filename[:-4] + ".jpg"
                path = output_path_for(filename, category)
            elif "webp" in content_type:
                filename = filename[:-4] + ".webp"
                path = output_path_for(filename, category)
            with open(path, "wb") as f:
                f.write(response.content)
            return output_url_for(filename, category)
    except Exception as e:
        logger.error(f"保存上游图片失败: {e}")
        return value

async def save_remote_video_to_output(url, prefix="video_", category="output"):
    if not url:
        return ""
    if url.startswith("/output/") or url.startswith("/assets/"):
        return url
    filename = f"{prefix}{uuid.uuid4().hex[:10]}.mp4"
    path = output_path_for(filename, category)
    try:
        async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
            response = await client.get(url)
            response.raise_for_status()
            content_type = (response.headers.get("Content-Type") or "").lower()
            clean_path = urllib.parse.urlparse(url).path
            ext = os.path.splitext(clean_path)[1].lower()
            if ext in {".mp4", ".webm", ".mov"}:
                filename = filename[:-4] + ext
                path = output_path_for(filename, category)
            elif "webm" in content_type:
                filename = filename[:-4] + ".webm"
                path = output_path_for(filename, category)
            elif "quicktime" in content_type or "mov" in content_type:
                filename = filename[:-4] + ".mov"
                path = output_path_for(filename, category)
            with open(path, "wb") as f:
                f.write(response.content)
            return output_url_for(filename, category)
    except Exception as e:
        logger.error(f"保存上游视频失败: {e}")
        return url

def parse_size_pair(size):
    match = re.fullmatch(r"\s*(\d+)\s*[xX*]\s*(\d+)\s*", str(size or ""))
    if not match:
        return 0, 0
    return int(match.group(1)), int(match.group(2))

GPT_IMAGE2_MAX_EDGE = 3840
GPT_IMAGE2_MAX_PIXELS = 8_294_400
GPT_IMAGE2_MIN_PIXELS = 655_360

def is_gpt_image_2_model(model):
    return str(model or "").strip().lower().startswith("gpt-image-2")

def normalize_gpt_image_2_size(size):
    width, height = parse_size_pair(size)
    if not width or not height:
        return size or "auto"
    if width == height and (width > 2048 or width * height > 4_194_304):
        return "3840x2160"
    ratio = width / height
    if ratio > 3:
        width = height * 3
    elif ratio < 1 / 3:
        height = width * 3
    scale = min(
        1.0,
        GPT_IMAGE2_MAX_EDGE / max(width, height),
        (GPT_IMAGE2_MAX_PIXELS / max(1, width * height)) ** 0.5,
    )
    width = max(16, int((width * scale) // 16) * 16)
    height = max(16, int((height * scale) // 16) * 16)
    if width * height < GPT_IMAGE2_MIN_PIXELS:
        grow = (GPT_IMAGE2_MIN_PIXELS / max(1, width * height)) ** 0.5
        width = int((width * grow + 15) // 16) * 16
        height = int((height * grow + 15) // 16) * 16
    return f"{width}x{height}"

def apimart_size_resolution(size):
    width, height = parse_size_pair(size)
    if not width or not height:
        raw = str(size or "").strip().lower()
        if raw in {"1k", "2k", "4k"}:
            return "1:1", raw
        if re.fullmatch(r"(auto|\d+\s*:\s*\d+)", raw):
            return raw.replace(" ", ""), "1k"
        return "1:1", "1k"
    long_edge = max(width, height)
    pixels = width * height
    if long_edge >= 3000 or pixels > 4_500_000:
        resolution = "4k"
    elif long_edge >= 1800 or pixels > 1_800_000:
        resolution = "2k"
    else:
        resolution = "1k"
    common = [
        (1, 1, "1:1"), (3, 2, "3:2"), (2, 3, "2:3"), (4, 3, "4:3"), (3, 4, "3:4"),
        (5, 4, "5:4"), (4, 5, "4:5"), (16, 9, "16:9"), (9, 16, "9:16"),
        (2, 1, "2:1"), (1, 2, "1:2"), (3, 1, "3:1"), (1, 3, "1:3"),
        (21, 9, "21:9"), (9, 21, "9:21"),
    ]
    ratio = width / height
    best = min(common, key=lambda item: abs(ratio - item[0] / item[1]))
    return best[2], resolution

async def generate_modelscope_provider_image(prompt, size, model, reference_images=None, provider=None):
    clean_token = MODELSCOPE_API_KEY.strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写。")
    width, height = parse_size_pair(size)
    refs = []
    for ref in (reference_images or [])[:4]:
        if not ref.get("url"):
            continue
        # 把参考图压缩为 data URL，避免 base64 payload 过大导致 MS 内部任务失败
        refs.append(modelscope_image_url(ref.get("url", ""), max_size=1536))
    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true",
    }
    payload = {
        "model": selected_model(model, "Tongyi-MAI/Z-Image-Turbo"),
        "prompt": prompt.strip(),
    }
    if width and height:
        payload["width"] = width
        payload["height"] = height
        payload["size"] = f"{width}x{height}"
    if refs:
        payload["image_url"] = refs

    base_root = ((provider or {}).get("base_url") or MODELSCOPE_CHAT_BASE_URL).rstrip("/")
    api_root = base_root if base_root.endswith("/v1") else f"{base_root}/v1"
    async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
        submit_res = await client.post(f"{api_root}/images/generations", headers=headers, json=payload)
        submit_res.raise_for_status()
        raw = submit_res.json()
        task_id = raw.get("task_id")
        if not task_id:
            try:
                return extract_image(raw), raw
            except HTTPException:
                raise HTTPException(status_code=502, detail=f"ModelScope 未返回 task_id：{raw}")

        deadline = time.monotonic() + AI_REQUEST_TIMEOUT
        last_payload = raw
        while time.monotonic() < deadline:
            await asyncio.sleep(IMAGE_POLL_INTERVAL)
            result = await client.get(
                f"{api_root}/tasks/{task_id}",
                headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
            )
            result.raise_for_status()
            data = result.json()
            last_payload = data
            status = str(data.get("task_status") or "").upper()
            if status == "SUCCEED":
                images = data.get("output_images") or []
                if not images:
                    raise HTTPException(status_code=502, detail=f"ModelScope 成功但没有返回图片：{data}")
                return {"type": "url", "value": images[0]}, data
            if status in {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}:
                detail = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                raise HTTPException(status_code=502, detail=f"ModelScope 任务失败：{detail}")
        raise HTTPException(status_code=504, detail=f"ModelScope 生图任务超时：{last_payload}")

async def generate_ai_image(prompt, size, quality, model, reference_images=None, provider_id="comfly"):
    provider = get_api_provider(provider_id)
    if provider["id"] == "modelscope":
        return await generate_modelscope_provider_image(prompt, size, model, reference_images, provider)
    is_gpt2 = is_gpt_image_2_model(model)
    is_apimart = is_apimart_provider(provider)
    if is_gpt_image_2_model(model) and not is_apimart:
        size = normalize_gpt_image_2_size(size)
    base_url = (provider.get("base_url") or AI_BASE_URL).rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    gen_url = f"{base_url}/images/generations" if base_url.endswith("/v1") else f"{base_url}/v1/images/generations"
    edit_url = f"{base_url}/images/edits" if base_url.endswith("/v1") else f"{base_url}/v1/images/edits"
    refs = [ref for ref in (reference_images or []) if ref.get("url")]
    mask_refs = [ref for ref in refs if str(ref.get("role") or "").strip().lower() == "mask" or str(ref.get("name") or "").lower().endswith("_mask.png")]
    image_refs = [ref for ref in refs if ref not in mask_refs]
    request_timeout = httpx.Timeout(connect=20.0, read=600.0, write=120.0, pool=20.0) if (is_gpt2 or is_apimart) else AI_REQUEST_TIMEOUT
    async with httpx.AsyncClient(timeout=request_timeout) as client:
        response = None
        if is_apimart:
            apimart_size, resolution = apimart_size_resolution(size)
            body = {
                "model": model,
                "prompt": prompt,
                "n": 1,
                "size": apimart_size,
                "resolution": resolution.upper(),
                "official_fallback": False,
            }
            if image_refs:
                body["image_urls"] = [reference_to_data_url(ref, max_size=1536) for ref in image_refs[:14]]
            response = await client.post(gen_url, headers=api_headers(provider=provider), json=body)
        elif is_gpt2 and not mask_refs:
            body = {"model": model, "prompt": prompt, "size": size}
            if quality:
                body["quality"] = quality
            if image_refs:
                body["image"] = [reference_to_data_url(ref, max_size=1536) for ref in image_refs[:4]]
            response = await client.post(gen_url, headers=api_headers(provider=provider), json=body)
        elif image_refs:
            # 1) 先用 multipart 提交到 /images/edits（OpenAI / Comfly 风格）
            files = []
            opened = []
            edit_failed_status = None
            edit_failed_text = ""
            try:
                for ref in image_refs[:4]:
                    path = output_file_from_url(ref.get("url", ""))
                    if not path:
                        continue
                    fh = open(path, "rb")
                    opened.append(fh)
                    files.append(("image", (os.path.basename(path), fh, content_type_for_path(path))))
                if mask_refs:
                    mask_path = output_file_from_url(mask_refs[0].get("url", ""))
                    if mask_path:
                        fh = open(mask_path, "rb")
                        opened.append(fh)
                        files.append(("mask", (os.path.basename(mask_path), fh, content_type_for_path(mask_path))))
                data = {"model": model, "prompt": prompt, "size": size, "quality": quality, "response_format": "url", "n": "1"}
                try:
                    response = await client.post(edit_url, headers=api_headers(json_body=False, provider=provider), data=data, files=files)
                    if response.status_code >= 400:
                        edit_failed_status = response.status_code
                        edit_failed_text = response.text[:500]
                        response = None
                except httpx.HTTPError as e:
                    edit_failed_status = -1
                    edit_failed_text = str(e)
                    response = None
            finally:
                for fh in opened:
                    fh.close()
            # 2) edits 失败 → 回退到 /images/generations + JSON image:[urls/base64]（grsai 风格）
            if response is None:
                logger.error(f"/images/edits failed ({edit_failed_status}): {edit_failed_text[:200]} → 回退到 /images/generations + image:[] JSON")
                image_payload = [reference_to_data_url(ref, max_size=1536) for ref in image_refs[:4]]
                body = {
                    "model": model, "prompt": prompt, "size": size,
                    "quality": quality, "response_format": "url", "n": 1,
                    "image": image_payload,
                }
                response = await client.post(gen_url, headers=api_headers(provider=provider), json=body)
        else:
            response = await client.post(
                gen_url,
                headers=api_headers(provider=provider),
                json={"model": model, "prompt": prompt, "size": size, "quality": quality, "response_format": "url", "n": 1},
            )
        response.raise_for_status()
        raw = response.json()
        try:
            return extract_image(raw), raw
        except HTTPException:
            try:
                logger.error("Image response parse failed provider=%s model=%s raw=%s", provider.get("id"), model, json.dumps(raw, ensure_ascii=False)[:1200])
            except Exception:
                logger.error("Image response parse failed provider=%s model=%s", provider.get("id"), model)
            task_id = extract_task_id(raw)
            if not task_id:
                raise
        task_result = await wait_for_image_task(client, task_id, provider)
        return extract_image(task_result), task_result

def upstream_message_from_record(item):
    role = item.get("role")
    if role not in {"user", "assistant"} or item.get("type") == "image":
        return None
    refs = item.get("attachments") or []
    if refs and role == "user":
        content = [{"type": "text", "text": item.get("content", "")}]
        for ref in refs[:4]:
            url = reference_to_data_url(ref)
            if url:
                content.append({"type": "image_url", "image_url": {"url": url}})
        return {"role": role, "content": content}
    return {"role": role, "content": item.get("content", "")}

# --- 路由接口 ---

def app_paths_payload():
    return {
        "runtime": RUNTIME_DIR,
        "save": ASSETS_DIR,
        "input": OUTPUT_INPUT_DIR,
        "output": OUTPUT_OUTPUT_DIR,
        "thumbs": ASSET_THUMB_DIR,
        "legacy_output": OUTPUT_DIR,
        "data": DATA_DIR,
        "logs": APP_LOG_DIR,
        "cache": APP_CACHE_DIR,
        "static": STATIC_DIR,
    }

APP_PATH_TARGETS = {
    "save": {
        "env": "APP_ASSETS_DIR",
        "label": "保存目录",
        "current": lambda: ASSETS_DIR,
    },
    "legacy_output": {
        "env": "APP_OUTPUT_DIR",
        "label": "兼容输出目录",
        "current": lambda: OUTPUT_DIR,
    },
    "input": {
        "env": "APP_ASSET_INPUT_DIR",
        "label": "导入素材目录",
        "current": lambda: OUTPUT_INPUT_DIR,
    },
    "output": {
        "env": "APP_ASSET_OUTPUT_DIR",
        "label": "生成输出目录",
        "current": lambda: OUTPUT_OUTPUT_DIR,
    },
    "thumbs": {
        "env": "APP_ASSET_THUMBS_DIR",
        "label": "thumbs",
        "current": lambda: ASSET_THUMB_DIR,
    },
    "logs": {
        "env": "APP_LOG_DIR",
        "label": "日志目录",
        "current": lambda: APP_LOG_DIR,
    },
    "cache": {
        "env": "APP_CACHE_DIR",
        "label": "缓存目录",
        "current": lambda: APP_CACHE_DIR,
    },
}

def update_static_mount(mount_path: str, directory: str):
    for route in app.routes:
        if getattr(route, "path", "") != mount_path:
            continue
        static_app = getattr(route, "app", None)
        if isinstance(static_app, StaticFiles):
            static_app.directory = directory
            static_app.all_directories = [directory]

def reload_app_path_globals():
    global OUTPUT_DIR, ASSETS_DIR, OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR
    global ASSET_THUMB_DIR, APP_LOG_DIR, APP_CACHE_DIR
    OUTPUT_DIR = os.path.abspath(os.getenv("APP_OUTPUT_DIR") or os.path.join(RUNTIME_DIR, "output"))
    ASSETS_DIR = os.path.abspath(os.getenv("APP_ASSETS_DIR") or os.path.join(RUNTIME_DIR, "assets"))
    OUTPUT_INPUT_DIR = os.path.abspath(os.getenv("APP_ASSET_INPUT_DIR") or os.path.join(ASSETS_DIR, "input"))
    OUTPUT_OUTPUT_DIR = os.path.abspath(os.getenv("APP_ASSET_OUTPUT_DIR") or os.path.join(ASSETS_DIR, "output"))
    ASSET_THUMB_DIR = os.path.abspath(os.getenv("APP_ASSET_THUMBS_DIR") or os.path.join(ASSETS_DIR, "thumbs"))
    APP_LOG_DIR = os.path.abspath(os.getenv("APP_LOG_DIR") or os.path.join(RUNTIME_DIR, "logs"))
    APP_CACHE_DIR = os.path.abspath(os.getenv("APP_CACHE_DIR") or os.path.join(RUNTIME_DIR, "cache"))
    for path in (OUTPUT_DIR, ASSETS_DIR, OUTPUT_INPUT_DIR, OUTPUT_OUTPUT_DIR, ASSET_THUMB_DIR, APP_LOG_DIR, APP_CACHE_DIR):
        os.makedirs(path, exist_ok=True)
    update_static_mount("/output", OUTPUT_DIR)
    update_static_mount("/assets", ASSETS_DIR)

def normalize_selected_path(path: str):
    selected = os.path.abspath(os.path.expanduser(str(path or "").strip().strip('"')))
    if not selected:
        raise HTTPException(status_code=400, detail="请选择有效目录")
    os.makedirs(selected, exist_ok=True)
    if not os.path.isdir(selected):
        raise HTTPException(status_code=400, detail="目标不是文件夹")
    return selected

def apply_app_path(target: str, path: str):
    target = (target or "").strip()
    meta = APP_PATH_TARGETS.get(target)
    if not meta:
        raise HTTPException(status_code=400, detail="未知目录类型")
    selected = normalize_selected_path(path)
    update_env_values({meta["env"]: selected})
    reload_app_path_globals()
    return {"ok": True, "target": target, "path": selected, "paths": app_paths_payload()}

def select_local_directory(initial_path: str):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(initialdir=initial_path if os.path.isdir(initial_path) else RUNTIME_DIR)
        root.destroy()
        return selected
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"打开文件夹选择器失败：{exc}")

def open_local_path(path: str):
    os.makedirs(path, exist_ok=True)
    if sys.platform.startswith("win"):
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])

def version_tuple(value: str):
    parts = []
    for piece in re.split(r"[^0-9]+", value or ""):
        if piece:
            parts.append(int(piece))
    return tuple(parts or [0])

def load_update_state():
    if not os.path.exists(UPDATE_STATE_FILE):
        return {}
    try:
        with open(UPDATE_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as exc:
        logger.warning("Load update state failed: %s", exc)
        return {}

def save_update_state(state: dict):
    os.makedirs(os.path.dirname(UPDATE_STATE_FILE), exist_ok=True)
    payload = dict(state or {})
    payload["saved_at"] = now_ms()
    with GLOBAL_CONFIG_LOCK:
        with open(UPDATE_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)

def _is_zip_download_url(url: str) -> bool:
    """Check if a URL points to a .zip download (by inspecting the URL path, ignoring query params)."""
    try:
        parsed = urllib.parse.urlparse(str(url or "").strip())
    except Exception:
        return False
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    path = urllib.parse.unquote(parsed.path or "").lower()
    return path.endswith(".zip")


def normalize_update_payload(data: Dict[str, Any]):
    latest = str(data.get("version") or data.get("latest_version") or data.get("tag_name") or "").strip()
    if latest.lower().startswith("v"):
        latest = latest[1:]
    raw_assets = data.get("assets") or []
    parsed_assets = []
    if isinstance(raw_assets, list):
        for asset in raw_assets:
            if not isinstance(asset, dict):
                continue
            raw_url = str(asset.get("browser_download_url") or asset.get("url") or "")
            if not raw_url:
                continue
            # Only assets whose URL is a zip download can be auto-update targets
            if not _is_zip_download_url(raw_url):
                continue
            name = str(asset.get("name") or "")
            name_lower = name.lower()
            atype = "unknown"
            if "desktop" in name_lower:
                atype = "desktop"
            elif "browser" in name_lower:
                atype = "browser"
            elif name_lower.endswith(".zip"):
                atype = "zip"
            # Extract sha256 from various formats
            sha256_val = ""
            raw_digest = str(asset.get("digest") or "")
            if raw_digest.startswith("sha256:"):
                sha256_val = raw_digest.split(":", 1)[1]
            if not sha256_val:
                sha256_val = str(asset.get("sha256") or "")
            parsed_assets.append({"name": name, "url": raw_url, "type": atype, "size": asset.get("size", 0), "sha256": sha256_val})
    # Select best asset for auto-update
    is_desktop = os.getenv("LUMAFORGE_DESKTOP") == "1" or os.getenv("INFINITE_CANVAS_DESKTOP") == "1"
    selected = None
    for a in parsed_assets:
        if is_desktop and a["type"] == "desktop":
            selected = a; break
        if not is_desktop and a["type"] == "browser":
            selected = a; break
    if not selected:
        for a in parsed_assets:
            if a["type"] == "zip":
                selected = a; break
    if not selected and parsed_assets:
        selected = parsed_assets[0]
    # Fallback: top-level download_url if it's a safe zip URL and no asset was selected
    if not selected:
        top_dl = str(data.get("download_url") or "").strip()
        if top_dl and _is_zip_download_url(top_dl):
            url_basename = urllib.parse.unquote(urllib.parse.urlparse(top_dl).path.rsplit("/", 1)[-1]) if "/" in top_dl else ""
            fname = _sanitize_update_filename(url_basename, latest)
            top_sha256 = ""
            top_digest = str(data.get("digest") or "")
            if top_digest.startswith("sha256:"):
                top_sha256 = top_digest.split(":", 1)[1]
            if not top_sha256:
                top_sha256 = str(data.get("sha256") or "")
            selected = {"name": fname, "url": top_dl, "type": "zip", "size": 0, "sha256": top_sha256}
    # display_url: for UI display, can be html_url / page link (not for downloading)
    display_url = ""
    if selected:
        display_url = selected["url"]
    else:
        display_url = data.get("html_url") or data.get("download_url") or data.get("url") or ""
    return {
        "latest_version": latest,
        "download_url": display_url,
        "notes": data.get("notes") or data.get("changelog") or data.get("body") or "",
        "assets": parsed_assets,
        "selected_asset": selected,
    }

@app.get("/login.html")
async def login_page():
    return FileResponse(os.path.join(STATIC_DIR, "login.html"))

@app.get("/")
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/api/app/info")
async def app_info():
    return {
        "name": APP_DISPLAY_NAME,
        "brand": APP_BRAND_NAME,
        "repository": APP_REPOSITORY_NAME,
        "version": APP_VERSION,
        "build_id": APP_BUILD_ID,
        "desktop": os.getenv("LUMAFORGE_DESKTOP") == "1" or os.getenv("INFINITE_CANVAS_DESKTOP") == "1",
        "cloud_url": CLOUD_SYNC_BASE_URL,
        "update_check_configured": bool(APP_UPDATE_CHECK_URL),
        "update_check_url": APP_UPDATE_CHECK_URL,
        "update_state": load_update_state(),
        "paths": app_paths_payload(),
    }

@app.post("/api/app/open-path")
async def app_open_path(payload: AppOpenPathRequest):
    paths = app_paths_payload()
    target = (payload.target or "").strip()
    path = paths.get(target)
    if not path:
        raise HTTPException(status_code=400, detail="未知目录")
    try:
        open_local_path(path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"打开目录失败：{exc}")
    return {"ok": True, "target": target, "path": path}

@app.post("/api/app/select-path")
async def app_select_path(payload: AppPathSelectRequest):
    target = (payload.target or "").strip()
    meta = APP_PATH_TARGETS.get(target)
    if not meta:
        raise HTTPException(status_code=400, detail="未知目录类型")
    selected = select_local_directory(meta["current"]())
    if not selected:
        return {"ok": False, "cancelled": True, "target": target, "paths": app_paths_payload()}
    return apply_app_path(target, selected)

@app.post("/api/app/update-path")
async def app_update_path(payload: AppPathUpdateRequest):
    return apply_app_path(payload.target, payload.path)

@app.post("/api/app/update-settings")
async def app_update_settings(payload: AppUpdateSettingsRequest):
    global APP_UPDATE_CHECK_URL
    url = (payload.update_check_url or "").strip()
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="更新检查地址必须以 http:// 或 https:// 开头")
    update_env_values({"APP_UPDATE_CHECK_URL": url})
    APP_UPDATE_CHECK_URL = url
    return {
        "ok": True,
        "current_version": APP_VERSION,
        "update_check_url": APP_UPDATE_CHECK_URL,
        "update_check_configured": bool(APP_UPDATE_CHECK_URL),
    }

@app.get("/api/app/update-check")
async def app_update_check():
    if not APP_UPDATE_CHECK_URL:
        return {
            "configured": False,
            "current_version": APP_VERSION,
            "message": "未配置更新检查地址。发布到 GitHub 后可通过 APP_UPDATE_CHECK_URL 指向 release/version JSON。",
        }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(APP_UPDATE_CHECK_URL)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}")
    normalized = normalize_update_payload(data if isinstance(data, dict) else {})
    latest = normalized["latest_version"]
    is_newer = bool(latest and version_tuple(latest) > version_tuple(APP_VERSION))
    is_frozen = getattr(sys, "frozen", False)
    is_desktop = os.getenv("LUMAFORGE_DESKTOP") == "1" or os.getenv("INFINITE_CANVAS_DESKTOP") == "1"
    auto_update_supported = not is_frozen  # Python source can self-update; EXE cannot
    reason = ""
    if is_frozen:
        reason = "当前环境是打包 EXE，需要独立 updater 或手动替换。"
    selected = normalized.get("selected_asset")
    return {
        "configured": True,
        "current_version": APP_VERSION,
        "latest_version": latest,
        "is_newer": is_newer,
        "download_url": normalized["download_url"],
        "notes": normalized["notes"],
        "source_url": APP_UPDATE_CHECK_URL,
        "assets": normalized.get("assets", []),
        "selected_asset": selected,
        "auto_update_supported": auto_update_supported,
        "auto_update_reason": reason,
        "raw": data,
    }


def _safe_extract_zip(zip_path: str, dest_dir: str):
    """Extract zip with comprehensive zip-slip protection."""
    dest_abs = os.path.abspath(dest_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            fname = info.filename
            # Reject absolute paths (Unix and Windows)
            if fname.startswith("/") or fname.startswith("\\"):
                raise HTTPException(status_code=400, detail=f"ZIP 包含绝对路径：{fname}")
            if len(fname) >= 2 and fname[1] == ":":
                raise HTTPException(status_code=400, detail=f"ZIP 包含 Windows 盘符路径：{fname}")
            # Reject path traversal (forward and backslash)
            parts = fname.replace("\\", "/").split("/")
            if ".." in parts:
                raise HTTPException(status_code=400, detail=f"ZIP 包含路径遍历：{fname}")
            # Reject empty component names
            if any(p == "" for p in parts[:-1] if info.is_dir()):
                pass  # trailing slash is OK for dirs
            # Final check: resolved path must be within dest_dir
            member_path = os.path.normpath(os.path.join(dest_dir, fname.replace("\\", "/")))
            member_abs = os.path.abspath(member_path)
            if not (member_abs == dest_abs or member_abs.startswith(dest_abs + os.sep)):
                raise HTTPException(status_code=400, detail=f"ZIP 解压目标越界：{fname}")
        zf.extractall(dest_dir)


def _sha256_file(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _sanitize_update_filename(name: str, version: str) -> str:
    """Keep only safe characters in filename; fall back to a known-good name."""
    safe = re.sub(r"[^a-zA-Z0-9._\- ]", "", name or "")
    if not safe or not safe.lower().endswith(".zip"):
        safe = f"lumaforge-{version}.zip"
    return safe


def _detect_package_root(staging_dir: str) -> str:
    """Find the real package root inside a staging dir after extraction."""
    # A. staging_dir itself has main.py or static/index.html
    if os.path.isfile(os.path.join(staging_dir, "main.py")):
        return staging_dir
    if os.path.isfile(os.path.join(staging_dir, "static", "index.html")):
        return staging_dir
    # B/C. single subfolder with main.py or static/index.html
    children = [d for d in os.listdir(staging_dir) if os.path.isdir(os.path.join(staging_dir, d))]
    if len(children) == 1:
        sub = os.path.join(staging_dir, children[0])
        if os.path.isfile(os.path.join(sub, "main.py")):
            return sub
        if os.path.isfile(os.path.join(sub, "static", "index.html")):
            return sub
    # D. not found
    return ""


def _atomic_replace_file(src: str, dst: str):
    """Copy src to dst atomically: write to temp in same directory, then os.replace."""
    tmp = dst + ".__update_new__"
    try:
        if os.path.exists(tmp):
            os.remove(tmp)
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass
        raise


def _atomic_replace_dir(src: str, dst: str, name: str):
    """Replace directory dst with src using rename-based atomic swap.

    1. Copy new content to dst.__update_new__ (same parent as dst)
    2. dst → dst.__update_old__ (rename)
    3. dst.__update_new__ → dst (rename)
    4. On success: delete dst.__update_old__
    On failure: restore dst.__update_old__ → dst if needed.
    """
    old_tag = dst + ".__update_old__"
    dst_parent = os.path.dirname(dst)
    new_staging = os.path.join(dst_parent, name + ".__update_new__")
    # Pre-cleanup: remove stale residuals
    if os.path.exists(new_staging):
        shutil.rmtree(new_staging)
    if os.path.exists(old_tag):
        if not os.path.exists(dst):
            # dst missing but old_tag exists → restore it first
            os.rename(old_tag, dst)
        else:
            # both dst and old_tag exist → old is stale, remove
            shutil.rmtree(old_tag)
    # Step 0: copy new content to staging spot next to dst
    shutil.copytree(src, new_staging)
    # Step 1: rename old out of the way
    had_old = False
    if os.path.exists(dst):
        os.rename(dst, old_tag)
        had_old = True
    # Step 2: rename new into place
    try:
        os.rename(new_staging, dst)
    except Exception as exc:
        # Restore old if we moved it
        if had_old and os.path.exists(old_tag) and not os.path.exists(dst):
            try:
                os.rename(old_tag, dst)
            except Exception:
                logger.error("Failed to restore %s from __update_old__", dst)
        # Cleanup new staging
        if os.path.exists(new_staging):
            shutil.rmtree(new_staging, ignore_errors=True)
        raise exc
    # Step 3: cleanup old
    if os.path.exists(old_tag):
        shutil.rmtree(old_tag, ignore_errors=True)


UPDATE_PROTECT_DIRS = {"API", "data", "assets", "logs", "cache", "cloud-data", "releases", "updates", "userdata", "output"}
UPDATE_REPLACE_FILES = {"main.py", "cloud_config_server.py", "launcher.py", "desktop_launcher.py",
                        "requirements.txt", "requirements-cloud.txt", "build_windows.bat", "build_desktop.bat",
                        "infinite_canvas.spec", "desktop_canvas.spec", "Dockerfile", "Dockerfile.cloud",
                        "docker-compose.yml", "docker-compose.cloud.yml", ".env.example", ".env.cloud.example",
                        "docker-entrypoint.sh", "docker-entrypoint-cloud.sh", "README.md", "APP_PACKAGING.md",
                        "RELEASE_CHECKLIST.md", ".gitignore"}
UPDATE_REPLACE_DIRS = {"static", "workflows", "docs", "scripts"}


@app.post("/api/app/update-download")
async def app_update_download():
    if not APP_UPDATE_CHECK_URL:
        raise HTTPException(status_code=400, detail="未配置更新检查地址")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(APP_UPDATE_CHECK_URL)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}")
    normalized = normalize_update_payload(data if isinstance(data, dict) else {})
    latest = normalized["latest_version"]
    if not latest or not (version_tuple(latest) > version_tuple(APP_VERSION)):
        raise HTTPException(status_code=400, detail=f"当前已是最新版本 {APP_VERSION}")
    selected = normalized.get("selected_asset")
    if not selected or not selected.get("url"):
        raise HTTPException(status_code=400, detail="未找到可下载的 zip 更新包")
    download_url = selected["url"]
    # Security: URL must be http/https
    if not download_url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="下载地址必须是 http/https URL")
    # Security: URL path must be a .zip file (not just filename check)
    if not _is_zip_download_url(download_url):
        raise HTTPException(status_code=400, detail="更新包下载地址不是 zip 文件")
    os.makedirs(UPDATE_DOWNLOADS_DIR, exist_ok=True)
    filename = _sanitize_update_filename(selected.get("name"), latest)
    local_path = os.path.join(UPDATE_DOWNLOADS_DIR, filename)
    try:
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
            dl_resp = await client.get(download_url)
            dl_resp.raise_for_status()
            with open(local_path, "wb") as f:
                f.write(dl_resp.content)
    except Exception as exc:
        if os.path.exists(local_path):
            os.remove(local_path)
        raise HTTPException(status_code=502, detail=f"下载更新包失败：{exc}")
    file_size = os.path.getsize(local_path)
    actual_sha256 = _sha256_file(local_path)
    expected_sha256 = (selected.get("sha256") or "").strip().lower()
    sha256_verified = False
    warning = ""
    if expected_sha256:
        if actual_sha256.lower() != expected_sha256:
            os.remove(local_path)
            raise HTTPException(status_code=400, detail=f"更新包校验失败：SHA256 不匹配（期望 {expected_sha256[:16]}...，实际 {actual_sha256[:16]}...）")
        sha256_verified = True
    else:
        warning = "未提供 SHA256 校验值，请确认来源可信。"
    return {
        "ok": True,
        "version": latest,
        "filename": filename,
        "path": local_path,
        "size": file_size,
        "sha256": actual_sha256,
        "sha256_expected": expected_sha256 or None,
        "sha256_verified": sha256_verified,
        "warning": warning,
        "asset_type": selected.get("type", "unknown"),
    }


async def install_latest_update_package(target_version: str = "", download_meta: Optional[dict] = None):
    is_frozen = getattr(sys, "frozen", False)
    if is_frozen:
        raise HTTPException(status_code=400, detail="当前环境是打包 EXE，不支持原地更新，需要独立 updater。")
    # Find downloaded zip
    os.makedirs(UPDATE_DOWNLOADS_DIR, exist_ok=True)
    zip_files = sorted([f for f in os.listdir(UPDATE_DOWNLOADS_DIR) if f.endswith(".zip")], key=lambda f: os.path.getmtime(os.path.join(UPDATE_DOWNLOADS_DIR, f)), reverse=True)
    if not zip_files:
        raise HTTPException(status_code=400, detail="未找到已下载的更新包，请先执行「下载更新」")
    zip_path = os.path.join(UPDATE_DOWNLOADS_DIR, zip_files[0])
    # Create unique staging directory
    install_ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    install_dir = os.path.join(UPDATE_STAGING_DIR, f"install-{install_ts}")
    os.makedirs(UPDATE_STAGING_DIR, exist_ok=True)
    # Extract
    try:
        _safe_extract_zip(zip_path, install_dir)
    except HTTPException:
        raise
    except Exception as exc:
        shutil.rmtree(install_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"解压更新包失败：{exc}")
    # Detect package root
    pkg_root = _detect_package_root(install_dir)
    if not pkg_root:
        shutil.rmtree(install_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="更新包结构不正确，缺少 main.py 或 static/index.html")
    # Backup current files
    backup_ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    backup_dir = os.path.join(UPDATE_BACKUPS_DIR, f"backup-{backup_ts}")
    os.makedirs(backup_dir, exist_ok=True)
    try:
        for name in UPDATE_REPLACE_FILES:
            src = os.path.join(BASE_DIR, name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(backup_dir, name))
        for name in UPDATE_REPLACE_DIRS:
            src = os.path.join(BASE_DIR, name)
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(backup_dir, name), dirs_exist_ok=True)
    except Exception as exc:
        shutil.rmtree(install_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"备份当前版本失败：{exc}")
    # Replace files (atomic individual files, then atomic directories)
    replaced = []
    try:
        for name in UPDATE_REPLACE_FILES:
            src = os.path.join(pkg_root, name)
            dst = os.path.join(BASE_DIR, name)
            if os.path.isfile(src):
                _atomic_replace_file(src, dst)
                replaced.append(name)
        # Atomic directory replacement for static/ and workflows/
        for name in UPDATE_REPLACE_DIRS:
            src = os.path.join(pkg_root, name)
            if os.path.isdir(src):
                dst = os.path.join(BASE_DIR, name)
                _atomic_replace_dir(src, dst, name)
                replaced.append(name + "/")
    except Exception as exc:
        # Rollback: restore ALL backed-up files and directories, not just 'replaced'
        logger.error("Update install failed, rolling back: %s", exc, exc_info=True)
        for name in UPDATE_REPLACE_FILES:
            try:
                backup_src = os.path.join(backup_dir, name)
                dst = os.path.join(BASE_DIR, name)
                if os.path.isfile(backup_src):
                    _atomic_replace_file(backup_src, dst)
            except Exception as rb_exc:
                logger.error("Rollback failed for file %s: %s", name, rb_exc)
        for name in UPDATE_REPLACE_DIRS:
            try:
                backup_src = os.path.join(backup_dir, name)
                dst = os.path.join(BASE_DIR, name)
                if os.path.isdir(backup_src):
                    _atomic_replace_dir(backup_src, dst, name)
            except Exception as rb_exc:
                logger.error("Rollback failed for dir %s: %s", name, rb_exc)
        shutil.rmtree(install_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"安装更新失败，已尝试回滚：{exc}")
    # Cleanup staging
    shutil.rmtree(install_dir, ignore_errors=True)
    state = {
        "current_version": APP_VERSION,
        "target_version": target_version or "",
        "installed_at": now_ms(),
        "backup_dir": backup_dir,
        "package": zip_path,
        "download": download_meta or {},
        "replaced": replaced,
        "restart_required": True,
    }
    save_update_state(state)
    return {
        "ok": True,
        "installed": True,
        "restart_required": True,
        "replaced": replaced,
        "backup_dir": backup_dir,
        "update_state": state,
    }


@app.post("/api/app/update-install")
async def app_update_install():
    return await install_latest_update_package()


@app.post("/api/app/update-auto")
async def app_update_auto():
    is_frozen = getattr(sys, "frozen", False)
    if is_frozen:
        raise HTTPException(status_code=400, detail="当前环境是打包 EXE，需要独立 updater；浏览器/源码版支持一键自动升级。")
    check = await app_update_check()
    if not check.get("configured"):
        raise HTTPException(status_code=400, detail=check.get("message") or "未配置更新检查地址")
    if not check.get("is_newer"):
        return {
            "ok": True,
            "updated": False,
            "restart_required": False,
            "current_version": check.get("current_version"),
            "latest_version": check.get("latest_version"),
            "message": f"当前已是最新版本 {check.get('current_version')}",
        }
    if not check.get("auto_update_supported"):
        raise HTTPException(status_code=400, detail=check.get("auto_update_reason") or "当前环境不支持自动升级")
    download = await app_update_download()
    install = await install_latest_update_package(check.get("latest_version") or "", download)
    return {
        "ok": True,
        "updated": True,
        "restart_required": True,
        "current_version": check.get("current_version"),
        "latest_version": check.get("latest_version"),
        "download": download,
        "install": install,
        "message": "自动升级已安装完成，请重启应用后生效。",
    }


@app.post("/api/app/restart")
async def app_restart():
    is_frozen = getattr(sys, "frozen", False)
    if is_frozen:
        return {"ok": False, "restart_required": True, "message": "EXE 环境不支持自动重启，请手动关闭并重新打开。"}
    # Schedule restart after response is sent
    async def _delayed_restart():
        await asyncio.sleep(1)
        python_exe = sys.executable
        script = os.path.join(BASE_DIR, "main.py")
        if os.path.isfile(script):
            os.execv(python_exe, [python_exe, script])
    asyncio.create_task(_delayed_restart())
    return {"ok": True, "restarting": True}

@app.get("/api/view")
async def view_image(filename: str, type: str = "input", subfolder: str = ""):
    SAFE_NAME_RE = re.compile(r'^[a-zA-Z0-9_\-.\s\(\)]+$')
    if not filename or not SAFE_NAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if type not in ("input", "output", "temp"):
        raise HTTPException(status_code=400, detail="Invalid type")
    if subfolder and not SAFE_NAME_RE.match(subfolder):
        raise HTTPException(status_code=400, detail="Invalid subfolder")
    client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=2)
    own_client = GLOBAL_HTTP_CLIENT is None
    try:
        for addr in COMFYUI_INSTANCES:
            try:
                url = f"http://{addr}/view"
                params = {"filename": filename, "type": type, "subfolder": subfolder}
                r = await client.get(url, params=params, timeout=1)
                if r.status_code == 200:
                    return Response(content=r.content, media_type=r.headers.get('Content-Type'))
            except Exception:
                continue
    finally:
        if own_client:
            await client.aclose()
    # 后端都拿不到时回退本地 assets/<input|output>/
    # 适用场景：画布通过 /api/ai/upload 把参考图直接落到本地 assets/input/，
    # 但 ComfyUI 的 input 可能因为重启/清理而丢失，导致 enhance/klein 等页面预览对比图 404
    if not subfolder and type in ("input", "output"):
        safe_name = os.path.basename(filename or "")
        if safe_name:
            local_path = output_path_for(safe_name, "input" if type == "input" else "output")
            if os.path.isfile(local_path):
                return FileResponse(local_path, media_type=content_type_for_path(local_path))
    raise HTTPException(status_code=404, detail="Image not found on any available backend")

@app.get("/api/download-output")
def download_output(url: str, name: str = ""):
    path = output_file_from_url(url)
    if not path:
        raise HTTPException(status_code=404, detail="文件不存在")
    filename = os.path.basename(name) if name else os.path.basename(path)
    return FileResponse(path, media_type=content_type_for_path(path), filename=filename)

@app.post("/api/download-url")
async def download_url(payload: DownloadUrlRequest):
    source_name, raw, content_type = await bytes_from_download_url(payload.url)
    filename = safe_download_filename(payload.filename or source_name, source_name or "download")
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}"}
    return Response(content=raw, media_type=content_type or "application/octet-stream", headers=headers)

@app.get("/api/download-url")
async def download_url_get(url: str, filename: str = ""):
    return await download_url(DownloadUrlRequest(url=url, filename=filename))

@app.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: CanvasAssetsDownloadRequest):
    urls = []
    for url in payload.urls or []:
        if isinstance(url, str) and url.strip() and url.strip() not in urls:
            urls.append(url.strip())
    if not urls:
        raise HTTPException(status_code=400, detail="没有可下载文件")
    zip_buffer = BytesIO()
    used_names = set()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for index, url in enumerate(urls, start=1):
            source_name, raw, _content_type = await bytes_from_download_url(url)
            name = safe_download_filename(source_name, f"asset-{index}.png")
            stem, ext = os.path.splitext(name)
            if not ext:
                ext = ".png"
            candidate = f"{stem}{ext}"
            n = 2
            while candidate.lower() in used_names:
                candidate = f"{stem}-{n}{ext}"
                n += 1
            used_names.add(candidate.lower())
            zf.writestr(candidate, raw)
    zip_buffer.seek(0)
    filename = safe_download_filename(payload.filename or "canvas-assets.zip", "canvas-assets.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}"}
    return Response(content=zip_buffer.getvalue(), media_type="application/zip", headers=headers)

@app.get("/api/canvas-assets/download")
async def download_canvas_assets_get(request: Request, filename: str = "canvas-assets.zip"):
    urls = request.query_params.getlist("url")
    return await download_canvas_assets(CanvasAssetsDownloadRequest(urls=urls, filename=filename))

@app.get("/api/assets")
def list_assets(type: str = "", q: str = "", favorite: Optional[bool] = None, limit: int = 80, offset: int = 0):
    limit = max(1, min(int(limit or 80), 200))
    offset = max(0, int(offset or 0))
    clauses = []
    params = []
    if type in {"image", "video", "file"}:
        clauses.append("type = ?")
        params.append(type)
    if favorite is not None:
        clauses.append("favorite = ?")
        params.append(1 if favorite else 0)
    if q:
        needle = f"%{q.strip()}%"
        clauses.append("(title LIKE ? OR prompt LIKE ? OR model LIKE ? OR tags LIKE ?)")
        params.extend([needle, needle, needle, needle])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with ASSET_LOCK:
        with asset_db() as conn:
            total = conn.execute(f"SELECT COUNT(*) AS c FROM assets {where}", params).fetchone()["c"]
            rows = conn.execute(
                f"SELECT * FROM assets {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
    return {"items": [asset_row_to_dict(row) for row in rows], "total": total, "limit": limit, "offset": offset}

@app.post("/api/assets/rescan")
def rescan_assets_from_history():
    indexed = []
    if os.path.exists(HISTORY_FILE):
        with HISTORY_LOCK:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        for record in history if isinstance(history, list) else []:
            indexed.extend(index_history_record_assets(record))
    return {"ok": True, "indexed": len(indexed)}

@app.put("/api/assets/{asset_id}")
def update_asset(asset_id: str, payload: AssetUpdateRequest):
    updates = []
    params = []
    if payload.title is not None:
        updates.append("title = ?")
        params.append(payload.title.strip())
    if payload.tags is not None:
        updates.append("tags = ?")
        params.append(json.dumps(json_list(payload.tags), ensure_ascii=False))
    if payload.favorite is not None:
        updates.append("favorite = ?")
        params.append(1 if payload.favorite else 0)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes")
    updates.append("updated_at = ?")
    params.append(time.time())
    params.append(asset_id)
    with ASSET_LOCK:
        with asset_db() as conn:
            cur = conn.execute(f"UPDATE assets SET {', '.join(updates)} WHERE id = ?", params)
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Asset not found")
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
            return asset_row_to_dict(row)

@app.get("/api/assets/{asset_id}/download")
def download_asset(asset_id: str):
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row or not os.path.isfile(row["local_path"]):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(row["local_path"], media_type=content_type_for_path(row["local_path"]), filename=row["title"] or os.path.basename(row["local_path"]))

@app.post("/api/assets/bulk-delete")
def bulk_delete_assets(payload: AssetBulkDeleteRequest):
    ids = []
    seen = set()
    for raw in payload.ids or []:
        asset_id = str(raw or "").strip()
        if asset_id and asset_id not in seen:
            ids.append(asset_id)
            seen.add(asset_id)
    if not ids:
        raise HTTPException(status_code=400, detail="No asset ids")
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Too many asset ids")

    deleted_rows = []
    missing = []
    with ASSET_LOCK:
        with asset_db() as conn:
            for asset_id in ids:
                row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
                if not row:
                    missing.append(asset_id)
                    continue
                if row["sha256"]:
                    conn.execute(
                        """
                        INSERT INTO asset_deletions (sha256, title, local_path, cloud_key, deleted_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(sha256) DO UPDATE SET
                            title=excluded.title,
                            local_path=excluded.local_path,
                            cloud_key=excluded.cloud_key,
                            deleted_at=excluded.deleted_at
                        """,
                        (
                            row["sha256"],
                            row["title"] or "",
                            row["local_path"] or "",
                            row["cloud_key"] or "",
                            time.time(),
                        ),
                    )
                conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
                deleted_rows.append(dict(row))

    file_deleted = 0
    file_failed = 0
    if payload.delete_file:
        for row in deleted_rows:
            local_path = row.get("local_path") or ""
            if os.path.isfile(local_path):
                try:
                    os.remove(local_path)
                    file_deleted += 1
                except Exception as e:
                    file_failed += 1
                    logger.warning("Asset file delete failed for %s: %s", local_path, e)

    return {
        "ok": True,
        "deleted": len(deleted_rows),
        "missing": missing,
        "file_deleted": file_deleted,
        "file_failed": file_failed,
    }

@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str, delete_file: bool = False):
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Asset not found")
            if row["sha256"]:
                conn.execute(
                    """
                    INSERT INTO asset_deletions (sha256, title, local_path, cloud_key, deleted_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(sha256) DO UPDATE SET
                        title=excluded.title,
                        local_path=excluded.local_path,
                        cloud_key=excluded.cloud_key,
                        deleted_at=excluded.deleted_at
                    """,
                    (
                        row["sha256"],
                        row["title"] or "",
                        row["local_path"] or "",
                        row["cloud_key"] or "",
                        time.time(),
                    ),
                )
            conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    if delete_file and os.path.isfile(row["local_path"]):
        try:
            os.remove(row["local_path"])
        except Exception as e:
            logger.warning("Asset file delete failed for %s: %s", row["local_path"], e)
    return {"ok": True}

@app.get("/api/asset-library")
def get_asset_library():
    return {"library": load_asset_library()}


@app.post("/api/asset-library/categories")
def create_asset_library_category(payload: AssetLibraryCategoryRequest):
    cat_type = "workflow" if str(payload.type or "").lower() == "workflow" else "image"
    category_id = f"cat_{uuid.uuid4().hex[:12]}"
    now = time.time()
    with ASSET_LOCK:
        with asset_db() as conn:
            ensure_default_asset_library_categories(conn)
            conn.execute(
                """
                INSERT INTO asset_library_categories (id, name, type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    category_id,
                    sanitize_asset_name(payload.name, "新文件夹"),
                    cat_type,
                    now,
                    now,
                ),
            )
    library = load_asset_library()
    category = next((cat for cat in library.get("categories", []) if cat.get("id") == category_id), None)
    return {"library": library, "category": category}


@app.patch("/api/asset-library/categories/{category_id}")
def rename_asset_library_category(category_id: str, payload: AssetLibraryRenameRequest):
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM asset_library_categories WHERE id = ?", (category_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="分类不存在")
            conn.execute(
                "UPDATE asset_library_categories SET name = ?, updated_at = ? WHERE id = ?",
                (sanitize_asset_name(payload.name, row["name"] or "新文件夹"), time.time(), category_id),
            )
    library = load_asset_library()
    category = next((cat for cat in library.get("categories", []) if cat.get("id") == category_id), None)
    return {"library": library, "category": category}


@app.delete("/api/asset-library/categories/{category_id}")
def delete_asset_library_category(category_id: str):
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM asset_library_categories WHERE id = ?", (category_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="分类不存在")
            if category_id == "inbox":
                raise HTTPException(status_code=400, detail="默认文件夹不能删除")
            fallback = conn.execute(
                "SELECT id FROM asset_library_categories WHERE type = 'image' AND id != ? ORDER BY CASE WHEN id = 'inbox' THEN 0 ELSE 1 END, created_at ASC LIMIT 1",
                (category_id,),
            ).fetchone()
            if row["type"] == "image":
                fallback_id = (fallback["id"] if fallback else "inbox") or "inbox"
                conn.execute(
                    "UPDATE assets SET category_id = ? WHERE COALESCE(category_id, '') = ?",
                    (fallback_id, category_id),
                )
            conn.execute("DELETE FROM asset_library_categories WHERE id = ?", (category_id,))
    library = load_asset_library()
    return {"library": library}


@app.post("/api/asset-library/items")
async def add_asset_library_item(payload: AssetLibraryAddRequest):
    category_id = str(payload.category_id or "inbox").strip() or "inbox"
    src = output_file_from_url(payload.url)
    if not src:
        raise HTTPException(status_code=400, detail="只支持本地 /assets 或 /output 文件")
    with ASSET_LOCK:
        with asset_db() as conn:
            ensure_default_asset_library_categories(conn)
            category = conn.execute("SELECT * FROM asset_library_categories WHERE id = ?", (category_id,)).fetchone()
            if not category:
                raise HTTPException(status_code=404, detail="分类不存在")
            if category["type"] != "image":
                raise HTTPException(status_code=400, detail="该分类暂不支持添加图片")
    base_name = sanitize_asset_name(payload.name or os.path.basename(src), "asset")
    stem, ext = os.path.splitext(base_name)
    ext = ext or os.path.splitext(src)[1].lower() or ".png"
    if ext.lower() not in IMAGE_EXTENSIONS and ext.lower() not in VIDEO_EXTENSIONS:
        ext = os.path.splitext(src)[1].lower() or ".png"
    dest_name = f"lib_{uuid.uuid4().hex[:12]}_{stem}{ext}"
    dest_path = os.path.join(ASSET_LIBRARY_DIR, dest_name)
    shutil.copy2(src, dest_path)
    local_url = asset_library_url_for(dest_name)
    item = index_local_asset(
        local_url,
        source_type="asset-library",
        source_url=payload.url,
        tags=["asset-library"],
        created_at=time.time(),
        category_id=category_id,
    )
    if not item:
        raise HTTPException(status_code=500, detail="保存资产失败")
    with ASSET_LOCK:
        with asset_db() as conn:
            conn.execute(
                "UPDATE assets SET title = ?, category_id = ?, updated_at = ? WHERE id = ?",
                (stem[:120] or "asset", category_id, time.time(), item["id"]),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (item["id"],)).fetchone()
    library_item = asset_library_item_from_asset_row(row) if row else asset_library_item_from_asset_row(item)
    library = load_asset_library()
    return {"library": library, "item": library_item}


@app.patch("/api/asset-library/items/{item_id}")
def rename_asset_library_item(item_id: str, payload: AssetLibraryRenameRequest):
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="资产不存在")
            conn.execute(
                "UPDATE assets SET title = ?, updated_at = ? WHERE id = ?",
                (sanitize_asset_name(payload.name, row["title"] or "asset")[:120], time.time(), item_id),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (item_id,)).fetchone()
    return {"library": load_asset_library(), "item": asset_library_item_from_asset_row(row)}


@app.delete("/api/asset-library/items/{item_id}")
def delete_asset_library_item(item_id: str):
    deleted_path = ""
    with ASSET_LOCK:
        with asset_db() as conn:
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (item_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="资产不存在")
            deleted_path = row["local_path"] or ""
            conn.execute("DELETE FROM assets WHERE id = ?", (item_id,))
    if deleted_path and os.path.isfile(deleted_path):
        try:
            os.remove(deleted_path)
        except Exception as e:
            logger.warning("Asset library file delete failed for %s: %s", deleted_path, e)
    return {"library": load_asset_library()}

def prompt_row_to_dict(row):
    data = dict(row)
    data["tags"] = json_list(data.get("tags"))
    data["favorite"] = bool(data.get("favorite"))
    return data

@app.get("/api/prompts")
def list_prompts(q: str = "", favorite: Optional[bool] = None, limit: int = 100, offset: int = 0):
    limit = max(1, min(int(limit or 100), 200))
    offset = max(0, int(offset or 0))
    clauses = []
    params = []
    if favorite is not None:
        clauses.append("favorite = ?")
        params.append(1 if favorite else 0)
    if q:
        needle = f"%{q.strip()}%"
        clauses.append("(title LIKE ? OR content LIKE ? OR tags LIKE ?)")
        params.extend([needle, needle, needle])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with ASSET_LOCK:
        with asset_db() as conn:
            rows = conn.execute(
                f"SELECT * FROM prompt_snippets {where} ORDER BY favorite DESC, updated_at DESC LIMIT ? OFFSET ?",
                [*params, limit, offset],
            ).fetchall()
    return {"items": [prompt_row_to_dict(row) for row in rows], "limit": limit, "offset": offset}

@app.post("/api/prompts")
def create_prompt(payload: PromptSnippetRequest):
    now = time.time()
    prompt_id = uuid.uuid4().hex
    with ASSET_LOCK:
        with asset_db() as conn:
            conn.execute(
                """
                INSERT INTO prompt_snippets (id, title, content, tags, favorite, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    prompt_id,
                    payload.title.strip(),
                    payload.content.strip(),
                    json.dumps(json_list(payload.tags), ensure_ascii=False),
                    1 if payload.favorite else 0,
                    now,
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM prompt_snippets WHERE id = ?", (prompt_id,)).fetchone()
    return prompt_row_to_dict(row)

@app.put("/api/prompts/{prompt_id}")
def update_prompt(prompt_id: str, payload: PromptSnippetRequest):
    now = time.time()
    with ASSET_LOCK:
        with asset_db() as conn:
            cur = conn.execute(
                """
                UPDATE prompt_snippets
                SET title = ?, content = ?, tags = ?, favorite = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.title.strip(),
                    payload.content.strip(),
                    json.dumps(json_list(payload.tags), ensure_ascii=False),
                    1 if payload.favorite else 0,
                    now,
                    prompt_id,
                ),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Prompt not found")
            row = conn.execute("SELECT * FROM prompt_snippets WHERE id = ?", (prompt_id,)).fetchone()
    return prompt_row_to_dict(row)

@app.post("/api/prompts/{prompt_id}/use")
def use_prompt(prompt_id: str):
    with ASSET_LOCK:
        with asset_db() as conn:
            cur = conn.execute(
                "UPDATE prompt_snippets SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?",
                (time.time(), prompt_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Prompt not found")
            row = conn.execute("SELECT * FROM prompt_snippets WHERE id = ?", (prompt_id,)).fetchone()
    return prompt_row_to_dict(row)

@app.delete("/api/prompts/{prompt_id}")
def delete_prompt(prompt_id: str):
    with ASSET_LOCK:
        with asset_db() as conn:
            cur = conn.execute("DELETE FROM prompt_snippets WHERE id = ?", (prompt_id,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Prompt not found")
    return {"ok": True}

@app.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    uploaded_files = []
    files_content = []
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    for file in files:
        content = await file.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)")
        files_content.append((file, content))

    client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=10)
    own_client = GLOBAL_HTTP_CLIENT is None
    try:
        for file, content in files_content:
            success_count = 0
            last_result = None
            for addr in COMFYUI_INSTANCES:
                try:
                    files_data = {'image': (file.filename, content, file.content_type)}
                    response = await client.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                    if response.status_code == 200:
                        last_result = response.json()
                        success_count += 1
                except Exception as e:
                    logger.warning("Upload error for %s: %s", addr, e)
    finally:
        if own_client:
            await client.aclose()

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}

@app.post("/api/ai/upload")
async def upload_ai_reference(files: List[UploadFile] = File(...)):
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    uploaded = []
    for file in files:
        content = await file.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)")
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
            content_type = (file.content_type or "").lower()
            ext = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".png"
        filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
        path = output_path_for(filename, "input")
        with open(path, "wb") as f:
            f.write(content)
        local_url = output_url_for(filename, "input")
        uploaded.append({"url": local_url, "name": file.filename or filename})
    return {"files": uploaded}

@app.post("/api/assets/upload")
async def upload_assets(files: List[UploadFile] = File(...)):
    max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    uploaded = []
    for file in files:
        content = await file.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)")
        if not content:
            continue
        original = os.path.basename(file.filename or "asset")
        ext = os.path.splitext(original)[1].lower()
        content_type = (file.content_type or "").lower()
        if not ext:
            if "video" in content_type:
                ext = ".mp4"
            elif "webp" in content_type:
                ext = ".webp"
            elif "jpeg" in content_type or "jpg" in content_type:
                ext = ".jpg"
            elif "gif" in content_type:
                ext = ".gif"
            else:
                ext = ".png"
        category = "output" if ext in VIDEO_EXTENSIONS else "input"
        filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
        path = output_path_for(filename, category)
        with open(path, "wb") as f:
            f.write(content)
        local_url = output_url_for(filename, category)
        item = index_local_asset(
            local_url,
            source_type="upload",
            tags=["upload"],
            created_at=time.time(),
        )
        if item:
            with ASSET_LOCK:
                with asset_db() as conn:
                    conn.execute("UPDATE assets SET title = ?, updated_at = ? WHERE id = ?", (original, time.time(), item["id"]))
                    row = conn.execute("SELECT * FROM assets WHERE id = ?", (item["id"],)).fetchone()
                    item = asset_row_to_dict(row) if row else item
        uploaded.append(item or {"local_url": local_url, "title": original, "type": asset_type_for_path(path)})
    return {"ok": True, "items": uploaded}

@app.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in CHAT_MODELS if m == "gpt-5.5"), CHAT_MODELS[0] if CHAT_MODELS else CHAT_MODEL)
    providers = [public_provider(p) for p in load_api_providers()]
    return {
        "app_version": APP_VERSION,
        "app_build_id": APP_BUILD_ID,
        "base_url": AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": IMAGE_MODEL,
        "chat_models": CHAT_MODELS,
        "image_models": IMAGE_MODELS,
        "video_models": VIDEO_MODELS,
        "api_providers": providers,
        "comfy_instances": COMFYUI_INSTANCES,
        "has_api_key": bool(AI_API_KEY),
        "ms_chat_models": MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(MODELSCOPE_API_KEY),
    }

@app.get("/api/models")
async def ai_models():
    return {"chat_models": CHAT_MODELS, "image_models": IMAGE_MODELS, "video_models": VIDEO_MODELS}

@app.get("/api/model-capabilities")
async def model_capabilities():
    providers = [public_provider(p) for p in load_api_providers()]
    by_kind = {"chat": [], "image": [], "video": []}
    for provider in providers:
        base = {
            "id": provider.get("id"),
            "name": provider.get("name"),
            "base_url": provider.get("base_url"),
            "enabled": provider.get("enabled", True),
            "has_key": provider.get("has_key", False),
        }
        for kind, key in (("chat", "chat_models"), ("image", "image_models"), ("video", "video_models")):
            models = provider.get(key) or []
            if models:
                by_kind[kind].append({**base, "models": models})
    return {
        "version": APP_VERSION,
        "build_id": APP_BUILD_ID,
        "defaults": {
            "chat": CHAT_MODEL,
            "image": IMAGE_MODEL,
            "video": VIDEO_MODELS[0] if VIDEO_MODELS else "",
        },
        "models": {
            "chat": CHAT_MODELS,
            "image": IMAGE_MODELS,
            "video": VIDEO_MODELS,
        },
        "providers": providers,
        "by_kind": by_kind,
    }

@app.get("/api/providers")
async def api_providers():
    return {"providers": [public_provider(p) for p in load_api_providers()]}

@app.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    providers = []
    env_updates = {}
    # 收集每个 item 的 primary 字段
    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    for item in payload:
        provider = normalize_provider(item.dict(exclude={"api_key"}))
        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复：{provider['id']}")
        providers.append(provider)
        if item.api_key is not None:
            env_updates[provider_key_env(provider["id"])] = item.api_key.strip()
        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
            env_updates["IMAGE_MODELS"] = ",".join(provider["image_models"])
            env_updates["CHAT_MODELS"] = ",".join(provider["chat_models"])
            env_updates["VIDEO_MODELS"] = ",".join(provider.get("video_models") or [])
        if provider["id"] == "modelscope":
            env_updates["MODELSCOPE_CHAT_MODELS"] = ",".join(provider["chat_models"])
    if not providers:
        raise HTTPException(status_code=400, detail="至少保留一个 API 平台")
    # 强制最多一个 primary（取最后被标记的；都没标记则保持原样不强制）
    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)
    save_api_providers(providers)
    if env_updates:
        update_env_values(env_updates)
        reload_env_globals()   # 立即将最新 env 值同步回模块全局变量，无需重启
    schedule_cloud_config_sync()
    return {"providers": [public_provider(p) for p in providers]}

@app.get("/api/cloud/status")
async def cloud_status(refresh: int = 0):
    session = load_cloud_session()
    if refresh and session.get("token"):
        base_url = str(session.get("base_url") or CLOUD_SYNC_BASE_URL).strip().rstrip("/")
        if base_url and re.match(r"^https?://", base_url):
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    response = await client.get(f"{base_url}/api/me", headers=cloud_auth_header(session))
                    if response.status_code == 200:
                        data = response.json()
                        session["email"] = data.get("email", session.get("email", ""))
                        session["email_verified"] = bool(data.get("email_verified"))
                        session["display_name"] = data.get("display_name", "")
                        session["avatar_url"] = data.get("avatar_url", "")
                        save_cloud_session(session)
                    elif response.status_code in (401, 403):
                        save_cloud_session({})
                        session = {}
            except Exception:
                pass  # network error: fall through to return local session
    return {
        "logged_in": bool(session.get("token")),
        "email": session.get("email", ""),
        "email_verified": bool(session.get("email_verified")),
        "display_name": session.get("display_name", ""),
        "avatar_url": session.get("avatar_url", ""),
        "base_url": session.get("base_url", CLOUD_SYNC_BASE_URL),
        "custom_cloud": bool(session.get("custom_cloud")),
        "updated_at": session.get("updated_at", 0),
    }

def cloud_requested_base_url(base_url: str = ""):
    requested_base_url = (base_url or "").strip().rstrip("/")
    custom_cloud = bool(requested_base_url)
    resolved_base_url = (requested_base_url or CLOUD_SYNC_BASE_URL).strip().rstrip("/")
    if not re.match(r"^https?://", resolved_base_url):
        raise HTTPException(status_code=400, detail="云端服务地址未配置，请在后端设置 CLOUD_SYNC_BASE_URL")
    return resolved_base_url, custom_cloud

async def cloud_auth(action: str, payload: CloudAuthRequest):
    base_url, custom_cloud = cloud_requested_base_url(payload.base_url)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/auth/{action}",
                json={"email": payload.email.strip().lower(), "password": payload.password},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "云端认证失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    token = data.get("token")
    if not token:
        raise HTTPException(status_code=502, detail="云端没有返回登录 token")
    session = {
        "base_url": base_url,
        "email": data.get("email") or payload.email.strip().lower(),
        "email_verified": bool(data.get("email_verified")),
        "display_name": data.get("display_name", ""),
        "avatar_url": data.get("avatar_url", ""),
        "token": token,
        "custom_cloud": custom_cloud,
        "updated_at": now_ms(),
    }
    save_cloud_session(session)
    config_sync = await try_apply_cloud_config_from_account(session)
    if config_sync.get("downloaded") and config_sync.get("cloud_updated_at"):
        session["updated_at"] = config_sync.get("cloud_updated_at")
        save_cloud_session(session)
    elif config_sync.get("missing"):
        reset_local_cloud_synced_config()
    return {
        "logged_in": True,
        "email": session["email"],
        "email_verified": session.get("email_verified", False),
        "display_name": session.get("display_name", ""),
        "avatar_url": session.get("avatar_url", ""),
        "base_url": base_url,
        "custom_cloud": custom_cloud,
        "updated_at": session.get("updated_at", 0),
        "config_sync": config_sync,
    }

@app.post("/api/cloud/register")
async def cloud_register(payload: CloudAuthRequest):
    return await cloud_auth("register", payload)

@app.post("/api/cloud/login")
async def cloud_login(payload: CloudAuthRequest):
    return await cloud_auth("login", payload)

@app.post("/api/cloud/password/forgot")
async def cloud_forgot_password(payload: CloudPasswordForgotRequest):
    base_url, custom_cloud = cloud_requested_base_url(payload.base_url)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/auth/password/forgot",
                json={"email": payload.email.strip().lower()},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "发送重置邮件失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    return {**data, "base_url": base_url, "custom_cloud": custom_cloud}

@app.post("/api/cloud/password/reset")
async def cloud_reset_password(payload: CloudPasswordResetRequest):
    base_url, custom_cloud = cloud_requested_base_url(payload.base_url)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/auth/password/reset",
                json={
                    "email": payload.email.strip().lower(),
                    "token": payload.token.strip(),
                    "new_password": payload.new_password,
                },
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "重置密码失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    return {**data, "base_url": base_url, "custom_cloud": custom_cloud}

@app.post("/api/cloud/email/verify/request")
async def cloud_request_email_verify():
    session = load_cloud_session()
    cloud_auth_header(session)
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            profile_response = await client.get(f"{base_url}/api/me", headers=cloud_auth_header(session))
            profile_response.raise_for_status()
            profile = profile_response.json()
            session["email"] = profile.get("email", session.get("email", ""))
            session["email_verified"] = bool(profile.get("email_verified"))
            session["display_name"] = profile.get("display_name", session.get("display_name", ""))
            session["avatar_url"] = profile.get("avatar_url", session.get("avatar_url", ""))
            save_cloud_session(session)
            if session["email_verified"]:
                return {"ok": True, "email_sent": False, "already_verified": True}
            response = await client.post(
                f"{base_url}/api/auth/email/verify/request",
                json={"email": session.get("email", "")},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "发送验证邮件失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    return data

@app.post("/api/cloud/email/verify/confirm")
async def cloud_confirm_email_verify(payload: CloudEmailVerifyConfirmRequest):
    session = load_cloud_session()
    cloud_auth_header(session)
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/auth/email/verify/confirm",
                json={"email": session.get("email", ""), "token": payload.token.strip()},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "验证邮箱失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    session["email_verified"] = True
    save_cloud_session(session)
    return data

@app.post("/api/cloud/logout")
async def cloud_logout():
    save_cloud_session({})
    reset_result = reset_local_cloud_synced_config()
    return {"ok": True, "local_config_cleared": True, "reset": reset_result}

@app.get("/api/cloud/profile")
async def cloud_profile():
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(f"{base_url}/api/me", headers=cloud_auth_header(session))
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "读取账户资料失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    session["email"] = data.get("email", session.get("email", ""))
    session["email_verified"] = bool(data.get("email_verified"))
    session["display_name"] = data.get("display_name", "")
    session["avatar_url"] = data.get("avatar_url", "")
    save_cloud_session(session)
    return {**data, "base_url": base_url}

@app.put("/api/cloud/profile")
async def cloud_save_profile(payload: CloudProfileRequest):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.put(
                f"{base_url}/api/me",
                headers=cloud_auth_header(session),
                json=payload.dict(),
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "保存账户资料失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    session["email"] = data.get("email", session.get("email", ""))
    session["email_verified"] = bool(data.get("email_verified"))
    session["display_name"] = data.get("display_name", "")
    session["avatar_url"] = data.get("avatar_url", "")
    save_cloud_session(session)
    return data

@app.post("/api/cloud/profile/avatar")
async def cloud_upload_avatar(file: UploadFile = File(...)):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    content = await file.read(CLOUD_AVATAR_MAX_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="请选择头像文件")
    if len(content) > CLOUD_AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="头像文件不能超过 5MB")
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/me/avatar",
                headers=cloud_auth_header(session),
                files={"file": (file.filename or "avatar", content, file.content_type or "application/octet-stream")},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "上传头像失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    session["email"] = data.get("email", session.get("email", ""))
    session["email_verified"] = bool(data.get("email_verified"))
    session["display_name"] = data.get("display_name", session.get("display_name", ""))
    session["avatar_url"] = data.get("avatar_url", "")
    save_cloud_session(session)
    return data

@app.post("/api/cloud/password")
async def cloud_change_password(payload: CloudPasswordRequest):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.post(
                f"{base_url}/api/me/password",
                headers=cloud_auth_header(session),
                json=payload.dict(),
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "修改密码失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc

@app.post("/api/cloud/upload")
async def cloud_upload(payload: CloudUploadRequest):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    config = build_cloud_config(include_secrets=True)
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.put(
                f"{base_url}/api/configs/current",
                headers=cloud_auth_header(session),
                json={"config": config},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "上传云端配置失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    session["updated_at"] = now_ms()
    save_cloud_session(session)
    return {"ok": True, "cloud": data}

@app.post("/api/cloud/download")
async def cloud_download():
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.get(
                f"{base_url}/api/configs/current",
                headers=cloud_auth_header(session),
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "下载云端配置失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接云端服务：{exc}") from exc
    config = data.get("config")
    if not config:
        raise HTTPException(status_code=404, detail="云端还没有保存配置")
    applied = apply_cloud_config(config)
    return {"ok": True, "cloud_updated_at": data.get("updated_at", 0), "applied": applied}


def local_media_assets(limit: int = 5000):
    with ASSET_LOCK:
        with asset_db() as conn:
            rows = conn.execute(
                """
                SELECT * FROM assets
                WHERE type IN ('image', 'video') AND COALESCE(sha256, '') != ''
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (max(1, min(int(limit or 5000), 5000)),),
            ).fetchall()
    items = []
    for row in rows:
        item = asset_row_to_dict(row)
        if item.get("local_path") and os.path.isfile(item["local_path"]):
            items.append(item)
    return items


def cloud_restore_extension(item: dict, content_type: str = "") -> str:
    title_ext = os.path.splitext(str(item.get("title") or ""))[1].lower()
    if re.match(r"^\.[a-z0-9]{1,12}$", title_ext):
        return title_ext
    object_ext = os.path.splitext(str(item.get("object_key") or ""))[1].lower()
    if re.match(r"^\.[a-z0-9]{1,12}$", object_ext):
        return object_ext
    ct = (content_type or item.get("content_type") or "").split(";", 1)[0].strip().lower()
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
    }.get(ct, ".bin")


def local_media_hash_index():
    with ASSET_LOCK:
        with asset_db() as conn:
            rows = conn.execute("SELECT id, sha256, local_path FROM assets WHERE COALESCE(sha256, '') != ''").fetchall()
    index = {}
    for row in rows:
        sha = row["sha256"]
        if not sha:
            continue
        path = row["local_path"] or ""
        index[sha] = {"id": row["id"], "local_path": path, "exists": bool(path and os.path.isfile(path))}
    return index


def deleted_media_hashes():
    with ASSET_LOCK:
        with asset_db() as conn:
            rows = conn.execute("SELECT sha256 FROM asset_deletions").fetchall()
    return {row["sha256"] for row in rows if row["sha256"]}


def index_restored_cloud_asset(item: dict, path: str, local_url: str):
    digest = file_sha256(path)
    expected = str(item.get("sha256") or "").lower()
    if expected and digest != expected:
        try:
            os.remove(path)
        except OSError:
            pass
        raise HTTPException(status_code=502, detail=f"云素材校验失败：{item.get('title') or expected[:12]}")
    asset_id = digest[:20]
    kind = asset_type_for_path(path)
    width, height = image_dimensions(path) if kind == "image" else (0, 0)
    thumb_url = make_asset_thumbnail(asset_id, path)
    now = time.time()
    remote_created = float(item.get("created_at") or item.get("updated_at") or 0)
    created = remote_created / 1000 if remote_created > 100000000000 else (remote_created or now)
    title = str(item.get("title") or os.path.basename(path))[:300]
    tags = json.dumps(["cloud"], ensure_ascii=False)
    with ASSET_LOCK:
        with asset_db() as conn:
            conn.execute(
                """
                INSERT INTO assets (
                    id, title, type, local_url, local_path, thumb_url, source_url, source_type,
                    prompt, model, width, height, tags, favorite, sha256, size_bytes, created_at, updated_at,
                    cloud_key, cloud_url, cloud_synced_at, cloud_error
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, '')
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    type=excluded.type,
                    local_url=excluded.local_url,
                    local_path=excluded.local_path,
                    thumb_url=COALESCE(NULLIF(excluded.thumb_url, ''), assets.thumb_url),
                    source_url=excluded.source_url,
                    source_type=excluded.source_type,
                    prompt=excluded.prompt,
                    model=excluded.model,
                    width=excluded.width,
                    height=excluded.height,
                    tags=CASE WHEN assets.tags IS NULL OR assets.tags = '[]' THEN excluded.tags ELSE assets.tags END,
                    sha256=excluded.sha256,
                    size_bytes=excluded.size_bytes,
                    updated_at=excluded.updated_at,
                    cloud_key=excluded.cloud_key,
                    cloud_url=excluded.cloud_url,
                    cloud_synced_at=excluded.cloud_synced_at,
                    cloud_error=''
                """,
                (
                    asset_id, title, kind, local_url, path, thumb_url, str(item.get("cloud_url") or ""),
                    str(item.get("source_type") or "cloud-restore"), str(item.get("prompt") or ""),
                    str(item.get("model") or ""), width, height, tags, digest, os.path.getsize(path),
                    created, now, str(item.get("object_key") or ""), str(item.get("cloud_url") or ""), now,
                ),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    return asset_row_to_dict(row) if row else None


def local_media_summary():
    items = local_media_assets()
    summary = {
        "count": len(items),
        "size_bytes": 0,
        "synced": 0,
        "pending": 0,
        "failed": 0,
        "last_synced_at": 0,
        "by_type": {},
    }
    for item in items:
        size = int(item.get("size_bytes") or 0)
        kind = item.get("type") or "file"
        summary["size_bytes"] += size
        bucket = summary["by_type"].setdefault(kind, {"count": 0, "size_bytes": 0})
        bucket["count"] += 1
        bucket["size_bytes"] += size
        synced_at = float(item.get("cloud_synced_at") or 0)
        error = (item.get("cloud_error") or "").strip()
        if error:
            summary["failed"] += 1
        elif synced_at > 0:
            summary["synced"] += 1
            summary["last_synced_at"] = max(summary["last_synced_at"], synced_at)
        else:
            summary["pending"] += 1
    return summary


async def cloud_media_remote_status(client, base_url: str, session: dict):
    response = await client.get(f"{base_url}/api/media/status", headers=cloud_auth_header(session))
    response.raise_for_status()
    return response.json()


async def cloud_media_remote_list(client, base_url: str, session: dict, limit: int = 5000):
    response = await client.get(
        f"{base_url}/api/media/list",
        headers=cloud_auth_header(session),
        params={"limit": max(1, min(int(limit or 5000), 5000)), "offset": 0},
    )
    response.raise_for_status()
    return response.json()


@app.get("/api/cloud/media/status")
async def cloud_media_status():
    local = local_media_summary()
    session = load_cloud_session()
    if not session.get("token"):
        return {
            "ok": True,
            "logged_in": False,
            "local": local,
            "remote": None,
            "sync": {
                "running": bool(CLOUD_MEDIA_SYNC_TASK and not CLOUD_MEDIA_SYNC_TASK.done()),
                "last_result": CLOUD_MEDIA_LAST_RESULT,
            },
        }
    base_url = cloud_base_url(session)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            remote = await cloud_media_remote_status(client, base_url, session)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"读取云素材状态失败：{exc}") from exc
    return {
        "ok": True,
        "logged_in": True,
        "local": local,
        "remote": remote,
        "sync": {
            "running": bool(CLOUD_MEDIA_SYNC_TASK and not CLOUD_MEDIA_SYNC_TASK.done()),
            "last_result": CLOUD_MEDIA_LAST_RESULT,
        },
    }


@app.post("/api/cloud/media/restore")
async def cloud_media_restore(payload: CloudMediaRestoreRequest):
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    restored, skipped, failed = [], [], []
    skipped_deleted = []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20, read=180, write=180, pool=20), follow_redirects=True) as client:
            remote_data = await cloud_media_remote_list(client, base_url, session, payload.limit)
            remote_items = remote_data.get("items") or []
            local_index = local_media_hash_index()
            deleted_hashes = set() if payload.include_deleted else deleted_media_hashes()
            os.makedirs(OUTPUT_OUTPUT_DIR, exist_ok=True)
            for item in remote_items:
                sha = str(item.get("sha256") or "").lower()
                if not re.match(r"^[a-f0-9]{64}$", sha):
                    continue
                if sha in deleted_hashes:
                    skipped_deleted.append(sha)
                    continue
                local = local_index.get(sha) or {}
                if payload.missing_only and local.get("exists"):
                    skipped.append(sha)
                    continue
                try:
                    response = await client.get(f"{base_url}/api/media/download/{sha}", headers=cloud_auth_header(session))
                    response.raise_for_status()
                    ext = cloud_restore_extension(item, response.headers.get("content-type", ""))
                    filename = f"cloud_{sha[:20]}{ext}"
                    path = output_path_for(filename, "output")
                    local_url = output_url_for(filename, "output")
                    with open(path, "wb") as fh:
                        fh.write(response.content)
                    restored_item = index_restored_cloud_asset(item, path, local_url)
                    if restored_item:
                        restored.append(restored_item)
                    else:
                        failed.append({"sha256": sha, "title": item.get("title"), "error": "index failed"})
                except Exception as exc:
                    failed.append({"sha256": sha, "title": item.get("title"), "error": str(exc)})
            remote_status = await cloud_media_remote_status(client, base_url, session)
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "云素材恢复失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"云素材恢复请求失败：{exc}") from exc
    return {
        "ok": True,
        "remote_count": len(remote_items),
        "restored": len(restored),
        "skipped": len(skipped),
        "skipped_deleted": len(skipped_deleted),
        "failed": failed,
        "failed_count": len(failed),
        "remote": remote_status,
    }


@app.post("/api/cloud/media/sync")
async def cloud_media_sync(payload: CloudMediaSyncRequest):
    global CLOUD_MEDIA_LAST_RESULT
    session = load_cloud_session()
    base_url = cloud_base_url(session)
    items = local_media_assets(payload.limit)
    hashes = [item["sha256"] for item in items if item.get("sha256")]
    uploaded, skipped, failed = [], [], []
    deleted_remote = 0
    remote_items = {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=20, read=180, write=180, pool=20), follow_redirects=True) as client:
            for i in range(0, len(hashes), 400):
                response = await client.post(f"{base_url}/api/media/exists", headers=cloud_auth_header(session), json={"hashes": hashes[i:i + 400]})
                response.raise_for_status()
                remote_items.update(response.json().get("items") or {})

            for item in items:
                sha = item.get("sha256") or ""
                local_error = item.get("cloud_error") or ""
                if payload.missing_only and sha in remote_items and not (payload.retry_failed and local_error):
                    skipped.append(item["id"])
                    remote = remote_items.get(sha) or {}
                    with ASSET_LOCK:
                        with asset_db() as conn:
                            conn.execute(
                                "UPDATE assets SET cloud_key = ?, cloud_url = ?, cloud_synced_at = ?, cloud_error = '' WHERE id = ?",
                                (remote.get("object_key", ""), remote.get("cloud_url", ""), time.time(), item["id"]),
                            )
                    continue
                path = item.get("local_path")
                if not path or not os.path.isfile(path):
                    failed.append({"id": item.get("id"), "title": item.get("title"), "error": "local file missing"})
                    with ASSET_LOCK:
                        with asset_db() as conn:
                            conn.execute("UPDATE assets SET cloud_error = ? WHERE id = ?", ("local file missing", item["id"]))
                    continue
                metadata = {
                    "id": item.get("id"),
                    "title": item.get("title") or os.path.basename(path),
                    "type": item.get("type") or asset_type_for_path(path),
                    "content_type": content_type_for_path(path),
                    "width": item.get("width") or 0,
                    "height": item.get("height") or 0,
                    "source_type": item.get("source_type") or "",
                    "prompt": item.get("prompt") or "",
                    "model": item.get("model") or "",
                }
                try:
                    with open(path, "rb") as fh:
                        response = await client.post(
                            f"{base_url}/api/media/upload",
                            headers=cloud_auth_header(session),
                            data={"metadata": json.dumps(metadata, ensure_ascii=False)},
                            files={"file": (os.path.basename(path), fh, content_type_for_path(path))},
                        )
                    response.raise_for_status()
                    data = response.json()
                    remote = data.get("item") or {}
                    with ASSET_LOCK:
                        with asset_db() as conn:
                            conn.execute(
                                "UPDATE assets SET cloud_key = ?, cloud_url = ?, cloud_synced_at = ?, cloud_error = '' WHERE id = ?",
                                (remote.get("object_key", ""), remote.get("cloud_url", ""), time.time(), item["id"]),
                            )
                    (skipped if data.get("skipped") else uploaded).append(item["id"])
                except Exception as exc:
                    err = str(exc)
                    failed.append({"id": item.get("id"), "title": item.get("title"), "error": err})
                    with ASSET_LOCK:
                        with asset_db() as conn:
                            conn.execute("UPDATE assets SET cloud_error = ? WHERE id = ?", (err[:1000], item["id"]))

            if payload.delete_remote_missing:
                response = await client.post(f"{base_url}/api/media/prune", headers=cloud_auth_header(session), json={"keep_hashes": hashes, "confirm": True})
                response.raise_for_status()
                deleted_remote = int(response.json().get("deleted") or 0)
            remote_status = await cloud_media_remote_status(client, base_url, session)
    except httpx.HTTPStatusError as exc:
        try:
            detail = exc.response.json().get("detail")
        except Exception:
            detail = exc.response.text
        raise HTTPException(status_code=exc.response.status_code, detail=detail or "云素材同步失败") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"云素材同步请求失败：{exc}") from exc
    result = {
        "ok": True,
        "local_count": len(items),
        "uploaded": len(uploaded),
        "skipped": len(skipped),
        "failed": failed,
        "failed_count": len(failed),
        "deleted_remote": deleted_remote,
        "remote": remote_status,
        "finished_at": time.time(),
    }
    CLOUD_MEDIA_LAST_RESULT = {
        "uploaded": result["uploaded"],
        "skipped": result["skipped"],
        "failed_count": result["failed_count"],
        "deleted_remote": deleted_remote,
        "finished_at": result["finished_at"],
    }
    return result


async def run_cloud_media_auto_sync(delay: float = 4.0):
    global CLOUD_MEDIA_SYNC_TASK
    try:
        await asyncio.sleep(delay)
        session = load_cloud_session()
        if not session.get("token"):
            return
        await cloud_media_sync(CloudMediaSyncRequest(missing_only=True, retry_failed=False, delete_remote_missing=False, limit=5000))
    except HTTPException as exc:
        logger.info("Auto cloud media sync skipped: %s", exc.detail)
    except Exception as exc:
        logger.warning("Auto cloud media sync failed: %s", exc)
    finally:
        CLOUD_MEDIA_SYNC_TASK = None


async def _cloud_media_periodic_sync():
    while True:
        await asyncio.sleep(600)
        try:
            session = load_cloud_session()
            if not session.get("token"):
                continue
            if CLOUD_MEDIA_SYNC_TASK and not CLOUD_MEDIA_SYNC_TASK.done():
                continue
            await cloud_media_sync(CloudMediaSyncRequest(missing_only=True, retry_failed=True, delete_remote_missing=False, limit=5000))
        except asyncio.CancelledError:
            raise
        except HTTPException as exc:
            logger.info("Periodic cloud media sync skipped: %s", exc.detail)
        except Exception as exc:
            logger.warning("Periodic cloud media sync failed: %s", exc)


def schedule_cloud_media_sync():
    global CLOUD_MEDIA_SYNC_TASK
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if CLOUD_MEDIA_SYNC_TASK and not CLOUD_MEDIA_SYNC_TASK.done():
        return
    CLOUD_MEDIA_SYNC_TASK = loop.create_task(run_cloud_media_auto_sync())

# --- ModelScope Token (从 env 读取，不再支持通过 UI 修改) ---

@app.get("/api/config/token")
async def get_global_token():
    # 优先读 env，回退到 global_config.json（兼容旧数据）
    if MODELSCOPE_API_KEY:
        return {"token": mask_secret(MODELSCOPE_API_KEY)}
    if os.path.exists(GLOBAL_CONFIG_FILE):
        try:
            with open(GLOBAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return {"token": mask_secret(config.get("modelscope_token", ""))}
        except Exception:
            pass
    return {"token": ""}

# --- 在线生图 (COMFLY) ---

class TestConnectionPayload(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider_id: str = ""

@app.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    """测试请求地址是否可用：调上游 /v1/models。验证通过时同时把模型清单按类别返回，避免再调一次拉取接口。"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")
    api_key = (payload.api_key or "").strip()
    if not api_key and payload.provider_id:
        api_key = os.getenv(provider_key_env(payload.provider_id), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
        if resp.status_code >= 400:
            return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}
        data = resp.json() if resp.text else {}
        items = (data.get("data") if isinstance(data, dict) else None) or []
        # 抽取模型 id
        ids = []
        for it in items:
            if isinstance(it, str):
                ids.append(it)
            elif isinstance(it, dict):
                mid = it.get("id") or it.get("name") or it.get("model")
                if mid:
                    ids.append(str(mid))
        ids = sorted(set(ids))
        # 关键字分类
        grouped = {"image": [], "chat": [], "video": []}
        for mid in ids:
            grouped[classify_model_id(mid)].append(mid)
        return {"ok": True, "status": resp.status_code, "model_count": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}
    except httpx.HTTPError as e:
        return {"ok": False, "status": 0, "message": str(e)[:300]}

@app.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    """验证异步协议：用假 task_id 请求 GET /v1/tasks/{fake_id}。
    收到 400 Invalid task ID = 端点存在且 Key 有效；401/403 = Key 无效；404/连接失败 = 不支持异步端点。"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")
    api_key = (payload.api_key or "").strip()
    if not api_key and payload.provider_id:
        api_key = os.getenv(provider_key_env(payload.provider_id), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")
    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]
        sc = resp.status_code
        # 判断结果
        err_msg = ""
        if isinstance(body, dict):
            err = body.get("error") or {}
            if isinstance(err, dict):
                err_msg = str(err.get("message") or "").lower()
            else:
                err_msg = str(err).lower()
        # 400 + "invalid task id" → 端点存在，Key 有效
        if sc == 400 and "invalid task id" in err_msg:
            return {"ok": True, "status_code": sc, "message": "异步任务端点可用，API Key 已通过认证", "raw": body}
        # 401 / 403 → Key 无效
        if sc in (401, 403):
            return {"ok": False, "status_code": sc, "message": "API Key 无效或无权限", "raw": body}
        # 404 + 没有结构化错误 → 平台不支持此端点
        if sc == 404:
            return {"ok": False, "status_code": sc, "message": "平台不支持 /v1/tasks/ 端点，可能不是 APIMart 异步协议", "raw": body}
        # 其他 400 系 → 返回原始信息供参考
        if 400 <= sc < 500:
            return {"ok": None, "status_code": sc, "message": f"端点返回 {sc}，请查看原始响应判断", "raw": body}
        # 2xx → 意外成功（不太可能）
        if sc < 300:
            return {"ok": True, "status_code": sc, "message": f"端点返回 {sc}（意外成功）", "raw": body}
        return {"ok": False, "status_code": sc, "message": f"服务端错误 {sc}", "raw": body}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])

@app.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    """从上游 OpenAI 兼容接口拉取 /v1/models 列表，按名称智能分类为 image/chat/video。"""
    provider = get_api_provider(provider_id)
    base_url = (provider.get("base_url") or "").rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 Base URL")
    api_key = os.getenv(provider_key_env(provider["id"]), "")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    url = f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=f"上游 /v1/models 失败：{resp.text[:300]}")
            raw = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败：{e}")
    # 兼容多种返回结构：{data:[{id:...},...]} 或 {models:[...]}
    items = raw.get("data") if isinstance(raw, dict) else None
    if not items and isinstance(raw, dict):
        items = raw.get("models") or raw.get("list") or []
    if not isinstance(items, list):
        items = []
    ids = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                ids.append(str(mid))
    ids = sorted(set(ids))
    # 分类规则（按关键字）
    grouped = {"image": [], "chat": [], "video": []}
    for mid in ids:
        grouped[classify_model_id(mid)].append(mid)
    return {"total": len(ids), "image_models": grouped["image"], "chat_models": grouped["chat"], "video_models": grouped["video"], "all": ids}

async def build_online_image_result(payload: OnlineImageRequest, history_type: str = "online", prefix: str = "online_"):
    provider = get_api_provider(payload.provider_id)
    default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
    model = selected_model(payload.model, default_model)
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    try:
        image_data, raw = await generate_ai_image(payload.prompt, payload.size, payload.quality, model, refs, provider["id"])
        local_url = await save_ai_image_to_output(image_data, prefix=prefix)
    except httpx.HTTPStatusError as exc:
        text = exc.response.text or ''
        # 把上游英文错误转成中文友好提示
        friendly = None
        m = re.search(r"longest edge must be less than or equal to (\d+)", text)
        if m:
            limit = m.group(1)
            friendly = f"该模型不支持当前分辨率：最长边超过 {limit}px。请把图片分辨率调低（例如换到 2K 或更小），或更换支持高分辨率的模型。"
        elif "Invalid size" in text or "invalid_value" in text:
            friendly = f"该模型不支持当前尺寸：{payload.size}。请尝试更换分辨率或模型。"
        elif "rate limit" in text.lower() or "429" in text:
            friendly = "请求过于频繁，已被上游限流，请稍后再试。"
        elif "Unauthorized" in text or "401" in text:
            friendly = "API Key 无效或已过期，请到「API 设置」检查 Key。"
        elif "model_not_found" in text or "channel not found" in text:
            friendly = f"上游平台找不到模型「{model}」可用通道。可能该模型未在此账号开通，请换一个已开通的模型。"
        detail = friendly or f"上游生图接口错误：{text[:300]}"
        raise HTTPException(status_code=exc.response.status_code, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc

    result = {
        "prompt": payload.prompt,
        "images": [local_url],
        "timestamp": time.time(),
        "type": history_type,
        "model": model,
        "provider_id": provider["id"],
        "provider_name": provider.get("name") or provider["id"],
        "task_id": extract_task_id(raw) if isinstance(raw, dict) else None,
        "request_id": raw.get("id") if isinstance(raw, dict) else None,
        "params": {"provider_id": provider["id"], "model": model, "size": payload.size, "quality": payload.quality, "reference_images": refs},
        "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
    }
    save_to_history(result)
    await manager.broadcast_new_image(result)
    return result

@app.post("/api/online-image")
async def online_image(payload: OnlineImageRequest):
    return await build_online_image_result(payload)

@app.post("/api/ai-enhance")
async def ai_enhance(payload: AIEnhanceRequest):
    return await build_online_image_result(payload, history_type="enhance", prefix="enhance_")

async def run_canvas_image_task(task_id: str, payload: OnlineImageRequest):
    with CANVAS_TASK_LOCK:
        if task_id in CANVAS_TASKS:
            CANVAS_TASKS[task_id]["status"] = "running"
            CANVAS_TASKS[task_id]["updated_at"] = time.time()
    try:
        result = await build_online_image_result(payload)
        with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id].update({
                "status": "succeeded",
                "result": result,
                "error": "",
                "updated_at": time.time(),
            })
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        with CANVAS_TASK_LOCK:
            CANVAS_TASKS[task_id].update({
                "status": "failed",
                "error": str(detail),
                "status_code": status_code,
                "updated_at": time.time(),
            })

@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: OnlineImageRequest):
    task_id = f"canvas_img_{uuid.uuid4().hex}"
    with CANVAS_TASK_LOCK:
        CANVAS_TASKS[task_id] = {
            "id": task_id,
            "type": "online-image",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
        }
    asyncio.create_task(run_canvas_image_task(task_id, payload))
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    with CANVAS_TASK_LOCK:
        task = dict(CANVAS_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在，可能服务已重启或任务已过期")
    return task

# --- Canvas Video ---

def video_output_urls(raw):
    data = raw.get("data") if isinstance(raw, dict) else {}
    if isinstance(data, list) and data:
        data = data[0] if isinstance(data[0], dict) else {}
    if not isinstance(data, dict):
        data = {}
    urls = []
    result = data.get("result") if isinstance(data.get("result"), dict) else raw.get("result") if isinstance(raw, dict) and isinstance(raw.get("result"), dict) else {}
    output = data.get("output") or raw.get("output")
    outputs = data.get("outputs") or raw.get("outputs") or []
    videos = result.get("videos") or data.get("videos") or raw.get("videos") or []
    if isinstance(output, str) and output:
        urls.append(output)
    if isinstance(outputs, list):
        for item in outputs:
            if isinstance(item, str) and item:
                urls.append(item)
            elif isinstance(item, dict):
                value = item.get("url") or item.get("output")
                if value:
                    urls.extend(value if isinstance(value, list) else [value])
    if isinstance(videos, list):
        for item in videos:
            if isinstance(item, str) and item:
                urls.append(item)
            elif isinstance(item, dict):
                value = item.get("url") or item.get("video_url") or item.get("output")
                if value:
                    urls.extend(value if isinstance(value, list) else [value])
    elif isinstance(videos, str) and videos:
        urls.append(videos)
    deduped = []
    for url in urls:
        if isinstance(url, str) and url and url not in deduped:
            deduped.append(url)
    return deduped

def video_api_root(provider):
    base_url = (provider.get("base_url") or AI_BASE_URL).rstrip("/")
    if base_url.endswith("/v1") or base_url.endswith("/v2"):
        base_url = base_url.rsplit("/", 1)[0]
    return base_url

async def wait_for_video_task(client, provider, task_id):
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    if is_apimart_provider(provider):
        task_path = f"{base_url}/tasks/{task_id}" if base_url.endswith("/v1") else f"{base_url}/v1/tasks/{task_id}"
        task_url = f"{task_path}?language=zh"
    else:
        task_url = f"{base_url}/v2/videos/generations/{task_id}"
    deadline = time.monotonic() + VIDEO_POLL_TIMEOUT
    delay = max(2.0, IMAGE_POLL_INTERVAL)
    last_payload = {}
    while time.monotonic() < deadline:
        await asyncio.sleep(delay)
        response = await client.get(task_url, headers=api_headers(provider=provider))
        response.raise_for_status()
        raw = response.json()
        last_payload = raw
        task_data = raw.get("data") if isinstance(raw.get("data"), dict) else raw
        status = str(task_data.get("status") or raw.get("status") or "").upper()
        if status in {"SUCCESS", "COMPLETED"}:
            return raw
        if status in {"FAILURE", "FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT"}:
            error = task_data.get("error") if isinstance(task_data.get("error"), dict) else {}
            reason = task_data.get("fail_reason") or error.get("message") or raw.get("error") or raw.get("message") or str(raw)
            raise HTTPException(status_code=502, detail=f"视频生成任务失败：{reason}")
        delay = min(delay * 1.6, 12)
    raise HTTPException(status_code=504, detail=f"视频生成任务超时：{last_payload or task_id}")

def apimart_video_size(size):
    value = str(size or "16:9").strip()
    if value == "keep_ratio":
        return "adaptive"
    allowed = {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"}
    return value if value in allowed else "16:9"

@app.post("/api/canvas-video")
async def canvas_video(payload: CanvasVideoRequest):
    provider = get_api_provider(payload.provider_id)
    base_url = video_api_root(provider)
    if not base_url:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider['id']} 未配置 Base URL")
    api_key = os.getenv(provider_key_env(provider["id"]), "")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"未配置 {provider.get('name') or provider['id']} 的 API Key，请在 API 设置中填写。")
    is_apimart = is_apimart_provider(provider)
    submit_url = f"{base_url}/videos/generations" if is_apimart and base_url.endswith("/v1") else f"{base_url}/v1/videos/generations" if is_apimart else f"{base_url}/v2/videos/generations"
    try:
        async with httpx.AsyncClient(timeout=VIDEO_POLL_TIMEOUT) as client:
            # --- 构造图片载荷 ---
            if is_apimart:
                image_with_roles = []
                invalid_images = []
                requested_model = selected_model(payload.model, "doubao-seedance-2.0")
                is_veo31 = is_apimart_veo31_model(requested_model)
                apimart_model = apimart_veo31_model(requested_model) if is_veo31 else ""
                if apimart_model == "veo3.1-lite" and payload.images:
                    raise HTTPException(status_code=400, detail="veo3.1-lite 不支持图片输入，请改用 veo3.1-fast 或 veo3.1-quality。")
                image_limit = 0 if apimart_model == "veo3.1-lite" else (3 if is_veo31 else 9)
                for ref in payload.images[:image_limit]:
                    if not ref.url:
                        continue
                    role = str(ref.role or "").strip()
                    if not is_veo31 and role in {"first_frame", "last_frame", "reference_image"}:
                        up_url = await upload_image_for_apimart(client, provider, ref.url)
                        if valid_apimart_video_image_input(up_url):
                            image_with_roles.append({"url": up_url, "role": role})
                        else:
                            invalid_images.append(ref.url)
                image_payload = []
                if not image_with_roles:
                    for ref in payload.images[:image_limit]:
                        if not ref.url:
                            continue
                        up_url = await upload_image_for_apimart(client, provider, ref.url)
                        if valid_apimart_video_image_input(up_url):
                            image_payload.append(up_url)
                        else:
                            invalid_images.append(ref.url)
                if payload.images and not image_with_roles and not image_payload:
                    sample = invalid_video_image_preview(invalid_images[0] if invalid_images else "")
                    raise HTTPException(status_code=400, detail=f"输入图片无法转换为视频接口支持的格式：{sample}。请确认本地文件存在，且图片不超过 10MB；VEO3.1 需要先上传为 APIMart 可访问的 http/https 或 asset:// 图片。")
                if is_veo31:
                    model = apimart_model
                    body = {
                        "prompt": payload.prompt,
                        "model": model,
                        "duration": 8,
                        "aspect_ratio": apimart_veo31_aspect(payload.aspect_ratio),
                        "resolution": apimart_veo31_resolution(payload.resolution),
                    }
                    if image_payload and model != "veo3.1-lite":
                        video_images = image_payload[:3]
                        if model == "veo3.1-quality" and len(video_images) > 2:
                            video_images = video_images[:2]
                        body["image_urls"] = video_images
                        if len(video_images) == 2:
                            body["generation_type"] = "frame"
                        elif len(video_images) >= 3 and model != "veo3.1-quality":
                            body["generation_type"] = "reference"
                    if model != "veo3.1-lite":
                        body["official_fallback"] = False
                else:
                    body = {
                        "prompt": payload.prompt,
                        "model": requested_model,
                        "duration": payload.duration,
                        "size": apimart_video_size(payload.aspect_ratio or payload.size),
                        "resolution": payload.resolution or "480p",
                    }
                    if image_with_roles:
                        body["image_with_roles"] = image_with_roles
                    elif image_payload:
                        body["image_urls"] = image_payload[:9]
                    if payload.videos:
                        body["video_urls"] = [v for v in payload.videos if v][:3]
                    if payload.seed is not None:
                        body["seed"] = payload.seed
                    if payload.return_last_frame:
                        body["return_last_frame"] = True
                    if payload.generate_audio:
                        body["generate_audio"] = True
            else:
                # 非 APIMart：data URL 方式（OpenAI / ComflyAI 接口）
                image_payload = []
                for ref in payload.images[:4]:
                    if ref.url:
                        image_payload.append(reference_to_data_url(ref.dict(), max_size=1536))
                body = {
                    "prompt": payload.prompt,
                    "model": selected_model(payload.model, "veo3-fast"),
                    "duration": payload.duration,
                    "watermark": payload.watermark,
                }
                if payload.aspect_ratio:
                    body["aspect_ratio"] = payload.aspect_ratio
                    body["ratio"] = payload.aspect_ratio
                if payload.size:
                    body["size"] = payload.size
                if payload.resolution:
                    body["resolution"] = payload.resolution
                if image_payload:
                    body["images"] = image_payload
                if payload.videos:
                    body["videos"] = [v for v in payload.videos if v]
                if payload.enhance_prompt:
                    body["enhance_prompt"] = True
                if payload.enable_upsample:
                    body["enable_upsample"] = True
                if payload.seed is not None:
                    body["seed"] = payload.seed
                if payload.camerafixed:
                    body["camerafixed"] = True
                if payload.return_last_frame:
                    body["return_last_frame"] = True
                if payload.generate_audio:
                    body["generate_audio"] = True
            # --- 发起视频生成请求 ---
            response = await client.post(submit_url, headers=api_headers(provider=provider), json=body)
            response.raise_for_status()
            try:
                raw = response.json()
            except Exception:
                # 上游返回了 HTML 错误页面或非 JSON 响应
                resp_text = response.text[:500]
                raise HTTPException(status_code=502, detail=f"上游视频接口返回非 JSON 响应（状态 {response.status_code}）：{resp_text}")
            task_id = extract_task_id(raw) or raw.get("task_id") or raw.get("id")
            result = raw
            if task_id and not video_output_urls(raw):
                result = await wait_for_video_task(client, provider, task_id)
            urls = video_output_urls(result)
            if not urls:
                raise HTTPException(status_code=502, detail=f"视频生成成功但没有返回视频：{result}")
            local_urls = [await save_remote_video_to_output(url) for url in urls]
            return {"videos": local_urls, "task_id": task_id, "raw": result}
    except httpx.HTTPStatusError as exc:
        text = exc.response.text
        try:
            requested_model = body.get("model", "") or payload.model or ""
        except NameError:
            requested_model = payload.model or ""
        provider_name = provider.get('name') or provider['id']
        # 1) 模型名不在上游支持范围 → 从错误信息里抽取合法列表展示
        valid_models_match = re.search(r"not in\s*\[([^\]]+)\]", text)
        if valid_models_match:
            valid_models = [m.strip() for m in valid_models_match.group(1).split(",") if m.strip()]
            sample = valid_models[:30]
            more = f"（共 {len(valid_models)} 个，仅显示前 {len(sample)} 个）" if len(valid_models) > len(sample) else ""
            hint = (
                f"上游「{provider_name}」不识别模型「{requested_model}」。\n\n"
                f"上游支持的视频模型清单{more}：\n  {', '.join(sample)}\n\n"
                f"请到「API 设置」里把视频模型改成上面列表中的一个。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        # 2) 模型名合法但账号没开通通道
        if "channel not found" in text or "model_not_found" in text:
            hint = (
                f"上游「{provider_name}」识别了模型「{requested_model}」，但你的 API Key 账号下**没有该模型的可用通道**。\n\n"
                f"原因：你的账号没开通这个模型的访问权限（付费/订阅相关）。\n\n"
                f"解决方法：\n"
                f"  1. 登录 {provider.get('base_url') or '上游平台'} 控制台，开通该模型 / 充值；\n"
                f"  2. 或在「API 设置」里把视频模型改成你账号已开通的型号（如 veo3-fast / veo2-fast / sora-2 等）。"
            )
            raise HTTPException(status_code=exc.response.status_code, detail=hint) from exc
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游视频接口错误：{text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游视频接口失败：{exc}") from exc

# --- Canvas LLM ---

@app.post("/api/canvas-llm")
async def canvas_llm(payload: CanvasLLMRequest):
    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    # 判断协议：APIMart 异步 vs 标准 OpenAI
    _llm_provider = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
    _is_apimart = is_apimart_provider(_llm_provider)
    upstream_messages = [{"role": "system", "content": payload.system_prompt or SYSTEM_PROMPT}]
    for item in payload.messages[-MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    # 构造用户消息：有图片时用 OpenAI vision 多模态格式
    if payload.images:
        content_parts = [{"type": "text", "text": payload.message}]
        ok_imgs = 0
        for img in payload.images[:8]:
            if not img or not isinstance(img, str):
                continue
            # 本地 /output/* 或 /assets/* 路径转为 data URL；http(s) 或 data URL 直接用
            if img.startswith("/output/") or img.startswith("/assets/"):
                ref_url = reference_to_data_url({"url": img}, max_size=1024)
            else:
                ref_url = img
            if not ref_url:
                continue
            content_parts.append({"type": "image_url", "image_url": {"url": ref_url}})
            ok_imgs += 1
        logger.info(f"[canvas-llm] model={model} provider={payload.provider} text_len={len(payload.message)} images={ok_imgs}/{len(payload.images)}")
        upstream_messages.append({"role": "user", "content": content_parts})
    else:
        upstream_messages.append({"role": "user", "content": payload.message})
    raw = None
    try:
        async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
            req_body = {"model": model, "messages": upstream_messages}
            if _is_apimart:
                req_body["stream"] = False   # APIMart 默认流式，强制关闭
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json=req_body,
            )
            response.raise_for_status()
            if not response.content:
                raise HTTPException(status_code=502, detail="上游接口返回了空响应")
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text or ""
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误：{body}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解析上游响应失败：{exc}") from exc
    try:
        text = text_from_chat_response(raw).strip() if isinstance(raw, dict) else ""
        text = text or "接口返回了空回复。"
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"解析回复内容失败：{exc}") from exc
    raw_data = unwrap_apimart_response(raw) if isinstance(raw, dict) else {}
    return {"text": text, "model": model, "raw_usage": raw_data.get("usage")}

# --- 对话管理 ---

@app.get("/api/conversations")
async def conversations(request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"user_id": user_id, "conversations": list_conversations(user_id)}

@app.post("/api/conversations")
async def create_conversation(payload: ConversationCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": new_conversation(user_id, payload.title)}

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    return {"conversation": load_conversation(user_id, conversation_id)}

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    path = conversation_path(user_id, conversation_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

# --- 画布管理 ---

@app.get("/api/canvases")
async def canvases():
    return {"canvases": list_canvases()}

@app.get("/api/canvases/trash")
async def trashed_canvases():
    return {"canvases": list_deleted_canvases(), "retention_days": 30}

@app.post("/api/canvases")
async def create_canvas(payload: CanvasCreateRequest):
    return {"canvas": new_canvas(payload.title, payload.icon, payload.kind)}

@app.get("/api/canvases/{canvas_id}/meta")
async def get_canvas_meta(canvas_id: str):
    canvas = load_canvas(canvas_id)
    return {
        "id": canvas.get("id"),
        "updated_at": canvas.get("updated_at", 0),
        "title": canvas.get("title", "未命名画布"),
        "icon": canvas.get("icon", "layers"),
        "kind": normalize_canvas_kind(canvas.get("kind")),
    }

@app.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str):
    return {"canvas": load_canvas(canvas_id)}

@app.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: CanvasSaveRequest):
    canvas = load_canvas(canvas_id)
    current_updated_at = int(canvas.get("updated_at") or 0)
    if payload.base_updated_at and current_updated_at and int(payload.base_updated_at) < current_updated_at:
        raise HTTPException(status_code=409, detail={
            "message": "画布已被其他页面更新，已拒绝旧版本覆盖。",
            "canvas": canvas,
            "updated_at": current_updated_at,
        })
    canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
    canvas["icon"] = (payload.icon or canvas.get("icon") or "layers")[:32]
    canvas["kind"] = normalize_canvas_kind(canvas.get("kind"))
    canvas["nodes"] = payload.nodes
    canvas["connections"] = payload.connections
    canvas["viewport"] = payload.viewport
    canvas["logs"] = payload.logs[-500:]
    canvas["settings"] = payload.settings or {}
    save_canvas(canvas)
    await manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or now_ms()), payload.client_id)
    return {"canvas": canvas}

@app.delete("/api/canvases/{canvas_id}")
async def delete_canvas(canvas_id: str):
    canvas = load_canvas_any(canvas_id)
    if not canvas.get("deleted_at"):
        canvas["deleted_at"] = now_ms()
        save_canvas(canvas)
    return {"ok": True}

@app.post("/api/canvases/{canvas_id}/restore")
async def restore_canvas(canvas_id: str):
    canvas = load_canvas_any(canvas_id)
    if canvas.get("deleted_at"):
        canvas.pop("deleted_at", None)
        save_canvas(canvas)
    return {"canvas": canvas}

@app.delete("/api/canvases/{canvas_id}/purge")
async def purge_canvas(canvas_id: str):
    path = canvas_path(canvas_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

# --- GPT 对话 ---

@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    if payload.mode == "image":
        image_provider_id = payload.provider if payload.provider not in {"modelscope"} else "comfly"
        provider = get_api_provider(image_provider_id)
        default_model = (provider.get("image_models") or [IMAGE_MODEL])[0]
        model = selected_model(payload.image_model or payload.model, default_model)
        try:
            image_data, raw = await generate_ai_image(payload.message, payload.size, payload.quality, model, refs, provider["id"])
            local_url = await save_ai_image_to_output(image_data, prefix="chat_")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游生图接口错误：{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游生图接口失败：{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": payload.message,
            "image_url": local_url,
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }
    else:
        chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
        _conv_provider = get_api_provider(payload.provider) if payload.provider not in ("modelscope",) else {}
        _conv_is_apimart = is_apimart_provider(_conv_provider)
        history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
        upstream_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        for item in history:
            msg = upstream_message_from_record(item)
            if msg:
                upstream_messages.append(msg)
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                conv_req_body = {"model": model, "messages": upstream_messages}
                if _conv_is_apimart:
                    conv_req_body["stream"] = False
                response = await client.post(
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json=conv_req_body,
                )
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误：{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游接口失败：{exc}") from exc
        raw_data = unwrap_apimart_response(raw) if isinstance(raw, dict) else raw
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": text_from_chat_response(raw).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_data.get("usage") if isinstance(raw_data, dict) else None,
        }

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)
    return {"conversation": conversation, "message": assistant_message}

@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request, x_user_id: str = Header(default="")):
    if payload.mode == "image":
        raise HTTPException(status_code=400, detail="图片模式请使用 /api/chat")

    user_id = safe_user_id(x_user_id, request)
    conversation = (
        load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else new_conversation(user_id, display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = now_ms()
    save_conversation(user_id, conversation)

    chat_base, chat_hdrs, model = resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    history = conversation["messages"][-MAX_HISTORY_MESSAGES:]
    upstream_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history:
        msg = upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)

    async def stream():
        content_parts = []
        raw_usage = None
        yield sse_event({"type": "meta", "conversation": conversation})
        try:
            async with httpx.AsyncClient(timeout=AI_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages, "stream": True},
                ) as response:
                    if response.status_code >= 400:
                        detail = await response.aread()
                        yield sse_event({"type": "error", "detail": f"上游接口错误：{detail.decode('utf-8', errors='ignore')}"})
                        return
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if line == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(chunk, dict) and chunk.get("usage"):
                            raw_usage = chunk.get("usage")
                        delta = text_delta_from_chat_chunk(chunk)
                        if delta:
                            content_parts.append(delta)
                            yield sse_event({"type": "delta", "delta": delta})
        except httpx.HTTPError as exc:
            yield sse_event({"type": "error", "detail": f"请求上游接口失败：{exc}"})
            return

        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": "".join(content_parts).strip() or "接口返回了空回复。",
            "created_at": now_ms(),
            "model": model,
            "raw_usage": raw_usage,
        }
        conversation["messages"].append(assistant_message)
        conversation["updated_at"] = now_ms()
        save_conversation(user_id, conversation)
        yield sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

    return StreamingResponse(stream(), media_type="text/event-stream")

# --- 历史记录 ---

@app.get("/api/history")
async def get_history_api(type: str = None):
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if type:
                    data = [item for item in data if item.get("type", "zimage") == type]
                data = [item for item in data if item.get("images") and len(item["images"]) > 0]

                def sort_key(item):
                    ts = item.get("timestamp", 0)
                    if isinstance(ts, (int, float)):
                        return float(ts)
                    return 0

                data.sort(key=sort_key, reverse=True)
                return data
        except Exception as e:
            logger.error(f"读取历史文件失败: {e}")
            return []
    return []

@app.get("/api/queue_status")
async def get_queue_status(client_id: str):
    async with QUEUE_LOCK:
        total = len(QUEUE)
        positions = [i + 1 for i, t in enumerate(QUEUE) if t["client_id"] == client_id]
        position = positions[0] if positions else 0
    return {"total": total, "position": position}

@app.post("/api/history/delete")
async def delete_history(req: DeleteHistoryRequest):
    if not os.path.exists(HISTORY_FILE):
        raise HTTPException(status_code=404, detail="历史记录文件不存在")
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
            target_record = None
            new_history = []
            for item in history:
                is_match = False
                item_ts = item.get("timestamp", 0)
                if isinstance(req.timestamp, (int, float)) and isinstance(item_ts, (int, float)):
                    if abs(float(item_ts) - float(req.timestamp)) < 0.001:
                        is_match = True
                elif str(item_ts) == str(req.timestamp):
                    is_match = True
                if is_match:
                    target_record = item
                else:
                    new_history.append(item)
            if not target_record:
                raise HTTPException(status_code=404, detail="未找到匹配的历史记录")
            with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(new_history, f, ensure_ascii=False, indent=4)

        failed_files = []
        for img_url in target_record.get("images", []):
            file_path = output_file_from_url(img_url)
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    logger.error("Failed to delete file %s: %s", file_path, e)
                    failed_files.append(file_path)
        with ASSET_LOCK:
            with asset_db() as conn:
                for img_url in target_record.get("images", []):
                    conn.execute("DELETE FROM assets WHERE local_url = ?", (img_url,))

        result = {"ok": True, "success": True}
        if failed_files:
            result["warnings"] = f"{len(failed_files)} 个文件删除失败"
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Delete history error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- ModelScope 角度控制 ---

@app.post("/api/angle/poll_status")
async def poll_angle_cloud(req: CloudPollRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = (req.api_key or MODELSCOPE_API_KEY).strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    task_id = req.task_id
    logger.info(f"Resuming polling for Angle Task: {task_id}")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": f"Resumed {task_id}", "images": [local_path], "type": "angle"}
                        save_to_history(record)
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        return {"url": local_path}

                    elif status == "FAILED":
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    logger.warning("Angle polling error: %s", loop_e)
                    continue

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            raise HTTPException(status_code=504, detail="角度控制任务超时")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Angle polling error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/angle/generate")
async def generate_angle_cloud(req: CloudGenRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = (req.api_key or MODELSCOPE_API_KEY).strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    model = selected_model(req.model, "Qwen/Qwen-Image-Edit-2511")
    payload = {
        "model": model,
        "prompt": req.prompt.strip(),
        "image_url": [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    }
    if req.resolution:
        payload["size"] = modelscope_size(req.resolution)
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(f"{base_url}v1/images/generations", headers=headers, json=payload)
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except Exception:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            logger.info(f"Angle Task submitted, ID: {task_id}")

            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_angle_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "angle"}
                        save_to_history(record)
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "SUCCEED", "task_id": task_id}, req.client_id)
                        await manager.broadcast_new_image(record)
                        return {"url": local_path, "task_id": task_id}

                    elif status == "FAILED":
                        if req.client_id:
                            await manager.send_personal_message({"type": "cloud_status", "status": "FAILED", "task_id": task_id}, req.client_id)
                        raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                    if i % 5 == 0 and req.client_id:
                        await manager.send_personal_message({
                            "type": "cloud_status", "status": f"{status} ({i}/300)",
                            "task_id": task_id, "progress": i, "total": 300
                        }, req.client_id)

                except Exception as loop_e:
                    logger.warning("Angle polling error: %s", loop_e)
                    continue

            if req.client_id:
                await manager.send_personal_message({"type": "cloud_status", "status": "TIMEOUT", "task_id": task_id}, req.client_id)
            raise HTTPException(status_code=504, detail="角度控制生成超时")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Angle generation error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- ModelScope Z-Image 云端生图 ---

@app.post("/generate")
async def generate_cloud(req: CloudGenRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = (req.api_key or MODELSCOPE_API_KEY).strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未提供 ModelScope API Key")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "Tongyi-MAI/Z-Image-Turbo",
        "prompt": req.prompt.strip(),
        "size": modelscope_size(req.resolution),
        "n": 1
    }
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers={**headers, "X-ModelScope-Async-Mode": "true"},
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except Exception:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            logger.info(f"Z-Image Task submitted, ID: {task_id}")

            for i in range(200):
                await asyncio.sleep(3)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")

                    if i % 5 == 0:
                        logger.info(f"Task {task_id} status check {i}: {status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"cloud_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception as dl_e:
                            logger.error(f"Download error: {dl_e}")
                            local_path = img_url

                        record = {"timestamp": time.time(), "prompt": req.prompt, "images": [local_path], "type": "cloud"}
                        save_to_history(record)
                        try:
                            await manager.broadcast_new_image(record)
                        except Exception:
                            pass
                        return {"url": local_path}

                    elif status == "FAILED":
                        raise HTTPException(status_code=502, detail=f"ModelScope task failed: {data}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    logger.warning("Polling error (retrying): %s", loop_e)
                    continue

            raise HTTPException(status_code=504, detail="Z-Image 云端生图超时")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Cloud generation error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- ModelScope 通用图片生成（支持图生图） ---

@app.post("/api/ms/generate")
async def ms_generate(req: MsGenerateRequest):
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = (req.api_key or MODELSCOPE_API_KEY).strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 ModelScope API Key，请在 API 设置中填写，或重新保存 ModelScope Token。")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": req.model,
        "prompt": req.prompt.strip(),
    }
    if req.width and req.height:
        payload["width"] = req.width
        payload["height"] = req.height
        payload["size"] = modelscope_size(req.size or f"{req.width}x{req.height}")
    elif req.size:
        payload["size"] = modelscope_size(req.size)
    if req.image_urls:
        payload["image_url"] = [modelscope_image_url(url, max_size=1536) for url in req.image_urls]
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers=headers,
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except Exception:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            logger.info(f"MS Generate Task submitted ({req.model}), ID: {task_id}")

            TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

            for i in range(300):
                await asyncio.sleep(2)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")
                    logger.info(f"MS Task {task_id} poll {i}: status={status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                    file_path = output_path_for(filename, "output")
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                    local_path = output_url_for(filename, "output")
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {
                            "timestamp": time.time(),
                            "prompt": req.prompt,
                            "images": [local_path],
                            "type": "klein",
                            "model": req.model,
                        }
                        save_to_history(record)
                        await manager.broadcast_new_image(record)
                        return {"url": local_path, "task_id": task_id}

                    elif status in TERMINAL_FAILED_STATUSES:
                        error_info = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                        raise HTTPException(status_code=502, detail=f"MS task {status}: {error_info}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    logger.warning("MS polling error: %s", loop_e)
                    continue

            raise HTTPException(status_code=504, detail="MS 生图超时")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("MS generate error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# --- 本地 ComfyUI 生图 ---

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    global NEXT_TASK_ID
    current_task = None
    target_backend = None
    async with QUEUE_LOCK:
        task_id = NEXT_TASK_ID
        NEXT_TASK_ID += 1
        current_task = {"task_id": task_id, "client_id": req.client_id}
        QUEUE.append(current_task)

    client = GLOBAL_HTTP_CLIENT or httpx.AsyncClient(timeout=httpx.Timeout(connect=20, read=120, write=60, pool=20))
    own_client = GLOBAL_HTTP_CLIENT is None
    try:
        required_images = []
        for node_id, node_inputs in req.params.items():
            if isinstance(node_inputs, dict) and "image" in node_inputs:
                image_name = node_inputs["image"]
                if isinstance(image_name, str) and image_name:
                    required_images.append(image_name)

        target_backend = await get_best_backend(required_images)
        with LOAD_LOCK:
            BACKEND_LOCAL_LOAD[target_backend] += 1

        for image_name in required_images:
            need_sync = False
            try:
                check_url = f"http://{target_backend}/view?filename={urllib.parse.quote(image_name)}&type=input"
                resp = await client.get(check_url, timeout=0.5)
                if resp.status_code != 200:
                    need_sync = True
            except Exception:
                need_sync = True

            if need_sync:
                image_content = None
                image_type = "image/png"
                for addr in COMFYUI_INSTANCES:
                    if addr == target_backend:
                        continue
                    try:
                        src_url = f"http://{addr}/view?filename={urllib.parse.quote(image_name)}&type=input"
                        r = await client.get(src_url, timeout=5)
                        if r.status_code == 200:
                            image_content = r.content
                            image_type = r.headers.get("Content-Type", "image/png")
                            break
                    except Exception:
                        continue

                if image_content:
                    try:
                        files = {'image': (image_name, image_content, image_type)}
                        await client.post(f"http://{target_backend}/upload/image", files=files, timeout=10)
                    except Exception as e:
                        logger.warning("Sync upload failed: %s", e)

        wf_name = req.workflow_json
        if not WORKFLOW_NAME_RE.match(wf_name):
            raise HTTPException(status_code=400, detail="Invalid workflow_json name")
        workflow_path = os.path.abspath(os.path.join(WORKFLOW_DIR, *wf_name.split("/")))
        workflow_root = os.path.abspath(WORKFLOW_DIR)
        if os.path.commonpath([workflow_root, workflow_path]) != workflow_root:
            raise HTTPException(status_code=400, detail="Invalid workflow_json path")
        if not os.path.exists(workflow_path) and req.workflow_json == "Z-Image.json":
            workflow_path = WORKFLOW_PATH
        if not os.path.exists(workflow_path):
            raise HTTPException(status_code=404, detail=f"Workflow file not found: {req.workflow_json}")

        with open(workflow_path, 'r', encoding='utf-8') as f:
            workflow = json.load(f)

        seed = random.randint(1, 10**15)

        if "23" in workflow and req.prompt:
            workflow["23"]["inputs"]["text"] = req.prompt
        if "144" in workflow:
            workflow["144"]["inputs"]["width"] = req.width
            workflow["144"]["inputs"]["height"] = req.height
        if "22" in workflow:
            workflow["22"]["inputs"]["seed"] = seed
        if "158" in workflow:
            workflow["158"]["inputs"]["noise_seed"] = seed
        for node_id in ["146", "181"]:
            if node_id in workflow and "inputs" in workflow[node_id] and "seed" in workflow[node_id]["inputs"]:
                workflow[node_id]["inputs"]["seed"] = seed
        if "184" in workflow and "inputs" in workflow["184"] and "seed" in workflow["184"]["inputs"]:
            workflow["184"]["inputs"]["seed"] = seed
        if "172" in workflow and "inputs" in workflow["172"] and "seed" in workflow["172"]["inputs"]:
            workflow["172"]["inputs"]["seed"] = seed % 4294967295
        if "14" in workflow and "inputs" in workflow["14"] and "seed" in workflow["14"]["inputs"]:
            workflow["14"]["inputs"]["seed"] = seed

        for node_id, node_inputs in req.params.items():
            if node_id in workflow:
                if "inputs" not in workflow[node_id]:
                    workflow[node_id]["inputs"] = {}
                for input_name, value in node_inputs.items():
                    workflow[node_id]["inputs"][input_name] = value

        p = {"prompt": workflow, "client_id": CLIENT_ID}
        try:
            resp = await client.post(f"http://{target_backend}/prompt", json=p, timeout=10)
            resp.raise_for_status()
            prompt_id = resp.json()['prompt_id']
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=502, detail=f"ComfyUI /prompt error {e.response.status_code}: {e.response.text[:300]}")

        history_data = None
        for i in range(COMFYUI_HISTORY_TIMEOUT):
            try:
                res = await get_comfy_history(target_backend, prompt_id)
                if prompt_id in res:
                    history_data = res[prompt_id]
                    break
            except Exception:
                pass
            await asyncio.sleep(1)

        if not history_data:
            raise HTTPException(status_code=504, detail="ComfyUI 渲染超时")

        local_images = []
        local_videos = []
        local_urls = []
        current_timestamp = time.time()
        if 'outputs' in history_data:
            for node_id in history_data['outputs']:
                node_output = history_data['outputs'][node_id]
                if 'images' in node_output:
                    for img in node_output['images']:
                        prefix = f"{req.type}_{int(current_timestamp)}_"
                        local_path = await download_comfy_output(target_backend, img, prefix=prefix)
                        if req.convert_to_jpg:
                            local_path = convert_output_to_jpg(local_path)
                        local_images.append(local_path)
                        local_urls.append(local_path)
                for output_key in ("videos", "gifs", "animated"):
                    for video in node_output.get(output_key, []) or []:
                        if not isinstance(video, dict) or not video.get("filename"):
                            continue
                        prefix = f"{req.type}_{int(current_timestamp)}_"
                        local_path = await download_comfy_output(target_backend, video, prefix=prefix)
                        local_videos.append(local_path)
                        local_urls.append(local_path)

        result = {
            "prompt": req.prompt if req.prompt else "Detail Enhance",
            "images": local_images,
            "videos": local_videos,
            "outputs": local_urls,
            "seed": seed,
            "timestamp": current_timestamp,
            "type": req.type,
            "workflow_json": req.workflow_json,
            "task_id": task_id,
            "prompt_id": prompt_id,
            "backend": target_backend,
            "params": req.params,
        }
        save_to_history(result)
        await manager.broadcast_new_image(result)
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Generate error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if own_client:
            await client.aclose()
        if target_backend:
            with LOAD_LOCK:
                if BACKEND_LOCAL_LOAD.get(target_backend, 0) > 0:
                    BACKEND_LOCAL_LOAD[target_backend] -= 1
        if current_task:
            async with QUEUE_LOCK:
                if current_task in QUEUE:
                    QUEUE.remove(current_task)

# --- ComfyUI 工作流管理 ---

BUILTIN_WORKFLOWS = {"Z-Image.json", "Z-Image-Enhance.json", "2511.json", "klein-enhance.json", "Flux2-Klein.json", "upscale.json"}
CUSTOM_WORKFLOW_FOLDER = "custom"
LEGACY_CUSTOM_WORKFLOW_FOLDER = "自定义"
WORKFLOW_NAME_RE = re.compile(rf"^(?:(?:{CUSTOM_WORKFLOW_FOLDER}|{LEGACY_CUSTOM_WORKFLOW_FOLDER})/)?[a-zA-Z0-9_一-龥\.\-]+\.json$")

class WorkflowField(BaseModel):
    id: str
    node: str = ""
    input: str = ""
    name: str = ""
    type: str = "text"
    default: Any = None
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: List[str] = []

class WorkflowConfig(BaseModel):
    title: str = ""
    fields: List[WorkflowField] = []
    mini_cards: Dict[str, Any] = {}

class WorkflowUploadRequest(BaseModel):
    name: str = Field(min_length=1, max_length=WORKFLOW_NAME_MAX_LENGTH)
    workflow: Dict[str, Any]

class WorkflowRunRequest(BaseModel):
    fields: Dict[str, Any] = {}
    config: WorkflowConfig
    client_id: str = Field(default="", max_length=CLIENT_ID_MAX_LENGTH)

def workflow_path_from_name(name: str) -> str:
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    path = os.path.abspath(os.path.join(WORKFLOW_DIR, *name.split("/")))
    workflow_root = os.path.abspath(WORKFLOW_DIR)
    if os.path.commonpath([workflow_root, path]) != workflow_root:
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    return path

def workflow_config_path(name: str) -> str:
    return workflow_path_from_name(name).replace(".json", ".config.json")

def is_builtin_workflow(name: str) -> bool:
    return "/" not in name and os.path.basename(name) in BUILTIN_WORKFLOWS

class ComfyInstancesPayload(BaseModel):
    instances: List[str] = []

@app.get("/api/comfyui/instances")
def get_comfyui_instances():
    return {"instances": COMFYUI_INSTANCES}

@app.put("/api/comfyui/instances")
def save_comfyui_instances(payload: ComfyInstancesPayload):
    # 宽容校验：去前后空白、去 http(s):// 前缀、去尾部斜杠；要求形如 host:port
    cleaned = []
    for item in payload.instances:
        s = str(item or "").strip()
        if not s:
            continue
        s = re.sub(r"^https?://", "", s)
        s = s.rstrip("/")
        if ":" not in s:
            raise HTTPException(status_code=400, detail=f"地址缺少端口号：{item}（应为 host:port，例如 127.0.0.1:8188）")
        host, _, port = s.rpartition(":")
        if not host or not port.isdigit():
            raise HTTPException(status_code=400, detail=f"地址不合法：{item}（应为 host:port，例如 127.0.0.1:8188）")
        if s in cleaned:
            continue
        cleaned.append(s)
    if not cleaned:
        raise HTTPException(status_code=400, detail="至少保留一个 ComfyUI 后端地址")
    # 写入 env 文件
    try:
        update_env_values({"COMFYUI_INSTANCES": ",".join(cleaned)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"写入 env 失败：{e}")
    # 更新进程中的全局变量
    with LOAD_LOCK:
        global COMFYUI_INSTANCES, COMFYUI_ADDRESS, BACKEND_LOCAL_LOAD
        COMFYUI_INSTANCES = cleaned
        COMFYUI_ADDRESS = cleaned[0]
        new_load = {addr: 0 for addr in cleaned}
        for addr, n in (BACKEND_LOCAL_LOAD or {}).items():
            if addr in new_load:
                new_load[addr] = n
        BACKEND_LOCAL_LOAD = new_load
    schedule_cloud_config_sync()
    return {"instances": COMFYUI_INSTANCES}

@app.get("/api/workflows")
def list_workflows():
    if not os.path.isdir(WORKFLOW_DIR):
        return {"workflows": []}
    items = []
    for root, dirs, files in os.walk(WORKFLOW_DIR):
        if os.path.abspath(root) == os.path.abspath(WORKFLOW_DIR):
            dirs[:] = [d for d in dirs if d in {CUSTOM_WORKFLOW_FOLDER, LEGACY_CUSTOM_WORKFLOW_FOLDER}]
        for fn in sorted(files):
            if not fn.endswith(".json") or fn.endswith(".config.json"):
                continue
            rel = os.path.relpath(os.path.join(root, fn), WORKFLOW_DIR).replace("\\", "/")
            if is_builtin_workflow(rel):
                continue
            cfg = {}
            cfg_path = workflow_config_path(rel)
            if os.path.exists(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}
            items.append({
                "name": rel,
                "title": cfg.get("title") or fn.replace(".json", ""),
                "builtin": False,
                "field_count": len(cfg.get("fields") or []),
            })
    items.sort(key=lambda item: (0 if item["name"].startswith(f"{CUSTOM_WORKFLOW_FOLDER}/") else 1, item["title"]))
    return {"workflows": items}

@app.get("/api/workflows/{name:path}")
def get_workflow(name: str):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    with open(workflow_path, "r", encoding="utf-8") as f:
        workflow = json.load(f)
    cfg = {"title": name.replace(".json", ""), "fields": []}
    cfg_path = workflow_config_path(name)
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or cfg
        except Exception:
            pass
    return {"name": name, "workflow": workflow, "config": cfg, "builtin": is_builtin_workflow(name)}

@app.post("/api/workflows")
def upload_workflow(payload: WorkflowUploadRequest):
    name = os.path.basename(payload.name.strip())
    if not name.endswith(".json"):
        name = name + ".json"
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="工作流名称不合法，请使用中文/英文/数字/_-.")
    if not isinstance(payload.workflow, dict) or not payload.workflow:
        raise HTTPException(status_code=400, detail="工作流 JSON 为空")
    # 简单校验：是 API 格式（节点 id 为 key，含 class_type）
    sample = next(iter(payload.workflow.values()), None)
    if not isinstance(sample, dict) or "class_type" not in sample:
        raise HTTPException(status_code=400, detail="不是有效的 ComfyUI API 工作流 JSON（需包含 class_type）")
    custom_dir = os.path.join(WORKFLOW_DIR, CUSTOM_WORKFLOW_FOLDER)
    os.makedirs(custom_dir, exist_ok=True)
    stored_name = f"{CUSTOM_WORKFLOW_FOLDER}/{name}"
    path = workflow_path_from_name(stored_name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload.workflow, f, ensure_ascii=False, indent=2)
    return {"name": stored_name}

@app.put("/api/workflows/{name:path}/config")
def save_workflow_config(name: str, payload: WorkflowConfig):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    workflow_path = workflow_path_from_name(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    cfg_path = workflow_config_path(name)
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(payload.dict(), f, ensure_ascii=False, indent=2)
    return {"config": payload.dict()}

@app.delete("/api/workflows/{name:path}")
def delete_workflow(name: str):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if is_builtin_workflow(name):
        raise HTTPException(status_code=400, detail="内置工作流不可删除")
    workflow_path = workflow_path_from_name(name)
    cfg_path = workflow_config_path(name)
    if not os.path.exists(workflow_path):
        raise HTTPException(status_code=404, detail="Workflow not found")
    os.remove(workflow_path)
    if os.path.exists(cfg_path):
        os.remove(cfg_path)
    return {"ok": True}

@app.post("/api/workflows/{name:path}/run")
async def run_workflow(name: str, payload: WorkflowRunRequest):
    if not WORKFLOW_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid workflow name")
    if not os.path.exists(workflow_path_from_name(name)):
        raise HTTPException(status_code=404, detail="Workflow not found")
    # 根据 config 的字段把值映射成 params 节点覆盖
    params: Dict[str, Dict[str, Any]] = {}
    for field in payload.config.fields:
        if not field.node or not field.input:
            continue
        if field.id in payload.fields:
            value = payload.fields[field.id]
            # 类型转换
            if field.type in ("number", "slider"):
                try:
                    value = float(value) if (field.step and field.step < 1) else int(float(value))
                except Exception:
                    pass
            elif field.type == "boolean":
                value = bool(value)
            elif field.type == "dropdown":
                # 下拉值如果看起来是数字（如 "1024" / "2048" / "0.8"），自动转成 int/float
                if isinstance(value, str):
                    s = value.strip()
                    try:
                        if s and ('.' in s or 'e' in s.lower()):
                            value = float(s)
                        elif s and (s.lstrip('-').isdigit()):
                            value = int(s)
                    except (ValueError, TypeError):
                        pass
            params.setdefault(field.node, {})[field.input] = value
    req = GenerateRequest(
        prompt="",
        workflow_json=name,
        params=params,
        type="workflow-test",
        client_id=payload.client_id or str(uuid.uuid4()),
    )
    return await generate(req)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("APP_HOST", "0.0.0.0"),
        port=int(os.getenv("APP_PORT", "3000")),
    )
