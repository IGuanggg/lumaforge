# 任务 3：统一命名规范 [P1]

> 状态：已完成（2026-06-22）。Go module 使用真实仓库地址 `github.com/IGuanggg/lumaforge`；SQLite、LocalStorage、IndexedDB 与导出包均保留旧数据兼容迁移，历史授权名称不做替换。

## 🏷️ 核心问题

**当前状况**：Go module 叫 `infinite-canvas`，品牌是 `LumaForge`

```bash
# 命名混用统计（2026-06-22 扫描）
grep -r "infinite-canvas" --include="*.go" --include="*.json" . | wc -l
# → 1200+ 处

grep -r "LumaForge\|lumaforge" --include="*.go" . | wc -l
# → 800+ 处
```

**影响**：
- ❌ 开发者困惑（包名 vs 产品名）
- ❌ 配置文件不一致
- ❌ 用户看到技术细节（如错误日志）

---

## 🎯 统一规范

### 命名标准

| 场景 | 标准格式 | 示例 |
|------|---------|------|
| 品牌名 | `LumaForge` | 文档、UI、营销 |
| Go module | `github.com/basketikun/lumaforge` | import 路径 |
| 包名 | `lumaforge` | package 声明 |
| 环境变量 | `LUMAFORGE_*` | `LUMAFORGE_API_KEY` |
| 配置文件 | `lumaforge-*.json` | `lumaforge-config.json` |
| 数据库 | `lumaforge.db` | SQLite 文件名 |
| 函数前缀 | `Luma*` | `LumaLoadProviders()` |

---

## 📋 具体任务

### 3.1 更新 Go module 路径

```bash
# 1. 修改 go.mod
module github.com/basketikun/lumaforge  # 改为 lumaforge

# 2. 批量替换 import 路径
find . -name "*.go" -type f -exec sed -i 's|github.com/basketikun/infinite-canvas|github.com/basketikun/lumaforge|g' {} +

# 3. 验证
go mod tidy
go build ./...
```

### 3.2 更新配置默认值

```go
// config/config.go

type Config struct {
	AdminPassword   string `env:"ADMIN_PASSWORD" envDefault:"lumaforge-admin"`  // 改
	JWTSecret       string `env:"JWT_SECRET" envDefault:"lumaforge-secret"`     // 改
	DatabaseDSN     string `env:"DATABASE_DSN" envDefault:"data/lumaforge.db"`  // 改
}
```

### 3.3 更新前端常量

```typescript
// web/src/app/(user)/canvas/stores/use-canvas-store.ts:41
const CANVAS_STORE_KEY = "lumaforge:canvas_store";  // 改（需迁移旧数据）
```

**数据迁移**：
```typescript
// 启动时迁移旧 key
if (localStorage.getItem('infinite-canvas:canvas_store')) {
  const oldData = localStorage.getItem('infinite-canvas:canvas_store');
  localStorage.setItem('lumaforge:canvas_store', oldData);
  localStorage.removeItem('infinite-canvas:canvas_store');
}
```

### 3.4 更新文件名

```bash
# 重命名配置文件
mv data/infinite-canvas.db data/lumaforge.db

# 更新引用
grep -r "infinite-canvas.db" --include="*.go" . -l | xargs sed -i 's/infinite-canvas.db/lumaforge.db/g'
```

### 3.5 更新文档

```bash
# README.md
# CHANGELOG.md
# LICENSE

# 全局替换（保留源码归属说明）
sed -i 's/Infinite Canvas/LumaForge/g' README.md
```

---

## ✅ 验收标准

- [ ] Go module 路径改为 `lumaforge`
- [ ] 所有 import 路径已更新
- [ ] 环境变量统一 `LUMAFORGE_*`
- [ ] 配置文件统一 `lumaforge-*`
- [ ] 前端 localStorage key 已迁移
- [ ] 文档已更新
- [ ] 编译通过，测试通过

---

## ⏱️ 预计工作量

**2-3 天**
