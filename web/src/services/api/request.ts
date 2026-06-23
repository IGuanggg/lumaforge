import axios from "axios";
import { ApiError } from "@/lib/api-error";

export type ApiParams = Record<string, string | string[] | number | number[] | undefined>;

type ApiResponse<T> = {
    code: number;
    data: T;
    msg: string;
    errorCode?: string;
    action?: string;
};

export function compactApiParams(params: ApiParams) {
    return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value !== undefined && (!Array.isArray(value) || value.length > 0))) as ApiParams;
}

export function serializeApiParams(params?: ApiParams) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((item) => queryParams.append(key, String(item)));
        else queryParams.set(key, String(value));
    }
    return queryParams;
}

export async function apiGet<T>(url: string, params?: ApiParams, token?: string) {
    return apiRequest<T>({
        url,
        method: "GET",
        params: params || undefined,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
}

export async function apiPost<T>(url: string, body?: unknown, token?: string) {
    return apiRequest<T>({
        url,
        method: "POST",
        data: body ?? {},
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}

export async function apiDelete<T>(url: string, token?: string) {
    return apiRequest<T>({
        url,
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
}

async function apiRequest<T>(config: { url: string; method: "GET" | "POST" | "DELETE"; params?: ApiParams; data?: unknown; headers?: Record<string, string> }) {
    let response;
    try {
        response = await axios.request<ApiResponse<T>>({
            url: config.url,
            method: config.method,
            params: config.params,
            paramsSerializer: { serialize: (params) => serializeApiParams(params as ApiParams).toString() },
            data: config.data,
            headers: config.headers,
            validateStatus: () => true,
        });
    } catch (error) {
        if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
            throw new ApiError("本地服务响应超时，请稍后重试", { code: "LOCAL_SERVICE_TIMEOUT", action: "重试" });
        }
        throw new ApiError("无法连接 LumaForge 本地服务，请确认应用已启动后重试", { code: "LOCAL_SERVICE_UNAVAILABLE", action: "检查本地服务" });
    }

    const result = response.data;
    if (!result || typeof result !== "object") {
        throw new ApiError(response.status === 404 ? "当前版本不支持此操作，请更新 LumaForge 后重试" : "本地服务返回了无法识别的数据，请重试", { status: response.status });
    }

    const payload = result as ApiResponse<T>;
    if (response.status < 200 || response.status >= 300 || payload.code !== 0) {
        throw new ApiError(payload.msg || "操作失败，请稍后重试", { code: payload.errorCode, action: payload.action, status: response.status });
    }

    return payload.data;
}
