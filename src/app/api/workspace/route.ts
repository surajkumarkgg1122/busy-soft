import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";

const ROLE_DEFAULTS = {
  owner: { sales:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true}, purchases:{view:true,create:true,edit:true,delete:true,print:true,export:true,approve:true}, inventory:{view:true,create:true,edit:true,delete:true,print:true,export:true}, payments:{view:true,create:true,edit:true,delete:true,print:true,export:true}, expenses:{view:true,create:true,edit:true,delete:true,print:true,export:true}, reports:{view:true,print:true,export:true}, settings:{view:true,create:true,edit:true,delete:true}, parties:{view:true,create:true,edit:true,delete:true,export:true}, items:{view:true,create:true,edit:true,delete:true,export:true}, cashBank:{view:true,create:true,edit:true,delete:true,print:true,export:true}, gst:{view:true,create:true,edit:true,delete:true,export:true} },
};

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const token = await auth.verifyIdToken(header.slice(7));
  return { auth, db, token };
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const membershipSnap = await db.collection("users").doc(token.uid).collection("businessMemberships").get();
    const memberships = [] as Array<Record<string, unknown>>;
    for (const membershipDoc of membershipSnap.docs) {
      const membership = membershipDoc.data() as Record<string, unknown>;
      if (membership.status !== "active") continue;
      const businessId = String(membership.businessId || membershipDoc.id);
      const businessSnap = await db.collection("businesses").doc(businessId).get();
      if (!businessSnap.exists) continue;
      memberships.push({ ...membership, businessId, business: businessSnap.data() });
    }
    const userSnap = await db.collection("users").doc(token.uid).get();
    return NextResponse.json({ success: true, user: userSnap.exists ? userSnap.data() : null, memberships });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load workspace.";
    return errorResponse(message, /authentication|token|credential/i.test(message) ? 401 : 400);
  }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const input = (body.input || {}) as Record<string, unknown>;
    const name = String(input.name || "").trim();
    if (!name) return errorResponse("Business name is required.");

    const now = Timestamp.now();
    const businessRef = db.collection("businesses").doc();
    const membershipRef = businessRef.collection("members").doc(token.uid);
    const userMembershipRef = db.collection("users").doc(token.uid).collection("businessMemberships").doc(businessRef.id);
    const trialExpiresAt = Timestamp.fromMillis(now.toMillis() + 14 * 86400000);
    const business = {
      businessId: businessRef.id,
      name,
      legalName: String(input.legalName || name).trim(),
      businessType: String(input.businessType || "general").trim(),
      phone: String(input.phone || "").trim(),
      email: String(input.email || token.email || "").trim(),
      address: { line1:"", line2:"", city:String(input.city || "").trim(), district:String(input.district || "").trim(), state:String(input.state || "").trim(), pincode:String(input.pincode || "").trim(), country:"India" },
      gst: { enabled: Boolean(input.gstEnabled ?? input.gstin), gstin:String(input.gstin || "").trim(), registrationType: input.gstin ? "regular" : "unregistered" },
      financialYear: { startMonth:4, startDay:1 },
      currency:"INR", timezone:"Asia/Kolkata", ownerId:token.uid,
      trial:{ status:"active", planId:"trial", startsAt:now, expiresAt:trialExpiresAt },
      status:"active", createdAt:now, updatedAt:now,
    };
    const legacy = { sales:true, purchases:true, inventory:true, payments:true, expenses:true, reports:true, settings:true };
    const membership = { uid:token.uid, role:"owner", status:"active", permissions:{ ...legacy, ...ROLE_DEFAULTS.owner }, joinedAt:now };
    const userMembership = { ...membership, businessId:businessRef.id };
    const userRef = db.collection("users").doc(token.uid);
    const batch = db.batch();
    batch.set(businessRef, business);
    batch.set(membershipRef, membership);
    batch.set(userMembershipRef, userMembership);
    if (!(await userRef.get()).exists) {
      batch.set(userRef, { uid:token.uid, name:token.name || token.email?.split("@")[0] || "User", email:token.email || "", phone:"", photoURL:null, status:"active", createdAt:now, updatedAt:now, lastLoginAt:now });
    }
    await batch.commit();
    return NextResponse.json({ success:true, businessId:businessRef.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create business.";
    return errorResponse(message, /authentication|token|credential/i.test(message) ? 401 : 400);
  }
}
