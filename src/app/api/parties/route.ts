import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { createParty } from "@/application/party/service";
import type { BusinessMember } from "@/types";
import type { PartyKind } from "@/core/accounting/partyMaster";
import type { AccountingPermission } from "@/core/accounting/authorization";

export const runtime = "nodejs";

async function auth(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const token = await auth.verifyIdToken(header.slice(7));
  return { db, token };
}

function error(message: string, status = 400) { return NextResponse.json({ success: false, error: message }, { status }); }

function permissionsFor(member: BusinessMember): AccountingPermission[] {
  if (member.role === "owner" || member.role === "admin") return ["PARTY_CREATE"];
  return member.permissions?.parties?.create ? ["PARTY_CREATE"] : [];
}

async function currentFinancialYear(db: FirebaseFirestore.Firestore, businessId: string): Promise<string> {
  const snapshot = await db.collection("businesses").doc(businessId).collection("financialYears").where("locked", "==", false).orderBy("startDate", "desc").limit(1).get();
  if (snapshot.empty) throw new Error("No active financial year is configured for this business.");
  return snapshot.docs[0].id;
}

export async function POST(request: Request) {
  try {
    const { db, token } = await auth(request);
    const body = await request.json() as Record<string, unknown>;
    const businessId = String(body.businessId || "").trim();
    const kind = String(body.kind || "customer") as PartyKind;
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!businessId) return error("Business ID is required.");
    if (kind !== "customer" && kind !== "supplier") return error("Party kind must be customer or supplier.");
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return error("A valid idempotency key is required.");
    const membershipSnap = await db.collection("businesses").doc(businessId).collection("members").doc(token.uid).get();
    if (!membershipSnap.exists) return error("You are not a member of this business.", 403);
    const member = membershipSnap.data() as BusinessMember;
    if (member.status !== "active") return error("Your business membership is not active.", 403);
    if (!permissionsFor(member).includes("PARTY_CREATE")) return error("Permission denied: PARTY_CREATE.", 403);
    const financialYearId = await currentFinancialYear(db, businessId);
    const repo = createAdminAccountingRepository(businessId);
    const result = await createParty({ repo, ids: { next: prefix => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } }, { businessId, userId: token.uid, financialYearId, idempotencyKey, permissions: permissionsFor(member) }, (body.input || {}) as Record<string, unknown>, kind);
    return NextResponse.json({ success: true, party: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create party.";
    return error(message, /authentication|token|credential/i.test(message) ? 401 : /permission|member/i.test(message) ? 403 : 400);
  }
}
