"use client";

import { Button, Empty, Input, Segmented, Tag } from "antd";
import { ArrowRight, Boxes, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useCanvasStore } from "../canvas/stores/use-canvas-store";
import { canvasTemplates } from "./templates";
import type { CanvasTemplate, CanvasTemplateCategory } from "./types";

const categories: Array<{ label: string; value: "all" | CanvasTemplateCategory }> = [
    { label: "全部", value: "all" },
    { label: "角色", value: "character" },
    { label: "产品", value: "product" },
    { label: "场景", value: "scene" },
    { label: "工作流", value: "workflow" },
];
const difficultyLabel = { beginner: "入门", intermediate: "进阶", advanced: "高级" } as const;

export default function TemplatesPage() {
    const router = useRouter();
    const importProject = useCanvasStore((state) => state.importProject);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const [category, setCategory] = useState<"all" | CanvasTemplateCategory>("all");
    const [keyword, setKeyword] = useState("");
    const visible = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return canvasTemplates.filter((item) => (category === "all" || item.category === category) && (!query || `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(query)));
    }, [category, keyword]);

    const useTemplate = (item: CanvasTemplate) => {
        const id = importProject({
            title: `${item.name} 副本`,
            nodes: item.canvas.nodes,
            connections: item.canvas.connections,
            viewport: item.canvas.viewport,
            metadata: { source: `template:${item.id}` },
        });
        router.push(`/canvas/${id}`);
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-6 sm:px-6 sm:py-8">
                <header className="border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <p className="text-xs text-stone-500">创作起点</p>
                            <h1 className="mt-2 text-3xl font-semibold">画布模板</h1>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">选择一套节点结构直接开始，提示词和连线都可以继续修改。</p>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                            <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模板或标签" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="min-h-11 w-full sm:w-64" />
                            <Segmented block options={categories} value={category} onChange={(value) => setCategory(value as typeof category)} className="min-h-11" />
                        </div>
                    </div>
                </header>

                {visible.length ? (
                    <section className="grid grid-cols-1 gap-px overflow-hidden border-x border-b border-stone-200 bg-stone-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-stone-800 dark:bg-stone-800">
                        {visible.map((item) => (
                            <article key={item.id} className="group flex min-h-[22rem] flex-col bg-background p-4 sm:p-5">
                                <TemplatePreview template={item} />
                                <div className="mt-4 flex flex-1 flex-col">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-semibold">{item.name}</h2>
                                            <p className="mt-1 text-sm leading-6 text-stone-500">{item.description}</p>
                                        </div>
                                        <Tag className="m-0 shrink-0">{difficultyLabel[item.difficulty]}</Tag>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-1.5">{item.tags.map((tag) => <Tag key={tag} className="m-0">{tag}</Tag>)}</div>
                                    <Button disabled={!hydrated} type="text" className="mt-auto min-h-11 self-end px-0 font-medium" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => useTemplate(item)}>使用模板</Button>
                                </div>
                            </article>
                        ))}
                    </section>
                ) : (
                    <section className="grid min-h-80 place-items-center border-b border-stone-200 dark:border-stone-800"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的模板" /></section>
                )}
            </div>
        </main>
    );
}

function TemplatePreview({ template }: { template: CanvasTemplate }) {
    const nodes = template.canvas.nodes;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const maxX = Math.max(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxY = Math.max(...nodes.map((node) => node.position.y));
    const width = Math.max(1, maxX - minX + 340);
    const height = Math.max(1, maxY - minY + 240);
    return (
        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-stone-200 bg-stone-100 dark:border-stone-700 dark:bg-stone-900" style={{ backgroundImage: "radial-gradient(circle, rgba(120,113,108,.25) 1px, transparent 1px)", backgroundSize: "14px 14px" }}>
            <div className="absolute inset-3">
                {nodes.map((node) => {
                    const left = ((node.position.x - minX) / width) * 78 + 3;
                    const top = ((node.position.y - minY) / height) * 68 + 5;
                    return <div key={node.id} className="absolute flex h-8 w-[18%] min-w-12 items-center gap-1.5 overflow-hidden rounded border bg-white px-1.5 shadow-sm dark:border-stone-700 dark:bg-stone-800" style={{ left: `${left}%`, top: `${top}%`, borderColor: `${template.accent}88` }}><Boxes className="size-3 shrink-0" style={{ color: template.accent }} /><span className="truncate text-[10px] text-stone-600 dark:text-stone-300">{node.title}</span></div>;
                })}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: template.accent }} />
        </div>
    );
}
