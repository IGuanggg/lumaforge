# LumaForge v2.0.20

v2.0.20 是智能画布稳定体验版。本次不新增高风险生成能力，重点把 v2.0.19 的任务中心和素材回捞链路继续打磨到更容易自救、更清楚、更不容易误触。

## 更新内容

- 任务中心新增批量操作：匹配全部、重试失败、检查缺失。
- 批量匹配只读取本地素材库一次，不会自动触发新的生成请求。
- 缺失图片占位增加“匹配素材”和“忽略”操作，避免节点只剩空白或红色提示。
- 智能画布节点增加状态角标，可直观看到运行中、失败、缺失、完成、历史和锁定状态。
- 优化左上角“画布列表”和“任务”入口排版，减少对画布内容的遮挡。
- 修复任务入口、任务面板被画布鼠标逻辑误判为空白区域的问题，避免误触发框选、右键菜单或缩放预览退出。
- README、设置页欢迎卡、打包文档和发布检查目标更新到 v2.0.20。

## 验收重点

- 智能画布打开后左上导航不重叠、不压住主要内容。
- 点击任务按钮只打开任务面板，不触发画布框选。
- 任务中心可显示批量操作按钮，并保留单节点定位、匹配素材、重试。
- 缺失图片节点可尝试匹配素材库结果，也可临时忽略。
- 节点状态角标不影响图片删除、参数查看、右键菜单和拖拽。
- 不新增自动 API 探活，不引入反复请求上游的行为。

## 构建产物

- `LumaForge-2.0.20-desktop.zip`：桌面自动更新包。
- `LumaForge-Setup-2.0.20.exe`：Windows 一键安装器。
- `lumaforge-browser-v2.0.20.zip`：浏览器/源码运行包。
- `LumaForge-2.0.20-macos.zip`：macOS 包，需要在 macOS 或 GitHub Actions macOS runner 构建。

## 发布前检查

- `python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py`
- `scripts/check_release.ps1 -Version 2.0.20`
- 智能画布本地页面检查：任务入口、任务面板、节点渲染和控制台错误。

## SHA256

- `LumaForge-2.0.20-desktop.zip`：`8AB3D872652A1638328764A7963E5AA0515886E04177B8FA6BFF28F0D5255BAB`
- `LumaForge-Setup-2.0.20.exe`：`E7690579B7D51504B8D4587DEC861D35001C8FA190868FD32A6E7EEE51739D08`
- `lumaforge-browser-v2.0.20.zip`：`EC843BD9CC65C5BAA409F86C1EC889F2A001FDBF0B8940DD4337718F2A22B4E5`
