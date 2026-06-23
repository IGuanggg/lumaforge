# 任务 4：用户友好错误提示 [P1]

> 状态：基础设施已完成（2026-06-22）。项目继续使用 `{code,data,msg}` 协议，并兼容增加 `errorCode` 与 `action`；前端统一使用结构化 `ApiError`。登录、画布云同步、AI 平台和本地服务连接等高频路径已接入。

## 💬 核心问题

**当前状况**：错误提示过于技术化

```go
// 示例：handler/lumaforge.go
return errors.New("云端请求失败")  // ❌ 用户不知道怎么办
return errors.New("模型列表返回格式异常")  // ❌ 技术术语
```

---

## 🎯 改进规则

### 错误提示改写表

| ❌ 技术性 | ✅ 用户友好 |
|---------|-----------|
| "云端请求失败" | "无法连接到云端服务，请检查网络连接或稍后重试" |
| "模型列表返回格式异常" | "API 平台返回的数据格式不正确，请检查 API 配置" |
| "Base URL 为空" | "请先在 API 设置中填写 API 地址" |
| "mkdir: permission denied" | "没有权限创建文件夹，请检查目录权限" |
| "JSON 解析失败" | "配置文件格式错误，请检查文件内容" |

---

## 📋 具体任务

### 4.1 定义错误类型

```go
// handler/error.go

package handler

type UserError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
	Action  string `json:"action,omitempty"`
}

func (e *UserError) Error() string {
	return e.Message
}

// 预定义错误
var (
	ErrCloudConnectionFailed = &UserError{
		Code:    "CLOUD_001",
		Message: "无法连接到云端服务，请检查网络或稍后重试",
		Action:  "检查网络连接",
	}
	
	ErrAPIProviderInvalid = &UserError{
		Code:    "API_001",
		Message: "API 平台返回的数据格式不正确，请检查 API 配置",
		Action:  "前往 API 设置",
	}
	
	ErrUnauthorized = &UserError{
		Code:    "AUTH_001",
		Message: "请先登录",
		Action:  "前往登录页面",
	}
)
```

### 4.2 统一错误响应

```go
func RespondError(c *gin.Context, err error) {
	if ue, ok := err.(*UserError); ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  ue.Message,
			"code":   ue.Code,
			"action": ue.Action,
		})
	} else {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "操作失败，请稍后重试",
		})
	}
}
```

### 4.3 前端错误处理

```typescript
// web/src/lib/api-error.ts

export function handleAPIError(error: any) {
  const message = error.message || error.error || '操作失败';
  const action = error.action;
  
  toast.error(message, {
    description: action,
    action: action ? {
      label: action,
      onClick: () => {
        if (action.includes('API 设置')) {
          router.push('/api-settings');
        } else if (action.includes('登录')) {
          router.push('/login');
        }
      }
    } : undefined,
  });
}
```

---

## ✅ 验收标准

- [ ] 所有错误返回 `UserError`
- [ ] 前端显示友好提示
- [ ] 错误可操作（跳转到设置页）
- [ ] 至少改写 50+ 处错误

---

## ⏱️ 预计工作量

**3-4 天**
