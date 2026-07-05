export function explainModelError(error: unknown, fallback = "生成失败") {
    const text = error instanceof Error ? error.message : String(error || fallback);
    const lower = text.toLowerCase();
    if (!text.trim()) return fallback;
    if (text.includes("缺少 API Key") || lower.includes("api key") && (text.includes("缺少") || lower.includes("empty"))) return "缺少 API Key，请去 API 设置保存 Key 后重试。";
    if (text.includes("缺少接口地址") || lower.includes("base url")) return "Base URL 为空或不正确，请去 API 设置检查平台地址。";
    if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden") || text.includes("鉴权")) return "API Key 无效或没有模型权限，请去 API 设置更换 Key 或检查套餐。";
    if (lower.includes("404") || lower.includes("not found") || lower.includes("model_not_found") || text.includes("模型不存在")) return "模型不存在或能力不匹配，请去 API 设置拉取模型，或换成对应的生图/聊天/视频模型。";
    if (lower.includes("network") || lower.includes("failed to fetch") || text.includes("网络") || text.includes("无响应") || text.includes("不可达")) return "平台接口连接失败，请检查网络、代理或 Base URL 后重试。";
    if (lower.includes("timeout") || text.includes("超时")) return "平台响应超时，请稍后重试或换一个模型/平台。";
    if (lower.includes("429") || lower.includes("rate limit") || text.includes("限流") || text.includes("额度")) return "平台限流或额度不足，请稍后重试，或检查平台余额/套餐。";
    if (text.includes("不支持") || lower.includes("unsupported")) return "当前模型不支持这个任务，请换成对应能力的模型。";
    return text;
}
