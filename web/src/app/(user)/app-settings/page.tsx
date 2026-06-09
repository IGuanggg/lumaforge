"use client";

import { useEffect, useMemo, useState } from "react";

import { useThemeStore } from "@/stores/use-theme-store";

export default function AppSettingsPage() {
    const theme = useThemeStore((state) => state.theme);
    const [section, setSection] = useState("");
    const iframeSrc = useMemo(() => {
        const params = new URLSearchParams({ embedded: "1", theme });
        if (section) params.set("section", section);
        return `/static/app-settings.html?${params.toString()}`;
    }, [section, theme]);

    useEffect(() => {
        const syncHash = () => setSection(window.location.hash.replace(/^#/, ""));
        syncHash();
        window.addEventListener("hashchange", syncHash);
        return () => window.removeEventListener("hashchange", syncHash);
    }, []);

    return (
        <main className="h-[calc(100vh-4rem)] min-h-[760px] bg-stone-50 p-4 dark:bg-stone-950">
            <section className="h-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <iframe title="应用设置" src={iframeSrc} className="h-full w-full border-0" />
            </section>
        </main>
    );
}
