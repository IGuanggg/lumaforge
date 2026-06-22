"use client";

import { Alert, Button, Tag } from "antd";
import { Code2, RefreshCcw, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { APP_VERSION } from "@/constant/env";
import { useThemeStore } from "@/stores/use-theme-store";

type AppInfo = {
    version?: string;
    backend_port?: number;
    mode?: string;
};

export default function AppSettingsPage() {
    const theme = useThemeStore((state) => state.theme);
    const [section, setSection] = useState("");
    const [backendInfo, setBackendInfo] = useState<AppInfo | null>(null);
    const [statusError, setStatusError] = useState("");
    const [checking, setChecking] = useState(false);
    const [isSourceMode, setIsSourceMode] = useState(true);
    const iframeSrc = useMemo(() => {
        const params = new URLSearchParams({ embedded: "1", theme });
        if (section) params.set("section", section);
        return `/static/app-settings.html?${params.toString()}`;
    }, [section, theme]);

    const checkBackend = useCallback(async () => {
        setChecking(true);
        try {
            const response = await fetch("/api/app/info", { cache: "no-store" });
            if (!response.ok) throw new Error(`本地服务返回 HTTP ${response.status}`);
            setBackendInfo((await response.json()) as AppInfo);
            setStatusError("");
        } catch (error) {
            setBackendInfo(null);
            setStatusError(error instanceof Error ? error.message : "本地服务不可用");
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        const syncHash = () => setSection(window.location.hash.replace(/^#/, ""));
        setIsSourceMode(window.location.port === "3001");
        syncHash();
        window.addEventListener("hashchange", syncHash);
        return () => window.removeEventListener("hashchange", syncHash);
    }, []);

    useEffect(() => {
        void checkBackend();
    }, [checkBackend]);

    return (
        <main className="flex h-[calc(100vh-4rem)] min-h-[760px] flex-col gap-3 bg-stone-50 p-4 dark:bg-stone-950">
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isSourceMode ? <Code2 className="size-4 text-amber-600" /> : <Server className="size-4 text-emerald-600" />}
                    <strong>{isSourceMode ? "3001 源码测试模式" : "桌面运行模式"}</strong>
                    <Tag className="m-0">前端 {APP_VERSION}</Tag>
                    {backendInfo?.version ? <Tag className="m-0">后端 {backendInfo.version}</Tag> : null}
                    <Tag className="m-0" color={backendInfo ? "green" : "warning"}>{backendInfo ? `本地服务已连接${backendInfo.backend_port ? ` · ${backendInfo.backend_port}` : ""}` : "本地服务未连接"}</Tag>
                </div>
                <Button size="small" icon={<RefreshCcw className={checking ? "size-3.5 animate-spin" : "size-3.5"} />} loading={checking} onClick={() => void checkBackend()}>重试检测</Button>
            </section>
            {statusError ? (
                <Alert
                    type="warning"
                    showIcon
                    title="应用设置只能显示前端内容，部分操作暂不可用"
                    description={isSourceMode ? `当前是 3001 源码模式，目录、更新、重启和系统保存窗口依赖本地后端。${statusError}` : statusError}
                />
            ) : null}
            <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <iframe title="应用设置" src={iframeSrc} className="h-full w-full border-0" />
            </section>
        </main>
    );
}
