# Infinite-Canvas v1.0.1

基于节点的无限画布 AI 创作工具，支持 ComfyUI 本地生图、多平台 API 生图/生视频、LLM 对话。

A node-based infinite canvas AI creation tool with ComfyUI local generation, multi-provider API image/video generation, and LLM chat.

---

## 功能特性

### 画布系统
- 无限画布，自由拖拽、缩放、连线
- 节点类型：生图、视频生成、LLM 对话、提示词、循环计数、ComfyUI 工作流等
- 节点间连线自动级联运行
- 多画布管理，支持回收站（30 天自动清理）

### 图片生成
- ComfyUI 本地生图（支持多后端负载均衡）
- 在线 API 生图（ModelScope、OpenAI 兼容、APIMart 异步协议）
- 图生图、参考图输入、LoRA 调用
- 支持 2K/4K 高分辨率生成

### 视频生成
- 多模型支持：Veo、Sora、通义万相、豆包 Seedance 等
- 支持首尾帧控制、参考图输入
- 异步任务轮询，超时自动返回

### LLM 对话
- 多平台 Chat 模型（OpenAI 兼容协议）
- 支持图片输入（Vision 多模态）
- 流式输出（SSE）
- 对话历史管理

### ComfyUI 工作流
- 自定义工作流上传与管理
- 可视化字段配置（文本、数字、下拉、布尔）
- 工作流节点可直接在画布中调用

### API 平台管理
- 多平台配置，支持一键拉取模型列表
- 自动分类（图片/对话/视频）
- 协议验证（OpenAI / APIMart 异步）
- 独立 API Key 管理

---

## 安全与稳定性

- 本地访问免认证，远程访问需 Bearer Token
- API Key 脱敏返回（不暴露完整密钥）
- 路径遍历防护（workflow/view/upload 端点）
- 上传文件大小限制（默认 50MB，可配置）
- 全异步架构（httpx.AsyncClient，不阻塞事件循环）
- Graceful Shutdown（WebSocket、HTTP Client 优雅关闭）
- 结构化日志（logging 模块，分级输出）
- /health 健康检查端点

---

## 快速开始

### 环境要求
- Python 3.10+
- ComfyUI（可选，用于本地生图）

### 安装

```bash
pip install -r requirements.txt
```

或使用离线包：

```bash
pip install --no-index --find-links=packages -r requirements.txt
```

### 启动

```bash
python main.py
```

服务默认运行在 `http://127.0.0.1:3000/`

### API Key 配置

在 `API/.env` 中填写：

```
MODELSCOPE_API_KEY=your_key_here
```

或启动后在网页「API 设置」中配置。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MODELSCOPE_API_KEY` | ModelScope API Key | - |
| `COMFLY_API_KEY` | 默认 API 平台 Key | - |
| `COMFLY_BASE_URL` | 默认 API 平台地址 | `https://ai.comfly.chat` |
| `COMFYUI_INSTANCES` | ComfyUI 后端地址（逗号分隔） | `127.0.0.1:8188` |
| `MAX_UPLOAD_SIZE_MB` | 上传文件大小限制 (MB) | `50` |
| `CORS_ORIGINS` | CORS 允许来源（逗号分隔） | `*` |
| `REQUEST_TIMEOUT` | API 请求超时 (秒) | `120` |
| `VIDEO_POLL_TIMEOUT` | 视频生成轮询超时 (秒) | `1800` |

---

## 技术栈

- **后端**：FastAPI + Uvicorn，单文件架构
- **前端**：纯 HTML/JS/CSS + Tailwind CDN，无框架
- **存储**：JSON 文件（无数据库依赖）
- **通信**：WebSocket（实时状态）+ SSE（流式对话）

---

## License

MIT
