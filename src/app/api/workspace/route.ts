import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  const token = await auth.verifyIdToken(header.slice(7));
  return { db, token };
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
    const now = Timestamp.now();
    if (!userSnap.exists) {
      await db.collection("users").doc(token.uid).set({
        uid: token.uid,
        name: token.name || token.email?.split("@")[0] || "User",
        email: token.email || "",
        phone: "",
        photoURL: token.picture || null,
        status: "active",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });
    }
    return NextResponse.json({ success: true, user: userSnap.exists ? userSnap.data() : { uid: token.uid }, memberships });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load workspace.";
    return NextResponse.json({ success: false, error: message }, { status: /authentication|token|credential/i.test(message) ? 401 : 400 });
  }
}

export async function POST() {
  return NextResponse.json({ success: false, error: "Business creation has moved to the canonical /api/businesses endpoint." }, { status: 410 });
}
