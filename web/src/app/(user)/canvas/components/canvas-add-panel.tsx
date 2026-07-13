import type { CSSProperties, ReactNode } from "react";
import { BookOpen, FileText, History, Image as ImageIcon, Library, Music2, Palette, Settings2, Sparkles, Upload, UserRound, Video } from "lucide-react";

import type { CanvasTheme } from "@/lib/canvas-theme";

type CanvasAddPanelProps = {
    theme: CanvasTheme;
    left: number | string;
    onClose: () => void;
    onAddText: () => void;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddConfig: () => void;
    onAddRole: () => void;
    onAddStyle: () => void;
    onAddEffect: () => void;
    onAddScript: () => void;
    onUpload: () => void;
    onOpenHistory: () => void;
    onOpenLibrary: () => void;
};

export function CanvasAddPanel({
    theme,
    left,
    onClose,
    onAddText,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddConfig,
    onAddRole,
    onAddStyle,
    onAddEffect,
    onAddScript,
    onUpload,
    onOpenHistory,
    onOpenLibrary,
}: CanvasAddPanelProps) {
    const panelStyle = {
        "--canvas-panel-left": typeof left === "number" ? `${left}px` : left,
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.item,
    } as CSSProperties;
    const run = (action: () => void) => {
        action();
        onClose();
    };

    return (
        <div
            className="pointer-events-auto absolute bottom-[140px] left-1/2 z-30 w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-lg border shadow-xl backdrop-blur sm:bottom-[72px] sm:left-[var(--canvas-panel-left)]"
            style={panelStyle}
            role="dialog"
            aria-label="添加到画布"
        >
            <AddSection title="基础节点">
                <AddButton label="文本" icon={<FileText className="size-4" />} theme={theme} onClick={() => run(onAddText)} />
                <AddButton label="图片" icon={<ImageIcon className="size-4" />} theme={theme} onClick={() => run(onAddImage)} />
                <AddButton label="视频" icon={<Video className="size-4" />} theme={theme} onClick={() => run(onAddVideo)} />
                <AddButton label="音频" icon={<Music2 className="size-4" />} theme={theme} onClick={() => run(onAddAudio)} />
                <AddButton label="生成配置" icon={<Settings2 className="size-4" />} theme={theme} onClick={() => run(onAddConfig)} />
            </AddSection>

            <AddSection title="创作资源">
                <AddButton label="角色设定" icon={<UserRound className="size-4" />} theme={theme} onClick={() => run(onAddRole)} />
                <AddButton label="风格参考" icon={<Palette className="size-4" />} theme={theme} onClick={() => run(onAddStyle)} />
                <AddButton label="特效要求" icon={<Sparkles className="size-4" />} theme={theme} onClick={() => run(onAddEffect)} />
                <AddButton label="分镜脚本" icon={<BookOpen className="size-4" />} theme={theme} onClick={() => run(onAddScript)} />
            </AddSection>

            <AddSection title="素材来源" last>
                <AddButton label="上传素材" icon={<Upload className="size-4" />} theme={theme} onClick={() => run(onUpload)} />
                <AddButton label="生成历史" icon={<History className="size-4" />} theme={theme} onClick={() => run(onOpenHistory)} />
                <AddButton label="素材库" icon={<Library className="size-4" />} theme={theme} onClick={() => run(onOpenLibrary)} />
            </AddSection>
        </div>
    );
}

function AddSection({ title, last = false, children }: { title: string; last?: boolean; children: ReactNode }) {
    return (
        <section className={last ? "p-3" : "border-b p-3"} style={{ borderColor: "color-mix(in srgb, currentColor 14%, transparent)" }}>
            <div className="mb-2 px-1 text-xs font-medium opacity-55">{title}</div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">{children}</div>
        </section>
    );
}

function AddButton({ label, icon, theme, onClick }: { label: string; icon: ReactNode; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button
            type="button"
            className="flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border px-1.5 py-2 text-center text-xs font-medium transition hover:-translate-y-0.5"
            style={{ background: theme.node.fill, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
            onClick={onClick}
        >
            <span className="flex size-7 items-center justify-center rounded-md" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                {icon}
            </span>
            <span className="w-full truncate">{label}</span>
        </button>
    );
}
