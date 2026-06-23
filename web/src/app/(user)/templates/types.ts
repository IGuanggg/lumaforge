import type { CanvasConnection, CanvasNodeData, ViewportTransform } from "../canvas/types";

export type CanvasTemplateCategory = "character" | "product" | "scene" | "workflow";
export type CanvasTemplateDifficulty = "beginner" | "intermediate" | "advanced";

export type CanvasTemplate = {
    id: string;
    name: string;
    description: string;
    category: CanvasTemplateCategory;
    difficulty: CanvasTemplateDifficulty;
    tags: string[];
    accent: string;
    canvas: {
        nodes: CanvasNodeData[];
        connections: CanvasConnection[];
        viewport: ViewportTransform;
    };
};
