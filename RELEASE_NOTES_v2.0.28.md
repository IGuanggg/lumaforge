# LumaForge v2.0.28 升级残留与缓存修复版

v2.0.28 是一个小版本紧急修复，重点修复老版本升级到新版本后旧 UI 残留、WebView 缓存、智能画布空白无法创建节点、左侧导航遮挡等稳定问题。

## 更新内容

- 修复版本号已更新但旧状态框、旧多角度生图入口、旧页面内容仍残留的问题。
- 桌面启动器传递 WebView storage 路径给后端。
- 后端检测 APP_BUILD_ID 变化后，只清理缓存目录（APP_CACHE_DIR、WebView HTTP Cache、Code Cache、GPUCache、Service Worker），不清用户数据、素材库、账号登录数据、localStorage。
- 桌面更新器在替换程序资源时，清理新包中已不存在的旧程序资源。
- 修复智能画布空白时无法创建节点的问题。
- 修复左侧导航遮挡画布操作的问题。
- 保持智能画布操作规则：左键选择/框选，中键拖动画布，右键属性，Ctrl/Alt+滚轮缩放，Ctrl+A 全选节点。

## 验收重点

- 老版本升级到 v2.0.28 后，打开应用不会看到旧状态框或旧页面内容。
- 智能画布空白时可以正常创建节点。
- 左侧导航不会遮挡画布节点操作。
- 更新后用户登录状态、素材库、账号数据不丢失。

## 构建产物

| 文件 | 说明 | 大小 |
|------|------|------|
| `LumaForge-2.0.28-desktop.zip` | 桌面版，含 EXE + 自动更新器 | ~50 MB |
| `LumaForge-Setup-2.0.28.exe` | Windows 一键安装器 | ~40 MB |
| `lumaforge-browser-v2.0.28.zip` | 浏览器/源码运行包 | 2.6 MB |

## SHA256

```
LumaForge-2.0.28-desktop.zip
20AFFC0545F2103AB4C856B7217AECA550EF531D1639044F7C72EE81422DFCBA

LumaForge-Setup-2.0.28.exe
FE46B5875AC9EC73925A7DE7957A27E37A8AD3FEF413202F2151F46C25CFDF2A

lumaforge-browser-v2.0.28.zip
4F0ADE02F639F899DD3019116135900B61C27E311CC46A8C393E5B6D90D053C9
```

## macOS

macOS 包需要在 macOS 环境或 GitHub Actions macOS runner 上构建，详见 README 中的 macOS 构建说明。

## 注意

- Windows 未签名 EXE 可能触发 SmartScreen 提示。
- 安装器卸载不删除用户数据目录。
- 自动更新依赖 Release 中的 zip 资产。
