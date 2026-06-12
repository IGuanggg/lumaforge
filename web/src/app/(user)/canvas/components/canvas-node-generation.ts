import type { ChatCompletionMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasPromptReference } from "../types";
import { buildNodeMentionReferences, getGenerationResourceNodes } from "../utils/canvas-resource-references";
import { collectPromptReferencesFromText, orderPromptReferences } from "../utils/canvas-prompt-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
    promptReferences: CanvasPromptReference[];
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const promptReferences = sourceNode ? orderPromptReferences(collectPromptReferencesFromText(prompt, sourceNode.metadata?.promptRefs, buildNodeMentionReferences(sourceNode, nodes, connections)), sourceNode.metadata?.inputReferenceOrder) : [];
    const promptInputs = promptReferencesToInputs(promptReferences);
    const inputs = mergeGenerationInputs(promptInputs, buildNodeGenerationInputs(nodeId, nodes, connections));
    const promptText = stripMentionAtSigns(prompt, promptReferences);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return { ...buildComposerGenerationContext(inputs, promptText), promptReferences };
    }

    const upstreamText = inputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${promptText}\n\n${upstreamText}` : promptText,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
        promptReferences,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
            promptReferences: [],
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
        promptReferences: [],
    };
}

function promptReferencesToInputs(references: CanvasPromptReference[]): NodeGenerationInput[] {
    return references.flatMap((reference): NodeGenerationInput[] => {
        if (reference.kind === "image" && (reference.url || reference.storageKey)) {
            return [
                {
                    nodeId: reference.nodeId || reference.assetId || reference.id,
                    type: "image",
                    title: reference.title || reference.label,
                    image: {
                        id: reference.nodeId || reference.assetId || reference.id,
                        name: `${reference.title || reference.label}.png`,
                        type: reference.mimeType || "image/png",
                        dataUrl: reference.url || reference.storageKey || "",
                        storageKey: reference.storageKey,
                    },
                },
            ];
        }
        if (reference.kind === "video" && (reference.url || reference.storageKey)) {
            return [
                {
                    nodeId: reference.nodeId || reference.assetId || reference.id,
                    type: "video",
                    title: reference.title || reference.label,
                    video: {
                        id: reference.nodeId || reference.assetId || reference.id,
                        name: `${reference.title || reference.label}.mp4`,
                        type: reference.mimeType || "video/mp4",
                        url: reference.url || reference.storageKey || "",
                        storageKey: reference.storageKey,
                    },
                },
            ];
        }
        if (reference.kind === "audio" && (reference.url || reference.storageKey)) {
            return [
                {
                    nodeId: reference.nodeId || reference.assetId || reference.id,
                    type: "audio",
                    title: reference.title || reference.label,
                    audio: {
                        id: reference.nodeId || reference.assetId || reference.id,
                        name: `${reference.title || reference.label}.mp3`,
                        type: reference.mimeType || "audio/mpeg",
                        url: reference.url || reference.storageKey || "",
                        storageKey: reference.storageKey,
                    },
                },
            ];
        }
        if (reference.kind === "text" && reference.text) return [{ nodeId: reference.nodeId || reference.assetId || reference.id, type: "text", title: reference.title || reference.label, text: reference.text }];
        return [];
    });
}

function mergeGenerationInputs(...groups: NodeGenerationInput[][]) {
    const result: NodeGenerationInput[] = [];
    const seen = new Set<string>();
    groups.flat().forEach((input) => {
        const key = input.image ? `image:${input.image.storageKey || input.image.dataUrl || input.nodeId}` : input.video ? `video:${input.video.storageKey || input.video.url || input.nodeId}` : input.audio ? `audio:${input.audio.storageKey || input.audio.url || input.nodeId}` : `${input.type}:${input.nodeId}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push(input);
    });
    return result;
}

function stripMentionAtSigns(prompt: string, references: CanvasPromptReference[]) {
    let next = prompt;
    references.forEach((reference) => {
        next = next.replace(new RegExp(`@${escapeRegExp(reference.label)}(?=\\s|$)`, "g"), reference.label);
    });
    return next;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

export function buildNodeChatMessages(context: NodeGenerationContext): ChatCompletionMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
