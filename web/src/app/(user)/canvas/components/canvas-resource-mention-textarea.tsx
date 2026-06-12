"use client";

import { forwardRef, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, CSSProperties, MouseEvent, PointerEvent, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { FileText, Image as ImageIcon, Music2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";

type MentionState = {
    start: number;
    query: string;
};

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
    value: string;
    references: CanvasResourceReference[];
    onChange: (value: string) => void;
    onReferenceSelect?: (reference: CanvasResourceReference) => void;
    onSubmit?: () => void;
    containerClassName?: string;
};

export const CanvasResourceMentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function CanvasResourceMentionTextarea({ value, references, onChange, onReferenceSelect, onSubmit, onKeyDown, className, containerClassName, style, ...props }, forwardedRef) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const candidates = useMemo(() => {
        if (!mention) return [];
        const query = mention.query.trim().toLowerCase();
        const selectableReferences = uniqueReferences(references).sort((a, b) => Number(b.active) - Number(a.active));
        if (!query) return selectableReferences;
        return selectableReferences.filter((item) => `${item.label} ${item.title} ${item.kind} ${item.sourceType} ${item.text || ""}`.toLowerCase().includes(query));
    }, [mention, references]);
    const activeReferences = useMemo(() => {
        const seen = new Set<string>();
        return references
            .filter((item) => item.active)
            .filter((item) => {
                if (seen.has(item.label)) return false;
                seen.add(item.label);
                return true;
            })
            .sort((a, b) => b.label.length - a.label.length);
    }, [references]);

    const updateValue = (next: string, selectionStart?: number) => {
        onChange(next);
        if (typeof selectionStart !== "number") return;
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
        });
    };

    const closeMention = () => {
        setMention(null);
        setActiveIndex(0);
    };

    const syncMention = (nextValue: string, cursor: number) => {
        const prefix = nextValue.slice(0, cursor);
        const match = /@([^\s@]*)$/.exec(prefix);
        if (!match || !references.length) {
            closeMention();
            return;
        }
        setMention({ start: cursor - match[1].length - 1, query: match[1] });
        setActiveIndex(0);
    };

    const insertReference = (reference: CanvasResourceReference) => {
        if (!mention) return;
        const textarea = textareaRef.current;
        const end = textarea?.selectionStart ?? value.length;
        const insertText = `@${reference.label} `;
        const next = `${value.slice(0, mention.start)}${insertText}${value.slice(end)}`;
        closeMention();
        onReferenceSelect?.(reference);
        updateValue(next, mention.start + insertText.length);
    };

    const syncOverlayScroll = () => {
        if (!overlayRef.current || !textareaRef.current) return;
        overlayRef.current.scrollTop = textareaRef.current.scrollTop;
        overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    };

    const mergedStyle = {
        ...(style || {}),
        color: activeReferences.length ? "transparent" : style?.color,
        caretColor: style?.color || theme.node.text,
        ...(activeReferences.length ? { background: "transparent", backgroundColor: "transparent" } : {}),
    } as CSSProperties;
    const menu = mention && candidates.length && textareaRef.current ? <MentionMenu textarea={textareaRef.current} references={candidates} activeIndex={Math.min(activeIndex, candidates.length - 1)} theme={theme} onSelect={insertReference} /> : null;

    return (
        <div className={`relative h-full w-full ${containerClassName || ""}`}>
            {activeReferences.length ? (
                <div ref={overlayRef} className={`${className || ""} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words`} style={{ ...style, color: theme.node.text }}>
                    <MentionHighlightText value={value || props.placeholder?.toString() || ""} references={activeReferences} placeholder={!value} />
                </div>
            ) : null}
            <textarea
                {...props}
                ref={(node) => {
                    textareaRef.current = node;
                    if (typeof forwardedRef === "function") forwardedRef(node);
                    else if (forwardedRef) forwardedRef.current = node;
                }}
                value={value}
                className={className}
                style={mergedStyle}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next);
                    syncMention(next, event.target.selectionStart);
                    requestAnimationFrame(syncOverlayScroll);
                }}
                onKeyDown={(event) => {
                    if (mention && candidates.length) {
                        if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveIndex((index) => (index + 1) % candidates.length);
                            return;
                        }
                        if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            insertReference(candidates[Math.min(activeIndex, candidates.length - 1)]);
                            return;
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeMention();
                            return;
                        }
                    }
                    if (event.key === "Enter" && onSubmit && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit();
                        return;
                    }
                    onKeyDown?.(event);
                }}
                onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                    props.onPaste?.(event);
                    if (event.defaultPrevented) return;
                    const text = event.clipboardData.getData("text/plain");
                    if (!text) return;

                    event.preventDefault();
                    const textarea = textareaRef.current;
                    const start = textarea?.selectionStart ?? value.length;
                    const end = textarea?.selectionEnd ?? start;
                    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
                    const cursor = start + text.length;
                    closeMention();
                    updateValue(next, cursor);
                    syncMention(next, cursor);
                    requestAnimationFrame(syncOverlayScroll);
                }}
                onScroll={(event) => {
                    syncOverlayScroll();
                    props.onScroll?.(event);
                }}
                onBlur={(event) => {
                    window.setTimeout(closeMention, 120);
                    props.onBlur?.(event);
                }}
            />
            {menu}
        </div>
    );
});

function MentionHighlightText({ value, references, placeholder }: { value: string; references: CanvasResourceReference[]; placeholder: boolean }) {
    if (placeholder) return <span className="opacity-45">{value}</span>;
    if (!references.length) return <>{value}</>;
    const tokenMap = new Map<string, CanvasResourceReference>();
    references.forEach((reference) => {
        tokenMap.set(reference.label, reference);
        tokenMap.set(`@${reference.label}`, reference);
    });
    const tokens = Array.from(tokenMap.keys()).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
    return (
        <>
            {value.split(pattern).map((part, index) => {
                const reference = tokenMap.get(part);
                return reference ? <MentionToken key={`${part}-${index}`} reference={reference} /> : <span key={`${part}-${index}`}>{part}</span>;
            })}
        </>
    );
}

function MentionToken({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) {
        return (
            <span className="inline-flex h-6 max-w-[160px] translate-y-[3px] items-center gap-1 rounded-md bg-[#2f80ff]/14 px-1 pr-1.5 align-baseline font-medium text-[#2f80ff] ring-1 ring-[#2f80ff]/24">
                <img src={reference.previewUrl} alt="" className="size-4 shrink-0 rounded object-cover" />
                <span className="truncate">{reference.label}</span>
            </span>
        );
    }
    return <span className="rounded-md bg-[#2f80ff]/16 px-1 py-0.5 font-medium text-[#2f80ff] ring-1 ring-[#2f80ff]/24">{reference.label}</span>;
}

function MentionMenu({ textarea, references, activeIndex, theme, onSelect }: { textarea: HTMLTextAreaElement; references: CanvasResourceReference[]; activeIndex: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (reference: CanvasResourceReference) => void }) {
    const selectedRef = useRef(false);
    const rect = textarea.getBoundingClientRect();
    const boundary = textarea.closest(".ant-modal-content")?.getBoundingClientRect() || { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const menuWidth = 256;
    const maxMenuHeight = 224;
    const gap = 6;
    const left = clamp(rect.left, boundary.left + 8, boundary.right - menuWidth - 8);
    const showAbove = rect.bottom + gap + maxMenuHeight > boundary.bottom && rect.top - gap - maxMenuHeight >= boundary.top;
    const top = clamp(showAbove ? rect.top - gap - maxMenuHeight : rect.bottom + gap, boundary.top + 8, boundary.bottom - maxMenuHeight - 8);

    const stopCanvasInteraction = (event: PointerEvent | MouseEvent) => {
        event.stopPropagation();
    };
    const selectReference = (reference: CanvasResourceReference) => {
        if (selectedRef.current) return;
        selectedRef.current = true;
        onSelect(reference);
    };
    const rows = groupedReferenceRows(references);

    return createPortal(
        <div
            data-canvas-resource-mention-menu="true"
            className="fixed z-[120] max-h-56 w-64 overflow-y-auto rounded-xl border p-1 shadow-2xl backdrop-blur-md"
            style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={stopCanvasInteraction}
            onMouseDown={stopCanvasInteraction}
            onClick={(event) => event.stopPropagation()}
        >
            {rows.map((row) =>
                row.type === "header" ? (
                    <div key={row.key} className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide opacity-45">
                        {row.label}
                    </div>
                ) : (
                    <button
                        key={row.reference.id}
                        type="button"
                        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition"
                        style={{ background: row.index === activeIndex ? theme.toolbar.activeBg : "transparent", color: row.index === activeIndex ? theme.toolbar.activeText : theme.node.text }}
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectReference(row.reference);
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectReference(row.reference);
                        }}
                    >
                        <ReferencePreview reference={row.reference} />
                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                                <span className="font-medium">{row.reference.label}</span>
                                <SourceBadge sourceType={row.reference.sourceType} active={row.reference.active} />
                            </span>
                            <span className="block truncate opacity-65">{row.reference.text || row.reference.title}</span>
                        </span>
                    </button>
                ),
            )}
        </div>,
        document.body,
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    if (reference.kind === "video" && reference.previewUrl) return <video src={reference.previewUrl} className="size-9 rounded-md bg-black object-cover" muted preload="metadata" />;
    const Icon = reference.kind === "audio" ? Music2 : reference.kind === "video" ? Video : reference.kind === "image" ? ImageIcon : FileText;
    return (
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-black/10">
            <Icon className="size-4" />
        </span>
    );
}

function SourceBadge({ sourceType, active }: { sourceType: CanvasResourceReference["sourceType"]; active: boolean }) {
    const label = active ? "已输入" : sourceType === "upstream" ? "上游" : sourceType === "asset" ? "素材" : sourceType === "connected" ? "连线" : "手动";
    return <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] leading-none opacity-70">{label}</span>;
}

function groupedReferenceRows(references: CanvasResourceReference[]) {
    const groups = [
        { key: "active", label: "已输入", test: (reference: CanvasResourceReference) => reference.active },
        { key: "connected", label: "连线输入", test: (reference: CanvasResourceReference) => !reference.active && reference.sourceType === "connected" },
        { key: "upstream", label: "上游可用", test: (reference: CanvasResourceReference) => !reference.active && reference.sourceType === "upstream" },
        { key: "asset", label: "我的素材", test: (reference: CanvasResourceReference) => !reference.active && reference.sourceType === "asset" },
        { key: "manual", label: "手动引用", test: (reference: CanvasResourceReference) => !reference.active && reference.sourceType === "manual" },
    ];
    const rows: Array<{ type: "header"; key: string; label: string } | { type: "reference"; reference: CanvasResourceReference; index: number }> = [];
    groups.forEach((group) => {
        const items = references.map((reference, index) => ({ reference, index })).filter((item) => group.test(item.reference));
        if (!items.length) return;
        rows.push({ type: "header", key: group.key, label: group.label });
        items.forEach((item) => rows.push({ type: "reference", ...item }));
    });
    return rows;
}

function uniqueReferences(references: CanvasResourceReference[]) {
    const seen = new Set<string>();
    return references.filter((reference) => {
        const key = [reference.kind, reference.nodeId || reference.assetId || reference.storageKey || reference.url || reference.label].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function clamp(value: number, min: number, max: number) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
