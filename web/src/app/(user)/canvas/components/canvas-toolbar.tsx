import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import { CircleDot, Eraser, Eye, EyeOff, FolderOpen, Grid2x2, Group, Hand, Image as ImageIcon, Info, LayoutGrid, Library, Magnet, Moon, Music2, Palette, Plus, Redo2, Settings2, Square, Sun, Trash2, Type, Undo2, Ungroup, Upload, Video } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasAddPanel } from "./canvas-add-panel";

const TEXT = {
    moveSelect: "\u79fb\u52a8/\u9009\u62e9",
    undo: "\u64a4\u9500",
    redo: "\u91cd\u505a",
    text: "\u6587\u672c",
    image: "\u56fe\u7247",
    video: "\u89c6\u9891",
    audio: "\u97f3\u9891",
    config: "\u751f\u6210\u914d\u7f6e",
    upload: "\u4e0a\u4f20\u7d20\u6750",
    library: "\u7d20\u6750\u5e93",
    myAssets: "\u6211\u7684\u7d20\u6750",
    appearance: "\u753b\u5e03\u5916\u89c2",
    add: "\u6dfb\u52a0\u5230\u753b\u5e03",
    group: "\u6253\u7ec4",
    ungroup: "\u53d6\u6d88\u6253\u7ec4",
    deleteSelected: "\u5220\u9664\u9009\u4e2d",
    clearCanvas: "\u6e05\u7a7a\u753b\u5e03",
    themeMode: "\u4e3b\u9898\u6a21\u5f0f",
    light: "\u6d45\u8272",
    dark: "\u6df1\u8272",
    gridStyle: "\u7f51\u683c\u6837\u5f0f",
    dots: "\u70b9",
    lines: "\u7ebf",
    blank: "\u7a7a\u767d",
    imageInfo: "\u56fe\u7247\u4fe1\u606f",
    showConnections: "\u663e\u793a\u8fde\u7ebf",
    snapToGrid: "\u7f51\u683c\u5438\u9644",
    autoArrange: "\u81ea\u52a8\u6574\u7406\u753b\u5e03",
    switchTo: "\u5207\u6362\u5230",
    theme: "\u4e3b\u9898",
};

export function CanvasToolbar({
    selectedCount,
    isSelectionGrouped = false,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    showConnections,
    snapToGrid,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddRole,
    onAddStyle,
    onAddEffect,
    onAddScript,
    onUndo,
    onRedo,
    onUpload,
    onGroup,
    onUngroup,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onShowConnectionsChange,
    onSnapToGridChange,
    onAutoArrange,
    onOpenAssetLibrary,
    onOpenMyAssets,
    onOpenHistory,
}: {
    selectedCount: number;
    isSelectionGrouped?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    showConnections: boolean;
    snapToGrid: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddRole: () => void;
    onAddStyle: () => void;
    onAddEffect: () => void;
    onAddScript: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onGroup: () => void;
    onUngroup?: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onShowConnectionsChange: (show: boolean) => void;
    onSnapToGridChange: (snap: boolean) => void;
    onAutoArrange: () => void;
    onOpenAssetLibrary: () => void;
    onOpenMyAssets: () => void;
    onOpenHistory: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered, isSelectionGrouped) : "";
    const groupLabel = isSelectionGrouped ? TEXT.ungroup : TEXT.group;

    return (
        <div className="pointer-events-none absolute bottom-5 left-3 right-3 z-50 flex justify-center sm:left-[300px] sm:right-4">
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div ref={wrapRef} className="thin-scrollbar pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton id="tool-hand" label={TEXT.moveSelect} active={!selectedCount} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDeselect}>
                    <Hand className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-undo" label={TEXT.undo} disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label={TEXT.redo} disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-add"
                    label={TEXT.add}
                    active={addOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                        setAppearanceOpen(false);
                        setAddOpen((value) => !value);
                    }}
                >
                    <Plus className="size-5" />
                </ToolbarButton>
                <ToolbarButton id="tool-text" label={TEXT.text} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddText}>
                    <Type className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-image" label={TEXT.image} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddImage}>
                    <ImageIcon className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-video" label={TEXT.video} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddVideo}>
                    <Video className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-audio" label={TEXT.audio} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddAudio}>
                    <Music2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-config" label={TEXT.config} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddConfig}>
                    <Settings2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-upload" label={TEXT.upload} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUpload}>
                    <Upload className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-library" label={TEXT.library} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onOpenAssetLibrary}>
                    <Library className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-assets" label={TEXT.myAssets} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onOpenMyAssets}>
                    <FolderOpen className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-style"
                    label={TEXT.appearance}
                    active={appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                        setAddOpen(false);
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        {selectedCount > 1 ? (
                            <ToolbarButton id="tool-group" label={groupLabel} active={isSelectionGrouped} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={isSelectionGrouped ? onUngroup : onGroup}>
                                {isSelectionGrouped ? <Ungroup className="size-4.5" /> : <Group className="size-4.5" />}
                            </ToolbarButton>
                        ) : null}
                        <ToolbarButton id="tool-delete" label={TEXT.deleteSelected} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-clear" label={TEXT.clearCanvas} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                    <Eraser className="size-4.5" />
                </ToolbarButton>
            </div>

            {addOpen ? (
                <CanvasAddPanel
                    theme={theme}
                    left={panelX || "50%"}
                    onClose={() => setAddOpen(false)}
                    onAddText={onAddText}
                    onAddImage={onAddImage}
                    onAddVideo={onAddVideo}
                    onAddAudio={onAddAudio}
                    onAddConfig={onAddConfig}
                    onAddRole={onAddRole}
                    onAddStyle={onAddStyle}
                    onAddEffect={onAddEffect}
                    onAddScript={onAddScript}
                    onUpload={onUpload}
                    onOpenHistory={onOpenHistory}
                    onOpenLibrary={onOpenAssetLibrary}
                />
            ) : null}

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[140px] left-1/2 z-30 w-[min(248px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur sm:bottom-[72px] sm:left-[var(--canvas-panel-left)]"
                    style={{ "--canvas-panel-left": panelX ? `${panelX}px` : "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item } as CSSProperties}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">{TEXT.appearance}</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{TEXT.themeMode}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            {TEXT.light}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            {TEXT.dark}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{TEXT.gridStyle}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />
                                        {TEXT.dots}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />
                                        {TEXT.lines}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {TEXT.blank}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {TEXT.imageInfo}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} aria-label={TEXT.imageInfo} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            {showConnections ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                            {TEXT.showConnections}
                        </span>
                        <Switch size="small" checked={showConnections} onChange={onShowConnectionsChange} aria-label={TEXT.showConnections} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Magnet className="size-3.5" />
                            {TEXT.snapToGrid}
                        </span>
                        <Switch size="small" checked={snapToGrid} onChange={onSnapToGridChange} aria-label={TEXT.snapToGrid} />
                    </div>
                    <Button className="mt-2 w-full" icon={<LayoutGrid className="size-4" />} onClick={onAutoArrange}>
                        {TEXT.autoArrange}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Button
            type="text"
            aria-label={label}
            className="!h-8 !w-8 !min-w-8 !p-0"
            disabled={disabled}
            style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "#f87171" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const targetLabel = targetTheme === "dark" ? TEXT.dark : TEXT.light;

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={`${TEXT.switchTo}${targetLabel}${TEXT.theme}`}
            title={`${TEXT.switchTo}${targetLabel}${TEXT.theme}`}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string, isSelectionGrouped: boolean) {
    if (id === "tool-hand") return TEXT.moveSelect;
    if (id === "tool-undo") return TEXT.undo;
    if (id === "tool-redo") return TEXT.redo;
    if (id === "tool-add") return TEXT.add;
    if (id === "tool-text") return TEXT.text;
    if (id === "tool-image") return TEXT.image;
    if (id === "tool-video") return TEXT.video;
    if (id === "tool-audio") return TEXT.audio;
    if (id === "tool-config") return TEXT.config;
    if (id === "tool-upload") return TEXT.upload;
    if (id === "tool-library") return TEXT.library;
    if (id === "tool-assets") return TEXT.myAssets;
    if (id === "tool-style") return TEXT.appearance;
    if (id === "tool-group") return isSelectionGrouped ? TEXT.ungroup : TEXT.group;
    if (id === "tool-delete") return TEXT.deleteSelected;
    if (id === "tool-clear") return TEXT.clearCanvas;
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
