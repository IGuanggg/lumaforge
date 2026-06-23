export class ApiError extends Error {
    readonly code?: string;
    readonly action?: string;
    readonly status?: number;

    constructor(message: string, options: { code?: string; action?: string; status?: number } = {}) {
        super(message);
        this.name = "ApiError";
        this.code = options.code;
        this.action = options.action;
        this.status = options.status;
    }
}

export function apiErrorMessage(error: unknown, fallback = "操作失败，请稍后重试") {
    return error instanceof Error && error.message.trim() ? error.message : fallback;
}
