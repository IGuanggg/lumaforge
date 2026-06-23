# LumaForge v2.1.16

## 功能优势
- API 设置页的模型拉取结果升级为选择面板，支持分类、搜索、勾选、追加已选和覆盖已选。
- 设置页更新区显示当前版本、最新版本、平台包、检查时间和自动更新能力，减少旧包和假失败误判。
- 更新检查固定 Release 资产选择规则，Windows、desktop zip、macOS zip 和 sha256 状态更清晰。
- 源码测试模式明确标记为不可自动替换桌面程序，不再误写失败状态。
- API 平台空状态、无模型状态和常见错误提示增加下一步引导。

## 验收重点
- 安装后版本显示 `2.1.16`。
- `/api/app/update-check` 能返回最新版本、资产列表、选中更新包和更新能力。
- `/api/app/update-preflight` 能区分源码模式和桌面模式，并显示 Release 资产检查状态。
- GitHub macOS workflow 生成 `LumaForge-2.1.16-macos.zip` 和对应 sha256。
