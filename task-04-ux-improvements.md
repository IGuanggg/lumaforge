# 任务 4：改进错误提示和新手引导 [P0]

## 背景
- 错误提示过于技术化，普通用户看不懂
- 节点式画布对新手不友好，学习曲线陡峭
- 缺乏快速入口，新手容易卡在"如何开始"

## 任务目标
1. 将所有技术性错误改写为用户友好的提示
2. 实现交互式新手引导
3. 提供"快速生图"简化入口

## 具体任务

### 4.1 错误提示优化

#### 改写规则示例

| 场景 | ❌ 技术性提示 | ✅ 用户友好提示 |
|------|--------------|----------------|
| 网络错误 | "云端请求失败" | "无法连接到云端服务，请检查网络或稍后重试" |
| API 错误 | "模型列表返回格式异常" | "该 API 平台返回的数据格式不正确，请检查 API 配置或联系平台客服" |
| 配置错误 | "Base URL 为空" | "请先在 API 设置中填写 API 地址" |

#### 实现结构化错误

```go
// handler/error.go
type UserError struct {
  Code    string // 错误代码，如 "CLOUD_001"
  Message string // 用户看到的友好提示
  Detail  string // 技术细节（开发模式显示）
  Action  string // 建议操作（可选）
}

var (
  ErrCloudConnectionFailed = &UserError{
    Code:    "CLOUD_001",
    Message: "无法连接到云端服务，请检查网络或稍后重试",
    Action:  "检查网络连接",
  }
  // ... 更多预定义错误
)
```

#### 批量替换
遍历所有 `errors.New()` 和 `fmt.Errorf()`，替换为 `UserError`。

### 4.2 新手引导实现

使用 **react-joyride** 库实现交互式教程。

#### 引导流程（8 步）：
1. 介绍工具栏
2. 创建第一个提示词节点
3. 介绍画布区域
4. 输入提示词
5. 添加图片生成节点
6. 连接节点
7. 运行画布
8. 查看结果

参考文档中的完整 React 代码示例（`OnboardingTour.tsx`）。

#### 触发条件：
- 首次打开画布时自动触发
- 设置页面提供"重新开始教程"按钮
- 帮助菜单中提供"新手指南"入口

### 4.3 快速生图入口

创建简化页面 `/quick-generate`：
- 输入框：描述图片
- 下拉框：选择模型
- 按钮：尺寸选择（1024x1024 等）
- 生成按钮：一键生成
- 结果展示：下载或在画布中打开

参考文档中的完整实现代码。

### 4.4 前端错误处理改进

```typescript
// lib/api-error.ts
export interface APIError {
  error: string;
  code: string;
  detail?: string;
  action?: string;
}

export function handleAPIError(error: APIError) {
  toast.error(error.error, {
    description: error.action,
    action: error.action ? {
      label: error.action,
      onClick: () => {
        // 根据 action 跳转
        if (error.action.includes('API 设置')) {
          router.push('/api-settings');
        }
      }
    } : undefined,
  });
}
```

## 输出清单
- [ ] Go 错误消息改写清单（before/after 对照表）
- [ ] `UserError` 结构体和预定义错误
- [ ] 前端错误处理工具函数
- [ ] 新手引导组件（React Joyride）
- [ ] 快速生图页面完整实现
- [ ] 用户测试反馈收集方案

## 验收标准
- [ ] 所有技术性错误已改写（至少 50 处）
- [ ] 新手引导流程完整可用
- [ ] 快速生图功能正常
- [ ] 用户测试反馈满意度 > 80%
- [ ] 错误提示包含可操作的建议

## 预计工作量
5-7 天
