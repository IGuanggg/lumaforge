# LumaForge v2.0.24 画布手势边界修复版

v2.0.24 是一个小版本稳定修复，重点优化智能画布和无限画布的手势边界、左侧导航固定、Alt+滚轮缩放隔离。

## 更新内容

- 固定左侧导航为独立 App Chrome，不再参与画布缩放/拖拽，hover 展开只覆盖不推动右侧画布布局。
- 修复左侧导航区域 Alt+滚轮可能影响布局的问题，缩放只作用于右侧画布。
- 统一智能画布手势保护区，弹窗、素材库、工具栏、输入框等 UI 不再误触发画布手势。
- 首页智能画布入口 `canvas.html?list=smart` 同步修复，普通滚轮不再误触发缩放。
- 保持智能画布操作规则：左键选择/框选，中键拖动画布，右键属性，Alt+滚轮缩放，Ctrl+A 全选节点。

## 验收重点

- 左侧导航固定不动，不参与画布缩放/拖拽。
- 左侧导航上 Alt+滚轮不会让导航缩放/抖动。
- 右侧画布可以正常 Alt+滚轮缩放。
- 普通滚轮不会误触发智能画布缩放。
- composer、素材库、任务面板、弹窗、工具栏、输入框上滚轮或点击不会误触发画布手势。
- 左键选择/框选、中键拖动画布、右键属性、Ctrl+A 全选节点均保持可用。

## 构建产物

| 文件 | 说明 | 大小 |
|------|------|------|
| `LumaForge-2.0.24-desktop.zip` | 桌面版，含 EXE + 自动更新器 | ~50 MB |
| `LumaForge-Setup-2.0.24.exe` | Windows 一键安装器 | ~40 MB |
| `lumaforge-browser-v2.0.24.zip` | 浏览器/源码运行包 | 2.6 MB |

## SHA256

```
LumaForge-2.0.24-desktop.zip
5CFED3CCACF7B922169D17A1A23F93B520356B34F513E64F4D51CDABC3BEE28B

LumaForge-Setup-2.0.24.exe
55F49C64891376D979C471A7E783642AB7CBA2BC2365CBE53C8FF630CC96A798

lumaforge-browser-v2.0.24.zip
9E2564838994712ECE35ACC740CFA57DD6A8F3714D93EB923E4135245A2D720C
```

## macOS

macOS 包需要在 macOS 环境或 GitHub Actions macOS runner 上构建，详见 README 中的 macOS 构建说明。

## 注意

- Windows 未签名 EXE 可能触发 SmartScreen 提示。
- 安装器卸载不删除用户数据目录。
- 自动更新依赖 Release 中的 zip 资产。
