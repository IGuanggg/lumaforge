"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { importV21LegacyData } from "@/services/api/migration";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const V21_MIGRATION_MARKER = "lumaforge:v21_migration_done";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const canvasHydrated = useCanvasStore((state) => state.hydrated);
    const importProject = useCanvasStore((state) => state.importProject);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        const reloadPublicSettings = () => {
            void loadPublicSettings();
        };
        let channel: BroadcastChannel | null = null;
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
            channel = new BroadcastChannel("studio-api");
            channel.onmessage = (event) => {
                if (event.data?.type === "providers-changed") reloadPublicSettings();
            };
        }
        window.addEventListener("providers-changed", reloadPublicSettings);
        return () => {
            window.removeEventListener("providers-changed", reloadPublicSettings);
            channel?.close();
        };
    }, [loadPublicSettings]);

    useEffect(() => {
        if (!isLoginPage) void hydrateUser();
    }, [hydrateUser, isLoginPage]);

    useEffect(() => {
        if (!canvasHydrated || isLoginPage) return;
        if (window.localStorage.getItem(V21_MIGRATION_MARKER)) return;
        let cancelled = false;
        void importV21LegacyData()
            .then((data) => {
                if (cancelled) return;
                const existingLegacyIds = new Set(
                    useCanvasStore
                        .getState()
                        .projects.map((project) => project.metadata?.legacyId)
                        .filter((id): id is string => Boolean(id)),
                );
                let imported = 0;
                for (const project of data.projects || []) {
                    const legacyId = project.metadata?.legacyId;
                    if (legacyId && existingLegacyIds.has(legacyId)) continue;
                    importProject(project);
                    if (legacyId) existingLegacyIds.add(legacyId);
                    imported += 1;
                }
                window.localStorage.setItem(V21_MIGRATION_MARKER, new Date().toISOString());
                if (imported > 0) message.success(`已导入 ${imported} 个旧版画布`);
            })
            .catch((error) => {
                if (cancelled) return;
                window.localStorage.setItem(`${V21_MIGRATION_MARKER}:last_error`, error instanceof Error ? error.message : String(error));
                console.warn("LumaForge v2.1 migration skipped", error);
            });
        return () => {
            cancelled = true;
        };
    }, [canvasHydrated, importProject, isLoginPage, message]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;
}
