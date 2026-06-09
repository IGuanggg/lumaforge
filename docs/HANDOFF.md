# LumaForge 项目交接文档

更新时间：2026-06-09

这份文档给后续新对话或新接手的开发者快速上手用。重点不是“项目介绍”，而是当前 LumaForge 的真实状态、用户习惯、稳定性红线、构建发布流程，以及最近反复踩过的坑。

## 1. 项目身份

- 中文名：光绘工坊
- 英文品牌：LumaForge
- GitHub 仓库：`IGuanggg/lumaforge`
- 前端包名：`lumaforge`
- 云后端服务名：`lumaforge-cloud`
- 云后端 Docker 镜像：`iguang9881/lumaforge-cloud`
- Windows 桌面主程序：`LumaForge.exe`
- Windows 更新器：`LumaForgeUpdater.exe`
- 当前主版本方向：`v2.1.x`

LumaForge 是本地优先的 AI 创作工作台。核心是智能画布、出图工作台、视频创作台、提示词库、我的素材、API 设置、应用设置、云账户同步和桌面自动更新。

用户当前重点是：智能画布对标 LibTV 一类的创作画布，但主力还是出图，其次才是视频。稳定性优先，其次才是便利和新功能。

## 2. 当前架构

v2.1.0 是架构级重构版本，以 `new新的infinite-canvas-0.2.4-copy.zip` 的 Go + Next.js 项目作为新主体，同时保留旧 LumaForge 的关键资产。

主要组成：

- Go 后端：`main.go`、`router/`、`handler/`、`service/`
- Next 前端：`web/`
- 旧 Python 兼容后端：`main.py`
- 云后端：`cloud_config_server.py`
- 桌面启动器：`desktop_launcher.py`
- 桌面更新器：`desktop_updater.py`
- 发布检查脚本：`scripts/check_release.ps1`

桌面 v2.1 运行逻辑：

- 优先启动 Go + Next 主体。
- 同时隐藏启动 legacy FastAPI 兼容服务。
- `desktop_launcher.py` 会把 legacy 地址通过 `LUMAFORGE_LEGACY_API_URL` 传给 Go 主体。
- 如果 v2.1 runtime 缺失，才回退旧 Python 本地服务。

## 3. 必须保留的旧项目核心

以下能力不能被源码包原逻辑覆盖：

- 云账户和同步：
  - `cloud_config_server.py`
  - `Dockerfile.cloud`
  - `docker-compose.cloud.yml`
  - `requirements-cloud.txt`
- API 设置权威来源：
  - `data/api_providers.json`
  - `api_provider_keys.json`
  - 多 API 平台
  - VIP / 非 VIP 模型选择
  - 模型拉取
  - 连接测试
  - 手动检测
- 设置页更新模块：
  - 当前版本
  - Build ID
  - 最新版本检测
  - Release Notes
  - 下载更新
  - 安装更新
  - 重启应用
  - 忽略 3 天 / 不再提醒 / 取消
- 桌面 EXE 和自动更新：
  - 自动更新优先使用 GitHub Release 的 desktop zip
  - 不能只依赖 Setup exe
  - 更新器只替换程序文件，不覆盖用户数据
- 旧用户数据：
  - API 设置
  - API Key
  - 云登录会话
  - 素材库图片
  - 画布数据
  - 更新状态
  - 日志和缓存

## 4. 用户数据红线

Old-version compatibility requirements:

安装器和更新器不能覆盖这些真实用户数据目录：

- `%APPDATA%\LumaForge`
- `%USERPROFILE%\Pictures\LumaForge`
- `%LOCALAPPDATA%\LumaForge`

更新时保护目录：

- `API`
- `data`
- `assets`
- `logs`
- `cache`
- `cloud-data`
- `releases`
- `updates`
- `userdata`
- `output`

迁移原则：

- 只能读取、复制、导入。
- 不能删除旧数据。
- 不能清空旧画布、素材、API provider、API key、云会话。
- 不能覆盖用户修改过的文件。
- 迁移报告写入 `migration-2.1.0.json`。
- Next 端一次性迁移标记：`localStorage["lumaforge:v21_migration_done"]`。

旧版本用户升级到新版本后，版本号变了但 UI 残留老页面的问题曾经出现过。发布前必须确认新版本不会保留旧状态框、多角度生图等已经删除的旧 UI。

## 5. 云后端兼容

云账户以 LumaForge Cloud 为唯一来源，不使用源码包自带本地用户表接管真实账号。

必须保持老版本客户端可继续调用：

- `/api/auth/*`
- `/api/me`
- `/api/configs/current`
- `/api/media/*`

云数据库迁移只能 additive schema migration：

- 不重建数据库。
- 不清空表。
- 不改旧字段含义。
- 升级前保留 `cloud_config.db` 快照。

当前云后端已部署升级过。后续更新 Docker 时用户要求：

- 构建 DockerHub amd64 + arm64 双架构镜像。
- 只更新 Docker 容器，不覆盖 `/opt/lumaforge-cloud` 数据。
- 可以使用 Watchtower，但仍要确认 volume 挂载安全。

## 6. API 设置要求

用户非常重视多 API 平台机制。

要求：

- `/api-settings` 是 Next 原生页面，不再主用 iframe。
- UI 风格统一到 LumaForge 新界面。
- 保留平台列表、添加、删除、启用、停用、主平台。
- 保留 Base URL、协议、Key 保存/清除、Key 诊断、连接测试、异步检测、拉模型。
- 手动编辑 image/chat/video 模型。
- 前端不能显示完整 API Key，只显示 `has_key` 和 `key_preview`。
- 云端 API Key 应该能恢复到本地，用户之前反馈过云端 API Key 全没了。
- 本地已有 Key 时，云端下载不能清空本地 Key。

模型选择要求：

- 生成时显示“平台名称 / 模型名称”。
- 内部 value 使用 `providerId::modelName`。
- 旧数据只有 `modelName` 时继续可用。
- 后端 `SelectModelChannel` 优先解析 `providerId::modelName` 精确命中 provider。
- 请求上游时只发送真实 `modelName`。
- 同名模型在不同平台存在时不能走错平台。

默认出图设置：

- 模型：`gpt-image-2-vip`
- 比例：`16:9`
- 质量：`1K`
- 显示只显示 `1K / 2K / 4K`，不需要显示后面的像素尺寸。

## 7. 智能画布交互标准

用户多次强调旧版画布交互要保留。当前标准：

- 左键：选择节点 / 空白处框选。
- 左键点空白未拖动：清空选中。
- 中键拖动：平移画布。
- 空格 + 左键拖动：平移画布。
- 普通滚轮：滚动画布视图。
- Ctrl / Alt + 滚轮：缩放画布。
- 右键：节点属性/菜单；空白处如果已有选中图，也能打开属性入口。
- Ctrl / Cmd + A：全选节点。

不要再写“左键拖动画布”或“中键框选节点”这类旧错文案。

画布缩放体验要求：

- 参考旧版 LumaForge。
- 画布放大/缩小时，节点内部布局要实时刷新。
- 图片区域相对变小，文本输入区相对变大。
- 不需要重新点击节点才刷新。
- 输入框要有展开/收起能力。
- 空白区域点击后，节点输入框可以收起，不要一直展开。

连线体验要求：

- 连线动效参考无限画布源码，流动线不要过快、不要断断续续。
- 连线时源节点、候选目标、hover 目标要有高亮/反馈。
- 连接命中节点要可靠，不能看起来连到了但实际没连接上。
- 连线中间删除按钮要灵敏，增大透明命中区域。
- 删除后要保存连接状态。

节点要求：

- 每个节点都可以命名。
- 双击节点名可编辑。
- 节点名等于图片名。
- 保存图片到素材库时使用节点名。
- 同名保存自动追加 `-2`、`-3`。
- 节点名过长时必须省略，不遮挡按钮或图片。

## 8. 智能画布功能状态

已做或近期做过的功能：

- 多图生成部分成功策略。
- 任务 failed 时从 task.result / 素材库回捞成功图片。
- 粘贴到节点输入框只保留纯文本，不带外部富文本样式。
- 图片参数按钮改为紧凑三段摘要：质量 / 比例 / 张数。
- 节点下载按钮可见性修复。
- 图片保存进入我的素材和旧素材库。
- 组节点可折叠/展开。
- 多宫格拆分。

多宫格拆分要求：

- 不叫“九宫格”，统一叫“多宫格”。
- 点击后弹出“多宫格拆分”弹窗。
- 默认 `3 x 3`。
- 行数和列数范围 `1-6`。
- 支持滑杆拖动，也保留数字输入。
- 显示预览网格。
- 确认后按原图像素切割。
- 生成子图片节点并连接到源节点。
- 子节点标题使用 `源节点名-1` 到 `源节点名-N`，重复自动加后缀。

角色设定板方向：

- 用户原本说“角色三视图”，但实际希望是“角色设定板”。
- 可保留入口名“角色三视图”，实际内容按角色设定板执行。
- 默认 `gpt-image-2-vip / 16:9 / 1K`。
- 角色设定板提示词要比简单模板更完整，参考用户给过的这段：

```text
16∶9构图 根据我上传的参考图，生成一张同一人物的角色设定板，保持人物脸型、五官、发型、服装风格、配色和气质一致。画面包含正面半身近景、正面全身、侧面站姿、背面站姿，以及底部5种表情头像：微笑、惊讶、傲慢、愤怒、哭泣。整体为专业影视/游戏角色设定图，浅灰干净背景，古风宫廷/仙侠美学，服装材质精致，发饰华丽，细节清晰，同一角色一致性强，高清，干净构图，无文字水印。
```

## 9. 我的素材要求

我的素材页要承接旧版素材库和云端素材：

- 旧素材图片要能看到。
- 新生成图片要进入节点、我的素材、旧素材库、素材详情参数、下载入口。
- 缺失文件只提示，不删除记录。
- 云端图片要能恢复到我的素材。
- 素材同步功能参考旧版本。
- 我的素材页面风格要和新 UI 统一。

素材详情和生成参数应保留：

- `provider_id`
- `provider_name`
- `model`
- `model_display`
- `size`
- `quality`
- `prompt`
- `nodeId`

## 10. 账户登录和账号抽屉

用户反馈右上角账户登录/账号设置反应慢。

当前优化方向：

- 头像点击后账户抽屉先打开，不等待云端接口。
- 云状态后台刷新。
- 云媒体状态延迟请求。
- 账户状态做短缓存，避免频繁点击反复请求。
- 云端请求要有超时提示，不能让 UI 一直卡。

账户抽屉应包含：

- 邮箱验证。
- 昵称/头像修改。
- 修改密码。
- 上传配置。
- 下载配置。
- 同步素材。
- 恢复云素材。
- 本地/云端素材数量。
- 退出登录。

不要让 Linux.do 入口再出现在产品 UI。

## 11. 应用设置和更新模块

应用设置页要求：

- UI 颜色和其他页面统一，暗色模式下也要暗调。
- 右上角图标使用齿轮。
- 各种文件夹路径、保存路径、打开目录按钮要和后端连上。
- GitHub 图标点击应调用系统浏览器打开，不在软件内跳转影响当前页面。

更新模块要求：

- 打开发现有新版本会提醒。
- 可选择立即更新、下一次更新、忽略 3 天、不再提醒、取消。
- 自动更新优先下载 desktop zip。
- 更新后能重启应用。
- 老版本自动升级必须能找到新版本。
- 版本号上去后不能保留旧 UI 残余。

## 12. 用户审美和协作习惯

用户对 UI 很敏感，会直接指出“排版太丑”“风格不搭”。默认不要做营销式大卡片堆叠，要做工具型、干净、统一、耐用的界面。

偏好：

- 稳定第一，便利第二。
- 不要为了新功能牺牲主链路。
- 发现问题要严格审查，不要只说“应该可以”。
- 可以借鉴源码/竞品，但要“抄也抄像点”，尤其交互和视觉反馈要到位。
- 功能名要准确：比如“九宫格”应改“多宫格”。
- 文字说明必须和实际行为同步。
- 图标语义要正确，应用设置用齿轮。
- 页面风格要统一，logo 保留 LumaForge 自己的。

工作方式：

- 用户常说“继续”，一般表示接着上一个未完成计划往前做，不是重新规划。
- 用户常要求“给我构建+推送提示词”，这时要输出给另一个环境执行的完整中文发布提示词。
- 用户要求“发布吧”时，需要先检查版本、构建产物、Release Notes、GitHub Release 状态。
- 如果用户问“现在是什么步骤/下一步是什么”，要用当前项目状态回答，不要泛泛而谈。

## 13. 当前工作区状态提醒

当前工作区有大量未提交改动，很多是此前连续任务积累的。不要随便 revert。

近期改动涉及：

- Go/handler/service/router 兼容层。
- `main.py` legacy 兼容和云/API 逻辑。
- 设置页和应用更新。
- API 设置页。
- 我的素材页。
- 智能画布节点、连线、缩放、多宫格、输入框、下载、节点名。
- 登录页和账号抽屉。
- 云 API 前端服务。

新增文件：

- `web/src/app/(user)/canvas/components/canvas-node-grid-split-dialog.tsx`
- `web/src/services/api/cloud.ts`

不要因为看到很多 dirty file 就清理或回滚。必须先读 diff，确认是不是当前需求相关。

## 14. 最近已验证的命令

本地便携工具链：

- Bun：`%LOCALAPPDATA%\LumaForgeDevTools\bun-v1.3.13\bun.exe`
- Go：`%LOCALAPPDATA%\LumaForgeDevTools\go1.25.11\bin\go.exe`

常用检查：

```powershell
& "$env:LOCALAPPDATA\LumaForgeDevTools\bun-v1.3.13\bun.exe" run build
& "$env:LOCALAPPDATA\LumaForgeDevTools\go1.25.11\bin\go.exe" test ./...
python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py
git diff --check
```

发布检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_release.ps1 -Version 2.1.0 -BuildId 20260605-v210-source-refactor1
```

旧版本升级验收：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_v21_upgrade.ps1
```

乱码扫描建议：

- 用 `rg` 扫常见 mojibake 片段、替换字符和连续问号。
- 排除 `web/.next`、`web/node_modules`、`node_modules`、`python`、`.git`、构建产物和图片文件。
- 不要把扫描正则原样写进仓库文档，否则文档本身会被后续扫描命中。

注意：PowerShell 路径里有 `(user)` 时要加引号，否则会被当成表达式。

## 15. 构建和发布原则

发布小版本时必须：

- bump 版本号。
- 更新 Build ID。
- 写中文 Release Notes。
- 构建浏览器/源码运行包。
- 构建 Windows desktop zip。
- 构建 Windows setup exe。
- 计算 SHA256。
- 如 macOS 本机不能构建，Release Notes 写清 GitHub Actions macOS workflow 或后续上传位置。
- GitHub Release 上传 desktop zip 和 setup exe。

自动更新要依赖 desktop zip，不要只发 setup exe。

## 16. Docker 云后端部署要点

用户有 Watchtower，可以用它更新，但需要保证数据 volume 不被覆盖。

典型部署要求：

- 镜像：`iguang9881/lumaforge-cloud`
- 宿主数据目录：`/opt/lumaforge-cloud`
- 容器端数据目录保持原 compose 约定。
- 更新前备份 `cloud_config.db`。
- 推送 amd64 + arm64 双架构。

更新容器前检查：

```bash
docker ps
docker inspect lumaforge-cloud
docker volume ls
ls -lah /opt/lumaforge-cloud
```

Watchtower 可以用，但最好先手动确认镜像 tag 和 volume，再让 Watchtower 拉新镜像。

## 17. 当前高优先级风险

1. 老版本升级到新版本后 UI 残留。
   - 需要重点验收缓存、静态文件、WebView 存储、更新包覆盖规则。

2. 云端 API Key 恢复。
   - 用户明确反馈过云端 API Key 没恢复。
   - 必须确认 `/api/cloud/download`、`/api/providers/key-diagnostics` 和 API 设置页状态提示。

3. 账号抽屉和云同步速度。
   - 当前策略是先打开抽屉，后台刷新。
   - 云媒体状态不能阻塞 UI。

4. 智能画布连线动效和连接命中。
   - 用户仍可能继续追连线体验。
   - 参考旧版/源码，不要只改 CSS。

5. 我的素材旧数据和云数据承接。
   - 旧素材、云素材、生成参数、下载入口都要可见可用。

6. 乱码。
   - v2.1 修复过程中出现过多处 mojibake。
   - 每次改中文文案后都要跑扫描和 build。

## 18. 下一步建议

如果新对话继续开发，建议顺序：

1. 先跑构建和乱码扫描，确认当前工作区健康。
2. 用浏览器打开 `/login`、`/api-settings`、`/app-settings`、`/assets`、`/canvas` 做页面走查。
3. 专门验收账号抽屉：
   - 点击头像是否秒开。
   - 邮箱验证和修改密码是否可用。
   - 下载配置是否恢复 API Key。
   - 素材同步按钮是否不阻塞 UI。
4. 专门验收智能画布：
   - 左键框选。
   - 中键拖动。
   - Ctrl/Alt+滚轮缩放。
   - 连线反馈和命中。
   - 多宫格弹窗滑杆。
   - 节点名和下载名。
5. 做一次旧数据复制升级验收，不要直接写真实用户目录。

## 19. 给新对话的快速提示词

可以直接把下面这段发给新对话：

```text
请先阅读 docs/HANDOFF.md，按里面的项目规则继续开发 LumaForge。重点：稳定第一；不要覆盖旧用户数据；保留云账户/API 设置/自动更新；智能画布交互按旧版逻辑；不要显示 Linux.do；中文 UI 不要乱码；工作区有很多既有改动，禁止随意 revert。先运行构建和乱码扫描确认状态，再根据我的最新需求继续。
```
