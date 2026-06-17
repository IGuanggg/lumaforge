"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings, ProviderModelOption } from "@/services/api/admin";

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    providerModels: ProviderModelOption[];
    imageProviderModels: ProviderModelOption[];
    videoProviderModels: ProviderModelOption[];
    textProviderModels: ProviderModelOption[];
    audioProviderModels: ProviderModelOption[];
    quality: string;
    size: string;
    count: string;
    canvasImageCount: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";

export const defaultConfig: AiConfig = {
    channelMode: "remote",
    baseUrl: "",
    apiKey: "",
    model: "gpt-5.5",
    imageModel: "gpt-image-2-vip",
    videoModel: "grok-imagine-video",
    textModel: "gpt-5.5",
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    providerModels: [],
    imageProviderModels: [],
    videoProviderModels: [],
    textProviderModels: [],
    audioProviderModels: [],
    quality: "1k",
    size: "16:9",
    count: "1",
    canvasImageCount: "3",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null) {
    const channelMode: AiConfig["channelMode"] = "remote";
    if (!modelChannel) return { ...config, channelMode };
    const providerModels = normalizeProviderModelOptions(modelChannel.providerModels);
    const imageProviderModels = filterProviderModelsByCapability(providerModels, "image");
    const videoProviderModels = filterProviderModelsByCapability(providerModels, "video");
    const textProviderModels = filterProviderModelsByCapability(providerModels, "text");
    const audioProviderModels = filterProviderModelsByCapability(providerModels, "audio");
    const models = providerModels.length ? providerModels.map((item) => item.value) : modelChannel.availableModels;
    const textModels = providerModels.length ? textProviderModels.map((item) => item.value) : filterModelsByCapability(models, "text");
    const imageModels = providerModels.length ? imageProviderModels.map((item) => item.value) : filterModelsByCapability(models, "image");
    const videoModels = providerModels.length ? videoProviderModels.map((item) => item.value) : filterModelsByCapability(models, "video");
    const audioModels = providerModels.length ? audioProviderModels.map((item) => item.value) : filterModelsByCapability(models, "audio");
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredProviderModel(textProviderModels) || preferredModel(textModels, isTextModelName);
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredProviderModel(imageProviderModels, "gpt-image-2-vip") || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredProviderModel(videoProviderModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredProviderModel(audioProviderModels) || preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        providerModels,
        imageProviderModels,
        videoProviderModels,
        textProviderModels,
        audioProviderModels,
        model: resolveSelectedModel(config.model, textModels, providerModels) || fallbackModel,
        imageModel: resolveSelectedModel(config.imageModel, imageModels, providerModels) || fallbackImageModel,
        videoModel: resolveSelectedModel(config.videoModel, videoModels, providerModels) || fallbackVideoModel,
        textModel: resolveSelectedModel(config.textModel, textModels, providerModels) || fallbackTextModel || fallbackModel,
        audioModel: resolveSelectedModel(config.audioModel, audioModels, providerModels) || fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
    };
}

function reconcileConfigWithPublicSettings(config: AiConfig, publicSettings: AdminPublicSettings) {
    const effective = resolveEffectiveConfig(config, publicSettings.modelChannel);
    return {
        ...config,
        channelMode: effective.channelMode,
        model: effective.model || config.model,
        imageModel: effective.imageModel || config.imageModel,
        videoModel: effective.videoModel || config.videoModel,
        textModel: effective.textModel || config.textModel,
        audioModel: effective.audioModel || config.audioModel,
        systemPrompt: effective.systemPrompt,
        models: effective.models,
        imageModels: effective.imageModels,
        videoModels: effective.videoModels,
        textModels: effective.textModels,
        audioModels: effective.audioModels,
        providerModels: effective.providerModels,
        imageProviderModels: effective.imageProviderModels,
        videoProviderModels: effective.videoProviderModels,
        textProviderModels: effective.textProviderModels,
        audioProviderModels: effective.audioProviderModels,
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function normalizeProviderModelOptions(options?: ProviderModelOption[]) {
    const seen = new Set<string>();
    return (options || []).filter((item) => {
        if (!item?.value || !item.model || seen.has(item.value) || item.enabled === false) return false;
        seen.add(item.value);
        return true;
    });
}

function filterProviderModelsByCapability(options: ProviderModelOption[], capability: ModelCapability) {
    return options.filter((item) => item.capability === capability || modelMatchesCapability(item.model, capability));
}

function preferredProviderModel(options: ProviderModelOption[], preferredRawModel?: string) {
    if (preferredRawModel) {
        const preferred = options.find((item) => rawModelName(item.value) === preferredRawModel || item.model === preferredRawModel);
        if (preferred) return preferred.value;
    }
    return options[0]?.value || "";
}

function resolveSelectedModel(current: string, models: string[], providerModels: ProviderModelOption[]) {
    if (models.includes(current)) return current;
    const rawCurrent = rawModelName(current);
    const providerMatch = providerModels.find((item) => models.includes(item.value) && item.model === rawCurrent);
    return providerMatch?.value || "";
}

export function rawModelName(model: string) {
    const value = String(model || "").trim();
    const index = value.indexOf("::");
    if (index < 0) return value;
    return value.slice(index + 2).trim() || value;
}

export function modelDisplayLabel(config: Pick<AiConfig, "providerModels">, model: string) {
    const value = String(model || "").trim();
    if (!value) return "";
    const raw = rawModelName(value);
    const option = config.providerModels.find((item) => item.value === value) || config.providerModels.find((item) => item.model === raw);
    return option?.label || value;
}

function isVideoModelName(model: string) {
    const value = rawModelName(model).toLowerCase();
    return value.includes("seedance") || value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("kling") || value.includes("wan") || value.includes("hailuo");
}

function isImageModelName(model: string) {
    const value = rawModelName(model).toLowerCase();
    return !isVideoModelName(model) && !isAudioModelName(model) && (value.includes("seedream") || value.includes("gpt-image") || value.includes("image") || value.includes("banana") || value.includes("dall-e") || value.includes("dalle") || value.includes("imagen") || value.includes("flux") || value.includes("sdxl") || value.includes("stable-diffusion") || value.includes("midjourney"));
}

function isAudioModelName(model: string) {
    const value = rawModelName(model).toLowerCase();
    return value.includes("audio") || value.includes("tts") || value.includes("speech") || value.includes("voice") || value.includes("music") || value.includes("sound");
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability) {
    if (!capability) return true;
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability) {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability)) : models;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

export function selectableProviderModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.providerModels;
    return config[providerModelListKey(capability)];
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

function providerModelListKey(capability: ModelCapability) {
    return `${capability}ProviderModels` as "imageProviderModels" | "videoProviderModels" | "textProviderModels" | "audioProviderModels";
}

function isAiConfigReady(config: AiConfig, model: string) {
    return Boolean(model.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    const publicSettings = await apiGet<AdminPublicSettings>("/api/settings");
                    set((state) => ({
                        publicSettings,
                        config: reconcileConfigWithPublicSettings(state.config, publicSettings),
                    }));
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedConfig = ((persisted as Partial<ConfigStore>).config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                return {
                    ...current,
                    config: {
                        ...config,
                        channelMode: "remote",
                        imageModel: config.imageModel || config.model,
                        videoModel: config.videoModel || "grok-imagine-video",
                        textModel: config.textModel || config.model,
                        audioModel: config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                        imageModels: Array.isArray(persistedConfig.imageModels) ? normalizeModelList(config.imageModels) : filterModelsByCapability(config.models, "image"),
                        videoModels: Array.isArray(persistedConfig.videoModels) ? normalizeModelList(config.videoModels) : filterModelsByCapability(config.models, "video"),
                        textModels: Array.isArray(persistedConfig.textModels) ? normalizeModelList(config.textModels) : filterModelsByCapability(config.models, "text"),
                        audioModels: Array.isArray(persistedConfig.audioModels) ? normalizeModelList(config.audioModels) : filterModelsByCapability(config.models, "audio"),
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    return useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
