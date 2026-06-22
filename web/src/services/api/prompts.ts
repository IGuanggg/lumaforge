import { apiGet, compactApiParams } from "@/services/api/request";
import { readPromptCache, savePromptCache } from "@/services/prompt-cache";

export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
    source?: "remote" | "cache";
    cachedAt?: string;
};

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page, pageSize }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    return apiGet<PromptListResponse>(
        "/api/prompts",
        compactApiParams({
            ...(keyword ? { keyword } : {}),
            ...(tag.length ? { tag } : {}),
            ...(category !== ALL_PROMPTS_OPTION ? { category } : {}),
            ...(page ? { page } : {}),
            ...(pageSize ? { pageSize } : {}),
        }),
    );
}

export async function fetchPromptsWithCache({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    try {
        const response = await fetchPrompts({ keyword, tag, category, page, pageSize });
        if (!keyword && !tag.length && category === ALL_PROMPTS_OPTION && page === 1) {
            void fetchPrompts({ page: 1, pageSize: 200 }).then(savePromptCache).catch(() => undefined);
        }
        return { ...response, source: "remote" as const };
    } catch (error) {
        const cache = await readPromptCache();
        if (!cache) throw error;
        const query = keyword.trim().toLowerCase();
        const matches = cache.items.filter((item) => {
            if (category !== ALL_PROMPTS_OPTION && item.category !== category) return false;
            if (tag.length && !tag.every((value) => item.tags.includes(value))) return false;
            if (!query) return true;
            return [item.title, item.prompt, item.preview, item.category, ...item.tags].join(" ").toLowerCase().includes(query);
        });
        const start = (page - 1) * pageSize;
        return {
            items: matches.slice(start, start + pageSize),
            tags: cache.tags,
            categories: cache.categories,
            total: matches.length,
            source: "cache" as const,
            cachedAt: cache.cachedAt,
        };
    }
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
