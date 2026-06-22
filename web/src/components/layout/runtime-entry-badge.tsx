"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

type RuntimeEntryBadgeProps = {
    className?: string;
    style?: CSSProperties;
};

export function RuntimeEntryBadge({ className, style }: RuntimeEntryBadgeProps) {
    const [origin, setOrigin] = useState("");
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

    useEffect(() => {
        setOrigin(`${window.location.hostname}${window.location.port ? `:${window.location.port}` : ""}`);
    }, []);

    const label = origin.includes(":3001") ? "测试 3001" : origin || "本地";

    return (
        <span
            className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium opacity-75", className)}
            style={style}
            title={origin ? `当前入口：${origin}` : "当前入口"}
        >
            {label} · v{appVersion}
        </span>
    );
}
