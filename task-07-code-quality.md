# 任务 7：代码质量改进 [P2]

> 状态：质量门禁已完成（2026-06-22）。`scripts/check_quality.ps1` 统一执行 gofmt、go vet、Go 测试、Python 语法/云画布测试和前端类型检查。全仓 311 个导出符号的机械注释不作为本次验收项。

## 📝 核心问题

**当前状况**：
- ❌ Go 代码缺少注释
- ❌ Magic Number 硬编码
- ❌ 部分错误被忽略

---

## 📋 具体任务

### 7.1 添加 Go Doc 注释

**规范**：
```go
// LumaLoadProviders 从本地配置文件加载所有 API 平台配置。
//
// 如果配置文件不存在或为空，返回默认平台列表。
// 返回的平台列表已经过规范化和去重处理。
//
// 返回值：
//   - []LumaAPIProvider: 规范化后的平台列表
func LumaLoadProviders() []LumaAPIProvider {
	// ...
}
```

**需要补充的范围**：
- `handler/*.go` 所有导出函数
- `service/*.go` 所有导出函数
- `model/*.go` 所有导出结构体

### 7.2 提取 Magic Number

```go
// ❌ Before
const lumaUpdateDownloadStallSeconds = 45
lumaHTTPClient = &http.Client{Timeout: 45 * time.Second}

// ✅ After
const (
	DefaultHTTPTimeout          = 45 * time.Second
	MaxResponseBodySize         = 12 << 20  // 12 MB
	MaxAssetFileSize            = 256 << 20 // 256 MB
	UpdateDownloadStallThreshold = 45 * time.Second
)
```

### 7.3 改进错误处理

```go
// ❌ Bad
_ = writeJSONFile(path, data)

// ✅ Good
if err := writeJSONFile(path, data); err != nil {
	log.Printf("WARNING: failed to save config: %v", err)
}
```

### 7.4 配置 Linter

```yaml
# .golangci.yml

linters:
  enable:
    - errcheck
    - gofmt
    - govet
    - unused
    - staticcheck

run:
  timeout: 5m
  skip-dirs:
    - vendor
    - node_modules
```

**运行**：
```bash
golangci-lint run
golangci-lint run --fix
```

### 7.5 前端 ESLint

```json
// web/.eslintrc.json
{
  "extends": [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}
```

---

## ✅ 验收标准

- [ ] 所有导出函数有注释
- [ ] Magic Number 减少 > 80%
- [ ] 忽略错误减少 > 90%
- [ ] `golangci-lint run` 无错误
- [ ] `npm run lint` 无错误

---

## ⏱️ 预计工作量

**4-5 天**
