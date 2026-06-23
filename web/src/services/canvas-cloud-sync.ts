import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { deleteCloudCanvas, saveCloudCanvas } from "@/services/api/canvas";
import { useUserStore } from "@/stores/use-user-store";

const pendingSaves = new Map<string, CanvasProject>();
const pendingDeletes = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function queueCanvasCloudSave(project: CanvasProject) {
    pendingDeletes.delete(project.id);
    pendingSaves.set(project.id, project);
    scheduleFlush(900);
}

export function queueCanvasCloudDelete(ids: Iterable<string>) {
    for (const id of ids) {
        pendingSaves.delete(id);
        pendingDeletes.add(id);
    }
    scheduleFlush(300);
}

export async function flushCanvasCloudQueue() {
    if (flushing) return;
    const { user, token } = useUserStore.getState();
    if (!user) return;
    flushing = true;
    try {
        const completedDeletes: string[] = [];
        for (const id of Array.from(pendingDeletes)) {
            try {
                await deleteCloudCanvas(id, token || undefined);
                pendingDeletes.delete(id);
                completedDeletes.push(id);
            } catch {
                // Keep the tombstone queued for the next online flush.
            }
        }
        for (const [id, project] of Array.from(pendingSaves)) {
            try {
                await saveCloudCanvas(project, token || undefined);
                if (pendingSaves.get(id)?.updatedAt === project.updatedAt) pendingSaves.delete(id);
            } catch {
                // Keep the latest snapshot queued for the next online flush.
            }
        }
        if (completedDeletes.length) {
            const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
            useCanvasStore.setState((state) => ({
                pendingCloudDeletes: state.pendingCloudDeletes.filter((id) => !completedDeletes.includes(id)),
            }));
        }
    } finally {
        flushing = false;
        if (pendingDeletes.size || pendingSaves.size) scheduleFlush(15000);
    }
}

function scheduleFlush(delay: number) {
    if (typeof window === "undefined") return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushTimer = null;
        if (navigator.onLine) void flushCanvasCloudQueue();
        else scheduleFlush(15000);
    }, delay);
}
