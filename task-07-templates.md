# 任务 7：内置模板库 [P1]

## 背景
节点式画布学习曲线陡峭，新手不知道从何开始。提供内置模板可以：
- 降低学习门槛
- 展示最佳实践
- 激发创作灵感

## 任务目标
内置 10+ 个画布模板，涵盖常见创作场景，并提供模板浏览和使用功能。

## 模板数据结构

```typescript
export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  category: 'character' | 'product' | 'scene' | 'workflow' | 'other';
  thumbnail: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  
  canvas: {
    nodes: CanvasNode[];
    connections: Connection[];
    viewport: Viewport;
  };
  
  instructions?: string;
  exampleOutputs?: string[];
}
```

## 模板清单（10 个）

### 角色设计类
1. **角色三视图** - 生成角色的正面、侧面、背面视图（入门）
2. **角色表情包** - 生成同一角色的多种表情（中级）

### 产品设计类
3. **产品三视图** - 生成产品的正面、侧面、俯视图（入门）
4. **产品场景图** - 将产品放入不同使用场景展示（中级）

### 场景创作类
5. **四季风景** - 生成同一地点在春夏秋冬的风景（入门）
6. **室内设计方案** - 生成同一空间的多种设计风格（中级）

### 工作流类
7. **批量风格转换** - 将一张图片转换成多种艺术风格（高级）
8. **图片超分辨率** - 将低分辨率图片放大到 4K（入门）
9. **脚本分镜生成** - 输入文字剧本，自动生成分镜图（高级）
10. **去背景 + 换背景** - 移除图片背景并替换（中级）

## 模板实现

### 7.1 模板数据存储

```
web/public/templates/
├── index.json                    # 模板索引
├── character-turnaround.json     # 角色三视图
├── character-expressions.json    # 角色表情包
├── product-views.json            # 产品三视图
├── ...
└── thumbnails/
    ├── character-turnaround.jpg
    └── ...
```

### 7.2 模板浏览页面

```typescript
// web/src/app/(user)/templates/page.tsx
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<CanvasTemplate[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  
  // 加载模板列表
  useEffect(() => {
    fetch('/templates/index.json')
      .then(res => res.json())
      .then(async (index) => {
        const templatePromises = index.templates.map((file: string) =>
          fetch(`/templates/${file}`).then(res => res.json())
        );
        const loadedTemplates = await Promise.all(templatePromises);
        setTemplates(loadedTemplates);
      });
  }, []);
  
  // 筛选逻辑
  const filteredTemplates = templates.filter(t => {
    if (filter !== 'all' && t.category !== filter) return false;
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(searchLower) ||
        t.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }
    return true;
  });
  
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">画布模板</h1>
      
      {/* 搜索和分类筛选 */}
      <Input
        type="search"
        placeholder="搜索模板..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="character">角色设计</TabsTrigger>
          <TabsTrigger value="product">产品设计</TabsTrigger>
          <TabsTrigger value="scene">场景创作</TabsTrigger>
          <TabsTrigger value="workflow">工作流</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {/* 模板网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            onClick={() => handleUseTemplate(template)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 7.3 模板应用逻辑

```typescript
const handleUseTemplate = async (template: CanvasTemplate) => {
  // 创建新画布并应用模板
  const response = await fetch('/api/canvases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${template.name} - 副本`,
      nodes: template.canvas.nodes,
      connections: template.canvas.connections,
      viewport: template.canvas.viewport,
    }),
  });
  
  const { id } = await response.json();
  router.push(`/canvas/${id}`);
};
```

### 7.4 导出为模板功能

```typescript
// web/src/app/(user)/canvas/[id]/components/export-template-dialog.tsx
export function ExportTemplateDialog({ canvas }: { canvas: Canvas }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'other' as const,
    tags: '',
    difficulty: 'intermediate' as const,
  });
  
  const handleExport = () => {
    const template: CanvasTemplate = {
      id: `custom-${Date.now()}`,
      name: formData.name,
      description: formData.description,
      category: formData.category,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      difficulty: formData.difficulty,
      thumbnail: '',
      createdAt: new Date().toISOString(),
      canvas: {
        nodes: canvas.nodes,
        connections: canvas.connections,
        viewport: canvas.viewport,
      },
    };
    
    // 下载为 JSON 文件
    const blob = new Blob([JSON.stringify(template, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${template.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('模板已导出');
  };
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          导出为模板
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导出为模板</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Input
            placeholder="模板名称"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Textarea
            placeholder="描述"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          {/* 分类、标签、难度选择 */}
        </div>
        
        <DialogFooter>
          <Button onClick={handleExport}>导出模板</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 7.5 在画布列表中添加入口

```typescript
// web/src/app/(user)/canvas/page.tsx
export default function CanvasListPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">我的画布</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/templates">
              <LayoutTemplate className="mr-2 h-4 w-4" />
              从模板创建
            </Link>
          </Button>
          <Button onClick={createBlankCanvas}>
            <Plus className="mr-2 h-4 w-4" />
            空白画布
          </Button>
        </div>
      </div>
    </div>
  );
}
```

## 输出清单
- [ ] 10+ 个模板 JSON 文件
- [ ] 模板缩略图（设计或截图）
- [ ] 模板浏览页面
- [ ] 模板预览弹窗
- [ ] 模板应用逻辑
- [ ] 导出为模板功能
- [ ] 模板使用统计（可选）

## 验收标准
- [ ] 至少 10 个可用模板
- [ ] 所有模板能正常加载到画布
- [ ] 搜索和筛选功能正常
- [ ] 模板预览清晰易懂
- [ ] 新手测试反馈良好

## 预计工作量
7-10 天
