"use client";

import { saveAs } from "file-saver";

export type PromptSaveResult = {
    ok: boolean;
    cancelled?: boolean;
    fallback?: boolean;
    path?: string;
    filename?: string;
    sizeBytes?: number;
    contentType?: string;
    message?: string;
};

export type DownloadHistoryItem = {
    id: string;
    filename: string;
    path?: string;
    fallback?: boolean;
    savedAt: string;
    url?: string;
};

type SaveAsResponse = {
    ok?: boolean;
    cancelled?: boolean;
    path?: string;
    filename?: string;
    size_bytes?: number;
    content_type?: string;
    detail?: string;
    message?: string;
    msg?: string;
};

type AppInfoResponse = {
    desktop?: boolean;
    mode?: string;
    update_capability?: {
        desktop?: boolean;
        mode?: string;
    };
};

export type DownloadRuntime = "desktop" | "browser" | "unknown";

let runtimeCache: { value: DownloadRuntime; expiresAt: number } | null = null;
let runtimeRequest: Promise<DownloadRuntime> | null = null;

export function canUseSystemSaveDialog(url: string) {
    const value = (url || "").trim().toLowerCase();
    if (!value) return false;
    return value.startsWith("/api/") || value.startsWith("/assets") || value.startsWith("/output") || value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://");
}

export async function saveFileWithPrompt(url: string, filename: string): Promise<PromptSaveResult> {
    const cleanUrl = (url || "").trim();
    const cleanFilename = sanitizeDownloadFilename(filename || "download");
    if (!cleanUrl) return { ok: false, message: "下载地址为空" };

    const runtime = await getDownloadRuntime();
    const desktopSaveRequired = requiresDesktopSave(runtime);

    if (cleanUrl.startsWith("blob:")) {
        if (!desktopSaveRequired) return browserDownload(cleanUrl, cleanFilename);
        try {
            const response = await fetch(cleanUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await saveBlobThroughLocalService(await response.blob(), cleanFilename);
            return result.ok || result.cancelled ? result : withDesktopSaveMessage(result, cleanFilename);
        } catch (error) {
            return desktopSaveFailure(cleanFilename, error);
        }
    }

    if (canUseSystemSaveDialog(cleanUrl)) {
        try {
            const result = await saveUrlThroughLocalService(cleanUrl, cleanFilename);
            return result.ok || result.cancelled || !desktopSaveRequired ? result : withDesktopSaveMessage(result, cleanFilename);
        } catch (error) {
            if (desktopSaveRequired) return desktopSaveFailure(cleanFilename, error);
            if (!canFallbackToBrowserDownload(error)) {
                const reason = explainDownloadError(error instanceof Error ? error.message : "");
                return { ok: false, filename: cleanFilename, message: reason };
            }
            const fallback = await browserDownload(cleanUrl, cleanFilename);
            const reason = explainDownloadError(error instanceof Error ? error.message : "");
            return {
                ...fallback,
                message: reason ? `本地保存不可用：${reason}。已改用浏览器下载，可在浏览器默认下载目录查看。` : "本地保存不可用，已改用浏览器下载。",
            };
        }
    }

    if (desktopSaveRequired) {
        try {
            const response = await fetch(cleanUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await saveBlobThroughLocalService(await response.blob(), cleanFilename);
            return result.ok || result.cancelled ? result : withDesktopSaveMessage(result, cleanFilename);
        } catch (error) {
            return desktopSaveFailure(cleanFilename, error);
        }
    }

    return browserDownload(cleanUrl, cleanFilename);
}

export async function saveBlobWithPrompt(blob: Blob, filename: string): Promise<PromptSaveResult> {
    const cleanFilename = sanitizeDownloadFilename(filename || "download");
    if (!blob.size) return { ok: false, message: "文件内容为空" };

    const runtime = await getDownloadRuntime();
    if (requiresDesktopSave(runtime)) {
        try {
            const result = await saveBlobThroughLocalService(blob, cleanFilename);
            return result.ok || result.cancelled ? result : withDesktopSaveMessage(result, cleanFilename);
        } catch (error) {
            return desktopSaveFailure(cleanFilename, error);
        }
    }

    const picker = (
        window as typeof window & {
            showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
        }
    ).showSaveFilePicker;
    if (picker) {
        try {
            const handle = await picker({ suggestedName: cleanFilename });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            recordDownloadHistory({ filename: cleanFilename, fallback: false });
            return { ok: true, filename: cleanFilename, sizeBytes: blob.size, contentType: blob.type };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return { ok: false, cancelled: true, filename: cleanFilename };
        }
    }
    try {
        saveAs(blob, cleanFilename);
        recordDownloadHistory({ filename: cleanFilename, fallback: true });
        return { ok: true, fallback: true, filename: cleanFilename, sizeBytes: blob.size, contentType: blob.type, message: "文件已进入浏览器默认下载目录" };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "浏览器下载失败" };
    }
}

export async function getDownloadRuntime(): Promise<DownloadRuntime> {
    if (typeof window === "undefined") return "browser";
    const now = Date.now();
    if (runtimeCache && runtimeCache.expiresAt > now) return runtimeCache.value;
    if (runtimeRequest) return runtimeRequest;

    runtimeRequest = detectDownloadRuntime()
        .then((value) => {
            runtimeCache = { value, expiresAt: Date.now() + (value === "unknown" ? 5_000 : 60_000) };
            return value;
        })
        .finally(() => {
            runtimeRequest = null;
        });
    return runtimeRequest;
}

async function detectDownloadRuntime(): Promise<DownloadRuntime> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_000);
    try {
        const response = await fetch("/api/app/info", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return fallbackRuntime();
        const payload = (await response.json().catch(() => ({}))) as AppInfoResponse;
        const desktop = payload.desktop ?? payload.update_capability?.desktop;
        const mode = String(payload.mode || payload.update_capability?.mode || "").toLowerCase();
        if (desktop === true) return "desktop";
        if (desktop === false) return "browser";
        if (mode.startsWith("desktop") || mode.includes("updater")) return "desktop";
        if (mode === "source" || mode.includes("source")) return "browser";
        return fallbackRuntime();
    } catch {
        return fallbackRuntime();
    } finally {
        window.clearTimeout(timeout);
    }
}

function fallbackRuntime(): DownloadRuntime {
    const hostname = window.location.hostname.toLowerCase();
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
    if (loopback && window.location.port !== "3001") return "unknown";
    return "browser";
}

function requiresDesktopSave(runtime: DownloadRuntime) {
    return runtime === "desktop" || runtime === "unknown";
}

async function saveUrlThroughLocalService(cleanUrl: string, cleanFilename: string): Promise<PromptSaveResult> {
    const saveUrl = cleanUrl.startsWith("/api/") && typeof window !== "undefined" ? new URL(cleanUrl, window.location.origin).toString() : cleanUrl;
    const response = await fetch("/api/app/save-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: saveUrl, filename: cleanFilename }),
    });
    const payload = (await response.json().catch(() => ({}))) as SaveAsResponse;
    return promptSaveResult(response, payload, cleanFilename, cleanUrl);
}

async function saveBlobThroughLocalService(blob: Blob, cleanFilename: string): Promise<PromptSaveResult> {
    const response = await fetch(`/api/app/save-bytes?filename=${encodeURIComponent(cleanFilename)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
    });
    const payload = (await response.json().catch(() => ({}))) as SaveAsResponse;
    return promptSaveResult(response, payload, cleanFilename);
}

function promptSaveResult(response: Response, payload: SaveAsResponse, cleanFilename: string, url?: string): PromptSaveResult {
    const resolvedFilename = payload.filename || cleanFilename;
    if (response.ok && payload.ok) {
        recordDownloadHistory({ filename: resolvedFilename, path: payload.path, fallback: false, url });
        return {
            ok: true,
            path: payload.path,
            filename: resolvedFilename,
            sizeBytes: payload.size_bytes,
            contentType: payload.content_type,
        };
    }
    if (response.ok && payload.cancelled) return { ok: false, cancelled: true, filename: resolvedFilename };
    return {
        ok: false,
        filename: resolvedFilename,
        message: explainDownloadError(payload.detail || payload.message || payload.msg || `保存失败 (${response.status})`),
    };
}

function withDesktopSaveMessage(result: PromptSaveResult, filename: string): PromptSaveResult {
    return {
        ...result,
        filename: result.filename || filename,
        message: desktopSaveMessage(result.message),
    };
}

function desktopSaveFailure(filename: string, error: unknown): PromptSaveResult {
    const reason = explainDownloadError(error instanceof Error ? error.message : "");
    return { ok: false, filename, message: desktopSaveMessage(reason) };
}

function desktopSaveMessage(reason?: string) {
    const detail = String(reason || "保存失败，请重试").replace(/[。；;]+$/, "");
    return `桌面本地保存失败：${detail}。请确认本地服务正在运行，并检查“设置 > 本地数据”中的输出目录。`;
}

export async function openSavedFileLocation(path: string) {
    const cleanPath = (path || "").trim();
    if (!cleanPath) return false;
    const response = await fetch("/api/app/open-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cleanPath }),
    });
    return response.ok;
}

async function browserDownload(url: string, filename: string): Promise<PromptSaveResult> {
    try {
        if (url.startsWith("blob:")) {
            const response = await fetch(url);
            const blob = await response.blob();
            saveAs(blob, filename);
        } else {
            saveAs(url, filename);
        }
        recordDownloadHistory({ filename, fallback: true, url });
        return { ok: true, fallback: true, filename, message: "已交给浏览器下载，可在浏览器默认下载目录查看。" };
    } catch (error) {
        return { ok: false, message: explainDownloadError(error instanceof Error ? error.message : "浏览器下载失败") };
    }
}

function canFallbackToBrowserDownload(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed") || message.includes("network request failed");
}

export function sanitizeDownloadFilename(value: string) {
    const name = String(value || "download")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    return name || "download";
}

export function getDownloadHistory() {
    if (typeof window === "undefined") return [] as DownloadHistoryItem[];
    try {
        const raw = window.localStorage.getItem(DOWNLOAD_HISTORY_KEY);
        const items = raw ? (JSON.parse(raw) as DownloadHistoryItem[]) : [];
        return Array.isArray(items) ? items.filter((item) => item && typeof item.filename === "string") : [];
    } catch {
        return [];
    }
}

export function clearDownloadHistory() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(DOWNLOAD_HISTORY_KEY);
    window.dispatchEvent(new CustomEvent(DOWNLOAD_HISTORY_EVENT));
}

export const DOWNLOAD_HISTORY_EVENT = "lumaforge:download-history";

const DOWNLOAD_HISTORY_KEY = "lumaforge:download-history";

function recordDownloadHistory(item: Omit<DownloadHistoryItem, "id" | "savedAt">) {
    if (typeof window === "undefined") return;
    const next: DownloadHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: item.filename || "download",
        path: item.path,
        fallback: item.fallback,
        url: item.url,
        savedAt: new Date().toISOString(),
    };
    const items = [next, ...getDownloadHistory()].slice(0, 30);
    window.localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(DOWNLOAD_HISTORY_EVENT));
}

function explainDownloadError(message: string) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    if (!text) return "保存失败，请重试。";
    if (lower.includes("too large") || lower.includes("512 mb") || text.includes("超过")) return "文件超过 512 MB，已取消保存；请换较小文件或手动导出。";
    if (text.includes("只允许保存") || lower.includes("not allowed") || lower.includes("blocked")) return "下载来源不安全或不是本机生成文件，已取消保存。";
    if (lower.includes("network") || lower.includes("failed to fetch") || text.includes("网络")) return "网络连接失败，请检查网络后重试。";
    if (lower.includes("permission") || lower.includes("access is denied") || text.includes("拒绝访问") || text.includes("权限")) return "目标目录没有写入权限，请换到用户目录或关闭占用中的文件后重试。";
    if (lower.includes("no space") || text.includes("磁盘") || text.includes("空间")) return "磁盘空间可能不足，请清理空间后重试。";
    if (lower.includes("being used") || text.includes("占用")) return "文件正在被其他程序占用，请关闭后重试。";
    if (lower.includes("404")) return "下载文件不存在，请重新生成或刷新素材后再试。";
    if (lower.includes("http 401") || lower.includes("http 403")) return "下载地址没有权限，请重新登录或检查云同步状态。";
    return text;
}
