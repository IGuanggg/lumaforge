# 任务 1：画布数据云端备份 [P0]

> 状态：已完成（2026-06-22）。实际架构为浏览器 IndexedDB 离线缓存、Go 本地缓存/云代理、`cloud_config_server.py` 云端主存储。已实现用户隔离、最后写入胜出、删除墓碑、断网重试和旧浏览器数据上传。

## 🔥 核心问题

**严重性**：🔥🔥🔥 数据丢失风险

**当前状况**：
```typescript
// web/src/app/(user)/canvas/stores/use-canvas-store.ts:41
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";

// 使用 localForage (IndexedDB) 存储画布
const canvasStorage: PersistStorage<CanvasStore> = {
  getItem: async (name) => await localForageStorage.getItem(name),
  setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
}
```

**问题**：
- ❌ 画布数据只存浏览器 IndexedDB
- ❌ 用户清除浏览器缓存 = 丢失所有画布
- ❌ 换浏览器/设备 = 无法访问旧画布
- ❌ 没有版本历史和恢复功能

**影响**：
- 用户可能丢失数小时/数天的创作成果
- 无法在多设备间同步画布
- 企业用户无法备份和审计

---

## 🎯 解决方案

### 方案架构

```
┌─────────────────┐     实时同步      ┌──────────────────┐
│  浏览器 IndexedDB│  ←──────────→   │  Go 后端数据库    │
│  (本地缓存)      │                  │  (云端主存储)     │
└─────────────────┘                  └──────────────────┘
         ↓                                    ↓
    离线可用                          持久化 + 备份
```

**双存储策略**：
1. **前端 IndexedDB**：快速读写，离线可用
2. **后端数据库**：持久化存储，多设备同步
3. **冲突解决**：最后写入时间戳 + Merge 策略

---

## 📋 具体任务

### 1.1 后端数据模型

```go
// model/canvas.go

package model

import (
	"time"
)

// CanvasProject 画布项目
type CanvasProject struct {
	ID        string    `json:"id" gorm:"primaryKey"`
	UserID    string    `json:"userId" gorm:"index"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty" gorm:"index"`
	
	// JSON 存储复杂结构
	Nodes            string `json:"nodes" gorm:"type:text"`              // JSON array
	Connections      string `json:"connections" gorm:"type:text"`        // JSON array
	ChatSessions     string `json:"chatSessions" gorm:"type:text"`       // JSON array
	ActiveChatID     string `json:"activeChatId"`
	BackgroundMode   string `json:"backgroundMode"`
	ShowImageInfo    bool   `json:"showImageInfo"`
	ViewportX        float64 `json:"viewportX"`
	ViewportY        float64 `json:"viewportY"`
	ViewportK        float64 `json:"viewportK"`
	
	// 元数据
	Metadata         string `json:"metadata" gorm:"type:text"`           // JSON object
	
	// 同步字段
	ClientUpdatedAt  time.Time `json:"clientUpdatedAt" gorm:"index"`     // 客户端最后修改时间
	Version          int64     `json:"version"`                          // 乐观锁版本号
}

// CanvasProjectList 画布列表
type CanvasProjectList struct {
	Items []CanvasProject `json:"items"`
	Total int             `json:"total"`
}
```

### 1.2 数据库迁移

```go
// repository/db.go - 更新 AutoMigrate

func DB() (*gorm.DB, error) {
	dbOnce.Do(func() {
		// ... 现有代码 ...
		dbErr = db.AutoMigrate(
			&model.User{},
			&model.CreditLog{},
			&model.Prompt{},
			&model.Asset{},
			&model.Setting{},
			&model.CanvasProject{},  // 新增
		)
	})
	return db, dbErr
}
```

### 1.3 Repository 层

```go
// repository/canvas.go

package repository

import (
	"encoding/json"
	"time"
	
	"github.com/basketikun/infinite-canvas/model"
	"gorm.io/gorm"
)

type CanvasRepository struct {
	db *gorm.DB
}

func NewCanvasRepository(db *gorm.DB) *CanvasRepository {
	return &CanvasRepository{db: db}
}

// Save 保存或更新画布
func (r *CanvasRepository) Save(canvas *model.CanvasProject) error {
	canvas.UpdatedAt = time.Now()
	canvas.Version++
	
	return r.db.Save(canvas).Error
}

// FindByID 根据 ID 查找画布
func (r *CanvasRepository) FindByID(id string, userID string) (*model.CanvasProject, error) {
	var canvas model.CanvasProject
	err := r.db.Where("id = ? AND user_id = ? AND deleted_at IS NULL", id, userID).
		First(&canvas).Error
	
	if err != nil {
		return nil, err
	}
	return &canvas, nil
}

// List 列出用户的所有画布
func (r *CanvasRepository) List(userID string, offset, limit int) (*model.CanvasProjectList, error) {
	var canvases []model.CanvasProject
	var total int64
	
	query := r.db.Where("user_id = ? AND deleted_at IS NULL", userID)
	
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	
	if err := query.Order("updated_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&canvases).Error; err != nil {
		return nil, err
	}
	
	return &model.CanvasProjectList{
		Items: canvases,
		Total: int(total),
	}, nil
}

// SoftDelete 软删除画布
func (r *CanvasRepository) SoftDelete(id string, userID string) error {
	now := time.Now()
	return r.db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("deleted_at", now).Error
}

// SyncFromClient 从客户端同步数据
func (r *CanvasRepository) SyncFromClient(canvas *model.CanvasProject) (*model.CanvasProject, error) {
	// 检查是否存在
	existing, err := r.FindByID(canvas.ID, canvas.UserID)
	
	if err == gorm.ErrRecordNotFound {
		// 新建
		if err := r.Save(canvas); err != nil {
			return nil, err
		}
		return canvas, nil
	}
	
	if err != nil {
		return nil, err
	}
	
	// 冲突检测：客户端时间 > 服务端时间 才更新
	if canvas.ClientUpdatedAt.After(existing.UpdatedAt) {
		existing.Title = canvas.Title
		existing.Nodes = canvas.Nodes
		existing.Connections = canvas.Connections
		existing.ChatSessions = canvas.ChatSessions
		existing.ActiveChatID = canvas.ActiveChatID
		existing.BackgroundMode = canvas.BackgroundMode
		existing.ShowImageInfo = canvas.ShowImageInfo
		existing.ViewportX = canvas.ViewportX
		existing.ViewportY = canvas.ViewportY
		existing.ViewportK = canvas.ViewportK
		existing.Metadata = canvas.Metadata
		existing.ClientUpdatedAt = canvas.ClientUpdatedAt
		
		if err := r.Save(existing); err != nil {
			return nil, err
		}
	}
	
	return existing, nil
}
```

### 1.4 API Handler

```go
// handler/canvas.go

package handler

import (
	"net/http"
	"strconv"
	
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/gin-gonic/gin"
)

// ListCanvases 列出用户的画布
func ListCanvases(c *gin.Context) {
	userID := c.GetString("user_id") // 从认证中间件获取
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	
	db, err := repository.DB()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "数据库连接失败"})
		return
	}
	
	repo := repository.NewCanvasRepository(db)
	result, err := repo.List(userID, offset, limit)
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询失败"})
		return
	}
	
	c.JSON(http.StatusOK, result)
}

// GetCanvas 获取单个画布
func GetCanvas(c *gin.Context) {
	userID := c.GetString("user_id")
	canvasID := c.Param("id")
	
	db, _ := repository.DB()
	repo := repository.NewCanvasRepository(db)
	
	canvas, err := repo.FindByID(canvasID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "画布不存在"})
		return
	}
	
	c.JSON(http.StatusOK, canvas)
}

// SaveCanvas 保存画布（同步）
func SaveCanvas(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	
	var canvas model.CanvasProject
	if err := c.ShouldBindJSON(&canvas); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "数据格式错误"})
		return
	}
	
	canvas.UserID = userID
	
	db, _ := repository.DB()
	repo := repository.NewCanvasRepository(db)
	
	result, err := repo.SyncFromClient(&canvas)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	
	c.JSON(http.StatusOK, result)
}

// DeleteCanvas 删除画布
func DeleteCanvas(c *gin.Context) {
	userID := c.GetString("user_id")
	canvasID := c.Param("id")
	
	db, _ := repository.DB()
	repo := repository.NewCanvasRepository(db)
	
	if err := repo.SoftDelete(canvasID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
```

### 1.5 前端同步逻辑

```typescript
// web/src/services/api/canvas.ts

export async function syncCanvasToCloud(project: CanvasProject): Promise<CanvasProject> {
  const response = await fetch('/api/canvases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...project,
      clientUpdatedAt: new Date().toISOString(),
    }),
  });
  
  if (!response.ok) {
    throw new Error('同步失败');
  }
  
  return response.json();
}

export async function loadCanvasFromCloud(id: string): Promise<CanvasProject> {
  const response = await fetch(`/api/canvases/${id}`);
  
  if (!response.ok) {
    throw new Error('加载失败');
  }
  
  return response.json();
}

export async function listCloudCanvases(offset = 0, limit = 20) {
  const response = await fetch(`/api/canvases?offset=${offset}&limit=${limit}`);
  return response.json();
}
```

### 1.6 更新 Zustand Store

```typescript
// web/src/app/(user)/canvas/stores/use-canvas-store.ts

import { syncCanvasToCloud } from '@/services/api/canvas';

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      // ... 现有代码 ...
      
      updateProject: (id, patch) => {
        set((state) => {
          const projects = state.projects.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p
          );
          
          // 异步同步到云端（不阻塞UI）
          const updated = projects.find(p => p.id === id);
          if (updated) {
            syncCanvasToCloud(updated).catch(err => {
              console.error('云端同步失败:', err);
              // 可选：显示同步状态提示
            });
          }
          
          return { projects };
        });
      },
    }),
    {
      name: CANVAS_STORE_KEY,
      storage: canvasStorage,
    }
  )
);
```

---

## ✅ 验收标准

- [ ] 数据库包含 `canvas_projects` 表
- [ ] API `/api/canvases` 支持增删改查
- [ ] 画布保存时自动同步到云端
- [ ] 换浏览器能从云端恢复画布
- [ ] 冲突时保留最新修改
- [ ] 离线时可继续编辑（同步延迟）
- [ ] 单元测试覆盖率 > 80%

---

## ⏱️ 预计工作量

**5-7 天**

- 数据模型和迁移：0.5 天
- Repository 层：1 天
- API Handler：1 天
- 前端同步逻辑：2 天
- 测试和调试：1.5-2.5 天

---

## 🚨 注意事项

1. **向后兼容**：现有浏览器 IndexedDB 数据需要迁移到云端
2. **性能**：大画布（100+ 节点）同步时压缩 JSON
3. **安全**：验证用户只能访问自己的画布（`user_id` 过滤）
4. **冲突**：使用 `clientUpdatedAt` 时间戳判断，不用复杂的 CRDT
