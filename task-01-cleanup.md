# 任务 1：清理遗留代码和统一命名 [P0]

## 背景
项目处于 v2.1.0 重构期，Go + Next.js 新架构与 Python + 原生 JS 旧代码共存，导致维护成本高、功能边界模糊。

## 任务目标
1. 识别并清理已被新架构替代的遗留代码
2. 统一项目中的命名规范
3. 生成清理报告和迁移计划

## 具体任务

### 1.1 遗留代码清理
- **检查 `static/canvas.html` (7886行)**：
  - 对比新 React 画布 `web/src/app/(user)/canvas/` 的功能覆盖度
  - 列出旧画布独有的功能（如果有）
  - 如果新画布已完全覆盖，标记 `static/canvas.html` 为可删除
  - 检查是否有其他文件引用旧画布（静态链接、iframe 加载等）

- **检查 `main.py` (3468行)**：
  - 对比 Go 后端 `handler/*.go` 的路由覆盖度
  - 列出仍在使用的 Python 路由（可能被 legacy API 调用）
  - 确认 `config.Cfg.LumaForgeLegacyAPI` 的使用范围
  - 生成 Python → Go 迁移对照表

- **检查其他遗留文件**：
  - `static/*.html` 中哪些仍在使用
  - `workflows/*.json` 是否都已迁移到新架构

### 1.2 命名统一
扫描并统一以下位置的命名：
- **代码中**：
  - Go 包名、结构体名称
  - TypeScript 类型定义、组件名称
  - Python 模块名（如未删除）
  
- **配置文件中**：
  - `go.mod` 模块名
  - `package.json` 包名
  - 环境变量前缀（`LUMAFORGE_*` vs `INFINITE_CANVAS_*`）
  
- **文档中**：
  - `README.md`
  - `CHANGELOG.md`
  - 注释和文档字符串

**统一规范**：
- 品牌名：`LumaForge`（首字母大写）
- 包名/模块名：`lumaforge`（全小写）
- 环境变量：`LUMAFORGE_*`（全大写）
- 移除所有 `infinite-canvas` 相关命名

### 1.3 输出报告
生成 Markdown 报告，包含：

```markdown
# LumaForge 代码清理报告

## 1. 可安全删除的文件
- [ ] static/canvas.html (7886 行) - 已被 React 画布替代
- [ ] static/xxx.html - 说明原因
- [ ] ...

## 2. 需要迁移后才能删除的功能
- [ ] main.py 的 `/api/xxx` 路由 → handler/xxx.go
  - 依赖方：desktop_launcher.py
  - 预计工作量：2 天
- [ ] ...

## 3. 命名不一致统计
- `infinite-canvas` 出现 23 处
- `INFINITE_CANVAS_*` 环境变量 5 处
- ...

## 4. 迁移优先级
### 高优先级（影响用户体验）
1. ...

### 中优先级（技术债）
2. ...

### 低优先级（可延后）
3. ...

## 5. 潜在风险
- 删除 static/canvas.html 后，旧版桌面应用可能无法运行
- ...
```

## 验收标准
- [ ] 报告清晰列出所有可删除文件及原因
- [ ] 命名不一致问题已全部识别
- [ ] 迁移计划包含优先级和依赖关系
- [ ] 风险评估完整

## 预计工作量
3-5 天
