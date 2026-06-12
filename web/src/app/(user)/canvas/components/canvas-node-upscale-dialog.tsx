"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented, Slider } from "antd";
import { ImagePlus, Sparkles } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { readImageMeta } from "@/lib/image-utils";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { MAX_UPSCALE_LONG_EDGE, resolveUpscaleSize, type ImageUpscaleParams } from "../utils/canvas-image-data";

export type CanvasImageUpscaleParams = ImageUpscaleParams & {
    model?: string;
    strength?: number;
};

const targetOptions = [
    { label: "2K", value: 2048 },
    { label: "4K", value: MAX_UPSCALE_LONG_EDGE },
];

const defaultParams: CanvasImageUpscaleParams = {
    targetLongEdge: 2048,
    algorithm: "high",
    strength: 0.55,
};

export function CanvasNodeUpscaleDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (params: CanvasImageUpscaleParams) => void }) {
    const config = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [params, setParams] = useState<CanvasImageUpscaleParams>({ ...defaultParams, model: config.imageModel || config.model || defaultConfig.imageModel });
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, params.targetLongEdge) : null), [image, params.targetLongEdge]);
    const canEnhance = Boolean(image && sourceLongEdge < params.targetLongEdge && params.targetLongEdge <= MAX_UPSCALE_LONG_EDGE);
    const reachedMax = Boolean(image && sourceLongEdge >= MAX_UPSCALE_LONG_EDGE);
    const modelConfig = { ...config, model: params.model || config.imageModel || config.model || defaultConfig.imageModel };

    useEffect(() => {
        if (!open) return;
        setParams({ ...defaultParams, model: config.imageModel || config.model || defaultConfig.imageModel });
        setImage(null);
    }, [config.imageModel, config.model, dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image) return;
        const nextTarget = targetOptions.find((option) => sourceLongEdge < option.value)?.value || MAX_UPSCALE_LONG_EDGE;
        setParams((current) => ({ ...current, targetLongEdge: nextTarget }));
    }, [image, sourceLongEdge]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={900} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">画质增强</h2>
                    <div className="mt-1 text-sm opacity-60">调用你选择的图像模型 API，对当前图片做高清细节增强。</div>
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_400px]">
                    <div className="rounded-xl border p-4">
                        <div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
                            <img src={dataUrl} alt="" className="max-h-[340px] max-w-full rounded-lg object-contain shadow-xl" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">源图</span>
                            <span className="font-semibold">{image ? `${image.width} x ${image.height} px` : "读取中"}</span>
                        </div>
                    </div>
                    <div className="space-y-5 py-2">
                        <div className="rounded-xl border px-4 py-3">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <Sparkles className="size-4" />
                                智能增强
                            </div>
                            <div className="mt-1 text-xs opacity-65">只使用图像模型 API，不再使用本地放大。</div>
                        </div>

                        <div className="space-y-2">
                            <div className="font-medium opacity-75">目标分辨率</div>
                            <Segmented
                                block
                                value={params.targetLongEdge}
                                options={targetOptions.map((option) => ({ label: `${option.label} · ${option.value}px`, value: option.value, disabled: Boolean(image && sourceLongEdge >= option.value) }))}
                                onChange={(value) => setParams((current) => ({ ...current, targetLongEdge: Number(value) }))}
                            />
                            {image && !canEnhance ? <div className="text-xs font-medium text-[#ef4444]">{reachedMax ? "当前图片已经接近 4K，无需继续增强" : "当前图片已经达到这个目标分辨率"}</div> : null}
                        </div>

                        <div className="space-y-2">
                            <div className="font-medium opacity-75">增强图像模型</div>
                            <ModelPicker config={modelConfig} value={params.model || config.imageModel || config.model || defaultConfig.imageModel} onChange={(model) => setParams((current) => ({ ...current, model }))} capability="image" fullWidth onMissingConfig={() => openConfigDialog(true)} />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium opacity-75">增强强度</span>
                                <span className="font-semibold">{(params.strength || 0.55).toFixed(2)}</span>
                            </div>
                            <Slider min={0.1} max={1} step={0.05} value={params.strength || 0.55} onChange={(strength) => setParams((current) => ({ ...current, strength }))} />
                        </div>

                        <div className="rounded-xl border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">输出尺寸</span>
                                <span className="font-semibold">{outputSize ? `${outputSize.width} x ${outputSize.height} px` : "未知"}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<ImagePlus className="size-4" />} disabled={!canEnhance || !params.model} onClick={() => onConfirm(params)}>
                        提交图像模型增强
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
