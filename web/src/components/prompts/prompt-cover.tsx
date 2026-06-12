"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { Prompt } from "@/services/api/prompts";

export function isUsablePromptCover(url: string) {
    const value = url.trim();
    return Boolean(value) && !value.includes("/main//") && /^(https?:|data:image\/|blob:|\/)/.test(value);
}

export function PromptCover({ item, className, imageClassName, fallbackClassName, onUnavailable }: { item: Prompt; className?: string; imageClassName?: string; fallbackClassName?: string; onUnavailable?: (id: string) => void }) {
    const [failed, setFailed] = useState(false);
    const src = item.coverUrl?.trim() || "";
    const canLoad = !failed && isUsablePromptCover(src);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (canLoad) {
        return (
            <img
                src={src}
                alt=""
                className={cn(className, imageClassName)}
                onError={() => {
                    setFailed(true);
                    onUnavailable?.(item.id);
                }}
            />
        );
    }

    return (
        <div className={cn("flex items-center justify-center bg-[linear-gradient(135deg,#101828_0%,#293241_48%,#3d4a5c_100%)]", className, fallbackClassName)}>
            <span className="rounded border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70">封面同步中</span>
        </div>
    );
}
