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
};

export function canUseSystemSaveDialog(url: string) {
    const value = (url || "").trim().toLowerCase();
    if (!value) return false;
    return value.startsWith("/api/") || value.startsWith("/assets") || value.startsWith("/output") || value.startsWith("data:") || value.startsWith("http://") || value.startsWith("https://");
}

export async function saveFileWithPrompt(url: string, filename: string): Promise<PromptSaveResult> {
    const cleanUrl = (url || "").trim();
    const cleanFilename = sanitizeDownloadFilename(filename || "download");
    if (!cleanUrl) return { ok: false, message: "下载地址为空" };

    if (canUseSystemSaveDialog(cleanUrl)) {
        try {
            const saveUrl = cleanUrl.startsWith("/api/") && typeof window !== "undefined" ? new URL(cleanUrl, window.location.origin).toString() : cleanUrl;
            const response = await fetch("/api/app/save-as", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: saveUrl, filename: cleanFilename }),
            });
            const payload = (await response.json().catch(() => ({}))) as SaveAsResponse;
            if (response.ok && payload.ok) {
                recordDownloadHistory({
                    filename: payload.filename || cleanFilename,
                    path: payload.path,
                    fallback: false,
                    url: cleanUrl,
                });
                return {
                    ok: true,
                    path: payload.path,
                    filename: payload.filename || cleanFilename,
                    sizeBytes: payload.size_bytes,
                    contentType: payload.content_type,
                };
            }
            if (response.ok && payload.cancelled) return { ok: false, cancelled: true, filename: payload.filename || cleanFilename };
            return {
                ok: false,
                filename: payload.filename || cleanFilename,
                message: explainDownloadError(payload.detail || payload.message || `保存失败 (${response.status})`),
            };
        } catch (error) {
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

    return browserDownload(cleanUrl, cleanFilename);
}

export async function saveBlobWithPrompt(blob: Blob, filename: string): Promise<PromptSaveResult> {
    const cleanFilename = sanitizeDownloadFilename(filename || "download");
    if (!blob.size) return { ok: false, message: "文件内容为空" };
    const picker = (window as typeof window & {
        showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
    }).showSaveFilePicker;
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
