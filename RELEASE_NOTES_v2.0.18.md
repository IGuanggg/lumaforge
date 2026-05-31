# LumaForge v2.0.18

智能画布角色设定板与尺寸稳定版。

## 更新重点

- 智能画布默认出图配置调整为 `gpt-image-2-vip / 16:9 / 1K`。
- 后台尺寸映射修正：`1K + 16:9` 按 `1920x1080` 提交，`2K + 16:9` 按 `2560x1440` 提交，`4K + 16:9` 按 `3840x2160` 提交；前台仍保持简洁的 `1K / 2K / 4K` 显示。
- “角色三视图”入口升级为角色设定板工作流，输出节点保持 16:9，内置提示词覆盖半身、全身、侧面、背面和表情头像。
- 生成节点的提示词草稿、模型参数、比例和分辨率会随节点保存，切换节点或刷新后不丢。
- 生成参数面板补充实际请求尺寸、比例、档位和运行参数，方便排查与复用。
- 素材库回捞和任务匹配增强，图片已经在素材库生成时，智能画布能更可靠地同步完成结果。
- 后端异步生图任务会写入任务 ID，素材详情与参数复用更容易追踪来源。

## 发布包

- `LumaForge-2.0.18-desktop.zip`：桌面自动更新包。
- `LumaForge-Setup-2.0.18.exe`：Windows 一键安装器。
- `lumaforge-browser-v2.0.18.zip`：浏览器/源码运行包。
- `LumaForge-2.0.18-macos.zip`：macOS 包，需要在 macOS 或 GitHub Actions macOS runner 构建。

## 安装与升级说明

- Windows 用户优先使用 `LumaForge-Setup-2.0.18.exe`。
- 已安装桌面版可通过应用内更新使用 `LumaForge-2.0.18-desktop.zip`。
- 更新器只替换程序文件，不覆盖本地 `data`、`assets`、`logs`、`cache`、`updates` 等用户数据目录。
- macOS 版本不能在 Windows 上本机构建，可通过 GitHub Actions 的 `Build macOS Release` workflow 构建。

## 验证

- Python 编译检查。
- HTML 内联脚本语法检查。
- `scripts/check_release.ps1 -Version 2.0.18`。
- 智能画布角色设定板模板、默认模型、16:9/1K 尺寸映射、参数保存与素材回捞链路检查。

## SHA256

构建完成后填写：

- `LumaForge-2.0.18-desktop.zip`：`FDB372825663A3B6C01FAEC6C622E81147111D080833DB50830719E95D9CC506`
- `LumaForge-Setup-2.0.18.exe`：`487C029E4125900B88F3E4E42548C107DA94A4D4CDCE48F4B37BC93EBB3A6C26`
- `lumaforge-browser-v2.0.18.zip`：`A7DE0563E4A35454B8F05BC8FC3BE46B82A41A17B60FD5DE4A02694D8BAA504C`
