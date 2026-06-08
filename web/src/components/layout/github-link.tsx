"use client";

import { GithubOutlined } from "@ant-design/icons";
import type { CSSProperties, MouseEvent } from "react";

import { cn } from "@/lib/utils";

const GITHUB_URL = "https://github.com/IGuanggg/lumaforge";

type GitHubLinkProps = {
    className?: string;
    style?: CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    const openExternal = async (event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            const response = await fetch("/api/app/open-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: GITHUB_URL }),
            });
            if (response.ok) return;
        } catch {
            // Browser builds may not expose the desktop open-url bridge.
        }
        window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
    };

    return (
        <a
            className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white", className)}
            style={style}
            href={GITHUB_URL}
            onClick={openExternal}
            onAuxClick={openExternal}
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
        >
            <GithubOutlined className="text-base" />
        </a>
    );
}
