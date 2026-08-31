import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";

export const runtime = "nodejs";

type Membership = {
  status?: string;
  role?: string;
  permissions?: Record<string, unknown>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function jsonSafe(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
        return [key, (value as { toDate: () => Date }).toDate().toISOString()];
      }
      return [key, value];
    }),
  );
}

async function requireSalesView(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new Error("AUTH_REQUIRED");
  const token = await auth.verifyIdToken(header.slice(7));
  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId")?.trim() ?? "";
  if (!businessId) throw new Error("BUSINESS_REQUIRED");

  const businessRef = db.collection("businesses").doc(businessId);
  const membershipSnap = await businessRef.collection("members").doc(token.uid).get();
  if (!membershipSnap.exists) throw new Error("NOT_MEMBER");
  const membership = membershipSnap.data() as Membership;
  if (membership.status !== "active") throw new Error("INACTIVE_MEMBER");

  const salesPermissions = (membership.permissions?.sales ?? {}) as Record<string, unknown>;
  const canView = membership.role === "owner" || membership.role === "admin" || salesPermissions.view === true;
  if (!canView) throw new Error("PERMISSION_DENIED");

  return { db, businessRef };
}

export async function GET(request: Request) {
  try {
    const { businessRef } = await requireSalesView(request);
    const [customers, items, sales] = await Promise.all([
      businessRef.collection("customers").get(),
      businessRef.collection("items").get(),
      businessRef.collection("sales").get(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        customers: customers.docs.map((doc) => ({ id: doc.id, ...jsonSafe(doc.data()) })),
        items: items.docs.map((doc) => ({ id: doc.id, ...jsonSafe(doc.data()) })),
        sales: sales.docs.map((doc) => ({ id: doc.id, ...jsonSafe(doc.data()) })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load sales workspace.";
    const status = message === "AUTH_REQUIRED" || /token|credential/i.test(message) ? 401 : /MEMBER|PERMISSION|INACTIVE/.test(message) ? 403 : /BUSINESS/.test(message) ? 400 : 500;
    return jsonError(status === 500 ? "Could not load sales workspace." : message.replaceAll("_", " "), status);
  }
}
