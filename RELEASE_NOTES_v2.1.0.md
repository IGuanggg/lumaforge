# LumaForge v2.1.0 源码主线重构版

v2.1.0 是一次架构级重构：引入 Go + Next.js 画布主体作为新的智能画布创作界面，同时保留 LumaForge 原有云端账户、API 设置、设置页更新模块和桌面自动更新基础。

## 更新内容

- 新增 Go + Next.js 主体工程，作为后续智能画布主线。
- 保留原 LumaForge API 设置页面，并接入 Go API provider 兼容接口。
- 保留原设置页自动检测更新、更新状态、Release Notes、下载/安装入口。
- `/api/auth/*` 已映射到 LumaForge 云端账户，不以源码包本地用户表作为真实账户来源。
- `/api/cloud/*` 保留云登录、配置上传/下载和媒体同步入口。
- 默认出图配置保持 `gpt-image-2-vip`、`16:9`、`1K`。
- 首次启动写入 `migration-2.1.0.json` 迁移报告，旧数据只复用不删除。
- 新增 v2.1 旧画布迁移接口，首次进入新前端时自动只读导入旧画布，刷新或重启不会重复导入。
- 新版素材入口兼容旧素材库字段，旧素材图片可继续显示、插入和下载；`/assets/*` 和 `/output/*` 历史图片路径会通过 Go + Next 代理继续可用。
- 删除 Linux.do 登录入口和公开路由，历史字段保留为兼容数据，不做破坏性清理。
- API 设置和应用设置以新 LumaForge 外壳承载，保留原页面逻辑，统一页面观感。
- 新增真实旧数据复制验收脚本，发布前可验证旧账号/API/素材/画布数据升级到 v2.1 后不丢失，且不写入真实用户目录。
- Windows 桌面包预留 v2.1.0 运行结构：`v21/server.exe`、`web/server.js`、`node/node.exe`，启动器优先启动 Go + Next 主体。
- 桌面启动器会同步启动 legacy FastAPI 兼容服务，自动更新、备份、诊断、深度素材维护接口可继续代理到旧能力。
- 保留 Python `cloud_config_server.py` 作为 LumaForge Cloud 权威后端。

## 注意事项

- 这是 2.1.0 重构起点，旧版深度资产检查、完整桌面替换安装仍优先通过 legacy Python API 兼容服务执行。
- 自动更新仍要求 GitHub Release 上传 desktop zip，不能只上传安装器 EXE。
- 自动更新只替换程序文件，不覆盖 `%APPDATA%\LumaForge`、`%USERPROFILE%\Pictures\LumaForge` 和 `%LOCALAPPDATA%\LumaForge`。
- 旧版本用户升级时不迁移、不清空云端注册用户表；LumaForge Cloud 的 `cloud_config.db` / `cloud-data` 继续作为账号、邮箱验证、云配置和云素材记录的唯一来源。
- 已安装旧版的用户继续保留本地登录会话、API 设置、素材、画布、备份、更新状态和日志；首次启动只写入 `migration-2.1.0.json` 报告，不覆盖旧数据。
- 引入的 infinite-canvas 源码遵循 AGPL 授权，授权文件已保留为 `LICENSE.infinite-canvas-AGPL`。

## 验收重点

- Go API 能启动，Next 能构建。
- API 设置页能读取、保存 provider，并拉取模型。
- 设置页能显示版本、Build ID、更新状态和更新检查结果。
- 登录云账户后能保留 token，并能上传/下载云配置。
- 新画布默认模型为 `gpt-image-2-vip`，比例为 `16:9`，质量为 `1K`。
- 使用旧版本账号登录 v2.1.0 时，应继续走 LumaForge Cloud；不要落到源码包本地用户表。
- 产品 UI 和公开路由中不再出现 Linux.do。
- 旧版画布导入后刷新页面不重复，旧数据文件不被修改。
## 发布产物校验

| 文件 | 大小 | SHA256 |
| --- | ---: | --- |
| lumaforge-browser-v2.1.0.zip | 2.0 MB | `FECAB98CF2F23D7717B012312F82FBFCD880339445CBEF4B8B13C1FCA1F3CBA0` |
| LumaForge-2.1.0-desktop.zip | 113.4 MB | `551F16E2232CBE03902AF744B700996A2D0C7D6DB991FD8A2AF7924D8EC78AF0` |
| LumaForge-Setup-2.1.0.exe | 84.9 MB | `9444B5C8D84697CC59DBE865784419F89C71DA3056B58D7875DCD59F01BBD979` |
