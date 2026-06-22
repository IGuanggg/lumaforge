# LumaForge 技术改进任务清单

> 本文档是技术改进任务的总索引。每个任务都拆分为独立文件，可以逐个交给 AI 助手（如 Codex）执行。

---

## 任务优先级概览

| 优先级 | 任务文件 | 任务名称 | 预计工作量 | 影响范围 |
|--------|---------|---------|-----------|---------|
| **P0** | [task-01-cleanup.md](task-01-cleanup.md) | 清理遗留代码和统一命名 | 3-5 天 | 代码库整体 |
| **P0** | [task-04-ux-improvements.md](task-04-ux-improvements.md) | 改进错误提示和新手引导 | 5-7 天 | 用户体验 |
| **P1** | [task-06-secure-keystore.md](task-06-secure-keystore.md) | API Key 安全存储 | 3-4 天 | 安全性 |
| **P1** | [task-05-code-quality.md](task-05-code-quality.md) | 代码质量改进 | 5-7 天 | 可维护性 |
| **P1** | [task-07-templates.md](task-07-templates.md) | 内置模板库 | 7-10 天 | 新手体验 |
| **P2** | [task-03-sqlite.md](task-03-sqlite.md) | SQLite 数据存储迁移 | 10-14 天 | 架构优化 |
| **P2** | [task-02-node-registry.md](task-02-node-registry.md) | 重构节点系统为注册表模式 | 7-10 天 | 扩展性 |
| **P2** | [task-08-canvas-enhancements.md](task-08-canvas-enhancements.md) | 画布功能增强 | 7-10 天 | 功能完善 |

**总预计时间**：47-66 天（约 2-3 个月）

---

## 建议执行顺序

```
1. task-01 (清理遗留代码)      → 先摸清现状，移除重复代码
2. task-04 (错误提示优化)      → 快速提升用户体验
3. task-06 (API Key 安全)      → 修复安全隐患
4. task-05 (代码质量)          → 提升代码可维护性
5. task-07 (模板库)            → 降低新手门槛
6. task-03 (SQLite 迁移)       → 长期架构改进
7. task-02 (节点系统重构)      → 扩展性优化
8. task-08 (画布增强)          → 功能完善
```

---

## 任务简介

### [任务 1：清理遗留代码和统一命名](task-01-cleanup.md) [P0]
清理 `static/canvas.html`(7886行) 和 `main.py`(3468行) 等遗留代码，统一 `LumaForge`/`infinite-canvas` 命名混用。

### [任务 2：重构节点系统为注册表模式](task-02-node-registry.md) [P2]
将硬编码的 if/switch 节点分发重构为注册表模式，支持插件化扩展。

### [任务 3：SQLite 数据存储迁移](task-03-sqlite.md) [P2]
将 JSON 文件存储迁移到 SQLite，提升查询性能和数据可靠性。

### [任务 4：改进错误提示和新手引导](task-04-ux-improvements.md) [P0]
将技术性错误改写为用户友好提示，添加交互式新手引导和快速生图入口。

### [任务 5：代码质量改进](task-05-code-quality.md) [P1]
补充 Go Doc 注释，提取 Magic Number，改进错误处理，配置 Linter。

### [任务 6：API Key 安全存储](task-06-secure-keystore.md) [P1]
使用系统密钥管理器（Windows Credential Manager / macOS Keychain）安全存储 API Key。

### [任务 7：内置模板库](task-07-templates.md) [P1]
内置 10+ 个画布模板（角色三视图、产品展示、批量风格转换等），降低新手门槛。

### [任务 8：画布功能增强](task-08-canvas-enhancements.md) [P2]
完善撤销/重做、连线交互、批量操作、节点状态指示和性能优化。

---

## 使用方式

1. **逐个执行**：按建议顺序，将每个任务文件的内容交给 AI 助手
2. **独立执行**：每个任务文件都是自包含的，可单独执行
3. **优先级调整**：可根据实际需求调整 P0/P1/P2 优先级

每个任务文件包含：
- 背景说明
- 任务目标
- 具体任务（含代码示例）
- 输出清单
- 验收标准
- 预计工作量
