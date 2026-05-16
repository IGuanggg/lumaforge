# Infinite-Canvas 架构分析文档

> 分析日期：2026-05-17
> 仅分析，未修改任何代码。

---

## 1. 项目概览

Infinite-Canvas（无限画布）是一个基于 **Python FastAPI + 原生 HTML/JS** 的 AI 图像/视频生成工作站。前端通过 iframe 路由切换多个功能页面，后端是单文件 `main.py`（约 3468 行）。

**技术栈：**
- 后端：Python 3.10 + FastAPI + uvicorn + httpx + Pillow
- 前端：纯原生 HTML/CSS/JS（无框架），Tailwind CSS CDN，Lucide Icons CDN
- 本地 ComfyUI 引擎：通过 HTTP API 与 ComfyUI 后端交互
- 数据存储：JSON 文件（无数据库）
- 部署：`run.bat` / `mac-启动服务.sh` → `python main.py` → uvicorn `0.0.0.0:3000`

---

## 2. 目录结构

```
Infinite-Canvas-main/
├── main.py                  # 后端入口（单文件 3468 行，所有路由 + 业务逻辑）
├── static/                  # 前端静态文件
│   ├── index.html           # 前端入口（主壳，iframe 路由器）
│   ├── canvas.html          # 无限画布页面（核心，7886 行）
│   ├── gpt-chat.html        # GPT 对话页面
│   ├── api-settings.html    # API 平台设置页面
│   ├── comfyui-settings.html# ComfyUI 设置页面（含工作流管理）
│   ├── zimage.html           # Z-Image 文生图页面
│   ├── enhance.html         # 细节增强页面
│   ├── klein.html           # Klein 编辑页面
│   ├── angle.html           # 角度控制页面
│   ├── online.html          # 在线生图页面
│   ├── login.html           # 登录页面
│   ├── i18n.js              # 国际化（中/英文）
│   ├── theme.js             # 主题切换（亮/暗）
│   ├── theme.css            # 主题样式
│   ├── image-preview.js     # 图片预览组件
│   └── history-bulk-manager.js  # 历史批量管理
├── workflows/               # ComfyUI 工作流 JSON
│   ├── Z-Image.json         # Z-Image 文生图工作流（内置）
│   ├── Z-Image-Enhance.json # 细节增强工作流（内置）
│   ├── Flux2-Klein.json     # Klein 编辑工作流（内置）
│   ├── 2511.json            # 另一个内置工作流
│   └── upscale.json         # 超分辨率工作流（内置）
├── packages/                # Python 依赖 .whl 文件（离线安装）
├── python/                  # 内嵌 Python 3.10 运行时（Windows）
├── data/                    # 运行时数据目录（自动创建）
│   ├── canvases/            # 画布 JSON 文件
│   ├── conversations/       # GPT 对话 JSON 文件
│   └── api_providers.json   # API 平台配置
├── output/                  # 生成图片输出目录
├── assets/                  # 资产目录
│   ├── input/               # ComfyUI 输入图片
│   └── output/              # ComfyUI 输出图片
├── API/
│   └── .env                 # 环境变量（API Key 等）
├── requirements.txt         # Python 依赖
├── run.bat                  # Windows 启动脚本
└── mac-启动服务.sh           # macOS 启动脚本
```

---

## 3. 后端入口

**文件：** `main.py`

- **入口行：** `main.py:3466-3468` → `uvicorn.run(app, host="0.0.0.0", port=3000)`
- **FastAPI 实例：** `main.py:54` → `app = FastAPI()`
- **静态文件挂载：**
  - `/static` → `static/` 目录（`main.py:580`）
  - `/output` → `output/` 目录（`main.py:581`）
  - `/assets` → `assets/` 目录（`main.py:582`）
- **根路由：** `GET /` → 返回 `static/index.html`（`main.py:1652`）
- **WebSocket：** `/ws/stats` 用于在线人数统计和画布更新广播（`main.py:144`）
- **启动事件：** `@app.on_event("startup")` 获取全局事件循环（`main.py:139`）

---

## 4. 前端入口

**文件：** `static/index.html`

index.html 是一个 **iframe 路由器**，左侧侧边栏导航，右侧 iframe 加载各功能页面：

```
index.html (壳)
├── iframe: zimage.html        # 文生图
├── iframe: enhance.html       # 细节增强
├── iframe: klein.html         # Klein 编辑
├── iframe: angle.html         # 角度控制
├── iframe: online.html        # 在线生图
├── iframe: gpt-chat.html      # GPT 对话
├── iframe: canvas.html        # 无限画布（核心）
├── iframe: api-settings.html  # API 设置
└── iframe: comfyui-settings.html # ComfyUI 设置
```

各 iframe 通过 `postMessage` 通信（如语言同步 `studio-lang`、画布更新 `canvas_updated`）。

---

## 5. 节点注册机制

**核心文件：** `static/canvas.html`

节点系统完全在前端实现，**没有注册表/注册函数**，而是通过 **硬编码 if/switch 分发**。

### 5.1 节点类型清单

| type 字符串 | 中文名 | 创建函数 | 渲染函数 | 运行函数 |
|---|---|---|---|---|
| `image` | 图片卡 | `addImageNode()` | 内联渲染 | 无（数据节点） |
| `prompt` | 提示词 | `addPromptNode()` | 内联渲染 | 无（数据节点） |
| `group` | 组 | `addGroupNode()` | 内联渲染 | 无（容器节点） |
| `promptGroup` | 提示词组 | `addGroupNode()` | 内联渲染 | 无（容器节点） |
| `llm` | LLM | `addLLMNode()` | `renderLLMBody()` | `runLLMNode()` |
| `generator` | API 生图 | `addGeneratorNode()` | `renderGeneratorBody()` | `runGenerator()` |
| `msgen` | ModelScope 生图 | `addMsGenNode()` | `renderMsGenBody()` | `runMsGenNode()` |
| `video` | 视频生成 | `addVideoNode()` | `renderVideoBody()` | `runVideoNode()` |
| `comfy` | ComfyUI | `addComfyNode()` | `renderComfyBody()` | `runComfyNode()` |
| `output` | 输出 | `addOutputNode()` | 内联渲染 | 无（展示节点） |
| `loop` | 循环 | `addLoopNode()` | `renderLoopBody()` | 级联调度器 |

### 5.2 节点注册的关键代码位置（canvas.html）

- **类型分发（创建）：** `createNodeByType()` L3069、`menuAdd()` L3082
- **类型分发（渲染）：** `renderNodeBody()` 中的 if 链 L3889-L4006
- **类型分发（运行）：** `runCascadeNodeByType()` L6011、`canvasRunTypes()` L6020
- **右键菜单注册：** 节点创建菜单定义在 L2830-L2885
- **节点标题映射：** L3875 的 if/else 链

### 5.3 节点数据结构

每个节点是纯 JS 对象，存储在 `nodes[]` 数组中：

```js
{
  id: "llm_abc123",     // uid('llm') 生成
  type: "llm",          // 节点类型
  x: 100, y: 200,       // 画布坐标
  // ...各类型特有字段
}
```

画布保存时整个 `{id, title, icon, nodes[], connections[], viewport, logs}` 序列化为 JSON。

---

## 6. 特殊节点实现详解

### 6.1 LLM 节点

- **前端：** `canvas.html`
  - 创建：`addLLMNode()` L2258
  - 渲染：`renderLLMBody()` L4442
  - 运行：`runLLMNode()` L5910 → `callCanvasLLM()` → `POST /api/canvas-llm`
  - 支持图片输入（VL 模型反推）
- **后端：** `main.py`
  - 路由：`POST /api/canvas-llm` L2283
  - 逻辑：调用上游 OpenAI 兼容 API（`/chat/completions`）
  - 支持多模态消息（图片转 data URL 嵌入）
  - 支持 APIMart 异步协议和标准 OpenAI 协议

### 6.2 API 生图节点（generator）

- **前端：**
  - 创建：`addGeneratorNode()` L2278
  - 渲染：`renderGeneratorBody()` L4709
  - 运行：`runGenerator()` L5540 → `POST /api/canvas-image-tasks`（异步任务）→ 轮询 `GET /api/canvas-image-tasks/{task_id}`
- **后端：**
  - 路由：`POST /api/canvas-image-tasks` L2037、`GET /api/canvas-image-tasks/{task_id}` L2053
  - 逻辑：调用 `generate_ai_image()` → 上游 `POST /v1/images/generations`
  - 支持 OpenAI、ComflyAI、APIMart 三种协议
  - 支持参考图（reference images）

### 6.3 ModelScope 生图节点（msgen）

- **前端：**
  - 创建：`addMsGenNode()` L2283
  - 渲染：`renderMsGenBody()` L2350
  - 运行：`runMsGenNode()` L2687 → `POST /api/ms/generate`
- **后端：**
  - 路由：`POST /api/ms/generate` L2959
  - 逻辑：直接调用 ModelScope API `POST v1/images/generations`，支持图生图、LoRA

### 6.4 ComfyUI 节点

- **前端：**
  - 创建：`addComfyNode()` (canvas.html 中)
  - 渲染：`renderComfyBody()` L5159
  - 运行：`runComfyNode()` L5737
  - 支持三种模式：
    - `text`：文字生图 → `POST /api/generate`（Z-Image.json 工作流）
    - `enhance`：图片增强 → `POST /api/generate`（Z-Image-Enhance.json 工作流）
    - `custom`：自定义工作流 → `POST /api/generate`（用户上传的 .json）
- **后端：**
  - 路由：`POST /api/generate` L3065 — 提交到 ComfyUI WebSocket API
  - 路由：`POST /api/workflows/{name}/run` L3424 — 自定义工作流运行
  - 路由：`GET/POST/PUT/DELETE /api/workflows/...` — 工作流 CRUD
  - 逻辑：通过 WebSocket 连接 ComfyUI 后端，提交 prompt，等待图片生成
  - 支持多 ComfyUI 后端实例负载均衡

### 6.5 视频生成节点

- **前端：**
  - 创建：`addVideoNode()` L2308
  - 渲染：`renderVideoBody()` L4944
  - 运行：`runVideoNode()` L5636 → `POST /api/canvas-video`
- **后端：**
  - 路由：`POST /api/canvas-video` L2142
  - 逻辑：调用上游 `POST /v1/videos/generations`，轮询任务状态
  - 支持：Veo 系列、Sora、通义万相、豆包 Seedance 等模型
  - 支持首帧/末帧角色、参考视频、音频生成

### 6.6 循环节点

- **纯前端实现，无后端路由**
- 创建：`addLoopNode()` L2240
- 渲染：`renderLoopBody()` L4219
- 执行：`runNodeCascade()` L6134 → 解析循环配置 → 多轮执行下游节点
  - 支持串行/并行模式
  - 支持变量提示词（`《计数》` 替换为当前轮次）
  - 支持图片输入模式（批量从 output 节点取图）
  - `resolveCascadeLoop()` L6127 从上游找循环节点
  - `loopCount()` L4092 计算循环次数

---

## 7. API 路由汇总

### 7.1 画布管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/canvases` | 列出所有画布 |
| GET | `/api/canvases/trash` | 列出回收站画布 |
| POST | `/api/canvases` | 创建新画布 |
| GET | `/api/canvases/{id}` | 获取画布完整数据 |
| GET | `/api/canvases/{id}/meta` | 获取画布元信息（轻量） |
| PUT | `/api/canvases/{id}` | 保存画布（含节点 + 连线） |
| DELETE | `/api/canvases/{id}` | 移入回收站 |
| POST | `/api/canvases/{id}/restore` | 从回收站恢复 |
| DELETE | `/api/canvases/{id}/purge` | 永久删除 |

### 7.2 AI 生成

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/online-image` | 在线生图（同步） |
| POST | `/api/canvas-image-tasks` | 画布生图任务（异步） |
| GET | `/api/canvas-image-tasks/{id}` | 轮询生图任务状态 |
| POST | `/api/canvas-video` | 画布视频生成 |
| POST | `/api/canvas-llm` | 画布 LLM 调用 |
| POST | `/api/ms/generate` | ModelScope 生图 |
| POST | `/api/generate` | ComfyUI 本地生图 |
| POST | `/generate` | ModelScope 云端生图（旧版） |
| POST | `/api/chat` | GPT 对话（非流式） |
| POST | `/api/chat/stream` | GPT 对话（流式） |
| POST | `/api/angle/generate` | 角度控制生成 |
| POST | `/api/angle/poll_status` | 角度控制状态轮询 |

### 7.3 设置与配置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | 获取全局配置 |
| GET | `/api/models` | 获取模型列表 |
| GET | `/api/providers` | 获取 API 平台列表 |
| PUT | `/api/providers` | 保存 API 平台配置 |
| GET | `/api/config/token` | 获取 API Token |
| POST | `/api/providers/test-connection` | 测试 API 连接 |
| POST | `/api/providers/probe-async` | 异步探测协议 |
| GET | `/api/providers/{id}/fetch-models` | 拉取上游模型列表 |
| GET | `/api/comfyui/instances` | 获取 ComfyUI 实例列表 |
| PUT | `/api/comfyui/instances` | 保存 ComfyUI 实例列表 |

### 7.4 工作流管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workflows` | 列出所有工作流 |
| GET | `/api/workflows/{name}` | 获取工作流详情 + 配置 |
| POST | `/api/workflows` | 上传新工作流 |
| PUT | `/api/workflows/{name}/config` | 保存工作流配置 |
| DELETE | `/api/workflows/{name}` | 删除工作流 |
| POST | `/api/workflows/{name}/run` | 运行工作流 |

### 7.5 其他

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/upload` | 上传图片到 ComfyUI |
| POST | `/api/ai/upload` | 上传图片到本地 assets |
| GET | `/api/view` | 代理查看 ComfyUI 图片 |
| GET | `/api/download-output` | 下载输出文件 |
| GET | `/api/history` | 获取生成历史 |
| DELETE | `/api/history/delete` | 删除历史记录 |
| GET | `/api/queue_status` | 获取任务队列状态 |
| WebSocket | `/ws/stats` | 在线统计 + 画布更新广播 |

---

## 8. 数据存储方式

**全部使用 JSON 文件，无数据库。**

| 数据 | 存储路径 | 格式 |
|---|---|---|
| 画布 | `data/canvases/{id}.json` | `{id, title, icon, nodes[], connections[], viewport, logs, created_at, updated_at, deleted_at}` |
| GPT 对话 | `data/conversations/{user_id}/{id}.json` | `{id, title, messages[], created_at, updated_at}` |
| API 平台 | `data/api_providers.json` | `[{id, name, base_url, protocol, image_models[], chat_models[], video_models[]}]` |
| 环境变量 | `API/.env` | `KEY=VALUE` 格式 |
| 生成历史 | `history.json`（项目根目录） | `[{timestamp, prompt, images[], type}]` |
| ComfyUI 工作流 | `workflows/*.json` | ComfyUI API 格式（节点 ID → class_type + inputs） |
| 工作流配置 | `workflows/*.config.json` | `{title, fields[], mini_cards{}}` |
| 自定义工作流 | `workflows/custom/*.json` | 用户上传的工作流 |

**锁机制：** 使用 `threading.Lock` 保护并发读写（`QUEUE_LOCK`, `HISTORY_LOCK`, `GLOBAL_CONFIG_LOCK`, `CONVERSATION_LOCK`, `CANVAS_LOCK`, `LOAD_LOCK`）。

---

## 9. API 平台体系

系统支持多个 API 平台同时配置，通过 `provider_id` 区分：

- **modelscope**：ModelScope 平台（内置默认，不可删除）
- **comfly** / **apimart**：第三方 API 代理平台
- **自定义平台**：用户可添加任意 OpenAI 兼容 API

每个平台支持三种模型列表：
- `image_models`：图片生成模型
- `chat_models`：LLM 对话模型
- `video_models`：视频生成模型

协议支持：
- **openai**：标准 OpenAI API 协议
- **apimart**：APIMart 异步协议（提交 → 轮询 task_id）

---

## 10. 新增功能的建议放置位置

### 10.1 提示词库（Prompt Library）

**建议方案：**
- **后端：** 在 `main.py` 中新增 `/api/prompts` 路由组，或新建 `prompt_library.py` 模块
- **数据存储：** `data/prompt_library.json` 或 `data/prompts/` 目录
- **前端画布集成：** 在 `canvas.html` 的 prompt 节点渲染函数 `addPromptNode()` (L2236) 附近添加提示词库选择 UI
- **独立页面方案：** 可新增 `static/prompt-library.html`，在 `index.html` 的 iframe 路由中添加入口
- **关键插入点：**
  - 后端路由：在 `main.py` L2347（对话管理区块前）插入
  - 前端菜单：在 `canvas.html` L2844 的节点创建菜单中添加入口
  - i18n：在 `i18n.js` 中添加相关翻译键

### 10.2 图片反推（Image-to-Prompt）

**建议方案：**
- **后端：** 在 `main.py` 中新增 `/api/image-to-prompt` 路由，或复用 `/api/canvas-llm` 端点（已有图片输入支持，L2296-L2314）
- **LLM 节点已支持：** `canvas-llm` 已支持 images 字段，LLM 节点前端也支持图片输入（L2296 `payload.images`）
- **需要新增：** 专用的 UI 入口（如图片节点右键菜单"反推提示词"）
- **关键插入点：**
  - 后端：在 `main.py` L2283 的 `canvas_llm()` 附近添加专用路由，或复用现有逻辑
  - 前端：在 `canvas.html` 的图片节点渲染/交互代码中（L3889 image 分支）添加"反推"按钮
  - 独立功能：可在 `static/canvas.html` 中新增 `imageToPrompt()` 函数

### 10.3 视频反推（Video-to-Prompt）

**建议方案：**
- **后端：** 新增 `/api/video-to-prompt` 路由，提取视频关键帧 → 调用 VL 模型描述
- **依赖：** 需要视频帧提取能力（可能需要 ffmpeg 或调用外部 API）
- **关键插入点：**
  - 后端路由：在 `main.py` L2142（视频生成区块前）或 L2283（LLM 区块前）插入
  - 前端：在视频节点的渲染函数 `renderVideoBody()` (L4944) 中添加反推按钮
  - 可参考 LLM 节点的图片输入逻辑（L2296-L2314）进行多模态调用

### 10.4 浏览器插件桥接（Browser Extension Bridge）

**建议方案：**
- **后端：** 新增 API 端点供浏览器插件调用：
  - `POST /api/extension/import` — 从浏览器插件导入图片/文本
  - `GET /api/extension/status` — 检查桥接状态
  - WebSocket `/ws/extension` — 实时通信通道
- **前端：** 可在 `canvas.html` 中添加"从浏览器导入"功能
- **关键插入点：**
  - 后端：在 `main.py` 末尾（L3464 前）添加 extension 路由组
  - CORS 已全局开放（L56-61），无需额外配置
  - 前端：在图片上传逻辑 `uploadImages()` (L3094) 附近添加插件导入入口
  - 可复用现有的 `/api/ai/upload` 端点接收图片

---

## 11. 架构特点与约束

### 优势
- **单文件部署**：`main.py` + `static/` 即可运行
- **零构建**：前端无打包步骤，直接 HTML/JS
- **离线 Python**：`packages/` 目录内置 .whl，无需网络安装
- **多平台 API**：支持同时对接多个 AI 平台

### 约束
- **单文件后端**：`main.py` 3468 行，所有逻辑集中，新增功能会进一步膨胀
- **硬编码节点类型**：前端节点系统无注册机制，每新增一种节点需在 ~6 处 if/switch 链中添加分支
- **无数据库**：JSON 文件存储，大量画布时性能可能下降
- **无前端框架**：纯 DOM 操作，canvas.html 7886 行，维护成本高
- **iframe 架构**：页面间通信依赖 postMessage，共享状态有限

### 扩展新节点类型的 Checklist

如需新增一种节点类型（如"提示词库节点"），需修改以下位置（均在 `static/canvas.html`）：

1. `addXxxNode()` 函数 — 定义默认属性
2. `createNodeByType()` L3069 — 添加 if 分支
3. `menuAdd()` L3082 — 添加 if 分支
4. 右键菜单定义 L2830-L2885 — 添加菜单项
5. `renderNodeBody()` L3889 — 添加渲染 if 分支
6. `renderXxxBody()` 函数 — 实现节点 UI
7. `runCascadeNodeByType()` L6011 — 添加 if 分支（如果可运行）
8. `canvasRunTypes()` L6020 — 添加到类型列表（如果可运行）
9. 标题映射 L3875 — 添加 title 分支
10. 输入/输出连接判断 L4066 — 添加到 `canInput` 数组
11. `i18n.js` — 添加相关翻译键
