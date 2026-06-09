import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "../types";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const motionPathId = `canvas-connection-motion-${connection.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

    return (
        <g className={`canvas-connection ${active ? "canvas-connection-active" : ""}`}>
            <defs>
                <path id={motionPathId} d={pathD} />
            </defs>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                className="canvas-connection-glow"
                d={pathD}
                stroke={active ? theme.node.activeStroke : theme.node.muted}
                strokeWidth={active ? 5.2 : 4.4}
                strokeOpacity={active ? 0.52 : 0.34}
                fill="none"
                pathLength={120}
                style={{ filter: `drop-shadow(0 0 8px ${theme.node.activeStroke}55)`, pointerEvents: "none" }}
            />
            <path
                className="canvas-connection-core"
                d={pathD}
                stroke={active ? "#ffffff" : theme.node.activeStroke}
                strokeWidth={active ? 2.7 : 2.1}
                strokeOpacity={active ? 1 : 0.78}
                fill="none"
                pathLength={120}
                style={{ filter: active ? `drop-shadow(0 0 7px ${theme.node.activeStroke}99)` : `drop-shadow(0 0 5px ${theme.node.activeStroke}66)`, pointerEvents: "none" }}
            />
            <g className="canvas-connection-dots" style={{ pointerEvents: "none" }}>
                <circle className="canvas-connection-dot" r={active ? 3.8 : 3}>
                    <animateMotion dur={active ? "2.35s" : "3.05s"} begin="0s" repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${motionPathId}`} />
                    </animateMotion>
                </circle>
                <circle className="canvas-connection-dot canvas-connection-dot-hot" r={active ? 2.4 : 1.9}>
                    <animateMotion dur={active ? "2.35s" : "3.05s"} begin="-1.05s" repeatCount="indefinite" rotate="auto">
                        <mpath href={`#${motionPathId}`} />
                    </animateMotion>
                </circle>
            </g>
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return (
        <g className="canvas-connection-preview">
            <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="6" strokeOpacity="0.18" fill="none" />
            <path d={pathD} stroke={theme.node.activeStroke} strokeWidth="2.4" fill="none" strokeDasharray="6,7" pathLength={120} />
        </g>
    );
}
