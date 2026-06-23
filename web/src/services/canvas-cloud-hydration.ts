import { useCanvasStore, type CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { deleteCloudCanvas, listCloudCanvases, saveCloudCanvas, type CloudCanvasProject } from "@/services/api/canvas";
import { queueCanvasCloudSave } from "@/services/canvas-cloud-sync";
import { useUserStore } from "@/stores/use-user-store";

let activeHydration: Promise<void> | null = null;

export function hydrateCanvasCloudBackup() {
    if (activeHydration) return activeHydration;
    activeHydration = runHydration().finally(() => {
        activeHydration = null;
    });
    return activeHydration;
}

async function runHydration() {
    const { user, token } = useUserStore.getState();
    if (!user) return;
    const authToken = token || undefined;
    const canvasState = useCanvasStore.getState();
    const pendingDeleteIds = new Set(canvasState.pendingCloudDeletes);
    const failedDeletes = new Set<string>();
    for (const id of pendingDeleteIds) {
        try {
            await deleteCloudCanvas(id, authToken);
        } catch {
            failedDeletes.add(id);
        }
    }

    const cloud = await listCloudCanvases(authToken);
    const merged = new Map(canvasState.projects.map((project) => [project.id, project]));
    const upload = new Map<string, CanvasProject>();

    for (const remote of cloud.items || []) {
        const local = merged.get(remote.id);
        if (remote.deletedAt) {
            if (local && isAfter(local.updatedAt, remote.deletedAt) && !pendingDeleteIds.has(remote.id)) upload.set(local.id, local);
            else merged.delete(remote.id);
            continue;
        }
        if (!local) {
            merged.set(remote.id, fromCloudProject(remote));
            continue;
        }
        if (isAfter(remote.clientUpdatedAt || remote.updatedAt, local.updatedAt)) merged.set(remote.id, fromCloudProject(remote));
        else if (isAfter(local.updatedAt, remote.clientUpdatedAt || remote.updatedAt)) upload.set(local.id, local);
    }

    const cloudIds = new Set((cloud.items || []).map((project) => project.id));
    for (const local of canvasState.projects) {
        if (!cloudIds.has(local.id) && !pendingDeleteIds.has(local.id)) upload.set(local.id, local);
    }

    const projects = Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    useCanvasStore.setState({ projects, pendingCloudDeletes: Array.from(failedDeletes) });
    const uploads = Array.from(upload.values());
    const results = await Promise.allSettled(uploads.map((project) => saveCloudCanvas(project, authToken)));
    results.forEach((result, index) => {
        if (result.status === "rejected") queueCanvasCloudSave(uploads[index]);
    });
}

function fromCloudProject(project: CloudCanvasProject): CanvasProject {
    return {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.clientUpdatedAt || project.updatedAt,
        nodes: Array.isArray(project.nodes) ? project.nodes : [],
        connections: Array.isArray(project.connections) ? project.connections : [],
        chatSessions: Array.isArray(project.chatSessions) ? project.chatSessions : [],
        activeChatId: project.activeChatId || null,
        backgroundMode: project.backgroundMode || "lines",
        showImageInfo: Boolean(project.showImageInfo),
        viewport: project.viewport || { x: 0, y: 0, k: 1 },
        metadata: project.metadata || {},
    };
}

function isAfter(left?: string | null, right?: string | null) {
    const leftTime = Date.parse(left || "");
    const rightTime = Date.parse(right || "");
    if (!Number.isFinite(leftTime)) return false;
    if (!Number.isFinite(rightTime)) return true;
    return leftTime > rightTime;
}
