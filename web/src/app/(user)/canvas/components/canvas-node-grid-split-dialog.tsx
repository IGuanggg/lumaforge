"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { Button, InputNumber, Modal, Slider } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type CanvasNodeGridSplitDialogProps = {
    open: boolean;
    title?: string;
    dataUrl?: string;
    onClose: () => void;
    onConfirm: (grid: { columns: number; rows: number }) => void;
};

export function CanvasNodeGridSplitDialog({ open, title, dataUrl, onClose, onConfirm }: CanvasNodeGridSplitDialogProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [columns, setColumns] = useState(3);
    const [rows, setRows] = useState(3);
    const total = columns * rows;
    const cells = useMemo(() => Array.from({ length: total }), [total]);

    useEffect(() => {
        if (!open) return;
        setColumns(3);
        setRows(3);
    }, [open]);

    return (
        <Modal
            title={null}
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            centered
            width={760}
            destroyOnHidden
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" icon={<Grid3X3 className="size-4" />} onClick={() => onConfirm({ columns, rows })}>
                        拆分 {columns} x {rows}
                    </Button>
                </div>
            }
        >
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]" style={{ color: theme.node.text }}>
                <div className="min-w-0">
                    <div className="mb-3">
                        <div className="text-lg font-semibold">多宫格拆分</div>
                        <div className="mt-1 truncate text-sm opacity-60" title={title}>
                            {title || "未命名图片"} · 拖动滑杆调整行列，再生成子节点
                        </div>
                    </div>
                    <div className="relative overflow-hidden rounded-lg border bg-black/5 dark:bg-white/5" style={{ borderColor: theme.node.stroke }}>
                        {dataUrl ? <img src={dataUrl} alt={title || "多宫格预览"} className="block max-h-[420px] w-full object-contain" /> : null}
                        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
                            {cells.map((_, index) => (
                                <div key={index} className="border border-white/80 bg-black/[0.02] shadow-[inset_0_0_0_1px_rgba(0,0,0,.18)]" />
                            ))}
                        </div>
                    </div>
                </div>

                <aside className="rounded-lg border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
                        <Grid3X3 className="size-4" />
                        多宫格设置
                    </div>
                    <div className="space-y-4">
                        <GridControl label="列数" value={columns} onChange={setColumns} />
                        <GridControl label="行数" value={rows} onChange={setRows} />
                        <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: theme.node.stroke }}>
                            <div className="text-xs opacity-60">将生成</div>
                            <div className="mt-1 text-lg font-semibold">{total} 个子节点</div>
                        </div>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

function GridControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    const setValue = (next: number | null) => onChange(Math.max(1, Math.min(6, Number(next) || 1)));

    return (
        <label className="block">
            <span className="mb-1.5 block text-sm opacity-70">{label}</span>
            <div className="grid grid-cols-[minmax(0,1fr)_64px] items-center gap-3">
                <Slider min={1} max={6} step={1} marks={{ 1: "1", 3: "3", 6: "6" }} value={value} onChange={setValue} tooltip={{ formatter: (next) => `${next || 1}` }} />
                <InputNumber className="!w-full" min={1} max={6} value={value} onChange={setValue} />
            </div>
        </label>
    );
}
