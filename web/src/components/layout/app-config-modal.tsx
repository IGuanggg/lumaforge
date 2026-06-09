"use client";

import { App, Button, Form, Input, Modal, Segmented, Select } from "antd";
import { useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { fetchProviders, type LumaProvider } from "@/services/api/providers";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { useConfigStore, useEffectiveConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type ChannelView = "cloud" | "local-api";

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

export function AppConfigModal() {
    const { message } = App.useApp();
    const [providers, setProviders] = useState<LumaProvider[]>([]);
    const [loadingProviders, setLoadingProviders] = useState(false);
    const [channelView, setChannelView] = useState<ChannelView>("local-api");
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const effectiveConfig = useEffectiveConfig();
    const modelChannel = publicSettings?.modelChannel;
    const allowCustomChannel = modelChannel?.allowCustomChannel === true;
    const modelConfig = effectiveConfig;
    const enabledProviders = providers.filter((provider) => provider.enabled);
    const primaryProvider = providers.find((provider) => provider.primary) || enabledProviders[0];
    const providerSummary = useMemo(() => summarizeProviders(providers), [providers]);

    useEffect(() => {
        if (!isConfigOpen) return;
        setChannelView("local-api");
        if (config.channelMode !== "remote") updateConfig("channelMode", "remote");
        setLoadingProviders(true);
        void fetchProviders()
            .then(setProviders)
            .catch((error) => {
                message.warning(error instanceof Error ? error.message : "API 平台读取失败");
            })
            .finally(() => setLoadingProviders(false));
    }, [config.channelMode, isConfigOpen, message, updateConfig]);

    if (!isConfigOpen) return null;

    const finishConfig = () => {
        setConfigDialogOpen(false);
        if (channelView === "cloud") {
            message.info("内置云端渠道暂未配置，已保留当前本地配置");
            clearPromptContinue();
            return;
        }
        if (!modelConfig.imageModel.trim() || !modelConfig.videoModel.trim() || !modelConfig.textModel.trim()) return;
        if (!allowCustomChannel && config.channelMode !== "remote") updateConfig("channelMode", "remote");
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannelView = (value: ChannelView) => {
        setChannelView(value);
        if (value === "local-api") updateConfig("channelMode", "remote");
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">模型、渠道和画布默认行为</div>
                </div>
            }
            open={isConfigOpen}
            width={960}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 18 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            <div className="pt-1">
                <Form layout="vertical" requiredMark={false}>
                    {allowCustomChannel ? (
                        <Form.Item label="渠道模式" className="mb-5">
                            <Segmented
                                block
                                size="middle"
                                value={channelView}
                                onChange={(value) => updateChannelView(value as ChannelView)}
                                options={[
                                    { label: "云端", value: "cloud" },
                                    { label: "本地 API 平台", value: "local-api" },
                                ]}
                            />
                        </Form.Item>
                    ) : null}
                    {channelView === "cloud" ? (
                        <section className="mb-5 rounded-lg border border-dashed border-stone-300 bg-transparent p-4 dark:border-stone-700">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">内置云端渠道</div>
                                    <div className="mt-1 text-xs text-stone-500">这是 LumaForge 自带的云端渠道，和本地 API 平台分开管理。</div>
                                </div>
                                <span className="rounded bg-stone-500/15 px-2 py-1 text-xs font-semibold text-stone-500">未配置</span>
                            </div>
                            <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-6 text-stone-500 dark:border-stone-800 dark:bg-stone-950">
                                云端渠道现在不显示任何本地平台，也不会修改你已经保存的本地 API 设置。等内置云端配置完成后，这里只展示云端自己的状态和模型。
                            </div>
                        </section>
                    ) : null}
                    {channelView === "local-api" ? (
                        <section className="mb-5 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/60">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">本地 API 平台</div>
                                    <div className="mt-1 text-xs text-stone-500">
                                        这些是你在 API 设置里自己添加的平台。已添加 {providers.length} 个，启用 {enabledProviders.length} 个，已保存 Key {providerSummary.keyCount} 个。默认请求按“平台 / 模型”精确路由。
                                    </div>
                                </div>
                                <Button size="small" href="/api-settings">
                                    打开 API 设置
                                </Button>
                            </div>
                            {loadingProviders ? (
                                <div className="mt-3 rounded-md border border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-800">正在读取 API 平台...</div>
                            ) : providers.length ? (
                                <div className="mt-4 grid gap-2 md:grid-cols-2">
                                    {providers.map((provider) => (
                                        <ProviderSummaryCard key={provider.id} provider={provider} />
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-3 rounded-md border border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-800">还没有 API 平台，请先到 API 设置添加。</div>
                            )}
                            {primaryProvider ? (
                                <div className="mt-3 text-xs text-stone-500">
                                    当前主平台：<span className="font-semibold text-stone-800 dark:text-stone-200">{primaryProvider.name}</span>
                                    {primaryProvider.base_url ? <span className="ml-2 break-all">{primaryProvider.base_url}</span> : null}
                                </div>
                            ) : null}
                        </section>
                    ) : null}
                    {channelView === "local-api" ? (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">
                            <div className="font-medium text-stone-900 dark:text-stone-100">当前使用：本地 API 平台</div>
                            <div className="mt-1">由本地 LumaForge 后端按你已启用的平台转发请求，当前可用 {modelChannel?.availableModels.length || 0} 个模型。</div>
                        </div>
                    ) : null}
                    {channelView !== "cloud" ? (
                        <>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {modelGroups.map((group) => (
                                    <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-4">
                                        <ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                    </Form.Item>
                                ))}
                            </div>
                            <div className="grid gap-4 md:grid-cols-4">
                                <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={15}
                                        value={config.canvasImageCount}
                                        onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                        onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                    />
                                </Form.Item>
                                <Form.Item label="默认音频声音" className="mb-4">
                                    <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频格式" className="mb-4">
                                    <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频语速" className="mb-4">
                                    <Input
                                        type="number"
                                        min={0.25}
                                        max={4}
                                        step={0.05}
                                        value={config.audioSpeed}
                                        onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                        onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                    />
                                </Form.Item>
                            </div>
                            <Form.Item label="默认音频指令" className="mb-4">
                                <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                            </Form.Item>
                        </>
                    ) : null}
                </Form>
            </div>
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function summarizeProviders(providers: LumaProvider[]) {
    return providers.reduce(
        (summary, provider) => ({
            keyCount: summary.keyCount + (provider.has_key ? 1 : 0),
            modelCount: summary.modelCount + provider.image_models.length + provider.chat_models.length + provider.video_models.length,
        }),
        { keyCount: 0, modelCount: 0 },
    );
}

function ProviderSummaryCard({ provider }: { provider: LumaProvider }) {
    const modelCount = provider.image_models.length + provider.chat_models.length + provider.video_models.length;
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950">
            <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{provider.name}</div>
                    <div className="mt-1 truncate text-xs text-stone-500">{provider.base_url || "未填写 Base URL"}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                    {provider.primary ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-300">主平台</span> : null}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${provider.enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-stone-500/15 text-stone-500"}`}>{provider.enabled ? "启用" : "停用"}</span>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
                <span className="rounded bg-stone-100 px-2 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{modelCount} 模型</span>
                <span className={`rounded px-2 py-1 ${provider.has_key ? "bg-blue-500/15 text-blue-600 dark:text-blue-300" : "bg-stone-100 text-stone-500 dark:bg-stone-900"}`}>{provider.has_key ? `Key 已保存 ${provider.key_preview || ""}` : "无 Key"}</span>
                {provider.image_models.length ? <span className="rounded bg-stone-100 px-2 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">生图 {provider.image_models.length}</span> : null}
                {provider.chat_models.length ? <span className="rounded bg-stone-100 px-2 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">文本 {provider.chat_models.length}</span> : null}
                {provider.video_models.length ? <span className="rounded bg-stone-100 px-2 py-1 text-stone-600 dark:bg-stone-900 dark:text-stone-300">视频 {provider.video_models.length}</span> : null}
            </div>
        </div>
    );
}
