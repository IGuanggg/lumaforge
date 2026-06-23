import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";

export type CloudCanvasProject = CanvasProject & {
    clientUpdatedAt?: string;
    version?: number;
    deletedAt?: string | null;
};

export type CloudCanvasList = {
    items: CloudCanvasProject[];
    total: number;
};

export function listCloudCanvases(token?: string) {
    return apiGet<CloudCanvasList>("/api/canvases", { offset: 0, limit: 500, includeDeleted: "true" }, token);
}

export function saveCloudCanvas(project: CanvasProject, token?: string) {
    return apiPost<CloudCanvasProject>(
        "/api/canvases",
        {
            ...project,
            clientUpdatedAt: project.updatedAt,
        },
        token,
    );
}

export function deleteCloudCanvas(id: string, token?: string) {
    return apiDelete<CloudCanvasProject | { ok: boolean; id: string }>(`/api/canvases/${encodeURIComponent(id)}`, token);
}
