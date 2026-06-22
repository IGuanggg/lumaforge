# 任务 8：画布功能增强 [P2]

## 背景
根据 README 和架构分析，画布需要完善以下功能：
- 撤销/重做历史栈
- 连线交互优化
- 批量操作
- 节点状态指示
- 性能优化

## 任务目标
完善 React 画布的核心功能，确保功能完整性和性能。

## 具体任务

### 8.1 撤销/重做（Undo/Redo）

```typescript
// web/src/app/(user)/canvas/stores/use-canvas-history.ts
import { create } from 'zustand';

interface CanvasState {
  nodes: CanvasNode[];
  connections: Connection[];
  viewport: Viewport;
}

interface HistoryStore {
  past: CanvasState[];
  present: CanvasState;
  future: CanvasState[];
  
  recordState: (state: CanvasState) => void;
  undo: () => CanvasState | null;
  redo: () => CanvasState | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 50; // 最多保存 50 步

export const useCanvasHistory = create<HistoryStore>((set, get) => ({
  past: [],
  present: { nodes: [], connections: [], viewport: { x: 0, y: 0, zoom: 1 } },
  future: [],
  
  recordState: (state) => {
    const { past, present } = get();
    const newPast = [...past, present];
    if (newPast.length > MAX_HISTORY) newPast.shift();
    
    set({
      past: newPast,
      present: state,
      future: [], // 新操作清空 redo 栈
    });
  },
  
  undo: () => {
    const { past, present, future } = get();
    if (past.length === 0) return null;
    
    const previous = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      present: previous,
      future: [present, ...future],
    });
    return previous;
  },
  
  redo: () => {
    const { past, present, future } = get();
    if (future.length === 0) return null;
    
    const next = future[0];
    set({
      past: [...past, present],
      present: next,
      future: future.slice(1),
    });
    return next;
  },
  
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
```

**快捷键支持**：Ctrl/Cmd + Z 撤销，Ctrl/Cmd + Shift + Z 重做

### 8.2 连线交互优化

功能：
- 连线可点击选中（高亮显示）
- 选中后按 Delete 键删除
- 右键菜单：删除连线
- 悬停显示数据流向
- 中点位置显示删除按钮

```typescript
// web/src/app/(user)/canvas/components/connection.tsx
export function Connection({
  connection,
  selected,
  onSelect,
  onDelete,
}: ConnectionProps) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <g
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        // 显示右键菜单
      }}
    >
      {/* 不可见的粗线，增加点击区域 */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth="20"
        style={{ cursor: 'pointer' }}
      />
      
      {/* 实际显示的连线 */}
      <path
        d={path}
        stroke={selected ? '#C4612F' : hovered ? '#999' : '#ddd'}
        strokeWidth={selected ? 3 : 2}
      />
      
      {/* 选中时显示删除按钮 */}
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
    </g>
  );
}
```

### 8.3 批量操作

功能：
- 框选多个节点（鼠标拖拽矩形）
- 批量移动
- 批量删除（Delete 键）
- 批量复制/粘贴（Ctrl+C / Ctrl+V）
- 批量运行
- 创建组（Ctrl+G）

```typescript
// web/src/app/(user)/canvas/[id]/use-selection.ts
export function useSelection() {
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null);
  
  // 框选
  const startSelection = (x: number, y: number) => {
    setSelectionRect({ x, y, width: 0, height: 0 });
  };
  
  const updateSelection = (x: number, y: number) => {
    if (!selectionRect) return;
    setSelectionRect({
      x: Math.min(selectionRect.x, x),
      y: Math.min(selectionRect.y, y),
      width: Math.abs(x - selectionRect.x),
      height: Math.abs(y - selectionRect.y),
    });
  };
  
  const endSelection = (nodes: CanvasNode[]) => {
    // 查找矩形内的节点
    const selected = nodes.filter(node => 
      isNodeInRect(node, selectionRect)
    );
    setSelectedNodes(new Set(selected.map(n => n.id)));
    setSelectionRect(null);
  };
  
  // 批量移动
  const moveSelected = (dx: number, dy: number, nodes: CanvasNode[]) => {
    return nodes.map(node => 
      selectedNodes.has(node.id) 
        ? { ...node, x: node.x + dx, y: node.y + dy }
        : node
    );
  };
  
  // 批量删除
  const deleteSelected = (nodes: CanvasNode[], connections: Connection[]) => {
    const remaining = nodes.filter(n => !selectedNodes.has(n.id));
    const remainingConns = connections.filter(
      c => !selectedNodes.has(c.from) && !selectedNodes.has(c.to)
    );
    return { nodes: remaining, connections: remainingConns };
  };
  
  return {
    selectedNodes,
    startSelection,
    updateSelection,
    endSelection,
    moveSelected,
    deleteSelected,
    // ... 更多批量操作
  };
}
```

**快捷键支持**：
- Ctrl+A：全选
- Ctrl+C：复制
- Ctrl+V：粘贴
- Delete：删除
- Ctrl+G：创建组

### 8.4 节点状态指示

状态类型：
- `idle` - 未运行（灰色）
- `running` - 运行中（蓝色，旋转动画）
- `success` - 完成（绿色勾）
- `failed` - 失败（红色叉）
- `pending` - 等待中（黄色时钟）
- `missing` - 缺失文件（橙色警告）

```typescript
// web/src/app/(user)/canvas/components/node-status-indicator.tsx
export function NodeStatusIndicator({ node }: { node: CanvasNode }) {
  const status = node.status || 'idle';
  
  const statusConfig = {
    running: { color: 'blue', icon: Loader2, spin: true },
    success: { color: 'green', icon: CheckCircle2 },
    failed: { color: 'red', icon: XCircle },
    pending: { color: 'yellow', icon: Clock },
    missing: { color: 'orange', icon: AlertCircle },
  };
  
  const config = statusConfig[status];
  if (!config) return null;
  
  const Icon = config.icon;
  
  return (
    <div className="absolute -top-2 -right-2 z-10">
      <Tooltip>
        <TooltipTrigger>
          <div className={`w-6 h-6 rounded-full bg-${config.color}-500`}>
            <Icon className={cn('w-4 h-4 text-white', config.spin && 'animate-spin')} />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {status === 'failed' && node.error && <p>{node.error}</p>}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
```

**节点边框样式**：
- 运行中：蓝色边框 + 偏移
- 失败：红色边框
- 成功：绿色边框
- 缺失：橙色虚线边框

### 8.5 性能优化

#### 虚拟化渲染（大画布）
```typescript
export function useVirtualization(
  nodes: CanvasNode[],
  viewport: Viewport,
  canvasSize: { width: number; height: number }
) {
  const [visibleNodes, setVisibleNodes] = useState<CanvasNode[]>([]);
  
  useEffect(() => {
    // 计算可视区域（加边距）
    const margin = 500;
    const viewportRect = {
      left: -viewport.x / viewport.zoom - margin,
      top: -viewport.y / viewport.zoom - margin,
      right: (-viewport.x + canvasSize.width) / viewport.zoom + margin,
      bottom: (-viewport.y + canvasSize.height) / viewport.zoom + margin,
    };
    
    // 筛选可见节点
    const visible = nodes.filter(node => 
      isNodeInViewport(node, viewportRect)
    );
    
    setVisibleNodes(visible);
  }, [nodes, viewport, canvasSize]);
  
  return visibleNodes;
}
```

#### 节点渲染优化
```typescript
export const CanvasNode = React.memo(
  function CanvasNode({ node, selected }: NodeProps) {
    // 节点渲染逻辑
  },
  (prev, next) => {
    // 只在必要时重新渲染
    return (
      prev.node.id === next.node.id &&
      prev.node.x === next.node.x &&
      prev.node.y === next.node.y &&
      prev.node.status === next.node.status &&
      prev.selected === next.selected
    );
  }
);
```

#### 连线渲染优化（Canvas）
使用 Canvas 批量绘制连线，性能更好：

```typescript
export function ConnectionsLayer({ connections }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 批量绘制连线
    connections.forEach(conn => {
      ctx.beginPath();
      ctx.moveTo(conn.fromX, conn.fromY);
      ctx.bezierCurveTo(/* 贝塞尔曲线 */);
      ctx.stroke();
    });
  }, [connections]);
  
  return <canvas ref={canvasRef} />;
}
```

## 输出清单
- [ ] 撤销/重做历史栈实现
- [ ] 连线交互组件
- [ ] 批量操作功能
- [ ] 快捷键支持
- [ ] 节点状态指示器
- [ ] 虚拟化渲染
- [ ] 节点渲染优化（React.memo）
- [ ] 连线渲染优化（Canvas）

## 验收标准
- [ ] 撤销/重做功能正常，支持快捷键
- [ ] 连线可选中、删除
- [ ] 框选多个节点正常
- [ ] 批量操作正常
- [ ] 节点状态清晰显示
- [ ] 100+ 节点画布流畅运行（>30fps）
- [ ] 内存占用合理（<500MB）

## 预计工作量
7-10 天
