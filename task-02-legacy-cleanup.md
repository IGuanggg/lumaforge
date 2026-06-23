# 任务 2：清理遗留双重架构 [P0]

> 状态：阶段性完成（2026-06-22）。已完成依赖审计、弃用边界、Next 旧 API 设置副本清理，并将 `/app-settings` 从旧 HTML iframe 迁移为 React 原生页面。`main.py` 与根 `static/` 仍承载桌面更新、深度备份和数据迁移，未满足本文删除门槛，不能直接移除。详见 `docs/LEGACY_MIGRATION_AUDIT.md`。

## 📦 核心问题

**严重性**：🔥🔥 代码维护成本高

**当前状况**（2026-06-22 扫描）：
```bash
# 遗留文件仍在活跃更新
static/canvas.html      636KB  (10,532 行) - 修改于 6月 17 18:15
main.py                 384KB  (8,979 行)  - 修改于 6月 22 15:25 (今天!)
static/app-settings.html 125KB          - 修改于 6月 22 15:30 (今天!)

# 新架构
web/src/                1.6MB  (51 个 .tsx 文件)
handler/                126KB  (16 个 .go 文件)
```

**问题**：
- ❌ 两套画布系统并存（旧 HTML + 新 React）
- ❌ 两套后端（Python Flask + Go Gin）
- ❌ 功能重复，用户困惑选哪个
- ❌ 维护成本翻倍，Bug 修两次

**依赖关系**：
```go
// service/migration.go:50
if strings.TrimSpace(config.Cfg.LumaForgeLegacyAPI) == "" {
  errors = append(errors, "未连接 legacy compatibility API，跳过旧画布和旧素材导入。")
}
```
→ 新版依赖旧版 API 做数据迁移

---

## 🎯 解决方案

### 阶段 1：评估功能覆盖度（2 天）

**目标**：确认新架构是否已覆盖旧版所有功能

#### 1.1 生成功能对比表

扫描 `static/canvas.html` 和 `web/src/app/(user)/canvas/` 的功能差异：

```bash
# 执行脚本
node scripts/compare-canvas-features.js
```

生成报告：
```markdown
# LumaForge 画布功能对比

| 功能 | 旧版 (static/canvas.html) | 新版 (React) | 状态 |
|------|--------------------------|-------------|------|
| 节点创建 | ✅ | ✅ | 已覆盖 |
| 连线编辑 | ✅ | ✅ | 已覆盖 |
| 批量生图 | ✅ | ⚠️ 部分 | **需补齐** |
| 撤销/重做 | ✅ | ❌ | **缺失** |
| 导入画布 | ✅ | ✅ | 已覆盖 |
| ... | ... | ... | ... |

## 旧版独有功能
1. 撤销/重做历史栈 (canvas.html:2341-2450)
2. 批量节点运行队列 (canvas.html:5621-5890)
3. 画布快照导出 PNG (canvas.html:3200-3350)

## 新版独有功能
1. AI 助手对话面板
2. 素材库集成
3. 云端同步
```

#### 1.2 分析用户使用数据

```bash
# 检查日志，哪些用户还在用旧版
grep "GET /static/canvas.html" logs/access.log | wc -l

# 与新版对比
grep "GET /canvas/" logs/access.log | wc -l
```

**判断标准**：
- 如果 **旧版访问 < 5%**，可以直接淘汰
- 如果 **旧版访问 > 20%**，必须先迁移功能

### 阶段 2：迁移独有功能（3 天）

#### 2.1 迁移撤销/重做

```typescript
// web/src/app/(user)/canvas/hooks/use-canvas-history.ts

import { useRef } from 'react';

type HistoryEntry = {
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
};

export function useCanvasHistory() {
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);
  
  const record = (nodes: CanvasNodeData[], connections: CanvasConnection[]) => {
    past.current.push({ nodes, connections });
    future.current = []; // 清空 redo 栈
    
    // 限制历史记录数量
    if (past.current.length > 50) {
      past.current.shift();
    }
  };
  
  const undo = (): HistoryEntry | null => {
    if (past.current.length === 0) return null;
    
    const prev = past.current.pop()!;
    future.current.push(prev);
    return prev;
  };
  
  const redo = (): HistoryEntry | null => {
    if (future.current.length === 0) return null;
    
    const next = future.current.pop()!;
    past.current.push(next);
    return next;
  };
  
  return { record, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
```

#### 2.2 迁移批量节点运行

参考 `static/canvas.html:5621` 的队列逻辑：

```typescript
// web/src/app/(user)/canvas/hooks/use-batch-generation.ts

export function useBatchGeneration() {
  const [queue, setQueue] = useState<string[]>([]); // 节点 ID 队列
  const [running, setRunning] = useState(false);
  
  const addToQueue = (nodeIds: string[]) => {
    setQueue(prev => [...prev, ...nodeIds]);
  };
  
  const processBatch = async (nodes: CanvasNodeData[]) => {
    if (running || queue.length === 0) return;
    
    setRunning(true);
    
    for (const nodeId of queue) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      try {
        await generateNode(node); // 调用生图 API
      } catch (error) {
        console.error(`节点 ${nodeId} 生成失败:`, error);
      }
    }
    
    setQueue([]);
    setRunning(false);
  };
  
  return { addToQueue, processBatch, queue, running };
}
```

#### 2.3 迁移画布快照导出

```typescript
// web/src/app/(user)/canvas/utils/canvas-export.ts

import html2canvas from 'html2canvas';

export async function exportCanvasAsPNG(containerId: string): Promise<Blob> {
  const container = document.getElementById(containerId);
  if (!container) throw new Error('画布容器不存在');
  
  const canvas = await html2canvas(container, {
    backgroundColor: '#f5f5f5',
    scale: 2, // 高清导出
  });
  
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
    }, 'image/png');
  });
}
```

### 阶段 3：通知用户迁移（1 天）

#### 3.1 添加迁移提示

在旧版画布顶部显示横幅：

```html
<!-- static/canvas.html 顶部插入 -->
<div class="migration-banner" style="background: #fff3cd; padding: 12px; text-align: center; border-bottom: 1px solid #ffc107;">
  <strong>⚠️ 旧版画布将在 30 天后停用</strong>
  <p>新版画布功能更强大，您的旧画布会自动迁移。<a href="/canvas" style="color: #0066cc;">立即体验新版 →</a></p>
</div>
```

#### 3.2 自动迁移工具

```go
// handler/migration.go - 新增手动触发迁移

func MigrateUserLegacyData(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	
	// 调用现有的 service.LumaMigrationImport()
	result := service.LumaMigrationImport()
	
	// 将迁移的画布关联到当前用户
	if projects, ok := result["projects"].([]map[string]any); ok {
		db, _ := repository.DB()
		repo := repository.NewCanvasRepository(db)
		
		for _, p := range projects {
			canvas := &model.CanvasProject{
				ID:     fmt.Sprintf("%v", p["id"]),
				UserID: userID,
				Title:  fmt.Sprintf("%v", p["title"]),
				// ... 其他字段
			}
			repo.Save(canvas)
		}
	}
	
	c.JSON(http.StatusOK, result)
}
```

前端按钮：

```typescript
// web/src/app/(user)/canvas/page.tsx

<Button onClick={async () => {
  const result = await fetch('/api/migration/import', { method: 'POST' });
  const data = await result.json();
  
  message.success(`成功迁移 ${data.projects_count} 个画布`);
  router.refresh();
}}>
  从旧版导入画布
</Button>
```

### 阶段 4：移除遗留代码（1-2 天）

#### 4.1 标记废弃文件

```bash
# 创建废弃标记
cat > static/DEPRECATED.md << 'EOF'
# 已废弃

本目录下的文件将在 v2.2.0 移除：

- canvas.html (10,532 行) → 已被 /canvas 替代
- app-settings.html → 已被 /app-settings 替代
- api-settings.html → 已被 /api-settings 替代

如需访问旧版，请使用 v2.1.x 分支。
EOF
```

#### 4.2 条件删除

**前提条件**（全部满足才执行）：
- ✅ 新版功能已完全覆盖旧版
- ✅ 用户迁移率 > 95%
- ✅ 旧版访问量 < 5%
- ✅ 经过至少 30 天过渡期

**删除清单**：

```bash
# 1. 删除静态 HTML
rm -rf static/canvas.html
rm -rf static/api-settings.html
rm -rf static/app-settings.html
rm -rf static/enhance.html
rm -rf static/klein.html
rm -rf static/angle.html

# 2. 删除 Python 后端（保留迁移工具）
# ⚠️ 先确认 config.Cfg.LumaForgeLegacyAPI 没有被使用
rm -f main.py

# 3. 更新路由
# router/router.go - 移除静态文件服务
```

#### 4.3 保留迁移工具

```go
// service/migration.go - 保留此文件
// 用户可能需要多次迁移数据
```

---

## 📊 功能覆盖度检查表

### 画布核心功能

| 功能 | 旧版 | 新版 | 优先级 |
|------|-----|-----|--------|
| 创建节点 | ✅ | ✅ | P0 |
| 编辑节点 | ✅ | ✅ | P0 |
| 连接节点 | ✅ | ✅ | P0 |
| 删除节点 | ✅ | ✅ | P0 |
| 移动节点 | ✅ | ✅ | P0 |
| 缩放画布 | ✅ | ✅ | P0 |
| 撤销/重做 | ✅ | ❌ | **P0** |
| 批量操作 | ✅ | ⚠️ | **P1** |
| 导出 PNG | ✅ | ❌ | **P1** |
| 保存画布 | ✅ | ✅ | P0 |
| 加载画布 | ✅ | ✅ | P0 |

### 生成功能

| 功能 | 旧版 | 新版 | 优先级 |
|------|-----|-----|--------|
| 文生图 | ✅ | ✅ | P0 |
| 图生图 | ✅ | ✅ | P0 |
| 视频生成 | ✅ | ✅ | P0 |
| 批量生成 | ✅ | ⚠️ | **P1** |
| 生成队列 | ✅ | ❌ | **P1** |
| 进度显示 | ✅ | ✅ | P0 |

---

## ✅ 验收标准

### 阶段 1（评估）
- [ ] 生成功能对比表（Markdown）
- [ ] 分析用户访问日志
- [ ] 列出旧版独有功能清单

### 阶段 2（迁移）
- [ ] 撤销/重做功能正常
- [ ] 批量生成队列可用
- [ ] 画布导出 PNG 功能正常
- [ ] 所有旧版功能已在新版实现

### 阶段 3（通知）
- [ ] 旧版画布显示迁移横幅
- [ ] 提供一键迁移按钮
- [ ] 迁移后数据验证无误

### 阶段 4（清理）
- [ ] 旧版访问量 < 5%
- [ ] 用户迁移率 > 95%
- [ ] 遗留文件已删除
- [ ] 路由已更新
- [ ] 文档已更新（README）

---

## ⏱️ 预计工作量

**5-7 天**

- 功能评估：2 天
- 迁移独有功能：3 天
- 通知用户：1 天
- 清理代码：1 天

---

## 🚨 风险与应对

### 风险 1：旧版有独特功能
**应对**：不删除，保留旧版入口，标记为"经典模式"

### 风险 2：用户抵制迁移
**应对**：
1. 提供 30 天过渡期
2. 自动迁移数据
3. 保留旧版只读访问

### 风险 3：迁移丢失数据
**应对**：
1. 迁移前自动备份
2. 迁移后验证数据完整性
3. 提供回滚按钮

---

## 📝 删除前检查清单

**执行删除前必须确认**：

```bash
# 1. 检查旧版访问量
grep "GET /static/canvas.html" logs/*.log | wc -l
# → 必须 < 总访问量的 5%

# 2. 检查功能覆盖度
node scripts/compare-canvas-features.js
# → 必须 100% 覆盖

# 3. 检查依赖
grep -r "LumaForgeLegacyAPI" . --include="*.go"
# → 确认没有硬依赖

# 4. 备份
cp -r static/ backups/static-$(date +%Y%m%d)/
cp main.py backups/main-$(date +%Y%m%d).py

# 5. 执行删除
git rm static/canvas.html main.py
git commit -m "chore: remove legacy canvas and Python backend

- Legacy canvas.html (10,532 lines) replaced by React canvas
- Python backend (8,979 lines) replaced by Go backend
- All features migrated and tested
- User migration rate: 98%
"
```
