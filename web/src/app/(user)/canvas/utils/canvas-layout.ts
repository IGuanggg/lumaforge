import type { CanvasConnection, CanvasNodeData } from "../types";

type LayoutUnit = {
    id: string;
    nodes: CanvasNodeData[];
    x: number;
    y: number;
    width: number;
    height: number;
};

const COLUMN_GAP = 180;
const ROW_GAP = 96;

export function arrangeCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (nodes.length < 2) return nodes;

    const units = buildLayoutUnits(nodes);
    const unitByNodeId = new Map<string, string>();
    units.forEach((unit) => unit.nodes.forEach((node) => unitByNodeId.set(node.id, unit.id)));

    const outgoing = new Map<string, Set<string>>();
    const indegree = new Map(units.map((unit) => [unit.id, 0]));
    connections.forEach((connection) => {
        const from = unitByNodeId.get(connection.fromNodeId);
        const to = unitByNodeId.get(connection.toNodeId);
        if (!from || !to || from === to) return;
        const targets = outgoing.get(from) || new Set<string>();
        if (targets.has(to)) return;
        targets.add(to);
        outgoing.set(from, targets);
        indegree.set(to, (indegree.get(to) || 0) + 1);
    });

    const levelById = new Map<string, number>();
    const queue = units.filter((unit) => (indegree.get(unit.id) || 0) === 0).sort(compareUnits);
    queue.forEach((unit) => levelById.set(unit.id, 0));

    while (queue.length) {
        const unit = queue.shift()!;
        const level = levelById.get(unit.id) || 0;
        outgoing.get(unit.id)?.forEach((targetId) => {
            levelById.set(targetId, Math.max(levelById.get(targetId) || 0, level + 1));
            indegree.set(targetId, (indegree.get(targetId) || 0) - 1);
            if ((indegree.get(targetId) || 0) === 0) {
                const target = units.find((item) => item.id === targetId);
                if (target) queue.push(target);
            }
        });
        queue.sort(compareUnits);
    }

    const unresolved = units.filter((unit) => !levelById.has(unit.id)).sort(compareUnits);
    const fallbackLevel = Math.max(0, ...levelById.values());
    unresolved.forEach((unit, index) => levelById.set(unit.id, fallbackLevel + Math.floor(index / 4)));

    const unitsByLevel = new Map<number, LayoutUnit[]>();
    units.forEach((unit) => {
        const level = levelById.get(unit.id) || 0;
        const items = unitsByLevel.get(level) || [];
        items.push(unit);
        unitsByLevel.set(level, items);
    });
    unitsByLevel.forEach((items) => items.sort(compareUnits));

    const minX = Math.min(...units.map((unit) => unit.x));
    const top = Math.min(...units.map((unit) => unit.y));
    const bottom = Math.max(...units.map((unit) => unit.y + unit.height));
    const centerY = (top + bottom) / 2;
    const targetByUnitId = new Map<string, { x: number; y: number }>();
    let columnX = minX;

    Array.from(unitsByLevel.keys())
        .sort((a, b) => a - b)
        .forEach((level) => {
            const column = unitsByLevel.get(level) || [];
            const columnWidth = Math.max(...column.map((unit) => unit.width));
            const columnHeight = column.reduce((sum, unit) => sum + unit.height, 0) + Math.max(0, column.length - 1) * ROW_GAP;
            let y = centerY - columnHeight / 2;
            column.forEach((unit) => {
                targetByUnitId.set(unit.id, { x: columnX, y });
                y += unit.height + ROW_GAP;
            });
            columnX += columnWidth + COLUMN_GAP;
        });

    return nodes.map((node) => {
        const unitId = unitByNodeId.get(node.id);
        const unit = unitId ? units.find((item) => item.id === unitId) : undefined;
        const target = unitId ? targetByUnitId.get(unitId) : undefined;
        if (!unit || !target) return node;
        return {
            ...node,
            position: {
                x: Math.round(target.x + node.position.x - unit.x),
                y: Math.round(target.y + node.position.y - unit.y),
            },
        };
    });
}

function buildLayoutUnits(nodes: CanvasNodeData[]) {
    const grouped = new Map<string, CanvasNodeData[]>();
    nodes.forEach((node) => {
        const id = node.metadata?.groupId || node.id;
        const items = grouped.get(id) || [];
        items.push(node);
        grouped.set(id, items);
    });

    return Array.from(grouped.entries()).map(([id, items]): LayoutUnit => {
        const x = Math.min(...items.map((node) => node.position.x));
        const y = Math.min(...items.map((node) => node.position.y));
        const right = Math.max(...items.map((node) => node.position.x + node.width));
        const bottom = Math.max(...items.map((node) => node.position.y + node.height));
        return { id, nodes: items, x, y, width: right - x, height: bottom - y };
    });
}

function compareUnits(a: LayoutUnit, b: LayoutUnit) {
    return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}
