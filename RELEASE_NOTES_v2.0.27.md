# LumaForge v2.0.27 分辨率验收与更新缓存修复版

v2.0.27 是一个小版本稳定修复，重点解决高分辨率出图验收、nano banana 4K 返回尺寸识别、素材参数留痕，以及老版本更新后页面缓存残留的问题。

## 更新内容

- 增加 nano banana / nanobanana 高分辨率请求验收。
- 4K 出图会记录后端实际请求参数：3840x2160、4K、16:9。
- 生成完成后保存图片真实宽高。
- 如果请求 4K 但上游返回低分辨率图片，会在智能画布和素材库显示尺寸提示。
- 智能画布参数弹窗新增"上游请求"和尺寸降级提示。
- 素材库详情页同步显示实际请求尺寸、上游请求和实际尺寸。
- 多图生成时，每张素材独立保存自己的实际尺寸和 warning。
- 修复旧版本更新后版本号已更新但页面仍残留旧 UI / 旧验证内容的问题。
- static HTML 页面增加 no-cache / no-store 处理，降低 WebView 缓存残留。
- 发布检查脚本加强 build id 校验，避免旧静态资源混入 release 包。

## 验收重点

- nano banana 选择 4K / 16:9 时，生成参数中能看到上游请求为 4K / 16:9 / 3840x2160。
- 如果上游实际返回不是 4K，智能画布节点和素材库详情会显示尺寸提示。
- 素材库中的实际尺寸和文件真实宽高一致。
- 老版本升级后，页面不应继续显示旧 welcome 卡、旧验证文案或旧静态页面。
- 自动更新后重启应用，打开页面应加载当前 build id 的静态资源。

## 构建产物

| 文件 | 说明 | 大小 |
|------|------|------|
| `LumaForge-2.0.27-desktop.zip` | 桌面版，含 EXE + 自动更新器 | ~50 MB |
| `LumaForge-Setup-2.0.27.exe` | Windows 一键安装器 | ~40 MB |
| `lumaforge-browser-v2.0.27.zip` | 浏览器/源码运行包 | 2.6 MB |

## SHA256

```
LumaForge-2.0.27-desktop.zip
E3FDCD1057E98DCB1DB58E6B6020DEFB4DB096633B45E9678CF281E6CF225568

LumaForge-Setup-2.0.27.exe
25899946E2C89D3D41307C17025B709BF0FE5E18D563E712693E2F6391AC0369

lumaforge-browser-v2.0.27.zip
C2E445F237BB9349B3E30B05EEF4E4D718EFCF8D644B7E53638D08AD6D2D2F5E
```

## macOS

macOS 包需要在 macOS 环境或 GitHub Actions macOS runner 上构建，详见 README 中的 macOS 构建说明。

## 注意

- Windows 未签名 EXE 可能触发 SmartScreen 提示。
- 安装器卸载不删除用户数据目录。
- 自动更新依赖 Release 中的 zip 资产。
