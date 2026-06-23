import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { APP_VERSION } from "@/constant/env";
import type { ReleaseInfo } from "@/lib/release";

function readLocalReleases(): ReleaseInfo[] {
    try {
        return JSON.parse(process.env.NEXT_PUBLIC_APP_RELEASES || "[]");
    } catch {
        return [];
    }
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export type UpdateAsset = {
    name?: string;
    type?: string;
    url?: string;
    size?: number;
    sha256?: string;
};

export type UpdateCheckResult = {
    configured?: boolean;
    ok?: boolean;
    current_version?: string;
    latest_version?: string;
    is_newer?: boolean;
    message?: string;
    download_url?: string;
    release_notes?: string;
    notes?: string;
    source_url?: string;
    assets?: UpdateAsset[];
    selected_asset?: UpdateAsset | null;
    release_assets?: {
        windows_installer?: UpdateAsset | null;
        desktop_zip?: UpdateAsset | null;
        macos_zip?: UpdateAsset | null;
        sha256_files?: UpdateAsset[];
        all?: UpdateAsset[];
    };
    auto_update_supported?: boolean;
    auto_update_reason?: string;
    update_mode?: string;
    checked_at?: string;
};

async function fetchUpdateCheck() {
    const response = await fetch("/api/app/update-check", { cache: "no-store" });
    if (!response.ok) throw new Error("版本读取失败");
    return (await response.json()) as UpdateCheckResult;
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [latestCheck, setLatestCheck] = useState<UpdateCheckResult | null>(null);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const applyCheckResult = useCallback(
        (data: UpdateCheckResult) => {
            const checked = { ...data, checked_at: new Date().toISOString() };
            const version = data.is_newer ? data.latest_version?.trim() : data.latest_version?.trim() || currentVersion;
            setLatestVersion(version || currentVersion);
            setLatestCheck(checked);
            setReleases(localReleases);
            return checked;
        },
        [currentVersion, localReleases],
    );

    const checkLatestVersion = useCallback(async () => {
        try {
            applyCheckResult(await fetchUpdateCheck());
            return true;
        } catch {
            return false;
        }
    }, [applyCheckResult]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const data = applyCheckResult(await fetchUpdateCheck());
                if (showMessage) message.success("已获取最新版本信息");
                return data;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error("获取最新版本信息失败");
                return null;
            } finally {
                setChecking(false);
            }
        },
        [applyCheckResult, currentVersion, localReleases, message],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        latestCheck,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
