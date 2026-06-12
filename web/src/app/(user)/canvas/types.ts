export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
}

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasGenerationPhase = "queued" | "submitting" | "generating" | "saving" | "failed";
export type CanvasPromptReferenceKind = "image" | "video" | "audio" | "text";
export type CanvasPromptReferenceSource = "connected" | "upstream" | "asset" | "manual";

export type CanvasPromptReference = {
    id: string;
    kind: CanvasPromptReferenceKind;
    label: string;
    title: string;
    sourceType: CanvasPromptReferenceSource;
    nodeId?: string;
    assetId?: string;
    imageIndex?: number;
    url?: string;
    storageKey?: string;
    mimeType?: string;
    text?: string;
    missing?: boolean;
    ignoredMissing?: boolean;
};

export type CanvasGroupBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    promptText?: string;
    promptRefs?: CanvasPromptReference[];
    inputReferenceOrder?: string[];
    runPromptRefs?: CanvasPromptReference[];
    runSettings?: Record<string, unknown>;
    status?: CanvasNodeStatus;
    generationPhase?: CanvasGenerationPhase;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    groupId?: string;
    groupMemberIds?: string[];
    groupName?: string;
    groupBounds?: CanvasGroupBounds;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    splitFromNodeId?: string;
    splitGrid?: {
        columns: number;
        rows: number;
        columnStops?: number[];
        rowStops?: number[];
        index: number;
        column: number;
        row: number;
        sourceNodeId?: string;
    };
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant";
    mode: "ask" | "image";
    text: string;
    isLoading?: boolean;
    references?: CanvasAssistantReference[];
    images?: CanvasAssistantImage[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
