# LumaForge v2.0.29 可见 ComfyUI 内容清理版

v2.0.29 是一个小版本整理更新，重点清理 ComfyUI 相关可见入口和文案，并继续修复项目乱码残留，让当前版本的主体验更聚焦在 API / ModelScope / 智能画布工作流上。

## 更新内容

- 移除首页左侧 ComfyUI 设置入口。
- 删除独立 ComfyUI 设置页面。
- 智能画布不再显示 ComfyUI 生成选项。
- 无限画布不再提供新增 ComfyUI 节点入口。
- 旧画布中的历史本地工作流节点保留兼容，不会导致旧项目打不开。
- 将旧节点/旧错误提示中的 ComfyUI 可见文案改为"本地工作流"。
- 修复项目文档和智能画布中的乱码残留。
- 同步 README、发布检查清单和 API 文档。

## 验收重点

- 首页左侧导航没有 ComfyUI 设置。
- 智能画布引擎选项没有 ComfyUI。
- 无限画布新增节点菜单没有 ComfyUI。
- 旧画布仍能正常打开。
- 发布检查脚本通过。

## 构建产物

| 文件 | 说明 | 大小 |
|------|------|------|
| `LumaForge-2.0.29-desktop.zip` | 桌面版，含 EXE + 自动更新器 | ~50 MB |
| `LumaForge-Setup-2.0.29.exe` | Windows 一键安装器 | ~40 MB |
| `lumaforge-browser-v2.0.29.zip` | 浏览器/源码运行包 | 2.6 MB |

## SHA256

```
LumaForge-2.0.29-desktop.zip
F4A01F4BDAF446309A5FCF16926066BE91599DC379E5BA9D4AA166F8B79275CF

LumaForge-Setup-2.0.29.exe
629A68EF31A20DECD7ADD601A931EB84F22D72E7D6D7BEE2C65E77041AA2ED2E

lumaforge-browser-v2.0.29.zip
C906D3FBDF9C6E9E963E28D581E52C7599E4F5495A2128133B34F9A04B6166EB
```

## macOS

macOS 包需要在 macOS 环境或 GitHub Actions macOS runner 上构建，详见 README 中的 macOS 构建说明。

## 注意

- Windows 未签名 EXE 可能触发 SmartScreen 提示。
- 安装器卸载不删除用户数据目录。
- 自动更新依赖 Release 中的 zip 资产。
