"use client";

import { Alert, Button, Input, Tag } from "antd";
import { Archive, CheckCircle2, Code2, ExternalLink, FolderOpen, RefreshCcw, RotateCw, Server, ShieldCheck, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { APP_VERSION } from "@/constant/env";

type AppInfo = {
    version?: string;
    backend_port?: number;
    mode?: string;
    update_check_url?: string;
    update_capability?: Record<string, unknown>;
    app_actions?: Record<string, unknown>;
    entry?: { api_port?: string };
};

type UpdateAsset = {
    name?: string;
    type?: string;
    url?: string;
    size?: number;
    sha256?: string;
};

type ReleaseAssetManifest = {
    windows_installer?: UpdateAsset | null;
    desktop_zip?: UpdateAsset | null;
    macos_zip?: UpdateAsset | null;
    sha256_files?: UpdateAsset[];
    all?: UpdateAsset[];
};

type UpdateCheckResult = {
    configured?: boolean;
    ok?: boolean;
    current_version?: string;
    latest_version?: string;
    is_newer?: boolean;
    message?: string;
    download_url?: string;
    notes?: string;
    source_url?: string;
    assets?: UpdateAsset[];
    selected_asset?: UpdateAsset | null;
    release_assets?: ReleaseAssetManifest;
    auto_update_supported?: boolean;
    auto_update_reason?: string;
    update_mode?: string;
    checked_at?: string;
};

type UpdateState = Record<string, unknown>;
type DataHealth = { ok?: boolean; paths?: Record<string, string>; [key: string]: unknown };
type Diagnostics = { ok?: boolean; checks?: Array<Record<string, unknown>> };
type Preflight = { ok?: boolean; checks?: Array<Record<string, unknown>>; release_assets?: ReleaseAssetManifest; [key: string]: unknown };

const pathLabels: Record<string, string> = {
    data: "数据目录",
    input: "输入目录",
    output: "输出目录",
    thumbs: "缩略图",
    logs: "日志目录",
    cache: "缓存目录",
    backups: "备份目录",
};

export default function AppSettingsPage() {
    const [backendInfo, setBackendInfo] = useState<AppInfo | null>(null);
    const [health, setHealth] = useState<DataHealth | null>(null);
    const [updateState, setUpdateState] = useState<UpdateState | null>(null);
    const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
    const [preflight, setPreflight] = useState<Preflight | null>(null);
    const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
    const [statusError, setStatusError] = useState("");
    const [checking, setChecking] = useState(false);
    const [action, setAction] = useState("");
    const [updateURL, setUpdateURL] = useState("");
    const [isSourceMode, setIsSourceMode] = useState(true);
    const backendPort = backendInfo?.backend_port || backendInfo?.entry?.api_port;
    const releaseAssets = updateCheck?.release_assets || preflight?.release_assets || {};

    const reload = useCallback(async () => {
        setChecking(true);
        try {
            const [info, data, state] = await Promise.all([rawGet<AppInfo>("/api/app/info"), rawGet<DataHealth>("/api/app/local-data-health"), rawGet<UpdateState>("/api/app/update-state")]);
            setBackendInfo(info);
            setHealth(data);
            setUpdateState(state);
            setUpdateURL(String(info.update_check_url || ""));
            setStatusError("");
        } catch (error) {
            setBackendInfo(null);
            setHealth(null);
            setUpdateState(null);
            setStatusError(error instanceof Error ? error.message : "本地服务不可用");
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        setIsSourceMode(window.location.port === "3001");
        void reload();
    }, [reload]);

    const runAction = async (id: string, task: () => Promise<unknown>) => {
        setAction(id);
        try {
            setStatusError("");
            const result = await task();
            if (id === "update-check") {
                setUpdateCheck({ ...(result as UpdateCheckResult), checked_at: new Date().toISOString() });
                setUpdateState(await rawGet<UpdateState>("/api/app/update-state"));
            } else if (id === "update-preflight") {
                setPreflight(result as Preflight);
                setUpdateState(await rawGet<UpdateState>("/api/app/update-state"));
            } else if (id.startsWith("update")) {
                const state = (result as { state?: UpdateState; update_state?: UpdateState })?.state || (result as { update_state?: UpdateState })?.update_state || (await rawGet<UpdateState>("/api/app/update-state"));
                setUpdateState(state);
            }
            if (id === "save-update-url") await reload();
            if (id === "diagnostics") setDiagnostics(result as Diagnostics);
            if (id === "backup") await reload();
        } catch (error) {
            setStatusError(error instanceof Error ? error.message : "操作失败，请稍后重试");
        } finally {
            setAction("");
        }
    };

    const updateChecks = useMemo(() => preflight?.checks || [], [preflight]);

    return (
        <main className="h-full overflow-auto bg-stone-50 p-4 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
            <div className="mx-auto grid w-full max-w-7xl gap-4">
                <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {isSourceMode ? <Code2 className="size-4 text-amber-600" /> : <Server className="size-4 text-emerald-600" />}
                        <strong>{isSourceMode ? "3001 源码测试模式" : "桌面运行模式"}</strong>
                        <Tag className="m-0">前端 {APP_VERSION}</Tag>
                        {backendInfo?.version ? <Tag className="m-0">后端 {backendInfo.version}</Tag> : null}
                        <Tag className="m-0" color={backendInfo ? "green" : "warning"}>{backendInfo ? `本地服务已连接${backendPort ? ` · ${backendPort}` : ""}` : "本地服务未连接"}</Tag>
                    </div>
                    <Button size="small" icon={<RefreshCcw className={checking ? "size-3.5 animate-spin" : "size-3.5"} />} loading={checking} onClick={() => void reload()}>刷新状态</Button>
                </section>

                {statusError ? <Alert type="warning" showIcon message="本地服务提示" description={isSourceMode ? `当前是 3001 源码模式，目录、更新、备份和桌面动作依赖 Go 本地服务。${statusError}` : statusError} /> : null}

                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="grid gap-4">
                        <Panel title="版本与更新" icon={<RotateCw className="size-4" />} id="update">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <Field label="当前运行版本" value={String(updateCheck?.current_version || backendInfo?.version || APP_VERSION)} />
                                <Field label="GitHub 最新版本" value={String(updateCheck?.latest_version || updateState?.latest_version || "等待检查")} />
                                <Field label="运行模式" value={String(backendInfo?.mode || updateCheck?.update_mode || (isSourceMode ? "source" : "desktop"))} />
                                <Field label="检查时间" value={formatTime(updateCheck?.checked_at)} />
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <Field label="桌面更新包" value={assetName(updateCheck?.selected_asset) || assetName(releaseAssets.desktop_zip) || "等待检查"} />
                                <Field label="自动更新能力" value={updateCheck ? updateCapabilitySummary(updateCheck) : capabilityText(backendInfo?.update_capability)} />
                            </div>

                            <ReleaseAssetStrip releaseAssets={releaseAssets} />

                            {isSourceMode ? (
                                <Alert
                                    className="mt-4"
                                    type="info"
                                    showIcon
                                    message="源码模式不会自动替换桌面程序"
                                    description="当前 3001 入口适合验证页面和接口。检查更新可以显示版本与资产状态，但自动安装只在打包后的桌面版中执行。"
                                />
                            ) : null}

                            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                                <Input value={updateURL} onChange={(event) => setUpdateURL(event.target.value)} placeholder="更新检查地址" className="min-h-11" />
                                <Button className="min-h-11" loading={action === "save-update-url"} onClick={() => runAction("save-update-url", () => rawPost("/api/app/update-settings", { update_check_url: updateURL }))}>保存地址</Button>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button icon={<RefreshCcw className="size-4" />} loading={action === "update-check"} onClick={() => runAction("update-check", () => rawGet("/api/app/update-check"))}>检查更新</Button>
                                <Button icon={<ShieldCheck className="size-4" />} loading={action === "update-preflight"} onClick={() => runAction("update-preflight", () => rawGet("/api/app/update-preflight"))}>安装前检查</Button>
                                <Button icon={<RotateCw className="size-4" />} loading={action === "update-auto"} onClick={() => runAction("update-auto", () => rawPost("/api/app/update-auto"))}>自动升级</Button>
                                <Button icon={<Trash2 className="size-4" />} loading={action === "update-cleanup"} onClick={() => runAction("update-cleanup", () => rawPost("/api/app/update-cleanup"))}>清理半包</Button>
                            </div>
                            {updateCheck?.message && !updateCheck.is_newer ? <Alert className="mt-4" type="success" showIcon message={updateCheck.message} /> : null}
                            {updateState?.error ? <Alert className="mt-4" type="warning" showIcon message="更新未执行" description={String(updateState.error)} /> : null}
                            {updateChecks.length ? (
                                <div className="mt-4 grid gap-2 md:grid-cols-2">
                                    {updateChecks.map((item) => <StatusRow key={String(item.id || item.label)} item={item} />)}
                                </div>
                            ) : null}
                        </Panel>

                        <Panel title="本地数据" icon={<FolderOpen className="size-4" />}>
                            <div className="grid gap-3 md:grid-cols-2">
                                {Object.entries(pathLabels).map(([key, label]) => <Field key={key} label={label} value={health?.paths?.[key] || "-"} mono />)}
                            </div>
                        </Panel>
                    </div>

                    <aside className="grid content-start gap-4">
                        <Panel title="诊断" icon={<CheckCircle2 className="size-4" />}>
                            <Button block className="min-h-11" loading={action === "diagnostics"} onClick={() => runAction("diagnostics", () => rawGet("/api/app/diagnostics"))}>运行诊断</Button>
                            <div className="mt-3 grid gap-2">
                                {(diagnostics?.checks || []).map((item) => <StatusRow key={String(item.id || item.label)} item={item} />)}
                                {!diagnostics?.checks?.length ? <p className="m-0 text-sm text-stone-500">等待诊断。</p> : null}
                            </div>
                        </Panel>

                        <Panel title="轻量备份" icon={<Archive className="size-4" />}>
                            <div className="grid gap-2">
                                <Button block className="min-h-11" loading={action === "backup"} onClick={() => runAction("backup", () => rawPost("/api/app/backup-create"))}>创建备份</Button>
                                <Button block className="min-h-11" onClick={() => runAction("backups", () => rawGet("/api/app/backups"))}>刷新备份</Button>
                            </div>
                        </Panel>

                        <Panel title="桌面动作" icon={<ExternalLink className="size-4" />}>
                            <div className="grid gap-2">
                                <Button block className="min-h-11" onClick={() => runAction("restart", () => rawPost("/api/app/restart"))}>重启应用</Button>
                                <Button block danger className="min-h-11" onClick={() => runAction("exit", () => rawPost("/api/app/exit"))}>退出应用</Button>
                            </div>
                        </Panel>
                    </aside>
                </section>
            </div>
        </main>
    );
}

function ReleaseAssetStrip({ releaseAssets }: { releaseAssets: ReleaseAssetManifest }) {
    const rows = [
        { label: "Windows 安装器", asset: releaseAssets.windows_installer },
        { label: "桌面 zip", asset: releaseAssets.desktop_zip },
        { label: "macOS zip", asset: releaseAssets.macos_zip },
        { label: "SHA256", asset: releaseAssets.sha256_files?.[0], count: releaseAssets.sha256_files?.length || 0 },
    ];
    return (
        <div className="mt-3 grid gap-2 md:grid-cols-4">
            {rows.map((row) => (
                <div key={row.label} className="min-w-0 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs text-stone-500">{row.label}</span>
                        <Tag className="m-0" color={row.asset ? "green" : "warning"}>{row.asset ? "可用" : "缺失"}</Tag>
                    </div>
                    <div className="truncate text-xs font-medium" title={row.asset?.name || ""}>{row.count ? `${row.count} 个校验文件` : assetName(row.asset) || "等待检查"}</div>
                </div>
            ))}
        </div>
    );
}

function Panel({ title, icon, children, id }: { title: string; icon: ReactNode; children: ReactNode; id?: string }) {
    return (
        <section id={id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">{icon}<span>{title}</span></div>
            {children}
        </section>
    );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return <div className="min-w-0 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800"><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 truncate text-sm ${mono ? "font-mono" : "font-medium"}`} title={value}>{value}</div></div>;
}

function StatusRow({ item }: { item: Record<string, unknown> }) {
    const ok = Boolean(item.ok) || item.status === "ok";
    return <div className="rounded-md border border-stone-200 px-3 py-2 text-sm dark:border-stone-800"><div className="flex items-center justify-between gap-2"><span className="font-medium">{String(item.label || item.id || "检查项")}</span><Tag className="m-0" color={ok ? "green" : "warning"}>{ok ? "通过" : "注意"}</Tag></div>{item.detail ? <p className="m-0 mt-1 break-all text-xs text-stone-500">{String(item.detail)}</p> : null}</div>;
}

function capabilityText(value?: Record<string, unknown>) {
    if (!value) return "-";
    if (value.supported) return "可用";
    return String(value.reason || value.mode || "不可用");
}

function updateCapabilitySummary(check: UpdateCheckResult) {
    if (check.auto_update_supported) return "可直接自动升级";
    return check.auto_update_reason || check.update_mode || "当前环境不可自动升级";
}

function assetName(asset?: UpdateAsset | null) {
    return String(asset?.name || "").trim();
}

function formatTime(value?: string) {
    if (!value) return "等待检查";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function rawGet<T>(url: string): Promise<T> {
    return rawRequest<T>(url, { method: "GET" });
}

async function rawPost<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
    return rawRequest<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
}

async function rawRequest<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) throw new Error(String(payload?.detail || payload?.message || payload?.msg || `HTTP ${response.status}`));
    return payload as T;
}
