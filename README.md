# 光绘工坊 / LumaForge

LumaForge 是一个本地优先的 AI 创作工作台，围绕“智能画布 + 素材库 + 多模型生成 + 云同步”组织创作流程。桌面端优先保障本地数据安全，云端用于账户、配置、媒体和画布项目同步。

当前版本：`2.1.17`

## 现在的状态

v2.1.x 已经从早期 Python 单体逐步迁到 Go + Next.js 主体：

- Go API 服务负责账户、设置、素材、生成代理、更新检查、画布项目接口和本地数据维护。
- Next.js 前端负责智能画布、模板、素材库、图像、视频、API 设置和应用设置页。
- Python 桌面壳和兼容服务仍保留，用于桌面启动、打包、旧功能兼容和迁移期兜底。
- LumaForge Cloud 继续作为云端权威服务，当前支持账户、配置、媒体和画布项目同步。

> 本项目包含来自 infinite-canvas 的历史授权文件 `LICENSE.infinite-canvas-AGPL`，相关历史变更见 `CHANGELOG.infinite-canvas.md`。

## 核心功能

- 智能画布：节点式创作、拖拽连线、框选、多选、撤销/重做、画布模板、节点状态、历史结果恢复、图片节点工具条和缺失文件提示。
- 画布云同步：本地画布项目可同步到 LumaForge Cloud，支持按用户隔离、增量更新、软删除和启动时云端补水。
- 画布模板：内置角色三视图、产品三视图、分镜脚本等模板，可从模板创建新画布。
- Agent 创作：将自然语言目标拆成可编辑节点，并落地尺寸、比例、张数、模型等参数。
- GPT 对话：支持聊天和生图模式，支持临时参考图；智能画布可把参考图发送到对话。
- 文生图/在线生图：统一调用配置的 API 平台，结果优先落本地，再进入素材库。
- 素材库：图片/视频归档、预览、下载、加入画布、云端媒体同步、缩略图维护和缺失文件检查。
- 图像增强：提供高清增强、去背景、画同款、参考图复用等创作辅助。
- API 设置：平台配置、Key 诊断、模型拉取、连接测试和快捷预设。按当前项目偏好，API Key 使用本地明文 JSON 存储。
- 应用设置：版本检查、源码模式预检、轻量备份、诊断、备份列表、桌面动作和本地数据健康检查。
- 云后端：`LumaForge Cloud` 提供账户、配置同步、媒体同步、画布同步和启动前数据库安全快照。

## 项目命名

| 项目 | 名称 |
| --- | --- |
| 应用标题 | 光绘工坊 |
| 英文品牌 | LumaForge |
| GitHub 仓库 | lumaforge |
| 前端包名 | lumaforge |
| Go 模块 | github.com/IGuanggg/lumaforge |
| 后端服务名 | lumaforge-cloud |
| Docker 镜像 | iguang9881/lumaforge-cloud |
| Docker 容器名 | lumaforge-cloud |
| 云端数据目录 | /opt/lumaforge-cloud |
| 桌面程序 | LumaForge.exe |

## 本地开发

推荐本地测试入口统一使用 `http://127.0.0.1:3001`。

### 1. 启动 Go API

```powershell
go run .
```

默认监听：

```text
http://127.0.0.1:8080
```

### 2. 启动 Next.js 前端

```powershell
cd web
bun install
bunx next dev --webpack -H 0.0.0.0 -p 3001
```

常用页面：

- `http://127.0.0.1:3001/canvas`
- `http://127.0.0.1:3001/templates`
- `http://127.0.0.1:3001/assets`
- `http://127.0.0.1:3001/api-settings`
- `http://127.0.0.1:3001/app-settings`

Next API 路由会代理到 `http://127.0.0.1:8080`。

### 3. 旧 Python 本地服务

迁移期仍保留旧入口：

```powershell
pip install -r requirements.txt
python launcher.py
```

开发调试也可以直接运行：

```powershell
python main.py
```

## 质量检查

推荐发布前跑统一脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check_quality.ps1
```

脚本覆盖：

- Go 测试
- Python cloud server 单元测试
- 前端 TypeScript 检查

也可以分开运行：

```powershell
go test ./...
python -m unittest cloud_config_server_test.py
cd web
bun run typecheck
```

## 桌面版构建

Windows 桌面包需要：

- Go 1.25+
- Bun
- Node.js
- Python 3.10+
- PyInstaller
- 可选：Inno Setup 6

```powershell
.\build_desktop.bat
```

常见输出：

```text
dist\LumaForge\LumaForge.exe
releases\LumaForge-2.1.17-desktop.zip
releases\LumaForge-Setup-2.1.17.exe
```

桌面版默认数据目录：

- 运行数据：`%APPDATA%\LumaForge`
- 图片/视频/素材：`%USERPROFILE%\Pictures\LumaForge`
- 日志：`%LOCALAPPDATA%\LumaForge\logs`

## 浏览器版构建

```powershell
.\build_windows.bat
```

输出：

```text
dist\LumaForge Browser\LumaForge.exe
```

浏览器版会启动本地服务并打开系统浏览器，运行数据保存在 EXE 旁边的 `userdata/`。

## macOS 构建

macOS 包必须在 Mac 或 GitHub Actions macOS runner 上构建：

```bash
VERSION=2.1.17 bash scripts/build_macos_release.sh
```

GitHub Actions 工作流：

```text
.github/workflows/build-macos.yml
```

手动触发 `Build macOS Release` 会上传 Actions artifact。推送 `v*` tag 时，workflow 还会把 macOS zip 和 sha256 上传到对应 GitHub Release。

输出：

```text
releases/LumaForge-2.1.17-macos.zip
releases/LumaForge-2.1.17-macos.sha256.txt
```

未配置 Apple Developer 证书时，产物是未签名版本；正式公开分发建议接入 `codesign` 和 `notarytool`。

## 云后端 Docker

构建镜像：

```bash
docker build -f Dockerfile.cloud -t iguang9881/lumaforge-cloud:2.1.17 .
```

多架构推送：

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.cloud \
  -t iguang9881/lumaforge-cloud:2.1.17 \
  -t iguang9881/lumaforge-cloud:latest \
  --push .
```

首次部署：

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data

docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_CONFIG_PORT=8787 \
  -e CLOUD_APP_VERSION=2.1.17 \
  -p 8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.1.17
```

升级已有服务时，先备份 `/opt/lumaforge-cloud/cloud-data`，再替换容器。不要删除数据目录。新版本启动时会为已有数据库创建 `cloud_config.db.before-upgrade-<version>` 安全快照。

健康检查：

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/version
```

## 发布检查

发布前：

```powershell
.\scripts\check_release.ps1 -Version 2.1.17
```

GitHub Release 建议上传：

- `releases/LumaForge-Setup-2.1.17.exe`
- `releases/LumaForge-2.1.17-desktop.zip`
- `releases/LumaForge-2.1.17-macos.zip`
- 对应 SHA256 校验文件

更多发布流程和人工回归项见 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。

## 任务与文档

- 技术改进索引：[LUMAFORGE_TECH_IMPROVEMENTS.md](LUMAFORGE_TECH_IMPROVEMENTS.md)
- 旧静态页面迁移审计：[docs/LEGACY_MIGRATION_AUDIT.md](docs/LEGACY_MIGRATION_AUDIT.md)
- API 和数据边界：[docs/API_CONTRACT.md](docs/API_CONTRACT.md)
- 打包说明：[APP_PACKAGING.md](APP_PACKAGING.md)

当前 Claude 改进任务已按 `task-01-canvas-data-backup.md` 到 `task-08-canvas-enhancements.md` 跟踪。
