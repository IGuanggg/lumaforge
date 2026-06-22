# 任务 3：SQLite 数据存储迁移 [P2]

## 背景
当前项目使用 JSON 文件存储所有数据，存在以下问题：
- 并发控制依赖锁，性能瓶颈明显
- 查询效率低（需遍历文件）
- 无事务保证，易丢失数据
- 大量画布时性能下降

## 任务目标
迁移到 SQLite，保留 JSON 作为导出/备份格式。

## 数据库设计

### Schema 定义
参考完整文档中的 SQL Schema，包含以下表：
- `canvases` - 画布元数据（nodes/connections 存为 JSON BLOB）
- `assets` - 素材元数据
- `asset_tags` - 素材标签（多对多）
- `api_providers` - API 平台配置
- `api_provider_models` - 模型列表
- `cloud_sessions` - 云端会话
- `app_paths` - 应用路径配置

### 迁移策略

**阶段 1：双写模式**（过渡期 1-2 个版本）
- 写操作：同时写 SQLite 和 JSON
- 读操作：优先 SQLite，降级 JSON
- 用户可选择禁用 SQLite（回退开关）

**阶段 2：SQLite 主模式**
- 写操作：只写 SQLite
- 读操作：只读 SQLite
- JSON 作为导出格式保留

**阶段 3：清理**
- 移除 JSON 读写代码
- 保留 JSON 导入/导出功能

## 具体任务

### 3.1 创建 Migration 脚本
```
migrations/
└── 001_initial_schema.sql
```

### 3.2 实现 Repository 层
```go
repository/
├── canvas_sqlite.go    # SQLite 实现
├── canvas_json.go      # JSON 实现（保留）
└── canvas_adapter.go   # 自动选择后端
```

参考文档中的完整 Go 代码示例。

### 3.3 数据迁移工具
```bash
# 命令行工具
go run cmd/migrate/main.go --from json --to sqlite
```

迁移逻辑：
1. 读取所有 JSON 文件
2. 写入 SQLite
3. 验证数据完整性
4. 备份旧 JSON 文件

### 3.4 兼容层
```go
// 自动选择存储后端
func NewCanvasRepo(useSQLite bool) CanvasRepo {
  if useSQLite {
    return NewCanvasSQLiteRepo(db)
  }
  return NewCanvasJSONRepo(dataDir)
}
```

## 输出清单
- [ ] SQL Schema 文件
- [ ] SQLite Repository 实现（Go）
- [ ] 数据迁移脚本
- [ ] 兼容层适配器
- [ ] JSON 导入/导出功能
- [ ] 单元测试
- [ ] 性能测试报告（JSON vs SQLite）

## 验收标准
- [ ] 所有现有功能正常
- [ ] 旧 JSON 数据能无损迁移
- [ ] 查询性能提升 > 3x（100+ 画布场景）
- [ ] 提供回退方案（降级到 JSON）
- [ ] 测试覆盖率 > 85%

## 预计工作量
10-14 天
