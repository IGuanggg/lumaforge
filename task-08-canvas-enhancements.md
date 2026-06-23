# 任务 8：画布功能增强 [P2]

> 状态：经代码核验已覆盖（2026-06-22）。React 画布已有 50 步撤销/重做、快捷键、框选与批量移动/删除、复制粘贴、连线选中删除、生成阶段状态、视口节点裁剪和 `React.memo`；原问题清单基于旧版本，不再重复实现。

## ⚡ 核心问题

**当前状况**：画布缺少关键交互功能

**缺失功能**：
- ❌ 撤销/重做（旧版有，新版没有）
- ❌ 批量操作（框选、批量删除）
- ❌ 连线交互（选中、删除）
- ❌ 节点状态指示不清晰

---

## 📋 具体任务

### 8.1 撤销/重做

```typescript
// web/src/app/(user)/canvas/hooks/use-canvas-history.ts

export function useCanvasHistory() {
  const past = useRef<HistoryEntry[]>([]);
  const future = useRef<HistoryEntry[]>([]);
  
  const record = (nodes: CanvasNodeData[], connections: CanvasConnection[]) => {
    past.current.push({ nodes, connections });
    future.current = [];
    
    if (past.current.length > 50) {
      past.current.shift();
    }
  };
  
  const undo = () => {
    if (past.current.length === 0) return null;
    const prev = past.current.pop()!;
    future.current.push(prev);
    return prev;
  };
  
  const redo = () => {
    if (future.current.length === 0) return null;
    const next = future.current.pop()!;
    past.current.push(next);
    return next;
  };
  
  return { record, undo, redo };
}
```

**快捷键**：
- `Ctrl/Cmd + Z` → 撤销
- `Ctrl/Cmd + Shift + Z` → 重做

### 8.2 批量操作

```typescript
// web/src/app/(user)/canvas/hooks/use-selection.ts

export function useSelection() {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  
  // 框选
  const startSelection = (x: number, y: number) => { /* ... */ };
  
  // 批量移动
  const moveSelected = (dx: number, dy: number) => { /* ... */ };
  
  // 批量删除
  const deleteSelected = () => { /* ... */ };
  
  return { selectedNodes, moveSelected, deleteSelected };
}
```

**快捷键**：
- `Ctrl/Cmd + A` → 全选
- `Delete` → 删除选中
- `Ctrl/Cmd + C/V` → 复制粘贴

### 8.3 连线交互

```typescript
// 连线可点击选中
<path
  d={pathData}
  stroke={selected ? '#C4612F' : '#ddd'}
  strokeWidth={selected ? 3 : 2}
  onClick={onSelect}
  style={{ cursor: 'pointer' }}
/>

// 选中后显示删除按钮
{selected && (
  <circle
    cx={midX}
    cy={midY}
    r="12"
    fill="white"
    stroke="#C4612F"
    onClick={onDelete}
  />
)}
```

### 8.4 节点状态指示

```typescript
// 状态徽章
const statusConfig = {
  running: { color: 'blue', icon: Loader2, spin: true },
  success: { color: 'green', icon: CheckCircle },
  failed: { color: 'red', icon: XCircle },
};

<div className={`absolute -top-2 -right-2 bg-${config.color}-500 rounded-full p-1`}>
  <Icon className="w-4 h-4 text-white" />
</div>
```

### 8.5 性能优化

**虚拟化渲染**：
```typescript
// 只渲染可见区域的节点
const visibleNodes = nodes.filter(node =>
  isNodeInViewport(node, viewport)
);
```

**React.memo**：
```typescript
export const CanvasNode = React.memo(
  function CanvasNode({ node }) { /* ... */ },
  (prev, next) => prev.node.id === next.node.id && prev.node.status === next.node.status
);
```

---

## ✅ 验收标准

- [ ] 撤销/重做功能正常
- [ ] 框选多个节点正常
- [ ] 连线可选中删除
- [ ] 节点状态清晰显示
- [ ] 100+ 节点流畅运行（>30fps）

---

## ⏱️ 预计工作量

**5-7 天**
