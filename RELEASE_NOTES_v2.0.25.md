# LumaForge v2.0.25 自动更新紧急修复版

v2.0.25 是一个紧急修复版本，重点解决桌面版自动更新链路中因为误发布 `v20.0.23` 导致后续 2.0.x 版本无法继续升级，以及更新后自动重启时提示找不到应用的问题。

## 更新内容

- 修复误发布 `v20.0.23` 后，版本比较把它当作高于 `2.0.x`，导致无法继续自动升级的问题。
- 默认更新检查源改为 GitHub Releases 列表，自动选择最高的有效 `v2.0.x` 正式版本。
- 当 GitHub `latest` 指向异常 `v20.0.x` 时，会自动回退到 Releases 列表，过滤错误版本。
- 桌面版自动更新启动器会传入已确认存在的 `LumaForge.exe` 路径，降低重启失败概率。
- 独立更新器增加重启路径兜底：优先使用传入路径，其次使用安装目录和常见安装目录。
- 更新后如果自动重启失败，会在更新状态中写入 `restart_failed`、错误信息和候选路径，方便定位。
- 设置页新增 `重启失败` 阶段显示，不再只显示模糊失败。

## 验收重点

- 当前版本即使误显示为 `20.0.23`，也能识别 `2.0.25` 是可升级版本。
- 更新检查不再被错误的 `v20.0.23` GitHub latest 误导。
- 自动更新下载的是 `LumaForge-2.0.25-desktop.zip`，不是 `LumaForge-20.0.23-desktop.zip`。
- 更新完成后能自动重启 `LumaForge.exe`。
- 如果自动重启失败，设置页能显示重启失败原因和候选路径。

## 构建产物

| 文件 | 说明 | 大小 |
|------|------|------|
| `LumaForge-2.0.25-desktop.zip` | 桌面版，含 EXE + 自动更新器 | ~50 MB |
| `LumaForge-Setup-2.0.25.exe` | Windows 一键安装器 | ~40 MB |
| `lumaforge-browser-v2.0.25.zip` | 浏览器/源码运行包 | 2.6 MB |

## SHA256

```
LumaForge-2.0.25-desktop.zip
CD2A838BCA0B14D079D9CBC481867F35FB469ED7D88E35615C2260784E044AC1

LumaForge-Setup-2.0.25.exe
F6477780C708413BE2B4839ACABAB60AA1653EDC003DD2A03F5EAA3E38488645

lumaforge-browser-v2.0.25.zip
B113C03D86FFE5E8A3BA929AB630C82E9F1AC9D97A42609C68E584400C594050
```

## 注意

- 请不要再发布 `20.0.x` 版本号；正常版本线应保持 `2.0.x`。
- 为了救回已经误装 `20.0.23` 的旧客户端，发布时可以临时创建一个兼容 Release `v20.0.25`，资产指向同一份 `LumaForge-2.0.25-desktop.zip`；旧客户端会把它识别为可升级，安装后应用内版本会恢复为 `2.0.25`。
- 同时保留正式 Release `v2.0.25`，后续版本继续走正常 `2.0.x` 版本线。
- 桌面自动更新包必须包含 `LumaForge.exe` 和 `LumaForgeUpdater.exe`。
- 安装器卸载和自动更新不得删除 `%APPDATA%\LumaForge`、`%USERPROFILE%\Pictures\LumaForge` 或 `%LOCALAPPDATA%\LumaForge`。
