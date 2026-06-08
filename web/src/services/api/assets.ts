import { apiGet, compactApiParams } from "@/services/api/request";

export type AssetLibraryItem = {
    id: string;
    title: string;
    type: "text" | "image" | "video";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    createdAt: string;
    updatedAt: string;
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

export async function uploadAssetDataUrl(dataUrl: string, filename = "canvas-image.png") {
    const blob = await (await fetch(dataUrl)).blob();
    return uploadAssetFile(new File([blob], filename, { type: blob.type || "image/png" }));
}

function normalizeAssetLibraryResponse(data: Record<string, unknown>): AssetLibraryResponse {
    const items = Array.isArray(data.items) ? data.items.map(normalizeAssetLibraryItem).filter(Boolean) : [];
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
    const url = firstString(item.url, item.local_url, item.source_url);
    const coverUrl = firstString(item.coverUrl, item.cover_url, item.thumb_url, item.local_url, item.url);
    const typeValue = firstString(item.type, item.kind).toLowerCase();
    const type: AssetLibraryItem["type"] = typeValue === "video" ? "video" : typeValue === "text" ? "text" : "image";
    return {
        id: firstString(item.id) || `asset-${Math.random().toString(36).slice(2)}`,
        title: firstString(item.title, item.name) || "未命名素材",
        type,
        coverUrl,
        tags: normalizeTags(item.tags),
        category: firstString(item.category, item.category_id) || "inbox",
        description: firstString(item.description, item.prompt, item.model),
        content: firstString(item.content, item.prompt),
        url,
        createdAt: normalizeTime(item.createdAt ?? item.created_at),
        updatedAt: normalizeTime(item.updatedAt ?? item.updated_at),
    };
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
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
