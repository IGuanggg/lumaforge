import { apiGet, apiPost } from "@/services/api/request";
import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import type { AssetLibraryItem } from "@/services/api/assets";

export type V21MigrationReport = {
    ok?: boolean;
    report_exists?: boolean;
    projects_count?: number;
    assets_count?: number;
    errors?: string[];
    [key: string]: unknown;
};

export type V21MigrationImportResponse = {
    ok: boolean;
    report: V21MigrationReport;
    projects: Partial<CanvasProject>[];
    assets: AssetLibraryItem[];
    errors: string[];
};

export async function fetchV21MigrationStatus() {
    return apiGet<V21MigrationReport>("/api/migration/v21/status");
}

export async function importV21LegacyData() {
    return apiPost<V21MigrationImportResponse>("/api/migration/v21/import");
}
