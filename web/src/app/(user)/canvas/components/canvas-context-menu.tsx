"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Download, FolderPlus, Group, Plus, Trash2, Ungroup } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "../types";

const TEXT = {
    duplicateNode: "\u590d\u5236\u8282\u70b9",
    download: "\u4e0b\u8f7d",
    saveAsset: "\u52a0\u5165\u6211\u7684\u7d20\u6750",
    group: "\u6253\u7ec4",
    ungroup: "\u53d6\u6d88\u6253\u7ec4",
    disconnect: "\u65ad\u5f00\u8fde\u7ebf",
    deleteNode: "\u5220\u9664\u8282\u70b9",
};

type CanvasNodeContextMenuProps = {
    menu: ContextMenuState;
    canGroup?: boolean;
    canUngroup?: boolean;
    canDownload?: boolean;
    canSaveAsset?: boolean;
    downloadLabel?: string;
    onClose: () => void;
    onDuplicate: () => void;
    onDownload?: () => void;
    onSaveAsset?: () => void;
    onGroup?: () => void;
    onUngroup?: () => void;
    onDelete: () => void;
};

export function CanvasNodeContextMenu({
    menu,
    canGroup = false,
    canUngroup = false,
    canDownload = false,
    canSaveAsset = false,
    downloadLabel = TEXT.download,
    onClose,
    onDuplicate,
    onDownload,
    onSaveAsset,
    onGroup,
    onUngroup,
    onDelete,
}: CanvasNodeContextMenuProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={TEXT.duplicateNode} onClick={onDuplicate} /> : null}
            {menu.type === "node" && canDownload ? <MenuButton icon={<Download className="size-4" />} label={downloadLabel} onClick={onDownload} /> : null}
            {menu.type === "node" && canSaveAsset ? <MenuButton icon={<FolderPlus className="size-4" />} label={TEXT.saveAsset} onClick={onSaveAsset} /> : null}
            {menu.type === "node" && canGroup ? <MenuButton icon={<Group className="size-4" />} label={TEXT.group} onClick={onGroup} /> : null}
            {menu.type === "node" && canUngroup ? <MenuButton icon={<Ungroup className="size-4" />} label={TEXT.ungroup} onClick={onUngroup} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={menu.type === "connection" ? TEXT.disconnect : TEXT.deleteNode} onClick={onDelete} danger />
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
