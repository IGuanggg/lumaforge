"use client";

export default function AppSettingsPage() {
    return (
        <main className="h-[calc(100vh-4rem)] min-h-[760px] bg-background">
            <iframe title="应用设置" src="/static/app-settings.html" className="h-full w-full border-0" />
        </main>
    );
}
