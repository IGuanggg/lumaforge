"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ImageIcon, LoaderCircle, Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { collectPromptReferencesFromText, orderPromptReferences, promptReferenceKey, referenceOrder, removePromptReference, removePromptReferenceToken, toPromptReference, upsertPromptReference } from "../utils/canvas-prompt-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onRemoveReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onReplaceReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onIgnoreReference?: (nodeId: string, reference: CanvasResourceReference) => void;
    onImageSettingsOpenChange?: (open: boolean) => void;
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, mentionReferences = [], onRemoveReference, onReplaceReference, onIgnoreReference, onImageSettingsOpenChange }: CanvasNodePromptPanelProps) {
    const globalConfig = useEffectiveConfig();
    const modelCosts = useConfigStore((state) => state.publicSettings?.modelChannel.modelCosts);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    const [promptExpanded, setPromptExpanded] = useState(false);
    const credits = requestCreditCost({ channelMode: config.channelMode, modelCosts, model: config.model, count: mode === "image" ? config.count : 1 });
    const inputImageReferences = useMemo(() => {
        const promptRefs = collectPromptReferencesFromText(prompt, node.metadata?.promptRefs, mentionReferences).filter((reference) => reference.kind === "image");
        const connectedRefs = mentionReferences.filter((reference) => reference.active && reference.kind === "image").map(toPromptReference);
        const merged = [...connectedRefs, ...promptRefs].filter((reference, index, list) => list.findIndex((item) => promptReferenceKey(item) === promptReferenceKey(reference)) === index);
        const ordered = orderPromptReferences(merged, node.metadata?.inputReferenceOrder);
        const referenceByKey = new Map(mentionReferences.map((reference) => [promptReferenceKey(toPromptReference(reference)), reference]));
        return ordered
            .map((reference): CanvasResourceReference => referenceByKey.get(promptReferenceKey(reference)) || { ...reference, previewUrl: reference.url, active: true })
            .filter((reference) => Boolean(reference.previewUrl || reference.url || reference.missing));
    }, [mentionReferences, node.metadata?.inputReferenceOrder, node.metadata?.promptRefs, prompt]);

    useEffect(() => {
        setPrompt(isEditingExistingContent ? "" : node.metadata?.prompt || "");
    }, [isEditingExistingContent, node.id]);

    const updatePrompt = (value: string, nextRefs = collectPromptReferencesFromText(value, node.metadata?.promptRefs, mentionReferences)) => {
        setPrompt(value);
        if (!isEditingExistingContent) onPromptChange(node.id, value);
        const orderedRefs = orderPromptReferences(nextRefs, node.metadata?.inputReferenceOrder);
        onConfigChange(node.id, { promptText: value, promptRefs: orderedRefs, inputReferenceOrder: referenceOrder(orderedRefs) });
    };

    const appendReference = (reference: CanvasResourceReference) => {
        const token = `@${reference.label} `;
        const nextPrompt = prompt ? `${prompt}${/\s$/.test(prompt) ? "" : " "}${token}` : token;
        updatePrompt(nextPrompt, upsertPromptReference(node.metadata?.promptRefs, reference));
    };

    const rememberReference = (reference: CanvasResourceReference) => {
        const nextRefs = upsertPromptReference(node.metadata?.promptRefs, reference);
        onConfigChange(node.id, { promptRefs: nextRefs, inputReferenceOrder: referenceOrder(orderPromptReferences(nextRefs, node.metadata?.inputReferenceOrder)) });
    };

    const removeReference = (reference: CanvasResourceReference) => {
        const nextPrompt = removePromptReferenceToken(prompt, reference.label);
        updatePrompt(nextPrompt, removePromptReference(node.metadata?.promptRefs, reference));
        onRemoveReference?.(node.id, reference);
    };

    const ignoreReference = (reference: CanvasResourceReference) => {
        onIgnoreReference?.(node.id, reference);
    };

    const reorderReference = (fromKey: string, toReference: CanvasResourceReference) => {
        const toKey = promptReferenceKey(toPromptReference(toReference));
        const current = inputImageReferences.map((reference) => promptReferenceKey(toPromptReference(reference)));
        const fromIndex = current.indexOf(fromKey);
        const toIndex = current.indexOf(toKey);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        const next = [...current];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        onConfigChange(node.id, { inputReferenceOrder: next });
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning) return;
        onGenerate(node.id, mode, text);
        setPrompt("");
    };

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {inputImageReferences.length ? (
                <div className="mb-2 flex max-w-full gap-1.5 overflow-x-auto pb-1">
                    {inputImageReferences.map((reference) => (
                        <span
                            key={reference.id}
                            className="inline-flex h-9 max-w-[180px] shrink-0 items-center gap-1.5 rounded-lg border px-1.5 pr-1 text-xs font-medium"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                            title={reference.missing ? "引用缺失，点击缩略图可用素材替换，点 X 可移除" : reference.title}
                            draggable
                            onDragStart={(event) => {
                                event.dataTransfer.setData("text/canvas-reference-key", promptReferenceKey(toPromptReference(reference)));
                                event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                reorderReference(event.dataTransfer.getData("text/canvas-reference-key"), reference);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                        >
                            <button
                                type="button"
                                className="inline-flex min-w-0 items-center gap-1.5 rounded-md pr-1 transition hover:opacity-80"
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={() => (reference.missing ? onReplaceReference?.(node.id, reference) : appendReference(reference))}
                            >
                                {reference.previewUrl || reference.url ? <img src={reference.previewUrl || reference.url} alt="" className="size-6 shrink-0 rounded-md object-cover" /> : <span className="grid size-6 shrink-0 place-items-center rounded-md bg-red-500/15 text-red-300"><ImageIcon className="size-3.5" /></span>}
                                <span className="truncate">{reference.label}</span>
                                {reference.missing ? <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">缺失</span> : null}
                            </button>
                            {reference.missing ? (
                                <button
                                    type="button"
                                    className="h-5 shrink-0 rounded-md px-1 text-[10px] opacity-70 transition hover:bg-white/10 hover:opacity-100"
                                    title="忽略这条缺失引用，保留记录但不再标红"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        ignoreReference(reference);
                                    }}
                                >
                                    忽略
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className="grid size-5 shrink-0 place-items-center rounded-md opacity-60 transition hover:bg-white/10 hover:opacity-100"
                                aria-label={`移除 ${reference.label}`}
                                title="移除引用并断开连线"
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    removeReference(reference);
                                }}
                            >
                                <X className="size-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}
            <div className="relative">
                <CanvasResourceMentionTextarea
                    value={prompt}
                    references={mentionReferences}
                    onReferenceSelect={rememberReference}
                    onChange={updatePrompt}
                    onSubmit={submit}
                    className={`thin-scrollbar w-full resize-none rounded-xl border px-3 py-2 pr-11 text-sm leading-5 outline-none transition-[height] duration-150 ${promptExpanded ? "h-60" : "h-24"}`}
                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                    placeholder={promptPlaceholder(mode, hasImageContent, hasTextContent)}
                />
                <button
                    type="button"
                    className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg border text-xs opacity-70 transition hover:opacity-100"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: theme.toolbar.border, color: theme.node.text }}
                    aria-label={promptExpanded ? "收起生成输入框" : "放大生成输入框"}
                    title={promptExpanded ? "收起生成输入框" : "放大生成输入框"}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => setPromptExpanded((value) => !value)}
                >
                    {promptExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
            </div>

            <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <CanvasPromptLibrary onSelect={updatePrompt} />
                    {mode === "image" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasImageSettingsPopover
                                config={config}
                                placement="topLeft"
                                buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3"
                                onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                                onMissingConfig={() => openConfigDialog(true)}
                                onOpenChange={onImageSettingsOpenChange}
                            />
                        </>
                    ) : mode === "video" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasVideoSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        </>
                    ) : mode === "audio" ? (
                        <>
                            <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} />
                            <CanvasAudioSettingsPopover config={config} buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        </>
                    ) : (
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} />
                    )}
                </div>
                <Button
                    type="primary"
                    className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3"
                    disabled={isRunning || !prompt.trim()}
                    onClick={submit}
                    aria-label="生成"
                >
                    <span className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums">
                            <CreditSymbol />
                            {credits.toLocaleString()}
                        </span>
                        {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                    </span>
                </Button>
            </div>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? globalConfig.imageModel : mode === "video" ? globalConfig.videoModel : mode === "audio" ? globalConfig.audioModel : globalConfig.textModel;
    return {
        ...globalConfig,
        model: node.metadata?.model || defaultModel || (mode === "audio" ? defaultConfig.audioModel : globalConfig.model || defaultConfig.model),
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function promptPlaceholder(mode: CanvasNodeGenerationMode, hasImageContent: boolean, hasTextContent: boolean) {
    if (mode === "video") return "描述要生成的视频内容";
    if (mode === "audio") return "描述要生成的音频内容";
    if (mode === "image") return hasImageContent ? "请输入你想要把这张图修改成什么" : "描述要生成的图片内容";
    return hasTextContent ? "请输入你想要将本段文本修改成什么" : "请输入你想要生成的文本内容";
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
