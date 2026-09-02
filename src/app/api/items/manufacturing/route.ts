import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import type { BusinessMember } from "@/types";
import { validateManufacturingConfig, type ManufacturingConfig } from "@/core/accounting/manufacturing";

export const runtime = "nodejs";
const errorResponse = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const text = (value: unknown) => String(value ?? "").trim();

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  return { db, token: await auth.verifyIdToken(header.slice(7)) };
}

async function membership(db: Firestore, businessId: string, uid: string) {
  const snapshot = await db.collection("businesses").doc(businessId).collection("members").doc(uid).get();
  if (!snapshot.exists) throw Object.assign(new Error("You are not a member of this business."), { statusCode: 403 });
  const member = snapshot.data() as BusinessMember;
  if (member.status !== "active") throw Object.assign(new Error("Your business membership is not active."), { statusCode: 403 });
  return member;
}

function allowed(member: BusinessMember, action: "view" | "edit") {
  return member.role === "owner" || member.role === "admin" || !!member.permissions?.items?.[action];
}

function normalizeConfig(value: unknown): ManufacturingConfig {
  if (!value || typeof value !== "object") throw new Error("Manufacturing configuration is required.");
  return validateManufacturingConfig(value as ManufacturingConfig);
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const url = new URL(request.url);
    const businessId = text(url.searchParams.get("businessId"));
    const itemId = text(url.searchParams.get("itemId"));
    if (!businessId || !itemId) return errorResponse("Business ID and item ID are required.");
    const member = await membership(db, businessId, token.uid);
    if (!allowed(member, "view")) return errorResponse("Permission denied: item view.", 403);
    const ref = db.collection("businesses").doc(businessId).collection("items").doc(itemId);
    const snap = await ref.get();
    if (!snap.exists) return errorResponse("Item not found.", 404);
    const item = snap.data() as Record<string, unknown>;
    if (String(item.businessId) !== businessId) return errorResponse("Item business mismatch.", 403);
    return NextResponse.json({ success: true, itemId, manufacturing: item.manufacturing ?? null });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not load manufacturing configuration.", (error as { statusCode?: number }).statusCode || 400);
  }
}

export async function PUT(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const businessId = text(body.businessId);
    const itemId = text(body.itemId);
    if (!businessId || !itemId) return errorResponse("Business ID and item ID are required.");
    const member = await membership(db, businessId, token.uid);
    if (!allowed(member, "edit")) return errorResponse("Permission denied: item edit.", 403);
    const config = normalizeConfig(body.manufacturing);
    const itemRef = db.collection("businesses").doc(businessId).collection("items").doc(itemId);
    const result = await db.runTransaction(async (tx) => {
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw Object.assign(new Error("Item not found."), { statusCode: 404 });
      const item = itemSnap.data() as Record<string, unknown>;
      if (String(item.businessId) !== businessId) throw Object.assign(new Error("Item business mismatch."), { statusCode: 403 });
      if (String(item.itemType ?? "product") === "service") throw new Error("A service cannot be configured as a manufactured stock item.");
      const now = new Date().toISOString();
      const record = { ...config, updatedAt: now, updatedBy: token.uid };
      tx.set(itemRef, { manufacturing: record, updatedAt: now }, { merge: true });
      return record;
    });
    return NextResponse.json({ success: true, itemId, manufacturing: result });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Could not save manufacturing configuration.", (error as { statusCode?: number }).statusCode || 400);
  }
}
