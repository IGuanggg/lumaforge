# 任务 2：重构节点系统为注册表模式 [P2]

## 背景
当前画布节点系统使用硬编码 if/switch 分发，新增节点类型需要在 6+ 处手动修改，扩展性差，无法支持插件化。

## 任务目标
将节点系统重构为注册表模式，支持动态注册和插件化扩展。

## 目标架构

参考文档中的完整代码示例（NodeRegistry.ts），实现以下核心接口：

```typescript
interface NodeDefinition {
  type: string;
  displayName: string;
  category: 'input' | 'processor' | 'output' | 'control';
  create: (config: any) => Node;
  render: (node: Node) => React.ReactElement;
  execute?: (node: Node, context: ExecutionContext) => Promise<any>;
  validate?: (node: Node) => ValidationResult;
}

class NodeRegistry {
  static register(definition: NodeDefinition): void;
  static get(type: string): NodeDefinition | undefined;
  static getAllTypes(): string[];
}
```

## 具体任务

### 2.1 实现注册表核心
创建以下文件结构：
```
web/src/app/(user)/canvas/registry/
├── NodeRegistry.ts      # 核心注册表
├── types.ts            # 类型定义
└── utils.ts            # 辅助函数
```

### 2.2 迁移现有节点类型
将以下节点迁移到注册表：
- `prompt` - 提示词节点
- `image` - 图片节点
- `llm` - LLM 处理节点
- `generator` - API 图片生成节点
- `video` - 视频生成节点
- `output` - 输出节点
- `loop` - 循环节点
- `group` - 分组节点

### 2.3 重构节点使用处
替换所有硬编码分发逻辑：

**需要重构的函数**：
- `createNodeByType()` - 节点创建
- `renderNodeBody()` - 节点渲染
- `executeNode()` - 节点执行
- `validateNode()` - 节点验证

### 2.4 插件化示例
提供自定义节点注册示例（参考文档中的 TextToSpeechNode 示例）

### 2.5 向后兼容
- 节点 type 字段保持不变
- 迁移逻辑处理旧数据格式差异
- 提供降级渲染（UnknownNode 组件）

## 输出清单
- [ ] `NodeRegistry.ts` 核心实现
- [ ] 所有现有节点已迁移到注册表
- [ ] 硬编码分发逻辑已全部替换
- [ ] 插件化示例文档
- [ ] 单元测试
- [ ] 集成测试（旧画布兼容性）

## 验收标准
- [ ] 新增节点类型只需调用 `NodeRegistry.register()`
- [ ] 所有现有节点功能正常
- [ ] 旧画布 JSON 能正常加载
- [ ] 测试覆盖率 > 80%

## 预计工作量
7-10 天
