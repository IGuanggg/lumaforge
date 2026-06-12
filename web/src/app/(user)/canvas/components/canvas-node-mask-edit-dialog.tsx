"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Input, Modal, Segmented, Slider } from "antd";
import { Brush, Circle, Eraser, ListOrdered, Paintbrush, Redo2, RotateCcw, Square, Type, Undo2, WandSparkles, X } from "lucide-react";

import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageMaskEditPayload = {
    prompt?: string;
    maskDataUrl?: string;
    paintDataUrl?: string;
};

type EditMode = "paint" | "mask";
type MaskTool = "paint" | "erase";
type PaintTool = "free" | "rect" | "ellipse" | "label" | "text";
type Point = { x: number; y: number };
type TextAnnotation = { id: string; x: number; y: number; text: string; size: number; color: string };
type DrawSnapshot = { imageData: ImageData; labelCounter: number; textAnnotations: TextAnnotation[] };

const DEFAULT_MASK_SIZE = 96;
const DEFAULT_PAINT_SIZE = 14;
const HISTORY_LIMIT = 40;
const MASK_FILL_COLOR = "rgba(37, 99, 235, .38)";
const MASK_BORDER_COLOR = "rgba(255, 255, 255, .72)";

export function CanvasNodeMaskEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageMaskEditPayload) => void }) {
    const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const drawStateRef = useRef<{ active: boolean; pointerId: number | null; last: Point | null; start: Point | null; snapshot: DrawSnapshot | null }>({ active: false, pointerId: null, last: null, start: null, snapshot: null });
    const undoStackRef = useRef<DrawSnapshot[]>([]);
    const redoStackRef = useRef<DrawSnapshot[]>([]);
    const labelCounterRef = useRef(1);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [mode, setMode] = useState<EditMode>("paint");
    const [maskTool, setMaskTool] = useState<MaskTool>("paint");
    const [paintTool, setPaintTool] = useState<PaintTool>("free");
    const [paintColor, setPaintColor] = useState("#ff2d55");
    const [annotationText, setAnnotationText] = useState("");
    const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
    const [maskBrushSize, setMaskBrushSize] = useState(DEFAULT_MASK_SIZE);
    const [paintBrushSize, setPaintBrushSize] = useState(DEFAULT_PAINT_SIZE);
    const [prompt, setPrompt] = useState("");
    const [error, setError] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

    const syncHistoryState = useCallback(() => {
        setHistoryState({ canUndo: undoStackRef.current.length > 0, canRedo: redoStackRef.current.length > 0 });
    }, []);

    const renderPreview = useCallback(() => {
        const drawingCanvas = drawingCanvasRef.current;
        const previewCanvas = previewCanvasRef.current;
        if (!drawingCanvas || !previewCanvas) return;
        if (mode === "mask") renderMaskPreview(drawingCanvas, previewCanvas, canvasHasPaint(drawingCanvas));
        else renderPaintPreview(drawingCanvas, previewCanvas, textAnnotations, selectedTextId);
    }, [mode, selectedTextId, textAnnotations]);

    useEffect(() => {
        if (!open) return;
        setMode("paint");
        setMaskTool("paint");
        setPaintTool("free");
        setPaintColor("#ff2d55");
        setAnnotationText("");
        setTextAnnotations([]);
        setSelectedTextId(null);
        setMaskBrushSize(DEFAULT_MASK_SIZE);
        setPaintBrushSize(DEFAULT_PAINT_SIZE);
        setPrompt("");
        setError("");
        labelCounterRef.current = 1;
        undoStackRef.current = [];
        redoStackRef.current = [];
        syncHistoryState();
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open, syncHistoryState]);

    useEffect(() => {
        clearCanvas(drawingCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        undoStackRef.current = [];
        redoStackRef.current = [];
        labelCounterRef.current = 1;
        setTextAnnotations([]);
        setSelectedTextId(null);
        syncHistoryState();
    }, [image, syncHistoryState]);

    useEffect(() => {
        clearCanvas(drawingCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        undoStackRef.current = [];
        redoStackRef.current = [];
        labelCounterRef.current = 1;
        setTextAnnotations([]);
        setSelectedTextId(null);
        setError("");
        syncHistoryState();
    }, [mode, syncHistoryState]);

    const pushHistory = () => {
        const snapshot = takeSnapshot(drawingCanvasRef.current, labelCounterRef.current, textAnnotations);
        if (!snapshot) return;
        undoStackRef.current.push(snapshot);
        if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
        redoStackRef.current = [];
        syncHistoryState();
    };

    const undo = () => {
        const snapshot = undoStackRef.current.pop();
        const current = takeSnapshot(drawingCanvasRef.current, labelCounterRef.current, textAnnotations);
        if (!snapshot || !current) return;
        redoStackRef.current.push(current);
        restoreSnapshot(drawingCanvasRef.current, snapshot);
        labelCounterRef.current = snapshot.labelCounter;
        setTextAnnotations(snapshot.textAnnotations);
        setSelectedTextId(null);
        syncHistoryState();
    };

    const redo = () => {
        const snapshot = redoStackRef.current.pop();
        const current = takeSnapshot(drawingCanvasRef.current, labelCounterRef.current, textAnnotations);
        if (!snapshot || !current) return;
        undoStackRef.current.push(current);
        restoreSnapshot(drawingCanvasRef.current, snapshot);
        labelCounterRef.current = snapshot.labelCounter;
        setTextAnnotations(snapshot.textAnnotations);
        setSelectedTextId(null);
        syncHistoryState();
    };

    useEffect(() => {
        renderPreview();
    }, [renderPreview]);

    const resetDrawing = () => {
        if (canvasHasPaint(drawingCanvasRef.current) || textAnnotations.length) pushHistory();
        clearCanvas(drawingCanvasRef.current);
        clearCanvas(previewCanvasRef.current);
        setTextAnnotations([]);
        setSelectedTextId(null);
        labelCounterRef.current = 1;
        setError("");
        syncHistoryState();
    };

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const canvas = drawingCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);

        if (mode === "paint" && paintTool === "text") {
            const hitText = findTextAnnotationAtPoint(textAnnotations, point);
            if (hitText) {
                setSelectedTextId(hitText.id);
                setAnnotationText(hitText.text);
                setPaintBrushSize(Math.max(2, Math.round(hitText.size / 2)));
                setPaintColor(hitText.color);
                setError("");
                return;
            }
            if (!annotationText.trim()) {
                setError("请先输入要标注的文字");
                return;
            }
            pushHistory();
            const nextText: TextAnnotation = {
                id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                x: point.x,
                y: point.y,
                text: annotationText.trim(),
                size: Math.max(12, paintBrushSize * 2),
                color: paintColor,
            };
            setTextAnnotations((current) => [...current, nextText]);
            setSelectedTextId(nextText.id);
            syncHistoryState();
            setError("");
            return;
        }

        pushHistory();
        event.currentTarget.setPointerCapture(event.pointerId);

        if (mode === "paint" && paintTool === "label") {
            drawNumberLabel(context, point, paintBrushSize, paintColor, labelCounterRef.current);
            labelCounterRef.current += 1;
            renderPreview();
            syncHistoryState();
            return;
        }

        const snapshot = mode === "paint" && paintTool !== "free" ? takeSnapshot(canvas, labelCounterRef.current, textAnnotations) : null;
        drawStateRef.current = { active: true, pointerId: event.pointerId, last: point, start: point, snapshot };
        if (mode === "mask" || paintTool === "free") drawStroke(context, point, point, currentBrushSize(mode, maskBrushSize, paintBrushSize), currentStyle(mode, maskTool, paintColor));
        renderPreview();
        setError("");
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const state = drawStateRef.current;
        if (!state.active) return;
        event.preventDefault();
        event.stopPropagation();
        const canvas = drawingCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || !state.start || !state.last) return;
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);

        if (mode === "paint" && paintTool !== "free") {
            if (state.snapshot) restoreSnapshot(canvas, state.snapshot);
            drawPaintShape(context, paintTool, state.start, point, paintBrushSize, paintColor);
            renderPreview();
            return;
        }

        drawStroke(context, state.last, point, currentBrushSize(mode, maskBrushSize, paintBrushSize), currentStyle(mode, maskTool, paintColor));
        drawStateRef.current.last = point;
        renderPreview();
    };

    const stopDraw = (event?: ReactPointerEvent<HTMLCanvasElement>) => {
        if (drawStateRef.current.pointerId != null && event?.currentTarget) {
            event.currentTarget.releasePointerCapture(drawStateRef.current.pointerId);
        }
        drawStateRef.current = { active: false, pointerId: null, last: null, start: null, snapshot: null };
        renderPreview();
        syncHistoryState();
    };

    const submit = async () => {
        const canvas = drawingCanvasRef.current;
        if (!canvas) return;
        if (!canvasHasPaint(canvas) && !textAnnotations.length) return setError(mode === "mask" ? "请先涂抹需要局部修改的区域" : "请先在图片上画笔标注");
        if (mode === "mask") {
            const nextPrompt = prompt.trim();
            if (!nextPrompt) return setError("请输入局部修改要求");
            onConfirm({ prompt: nextPrompt, maskDataUrl: buildEditMask(canvas) });
            return;
        }
        const paintDataUrl = await buildPaintImage(dataUrl, canvas, textAnnotations);
        onConfirm({ paintDataUrl });
    };

    const activeBrushSize = mode === "mask" ? maskBrushSize : paintBrushSize;

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={1180} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(420px,1fr)_340px]">
                <section className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="text-xl font-semibold">画笔编辑</h2>
                            <div className="mt-1 text-sm opacity-60">{mode === "paint" ? "直接在图片上绘制文字、标记或草图" : "涂抹需要 AI 局部修改的区域"}</div>
                        </div>
                        {image ? <div className="rounded-full border px-3 py-1 text-xs opacity-70">{image.width} x {image.height}px</div> : null}
                    </div>

                    <div className="flex min-h-[440px] items-center justify-center rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10">
                        <div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent select-none">
                            <img src={dataUrl} alt="" className="block max-h-[72vh] max-w-full bg-transparent" draggable={false} />
                            {image ? (
                                <>
                                    <canvas ref={drawingCanvasRef} width={image.width} height={image.height} className="hidden" />
                                    <canvas
                                        ref={previewCanvasRef}
                                        width={image.width}
                                        height={image.height}
                                        className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                                        onPointerDown={startDraw}
                                        onPointerMove={moveDraw}
                                        onPointerUp={stopDraw}
                                        onPointerCancel={stopDraw}
                                    />
                                </>
                            ) : null}
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-[440px] flex-col gap-5">
                    <Segmented
                        block
                        value={mode}
                        onChange={(value) => setMode(value as EditMode)}
                        options={[
                            { label: "画笔标注", value: "paint" },
                            { label: "AI 遮罩", value: "mask" },
                        ]}
                    />

                    {mode === "paint" ? (
                        <div className="space-y-3">
                            <div className="text-sm font-medium opacity-75">画笔工具</div>
                            <div className="grid grid-cols-5 gap-2">
                                <ToolButton active={paintTool === "free"} icon={<Paintbrush className="size-4" />} label="自由" onClick={() => { setPaintTool("free"); setSelectedTextId(null); }} />
                                <ToolButton active={paintTool === "rect"} icon={<Square className="size-4" />} label="矩形" onClick={() => { setPaintTool("rect"); setSelectedTextId(null); }} />
                                <ToolButton active={paintTool === "ellipse"} icon={<Circle className="size-4" />} label="椭圆" onClick={() => { setPaintTool("ellipse"); setSelectedTextId(null); }} />
                                <ToolButton active={paintTool === "label"} icon={<ListOrdered className="size-4" />} label="编号" onClick={() => { setPaintTool("label"); setSelectedTextId(null); }} />
                                <ToolButton active={paintTool === "text"} icon={<Type className="size-4" />} label="文本" onClick={() => setPaintTool("text")} />
                            </div>
                            {paintTool === "text" ? (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-medium opacity-75">{selectedTextId ? "修改文字" : "标注文字"}</div>
                                        {selectedTextId ? (
                                            <Button
                                                size="small"
                                                danger
                                                onClick={() => {
                                                    pushHistory();
                                                    setTextAnnotations((current) => current.filter((item) => item.id !== selectedTextId));
                                                    setSelectedTextId(null);
                                                    setAnnotationText("");
                                                    syncHistoryState();
                                                }}
                                            >
                                                删除文字
                                            </Button>
                                        ) : null}
                                    </div>
                                    <Input.TextArea
                                        rows={3}
                                        value={annotationText}
                                        status={error && !annotationText.trim() ? "error" : undefined}
                                        placeholder="输入文字后，点击图片放置；点已有文字可再次修改"
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            if (selectedTextId) {
                                                setTextAnnotations((current) => current.map((item) => (item.id === selectedTextId ? { ...item, text: value } : item)));
                                            }
                                            setAnnotationText(value);
                                            setError("");
                                        }}
                                    />
                                    {selectedTextId ? <div className="text-xs opacity-60">已选中文字。修改内容、颜色或字号会实时更新。</div> : null}
                                </div>
                            ) : null}
                            <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm">
                                <span className="font-medium opacity-75">颜色</span>
                                <input
                                    type="color"
                                    value={paintColor}
                                    className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                                    onChange={(event) => {
                                        const value = event.target.value;
                                        setPaintColor(value);
                                        if (selectedTextId) setTextAnnotations((current) => current.map((item) => (item.id === selectedTextId ? { ...item, color: value } : item)));
                                    }}
                                />
                            </label>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-sm font-medium opacity-75">遮罩工具</div>
                            <div className="grid grid-cols-2 gap-2">
                                <ToolButton active={maskTool === "paint"} icon={<Brush className="size-4" />} label="涂抹" onClick={() => setMaskTool("paint")} />
                                <ToolButton active={maskTool === "erase"} icon={<Eraser className="size-4" />} label="擦除" onClick={() => setMaskTool("erase")} />
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-medium opacity-75">{mode === "paint" && paintTool === "text" ? "字号" : "笔刷大小"}</span>
                            <span className="font-semibold">{activeBrushSize}px</span>
                        </div>
                        {mode === "mask" ? (
                            <Slider min={8} max={180} step={2} value={maskBrushSize} onChange={setMaskBrushSize} />
                        ) : (
                            <Slider
                                min={2}
                                max={120}
                                step={1}
                                value={paintBrushSize}
                                onChange={(value) => {
                                    setPaintBrushSize(value);
                                    if (selectedTextId && paintTool === "text") setTextAnnotations((current) => current.map((item) => (item.id === selectedTextId ? { ...item, size: Math.max(12, value * 2) } : item)));
                                }}
                            />
                        )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <Button icon={<Undo2 className="size-4" />} disabled={!historyState.canUndo} onClick={undo}>撤销</Button>
                        <Button icon={<Redo2 className="size-4" />} disabled={!historyState.canRedo} onClick={redo}>恢复</Button>
                        <Button icon={<RotateCcw className="size-4" />} onClick={resetDrawing}>清空</Button>
                    </div>

                    {mode === "mask" ? (
                        <div className="space-y-2">
                            <div className="text-sm font-medium opacity-75">局部修改要求</div>
                            <Input.TextArea
                                rows={6}
                                value={prompt}
                                status={error && !prompt.trim() ? "error" : undefined}
                                placeholder="例如：把选中区域改成金属材质，保持原图光影"
                                onChange={(event) => {
                                    setPrompt(event.target.value);
                                    setError("");
                                }}
                            />
                        </div>
                    ) : (
                        <div className="rounded-lg border border-white/10 px-3 py-2 text-sm opacity-70">
                            画笔会直接合成到图片上，并生成一个新的结果节点。
                        </div>
                    )}

                    {error ? <div className="text-xs font-medium text-[#ef4444]">{error}</div> : null}

                    <div className="mt-auto flex items-center justify-between gap-2">
                        <Button icon={<X className="size-4" />} onClick={onClose}>取消</Button>
                        <Button type="primary" icon={mode === "mask" ? <WandSparkles className="size-4" /> : <Brush className="size-4" />} onClick={() => void submit()}>
                            {mode === "mask" ? "AI 修改" : "应用画笔"}
                        </Button>
                    </div>
                </aside>
            </div>
        </Modal>
    );
}

function ToolButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
    return (
        <Button type={active ? "primary" : "default"} className="!h-10 !px-2" icon={icon} onClick={onClick}>
            {label}
        </Button>
    );
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function takeSnapshot(canvas: HTMLCanvasElement | null, labelCounter: number, textAnnotations: TextAnnotation[]): DrawSnapshot | null {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return null;
    return { imageData: context.getImageData(0, 0, canvas.width, canvas.height), labelCounter, textAnnotations: textAnnotations.map((item) => ({ ...item })) };
}

function restoreSnapshot(canvas: HTMLCanvasElement | null, snapshot: DrawSnapshot) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.putImageData(snapshot.imageData, 0, 0);
}

function currentBrushSize(mode: EditMode, maskBrushSize: number, paintBrushSize: number) {
    return mode === "mask" ? maskBrushSize : paintBrushSize;
}

function currentStyle(mode: EditMode, maskTool: MaskTool, paintColor: string) {
    return {
        color: mode === "mask" ? "#000000" : paintColor,
        composite: mode === "mask" && maskTool === "erase" ? ("destination-out" as GlobalCompositeOperation) : ("source-over" as GlobalCompositeOperation),
    };
}

function setupDrawStyle(context: CanvasRenderingContext2D, size: number, style: { color: string; composite: GlobalCompositeOperation }) {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = size;
    context.strokeStyle = style.color;
    context.fillStyle = style.color;
    context.globalCompositeOperation = style.composite;
}

function drawStroke(context: CanvasRenderingContext2D, from: Point, to: Point, size: number, style: { color: string; composite: GlobalCompositeOperation }) {
    setupDrawStyle(context, size, style);
    if (from.x === to.x && from.y === to.y) {
        context.beginPath();
        context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function drawPaintShape(context: CanvasRenderingContext2D, tool: PaintTool, start: Point, end: Point, size: number, color: string) {
    if (tool === "text" || tool === "label") return;
    setupDrawStyle(context, size, { color, composite: "source-over" });
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (tool === "rect") {
        context.strokeRect(x, y, width, height);
    } else if (tool === "ellipse") {
        context.beginPath();
        context.ellipse(x + width / 2, y + height / 2, Math.max(1, width / 2), Math.max(1, height / 2), 0, 0, Math.PI * 2);
        context.stroke();
    }
}

function drawNumberLabel(context: CanvasRenderingContext2D, point: Point, brushSize: number, color: string, labelCounter: number) {
    const size = Math.max(18, brushSize * 2.2);
    const text = labelCounter >= 1 && labelCounter <= 20 ? String.fromCharCode(0x2460 + labelCounter - 1) : String(labelCounter);
    drawOutlinedText(context, text, point, size, color, "center");
}

function drawOutlinedText(context: CanvasRenderingContext2D, text: string, point: Point, size: number, color: string, align: CanvasTextAlign) {
    context.save();
    context.font = `900 ${size}px Arial, sans-serif`;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.lineWidth = Math.max(3, size / 8);
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.strokeText(text, point.x, point.y);
    context.fillStyle = color;
    context.fillText(text, point.x, point.y);
    context.restore();
}

function drawTextAnnotation(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
    const lines = annotation.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const lineHeight = annotation.size * 1.25;
    lines.forEach((line, index) => drawOutlinedText(context, line, { x: annotation.x, y: annotation.y + index * lineHeight }, annotation.size, annotation.color, "left"));
}

function textAnnotationBounds(annotation: TextAnnotation) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const lines = annotation.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!context || !lines.length) return { x: annotation.x, y: annotation.y - annotation.size, width: 0, height: annotation.size * 1.25 };
    context.font = `900 ${annotation.size}px Arial, sans-serif`;
    const width = Math.max(...lines.map((line) => context.measureText(line).width));
    const height = Math.max(annotation.size, lines.length * annotation.size * 1.25);
    return { x: annotation.x - annotation.size * 0.12, y: annotation.y - annotation.size * 0.72, width: width + annotation.size * 0.24, height };
}

function findTextAnnotationAtPoint(annotations: TextAnnotation[], point: Point) {
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
        const bounds = textAnnotationBounds(annotations[index]);
        if (point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height) return annotations[index];
    }
    return null;
}

function canvasHasPaint(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) return true;
    }
    return false;
}

function renderPaintPreview(drawingCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement | null, textAnnotations: TextAnnotation[], selectedTextId: string | null) {
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.drawImage(drawingCanvas, 0, 0);
    textAnnotations.forEach((annotation) => {
        drawTextAnnotation(context, annotation);
        if (annotation.id === selectedTextId) drawSelectedTextBounds(context, annotation);
    });
}

function drawSelectedTextBounds(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
    const bounds = textAnnotationBounds(annotation);
    context.save();
    context.strokeStyle = "rgba(37, 99, 235, 0.95)";
    context.lineWidth = Math.max(2, annotation.size / 12);
    context.setLineDash([Math.max(6, annotation.size / 2), Math.max(4, annotation.size / 3)]);
    context.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
    context.restore();
}

function renderMaskPreview(maskCanvas: HTMLCanvasElement, previewCanvas: HTMLCanvasElement | null, withBorder = false) {
    const context = previewCanvas?.getContext("2d");
    if (!previewCanvas || !context) return;
    context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.fillStyle = MASK_FILL_COLOR;
    context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    if (withBorder) drawDashedMaskBorder(context, maskCanvas);
}

function drawDashedMaskBorder(context: CanvasRenderingContext2D, maskCanvas: HTMLCanvasElement) {
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) return;
    const { width, height } = maskCanvas;
    const data = maskContext.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.round(Math.max(width, height) / 1200));
    const dash = step * 8;
    const gap = step * 5;
    const period = dash + gap;

    context.save();
    context.fillStyle = MASK_BORDER_COLOR;
    context.shadowColor = "rgba(0, 0, 0, .24)";
    context.shadowBlur = step * 1.5;
    for (let y = step; y < height - step; y += step) {
        for (let x = step; x < width - step; x += step) {
            const offset = (y * width + x) * 4 + 3;
            if (data[offset] === 0 || !isMaskEdge(data, width, x, y, step)) continue;
            if ((x + y) % period > dash) continue;
            context.fillRect(x - step / 2, y - step / 2, Math.max(1.5, step), Math.max(1.5, step));
        }
    }
    context.restore();
}

function isMaskEdge(data: Uint8ClampedArray, width: number, x: number, y: number, step: number) {
    return data[((y - step) * width + x) * 4 + 3] === 0 || data[((y + step) * width + x) * 4 + 3] === 0 || data[(y * width + x - step) * 4 + 3] === 0 || data[(y * width + x + step) * 4 + 3] === 0;
}

function buildEditMask(selectionCanvas: HTMLCanvasElement) {
    const canvas = document.createElement("canvas");
    canvas.width = selectionCanvas.width;
    canvas.height = selectionCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return selectionCanvas.toDataURL("image/png");
    const selectionContext = selectionCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!selectionContext) return canvas.toDataURL("image/png");
    const selection = selectionContext.getImageData(0, 0, canvas.width, canvas.height);
    const mask = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < mask.data.length; index += 4) {
        if (selection.data[index] > 0) mask.data[index] = 0;
    }
    context.putImageData(mask, 0, 0);
    return canvas.toDataURL("image/png");
}

async function buildPaintImage(dataUrl: string, paintCanvas: HTMLCanvasElement, textAnnotations: TextAnnotation[]) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || paintCanvas.width;
    canvas.height = image.naturalHeight || paintCanvas.height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.drawImage(paintCanvas, 0, 0, canvas.width, canvas.height);
    textAnnotations.forEach((annotation) => drawTextAnnotation(context, annotation));
    return canvas.toDataURL("image/png");
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });
}
