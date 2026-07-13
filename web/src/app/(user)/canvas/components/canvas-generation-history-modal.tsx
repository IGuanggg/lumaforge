"use client";

import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Segmented, Spin, Tag } from "antd";
import { Image as ImageIcon, Plus, RefreshCw, RotateCcw, Search, Video } from "lucide-react";

import { loadCanvasGenerationHistory, type CanvasGenerationHistoryItem } from "@/services/generation-history";
import type { InsertAssetPayload } from "./asset-picker-modal";

type CanvasGenerationHistoryModalProps = {
    open: boolean;
    onClose: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onReuse: (item: CanvasGenerationHistoryItem) => void;
};

export function CanvasGenerationHistoryModal({ open, onClose, onInsert, onReuse }: CanvasGenerationHistoryModalProps) {
    const { message } = App.useApp();
    const [items, setItems] = useState<CanvasGenerationHistoryItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [kind, setKind] = useState<"all" | "image" | "video">("all");
    const [keyword, setKeyword] = useState("");

    const refresh = async () => {
        setLoading(true);
        try {
            setItems(await loadCanvasGenerationHistory());
        } catch (error) {
            message.error(error instanceof Error ? error.message : "生成历史读取失败");
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) void refresh();
    }, [open]);

    const visibleItems = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return items.filter((item) => {
            if (kind !== "all" && item.kind !== kind) return false;
            if (!query) return true;
            return `${item.title} ${item.prompt} ${item.model}`.toLowerCase().includes(query);
        });
    }, [items, keyword, kind]);

    const insert = (item: CanvasGenerationHistoryItem) => {
        if (!item.url) return;
        if (item.kind === "video") {
            onInsert({ kind: "video", url: item.url, storageKey: item.storageKey, title: item.title, width: item.width, height: item.height });
        } else {
            onInsert({ kind: "image", dataUrl: item.url, storageKey: item.storageKey, title: item.title });
        }
        message.success("已插入画布");
        onClose();
    };

    return (
        <Modal title="生成历史" open={open} onCancel={onClose} footer={null} width={900} destroyOnHidden styles={{ body: { padding: "0 24px 24px" } }}>
            <div className="mb-4 flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                <Segmented
                    value={kind}
                    onChange={(value) => setKind(value as typeof kind)}
                    options={[
                        { value: "all", label: "全部" },
                        { value: "image", label: "图片", icon: <ImageIcon className="size-3.5" /> },
                        { value: "video", label: "视频", icon: <Video className="size-3.5" /> },
                    ]}
                />
                <Input allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} prefix={<Search className="size-4 opacity-45" />} placeholder="搜索提示词或模型" className="sm:min-w-0 sm:flex-1" />
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void refresh()} loading={loading}>
                    刷新
                </Button>
            </div>

            <div className="thin-scrollbar max-h-[68vh] overflow-y-auto pr-1">
                {loading ? (
                    <div className="grid min-h-64 place-items-center">
                        <Spin />
                    </div>
                ) : visibleItems.length ? (
                    <div className="space-y-2">
                        {visibleItems.map((item) => (
                            <HistoryRow key={item.id} item={item} onInsert={() => insert(item)} onReuse={() => onReuse(item)} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={items.length ? "没有匹配的生成记录" : "暂无生成记录"} className="py-16" />
                )}
            </div>
        </Modal>
    );
}

function HistoryRow({ item, onInsert, onReuse }: { item: CanvasGenerationHistoryItem; onInsert: () => void; onReuse: () => void }) {
    return (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800 sm:flex-row sm:items-center">
            <div className="grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900 sm:w-36">
                {item.url && item.kind === "image" ? <img src={item.url} alt="" className="size-full object-cover" /> : null}
                {item.url && item.kind === "video" ? <video src={item.url} className="size-full object-cover" muted preload="metadata" /> : null}
                {!item.url ? item.kind === "image" ? <ImageIcon className="size-7 opacity-35" /> : <Video className="size-7 opacity-35" /> : null}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</div>
                    <Tag color={item.status === "failed" ? "red" : item.kind === "image" ? "blue" : "purple"} className="m-0">
                        {item.status === "failed" ? "失败" : item.kind === "image" ? "图片" : "视频"}
                    </Tag>
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{item.error || item.prompt || "未保存提示词"}</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-400">
                    <span>{formatHistoryTime(item.createdAt)}</span>
                    {item.model ? <span className="truncate">{item.model}</span> : null}
                    {item.width && item.height ? (
                        <span>
                            {item.width} × {item.height}
                        </span>
                    ) : null}
                </div>
            </div>

            <div className="flex shrink-0 gap-2 sm:flex-col">
                <Button size="small" icon={<Plus className="size-3.5" />} disabled={!item.url} onClick={onInsert}>
                    插入画布
                </Button>
                <Button size="small" icon={<RotateCcw className="size-3.5" />} disabled={!item.prompt} onClick={onReuse}>
                    沿用参数
                </Button>
            </div>
        </div>
    );
}

function formatHistoryTime(value: number) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
