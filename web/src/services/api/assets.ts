import { apiGet, compactApiParams } from "@/services/api/request";

export type AssetLibraryItem = {
    id: string;
    title: string;
    type: "text" | "image" | "video" | "audio";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    createdAt: string;
    updatedAt: string;
    sourceType?: string;
    prompt?: string;
    model?: string;
    canvasId?: string;
    nodeId?: string;
    storageKey?: string;
};

export type AssetLibraryResponse = {
    items: AssetLibraryItem[];
    tags: string[];
    total: number;
};

export type AssetLibraryQuery = {
    keyword?: string;
    type?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export async function fetchAssetLibrary(query: AssetLibraryQuery = {}) {
    const data = await apiGet<Record<string, unknown>>("/api/assets", compactApiParams(query));
    return normalizeAssetLibraryResponse(data);
}

export async function uploadAssetFile(file: File) {
    const form = new FormData();
    form.append("files", file);
    const response = await fetch("/api/assets/upload", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.code) {
        throw new Error(data?.detail || data?.msg || data?.message || "素材上传失败");
    }
    return data;
}

export type AssetUploadMetadata = {
    sourceType?: string;
    prompt?: string;
    model?: string;
    canvasId?: string;
    nodeId?: string;
    storageKey?: string;
    tags?: string[];
};

export async function uploadAssetFileWithMetadata(file: File, metadata: AssetUploadMetadata = {}) {
    const form = new FormData();
    form.append("files", file);
    if (metadata.sourceType) form.append("source_type", metadata.sourceType);
    if (metadata.prompt) form.append("prompt", metadata.prompt);
    if (metadata.model) form.append("model", metadata.model);
    if (metadata.canvasId) form.append("canvas_id", metadata.canvasId);
    if (metadata.nodeId) form.append("node_id", metadata.nodeId);
    if (metadata.storageKey) form.append("storage_key", metadata.storageKey);
    if (metadata.tags?.length) form.append("tags", metadata.tags.join(","));
    const response = await fetch("/api/assets/upload", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.code) {
        throw new Error(data?.detail || data?.msg || data?.message || "素材上传失败");
    }
    return data;
}

export async function uploadAssetDataUrl(dataUrl: string, filename = "canvas-image.png", metadata: AssetUploadMetadata = {}) {
    const blob = await (await fetch(dataUrl)).blob();
    return uploadAssetFileWithMetadata(new File([blob], filename, { type: blob.type || "image/png" }), metadata);
}

function normalizeAssetLibraryResponse(data: Record<string, unknown>): AssetLibraryResponse {
    const rawItems = firstArray(data.items, data.assets, data.data);
    const items = rawItems.map(normalizeAssetLibraryItem).filter(Boolean);
    const tagSet = new Set<string>();
    for (const item of items) item.tags.forEach((tag) => tagSet.add(tag));
    const tags = Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : Array.from(tagSet);
    return {
        items,
        tags,
        total: Number(data.total ?? items.length) || items.length,
    };
}

function normalizeAssetLibraryItem(raw: unknown): AssetLibraryItem {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const url = firstString(item.url, item.local_url, item.source_url, item.cloud_url);
    const coverUrl = firstString(item.coverUrl, item.cover_url, item.thumb_url, item.local_url, item.url, item.cloud_url);
    const typeValue = firstString(item.type, item.kind).toLowerCase();
    const type: AssetLibraryItem["type"] = typeValue === "video" ? "video" : typeValue === "audio" ? "audio" : typeValue === "text" ? "text" : "image";
    return {
        id: firstString(item.id, item.asset_id, item.sha256) || `asset-${Math.random().toString(36).slice(2)}`,
        title: firstString(item.title, item.name) || "未命名素材",
        type,
        coverUrl,
        tags: normalizeTags(item.tags),
        category: firstString(item.category, item.category_id, item.source_type) || "素材库",
        description: firstString(item.description, item.prompt, item.model),
        content: firstString(item.content, item.prompt),
        url,
        createdAt: normalizeTime(item.createdAt ?? item.created_at),
        updatedAt: normalizeTime(item.updatedAt ?? item.updated_at),
        sourceType: firstString(item.sourceType, item.source_type),
        prompt: firstString(item.prompt),
        model: firstString(item.model),
        canvasId: firstString(item.canvasId, item.canvas_id),
        nodeId: firstString(item.nodeId, item.node_id),
        storageKey: firstString(item.storageKey, item.storage_key),
    };
}

function firstArray(...values: unknown[]) {
    for (const value of values) {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items)) return (value as Record<string, unknown>).items as unknown[];
    }
    return [];
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
}

function normalizeTags(value: unknown) {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        } catch {
            return value.split(",").map((item) => item.trim()).filter(Boolean);
        }
    }
    return [];
}

function normalizeTime(value: unknown) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value > 100000000000 ? value : value * 1000).toISOString();
    return new Date().toISOString();
}
