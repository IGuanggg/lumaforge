# Infinite Canvas

本地部署的 AI 创作工作台。无限画布 + 节点连线，统一调度 ComfyUI、在线 API、LLM 完成图文视频生成。

> 当前版本：v1.0.5

---

## 下载

| 版本 | 说明 | 大小 |
|------|------|------|
| [桌面窗口版](https://github.com/IGuanggg/Infinite-Canvas/releases/download/v1.0.5/Infinite.Canvas.Desktop.zip) | 独立窗口，无终端，推荐正式使用 | ~27 MB |
| [浏览器版](https://github.com/IGuanggg/Infinite-Canvas/releases/download/v1.0.5/Infinite.Canvas.Browser.zip) | 打开浏览器，有终端窗口，推荐调试 | ~22 MB |

桌面版需要 [Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 11 自带，Win10 可能需安装）。

下载后解压，双击 `Infinite Canvas.exe` 即可运行。

---

## 核心功能

### 无限画布节点系统
- 自由拖拽、缩放、连线的无限画布
- 节点类型：生图、视频、LLM 对话、提示词、循环计数、ComfyUI 工作流
- 节点连线自动级联运行，支持一键从输出端触发整条链路
- 多画布管理，回收站保留 30 天

### 文生图统一入口
- 一个节点统一调用本地 ComfyUI 或在线 API
- 支持选择参考图、模型、平台、比例、分辨率
- 支持 2K/4K 高分辨率
- 图生图、LoRA 调用

### 图片编辑与增强
- 角度控制（angle）：基于参考图调整视角
- 细节增强（enhance）：ComfyUI 工作流放大细节
- Klein 增强：ModelScope FLUX.2-klein 专用链路
- 图片局部重绘（edit）：带 mask 的图生图

### 视频生成
- 模型支持：Veo 2/3/3.1、Sora 2、通义万相 wan2.x、豆包 Seedance
- 首尾帧控制、参考图输入、视频续写
- APIMart 异步协议（失败不扣费）

### LLM 对话
- 多平台 Chat 模型（OpenAI 兼容协议）
- 图片输入（Vision 多模态），可反推提示词
- 流式输出（SSE）
- 对话历史持久化

### 素材库与提示词库
- 本地素材库：上传图片/视频，自动缩略图，标签筛选
- 提示词库：保存常用提示词，画布节点直接引用

### 账户中心与云端同步
- 注册/登录，邮箱验证（6 位数字验证码）
- 头像上传
- 云端配置同步：画布、对话、API 设置自动上传到云后端
- 云备份/恢复/导出

### ComfyUI 工作流管理
- 自定义工作流上传
- 可视化字段配置（文本、数字、下拉、布尔）
- 工作流在画布中作为节点调用
- 支持多 ComfyUI 后端负载均衡

### API 平台管理
- 多平台配置，一键拉取模型列表
- 自动分类（图片/对话/视频）
- 协议验证（OpenAI / APIMart 异步）
- 独立 API Key 管理，密钥脱敏显示

---

## 源码运行

### 环境要求
- Python 3.10+
- ComfyUI（可选，用于本地生图）

### 安装

```bash
pip install -r requirements.txt
```

离线安装（使用 packages/ 目录下的 wheel 包）：

```bash
pip install --no-index --find-links=packages -r requirements.txt
```

### 启动

```bash
python main.py
```

或使用 launcher（自动选端口、自动开浏览器、仅监听 127.0.0.1）：

```bash
python launcher.py
```

### API Key 配置

启动后在网页「API 设置」中配置，或手动编辑 `API/.env`：

```
MODELSCOPE_API_KEY=your_key_here
```

---

## EXE 打包（Windows）

### 桌面窗口版（推荐发布）

```bash
build_desktop.bat
```

产物：`dist/Infinite Canvas Desktop/`（整个文件夹打包分发）

数据目录：
- 运行时：`%APPDATA%\Infinite Canvas\`
- 图片/视频：`%USERPROFILE%\Pictures\Infinite Canvas\`
- 日志：`%LOCALAPPDATA%\Infinite Canvas\logs\`

验证构建：
```bash
dist\Infinite Canvas Desktop\Infinite Canvas.exe --smoke-test
```

### 浏览器版（调试备用）

```bash
build_windows.bat
```

产物：`dist/Infinite Canvas/`，数据在 EXE 旁边的 `userdata/`。

---

## Docker 部署（主应用）

```bash
cp .env.example .env   # 编辑配置
docker compose up -d --build
```

升级：

```bash
docker compose pull
docker compose up -d
```

数据通过 `./userdata:/app/userdata` 卷挂载持久化，升级不丢失数据。

---

## Docker 部署（云后端）

云后端提供账户管理、邮箱验证、配置同步、云备份功能。

```bash
cp .env.cloud.example .env.cloud   # 编辑 SMTP、管理员密码等
docker compose -f docker-compose.cloud.yml up -d --build
```

验证：

```bash
curl https://your-cloud-domain/version
# → {"name":"infinite-canvas-cloud","version":"1.0.5"}
```

---

## 环境变量

### 主应用

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_RUNTIME_DIR` | 运行时数据目录 | `%APPDATA%\Infinite Canvas`（桌面版）或 `./userdata` |
| `APP_ASSETS_DIR` | 图片/素材目录 | `%USERPROFILE%\Pictures\Infinite Canvas`（桌面版） |
| `APP_PORT` | 服务端口 | `3000` |
| `APP_ACCESS_TOKEN` | 远程访问令牌 | `change-me` |
| `MODELSCOPE_API_KEY` | ModelScope API Key | 空 |
| `COMFLY_API_KEY` | 默认 API 平台 Key | 空 |
| `COMFLY_BASE_URL` | 默认 API 平台地址 | `https://ai.comfly.chat` |
| `COMFYUI_INSTANCES` | ComfyUI 后端（逗号分隔） | `127.0.0.1:8188` |
| `CLOUD_SYNC_BASE_URL` | 云后端地址 | `https://image-cloud.0909106.xyz` |
| `MAX_UPLOAD_SIZE_MB` | 上传大小限制 (MB) | `50` |
| `CORS_ORIGINS` | CORS 来源（逗号分隔） | `*` |

### 云后端

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLOUD_APP_VERSION` | 版本号 | `1.0.5` |
| `CLOUD_PUBLIC_URL` | 公网 HTTPS 地址 | 空 |
| `SMTP_HOST` / `SMTP_PORT` | 邮件服务器 | 空 / `587` |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | 邮件账号 | 空 |
| `CLOUD_ADMIN_USERNAME` | 初始管理员账号 | `admin` |
| `CLOUD_ADMIN_PASSWORD` | 初始管理员密码 | `admin` |
| `CLOUD_EMAIL_DEV_MODE` | 开发模式（返回验证码） | `0` |

完整变量见 `.env.example` 和 `.env.cloud.example`。

---

## 数据目录与安全

运行时数据位置取决于启动方式：

| 方式 | 数据目录 |
|------|---------|
| 桌面版 EXE | `%APPDATA%\Infinite Canvas\` |
| 浏览器版 EXE | EXE 旁边的 `userdata/` |
| 源码 / Docker | 项目根目录的 `userdata/` 或容器卷 |

目录结构：

```
(API 或 userdata)/
  API/.env              # API 密钥（不提交 git）
  data/
    conversations/      # 对话历史
    canvases/           # 画布数据
    api_providers.json  # 平台配置
    assets.db           # 素材库数据库
  output/               # 生成的图片/视频
  assets/
    input/              # 上传的图片
    output/             # AI 参考图
    thumbs/             # 缩略图
  workflows/            # 工作流（内置 + 自定义）
  history.json          # 生成历史
  global_config.json    # 全局配置
```

### 安全说明

- EXE / launcher 模式仅监听 `127.0.0.1`，局域网不可访问
- Docker 默认绑定 `127.0.0.1`，需显式配置才能对外暴露
- `main.py` 直接启动监听 `0.0.0.0`，远程访问需 `APP_ACCESS_TOKEN`
- API Key 脱敏返回，路径遍历防护，上传大小限制
- `.gitignore` 已排除所有敏感文件和运行时数据

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | FastAPI + Uvicorn，单文件架构 |
| 前端 | 纯 HTML/JS/CSS + Tailwind CDN |
| 存储 | JSON 文件 + SQLite（素材库/云后端） |
| 通信 | WebSocket（实时状态）+ SSE（流式对话） |
| 打包 | PyInstaller + pywebview（桌面窗口） |
| 容器 | Docker + docker compose |

---

## 常见问题

**Q: 桌面版打不开 / 白屏？**
A: 确认已安装 Edge WebView2 Runtime（Win11 自带，Win10 需安装）。运行 `Infinite Canvas.exe --smoke-test` 查看诊断。日志在 `%LOCALAPPDATA%\Infinite Canvas\logs\desktop.log`。

**Q: 报错 `Failed to load Python DLL`？**
A: EXE 和 `_internal` 文件夹必须在一起。不能单独复制 EXE，需要整个文件夹一起分发。

**Q: ComfyUI 连不上？**
A: 确认 ComfyUI 已启动且监听正确端口。多后端用逗号分隔：`COMFYUI_INSTANCES=127.0.0.1:8188,192.168.1.100:8188`

**Q: API 调用失败？**
A: 在「API 设置」中检查 Key 是否配置，点击「测试连接」验证。

**Q: Docker 升级后数据丢失？**
A: 确认 `docker-compose.yml` 中 volumes 配置正确，`userdata/` 目录已挂载。

**Q: 云后端邮箱验证收不到邮件？**
A: 检查 `.env.cloud` 中 SMTP 配置。开发环境可开启 `CLOUD_EMAIL_DEV_MODE=1`。

**Q: 如何备份数据？**
A: 桌面版备份 `%APPDATA%\Infinite Canvas\`。浏览器版备份 `userdata/`。云后端备份 `cloud-data/`。

---

## 发布状态

当前版本 **v1.0.5**。

- 核心功能完整
- 安全加固已完成（认证、脱敏、路径防护、异步架构）
- 桌面窗口版 EXE 已验证
- 浏览器版 EXE 已验证
- Docker 部署已验证
- 云后端已部署运行

---

## License

MIT
