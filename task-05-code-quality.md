# 任务 5：代码质量改进 [P1]

## 背景
- Go 代码缺少注释，函数用途不明确
- 存在 Magic Number，可维护性差
- 错误处理不完整，部分错误被忽略
- 缺少 Linter 配置，代码风格不统一

## 任务目标
1. 为所有导出函数添加 Go Doc 注释
2. 提取硬编码常量
3. 改进错误处理
4. 配置并修复 Linter 问题

## 具体任务

### 5.1 添加 Go Doc 注释

#### 注释规范
```go
// LumaLoadProviders 从本地配置文件加载所有 API 平台配置。
// 
// 如果配置文件不存在或为空，返回默认平台列表。
// 返回的平台列表已经过规范化和去重处理，且至少包含一个主平台。
//
// 返回值：
//   - []LumaAPIProvider: 规范化后的平台列表
//
// 示例：
//   providers := LumaLoadProviders()
//   for _, p := range providers {
//     fmt.Println(p.Name, p.BaseURL)
//   }
func LumaLoadProviders() []LumaAPIProvider {
  // ...
}
```

#### 需要添加注释的范围
- `handler/*.go` 中的所有导出函数
- `service/*.go` 中的所有导出函数
- `model/*.go` 中的所有导出结构体和接口
- `repository/*.go` 中的所有导出函数

### 5.2 提取 Magic Number

#### 识别并重构
```go
// ❌ Before: Magic numbers
const lumaUpdateDownloadStallSeconds = 45
lumaHTTPClient = &http.Client{Timeout: 45 * time.Second}

// ✅ After: Named constants
const (
  // 网络超时配置
  DefaultHTTPTimeout          = 45 * time.Second
  DefaultUpdateDownloadTimeout = 45 * time.Second
  
  // 文件大小限制
  MaxResponseBodySize    = 12 << 20  // 12 MB
  MaxAssetFileSize       = 256 << 20 // 256 MB
  
  // 更新检查
  UpdateDownloadStallThreshold = 45 * time.Second
)
```

#### 检查清单
- [ ] 超时值（时间相关的数字）
- [ ] 文件大小限制
- [ ] 分页大小
- [ ] 重试次数
- [ ] 缓存 TTL
- [ ] 端口号

### 5.3 改进错误处理

#### 查找忽略的错误
```bash
grep -rn "_ =" handler/ service/ --include="*.go"
```

#### 修复规则
```go
// ❌ Bad: 忽略错误
_ = writeJSONFile(path, data)

// ✅ Good: 至少记录日志
if err := writeJSONFile(path, data); err != nil {
  log.Printf("WARNING: failed to save config to %s: %v", path, err)
}

// ✅ Better: 返回错误
if err := writeJSONFile(path, data); err != nil {
  return fmt.Errorf("failed to save config: %w", err)
}
```

#### 错误处理层级
1. **可忽略**：性能监控、非关键日志
2. **记录日志**：缓存失败、预加载失败
3. **返回错误**：用户数据操作失败
4. **Panic**：仅用于程序无法继续的情况（极少使用）

### 5.4 配置 Linter

#### 创建 .golangci.yml
```yaml
linters:
  enable:
    - errcheck      # 检查未处理的错误
    - gofmt         # 代码格式化
    - goimports     # import 排序
    - govet         # Go 静态分析
    - ineffassign   # 检查无效赋值
    - misspell      # 拼写检查
    - unused        # 检查未使用的代码
    - staticcheck   # 静态检查
    - gosimple      # 简化建议
    - stylecheck    # 代码风格
    - revive        # 通用 linter

run:
  timeout: 5m
  skip-dirs:
    - vendor
    - node_modules
```

#### 运行 Linter
```bash
# 安装
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# 运行检查
golangci-lint run

# 自动修复
golangci-lint run --fix
```

### 5.5 前端代码质量

#### ESLint 配置
```json
// web/.eslintrc.json
{
  "extends": [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}
```

#### 添加 JSDoc 注释
```typescript
/**
 * 画布节点注册表
 * 
 * 提供节点类型的注册、查询和管理功能。
 * 
 * @example
 * ```ts
 * NodeRegistry.register({
 *   type: 'custom-node',
 *   displayName: '自定义节点',
 *   render: (node) => <CustomNode node={node} />
 * });
 * ```
 */
export class NodeRegistry {
  // ...
}
```

## 输出清单
- [ ] Go 代码注释补充 PR（至少 100+ 函数）
- [ ] Magic Number 提取清单
- [ ] 错误处理改进清单
- [ ] `.golangci.yml` 配置文件
- [ ] Linter 问题修复报告
- [ ] 前端 ESLint/Prettier 配置
- [ ] JSDoc 注释补充（核心组件和 Hook）

## 验收标准
- [ ] 所有导出函数有 Go Doc 注释
- [ ] Magic Number 减少 > 80%
- [ ] 忽略错误的情况减少 > 90%
- [ ] `golangci-lint run` 无错误
- [ ] `npm run lint` 无错误
- [ ] 代码审查通过

## 预计工作量
5-7 天
