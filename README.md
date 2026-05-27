# 光绘工坊 / LumaForge

LumaForge 是一个本地优先的 AI 创作工作台，核心是无限画布、素材库、Agent 创作、GPT 对话、图像增强、视频生成和云同步。

当前版本：`2.0.12`

v2.0.12 是安装稳定性修复：修复安装版 SSL 证书缺失导致本地服务启动失败，加固自动更新后的关键文件校验与回滚，提升跨电脑安装/自动更新稳定性。

## 核心功能

- 智能画布：输出节点等待/失败/空结果状态明确显示；图片选中浮动工具条（高清、去背景、画笔、多角度、画同款、下载）；右键菜单补齐复制、粘贴、创建副本、发送至对话、保存到资产库、翻转、锁定等管理操作；返回列表会进入智能画布列表视角。
- 无限画布：节点式创作、拖拽连线、LLM/API/ComfyUI/Output 节点、Agent 自动规划。
- Agent 创作：把自然语言目标拆成可编辑节点，支持尺寸、比例、张数和模型参数落地。
- GPT 对话：支持聊天和生图模式，聊天可上传临时参考图，参考图不会进入素材库；智能画布支持发送参考图到 GPT 对话。
- 文生图/在线生图：统一调用 API 平台，API 生图支持 n 张并发提交，生成结果优先保存到本地，再进入素材库。
- 素材库：图片/视频归档、预览、下载另存为、加入无限画布、云端素材同步；详情页显示生成参数，支持复用 prompt、模型、尺寸等参数重新生成；资产库支持分类、添加、重命名、删除；缩略图布局优化。
- 画同款：创建可编辑图片节点并继承提示词，不自动提交生成。
- 图像增强：本地 API 增强，提供 2K / 4K 两档质量。
- API 设置：只读平台 ID 展示与复制、百炼/DashScope 快捷预设、Key 诊断与孤儿 Key 清理、首页 API 状态面板点击跳转。
- 云端账户：邮箱验证、配置自动同步、头像、密码、云端媒体同步。
- 云后端：`LumaForge Cloud`，提供账户、配置同步、媒体同步和加密数据库备份。
- 画布数据安全：保存增加备份目录，避免异常空画布覆盖已有节点；云端导入过滤无效连线。
- 应用维护：应用设置页提供本地轻量备份/恢复、启动诊断、素材库丢失文件检查、缩略图重建、v2.0.12 更新欢迎卡、诊断结果分组和更新后状态提示。

## 项目命名

| 项目 | 名称 |
| --- | --- |
| 应用标题 | 光绘工坊 |
| 英文品牌 | LumaForge |
| GitHub 仓库 | lumaforge |
| 前端包名 | lumaforge |
| 后端服务名 | lumaforge-cloud |
| Docker 镜像 | iguang9881/lumaforge-cloud |
| Docker 容器名 | lumaforge-cloud |
| 云端数据目录 | /opt/lumaforge-cloud |
| 后端标题 | LumaForge Cloud |
| EXE 名称 | LumaForge.exe |

## 本地运行

```powershell
pip install -r requirements.txt
python launcher.py
```

默认只监听本机，启动后自动打开浏览器。开发时也可以直接运行：

```powershell
python main.py
```

## 桌面版构建

```powershell
.\build_desktop.bat
```

输出：

```text
dist\LumaForge\LumaForge.exe
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

## 云后端 Docker

多架构镜像：

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.cloud \
  -t iguang9881/lumaforge-cloud:2.0.12 \
  -t iguang9881/lumaforge-cloud:latest \
  --push .
```

服务器升级部署：

```bash
mkdir -p /opt/lumaforge-cloud/cloud-data
cd /opt/lumaforge-cloud

docker pull iguang9881/lumaforge-cloud:2.0.12
docker stop lumaforge-cloud || true
docker rm lumaforge-cloud || true

docker run -d \
  --name lumaforge-cloud \
  --restart unless-stopped \
  -e CLOUD_CONFIG_DB=/app/data/cloud_config.db \
  -e CLOUD_APP_VERSION=2.0.12 \
  -p 127.0.0.1:8787:8787 \
  -v /opt/lumaforge-cloud/cloud-data:/app/data \
  iguang9881/lumaforge-cloud:2.0.12
```

不要删除 `/opt/lumaforge-cloud/cloud-data`，否则云端账户、SMTP、配置同步和备份记录会丢失。

## 发布检查

发布前运行：

```powershell
.\scripts\check_release.ps1 -Version 2.0.12
```

GitHub Release 建议同时上传：

- `releases/LumaForge-Setup-2.0.12.exe` 安装器
- `releases/LumaForge-2.0.12-desktop.zip` 桌面自动更新包
- 对应 SHA256 校验信息

发布流程和人工回归项见 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。

API 和数据边界见 [docs/API_CONTRACT.md](docs/API_CONTRACT.md)。
