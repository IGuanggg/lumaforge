# LumaForge v2.0.19

v2.0.19 是智能画布稳定闭环版。本次不继续堆大型新功能，重点修复和补齐出图链路里最影响稳定性的几个环节：任务可见、失败可重试、素材库可手动回捞、历史结果可恢复，以及图片模型选择不再强制跳回 VIP。

## 更新内容

- 智能画布新增任务中心，可查看运行中、失败和最近完成的节点。
- 任务中心支持快速定位节点、失败重试、手动从素材库匹配生成结果。
- 右键历史结果图时，可恢复到原节点，恢复前会自动把当前原节点结果归档到历史。
- 角色设定板结果支持创建表情头像、半身图、全身图复用节点，默认仍走稳定的图片生成配置。
- 修复 `gpt-image-2` 普通版会被自动切回 `gpt-image-2-vip` 的问题；默认仍优先 VIP，但用户手动选择普通版会被尊重。
- 设置页欢迎卡和发布检查目标更新到 v2.0.19。

## 验收重点

- 智能画布打开后任务按钮不遮挡主要操作。
- 失败或等待中的图片节点可在任务中心手动匹配素材库结果。
- 历史结果恢复后，原节点当前图片不会直接丢失。
- 图片模型菜单里 `gpt-image-2-vip`、`gpt-image-2`、`nano-banana-2` 都可显示，普通版选择不会被自动覆盖。
- 不新增自动 API 探活，不引入反复请求上游的行为。

## 构建产物

- `LumaForge-2.0.19-desktop.zip`：桌面自动更新包。
- `LumaForge-Setup-2.0.19.exe`：Windows 一键安装器。
- `lumaforge-browser-v2.0.19.zip`：浏览器/源码运行包。
- `LumaForge-2.0.19-macos.zip`：macOS 包，需要在 macOS 或 GitHub Actions macOS runner 构建。

## 发布前检查

- `python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py`
- 全量静态 HTML inline script 检查。
- `scripts/check_release.ps1 -Version 2.0.19`

## SHA256

- `LumaForge-2.0.19-desktop.zip`：`6F9416AF6FE62DC6FD516EFF6A8080C9381A46AE29ACF2AEDE33F3A410FCDE10`
- `LumaForge-Setup-2.0.19.exe`：`B6CD4613A6C65E6715C480328BC2EFC391386C71B5C698847E5511DBA48DBD94`
- `lumaforge-browser-v2.0.19.zip`：`5BCC0BF386174B638104EB9AF3FC60546DF0E4CA47D37F614019A601FCFB648C`
