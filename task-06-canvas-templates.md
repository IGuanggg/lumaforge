# 任务 6：内置画布模板 [P2]

> 状态：已完成（2026-06-22）。模板库提供 10 个类型安全的真实节点工作流，支持搜索、分类、难度与标签筛选、响应式预览和一键创建；新项目沿用现有本地持久化与云同步。

## 🎨 核心问题

**当前状况**：新手打开空白画布，不知道如何开始

**解决方案**：内置 10+ 个画布模板，降低学习门槛

---

## 📋 模板清单

### 角色设计类
1. **角色三视图** - 正面/侧面/背面（入门）
2. **角色表情包** - 多种情绪表情（中级）

### 产品设计类
3. **产品三视图** - 产品展示（入门）
4. **产品场景图** - 多场景展示（中级）

### 场景创作类
5. **四季风景** - 春夏秋冬风景（入门）
6. **室内设计方案** - 多风格对比（中级）

### 工作流类
7. **批量风格转换** - 一图多风格（高级）
8. **图片超分辨率** - 图片放大（入门）
9. **脚本分镜生成** - 剧本→分镜（高级）
10. **去背景 + 换背景** - 抠图（中级）

---

## 📋 具体任务

### 6.1 模板数据结构

```typescript
// web/src/types/template.ts

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  category: 'character' | 'product' | 'scene' | 'workflow';
  thumbnail: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  
  canvas: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    viewport: ViewportTransform;
  };
  
  instructions?: string;
}
```

### 6.2 模板存储

```
web/public/templates/
├── index.json                    # 模板索引
├── character-turnaround.json
├── product-views.json
├── ...
└── thumbnails/
    └── *.jpg
```

### 6.3 模板浏览页面

```typescript
// web/src/app/(user)/templates/page.tsx

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<CanvasTemplate[]>([]);
  const [filter, setFilter] = useState('all');
  
  useEffect(() => {
    fetch('/templates/index.json')
      .then(res => res.json())
      .then(async (index) => {
        const loaded = await Promise.all(
          index.templates.map((file: string) =>
            fetch(`/templates/${file}`).then(r => r.json())
          )
        );
        setTemplates(loaded);
      });
  }, []);
  
  const handleUseTemplate = async (template: CanvasTemplate) => {
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
  
  return (
    <div className="container p-8">
      <h1 className="text-3xl mb-6">画布模板</h1>
      
      {/* 分类筛选 */}
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
      <div className="grid grid-cols-3 gap-6 mt-6">
        {templates
          .filter(t => filter === 'all' || t.category === filter)
          .map(template => (
            <Card key={template.id} className="cursor-pointer hover:shadow-lg"
                  onClick={() => handleUseTemplate(template)}>
              <img src={template.thumbnail} alt={template.name} 
                   className="aspect-video object-cover rounded-t-lg" />
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-1 flex-wrap">
                  {template.tags.map(tag => (
                    <Badge key={tag} variant="outline">{tag}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
```

### 6.4 在画布列表添加入口

```typescript
// web/src/app/(user)/canvas/page.tsx

<Button variant="outline" asChild>
  <Link href="/templates">
    <LayoutTemplate className="mr-2 h-4 w-4" />
    从模板创建
  </Link>
</Button>
```

---

## ✅ 验收标准

- [ ] 至少 10 个模板
- [ ] 模板能正常加载到画布
- [ ] 搜索和筛选功能正常
- [ ] 缩略图清晰

---

## ⏱️ 预计工作量

**5-7 天**
