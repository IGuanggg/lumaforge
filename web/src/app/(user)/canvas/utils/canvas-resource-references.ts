import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasPromptReference, type CanvasPromptReferenceSource } from "../types";
import { promptReferenceKey } from "./canvas-prompt-references";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId?: string;
    assetId?: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    sourceType: CanvasPromptReferenceSource;
    previewUrl?: string;
    url?: string;
    storageKey?: string;
    mimeType?: string;
    imageIndex?: number;
    text?: string;
    active: boolean;
    missing?: boolean;
    ignoredMissing?: boolean;
};

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId?: string | null, assets: Asset[] = []) {
    const contextNode = contextNodeId ? nodes.find((node) => node.id === contextNodeId) || null : null;
    const contextReferences = contextNode ? buildNodeMentionReferences(contextNode, nodes, connections, assets) : [];
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false, "upstream");
    const activeByNodeId = new Map(contextReferences.filter((reference) => reference.active && reference.nodeId).map((reference) => [reference.nodeId, reference]));
    return globalReferences.map((reference) => (reference.nodeId ? activeByNodeId.get(reference.nodeId) || reference : reference));
}

export function buildNodeMentionReferences(node: CanvasNodeData | null, nodes: CanvasNodeData[], connections: CanvasConnection[], assets: Asset[] = []) {
    if (!node) return [];
    const directNodes = getDirectResourceNodes(node.id, nodes, connections);
    const configNodes = getConnectedConfigResourceNodes(node.id, nodes, connections);
    const connectedNodes = configNodes.length ? configNodes : directNodes;
    const upstreamNodes = getContextResourceNodes(node.id, nodes, connections).filter((item) => !connectedNodes.some((connected) => connected.id === item.id));
    const selfNodes = isResourceNode(node) && !connectedNodes.some((item) => item.id === node.id) ? [node] : [];
    const connectedReferences = labelResourceNodes([...connectedNodes, ...selfNodes], true, "connected");
    const upstreamReferences = labelResourceNodes(upstreamNodes, false, "upstream", connectedReferences.length);
    const assetReferences = labelAssetResources(assets, false, "asset", connectedReferences.length + upstreamReferences.length);
    return mergeReferences(connectedReferences, savedPromptReferences(node.metadata?.promptRefs), upstreamReferences, assetReferences);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ownInputs = getDirectResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const upstreamInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (upstreamInputs.length) return upstreamInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getDirectResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

function getDirectResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodeById.get(connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingByNodeId = new Map<string, CanvasConnection[]>();
    connections.forEach((connection) => {
        const incoming = incomingByNodeId.get(connection.toNodeId) || [];
        incoming.push(connection);
        incomingByNodeId.set(connection.toNodeId, incoming);
    });

    const result: CanvasNodeData[] = [];
    const queued = [...(incomingByNodeId.get(nodeId) || []).map((connection) => connection.fromNodeId)];
    const visited = new Set<string>([nodeId]);
    const added = new Set<string>();

    while (queued.length) {
        const currentId = queued.shift();
        if (!currentId || visited.has(currentId)) continue;
        visited.add(currentId);
        const node = nodeById.get(currentId);
        if (!node) continue;
        if (isResourceNode(node) && !added.has(node.id)) {
            result.push(node);
            added.add(node.id);
        }
        queued.push(...(incomingByNodeId.get(currentId) || []).map((connection) => connection.fromNodeId));
    }

    return result;
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getDirectResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean, sourceType: CanvasPromptReferenceSource, startIndex = 0) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    let offset = startIndex;
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = counts[kind]++ + offset;
        const label = labelForKind(kind, index);
        offset = Math.max(offset, index + 1);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                sourceType,
                previewUrl: node.metadata?.content,
                url: node.metadata?.content,
                storageKey: node.metadata?.storageKey,
                mimeType: node.metadata?.mimeType,
                text: node.type === CanvasNodeType.Text ? node.metadata?.content || node.metadata?.prompt : undefined,
                active,
            },
        ];
    });
}

function labelAssetResources(assets: Asset[], active: boolean, sourceType: CanvasPromptReferenceSource, startIndex = 0) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    let offset = startIndex;
    return assets.flatMap((asset): CanvasResourceReference[] => {
        const kind = asset.kind;
        const index = counts[kind]++ + offset;
        const label = labelForKind(kind, index);
        offset = Math.max(offset, index + 1);
        if (asset.kind === "image") return [{ id: `asset-${asset.id}`, assetId: asset.id, kind, label, title: asset.title || label, sourceType, previewUrl: asset.data.dataUrl, url: asset.data.dataUrl, storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, active }];
        if (asset.kind === "video") return [{ id: `asset-${asset.id}`, assetId: asset.id, kind, label, title: asset.title || label, sourceType, previewUrl: asset.coverUrl || asset.data.url, url: asset.data.url, storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, active }];
        if (asset.kind === "audio") return [{ id: `asset-${asset.id}`, assetId: asset.id, kind, label, title: asset.title || label, sourceType, url: asset.data.url, storageKey: asset.data.storageKey, mimeType: asset.data.mimeType, active }];
        return [{ id: `asset-${asset.id}`, assetId: asset.id, kind, label, title: asset.title || label, sourceType, text: asset.data.content, active }];
    });
}

function savedPromptReferences(references?: CanvasPromptReference[]) {
    return (references || []).map(
        (reference): CanvasResourceReference => ({
            id: reference.id,
            nodeId: reference.nodeId,
            assetId: reference.assetId,
            kind: reference.kind,
            label: reference.label,
            title: reference.title,
            sourceType: reference.sourceType || "manual",
            previewUrl: reference.url,
            url: reference.url,
            storageKey: reference.storageKey,
            mimeType: reference.mimeType,
            imageIndex: reference.imageIndex,
            text: reference.text,
            missing: !reference.ignoredMissing && (reference.missing || (reference.kind !== "text" && !reference.url && !reference.storageKey)),
            ignoredMissing: reference.ignoredMissing,
            active: true,
        }),
    );
}

function mergeReferences(...groups: CanvasResourceReference[][]) {
    const result: CanvasResourceReference[] = [];
    const seen = new Set<string>();
    groups.flat().forEach((reference) => {
        const key = promptReferenceKey(reference);
        if (seen.has(key)) return;
        seen.add(key);
        result.push(reference);
    });
    return result;
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return "image";
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return "video";
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return "audio";
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return "text";
    return null;
}
