import localforage from "localforage";

import type { Prompt, PromptListResponse } from "@/services/api/prompts";

const PROMPT_CACHE_KEY = "lumaforge:prompt-library-cache:v1";
const MAX_CACHED_PROMPTS = 200;

export type PromptCacheSnapshot = {
    version: 1;
    cachedAt: string;
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

export async function savePromptCache(response: PromptListResponse) {
    const snapshot: PromptCacheSnapshot = {
        version: 1,
        cachedAt: new Date().toISOString(),
        items: response.items.slice(0, MAX_CACHED_PROMPTS),
        tags: response.tags,
        categories: response.categories,
        total: Math.min(response.total, MAX_CACHED_PROMPTS),
    };
    await localforage.setItem(PROMPT_CACHE_KEY, snapshot);
    return snapshot;
}

export async function readPromptCache() {
    const value = await localforage.getItem<PromptCacheSnapshot>(PROMPT_CACHE_KEY);
    return value?.version === 1 && Array.isArray(value.items) ? value : null;
}
