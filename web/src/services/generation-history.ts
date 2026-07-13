"use client";

import localforage from "localforage";

import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";

export type CanvasGenerationHistoryItem = {
    id: string;
    kind: "image" | "video";
    createdAt: number;
    title: string;
    prompt: string;
    model: string;
    status: "success" | "failed";
    error?: string;
    url?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    mimeType?: string;
    config: Record<string, unknown>;
};

type StoredImage = {
    id?: string;
    dataUrl?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    mimeType?: string;
};

type StoredImageLog = {
    id?: string;
    createdAt?: number;
    title?: string;
    prompt?: string;
    model?: string;
    status?: string;
    images?: StoredImage[];
    config?: Record<string, unknown>;
};

type StoredVideo = {
    id?: string;
    url?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    durationMs?: number;
    mimeType?: string;
};

type StoredVideoLog = {
    id?: string;
    createdAt?: number;
    title?: string;
    prompt?: string;
    model?: string;
    status?: string;
    error?: string;
    video?: StoredVideo;
    config?: Record<string, unknown>;
};

const imageLogStore = localforage.createInstance({ name: "lumaforge", storeName: "image_generation_logs" });
const legacyImageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "lumaforge", storeName: "video_generation_logs" });
const legacyVideoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
type LocalForageInstance = ReturnType<typeof localforage.createInstance>;

export async function loadCanvasGenerationHistory(): Promise<CanvasGenerationHistoryItem[]> {
    if (typeof window === "undefined") return [];

    await Promise.all([migrateLegacyStore(imageLogStore, legacyImageLogStore), migrateLegacyStore(videoLogStore, legacyVideoLogStore)]);

    const [imageLogs, videoLogs] = await Promise.all([readStoreValues<StoredImageLog>(imageLogStore), readStoreValues<StoredVideoLog>(videoLogStore)]);
    const [images, videos] = await Promise.all([Promise.all(imageLogs.flatMap((log) => normalizeImageLog(log))), Promise.all(videoLogs.map(normalizeVideoLog))]);

    return [...images.flat(), ...videos].filter((item): item is CanvasGenerationHistoryItem => Boolean(item)).sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeImageLog(log: StoredImageLog) {
    const createdAt = log.createdAt || Date.now();
    const title = log.title || log.prompt?.slice(0, 32) || log.model || "图片生成记录";
    const status = isFailedStatus(log.status) ? "failed" : "success";
    const outputs = log.images || [];

    if (!outputs.length) {
        return [
            Promise.resolve<CanvasGenerationHistoryItem>({
                id: `image:${log.id || createdAt}`,
                kind: "image",
                createdAt,
                title,
                prompt: log.prompt || "",
                model: log.model || stringValue(log.config?.imageModel) || stringValue(log.config?.model),
                status,
                config: log.config || {},
            }),
        ];
    }

    return outputs.map(
        async (image, index): Promise<CanvasGenerationHistoryItem> => ({
            id: `image:${log.id || createdAt}:${image.id || index}`,
            kind: "image",
            createdAt,
            title: outputs.length > 1 ? `${title} ${index + 1}` : title,
            prompt: log.prompt || "",
            model: log.model || stringValue(log.config?.imageModel) || stringValue(log.config?.model),
            status,
            url: await resolveImageUrl(image.storageKey, image.dataUrl || ""),
            storageKey: image.storageKey,
            width: image.width,
            height: image.height,
            durationMs: image.durationMs,
            mimeType: image.mimeType || "image/png",
            config: log.config || {},
        }),
    );
}

async function normalizeVideoLog(log: StoredVideoLog): Promise<CanvasGenerationHistoryItem> {
    const createdAt = log.createdAt || Date.now();
    const video = log.video;
    return {
        id: `video:${log.id || createdAt}:${video?.id || "output"}`,
        kind: "video",
        createdAt,
        title: log.title || log.prompt?.slice(0, 32) || log.model || "视频生成记录",
        prompt: log.prompt || "",
        model: log.model || stringValue(log.config?.videoModel) || stringValue(log.config?.model),
        status: isFailedStatus(log.status) || !video ? "failed" : "success",
        error: log.error,
        url: video ? await resolveMediaUrl(video.storageKey, video.url || "") : undefined,
        storageKey: video?.storageKey,
        width: video?.width,
        height: video?.height,
        durationMs: video?.durationMs,
        mimeType: video?.mimeType || "video/mp4",
        config: log.config || {},
    };
}

async function migrateLegacyStore(current: LocalForageInstance, legacy: LocalForageInstance) {
    const entries: Array<[string, unknown]> = [];
    await legacy.iterate((value, key) => {
        entries.push([key, value]);
    });
    await Promise.all(
        entries.map(async ([key, value]) => {
            if (!(await current.getItem(key))) await current.setItem(key, value);
            await legacy.removeItem(key);
        }),
    );
}

async function readStoreValues<T>(store: LocalForageInstance) {
    const values: T[] = [];
    await store.iterate<T, void>((value) => {
        values.push(value);
    });
    return values;
}

function isFailedStatus(status?: string) {
    return status === "失败" || status === "failed" || status === "error";
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}
