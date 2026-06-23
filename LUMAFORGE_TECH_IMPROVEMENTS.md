# LumaForge 技术改进任务清单（v2.1.15 基准）

> 基于 2026-06-22 代码扫描，针对 Go + Next.js 架构的精准改进方案。

## 执行状态（2026-06-22）

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| P0-01 画布云备份 | 已完成 | IndexedDB 离线优先，Go 本地缓存，Python 云服务按用户持久化，支持 LWW 与删除墓碑 |
| P0-02 legacy 清理 | 阶段完成 | 已移除 Next 旧 API 设置副本并建立弃用边界；桌面更新、备份和迁移仍依赖 legacy，暂不破坏性删除 |
| P1-03 命名统一 | 已完成 | Go module 统一为 `github.com/IGuanggg/lumaforge`，浏览器与 SQLite 数据自动迁移 |
| P1-04 错误提示 | 已完成基础设施 | 保持现有响应兼容，增加稳定错误码与操作提示，覆盖高频登录、云同步和 API 平台错误 |
| P1-05 API Key 安全存储 | 不执行 | 产品决定继续使用明文 `api_provider_keys.json` |
| P2-06 画布模板 | 已完成 | 10 个模板，支持搜索、分类、响应式浏览和一键创建 |
| P2-07 代码质量 | 已完成门禁 | 新增统一质量检查脚本与前端 typecheck/lint 入口 |
| P2-08 画布增强 | 已由现有实现覆盖 | 撤销重做、框选、批量操作、连线删除、状态指示、视口裁剪和 memo 均已存在 |

---

## 📋 任务优先级概览

| 优先级 | 任务文件 | 任务名称 | 预计工作量 | 核心问题 |
|--------|---------|---------|-----------|---------|
| **P0** | [task-01-canvas-data-backup.md](task-01-canvas-data-backup.md) | 画布数据云端备份 | 5-7 天 | 🔥 **数据丢失风险** - 画布存浏览器 IndexedDB |
| **P0** | [task-02-legacy-cleanup.md](task-02-legacy-cleanup.md) | 清理遗留双重架构 | 5-7 天 | 📦 636KB HTML + 384KB Python 冗余 |
| **P1** | [task-03-naming-unification.md](task-03-naming-unification.md) | 统一命名规范 | 2-3 天 | 🏷️ `infinite-canvas` 混用 `LumaForge` |
| **P1** | [task-04-error-messages.md](task-04-error-messages.md) | 用户友好错误提示 | 3-4 天 | 💬 技术性错误让用户困惑 |
| **P1** | [task-05-api-key-security.md](task-05-api-key-security.md) | API Key 安全存储 | 3-4 天 | 🔐 明文存 `api_provider_keys.json` |
| **P2** | [task-06-canvas-templates.md](task-06-canvas-templates.md) | 内置画布模板 | 5-7 天 | 🎨 新手学习曲线陡峭 |
| **P2** | [task-07-code-quality.md](task-07-code-quality.md) | 代码质量改进 | 4-5 天 | 📝 缺注释、Magic Number |
| **P2** | [task-08-canvas-enhancements.md](task-08-canvas-enhancements.md) | 画布功能增强 | 5-7 天 | ⚡ 缺撤销/批量操作 |

**总预计时间**：32-44 天（约 1.5-2 个月）

---

## 🎯 执行建议

### 立即执行（P0 - 数据安全）
```bash
1. task-01-canvas-data-backup.md  # 防止用户清浏览器丢画布
2. task-02-legacy-cleanup.md      # 清理 1MB 遗留代码
```

### 近期执行（P1 - 用户体验）
```bash
3. task-03-naming-unification.md  # 统一品牌命名
4. task-04-error-messages.md      # 改进错误提示
5. task-05-api-key-security.md    # 修复安全隐患
```

### 中期优化（P2 - 功能完善）
```bash
6. task-06-canvas-templates.md    # 降低新手门槛
7. task-07-code-quality.md        # 提升可维护性
8. task-08-canvas-enhancements.md # 画布体验打磨
```

---

## 🔥 重大发现

### 发现 1：画布数据仅存浏览器
```typescript
// web/src/app/(user)/canvas/stores/use-canvas-store.ts:41
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
// 使用 localForage (IndexedDB) 存储
// ❌ 没有后端备份！用户清浏览器 = 丢失所有画布
```

### 发现 2：遗留架构仍在更新
```bash
# 文件大小（2026-06-22）
static/canvas.html    636KB  (10,532 行原生 JS)
main.py              384KB  (8,979 行 Python Flask)

# 最近修改时间
main.py: 6月 22 15:25 (今天！)
static/app-settings.html: 6月 22 15:30 (今天！)
```

### 发现 3：数据库未充分利用
```go
// repository/db.go - 已有 SQLite + GORM
db.AutoMigrate(&model.User{}, &model.CreditLog{},
  &model.Prompt{}, &model.Asset{}, &model.Setting{})

// ❌ 但画布数据（CanvasProject）没存数据库
// ✅ 只存了用户、素材、提示词
```

---

## 📂 任务详情

### [任务 1：画布数据云端备份](task-01-canvas-data-backup.md) [P0]
**问题**：画布存浏览器 IndexedDB，清除数据 = 丢失所有创作
**方案**：添加后端画布存储，支持云端同步和自动备份

### [任务 2：清理遗留双重架构](task-02-legacy-cleanup.md) [P0]
**问题**：`static/` 10个 HTML (636KB) + `main.py` (384KB) 与新架构功能重复
**方案**：评估功能覆盖度，迁移独有功能，移除冗余代码

### [任务 3：统一命名规范](task-03-naming-unification.md) [P1]
**问题**：Go module 叫 `infinite-canvas`，品牌是 `LumaForge`
**方案**：统一所有代码、配置、文档中的命名

### [任务 4：用户友好错误提示](task-04-error-messages.md) [P1]
**问题**："云端请求失败"、"模型列表返回格式异常" 让用户困惑
**方案**：改写为"无法连接云端服务，请检查网络"等友好提示

### [任务 5：API Key 安全存储](task-05-api-key-security.md) [P1]
**问题**：明文存 `data/api_provider_keys.json`
**方案**：使用系统密钥管理器（Windows Credential / macOS Keychain）

### [任务 6：内置画布模板](task-06-canvas-templates.md) [P2]
**问题**：新手不知道如何开始使用画布
**方案**：内置 10+ 模板（角色三视图、批量风格转换等）

### [任务 7：代码质量改进](task-07-code-quality.md) [P2]
**问题**：缺 Go Doc 注释、Magic Number、错误被忽略
**方案**：补充注释、提取常量、配置 Linter

### [任务 8：画布功能增强](task-08-canvas-enhancements.md) [P2]
**问题**：缺撤销/重做、批量操作、节点状态指示
**方案**：完善历史栈、框选、连线交互、性能优化

---

## 💡 使用方式

1. **逐个执行**：按优先级顺序，将任务文件内容交给 Codex
2. **独立执行**：每个任务自包含，可单独执行
3. **验收标准**：每个任务都有明确的验收清单

每个任务文件包含：
- ✅ 基于真实代码的问题分析
- ✅ 具体可执行的步骤和代码
- ✅ 输出清单和验收标准
- ✅ 预计工作量

---

## 🔧 技术栈（当前版本 2.1.15）

**后端**：
- Go 1.x + Gin
- GORM + SQLite/MySQL/PostgreSQL
- HTTP Client for API 调用

**前端**：
- Next.js 16.2.3 + React 19.2.5
- Zustand 5.0 (状态管理)
- Ant Design 6.4 + shadcn
- localForage (IndexedDB 封装)

**遗留**（待清理）：
- Python Flask (`main.py` 8979 行)
- 原生 JS (`static/canvas.html` 10532 行)
