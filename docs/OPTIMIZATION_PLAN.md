# LumaForge v2.1.x 优化执行计划

> **文档版本**: 1.0  
> **目标版本**: v2.1.10 → v2.2.0  
> **预计周期**: 3 个月  
> **最后更新**: 2026-06-14

---

## 📊 项目现状分析

### 当前技术栈
```
后端架构:
├── Go 1.25 (主服务)
│   ├── Gin (HTTP 框架)
│   ├── GORM (ORM)
│   ├── SQLite/MySQL/PostgreSQL (数据库)
│   └── 8,078 行代码 / 41 个 Go 文件 / 8 个测试文件
│
├── Python 3.10+ (Legacy 服务)
│   ├── FastAPI (云同步服务)
│   ├── PyInstaller (桌面打包)
│   └── 约 10,000+ 行代码 (main.py + cloud_config_server.py)
│
└── 前端架构:
    ├── Next.js 15 (React 19)
    ├── TypeScript
    ├── Bun (包管理器)
    ├── shadcn/ui (组件库)
    └── 124 个 TS/TSX 文件

构建产物:
├── Windows 桌面版 (PyInstaller + Go binary + Next standalone)
├── Windows 安装器 (Inno Setup)
├── Docker 镜像 (Python + Go 混合)
└── macOS 构建 (GitHub Actions)
```

### 代码质量指标
```
✅ 优点:
- 无 panic() / log.Fatal() 滥用
- 有基础的单元测试框架
- Go 代码组织清晰 (handler/service/repository 分层)
- 快速迭代 (v2.1.0 → v2.1.10 共 10 个版本)

⚠️ 问题:
- 测试覆盖率 < 20% (仅 8 个测试文件)
- service/lumaforge.go 单文件过大 (含多种职责)
- Python + Go 双进程架构复杂
- 前后端类型定义手动同步 (易出错)
- 缺少 CI/CD 自动化
- 错误响应格式不统一
```

---

## 🎯 优化目标

### 阶段一：稳定性增强 (Month 1)
**目标**: 提高代码可靠性，降低线上 Bug 率

- ✅ 测试覆盖率从 <20% → >40%
- ✅ 统一错误处理格式
- ✅ 修复脆弱的功能检测逻辑
- ✅ 协议探测增加手动覆盖

### 阶段二：可维护性提升 (Month 2)
**目标**: 降低开发和维护成本

- ✅ 代码模块化拆分
- ✅ 前后端类型同步自动化
- ✅ CI/CD 流水线搭建
- ✅ 文档和开发指南完善

### 阶段三：架构演进 (Month 3)
**目标**: 简化架构，统一技术栈

- ✅ Python → Go 迁移路线图
- ✅ 单进程架构重构
- ✅ 性能优化和监控
- ✅ API 文档自动生成

---

## 🔴 高优先级任务（阶段一：稳定性）

### 任务 1.1：补齐单元测试覆盖

**现状问题**:
- 只有 8 个测试文件，主要在 `service/lumaforge_lifecycle_test.go`
- 估计覆盖率 < 20%
- 核心业务逻辑（API 调用、数据库操作）缺少测试

**执行步骤**:

#### Step 1: 建立测试覆盖率基线
```bash
cd C:/Users/无敌大光光/.codex/worktrees/a2f2/Infinite-Canvas-main
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html
```

#### Step 2: 为 handler 层补充测试
创建 `handler/lumaforge_test.go` 测试文件

#### Step 3: 补充 service 层 table-driven tests
创建 `service/provider_test.go` 测试文件

#### Step 4: 补充 repository 层数据库测试
创建 `repository/canvas_test.go` 测试文件

**验收标准**:
- `go test -cover ./...` 覆盖率 > 40%
- 所有核心功能有至少 1 个正常路径测试
- 所有对外 API handler 有测试

---

### 任务 1.2：统一错误处理格式

**现状问题**:
```go
// 当前代码中混用多种错误返回格式
// 方式1: map[string]any
return map[string]any{"ok": false, "message": "错误"}

// 方式2: error
return nil, err

// 方式3: 直接写 HTTP 响应
w.WriteHeader(500)
json.NewEncoder(w).Encode(...)
```

**执行步骤**:

#### Step 1: 定义标准错误结构
创建文件 `model/error.go`:
```go
package model

type APIResponse struct {
    Success bool   `json:"success"`
    Code    string `json:"code,omitempty"`
    Message string `json:"message,omitempty"`
    Data    any    `json:"data,omitempty"`
}

type APIError struct {
    Code    string `json:"code"`
    Message string `json:"message"`
    Details any    `json:"details,omitempty"`
}

func (e *APIError) Error() string {
    return e.Message
}

func (e *APIError) ToResponse() APIResponse {
    return APIResponse{
        Success: false,
        Code:    e.Code,
        Message: e.Message,
        Data:    e.Details,
    }
}

func SuccessResponse(data any) APIResponse {
    return APIResponse{Success: true, Data: data}
}

// 常见错误码
const (
    ErrCodeInvalidInput    = "INVALID_INPUT"
    ErrCodeNotFound        = "NOT_FOUND"
    ErrCodeUnauthorized    = "UNAUTHORIZED"
    ErrCodeInternal        = "INTERNAL_ERROR"
    ErrCodeProviderOffline = "PROVIDER_OFFLINE"
)
```

#### Step 2: 重构 service 层返回值
```go
// Before:
func LumaProbeProviderProtocol(provider LumaAPIProvider, apiKey string) map[string]any {
    if baseURL == "" {
        return map[string]any{"ok": false, "message": "请先填写 Base URL"}
    }
    // ...
}

// After:
func LumaProbeProviderProtocol(provider LumaAPIProvider, apiKey string) (ProtocolProbeResult, error) {
    if baseURL == "" {
        return ProtocolProbeResult{}, &APIError{
            Code: ErrCodeInvalidInput,
            Message: "请先填写 Base URL",
        }
    }
    return ProtocolProbeResult{Protocol: "openai", Confidence: "high"}, nil
}
```

#### Step 3: 统一 handler 层错误响应
创建 `handler/response.go` 辅助函数:
```go
package handler

import (
    "encoding/json"
    "net/http"
    "github.com/basketikun/infinite-canvas/model"
)

func WriteJSON(w http.ResponseWriter, code int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(data)
}

func WriteSuccess(w http.ResponseWriter, data any) {
    WriteJSON(w, http.StatusOK, model.SuccessResponse(data))
}

func WriteError(w http.ResponseWriter, err error) {
    apiErr, ok := err.(*model.APIError)
    if !ok {
        apiErr = &model.APIError{
            Code: model.ErrCodeInternal,
            Message: err.Error(),
        }
    }
    
    statusCode := http.StatusInternalServerError
    switch apiErr.Code {
    case model.ErrCodeInvalidInput:
        statusCode = http.StatusBadRequest
    case model.ErrCodeNotFound:
        statusCode = http.StatusNotFound
    case model.ErrCodeUnauthorized:
        statusCode = http.StatusUnauthorized
    }
    
    WriteJSON(w, statusCode, apiErr.ToResponse())
}
```

**验收标准**:
- 所有 API 响应格式统一为 `{success, code, message, data}`
- service 层函数统一返回 `(result, error)`
- handler 层统一使用 `WriteSuccess` / `WriteError`

---

### 任务 1.3：修复脆弱的功能检测逻辑

**现状问题**:
`lumaCanvasSourceCapabilities` 用简单字符串匹配检测前端功能:
```go
combined := readFiles(...)
return map[string]any{
    "prompt_refs": strings.Contains(combined, "promptRefs"),
    // 问题：变量重命名、注释中的关键词都会导致误报
}
```

**执行步骤**:

#### Step 1: 短期方案 - 前端暴露能力端点
在 `web/src/app/api/canvas/capabilities/route.ts` 创建:
```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    prompt_refs: true,        // 编译时已知
    history: true,
    asset_sync: true,
    connections: true,
    version: '2.1.10',
  });
}
```

修改 Go 后端 `service/lumaforge.go`:
```go
func lumaCanvasSourceCapabilities() map[string]any {
    // 调用前端能力接口
    resp, err := http.Get("http://127.0.0.1:3000/api/canvas/capabilities")
    if err != nil {
        // fallback: 返回保守估计
        return map[string]any{
            "prompt_refs": false,
            "history": false,
            "reason": "frontend_unreachable",
        }
    }
    defer resp.Body.Close()
    
    var caps map[string]any
    json.NewDecoder(resp.Body).Decode(&caps)
    return caps
}
```

#### Step 2: 长期方案 - E2E 测试验证
创建 `web/tests/canvas-capabilities.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test('canvas supports prompt references', async ({ page }) => {
  await page.goto('/canvas/test-canvas-id');
  
  // 验证 promptRefs 功能可用
  await page.click('[data-testid="add-image-node"]');
  await page.click('[data-testid="prompt-refs-button"]');
  
  const panel = page.locator('[data-testid="prompt-refs-panel"]');
  await expect(panel).toBeVisible();
});
```

**验收标准**:
- 健康检查不再依赖字符串匹配
- 前端能力通过 API 端点暴露
- 关键功能有 E2E 测试覆盖

---

### 任务 1.4：协议探测增加手动覆盖

**现状问题**:
URL 特征判断可能误伤:
```go
if strings.Contains(lowerURL, "apimart") {
    return apimart协议  // 如果用户自建服务路径恰好含此关键词会误判
}
```

**执行步骤**:

#### Step 1: 扩展 Provider 结构支持手动覆盖
修改 `model/provider.go`:
```go
type LumaAPIProvider struct {
    ID              string   `json:"id"`
    Protocol        string   `json:"protocol"`  // 现有字段
    ProtocolOverride string  `json:"protocol_override,omitempty"` // 新增
    // "auto" | "force-openai" | "force-apimart"
}
```

#### Step 2: 修改探测逻辑
```go
func LumaProbeProviderProtocol(provider LumaAPIProvider, apiKey string) map[string]any {
    // 优先使用手动覆盖
    if provider.ProtocolOverride == "force-openai" {
        return map[string]any{
            "protocol": "openai",
            "confidence": "manual",
            "reason": "user_override",
        }
    }
    if provider.ProtocolOverride == "force-apimart" {
        return map[string]any{
            "protocol": "apimart",
            "confidence": "manual",
            "reason": "user_override",
        }
    }
    
    // 自动探测逻辑...
}
```

#### Step 3: 前端增加手动选择选项
在 API 设置页面增加下拉框:
```typescript
<Select value={provider.protocol_override || "auto"}>
  <Option value="auto">自动检测</Option>
  <Option value="force-openai">强制 OpenAI 兼容</Option>
  <Option value="force-apimart">强制 APIMart 异步</Option>
</Select>
```

**验收标准**:
- 用户可手动覆盖协议类型
- 探测失败时明确提示用户手动选择
- 记录探测历史供调试（可选）

---

## 🟡 中优先级任务（阶段二：可维护性）

### 任务 2.1：代码模块化拆分

**现状问题**:
`service/lumaforge.go` 包含多种职责，单文件过大

**执行步骤**:

#### Step 1: 规划新的目录结构
```
service/
├── lumaforge.go              # 保留核心逻辑和导出
├── provider/
│   ├── protocol.go           # LumaProbeProviderProtocol
│   ├── models.go             # LumaFetchProviderModels
│   ├── connection.go         # 连接测试
│   └── provider_test.go
├── lifecycle/
│   ├── update.go             # 更新相关逻辑
│   ├── health.go             # LumaReleaseHealth
│   ├── desktop_bridge.go     # 桌面生命周期桥
│   └── lifecycle_test.go
├── canvas/
│   ├── capabilities.go       # 画布能力检测
│   ├── migration.go          # 数据迁移
│   └── canvas_test.go
└── cloud/
    ├── session.go            # 云端会话
    ├── sync.go               # 同步逻辑
    └── cloud_test.go
```

#### Step 2: 迁移代码（分批进行）
第一批：Provider 相关
```bash
# 创建新文件
mkdir -p service/provider
touch service/provider/protocol.go
touch service/provider/models.go
touch service/provider/provider_test.go

# 移动函数
# LumaProbeProviderProtocol -> service/provider/protocol.go
# LumaFetchProviderModels -> service/provider/models.go
# fetchOpenAIModels -> service/provider/protocol.go (私有函数)
```

第二批：Lifecycle 相关
```bash
mkdir -p service/lifecycle
# LumaUpdateCapability -> service/lifecycle/update.go
# LumaReleaseHealth -> service/lifecycle/health.go
# LumaAppActionCapability -> service/lifecycle/desktop_bridge.go
```

#### Step 3: 更新导入路径
```go
// 在 service/lumaforge.go 中重新导出
package service

import (
    "github.com/basketikun/infinite-canvas/service/provider"
    "github.com/basketikun/infinite-canvas/service/lifecycle"
)

// 保持向后兼容
func LumaProbeProviderProtocol(p LumaAPIProvider, key string) (map[string]any, error) {
    return provider.ProbeProtocol(p, key)
}
```

**验收标准**:
- `service/lumaforge.go` < 500 行
- 每个子包职责单一
- 所有现有测试仍然通过
- 向后兼容（handler 层无需修改）

---

### 任务 2.2：前后端类型同步

**现状问题**:
Go 和 TypeScript 类型定义手动维护，容易不一致

**执行步骤**:

#### Step 1: 引入 OpenAPI 规范
创建 `api/openapi.yaml`:
```yaml
openapi: 3.0.0
info:
  title: LumaForge API
  version: 2.1.10

components:
  schemas:
    APIProvider:
      type: object
      required: [id, name, base_url, protocol]
      properties:
        id:
          type: string
          pattern: ^[a-z0-9][a-z0-9_-]{1,48}$
        name:
          type: string
          maxLength: 200
        base_url:
          type: string
          format: uri
        protocol:
          type: string
          enum: [openai, apimart]
        protocol_override:
          type: string
          enum: [auto, force-openai, force-apimart]
    
    ProtocolProbeResult:
      type: object
      properties:
        ok:
          type: boolean
        protocol:
          type: string
        confidence:
          type: string
          enum: [high, medium, low, manual]
        message:
          type: string
```

#### Step 2: 生成 Go 代码
安装 oapi-codegen:
```bash
go install github.com/deepmap/oapi-codegen/v2/cmd/oapi-codegen@latest
```

生成代码:
```bash
oapi-codegen -generate types -o model/api_generated.go -package model api/openapi.yaml
```

#### Step 3: 生成 TypeScript 代码
```bash
cd web
bun add -D openapi-typescript
bunx openapi-typescript ../api/openapi.yaml -o src/types/api.d.ts
```

在前端使用:
```typescript
import type { components } from '@/types/api';

type APIProvider = components['schemas']['APIProvider'];
type ProtocolProbeResult = components['schemas']['ProtocolProbeResult'];
```

#### Step 4: 在 CI 中验证一致性
```yaml
# .github/workflows/test.yml
- name: Validate OpenAPI spec
  run: |
    npm install -g @apidevtools/swagger-cli
    swagger-cli validate api/openapi.yaml
```

**验收标准**:
- OpenAPI 规范定义所有对外 API
- Go 类型从 OpenAPI 自动生成
- TypeScript 类型从 OpenAPI 自动生成
- CI 中验证规范正确性

---

### 任务 2.3：搭建 CI/CD 流水线

**现状问题**:
手动构建、测试、发布，容易遗漏步骤

**执行步骤**:

#### Step 1: Go 后端 CI
创建 `.github/workflows/go-test.yml`:
```yaml
name: Go Tests
on:
  push:
    branches: [master, codex/v2.1.0-source-refactor]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      
      - name: Run tests with coverage
        run: |
          go test -v -race -coverprofile=coverage.out ./...
          go tool cover -func=coverage.out
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.out
      
      - name: Check coverage threshold
        run: |
          coverage=$(go tool cover -func=coverage.out | grep total | awk '{print $3}' | sed 's/%//')
          if (( $(echo "$coverage < 40" | bc -l) )); then
            echo "Coverage $coverage% is below 40%"
            exit 1
          fi
```

#### Step 2: 前端 CI
创建 `.github/workflows/web-test.yml`:
```yaml
name: Frontend Tests
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
      
      - name: Install dependencies
        run: cd web && bun install
      
      - name: Build Next.js
        run: cd web && bun run build
      
      - name: Run linter
        run: cd web && bun run lint
```

#### Step 3: 自动发布 (可选)
创建 `.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    tags:
      - 'v*'

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-go@v5
      - uses: oven-sh/setup-bun@v1
      
      - name: Build desktop release
        run: .\scripts\build_desktop_release.ps1
      
      - name: Upload release assets
        uses: softprops/action-gh-release@v1
        with:
          files: releases/*
```

**验收标准**:
- 每次 push 自动运行测试
- 测试覆盖率不达标会失败
- PR 合并前必须通过 CI
- Tag 推送自动构建 Release

---

### 任务 2.4：文档和开发指南

**执行步骤**:

#### Step 1: 更新 README.md
补充完整的开发指南：
```markdown
## 开发环境搭建

### 前置要求
- Go 1.25+
- Bun (推荐) 或 Node.js 18+
- Python 3.10+ (仅桌面版需要)

### 首次启动
\`\`\`bash
# 克隆仓库
git clone https://github.com/IGuanggg/lumaforge
cd lumaforge

# 启动 Go 后端
go run .

# 新终端：启动前端
cd web
bun install
bun run dev
\`\`\`

访问 http://localhost:3000

### 运行测试
\`\`\`bash
# Go 测试
go test -v ./...

# 前端测试
cd web
bun test
\`\`\`

### 提交代码
1. Fork 仓库
2. 创建功能分支: \`git checkout -b feature/xxx\`
3. 提交改动: \`git commit -m "feat: xxx"\`
4. 推送分支: \`git push origin feature/xxx\`
5. 创建 Pull Request
```

#### Step 2: 补充架构文档
创建 `docs/ARCHITECTURE.md`:
```markdown
# LumaForge v2.1 架构

## 整体架构
\`\`\`
┌─────────────────────────────────────┐
│  Desktop Launcher (Python)          │
│  - 启动 Go API (端口 8080)           │
│  - 启动 Legacy API (端口 8000)       │
│  - 启动 Next.js (端口 3000)          │
│  - WebView 窗口                      │
└─────────────────────────────────────┘
           │
           ├─> Go API (新)
           │   ├── /api/providers/*
           │   ├── /api/canvas/*
           │   ├── /api/assets/*
           │   └── /api/app/*
           │
           ├─> Legacy API (旧，待迁移)
           │   ├── /api/cloud/*
           │   └── /api/update/*
           │
           └─> Next.js Frontend
               ├── /canvas/[id]  (新画布)
               ├── /api-settings
               └── /app-settings
\`\`\`

## 数据流
\`\`\`
用户操作 -> Next.js -> Go API -> GORM -> SQLite/MySQL
                            ↓
                       Legacy API (云同步)
\`\`\`
```

#### Step 3: API 文档
使用 Swagger UI 展示 API:
```go
// 在 main.go 中引入
import "github.com/swaggo/gin-swagger"

router.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))
```

**验收标准**:
- README 有完整的开发指南
- 架构文档清晰说明各组件职责
- API 文档可通过 /swagger 访问

---

## 🟢 架构演进任务（阶段三：长期）

### 任务 3.1：Python → Go 迁移路线图

**当前双进程架构**:
```
桌面版运行时:
├── Python (desktop_launcher.py)
│   ├── 启动 Go API (8080)
│   ├── 启动 Legacy API (8000)
│   ├── 启动 Next.js (3000)
│   └── WebView 窗口
│
├── Python Legacy API
│   ├── cloud_config_server.py (云同步)
│   └── desktop_updater.py (自动更新)
│
└── Go API (主服务)
    └── 核心业务逻辑
```

**迁移计划**:

#### Phase 1: 云同步迁移 (v2.2.0)
**目标**: 把 `cloud_config_server.py` 迁移到 Go

**Step 1**: 分析现有 Python 云同步逻辑
```bash
# 统计云同步相关代码量
rg "cloud" cloud_config_server.py | wc -l
```

**Step 2**: Go 实现云同步服务
```go
// service/cloud/sync.go
package cloud

type CloudSyncService struct {
    db *gorm.DB
    smtp SMTPConfig
}

func (s *CloudSyncService) SyncUserConfig(userID string) error {
    // 实现配置同步逻辑
}

func (s *CloudSyncService) SyncMediaAssets(userID string) error {
    // 实现素材同步逻辑
}
```

**Step 3**: 迁移 SMTP 邮件发送
```go
// service/cloud/email.go
import "gopkg.in/gomail.v2"

func (s *CloudSyncService) SendVerificationEmail(to, code string) error {
    m := gomail.NewMessage()
    m.SetHeader("From", s.smtp.From)
    m.SetHeader("To", to)
    m.SetHeader("Subject", "LumaForge 邮箱验证")
    m.SetBody("text/html", fmt.Sprintf("验证码: %s", code))
    
    d := gomail.NewDialer(s.smtp.Host, s.smtp.Port, s.smtp.User, s.smtp.Pass)
    return d.DialAndSend(m)
}
```

**验收标准**:
- Go 实现所有云同步功能
- 数据库结构保持兼容
- Python 云服务仅作为备用

---

#### Phase 2: 自动更新迁移 (v2.2.5)
**目标**: 把 `desktop_updater.py` 迁移到 Go

**Step 1**: Go 实现更新器
```go
// service/lifecycle/updater.go
package lifecycle

func DownloadUpdate(version, url string) error {
    // 下载更新包
    resp, err := http.Get(url)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    
    // 验证 SHA256
    hash := sha256.New()
    tee := io.TeeReader(resp.Body, hash)
    
    // 写入临时文件
    tmpFile := filepath.Join(os.TempDir(), "LumaForge-update.zip")
    out, _ := os.Create(tmpFile)
    defer out.Close()
    
    io.Copy(out, tee)
    
    // 校验完整性
    if !verifyChecksum(hash, expectedChecksum) {
        return errors.New("checksum mismatch")
    }
    
    return nil
}

func ApplyUpdate(zipPath string) error {
    // 解压到临时目录
    // 备份当前版本
    // 替换文件
    // 重启应用
}
```

**Step 2**: 进程间通信
```go
// 使用本地 HTTP 接口替代 Python 进程调用
// Desktop Launcher 通过 HTTP 通知更新器
```

**验收标准**:
- Go 实现完整更新流程
- 支持断点续传
- 校验 SHA256
- 失败时自动回滚

---

#### Phase 3: 单进程架构 (v2.3.0)
**目标**: 移除 Python 依赖，纯 Go 单进程

**新架构**:
```
LumaForge.exe (单个 Go 可执行文件)
├── Embedded Next.js (通过 embed 内嵌)
├── Embedded static assets
├── WebView 窗口 (使用 webview/webview_go)
└── 所有后端逻辑 (Go)
```

**Step 1**: 内嵌 Next.js 构建产物
```go
//go:embed web/out/*
var nextjsFS embed.FS

func main() {
    // 使用 embed 的文件系统
    router.Use(static.Serve("/", static.EmbedFolder(nextjsFS, "web/out")))
}
```

**Step 2**: 替换 PyInstaller 为纯 Go 打包
```bash
# 构建单个可执行文件
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o LumaForge.exe
```

**Step 3**: 桌面窗口用 Go WebView
```go
import "github.com/webview/webview_go"

func main() {
    w := webview.New(true)
    defer w.Destroy()
    w.SetTitle("光绘工坊 · LumaForge")
    w.SetSize(1280, 800, webview.HintNone)
    w.Navigate("http://127.0.0.1:3000")
    w.Run()
}
```

**验收标准**:
- 单个 exe 文件包含所有功能
- 启动速度 < 3 秒
- 内存占用 < 200MB
- 完全移除 Python 依赖

---

### 任务 3.2：性能优化和监控

#### Step 1: 引入性能监控
```go
// 使用 prometheus 监控
import "github.com/prometheus/client_golang/prometheus"

var (
    httpDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "http_request_duration_seconds",
        },
        []string{"path", "method"},
    )
)

func MetricsMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        c.Next()
        duration := time.Since(start).Seconds()
        httpDuration.WithLabelValues(c.Request.URL.Path, c.Request.Method).Observe(duration)
    }
}
```

#### Step 2: 数据库查询优化
```go
// 添加索引
db.AutoMigrate(&Canvas{})
db.Exec("CREATE INDEX IF NOT EXISTS idx_canvas_user_id ON canvases(user_id)")

// 预加载关联数据
db.Preload("Nodes").Preload("Connections").First(&canvas, id)

// 批量插入
db.CreateInBatches(nodes, 100)
```

#### Step 3: 前端性能优化
```typescript
// 画布虚拟滚动
import { useVirtualizer } from '@tanstack/react-virtual'

// 图片懒加载
<Image
  src={asset.url}
  loading="lazy"
  placeholder="blur"
/>

// 代码分割
const Canvas = dynamic(() => import('@/components/Canvas'), {
  ssr: false,
  loading: () => <Skeleton />,
})
```

**验收标准**:
- API 响应时间 P95 < 500ms
- 前端首屏渲染 < 2s
- 画布支持 500+ 节点流畅操作

---

## 📅 时间线和里程碑

### Month 1 (Week 1-4): 稳定性增强
```
Week 1:
├── 任务 1.1: 补齐单元测试 (handler + service)
└── 建立覆盖率基线报告

Week 2:
├── 任务 1.2: 统一错误处理
└── 任务 1.1: 继续补充 repository 测试

Week 3:
├── 任务 1.3: 修复功能检测逻辑
└── 任务 1.4: 协议探测增加手动覆盖

Week 4:
├── 代码审查和测试
├── 发布 v2.1.11 (稳定性修复版)
└── 撰写变更日志
```

### Month 2 (Week 5-8): 可维护性提升
```
Week 5-6:
├── 任务 2.1: 代码模块化拆分
│   ├── 第一批: Provider 相关
│   └── 第二批: Lifecycle 相关

Week 7:
├── 任务 2.2: 前后端类型同步
│   ├── 编写 OpenAPI 规范
│   └── 配置代码生成

Week 8:
├── 任务 2.3: 搭建 CI/CD
├── 任务 2.4: 补充文档
└── 发布 v2.2.0 (架构优化版)
```

### Month 3 (Week 9-12): 架构演进
```
Week 9-10:
└── 任务 3.1 Phase 1: 云同步迁移到 Go

Week 11:
└── 任务 3.1 Phase 2: 自动更新迁移到 Go

Week 12:
├── 任务 3.2: 性能优化
├── 监控系统搭建
└── 发布 v2.2.5 (Go 迁移版)
```

### 长期目标 (3+ months):
```
v2.3.0 (Q3):
└── 单进程架构，完全移除 Python

v2.4.0 (Q4):
├── 移动端支持 (React Native)
└── 插件系统
```

---

## 🛠️ 开发工具和资源

### 推荐工具
```bash
# Go 开发
go install github.com/cosmtrek/air@latest        # 热重载
go install github.com/golangci/golangci-lint@latest  # Linter
go install github.com/go-delve/delve/cmd/dlv@latest  # 调试器

# 前端开发
bun add -D @tanstack/react-query-devtools  # 调试工具
bun add -D @storybook/react               # 组件开发

# 测试
go install gotest.tools/gotestsum@latest   # 更好的测试输出
bun add -D @playwright/test               # E2E 测试

# 代码质量
go install github.com/securego/gosec/v2/cmd/gosec@latest  # 安全检查
bun add -D prettier eslint                # 代码格式化
```

### 学习资源
```
Go:
- https://go.dev/doc/effective_go
- https://github.com/golang-standards/project-layout

Next.js:
- https://nextjs.org/docs
- https://react.dev/learn

测试:
- https://github.com/stretchr/testify (Go 测试框架)
- https://playwright.dev/ (E2E 测试)
```

---

## 📊 成功指标 (KPI)

### 代码质量
- ✅ 测试覆盖率 > 40%
- ✅ Go 单文件代码 < 500 行
- ✅ 零 critical 安全漏洞

### 开发效率
- ✅ CI 运行时间 < 5 分钟
- ✅ 本地构建时间 < 2 分钟
- ✅ PR 平均合并时间 < 1 天

### 用户体验
- ✅ 桌面版启动时间 < 3 秒
- ✅ API 响应 P95 < 500ms
- ✅ 前端首屏 LCP < 2s

### 稳定性
- ✅ 线上 Bug 率降低 50%
- ✅ 更新成功率 > 95%
- ✅ 云同步成功率 > 99%

---

## 🚨 风险和注意事项

### 风险 1: 迁移过程中的兼容性问题
**缓解措施**:
- 保留 Python 服务作为备用
- 灰度发布，先内测再公开
- 提供回退机制

### 风险 2: 测试覆盖率目标过高导致进度延误
**缓解措施**:
- 优先覆盖核心路径
- 使用表驱动测试减少重复代码
- 可以分批达标 (先 30%，再 40%)

### 风险 3: Go 重写可能引入新 Bug
**缓解措施**:
- 逐模块迁移，每次迁移后充分测试
- 保持 API 兼容，前端无感知
- 增加集成测试覆盖

### 风险 4: 单进程架构内存占用过高
**缓解措施**:
- 性能测试先行
- 考虑微服务拆分备选方案
- 优化资源加载策略

---

## 📝 执行检查清单

### 开始任务前
- [ ] 阅读完整优化计划
- [ ] 理解当前架构和问题
- [ ] 搭建本地开发环境
- [ ] 运行一次完整测试套件

### 每个任务完成后
- [ ] 所有测试通过
- [ ] 代码通过 linter 检查
- [ ] 更新相关文档
- [ ] 创建 PR 并通过 Code Review
- [ ] 更新 CHANGELOG.md

### 每个阶段完成后
- [ ] 运行集成测试
- [ ] 性能基准测试
- [ ] 发布 Release Notes
- [ ] 通知用户重大变更

---

## 🎯 快速开始指南（给 AI 助手）

### 如果你是 AI 助手，收到这份文档后：

1. **先理解现状**
   ```bash
   cd C:/Users/无敌大光光/.codex/worktrees/a2f2/Infinite-Canvas-main
   git status
   go test -cover ./...  # 查看当前覆盖率
   ```

2. **选择一个任务开始**
   - 推荐从 **任务 1.1** (补齐测试) 开始
   - 每次只做一个任务，完成后再进行下一个

3. **遵循标准流程**
   ```bash
   git checkout -b feature/task-1.1-add-tests
   # 写代码...
   go test ./...
   git commit -m "test: add unit tests for handler layer"
   git push origin feature/task-1.1-add-tests
   ```

4. **持续更新进度**
   - 在本文档中标记完成的任务
   - 更新 KPI 指标
   - 记录遇到的问题和解决方案

---

## 📚 附录

### A. 参考文档
- [项目 README](../README.md)
- [架构笔记](../ARCHITECTURE_NOTES.md)
- [发布检查清单](../RELEASE_CHECKLIST.md)
- [API 合约](./API_CONTRACT.md)

### B. 联系方式
- GitHub Issues: https://github.com/IGuanggg/lumaforge/issues
- 项目负责人: IGuanggg

### C. 版本历史
- v1.0 (2026-06-14): 初始版本

---

**文档结束** - 祝优化顺利！ 🚀
