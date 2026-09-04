import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function HEAD() {
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ ok: true }, { status: 200, headers: { "cache-control": "no-store" } });
}
