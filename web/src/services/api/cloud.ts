export type CloudStatus = {
    logged_in: boolean;
    email: string;
    email_verified: boolean;
    display_name: string;
    avatar_url: string;
    base_url: string;
    custom_cloud?: boolean;
    cloud_config_missing?: boolean;
    auto_config_sync_paused?: boolean;
    updated_at?: number;
};

export type CloudMediaStatus = {
    ok: boolean;
    logged_in: boolean;
    local?: { count?: number; size_bytes?: number; synced?: number; pending?: number; failed?: number };
    remote?: { count?: number; size_bytes?: number };
    sync?: { running?: boolean; last_result?: Record<string, unknown> };
};

type JsonValue = Record<string, unknown>;

async function rawRequest<T = JsonValue>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? 10_000);
    try {
        const response = await fetch(url, {
            ...init,
            signal: init?.signal || controller.signal,
            headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = data?.detail || data?.message || data?.msg || "请求失败";
            throw new Error(String(message));
        }
        return data as T;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error("云端响应较慢，请稍后重试");
        }
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}

export function fetchCloudStatus(refresh = true) {
    return rawRequest<CloudStatus>(`/api/cloud/status${refresh ? "?refresh=1" : ""}`, { timeoutMs: 8_000 });
}

export function fetchCloudProfile() {
    return rawRequest<CloudStatus>("/api/cloud/profile", { timeoutMs: 8_000 });
}

export function saveCloudProfile(payload: { email?: string; display_name?: string; avatar_url?: string }) {
    return rawRequest<CloudStatus>("/api/cloud/profile", { method: "PUT", body: JSON.stringify(payload) });
}

export function uploadCloudAvatar(file: File) {
    const form = new FormData();
    form.append("file", file);
    return rawRequest<CloudStatus>("/api/cloud/profile/avatar", { method: "POST", body: form, timeoutMs: 20_000 });
}

export function changeCloudPassword(payload: { current_password: string; new_password: string }) {
    return rawRequest("/api/cloud/password", { method: "POST", body: JSON.stringify(payload) });
}

export function requestEmailVerify() {
    return rawRequest("/api/cloud/email/verify/request", { method: "POST", body: JSON.stringify({}) });
}

export function confirmEmailVerify(token: string) {
    return rawRequest("/api/cloud/email/verify/confirm", { method: "POST", body: JSON.stringify({ token }) });
}

export function uploadCloudConfig() {
    return rawRequest("/api/cloud/upload", { method: "POST", body: JSON.stringify({}), timeoutMs: 20_000 });
}

export function downloadCloudConfig() {
    return rawRequest("/api/cloud/download", { method: "POST", body: JSON.stringify({}), timeoutMs: 20_000 });
}

export function fetchCloudMediaStatus() {
    return rawRequest<CloudMediaStatus>("/api/cloud/media/status", { timeoutMs: 6_000 });
}

export function syncCloudMedia() {
    return rawRequest("/api/cloud/media/sync", { method: "POST", body: JSON.stringify({ missing_only: true, retry_failed: true, delete_remote_missing: false, limit: 5000 }), timeoutMs: 30_000 });
}

export function restoreCloudMedia() {
    return rawRequest("/api/cloud/media/restore", { method: "POST", body: JSON.stringify({ missing_only: true, include_deleted: false, limit: 5000 }), timeoutMs: 30_000 });
}
