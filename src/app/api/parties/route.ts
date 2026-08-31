import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { createParty, updateParty } from "@/application/party/service";
import type { BusinessMember } from "@/types";
import type { PartyKind, PartyMaster } from "@/core/accounting/partyMaster";
import type { AccountingPermission } from "@/core/accounting/authorization";

export const runtime = "nodejs";

function error(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const token = await auth.verifyIdToken(header.slice(7));
  return { db, token };
}

function permissionsFor(member: BusinessMember): AccountingPermission[] {
  const base: AccountingPermission[] = [];
  if (member.role === "owner" || member.role === "admin") {
    return ["PARTY_CREATE", "PARTY_EDIT", "PARTY_ARCHIVE"];
  }
  if (member.permissions?.parties?.create) base.push("PARTY_CREATE");
  if (member.permissions?.parties?.edit) base.push("PARTY_EDIT");
  if (member.permissions?.parties?.delete) base.push("PARTY_ARCHIVE");
  return base;
}

async function requireMembership(db: Firestore, businessId: string, uid: string) {
  const membershipSnap = await db.collection("businesses").doc(businessId).collection("members").doc(uid).get();
  if (!membershipSnap.exists) throw Object.assign(new Error("You are not a member of this business."), { statusCode: 403 });
  const member = membershipSnap.data() as BusinessMember;
  if (member.status !== "active") throw Object.assign(new Error("Your business membership is not active."), { statusCode: 403 });
  return member;
}

async function currentFinancialYear(db: Firestore, businessId: string): Promise<string> {
  const snapshot = await db.collection("businesses").doc(businessId).collection("financialYears").where("locked", "==", false).get();
  const active = snapshot.docs
    .map((doc) => ({ id: doc.id, startDate: String(doc.data()?.startDate || "") }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (!active.length) throw new Error("No active financial year is configured for this business.");
  return active[0].id;
}

function ledgerAccountFor(kind: PartyKind) {
  return kind === "customer" ? "acct-debtors" : "acct-creditors";
}

function generatedPartyCode(kind: PartyKind) {
  const prefix = kind === "customer" ? "CUS" : "SUP";
  return `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function publicParty(data: Record<string, unknown>, id: string): PartyMaster {
  return { id, ...(data as Omit<PartyMaster, "id">) };
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const url = new URL(request.url);
    const businessId = String(url.searchParams.get("businessId") || "").trim();
    const kind = String(url.searchParams.get("kind") || "customer") as PartyKind;
    if (!businessId) return error("Business ID is required.");
    if (kind !== "customer" && kind !== "supplier") return error("Party kind must be customer or supplier.");
    await requireMembership(db, businessId, token.uid);
    const snapshot = await db.collection("businesses").doc(businessId).collection("parties").where("kind", "==", kind).get();
    const parties = snapshot.docs
      .map((doc) => publicParty(doc.data() as Record<string, unknown>, doc.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ success: true, parties });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load parties.";
    const status = (err as { statusCode?: number }).statusCode ?? (/authentication|token|credential/i.test(message) ? 401 : 400);
    return error(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const businessId = String(body.businessId || "").trim();
    const kind = String(body.kind || "customer") as PartyKind;
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    if (!businessId) return error("Business ID is required.");
    if (kind !== "customer" && kind !== "supplier") return error("Party kind must be customer or supplier.");
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return error("A valid idempotency key is required.");
    const member = await requireMembership(db, businessId, token.uid);
    const permissions = permissionsFor(member);
    if (!permissions.includes("PARTY_CREATE")) return error("Permission denied: PARTY_CREATE.", 403);
    const financialYearId = await currentFinancialYear(db, businessId);
    const input = { ...((body.input || {}) as Record<string, unknown>) } as Partial<PartyMaster>;
    input.partyCode = String(input.partyCode || generatedPartyCode(kind));
    input.ledgerAccountId = String(input.ledgerAccountId || ledgerAccountFor(kind));
    input.businessId = businessId;
    const repo = createAdminAccountingRepository(businessId);
    const result = await createParty(
      { repo, ids: { next: (prefix) => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } },
      { businessId, userId: token.uid, financialYearId, idempotencyKey, permissions },
      input,
      kind,
    );
    return NextResponse.json({ success: true, party: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create party.";
    const status = (err as { statusCode?: number }).statusCode ?? (/permission|member/i.test(message) ? 403 : /authentication|token|credential/i.test(message) ? 401 : 400);
    return error(message, status);
  }
}

export async function PATCH(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const businessId = String(body.businessId || "").trim();
    const kind = String(body.kind || "customer") as PartyKind;
    const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).trim();
    if (!businessId) return error("Business ID is required.");
    if (kind !== "customer" && kind !== "supplier") return error("Party kind must be customer or supplier.");
    const member = await requireMembership(db, businessId, token.uid);
    const permissions = permissionsFor(member);
    if (!permissions.includes("PARTY_EDIT")) return error("Permission denied: PARTY_EDIT.", 403);
    const financialYearId = await currentFinancialYear(db, businessId);
    const input = { ...((body.input || {}) as Record<string, unknown>) } as Partial<PartyMaster>;
    input.businessId = businessId;
    const repo = createAdminAccountingRepository(businessId);
    const result = await updateParty(
      { repo, ids: { next: (prefix) => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } },
      { businessId, userId: token.uid, financialYearId, idempotencyKey: idempotencyKey.length >= 16 ? idempotencyKey : `party-edit-${crypto.randomUUID()}`, permissions },
      input,
      kind,
    );
    return NextResponse.json({ success: true, party: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update party.";
    const status = (err as { statusCode?: number }).statusCode ?? (/permission|member/i.test(message) ? 403 : /authentication|token|credential/i.test(message) ? 401 : 400);
    return error(message, status);
  }
}
