"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid3X3, Link2, Minus, MoveHorizontal, MoveVertical, Plus, RotateCcw } from "lucide-react";
import { Button, InputNumber, Modal, Segmented } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasGridSplitParams = {
    columns: number;
    rows: number;
    columnStops: number[];
    rowStops: number[];
};

type CanvasNodeGridSplitDialogProps = {
    open: boolean;
    title?: string;
    dataUrl?: string;
    onClose: () => void;
    onConfirm: (grid: CanvasGridSplitParams) => void;
};

type DragGuide = { axis: "x" | "y"; index: number } | null;

const MIN_GRID = 1;
const MAX_GRID = 6;
const MIN_GAP = 0.04;
const PRESETS = [
    { columns: 2, rows: 2, label: "2 x 2" },
    { columns: 3, rows: 3, label: "3 x 3" },
    { columns: 4, rows: 4, label: "4 x 4" },
    { columns: 3, rows: 2, label: "3 x 2" },
    { columns: 2, rows: 3, label: "2 x 3" },
    { columns: 4, rows: 3, label: "4 x 3" },
    { columns: 3, rows: 4, label: "3 x 4" },
    { columns: 6, rows: 6, label: "6 x 6" },
];

export function CanvasNodeGridSplitDialog({ open, title, dataUrl, onClose, onConfirm }: CanvasNodeGridSplitDialogProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const previewRef = useRef<HTMLDivElement | null>(null);
    const [columns, setColumns] = useState(3);
    const [rows, setRows] = useState(3);
    const [columnStops, setColumnStops] = useState(() => makeStops(3));
    const [rowStops, setRowStops] = useState(() => makeStops(3));
    const [lockSquare, setLockSquare] = useState(false);
    const [showNumbers, setShowNumbers] = useState(true);
    const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
    const [dragGuide, setDragGuide] = useState<DragGuide>(null);
    const total = columns * rows;
    const cells = useMemo(() => buildCells(columnStops, rowStops), [columnStops, rowStops]);
    const pieceSize = useMemo(() => {
        if (!naturalSize) return null;
        const widths = columnStops.slice(0, -1).map((stop, index) => Math.max(1, Math.round((columnStops[index + 1] - stop) * naturalSize.width)));
        const heights = rowStops.slice(0, -1).map((stop, index) => Math.max(1, Math.round((rowStops[index + 1] - stop) * naturalSize.height)));
        return `${rangeLabel(widths)} x ${rangeLabel(heights)}`;
    }, [columnStops, naturalSize, rowStops]);
    const activePreset = PRESETS.find((preset) => preset.columns === columns && preset.rows === rows)?.label || "custom";

    useEffect(() => {
        if (!open) return;
        setColumns(3);
        setRows(3);
        setColumnStops(makeStops(3));
        setRowStops(makeStops(3));
        setLockSquare(false);
        setShowNumbers(true);
        setNaturalSize(null);
        setDragGuide(null);
    }, [open]);

    const moveGuide = useCallback((event: PointerEvent | React.PointerEvent, guide: DragGuide) => {
        if (!guide || !previewRef.current) return;
        const rect = previewRef.current.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const value = guide.axis === "x" ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height;
        if (guide.axis === "x") {
            setColumnStops((current) => moveStop(current, guide.index, value));
        } else {
            setRowStops((current) => moveStop(current, guide.index, value));
        }
    }, []);

    useEffect(() => {
        if (!dragGuide) return;
        const handleMove = (event: PointerEvent) => moveGuide(event, dragGuide);
        const handleUp = () => setDragGuide(null);
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp, { once: true });
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
        };
    }, [dragGuide, moveGuide]);

    const setGridColumns = (value: number) => {
        const next = clampGrid(value);
        setColumns(next);
        setColumnStops(makeStops(next));
        if (lockSquare) {
            setRows(next);
            setRowStops(makeStops(next));
        }
    };

    const setGridRows = (value: number) => {
        const next = clampGrid(value);
        setRows(next);
        setRowStops(makeStops(next));
        if (lockSquare) {
            setColumns(next);
            setColumnStops(makeStops(next));
        }
    };

    const applyPreset = (preset: { columns: number; rows: number }) => {
        const nextRows = lockSquare ? preset.columns : preset.rows;
        setColumns(preset.columns);
        setRows(nextRows);
        setColumnStops(makeStops(preset.columns));
        setRowStops(makeStops(nextRows));
    };

    const resetGuides = () => {
        setColumnStops(makeStops(columns));
        setRowStops(makeStops(rows));
    };

    return (
        <Modal
            title={null}
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            centered
            width={1080}
            destroyOnHidden
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-left text-xs opacity-55">拖动参考线可微调切割位置，输出顺序从左到右、从上到下</div>
                    <div className="flex justify-end gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<Grid3X3 className="size-4" />} onClick={() => onConfirm({ columns, rows, columnStops, rowStops })}>
                            拆分 {columns} x {rows}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]" style={{ color: theme.node.text }}>
                <section className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-xl font-semibold">多宫格拆分</div>
                            <div className="mt-1 truncate text-sm opacity-60" title={title}>
                                {title || "未命名图片"}
                            </div>
                        </div>
                        <div className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                            {total} 个子节点
                        </div>
                    </div>

                    <div ref={previewRef} className="relative overflow-hidden rounded-xl border bg-black/5 dark:bg-white/5" style={{ borderColor: theme.node.stroke }}>
                        {dataUrl ? <img src={dataUrl} alt={title || "多宫格预览"} className="block max-h-[560px] w-full object-contain" draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /> : null}
                        <div className="absolute inset-0">
                            {cells.map((cell, index) => (
                                <div key={index} className="absolute border border-white/75 bg-black/[0.012] shadow-[inset_0_0_0_1px_rgba(0,0,0,.18)]" style={{ left: `${cell.left}%`, top: `${cell.top}%`, width: `${cell.width}%`, height: `${cell.height}%` }}>
                                    {showNumbers ? <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm">{index + 1}</span> : null}
                                </div>
                            ))}
                            {columnStops.slice(1, -1).map((stop, index) => (
                                <GuideLine key={`x-${index}`} axis="x" active={dragGuide?.axis === "x" && dragGuide.index === index + 1} percent={stop * 100} onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const guide = { axis: "x" as const, index: index + 1 };
                                    setDragGuide(guide);
                                    moveGuide(event, guide);
                                }} />
                            ))}
                            {rowStops.slice(1, -1).map((stop, index) => (
                                <GuideLine key={`y-${index}`} axis="y" active={dragGuide?.axis === "y" && dragGuide.index === index + 1} percent={stop * 100} onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const guide = { axis: "y" as const, index: index + 1 };
                                    setDragGuide(guide);
                                    moveGuide(event, guide);
                                }} />
                            ))}
                        </div>
                    </div>
                </section>

                <aside className="rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2 text-base font-semibold">
                            <Grid3X3 className="size-4" />
                            拆分设置
                        </div>
                        <Button size="small" type="text" icon={<RotateCcw className="size-4" />} onClick={() => applyPreset({ columns: 3, rows: 3 })}>
                            重置
                        </Button>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <div className="mb-2 text-xs font-medium opacity-55">快速预设</div>
                            <div className="grid grid-cols-4 gap-2">
                                {PRESETS.map((preset) => (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        className="h-9 rounded-lg border text-xs font-medium transition hover:opacity-90"
                                        style={{ borderColor: activePreset === preset.label ? "#60a5fa" : theme.node.stroke, background: activePreset === preset.label ? "rgba(59,130,246,.18)" : "transparent", color: theme.node.text }}
                                        onClick={() => applyPreset(preset)}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <Segmented
                            block
                            value={lockSquare ? "locked" : "free"}
                            onChange={(value) => {
                                const locked = value === "locked";
                                setLockSquare(locked);
                                if (locked) {
                                    setRows(columns);
                                    setRowStops(makeStops(columns));
                                }
                            }}
                            options={[
                                { label: "独立行列", value: "free" },
                                {
                                    label: (
                                        <span className="inline-flex items-center gap-1">
                                            <Link2 className="size-3.5" />
                                            同步方阵
                                        </span>
                                    ),
                                    value: "locked",
                                },
                            ]}
                        />

                        <div className="space-y-3">
                            <GridStepper label="列数" value={columns} onChange={setGridColumns} />
                            <GridStepper label="行数" value={rows} onChange={setGridRows} disabled={lockSquare} />
                        </div>

                        <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke }}>
                            <div className="mb-2 font-medium opacity-65">参考线微调</div>
                            <div className="grid grid-cols-2 gap-2 opacity-70">
                                <span className="inline-flex items-center gap-1"><MoveHorizontal className="size-3.5" /> 竖线可左右拖动</span>
                                <span className="inline-flex items-center gap-1"><MoveVertical className="size-3.5" /> 横线可上下拖动</span>
                            </div>
                            <Button className="mt-3 !h-8 !w-full" size="small" onClick={resetGuides}>
                                参考线均分
                            </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <Stat label="子节点" value={`${total} 个`} />
                            <Stat label="单块尺寸" value={pieceSize || "读取中"} />
                        </div>

                        <div>
                            <div className="mb-2 text-xs font-medium opacity-55">预览显示</div>
                            <Segmented
                                block
                                value={showNumbers ? "numbers" : "clean"}
                                onChange={(value) => setShowNumbers(value === "numbers")}
                                options={[
                                    { label: "显示编号", value: "numbers" },
                                    { label: "干净网格", value: "clean" },
                                ]}
                            />
                        </div>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

function GuideLine({ axis, percent, active, onPointerDown }: { axis: "x" | "y"; percent: number; active: boolean; onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
    const vertical = axis === "x";
    return (
        <button
            type="button"
            className={`absolute z-20 ${vertical ? "top-0 h-full w-6 -translate-x-1/2 cursor-col-resize" : "left-0 h-6 w-full -translate-y-1/2 cursor-row-resize"}`}
            style={vertical ? { left: `${percent}%` } : { top: `${percent}%` }}
            onPointerDown={onPointerDown}
            aria-label={vertical ? "拖动竖向参考线" : "拖动横向参考线"}
        >
            <span className={`absolute rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,.2)] ${vertical ? "left-1/2 top-0 h-full w-px -translate-x-1/2" : "left-0 top-1/2 h-px w-full -translate-y-1/2"} ${active ? "!bg-blue-400 shadow-[0_0_0_2px_rgba(96,165,250,.45)]" : ""}`} />
            <span className={`absolute rounded-full bg-black/60 ${vertical ? "left-1/2 top-1/2 h-8 w-3 -translate-x-1/2 -translate-y-1/2" : "left-1/2 top-1/2 h-3 w-8 -translate-x-1/2 -translate-y-1/2"} ${active ? "!bg-blue-500" : ""}`} />
        </button>
    );
}

function GridStepper({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
    return (
        <div className={disabled ? "opacity-45" : ""}>
            <div className="mb-1.5 text-sm font-medium opacity-75">{label}</div>
            <div className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-2">
                <Button disabled={disabled || value <= MIN_GRID} className="!h-9 !w-9 !p-0" icon={<Minus className="size-4" />} onClick={() => onChange(value - 1)} />
                <InputNumber className="!w-full" min={MIN_GRID} max={MAX_GRID} disabled={disabled} value={value} onChange={(next) => onChange(Number(next) || MIN_GRID)} />
                <Button disabled={disabled || value >= MAX_GRID} className="!h-9 !w-9 !p-0" icon={<Plus className="size-4" />} onClick={() => onChange(value + 1)} />
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-white/10 px-3 py-2">
            <div className="text-xs opacity-50">{label}</div>
            <div className="mt-1 text-base font-semibold">{value}</div>
        </div>
    );
}

function makeStops(count: number) {
    return Array.from({ length: count + 1 }, (_, index) => index / count);
}

function moveStop(stops: number[], index: number, value: number) {
    if (index <= 0 || index >= stops.length - 1) return stops;
    const next = [...stops];
    const min = next[index - 1] + MIN_GAP;
    const max = next[index + 1] - MIN_GAP;
    next[index] = Math.max(min, Math.min(max, value));
    return next;
}

function buildCells(columnStops: number[], rowStops: number[]) {
    const cells: Array<{ left: number; top: number; width: number; height: number }> = [];
    for (let row = 0; row < rowStops.length - 1; row += 1) {
        for (let column = 0; column < columnStops.length - 1; column += 1) {
            cells.push({
                left: columnStops[column] * 100,
                top: rowStops[row] * 100,
                width: (columnStops[column + 1] - columnStops[column]) * 100,
                height: (rowStops[row + 1] - rowStops[row]) * 100,
            });
        }
    }
    return cells;
}

function rangeLabel(values: number[]) {
    if (!values.length) return "0";
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? `${min}` : `${min}-${max}`;
}

function clampGrid(value: number) {
    return Math.max(MIN_GRID, Math.min(MAX_GRID, Math.floor(Number(value) || MIN_GRID)));
}
