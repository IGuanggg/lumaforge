import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
    params: Promise<{ path: string[] }>;
};

function responseHeaders(response: Response) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return headers;
}

async function proxyAsset(request: NextRequest, context: RouteContext) {
    const { path } = await context.params;
    const apiBaseUrl = process.env.API_BASE_URL || "http://127.0.0.1:8080";
    const target = `${apiBaseUrl.replace(/\/$/, "")}/assets/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

    try {
        const response = await fetch(target, {
            method: request.method,
            redirect: "manual",
        });

        return new Response(request.method === "HEAD" ? null : response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders(response),
        });
    } catch (error) {
        console.error("Failed to proxy asset", target, error);
        return Response.json({ code: 1, data: null, msg: "素材文件连接失败，请确认后端服务已启动" }, { status: 502 });
    }
}

export const GET = proxyAsset;
export const HEAD = proxyAsset;
