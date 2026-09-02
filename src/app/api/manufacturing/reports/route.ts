import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import type { BusinessMember } from "@/types";

export const runtime = "nodejs";
const fail = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const text = (v: unknown) => String(v ?? "").trim();
async function auth(request: Request) {
  const { auth, db } = getAdminServices();
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw Object.assign(new Error("Authentication is required."), { statusCode: 401 });
  return { db, token: await auth.verifyIdToken(h.slice(7)) };
}
async function member(db: Firestore, businessId: string, uid: string) {
  const s = await db.collection("businesses").doc(businessId).collection("members").doc(uid).get();
  if (!s.exists) throw Object.assign(new Error("You are not a member of this business."), { statusCode: 403 });
  const m = s.data() as BusinessMember;
  if (m.status !== "active") throw Object.assign(new Error("Your business membership is not active."), { statusCode: 403 });
  if (m.role !== "owner" && m.role !== "admin" && !m.permissions?.items?.view) throw Object.assign(new Error("Permission denied: manufacturing reports."), { statusCode: 403 });
  return m;
}
export async function GET(request: Request) {
  try {
    const { db, token } = await auth(request);
    const u = new URL(request.url);
    const businessId = text(u.searchParams.get("businessId"));
    const from = text(u.searchParams.get("from"));
    const to = text(u.searchParams.get("to"));
    const itemId = text(u.searchParams.get("itemId"));
    if (!businessId) return fail("Business ID is required.");
    await member(db, businessId, token.uid);
    const snap = await db.collection("businesses").doc(businessId).collection("productionVouchers").limit(1000).get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Record<string, any>).filter(r => r.status !== "cancelled" && (!from || String(r.date) >= from) && (!to || String(r.date) <= to) && (!itemId || String(r.itemId) === itemId));
    const totals = rows.reduce((a, r) => ({ qty: a.qty + Number(r.quantity || 0), material: a.material + Number(r.materialCost || 0), labour: a.labour + Number(r.labourCost || 0), electricity: a.electricity + Number(r.electricityCost || 0), machine: a.machine + Number(r.machineCost || 0), overhead: a.overhead + Number(r.overheadCost || 0), other: a.other + Number(r.otherCost || 0), total: a.total + Number(r.totalCost || 0) }), { qty: 0, material: 0, labour: 0, electricity: 0, machine: 0, overhead: 0, other: 0, total: 0 });
    const byItem = [...rows.reduce((m, r) => { const k = String(r.itemId); const x = m.get(k) || { itemId: k, itemName: String(r.itemName || k), quantity: 0, totalCost: 0 }; x.quantity += Number(r.quantity || 0); x.totalCost += Number(r.totalCost || 0); m.set(k, x); return m; }, new Map<string, { itemId: string; itemName: string; quantity: number; totalCost: number }>()).values()].map(x => ({ ...x, unitCost: x.quantity ? Math.round(x.totalCost / x.quantity) : 0 }));
    return NextResponse.json({ success: true, filters: { from: from || null, to: to || null, itemId: itemId || null }, totals, byItem, productions: rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unable to load manufacturing report.";
    return fail(message, (e as { statusCode?: number }).statusCode || 400);
  }
}
