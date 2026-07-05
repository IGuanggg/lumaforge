export type LumaProviderProtocol = "openai" | "apimart";
export type LumaProviderProtocolOverride = "auto" | "force-openai" | "force-apimart";

export type LumaProvider = {
    id: string;
    name: string;
    base_url: string;
    protocol: LumaProviderProtocol;
    protocol_override?: LumaProviderProtocolOverride;
    enabled: boolean;
    primary: boolean;
    image_models: string[];
    chat_models: string[];
    video_models: string[];
    ms_loras?: Record<string, unknown>[];
    ms_defaults_version?: number;
    api_key?: string;
    clear_key?: boolean;
    has_key?: boolean;
    key_preview?: string;
    key_env?: string;
};

export type ProviderModelsResponse = {
    ok?: boolean;
    fallback?: boolean;
    status?: number;
    status_code?: number;
    message?: string;
    protocol?: LumaProviderProtocol | "manual";
    confidence?: "high" | "medium" | "low" | "manual";
    checked_url?: string;
    endpoint?: string;
    reason?: string;
    all?: string[];
    total?: number;
    model_count?: number;
    image_models?: string[];
    chat_models?: string[];
    video_models?: string[];
    raw?: unknown;
};

export type ProviderKeyDiagnostics = {
    providers?: LumaProvider[];
    orphan_keys?: string[];
    removed?: string[];
    removed_count?: number;
    provider_count?: number;
    stored_key_count?: number;
    orphan_count?: number;
    local_key_file_exists?: boolean;
    cloud_config_available?: boolean;
    recoverable_from_cloud?: boolean;
    recoverable_key_count?: number;
    cloud_diagnostics_error?: string;
};

type WrappedResponse<T> = {
    code?: number;
    data?: T;
    msg?: string;
    detail?: string;
    message?: string;
};

type ProvidersPayload = {
    providers?: LumaProvider[];
};

export async function fetchProviders() {
    const payload = await rawRequest<ProvidersPayload | LumaProvider[]>("/api/providers");
    const providers = Array.isArray(payload) ? payload : payload.providers || [];
    return providers.map(normalizeProvider);
}

export async function saveProviders(providers: LumaProvider[]) {
    const payload = await rawRequest<ProvidersPayload | LumaProvider[]>("/api/providers", {
        method: "PUT",
        body: JSON.stringify(providers.map(cleanProviderForSave)),
    });
    const saved = Array.isArray(payload) ? payload : payload.providers || [];
    return saved.map(normalizeProvider);
}

export async function fetchProviderModels(providerId: string) {
    return rawRequest<ProviderModelsResponse>(`/api/providers/${encodeURIComponent(providerId)}/fetch-models`);
}

export async function fetchProviderModelsDraft(provider: LumaProvider) {
    return rawRequest<ProviderModelsResponse>("/api/providers/fetch-models", {
        method: "POST",
        body: JSON.stringify(cleanProviderForSave(provider)),
    });
}

export type ProviderConnectionPayload = {
    provider_id: string;
    base_url: string;
    api_key?: string;
    protocol_override?: LumaProviderProtocolOverride;
};

export async function testProviderConnection(payload: ProviderConnectionPayload) {
    return rawRequest<ProviderModelsResponse>("/api/providers/test-connection", {
        method: "POST",
        body: JSON.stringify({ ...payload, base_url: normalizeApiBaseUrl(payload.base_url) }),
    });
}

export async function probeProviderAsync(payload: ProviderConnectionPayload) {
    return rawRequest<ProviderModelsResponse>("/api/providers/probe-async", {
        method: "POST",
        body: JSON.stringify({ ...payload, base_url: normalizeApiBaseUrl(payload.base_url) }),
    });
}

export async function fetchKeyDiagnostics() {
    return rawRequest<ProviderKeyDiagnostics>("/api/providers/key-diagnostics", { cache: "no-store" });
}

export async function clearKeyDiagnostics(includeFilled = false) {
    return rawRequest<ProviderKeyDiagnostics>("/api/providers/key-diagnostics/clear", {
        method: "POST",
        body: JSON.stringify({ include_filled: includeFilled }),
    });
}

async function rawRequest<T>(url: string, init: RequestInit = {}) {
    let response: Response;
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    try {
        response = await fetch(url, {
            ...init,
            headers,
        });
    } catch {
        throw new Error("接口连接失败，请确认本地服务已启动，然后重试。");
    }

    const payload = (await response.json().catch(() => null)) as WrappedResponse<T> | T | null;
    if (!response.ok) {
        throw new Error(explainProviderError(readErrorMessage(payload) || `请求失败：HTTP ${response.status}`));
    }
    if (payload && typeof payload === "object" && "code" in payload) {
        const wrapped = payload as WrappedResponse<T>;
        if (wrapped.code !== undefined && wrapped.code !== 0) {
            throw new Error(explainProviderError(wrapped.msg || wrapped.message || "请求失败"));
        }
        return wrapped.data as T;
    }
    return payload as T;
}

function readErrorMessage(payload: unknown) {
    if (!payload || typeof payload !== "object") return "";
    const data = payload as WrappedResponse<unknown>;
    return data.detail || data.message || data.msg || "";
}

function normalizeProvider(provider: Partial<LumaProvider>): LumaProvider {
    return {
        id: String(provider.id || "").trim(),
        name: String(provider.name || provider.id || "").trim(),
        base_url: normalizeApiBaseUrl(provider.base_url),
        protocol: provider.protocol === "apimart" ? "apimart" : "openai",
        protocol_override: normalizeProtocolOverride(provider.protocol_override),
        enabled: provider.enabled !== false,
        primary: provider.primary === true,
        image_models: normalizeModels(provider.image_models),
        chat_models: normalizeModels(provider.chat_models),
        video_models: normalizeModels(provider.video_models),
        ms_loras: Array.isArray(provider.ms_loras) ? provider.ms_loras : [],
        ms_defaults_version: Number(provider.ms_defaults_version || 0),
        api_key: provider.api_key || "",
        clear_key: provider.clear_key === true,
        has_key: provider.has_key === true,
        key_preview: provider.key_preview || "",
        key_env: provider.key_env || "",
    };
}

function normalizeProtocolOverride(value?: string): LumaProviderProtocolOverride {
    if (value === "force-openai" || value === "force-apimart") return value;
    return "auto";
}

function cleanProviderForSave(provider: LumaProvider): LumaProvider {
    const cleaned = normalizeProvider(provider);
    return {
        ...cleaned,
        base_url: normalizeApiBaseUrl(cleaned.base_url),
        primary: provider.primary === true,
        api_key: provider.clear_key ? undefined : provider.api_key?.trim() || undefined,
        clear_key: provider.clear_key === true,
    };
}

export function normalizeApiBaseUrl(value?: string) {
    const raw = String(value || "").trim().replace(/\s+/g, "");
    if (!raw) return "";

    let normalized = raw.replace(/\/+$/, "");
    if (normalized.startsWith("//")) {
        normalized = `https:${normalized}`;
    } else if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(normalized)) {
        normalized = `${defaultApiBaseUrlProtocol(normalized)}://${normalized}`;
    }

    try {
        const url = new URL(normalized);
        if (url.protocol !== "http:" && url.protocol !== "https:") return normalized;
        url.pathname = url.pathname.replace(/\/+$/, "");
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return normalized;
    }
}

function defaultApiBaseUrlProtocol(value: string) {
    const host = value
        .split(/[/?#]/, 1)[0]
        .replace(/^\[/, "")
        .replace(/\].*$/, "")
        .replace(/:\d+$/, "")
        .toLowerCase();
    if (host === "localhost" || host === "::1" || host.startsWith("127.")) return "http";
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return "http";
    return "https";
}

export function normalizeModels(models?: string[]) {
    const seen = new Set<string>();
    return (models || [])
        .map((item) => String(item || "").trim())
        .filter((item) => {
            if (!item || seen.has(item)) return false;
            seen.add(item);
            return true;
        });
}

export function explainProviderError(message: string) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    if (!text) return "请求失败，请重试。";
    if (text.includes("缺少 API Key") || text.includes("API Key") && (text.includes("缺少") || lower.includes("empty"))) return "缺少 API Key，请在当前平台粘贴 Key 后保存或测试。";
    if (text.includes("缺少接口地址") || text.includes("Base URL") && (text.includes("缺少") || lower.includes("empty"))) return "Base URL 为空，请填写平台接口地址，通常以 /v1 结尾。";
    if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("401") || lower.includes("403") || text.includes("鉴权")) return "API Key 无效或没有权限，请去平台复制新的 Key，并确认套餐/模型权限。";
    if (lower.includes("not found") || lower.includes("404") || text.includes("模型不存在") || text.includes("model_not_found")) return "模型不存在或 Base URL 不匹配，请拉取模型列表，或检查地址是否需要 /v1。";
    if (lower.includes("network") || lower.includes("fetch") || text.includes("网络") || text.includes("无响应") || text.includes("不可达")) return "上游接口无响应，请检查网络、代理或平台 Base URL 后重试。";
    if (lower.includes("timeout") || text.includes("超时")) return "上游接口响应超时，请稍后重试或换一个平台节点。";
    if (lower.includes("rate limit") || lower.includes("429") || text.includes("限流")) return "平台限流或额度不足，请稍后重试，或检查平台余额/套餐。";
    if (text.includes("模型列表接口不可用")) return `${text} 可以先保存手动模型，之后再重试拉取。`;
    return text;
}
