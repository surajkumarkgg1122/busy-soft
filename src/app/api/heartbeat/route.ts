import { NextResponse } from "next/server";
import { createAuthorizedContext } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await createAuthorizedContext(req);
    if (!ctx?.userId) return NextResponse.json({ ok: false, error: "Unauthorized", code: 401 }, { status: 401 });
    const now = new Date().toISOString();
    const role = ctx.membership?.role ?? ctx.bizRoles?.[ctx.activeBusinessId ?? ""] ?? "staff";
    const permissions = ctx.permissions ?? {};
    const permissionsStr = JSON.stringify(permissions);
    // Also persist a 24h auth cache (best-effort: write to server-collection via admin so browser-side worker can refresh)
    try {
      // We do not write back to client Dexie from here; client SyncProvider will cache the response locally.
    } catch { /* ignore */ }
    return NextResponse.json({
      ok: true, ts: now,
      user: { id: ctx.userId, email: (ctx as any).email ?? null },
      business: ctx.activeBusinessId,
      membership: { role, status: ctx.membership?.status ?? "active", permissionsUpdatedAt: (ctx.membership as any)?.updatedAt ?? now },
      permissions: permissions as Record<string, any>,
      permissionsStr,
      authCacheExpiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: (err as any).code === 401 ? 401 : 503 });
  }
}
