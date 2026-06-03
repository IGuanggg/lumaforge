# LumaForge v2.0.21

v2.0.21 是智能画布稳定修复版。本次不新增高风险功能，重点修复多图生成、节点 loading、鼠标操作、连线删除和输入框粘贴上的稳定性问题。

## 更新内容

- 修复多图生成时，一张上游失败会导致其他成功图片也被卡住的问题；成功图片会正常保存、进入素材库/历史并回填节点。
- 智能画布任务失败时，会先从任务结果和素材库回捞已完成图片，避免节点永久 loading。
- 调整智能画布鼠标操作：左键选择/框选，空格+左键拖动画布，滚轮缩放，右键打开属性。
- 修复节点输入框粘贴外部文字时带入加粗、字号、字体等样式的问题，统一按纯文本粘贴；图片粘贴逻辑保持不变。
- 修复连线中间删除键不灵敏的问题，增大命中区域并优化删除触发，删除后会保存画布连接状态。
- README 和交接文档同步新的智能画布快捷键说明。

## 验收重点

- 节点一次生成 2 张图片，其中 1 张失败时，另一张成功图片能正常回填节点。
- 失败任务不会让节点永久 loading。
- 连线中间删除键点击后能立即删除并保存。
- 空格+左键可以拖动画布，左键仍用于选择/框选。
- 粘贴到生成输入框的文字不会带外部样式。

## 构建产物

- `LumaForge-2.0.21-desktop.zip`：桌面自动更新包。
- `LumaForge-Setup-2.0.21.exe`：Windows 一键安装器。
- `lumaforge-browser-v2.0.21.zip`：浏览器/源码运行包。
- `LumaForge-2.0.21-macos.zip`：macOS 包，需要在 macOS 或 GitHub Actions macOS runner 构建。

## 发布前检查

- `python -m py_compile main.py cloud_config_server.py launcher.py desktop_launcher.py desktop_updater.py`
- 全量静态 HTML inline script 检查。
- `scripts/check_release.ps1 -Version 2.0.21`

## SHA256

- `LumaForge-2.0.21-desktop.zip`：`112FB65096EE85DA988D35F04B32422436F092D234C8F4E73326FC234F4116B6`
- `LumaForge-Setup-2.0.21.exe`：`752ADF7C0A0AF48EB871883088ABC6408A938D51EFAD8714F434D2FCA0CB25E2`
- `lumaforge-browser-v2.0.21.zip`：`4FA754FF4735F1B38AE02EB37C39A42A40EB62125073D82840758CF831C2C5A7`
