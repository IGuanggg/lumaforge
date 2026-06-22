import { nanoid } from "nanoid";

import { CanvasNodeType, type CanvasNodeData } from "../types";
import { useCanvasStore } from "../stores/use-canvas-store";

export type CanvasTransferPayload = {
    kind: "image" | "video";
    title: string;
    url: string;
    storageKey?: string;
    prompt?: string;
    model?: string;
    size?: string;
    quality?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
};

export type CanvasTransferResult = {
    canvasId: string;
    nodeId: string;
};

export function sendGeneratedMediaToCanvas(canvasId: string, payload: CanvasTransferPayload): CanvasTransferResult {
    const store = useCanvasStore.getState();
    const project = store.openProject(canvasId);
    if (!project) throw new Error("目标画布不存在或已被删除");

    const nodeId = nanoid();
    const rightEdge = project.nodes.reduce((value, node) => Math.max(value, node.position.x + node.width), 0);
    const row = project.nodes.length % 4;
    const position = project.nodes.length ? { x: rightEdge + 96, y: row * 72 } : { x: 80, y: 80 };
    const sourceRatio = payload.width && payload.height ? payload.width / payload.height : payload.kind === "video" ? 16 / 9 : 1;
    const width = payload.kind === "video" ? 420 : 360;
    const height = Math.max(220, Math.min(520, Math.round(width / sourceRatio)));
    const node: CanvasNodeData = {
        id: nodeId,
        type: payload.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image,
        title: payload.title,
        position,
        width,
        height,
        metadata: {
            content: payload.url,
            prompt: payload.prompt,
            promptText: payload.prompt,
            model: payload.model,
            size: payload.size,
            quality: payload.quality,
            status: "success",
            generationMode: payload.kind,
            storageKey: payload.storageKey,
            mimeType: payload.mimeType,
            bytes: payload.bytes,
            durationMs: payload.durationMs,
            naturalWidth: payload.width,
            naturalHeight: payload.height,
            runSettings: {
                model: payload.model,
                size: payload.size,
                quality: payload.quality,
                source: "workbench-transfer",
            },
        },
    };

    store.updateProject(canvasId, { nodes: [...project.nodes, node] });
    return { canvasId, nodeId };
}
