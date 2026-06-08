"use client";

export default function AppSettingsPage() {
    return (
        <main className="h-[calc(100vh-4rem)] min-h-[760px] bg-[#f7f6f2] p-4 dark:bg-stone-950">
            <section className="h-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <iframe title="应用设置" src="/static/app-settings.html?embedded=1" className="h-full w-full border-0" />
            </section>
        </main>
    );
}
