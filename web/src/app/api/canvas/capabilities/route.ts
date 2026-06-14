import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
    return NextResponse.json({
        ok: true,
        prompt_refs: true,
        history: true,
        asset_sync: true,
        connections: true,
        version: process.env.NEXT_PUBLIC_APP_VERSION || "dev",
    });
}
