"use client";

import { AlertCircle, CheckCircle2, CircleDashed, Copy, DatabaseZap, EyeOff, KeyRound, LoaderCircle, Plus, RefreshCcw, Save, Settings, ShieldCheck, SlidersHorizontal, Trash2, UserCog, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Popconfirm, Select, Space, Spin, Switch, Tag, Tooltip, Typography } from "antd";

import {
    clearKeyDiagnostics,
    fetchKeyDiagnostics,
    fetchProviderModelsDraft,
    fetchProviders,
    normalizeApiBaseUrl,
    normalizeModels,
    probeProviderAsync,
    saveProviders,
    testProviderConnection,
    type LumaProvider,
    type ProviderKeyDiagnostics,
    type ProviderModelsResponse,
} from "@/services/api/providers";
import { downloadCloudConfig, fetchCloudStatus } from "@/services/api/cloud";
import { cn } from "@/lib/utils";

type ProviderDraft = LumaProvider & {
    draft_new?: boolean;
};

type ModelListKey = "image_models" | "chat_models" | "video_models";

type FetchedModelSelection = Record<ModelListKey, string[]>;

type FetchedModelPickerState = {
    fallback: boolean;
    classified: ReturnType<typeof classifyFetchedModels>;
    selected: FetchedModelSelection;
    query: string;
};

type ActionKey = "save" | "refresh" | "test" | "probe" | "fetch" | "clear-key" | "diagnostics" | "recover" | "";

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,48}$/;
const MODEL_SECTIONS = [
    { key: "image_models", label: "生图模型", tag: "Image", placeholder: "gpt-image-2-vip" },
    { key: "chat_models", label: "聊天模型", tag: "Chat", placeholder: "gpt-5.5" },
    { key: "video_models", label: "视频模型", tag: "Video", placeholder: "sora-2" },
] as const;

export default function ApiSettingsPage() {
    const { message } = App.useApp();
    const [providers, setProviders] = useState<ProviderDraft[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [diagnostics, setDiagnostics] = useState<ProviderKeyDiagnostics | null>(null);
    const [checkResult, setCheckResult] = useState<ProviderModelsResponse | null>(null);
    const [modelPicker, setModelPicker] = useState<FetchedModelPickerState | null>(null);
    const [action, setAction] = useState<ActionKey>("refresh");
    const [loadError, setLoadError] = useState("");
    const autoRecoverRef = useRef(false);
    const baselineRef = useRef<ProviderDraft[]>([]);
    const dirtyRef = useRef(false);

    const selectedIndex = useMemo(() => providers.findIndex((provider) => provider.id === selectedId), [providers, selectedId]);
    const selected = selectedIndex >= 0 ? providers[selectedIndex] : providers[0];
    const enabledCount = providers.filter((provider) => provider.enabled).length;
    const savedKeyCount = diagnostics?.stored_key_count ?? providers.filter((provider) => provider.has_key).length;
    const modelCount = selected ? selected.image_models.length + selected.chat_models.length + selected.video_models.length : 0;
    const defaultImagePreview = selected ? selected.image_models.find((item) => item === "gpt-image-2-vip") || selected.image_models[0] || "-" : "-";
    const isDirty = useMemo(() => providerFingerprint(providers) !== providerFingerprint(baselineRef.current), [providers]);
    dirtyRef.current = isDirty;

    const rememberBaseline = useCallback((next: ProviderDraft[]) => {
        baselineRef.current = cloneProviderDrafts(next);
    }, []);

    const discardChanges = useCallback(() => {
        const baseline = cloneProviderDrafts(baselineRef.current);
        setProviders(baseline);
        setSelectedId((current) => pickSelectedId(baseline, current));
        setCheckResult(null);
    }, []);

    const refreshDiagnostics = useCallback(async () => {
        const data = await fetchKeyDiagnostics();
        setDiagnostics(data);
        return data;
    }, []);

    const recoverCloudKeys = useCallback(
        async (silent = false) => {
            setAction("recover");
            try {
                const status = await fetchCloudStatus(true);
                if (!status.logged_in) {
                    if (!silent) message.warning("请先登录云端账户");
                    return false;
                }
                await downloadCloudConfig();
                const data = await fetchProviders();
                const next = data.map((provider) => ({ ...provider, draft_new: false }));
                setProviders(next);
                rememberBaseline(next);
                setSelectedId((current) => pickSelectedId(next, current));
                const nextDiagnostics = await refreshDiagnostics();
                broadcastProvidersChanged();
                if (!silent) {
                    const count = nextDiagnostics.stored_key_count || 0;
                    message.success(count ? `已从云端恢复 ${count} 个 API Key` : "已同步云端配置");
                }
                return true;
            } catch (error) {
                if (!silent) message.error(error instanceof Error ? error.message : "云端配置恢复失败");
                return false;
            } finally {
                setAction("");
            }
        },
        [message, refreshDiagnostics, rememberBaseline],
    );

    const loadProviders = useCallback(async () => {
        setAction("refresh");
        try {
            const data = await fetchProviders();
            const next = data.map((provider) => ({ ...provider, draft_new: false }));
            setProviders(next);
            rememberBaseline(next);
            setSelectedId((current) => pickSelectedId(next, current));
            const keyDiagnostics = await refreshDiagnostics();
            setCheckResult(null);
            setLoadError("");
            if (!autoRecoverRef.current && keyDiagnostics.recoverable_from_cloud && !keyDiagnostics.stored_key_count) {
                autoRecoverRef.current = true;
                void recoverCloudKeys(true);
            }
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : "API 平台读取失败");
        } finally {
            setAction("");
        }
    }, [recoverCloudKeys, refreshDiagnostics, rememberBaseline]);

    useEffect(() => {
        void loadProviders();
    }, [loadProviders]);

    useEffect(() => {
        const warning = "API 设置尚未保存，确定放弃这些更改吗？";
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!dirtyRef.current) return;
            event.preventDefault();
            event.returnValue = "";
        };
        const captureNavigation = (event: MouseEvent) => {
            if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
            if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin || anchor.href === window.location.href) return;
            event.preventDefault();
            if (!window.confirm(warning)) return;
            dirtyRef.current = false;
            discardChanges();
            window.location.assign(anchor.href);
        };
        const handlePopState = () => {
            if (!dirtyRef.current) return;
            if (window.confirm(warning)) {
                dirtyRef.current = false;
                discardChanges();
                return;
            }
            window.history.forward();
        };
        window.addEventListener("beforeunload", beforeUnload);
        document.addEventListener("click", captureNavigation, true);
        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("beforeunload", beforeUnload);
            document.removeEventListener("click", captureNavigation, true);
            window.removeEventListener("popstate", handlePopState);
        };
    }, [discardChanges]);

    const updateSelected = (patch: Partial<ProviderDraft>) => {
        if (!selected) return;
        setProviders((current) => {
            const index = current.findIndex((provider) => provider.id === selected.id);
            if (index < 0) return current;
            const next = current.map((provider, itemIndex) => (itemIndex === index ? normalizeDraft({ ...provider, ...patch }) : provider));
            if (patch.id && patch.id !== selectedId) setSelectedId(patch.id);
            return next;
        });
    };

    const persistProviders = async (nextProviders = providers, successText = "API 设置已保存") => {
        const normalized = normalizeProviderList(nextProviders);
        const validationError = validateProviders(normalized);
        if (validationError) {
            message.error(validationError);
            return false;
        }
        setAction("save");
        try {
            const saved = await saveProviders(normalized);
            const next = saved.map((provider) => ({ ...provider, draft_new: false }));
            setProviders(next);
            rememberBaseline(next);
            setSelectedId((current) => pickSelectedId(next, current || selectedId));
            setCheckResult(null);
            await refreshDiagnostics();
            broadcastProvidersChanged();
            message.success(successText);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
            return false;
        } finally {
            setAction("");
        }
    };

    const addProvider = () => {
        const id = nextProviderId(providers);
        const provider: ProviderDraft = normalizeDraft({
            id,
            name: "新 API 平台",
            base_url: "",
            protocol: "openai",
            protocol_override: "auto",
            enabled: true,
            primary: providers.length === 0,
            image_models: [],
            chat_models: [],
            video_models: [],
            has_key: false,
            key_preview: "",
            draft_new: true,
        });
        setProviders((current) => ensureOnePrimary([...current, provider]));
        setSelectedId(id);
        setCheckResult(null);
    };

    const deleteSelected = () => {
        if (!selected || providers.length <= 1) return;
        const next = ensureOnePrimary(providers.filter((_, index) => index !== selectedIndex));
        setProviders(next);
        setSelectedId(next[0]?.id || "");
        setCheckResult(null);
    };

    const setPrimary = () => {
        if (!selected) return;
        setProviders((current) => current.map((provider, index) => ({ ...provider, primary: index === selectedIndex })));
    };

    const clearCurrentKey = async () => {
        if (!selected) return;
        const next = providers.map((provider, index) =>
            index === selectedIndex
                ? {
                      ...provider,
                      api_key: "",
                      clear_key: true,
                      has_key: false,
                      key_preview: "",
                  }
                : provider,
        );
        setProviders(next);
        await persistProviders(next, "当前平台 Key 已清除");
    };

    const runConnectionTest = async () => {
        if (!selected) return;
        const normalizedBaseUrl = normalizeApiBaseUrl(selected.base_url);
        if (normalizedBaseUrl !== selected.base_url) updateSelected({ base_url: normalizedBaseUrl });
        const setupError = getProviderActionError({ ...selected, base_url: normalizedBaseUrl });
        if (setupError) {
            message.warning(setupError);
            return;
        }
        setAction("test");
        setCheckResult(null);
        try {
            const data = await testProviderConnection({
                provider_id: selected.id,
                base_url: normalizedBaseUrl,
                api_key: selected.api_key?.trim() || undefined,
                protocol_override: selected.protocol_override || "auto",
            });
            setCheckResult(data);
            if (data.ok && !data.fallback) message.success(`连接通过，识别到 ${data.model_count ?? data.total ?? 0} 个模型`);
            else message.warning(data.message || (data.fallback ? "模型列表接口不可用，当前使用手动模型兜底" : "连接未通过"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "连接测试失败");
        } finally {
            setAction("");
        }
    };

    const runProtocolProbe = async () => {
        if (!selected) return;
        const normalizedBaseUrl = normalizeApiBaseUrl(selected.base_url);
        if (normalizedBaseUrl !== selected.base_url) updateSelected({ base_url: normalizedBaseUrl });
        const setupError = getProviderActionError({ ...selected, base_url: normalizedBaseUrl }, { allowMissingKey: true });
        if (setupError) {
            message.warning(setupError);
            return;
        }
        setAction("probe");
        try {
            const data = await probeProviderAsync({
                provider_id: selected.id,
                base_url: normalizedBaseUrl,
                api_key: selected.api_key?.trim() || undefined,
                protocol_override: selected.protocol_override || "auto",
            });
            const protocol = data.protocol === "apimart" ? "apimart" : "openai";
            updateSelected({ protocol });
            setCheckResult(data);
            const suffix = data.confidence === "low" ? "，建议手动确认" : "";
            message.success(`协议已设置为 ${protocol === "apimart" ? "APIMart 异步" : "OpenAI 兼容"}${suffix}`);
        } catch (error) {
            updateSelected({ protocol: "openai" });
            message.error(error instanceof Error ? error.message : "协议检测失败，已回退 OpenAI 兼容");
        } finally {
            setAction("");
        }
    };

    const applyPickedModels = (mode: "append" | "replace") => {
        if (!selected || !modelPicker) return;
        const picked = modelPicker.selected;
        const pickedCount = countSelectedModels(picked);
        if (!pickedCount) {
            message.warning("请先选择至少一个模型");
            return;
        }
        updateSelected({
            image_models: mode === "replace" ? normalizeModels(picked.image_models) : mergeModels(selected.image_models, picked.image_models),
            chat_models: mode === "replace" ? normalizeModels(picked.chat_models) : mergeModels(selected.chat_models, picked.chat_models),
            video_models: mode === "replace" ? normalizeModels(picked.video_models) : mergeModels(selected.video_models, picked.video_models),
        });
        setModelPicker(null);
        message.success(`${mode === "replace" ? "已覆盖为" : "已追加"} ${pickedCount} 个已选模型，记得保存设置`);
    };

    const runFetchModels = async () => {
        if (!selected) return;
        const normalizedBaseUrl = normalizeApiBaseUrl(selected.base_url);
        if (normalizedBaseUrl !== selected.base_url) updateSelected({ base_url: normalizedBaseUrl });
        const setupError = getProviderActionError({ ...selected, base_url: normalizedBaseUrl });
        if (setupError) {
            message.warning(setupError);
            return;
        }
        setAction("fetch");
        try {
            const data = await fetchProviderModelsDraft({ ...selected, base_url: normalizedBaseUrl });
            const classified = classifyFetchedModels(data);
            setCheckResult(data);
            setModelPicker({
                fallback: data.fallback === true,
                classified,
                selected: recommendedSelectionFromClassified(classified),
                query: "",
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型拉取失败");
        } finally {
            setAction("");
        }
    };

    const clearOrphanKeys = async () => {
        setAction("diagnostics");
        try {
            const data = await clearKeyDiagnostics(false);
            setDiagnostics(data);
            message.success(`已清理 ${data.removed_count || 0} 个孤立 Key`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "Key 清理失败");
        } finally {
            setAction("");
        }
    };

    const repairProviderNames = async () => {
        const repaired = providers.map((provider) => ({ ...provider, name: repairProviderDisplayName(provider) }));
        const changed = repaired.some((provider, index) => provider.name !== providers[index]?.name);
        if (!changed) {
            message.success("显示名称已经正常");
            return;
        }
        setProviders(repaired);
        await persistProviders(repaired, "显示名称已修复");
    };

    return (
        <main className="flex h-full min-h-0 flex-col overflow-hidden bg-stone-50 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            {isDirty ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                    <div className="flex items-center gap-2"><AlertCircle className="size-4" /><strong>有未保存的 API 设置</strong><span className="hidden opacity-75 sm:inline">离开页面前请保存或放弃更改。</span></div>
                    <div className="flex gap-2">
                        <Button size="small" onClick={discardChanges}>放弃更改</Button>
                        <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={action === "save"} onClick={() => void persistProviders()}>保存</Button>
                    </div>
                </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
                <aside className="flex min-h-[320px] flex-col rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800 lg:min-h-0">
                    <div className="border-b border-stone-200 p-4 dark:border-stone-800">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h1 className="m-0 text-lg font-semibold leading-tight">API 设置</h1>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    <Tag className="m-0">{providers.length} 平台</Tag>
                                    <Tag className="m-0" color="green">启用 {enabledCount}</Tag>
                                </div>
                            </div>
                            <Tooltip title="刷新">
                                <Button aria-label="刷新 API 平台" size="small" icon={action === "refresh" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />} onClick={() => { if (!isDirty || window.confirm("刷新会放弃未保存的 API 设置，确定继续吗？")) void loadProviders(); }} />
                            </Tooltip>
                        </div>
                    </div>

                    <div className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                        {providers.map((provider, index) => {
                            const active = provider.id === selected?.id && index === selectedIndex;
                            const total = provider.image_models.length + provider.chat_models.length + provider.video_models.length;
                            return (
                                <button
                                    key={`${provider.id}-${index}`}
                                    type="button"
                                    className={cn(
                                        "w-full rounded-lg border p-3 text-left transition",
                                        active ? "border-stone-950 bg-stone-100 shadow-sm dark:border-stone-100 dark:bg-stone-900" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900",
                                    )}
                                    onClick={() => {
                                        setSelectedId(provider.id);
                                        setCheckResult(null);
                                    }}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold">{provider.name || provider.id}</div>
                                            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{provider.base_url || "未配置地址"}</div>
                                        </div>
                                        {provider.primary ? <Tag className="m-0 shrink-0" color="gold">主平台</Tag> : null}
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                        <Tag className="m-0" color={provider.enabled ? "green" : "default"}>{provider.enabled ? "启用" : "停用"}</Tag>
                                        <Tag className="m-0">{total} 模型</Tag>
                                        <Tag className="m-0" color={provider.has_key ? "blue" : "default"}>{provider.has_key ? "Key 已保存" : "无 Key"}</Tag>
                                    </div>
                                </button>
                            );
                        })}
                        {!providers.length && action !== "refresh" && loadError ? (
                            <Alert
                                type="error"
                                showIcon
                                message="API 平台加载失败"
                                description={loadError}
                                action={<Button size="small" icon={<RefreshCcw className="size-3.5" />} onClick={() => void loadProviders()}>重试</Button>}
                            />
                        ) : null}
                        {!providers.length && action !== "refresh" && !loadError ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="暂无 API 平台"
                            >
                                <Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={addProvider}>添加第一个平台</Button>
                            </Empty>
                        ) : null}
                        {action === "refresh" && !providers.length ? <Spin className="flex justify-center py-10" /> : null}
                    </div>

                    <div className="grid gap-2 border-t border-stone-200 p-3 dark:border-stone-800">
                        <Button icon={<Plus className="size-4" />} onClick={addProvider}>添加平台</Button>
                        <Button icon={<RefreshCcw className="size-4" />} disabled={!providers.length} onClick={() => void repairProviderNames()}>修复显示名称</Button>
                    </div>
                </aside>

                <section className="thin-scrollbar min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800">
                    {diagnostics?.recoverable_from_cloud && !diagnostics.stored_key_count ? (
                        <div className="m-4 mb-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="font-semibold">检测到云端有可恢复的 API Key</div>
                                    <div className="mt-0.5 text-xs opacity-80">
                                        本地当前没有保存 Key，可从云端配置恢复 {diagnostics.recoverable_key_count || 0} 个 Key。恢复过程不会展示 Key 内容，也不会清空本地已有 Key。
                                    </div>
                                </div>
                                <Button size="small" type="primary" icon={<RefreshCcw className="size-4" />} loading={action === "recover"} onClick={() => void recoverCloudKeys(false)}>
                                    从云端恢复 API Key
                                </Button>
                            </div>
                        </div>
                    ) : null}
                    {selected ? (
                        <div className="mx-auto grid max-w-6xl gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_310px]">
                            <div className="space-y-4">
                                <div className="rounded-lg border border-stone-200 bg-background p-4 dark:border-stone-800">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h2 className="m-0 text-xl font-semibold">{selected.name || selected.id}</h2>
                                                {selected.primary ? <Tag color="gold">主平台</Tag> : null}
                                                <Tag color={selected.enabled ? "green" : "default"}>{selected.enabled ? "已启用" : "已停用"}</Tag>
                                            </div>
                                            <p className="m-0 mt-1 truncate text-sm text-stone-500 dark:text-stone-400">{selected.base_url || "未配置 Base URL"}</p>
                                        </div>
                                        <PreferenceSummary enabledCount={enabledCount} savedKeyCount={savedKeyCount} defaultImagePreview={providerModelLabel(selected, defaultImagePreview)} onRefresh={() => void loadProviders()} refreshing={action === "refresh"} />
                                    </div>
                                </div>

                                <div className="grid gap-4 xl:grid-cols-2">
                                    <Panel title="平台信息" icon={<SlidersHorizontal className="size-4" />}>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field label="平台名称">
                                                <Input value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} placeholder="OpenAI Compatible" />
                                            </Field>
                                            <div className="block min-w-0">
                                                <span className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-300">平台 ID</span>
                                                <Space.Compact className="w-full">
                                                    <Input aria-label="平台 ID" className="min-w-0" value={selected.id} disabled={!selected.draft_new} onChange={(event) => updateSelected({ id: normalizeProviderId(event.target.value) })} />
                                                    <CopyIdButton id={selected.id} />
                                                </Space.Compact>
                                            </div>
                                            <Field className="sm:col-span-2" label="Base URL">
                                                <Input
                                                    value={selected.base_url}
                                                    onChange={(event) => updateSelected({ base_url: event.target.value })}
                                                    onBlur={(event) => updateSelected({ base_url: normalizeApiBaseUrl(event.target.value) })}
                                                    placeholder="api.openai.com/v1"
                                                />
                                            </Field>
                                            <Field label="协议">
                                                <Select
                                                    className="w-full"
                                                    value={selected.protocol}
                                                    options={[
                                                        { label: "OpenAI 兼容", value: "openai" },
                                                        { label: "APIMart 异步", value: "apimart" },
                                                    ]}
                                                    onChange={(value) => updateSelected({ protocol: value })}
                                                />
                                            </Field>
                                            <Field label="协议检测模式">
                                                <Select
                                                    className="w-full"
                                                    value={selected.protocol_override || "auto"}
                                                    options={[
                                                        { label: "自动检测", value: "auto" },
                                                        { label: "强制 OpenAI 兼容", value: "force-openai" },
                                                        { label: "强制 APIMart 异步", value: "force-apimart" },
                                                    ]}
                                                    onChange={(value) => updateSelected({ protocol_override: value })}
                                                />
                                            </Field>
                                            <Field label="启用状态">
                                                <div className="flex h-8 items-center gap-3">
                                                    <Switch checked={selected.enabled} onChange={(checked) => updateSelected({ enabled: checked })} />
                                                    <span className="text-sm text-stone-500">{selected.enabled ? "参与模型选择" : "不参与生成"}</span>
                                                </div>
                                            </Field>
                                        </div>
                                    </Panel>

                                    <Panel title="Key 与诊断" icon={<KeyRound className="size-4" />}>
                                        <div className="space-y-3">
                                            <Field label="API Key">
                                                <Input.Password
                                                    value={selected.api_key || ""}
                                                    placeholder={selected.has_key ? `保持已保存 Key：${selected.key_preview || "******"}` : "粘贴新的 API Key"}
                                                    iconRender={(visible) => (visible ? <KeyRound className="size-4" /> : <EyeOff className="size-4" />)}
                                                    onChange={(event) => updateSelected({ api_key: event.target.value, clear_key: false })}
                                                />
                                            </Field>
                                            <div className="flex flex-wrap gap-2">
                                                <Button icon={<DatabaseZap className="size-4" />} onClick={() => void runConnectionTest()} loading={action === "test"}>连接测试</Button>
                                                <Button icon={<CircleDashed className="size-4" />} onClick={() => void runProtocolProbe()} loading={action === "probe"}>检测协议</Button>
                                                <Popconfirm title="清除当前平台保存的 Key？" okText="清除" cancelText="取消" onConfirm={() => void clearCurrentKey()}>
                                                    <Button danger icon={<X className="size-4" />} disabled={!selected.has_key && !selected.api_key} loading={action === "clear-key"}>清除 Key</Button>
                                                </Popconfirm>
                                            </div>
                                            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-800 dark:bg-stone-950">
                                                <div className="flex items-center gap-2 font-medium">
                                                    {selected.has_key ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertCircle className="size-4 text-stone-400" />}
                                                    {selected.has_key ? `Key 已保存 ${selected.key_preview || ""}` : "当前平台未保存 Key"}
                                                </div>
                                                {checkResult ? <CheckResult result={checkResult} /> : null}
                                            </div>
                                        </div>
                                    </Panel>
                                </div>

                                <Panel
                                    title="模型列表"
                                    icon={<DatabaseZap className="size-4" />}
                                    extra={
                                        <Button icon={<RefreshCcw className="size-4" />} onClick={() => void runFetchModels()} loading={action === "fetch"}>
                                            拉取模型
                                        </Button>
                                    }
                                >
                                    {!modelCount ? (
                                        <Alert
                                            className="mb-3"
                                            type="info"
                                            showIcon
                                            message="还没有可用模型"
                                            description="可以先点击“拉取模型”从当前平台读取，也可以在下方手动添加常用模型。拉取结果会先进入选择面板，不会直接覆盖手填内容。"
                                        />
                                    ) : null}
                                    <div className="grid gap-3 xl:grid-cols-3">
                                        {MODEL_SECTIONS.map((section) => (
                                            <ModelSection
                                                key={section.key}
                                                title={section.label}
                                                tag={section.tag}
                                                placeholder={section.placeholder}
                                                models={selected[section.key]}
                                                onChange={(models) => updateSelected({ [section.key]: models } as Partial<ProviderDraft>)}
                                            />
                                        ))}
                                    </div>
                                </Panel>
                            </div>

                            <aside className="space-y-4">
                                <Panel title="操作" icon={<Save className="size-4" />}>
                                    <div className="grid gap-2">
                                        <Button type="primary" block icon={<Save className="size-4" />} loading={action === "save"} onClick={() => void persistProviders()}>
                                            保存设置
                                        </Button>
                                        <Button block icon={<Settings className="size-4" />} disabled={selected.primary} onClick={setPrimary}>
                                            设为主平台
                                        </Button>
                                        <Popconfirm title="删除当前平台？" description="删除后需要点击保存设置才会写入本地配置。" okText="删除" cancelText="取消" onConfirm={deleteSelected}>
                                            <Button block danger icon={<Trash2 className="size-4" />} disabled={providers.length <= 1}>
                                                删除平台
                                            </Button>
                                        </Popconfirm>
                                    </div>
                                </Panel>

                                <Panel title="当前摘要" icon={<CheckCircle2 className="size-4" />}>
                                    <div className="grid gap-2 text-sm">
                                        <SummaryItem label="平台 ID" value={selected.id || "-"} />
                                        <SummaryItem label="协议" value={selected.protocol === "apimart" ? "APIMart 异步" : "OpenAI 兼容"} />
                                        <SummaryItem label="检测模式" value={protocolOverrideLabel(selected.protocol_override)} />
                                        <SummaryItem label="模型总数" value={String(modelCount)} />
                                        <SummaryItem label="默认生图优先" value={providerModelLabel(selected, defaultImagePreview)} />
                                    </div>
                                    {!PROVIDER_ID_RE.test(selected.id) ? <Alert className="mt-3" type="warning" showIcon title="平台 ID 只能使用小写字母、数字、下划线或短横线" /> : null}
                                </Panel>

                                <Panel title="模型体检" icon={<DatabaseZap className="size-4" />}>
                                    <ModelHealthPanel provider={selected} diagnostics={diagnostics} checkResult={checkResult} modelCount={modelCount} />
                                </Panel>

                                <Panel title="Key 诊断" icon={<ShieldCheck className="size-4" />}>
                                    <div className="space-y-3 text-sm">
                                        <SummaryItem label="平台数量" value={String(diagnostics?.provider_count ?? providers.length)} />
                                        <SummaryItem label="已保存 Key" value={String(savedKeyCount)} />
                                        <SummaryItem label="孤立 Key" value={String(diagnostics?.orphan_keys?.length || 0)} />
                                        {diagnostics?.orphan_keys?.length ? (
                                            <div className="flex flex-wrap gap-1">
                                                {diagnostics.orphan_keys.map((key) => (
                                                    <Tag key={key} className="m-0">{key}</Tag>
                                                ))}
                                            </div>
                                        ) : null}
                                        <Button block icon={<Trash2 className="size-4" />} disabled={!diagnostics?.orphan_keys?.length} onClick={() => void clearOrphanKeys()} loading={action === "diagnostics"}>清理孤立 Key</Button>
                                    </div>
                                </Panel>

                                <Alert
                                    type="info"
                                    showIcon
                                    title="兼容说明"
                                    description="本页直接读写 LumaForge providers；旧版静态设置页、Go 主体和 Python legacy 会共用同一份配置。生成时模型会显示为“平台 / 模型”，后端按平台精确路由。"
                                />

                                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                                    <div className="mb-1 flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
                                        <UserCog className="size-4" />
                                        普通用户本机配置
                                    </div>
                                    这里就是正常使用入口，不区分管理员角色。平台、模型和 Key 只按当前本机配置生效；保存前的改动不会影响生成。
                                </div>
                            </aside>
                        </div>
                    ) : (
                        <div className="flex h-full min-h-[520px] items-center justify-center">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择或新增 API 平台" />
                        </div>
                    )}
                </section>
            </div>
            <FetchedModelsPicker
                state={modelPicker}
                existing={{
                    image_models: selected?.image_models || [],
                    chat_models: selected?.chat_models || [],
                    video_models: selected?.video_models || [],
                }}
                onChange={setModelPicker}
                onCancel={() => setModelPicker(null)}
                onAppend={() => applyPickedModels("append")}
                onReplace={() => applyPickedModels("replace")}
            />
        </main>
    );
}

function PreferenceSummary({ enabledCount, savedKeyCount, defaultImagePreview, refreshing, onRefresh }: { enabledCount: number; savedKeyCount: number; defaultImagePreview: string; refreshing: boolean; onRefresh: () => void }) {
    return (
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <Settings className="size-4 text-stone-800 dark:text-stone-100" />
                <span>本地 API 平台</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <ShieldCheck className="size-4 text-stone-800 dark:text-stone-100" />
                <span>{enabledCount} 启用 / {savedKeyCount} Key</span>
            </div>
            <div className="max-w-[260px] truncate rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300" title={defaultImagePreview}>
                {defaultImagePreview}
            </div>
            <Tooltip title="刷新配置">
                <Button size="small" icon={refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />} onClick={onRefresh} />
            </Tooltip>
        </div>
    );
}

function Panel({ title, icon, extra, children }: { title: string; icon: ReactNode; extra?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-stone-200 bg-background p-4 shadow-sm dark:border-stone-800">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200">{icon}</span>
                    <h3 className="m-0 truncate text-base font-semibold">{title}</h3>
                </div>
                {extra}
            </div>
            {children}
        </section>
    );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <label className={cn("block min-w-0", className)}>
            <span className="mb-1.5 block text-sm font-medium text-stone-600 dark:text-stone-300">{label}</span>
            {children}
        </label>
    );
}

function ModelSection({ title, tag, placeholder, models, onChange }: { title: string; tag: string; placeholder: string; models: string[]; onChange: (models: string[]) => void }) {
    const inputRefs = useRef<Array<{ focus: () => void } | null>>([]);
    const updateModel = (index: number, value: string) => onChange(models.map((model, itemIndex) => (itemIndex === index ? value : model)));
    const removeModel = (index: number) => onChange(models.filter((_, itemIndex) => itemIndex !== index));
    const addModel = () => {
        const nextIndex = models.length;
        onChange([...models, ""]);
        window.setTimeout(() => inputRefs.current[nextIndex]?.focus(), 0);
    };
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{title}</span>
                    <Tag className="m-0">{models.length}</Tag>
                </div>
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={addModel}>添加</Button>
            </div>
            <div className="space-y-2">
                {models.map((model, index) => (
                    <div key={`${tag}-${index}`} className="grid grid-cols-[minmax(0,1fr)_32px] gap-2">
                        <Input ref={(node) => { inputRefs.current[index] = node; }} value={model} placeholder={placeholder} onChange={(event) => updateModel(index, event.target.value)} />
                        <Tooltip title="删除">
                            <Button icon={<Trash2 className="size-4" />} onClick={() => removeModel(index)} />
                        </Tooltip>
                    </div>
                ))}
                {!models.length ? <div className="rounded-md border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500 dark:border-stone-700">暂无模型</div> : null}
            </div>
        </div>
    );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-stone-50 px-3 py-2 dark:bg-stone-950">
            <span className="shrink-0 text-stone-500 dark:text-stone-400">{label}</span>
            <span className="min-w-0 truncate font-medium" title={value}>{value}</span>
        </div>
    );
}

function ModelHealthPanel({ provider, diagnostics, checkResult, modelCount }: { provider: ProviderDraft; diagnostics: ProviderKeyDiagnostics | null; checkResult: ProviderModelsResponse | null; modelCount: number }) {
    const hasBaseURL = Boolean(provider.base_url.trim());
    const hasKey = Boolean(provider.api_key?.trim() || provider.has_key);
    const hasImage = provider.image_models.length > 0;
    const hasChat = provider.chat_models.length > 0;
    const hasVideo = provider.video_models.length > 0;
    const rows = [
        { label: "Base URL", ok: hasBaseURL, detail: hasBaseURL ? provider.base_url : "填写平台接口地址，通常以 /v1 结尾" },
        { label: "API Key", ok: hasKey, detail: hasKey ? "已配置，可测试连接" : "粘贴 Key 后保存或直接测试" },
        { label: "模型列表", ok: modelCount > 0, detail: modelCount > 0 ? `${modelCount} 个模型` : "拉取模型或手动添加模型" },
        { label: "生图", ok: hasImage, detail: hasImage ? provider.image_models[0] : "需要至少一个生图模型" },
        { label: "聊天", ok: hasChat, detail: hasChat ? provider.chat_models[0] : "需要至少一个聊天模型" },
        { label: "视频", ok: hasVideo, detail: hasVideo ? provider.video_models[0] : "不用视频可留空" },
    ];
    const fallback = checkResult?.fallback ? "模型列表接口不可用时，可以先保存手动模型。" : "";
    const cloudHint = diagnostics?.recoverable_from_cloud && !diagnostics.stored_key_count ? "云端有可恢复 Key，可先恢复再测试。" : "";
    return (
        <div className="grid gap-2 text-sm">
            {rows.map((row) => (
                <div key={row.label} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{row.label}</span>
                        <Tag className="m-0" color={row.ok ? "green" : "warning"}>{row.ok ? "正常" : "需处理"}</Tag>
                    </div>
                    <p className="m-0 mt-1 break-all text-xs text-stone-500">{row.detail}</p>
                </div>
            ))}
            {fallback || cloudHint ? <Alert type="info" showIcon message="下一步" description={[fallback, cloudHint].filter(Boolean).join(" ")} /> : null}
        </div>
    );
}

function CopyIdButton({ id }: { id: string }) {
    return (
        <Tooltip title="复制 ID">
            <Button
                aria-label="复制平台 ID"
                htmlType="button"
                className="!px-2"
                onClick={(event) => {
                    event.preventDefault();
                    void navigator.clipboard?.writeText(id);
                }}
            >
                <Copy className="size-3.5" />
            </Button>
        </Tooltip>
    );
}

function CheckResult({ result }: { result: ProviderModelsResponse }) {
    const ok = result.ok === true && result.fallback !== true;
    const count = result.model_count ?? result.total ?? result.all?.length ?? 0;
    const statusText = result.fallback ? "手动模型兜底" : ok ? "检测通过" : "检测完成";
    return (
        <div className="mt-2 border-t border-stone-200 pt-2 dark:border-stone-800">
            <div className={cn("flex items-center gap-2 text-xs font-semibold", ok ? "text-emerald-600" : "text-amber-600")}>
                {ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
                <span>{result.message || statusText}</span>
            </div>
            <Typography.Paragraph className="!mb-0 !mt-1 !text-xs !text-stone-500 dark:!text-stone-400" ellipsis={{ rows: 2 }}>
                HTTP {result.status ?? result.status_code ?? "-"} · 模型 {count}{result.fallback ? " · 手动保存" : ""}
            </Typography.Paragraph>
        </div>
    );
}

function FetchedModelsPicker({
    state,
    existing,
    onChange,
    onCancel,
    onAppend,
    onReplace,
}: {
    state: FetchedModelPickerState | null;
    existing: FetchedModelSelection;
    onChange: (next: FetchedModelPickerState | null) => void;
    onCancel: () => void;
    onAppend: () => void;
    onReplace: () => void;
}) {
    if (!state) return null;
    const selectedCount = countSelectedModels(state.selected);
    const totalCount = state.classified.all.length;
    const normalizedQuery = state.query.trim().toLowerCase();

    const updateSelection = (key: ModelListKey, models: string[]) => {
        onChange({ ...state, selected: { ...state.selected, [key]: normalizeModels(models) } });
    };

    return (
        <Modal
            title={state.fallback ? "上游模型接口不可用" : "选择要添加的模型"}
            open
            width={880}
            centered
            onCancel={onCancel}
            footer={[
                <Button key="cancel" onClick={onCancel}>
                    只查看
                </Button>,
                <Button key="replace" disabled={!selectedCount} onClick={onReplace}>
                    覆盖为已选
                </Button>,
                <Button key="append" type="primary" disabled={!selectedCount} onClick={onAppend}>
                    追加已选
                </Button>,
            ]}
        >
            <div className="space-y-4">
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                            <p className="m-0 text-sm font-medium text-stone-900 dark:text-stone-100">
                                {state.fallback ? "当前展示的是已保存的手动模型，建议保留现有配置。" : `共识别 ${totalCount} 个模型，已按常用能力推荐选择 ${selectedCount} 个，可继续勾选调整。`}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Tag color="blue">生图 {state.classified.image.length}</Tag>
                                <Tag color="green">聊天 {state.classified.chat.length}</Tag>
                                <Tag color="purple">视频 {state.classified.video.length}</Tag>
                                <Tag>已选 {selectedCount}</Tag>
                            </div>
                        </div>
                        <Input
                            allowClear
                            className="w-full md:max-w-[260px]"
                            placeholder="搜索模型名称"
                            value={state.query}
                            onChange={(event) => onChange({ ...state, query: event.target.value })}
                        />
                    </div>
                </div>

                <div className="grid max-h-[52vh] gap-3 overflow-y-auto pr-1 lg:grid-cols-3">
                    {MODEL_SECTIONS.map((section) => {
                        const models = modelsForSection(state.classified, section.key).filter((model) => !normalizedQuery || model.toLowerCase().includes(normalizedQuery));
                        return (
                            <FetchedModelSection
                                key={section.key}
                                title={section.label}
                                tag={section.tag}
                                models={models}
                                selected={state.selected[section.key]}
                                existing={existing[section.key]}
                                onChange={(models) => updateSelection(section.key, models)}
                            />
                        );
                    })}
                </div>
            </div>
        </Modal>
    );
}

function FetchedModelSection({
    title,
    tag,
    models,
    selected,
    existing,
    onChange,
}: {
    title: string;
    tag: string;
    models: string[];
    selected: string[];
    existing: string[];
    onChange: (models: string[]) => void;
}) {
    const selectedSet = new Set(selected);
    const existingSet = new Set(existing);
    const allVisibleSelected = models.length > 0 && models.every((model) => selectedSet.has(model));
    const toggleVisible = () => {
        const next = new Set(selected);
        if (allVisibleSelected) models.forEach((model) => next.delete(model));
        else models.forEach((model) => next.add(model));
        onChange([...next]);
    };

    return (
        <section className="min-h-[220px] rounded-lg border border-stone-200 bg-background p-3 dark:border-stone-800">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{title}</span>
                    <Tag className="m-0">{models.length}</Tag>
                </div>
                <Button size="small" disabled={!models.length} onClick={toggleVisible}>
                    {allVisibleSelected ? "清空" : "全选"}
                </Button>
            </div>
            <div className="space-y-2">
                {models.length ? (
                    models.map((model) => (
                        <label
                            key={`${tag}-${model}`}
                            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-200 px-2.5 py-2 text-sm transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:hover:border-stone-700 dark:hover:bg-stone-900/70"
                        >
                            <Checkbox checked={selectedSet.has(model)} onChange={(event) => onChange(toggleModel(selected, model, event.target.checked))} />
                            <span className="min-w-0 flex-1 break-all text-stone-700 dark:text-stone-200">{model}</span>
                            {existingSet.has(model) ? <Tag className="m-0 shrink-0">已存在</Tag> : null}
                        </label>
                    ))
                ) : (
                    <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-stone-200 px-3 text-center text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
                        没有匹配的模型
                    </div>
                )}
            </div>
        </section>
    );
}

function normalizeDraft(provider: Partial<ProviderDraft>): ProviderDraft {
    return {
        id: normalizeProviderId(provider.id || ""),
        name: String(provider.name || provider.id || "").trim(),
        base_url: String(provider.base_url || "").trim(),
        protocol: provider.protocol === "apimart" ? "apimart" : "openai",
        protocol_override: normalizeProtocolOverride(provider.protocol_override),
        enabled: provider.enabled !== false,
        primary: provider.primary === true,
        image_models: normalizeDraftModels(provider.image_models),
        chat_models: normalizeDraftModels(provider.chat_models),
        video_models: normalizeDraftModels(provider.video_models),
        ms_loras: Array.isArray(provider.ms_loras) ? provider.ms_loras : [],
        ms_defaults_version: Number(provider.ms_defaults_version || 0),
        api_key: provider.api_key || "",
        clear_key: provider.clear_key === true,
        has_key: provider.has_key === true,
        key_preview: provider.key_preview || "",
        key_env: provider.key_env || "",
        draft_new: provider.draft_new === true,
    };
}

function normalizeProtocolOverride(value?: string) {
    if (value === "force-openai" || value === "force-apimart") return value;
    return "auto";
}

function protocolOverrideLabel(value?: string) {
    if (value === "force-openai") return "强制 OpenAI 兼容";
    if (value === "force-apimart") return "强制 APIMart 异步";
    return "自动检测";
}

function normalizeProviderList(providers: ProviderDraft[]) {
    return ensureOnePrimary(providers.map(normalizeDraft)).map((provider) => ({
        ...provider,
        name: provider.name || provider.id,
        base_url: normalizeApiBaseUrl(provider.base_url),
        image_models: normalizeModels(provider.image_models),
        chat_models: normalizeModels(provider.chat_models),
        video_models: normalizeModels(provider.video_models),
    }));
}

function normalizeDraftModels(models?: string[]) {
    return (models || []).map((item) => String(item ?? ""));
}

function cloneProviderDrafts(providers: ProviderDraft[]) {
    return providers.map((provider) => ({
        ...provider,
        image_models: [...provider.image_models],
        chat_models: [...provider.chat_models],
        video_models: [...provider.video_models],
    }));
}

function providerFingerprint(providers: ProviderDraft[]) {
    return JSON.stringify(
        providers.map((provider) => ({
            ...provider,
            image_models: normalizeDraftModels(provider.image_models),
            chat_models: normalizeDraftModels(provider.chat_models),
            video_models: normalizeDraftModels(provider.video_models),
        })),
    );
}

function mergeModels(current: string[], incoming: string[]) {
    return normalizeModels([...current, ...incoming]);
}

function recommendedSelectionFromClassified(classified: ReturnType<typeof classifyFetchedModels>): FetchedModelSelection {
    const pickRecommended = (models: string[], capability: ModelListKey) => {
        const preferred = models.filter((model) => isRecommendedFetchedModel(model, capability));
        if (preferred.length) return preferred;
        return models.length <= 12 ? models : models.slice(0, 12);
    };
    return {
        image_models: pickRecommended(classified.image, "image_models"),
        chat_models: pickRecommended(classified.chat, "chat_models"),
        video_models: pickRecommended(classified.video, "video_models"),
    };
}

function isRecommendedFetchedModel(model: string, capability: ModelListKey) {
    const value = model.toLowerCase();
    if (capability === "image_models") {
        return /(gpt-image|dall-e|nano-banana|imagen|flux|qwen-image|image)/.test(value);
    }
    if (capability === "video_models") {
        return /(sora|seedance|veo|video|wan|hailuo|kling)/.test(value);
    }
    return /(gpt-5|gpt-4|claude|gemini|deepseek|qwen|kimi|chat|o[134])/.test(value);
}

function countSelectedModels(selection: FetchedModelSelection) {
    return normalizeModels([...selection.image_models, ...selection.chat_models, ...selection.video_models]).length;
}

function modelsForSection(classified: ReturnType<typeof classifyFetchedModels>, key: ModelListKey) {
    if (key === "image_models") return classified.image;
    if (key === "video_models") return classified.video;
    return classified.chat;
}

function toggleModel(models: string[], model: string, checked: boolean) {
    const next = new Set(models);
    if (checked) next.add(model);
    else next.delete(model);
    return [...next];
}

function repairProviderDisplayName(provider: Pick<ProviderDraft, "id" | "name" | "base_url">) {
    const name = String(provider.name || "").trim();
    const id = String(provider.id || "").trim().toLowerCase();
    const baseUrl = String(provider.base_url || "").trim().toLowerCase();
    const lowerName = name.toLowerCase();
    if (!isBrokenProviderName(name)) return name || provider.id;
    if (baseUrl.includes("dashscope.aliyuncs.com")) return "百炼";
    if (baseUrl.includes("gemini") || id.includes("gemini") || lowerName.includes("gemini")) return "Gemini";
    if (baseUrl.includes("grsai") || id.includes("grsai")) return "grsai";
    if (id.includes("gpt") || lowerName.includes("gpt")) return "GPT";
    return provider.id || "API 平台";
}

function isBrokenProviderName(name: string) {
    const value = name.trim();
    return !value || value === "??" || value === "???" || value.includes("�") || value.includes("锟") || value.includes("ç¾ç¼") || value.includes("é»ä¸ç½") || value.includes("鐧剧偧") || value.includes("榛戜笌鐧") || value.includes("???");
}

function ensureOnePrimary(providers: ProviderDraft[]) {
    if (!providers.length) return providers;
    const primaryIndex = providers.findIndex((provider) => provider.primary);
    return providers.map((provider, index) => ({ ...provider, primary: primaryIndex >= 0 ? index === primaryIndex : index === 0 }));
}

function validateProviders(providers: ProviderDraft[]) {
    if (!providers.length) return "至少保留一个 API 平台";
    const seen = new Set<string>();
    for (const provider of providers) {
        if (!PROVIDER_ID_RE.test(provider.id)) return `平台 ID 不合法：${provider.id || "-"}`;
        if (seen.has(provider.id)) return `平台 ID 重复：${provider.id}`;
        seen.add(provider.id);
        const baseUrlError = getProviderBaseUrlError(provider);
        if (baseUrlError) return `${provider.name || provider.id}：${baseUrlError}`;
    }
    return "";
}

function getProviderBaseUrlError(provider: Pick<ProviderDraft, "base_url">) {
    const value = normalizeApiBaseUrl(provider.base_url);
    if (!value) return "请先填写 Base URL";
    if (value === "https://" || value === "http://") return "请填写完整 Base URL，不要只保留协议头";
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "Base URL 只支持 http 或 https";
        if (!url.hostname.includes(".") && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return "Base URL 看起来不完整";
        return "";
    } catch {
        return "Base URL 格式不正确";
    }
}

function getProviderActionError(provider: Pick<ProviderDraft, "base_url" | "api_key" | "has_key">, options: { allowMissingKey?: boolean } = {}) {
    const baseUrlError = getProviderBaseUrlError(provider);
    if (baseUrlError) return `${baseUrlError}；也可以先只保存手动模型。`;
    if (!options.allowMissingKey && !provider.has_key && !provider.api_key?.trim()) return "当前平台还没有 API Key。请先粘贴 Key 并保存，或只维护手动模型。";
    return "";
}

function normalizeProviderId(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+/, "")
        .slice(0, 49);
}

function nextProviderId(providers: ProviderDraft[]) {
    let index = providers.length + 1;
    let id = "custom-api";
    const used = new Set(providers.map((provider) => provider.id));
    while (used.has(id)) id = `custom-api-${index++}`;
    return id;
}

function pickSelectedId(providers: ProviderDraft[], current: string) {
    if (current && providers.some((provider) => provider.id === current)) return current;
    return providers.find((provider) => provider.primary)?.id || providers[0]?.id || "";
}

function classifyFetchedModels(data: ProviderModelsResponse) {
    const all = normalizeModels(data.all || [...(data.image_models || []), ...(data.chat_models || []), ...(data.video_models || [])]);
    const image = normalizeModels(data.image_models?.length ? data.image_models : all.filter(isImageModel));
    const video = normalizeModels(data.video_models?.length ? data.video_models : all.filter(isVideoModel));
    const known = new Set([...image, ...video]);
    const chat = normalizeModels(data.chat_models?.length ? data.chat_models : all.filter((model) => !known.has(model)));
    return { all, image, chat, video };
}

function isVideoModel(model: string) {
    const value = model.toLowerCase();
    return value.includes("video") || value.includes("sora") || value.includes("veo") || value.includes("seedance") || value.includes("kling") || value.includes("wan");
}

function isImageModel(model: string) {
    const value = model.toLowerCase();
    return !isVideoModel(model) && (value.includes("image") || value.includes("gpt-image") || value.includes("banana") || value.includes("dall") || value.includes("seedream") || value.includes("flux"));
}

function providerModelLabel(provider: ProviderDraft, model: string) {
    if (!model || model === "-") return "-";
    return `${provider.name || provider.id} / ${model}`;
}

function broadcastProvidersChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("providers-changed"));
    try {
        const channel = new BroadcastChannel("studio-api");
        channel.postMessage({ type: "providers-changed", source: "api-settings" });
        channel.close();
    } catch {
        // BroadcastChannel is only a live refresh hint; saved providers remain authoritative on disk.
    }
}
