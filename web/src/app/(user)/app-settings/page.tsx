"use client";

import { useMemo } from "react";

import { useThemeStore } from "@/stores/use-theme-store";

export default function AppSettingsPage() {
    const theme = useThemeStore((state) => state.theme);
    const iframeSrc = useMemo(() => `/static/app-settings.html?embedded=1&theme=${encodeURIComponent(theme)}`, [theme]);

    return (
        <main className="h-[calc(100vh-4rem)] min-h-[760px] bg-stone-50 p-4 dark:bg-stone-950">
            <section className="h-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <iframe title="应用设置" src={iframeSrc} className="h-full w-full border-0" />
            </section>
        </main>
    );
}
