"use client";

import { ArrowRight, Check, Circle, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { App, Button, Image, Tag } from "antd";

import { fetchPromptsWithCache, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { isUsablePromptCover, PromptCover } from "@/components/prompts/prompt-cover";
import { fetchProviders } from "@/services/api/providers";
import { dismissOnboardingChecklist, getOnboardingState, markOnboardingMilestone, ONBOARDING_EVENT } from "@/services/onboarding";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

const SHOWCASE_SIZE = 12;
const SHOWCASE_POOL_SIZE = 80;
const SHOWCASE_RANDOM_PAGE_COUNT = 4;

function shuffleArray<T>(items: T[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function uniqueUsablePrompts(items: Prompt[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.id) || !isUsablePromptCover(item.coverUrl)) return false;
        seen.add(item.id);
        return true;
    });
}

async function fetchRandomShowcasePrompts() {
    const summary = await fetchPromptsWithCache({ pageSize: 1 });
    const total = Math.max(summary.total, summary.items.length);
    const maxPage = Math.max(1, Math.ceil(total / SHOWCASE_POOL_SIZE));
    const pages = shuffleArray(Array.from({ length: maxPage }, (_, index) => index + 1)).slice(0, Math.min(maxPage, SHOWCASE_RANDOM_PAGE_COUNT));
    const batches = await Promise.all(pages.map((page) => fetchPromptsWithCache({ page, pageSize: SHOWCASE_POOL_SIZE }).catch(() => null)));
    const pool = uniqueUsablePrompts(batches.flatMap((batch) => batch?.items || []));
    const selected = shuffleArray(pool).slice(0, SHOWCASE_SIZE);
    if (selected.length >= Math.min(SHOWCASE_SIZE, total)) return selected;
    return uniqueUsablePrompts([...selected, ...summary.items]).slice(0, SHOWCASE_SIZE);
}

export default function IndexPage() {
    const { message } = App.useApp();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [failedCoverIds, setFailedCoverIds] = useState<Set<string>>(() => new Set());
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [showcaseError, setShowcaseError] = useState("");
    const [showcaseReloadKey, setShowcaseReloadKey] = useState(0);
    const assets = useAssetStore((state) => state.assets);
    const projects = useCanvasStore((state) => state.projects);
    const [onboardingState, setOnboardingState] = useState({ dismissed: false, milestones: {} } as ReturnType<typeof getOnboardingState>);
    const previewImages = useMemo(() => promptShowcase.filter((item) => isUsablePromptCover(item.coverUrl) && !failedCoverIds.has(item.id)), [failedCoverIds, promptShowcase]);

    useEffect(() => {
        void fetchRandomShowcasePrompts()
            .then((data) => {
                setPromptShowcase(data);
                setFailedCoverIds(new Set());
                setShowcaseError("");
            })
            .catch((error) => {
                const errorMessage = error instanceof Error ? error.message : "获取提示词失败";
                setPromptShowcase([]);
                setShowcaseError(errorMessage);
            });
    }, [showcaseReloadKey]);

    useEffect(() => {
        const refresh = () => setOnboardingState(getOnboardingState());
        refresh();
        window.addEventListener(ONBOARDING_EVENT, refresh);
        void fetchProviders()
            .then((providers) => {
                const configured = providers.some((provider) => provider.enabled && provider.has_key && [...provider.image_models, ...provider.chat_models, ...provider.video_models].length > 0);
                if (configured) markOnboardingMilestone("api");
            })
            .catch(() => undefined);
        return () => window.removeEventListener(ONBOARDING_EVENT, refresh);
    }, []);

    const checklist = [
        { key: "api", label: "配置可用的 API", href: "/api-settings", done: Boolean(onboardingState.milestones.api) },
        { key: "generated", label: "完成首次生成", href: "/image", done: Boolean(onboardingState.milestones.generated) },
        { key: "asset", label: "保存首个素材", href: "/assets", done: assets.length > 0 },
        { key: "canvas", label: "创建或进入画布", href: "/canvas", done: projects.length > 0 },
    ];
    const completedSteps = checklist.filter((item) => item.done).length;

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="pointer-events-none absolute left-[15%] top-24 size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />
                <div className="pointer-events-none absolute right-[23%] top-[48%] size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />

                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
                    <h1 className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">LumaForge</h1>
                    <p className="mt-8 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
                        在
                        <Highlighter action="underline" color="#FF9800">
                            智能画布
                        </Highlighter>
                        中生成、连接和重组
                        <Highlighter action="highlight" color="#87CEFA">
                            图片、视频、音频与文字
                        </Highlighter>
                        ，让创作从单次生成变成连续推演。
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <Button type="primary" size="large" href={`/${primaryTool.slug}`} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            开始使用
                        </Button>
                        <Button size="large" href="/image">
                            打开生图工作台
                        </Button>
                    </div>
                </div>

                {!onboardingState.dismissed ? (
                    <section className="relative mx-auto mb-12 w-full max-w-6xl border-y border-stone-200 py-5 dark:border-stone-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div><h2 className="text-base font-semibold">开始使用 LumaForge</h2><p className="mt-1 text-sm text-stone-500">已完成 {completedSteps}/4，按自己的节奏继续。</p></div>
                            <Button type="text" size="small" icon={<X className="size-4" />} onClick={() => dismissOnboardingChecklist()}>永久隐藏</Button>
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {checklist.map((item, index) => (
                                <Button key={item.key} href={item.href} className="!flex !h-auto !items-center !justify-start !gap-2 !px-3 !py-3" icon={item.done ? <Check className="size-4 text-emerald-600" /> : <Circle className="size-4 text-stone-400" />}>
                                    <span className={item.done ? "text-stone-500 line-through" : ""}>{index + 1}. {item.label}</span>
                                </Button>
                            ))}
                        </div>
                    </section>
                ) : null}

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">沉淀每一次好结果</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button type="link" href="/prompts" className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    const nextIndex = previewImages.findIndex((image) => image.id === item.id);
                                    if (nextIndex < 0) {
                                        message.warning("封面暂时不可预览，提示词内容仍可查看");
                                        return;
                                    }
                                    setPreviewIndex(nextIndex);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-stone-200 bg-stone-100 text-left dark:border-stone-800 dark:bg-stone-900",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <PromptCover
                                    item={item}
                                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                                    onUnavailable={(id) => {
                                        setFailedCoverIds((current) => new Set(current).add(id));
                                    }}
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                    {!promptShowcase.length ? (
                        <div className="rounded-xl border border-dashed border-stone-200 bg-white/70 px-6 py-12 text-center dark:border-stone-800 dark:bg-stone-900/70">
                            <p className="text-sm text-stone-500 dark:text-stone-400">{showcaseError || "正在加载提示词图片..."}</p>
                            {showcaseError ? (
                                <Button className="mt-4" onClick={() => setShowcaseReloadKey((value) => value + 1)}>
                                    重新加载
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {previewImages.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
