"use client";

import type { CSSProperties } from "react";
import { App, Modal, Tag, Timeline } from "antd";
import { useVersionCheck, type UpdateAsset, type UpdateCheckResult } from "@/hooks/use-version-check";
import { APP_VERSION } from "@/constant/env";

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整" || type === "优化") return "blue";
    if (type === "文档" || type === "发布") return "purple";
    return "default";
}

function getReleaseTitle(version: string) {
    return version === "Unreleased" ? "未发布" : version;
}

function normalizeReleaseVersion(version: string) {
    return version.trim().replace(/^v/i, "");
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { open, setOpen, openReleaseModal, latestVersion, latestCheck, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();
    const { message } = App.useApp();

    const handleCheckUpdate = async () => {
        const data = await checkLatestRelease();
        if (!data) {
            message.error("获取最新版本信息失败");
            return;
        }
        if (!data.configured) {
            message.warning(data.auto_update_reason || data.message || "未配置更新检查地址");
            return;
        }
        if (!data.is_newer) {
            Modal.info({
                title: "当前已是最新版本",
                content: `当前版本：${data.current_version || APP_VERSION}`,
                okText: "知道了",
                centered: true,
            });
            return;
        }
        const latest = data.latest_version || "最新版本";
        const packageName = assetName(data.selected_asset) || "Release 下载页";
        const modeText = data.auto_update_supported ? `可自动下载 ${packageName}。` : data.auto_update_reason || "当前环境不支持自动升级，可在设置页查看下载方式。";
        Modal.confirm({
            title: `发现新版本 ${latest}`,
            content: `当前版本：${data.current_version || APP_VERSION}。${modeText} 是否现在前往更新区？`,
            okText: data.auto_update_supported ? "去升级" : "查看更新",
            cancelText: "稍后",
            centered: true,
            onOk: () => {
                setOpen(false);
                window.location.href = "/app-settings#update";
            },
        });
    };

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title="查看版本更新"
            >
                <span className="relative inline-flex">
                    {APP_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Modal title="版本更新" open={open} width={720} centered footer={null} onCancel={() => setOpen(false)}>
                <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <VersionCard label="当前运行版本" value={latestCheck?.current_version || APP_VERSION} />
                    <VersionCard label="GitHub 最新版本" value={latestVersion} />
                    <VersionCard label="桌面更新包" value={assetName(latestCheck?.selected_asset) || "等待检查"} />
                    <VersionCard label="检查时间" value={formatTime(latestCheck?.checked_at)} />
                </div>

                <div className="mb-5 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-stone-900 dark:text-stone-100">{updateStatusText(latestCheck, hasNewVersion)}</div>
                            <div className="mt-1 break-all text-xs text-stone-500 dark:text-stone-400">{latestCheck?.auto_update_reason || latestCheck?.source_url || "点击检查更新后显示 Release 资产状态。"}</div>
                        </div>
                        <button
                            type="button"
                            className="cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium transition hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
                            onClick={() => void handleCheckUpdate()}
                        >
                            {checking ? "检查中..." : "检查更新"}
                        </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <AssetTag label="Windows" asset={latestCheck?.release_assets?.windows_installer} />
                        <AssetTag label="desktop zip" asset={latestCheck?.release_assets?.desktop_zip} />
                        <AssetTag label="macOS" asset={latestCheck?.release_assets?.macos_zip} />
                        <Tag className="m-0" color={(latestCheck?.release_assets?.sha256_files?.length || 0) > 0 ? "green" : "warning"}>SHA256 {latestCheck?.release_assets?.sha256_files?.length || 0}</Tag>
                    </div>
                </div>

                <div className="max-h-[52vh] overflow-y-auto pr-2">
                    <Timeline
                        items={releases.map((release) => ({
                            content: (
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                                        <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {normalizeReleaseVersion(release.version) === normalizeReleaseVersion(latestVersion) ? <Tag color="green">最新</Tag> : null}
                                            {normalizeReleaseVersion(release.version) === normalizeReleaseVersion(APP_VERSION) ? <Tag>当前</Tag> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 space-y-1.5">
                                        {release.items.map((item, index) => (
                                            <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                    {item.type}
                                                </Tag>
                                                <span className="min-w-0 flex-1">{item.content}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ),
                        }))}
                    />
                </div>
            </Modal>
        </>
    );
}

function VersionCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
            <div className="mt-1 truncate text-sm font-semibold text-stone-950 dark:text-stone-100" title={value}>{value}</div>
        </div>
    );
}

function AssetTag({ label, asset }: { label: string; asset?: UpdateAsset | null }) {
    return <Tag className="m-0" color={asset ? "green" : "warning"}>{label} {asset ? "可用" : "缺失"}</Tag>;
}

function assetName(asset?: UpdateAsset | null) {
    return String(asset?.name || "").trim();
}

function formatTime(value?: string) {
    if (!value) return "等待检查";
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function updateStatusText(check: UpdateCheckResult | null, hasNewVersion: boolean) {
    if (!check) return "等待检查 GitHub Release";
    if (!check.configured) return "未配置更新检查地址";
    if (hasNewVersion) return `发现新版本 ${check.latest_version || ""}`;
    return "当前已是最新版本";
}
