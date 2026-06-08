export type LumaProviderProtocol = "openai" | "apimart";

export type LumaProvider = {
    id: string;
    name: string;
    base_url: string;
    protocol: LumaProviderProtocol;
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
    status?: number;
    status_code?: number;
    message?: string;
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

export async function testProviderConnection(payload: { provider_id: string; base_url: string; api_key?: string }) {
    return rawRequest<ProviderModelsResponse>("/api/providers/test-connection", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function probeProviderAsync(payload: { provider_id: string; base_url: string; api_key?: string }) {
    return rawRequest<ProviderModelsResponse>("/api/providers/probe-async", {
        method: "POST",
        body: JSON.stringify(payload),
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
        throw new Error("接口连接失败，请确认后端服务已启动");
    }

    const payload = (await response.json().catch(() => null)) as WrappedResponse<T> | T | null;
    if (!response.ok) {
        throw new Error(readErrorMessage(payload) || `请求失败：HTTP ${response.status}`);
    }
    if (payload && typeof payload === "object" && "code" in payload) {
        const wrapped = payload as WrappedResponse<T>;
        if (wrapped.code !== undefined && wrapped.code !== 0) {
            throw new Error(wrapped.msg || wrapped.message || "请求失败");
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
        base_url: String(provider.base_url || "").trim(),
        protocol: provider.protocol === "apimart" ? "apimart" : "openai",
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

function cleanProviderForSave(provider: LumaProvider): LumaProvider {
    const cleaned = normalizeProvider(provider);
    return {
        ...cleaned,
        primary: provider.primary === true,
        api_key: provider.clear_key ? undefined : provider.api_key?.trim() || undefined,
        clear_key: provider.clear_key === true,
    };
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
